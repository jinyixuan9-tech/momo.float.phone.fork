import { sendLLMRequest } from "./chat-engine";
import { loadCharacters } from "./character-storage";
import { loadApiConfigs, loadBindingConfig, loadPresets, loadWorldBooks, resolveBinding, resolveUserIdentity } from "./settings-storage";
import type { BoxQuestion, BoxSession } from "./question-box-storage";
import { newBoxId, loadBoxState } from "./question-box-storage";
import { roleSocialContext } from "./role-social-sources";
import { prepareShortTermContext } from "./short-term-assembler";
import { loadMemoryConfig } from "./memory-storage";
import { retrieveCoreMemoriesForPrompt, retrieveMemoriesForPrompt } from "./memory-service";
import { formatCoreMemories, formatLongTermMemories } from "./memory-injector";

const clean = (value: unknown, limit = 700) => typeof value === "string" ? value.trim().slice(0, limit) : "";
function parse(raw: string): Record<string, unknown> {
  const start = raw.indexOf("{"); const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("生成格式无效，请重试。");
  return JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
}
async function ask(prompt: string, characterId?: string) {
  const slot = resolveBinding(loadBindingConfig(), characterId, "question_box");
  const configs = loadApiConfigs();
  const api = configs.find(row => row.id === slot.apiConfigId) || configs.find(row => row.apiKey?.trim());
  if (!api?.apiKey?.trim()) throw new Error("请先配置小手机文字 API。");
  const preset = loadPresets().find(row => row.id === slot.presetId) || null;
  const world = loadWorldBooks().filter(row => slot.worldBookIds?.includes(row.id)).map(row => `${row.name}：${row.entries.filter(entry => !entry.disable).map(entry => entry.content).join("；")}`).join("\n").slice(0, 4000);
  const shortTerm = characterId ? prepareShortTermContext(characterId, "question_box", { tokenBudgetOverride: 1800 }) : null;
  const memoryConfig = characterId ? loadMemoryConfig() : null;
  const [longTerm, core] = characterId && memoryConfig ? await Promise.all([
    retrieveMemoriesForPrompt(characterId, shortTerm?.wbActivationContext || prompt, memoryConfig).catch(() => []),
    retrieveCoreMemoriesForPrompt(characterId, memoryConfig).catch(() => []),
  ]) : [[], []];
  const linkedSources = characterId ? roleSocialContext(characterId, loadBoxState().socialSourcesByCharacter[characterId]) : "";
  const context = [
    ...(shortTerm?.recentBlocks || []).filter(block => block.content).map(block => block.content),
    core.length ? formatCoreMemories(core) : "",
    longTerm.length ? formatLongTermMemories(longTerm) : "",
  ].filter(Boolean).join("\n").slice(-11000);
  const output = await sendLLMRequest(api, preset, [
    { role: "system", content: `${prompt}\n相关世界书：${world || "无"}。${linkedSources ? `\n角色本人关联的日程与 WVS：${linkedSources}。日历仅供本人理解，匿名提问者不能据此得知隐私；公开回答不得泄漏私人安排。` : ""}${context ? `\n角色近期经历及记忆（仅供理解角色，不能用来识破匿名发问者）：\n${context}` : ""}\n只输出 JSON，不能输出 Markdown。` },
    { role: "user", content: "生成这次内容。" },
  ], [], undefined, { appId: "question_box", appTags: ["question_box", "questions"], skipOutputRegex: true });
  return parse(output);
}
const chinese = (text: string) => /[\u4e00-\u9fff]/.test(text) && !/[\uac00-\ud7af\u3040-\u30ff]/.test(text);

export async function translateBoxUserAnswer(original: string): Promise<string> {
  if (!/[\uac00-\ud7af\u3040-\u30ff]/.test(original)) return original;
  const result = await ask(`把用户在提问箱里的回答准确译成自然简体中文。不要改写、增补、替用户作答。原文：${JSON.stringify(original.slice(0, 1400))}。只输出 {"translated":"中文译文"}。`);
  const translated = clean(result.translated, 1600);
  if (!translated || !/[\u4e00-\u9fff]/.test(translated)) throw new Error("回答翻译失败，请重试。");
  return translated;
}

export async function generateBoxTopic(ownerId: string): Promise<string> {
  const char = loadCharacters().find(row => row.id === ownerId);
  if (!char) return "";
  const result = await ask(`角色 ${char.name} 开了一期私人提问箱。人设：${char.persona.slice(0, 2500)}。由这个角色自己选一个轻松、具体、可以问答的话题，中文 4–18 字。可选择普通日常，别强行恋爱或泄露私密设定。只输出 {"topic":"话题"}。`, ownerId);
  const topic = clean(result.topic, 36);
  if (!topic || !chinese(topic)) throw new Error("角色主题生成失败，请重试。");
  return topic;
}

export async function generateBoxQuestions(session: BoxSession, count: number, excludeUser = false): Promise<BoxQuestion[]> {
  const owner = loadCharacters().find(row => row.id === session.ownerId);
  const user = resolveUserIdentity(session.ownerId === "user" ? undefined : session.ownerId, "question_box");
  const available = loadCharacters();
  const candidates = session.ownerId === "user" ? session.participantIds === undefined
    ? available.sort(() => Math.random() - .5).slice(0, available.length ? 1 + Math.floor(Math.random() * Math.min(3, available.length)) : 0)
    : available.filter(row => session.participantIds?.includes(row.id)) : [];
  const roster = candidates.map(row => {
    const recent = prepareShortTermContext(row.id, "question_box", { tokenBudgetOverride: 300 }).recentBlocks
      .filter(block => block.content).map(block => block.content).join(" ").slice(-850);
    const linked = roleSocialContext(row.id, loadBoxState().socialSourcesByCharacter[row.id]);
    return `${row.id}=${row.name}：${row.persona.slice(0, 450)}${recent ? `。最近的经历和聊天：${recent}` : ""}${linked ? `。本人关联日程与 WVS：${linked}。私人日历只供本人参考，不能让别的发问者知情` : ""}`;
  }).join("\n");
  const previous = session.questions.slice(-14).map(row => row.text).join("；");
  const topic = session.topic ? `本期主题「${session.topic}」，问题应围绕主题但角度多样。` : "没有指定主题，问题题材自然多样。";
  const recipient = session.ownerId === "user" ? `U（${user?.name || "用户"}）。身份介绍：${[user?.bio, user?.customSettings].filter(Boolean).join("；").slice(0, 650)}。候选角色（允许部分角色提问，也允许陌生人提问）：${roster || "本期没有参与的角色，只能由陌生人提问"}。` : `${owner?.name || "角色"}。人设：${owner?.persona.slice(0, 1800) || "无"}。只能由虚构陌生人提问，不能代 U 发问。`;
  const result = await ask(`你在为一期开着的提问箱新增恰好 ${count} 个问题。收件人：${recipient}${topic}已有问题避免重复：${previous || "无"}。全部问题正文必须写自然中文，不得写韩语或日语。不要每题都围绕恋爱或私人关系；尊重人物的公开与私密边界。每位候选角色只能依据自己的人设和经历提问，不得借用其他候选角色独有的聊天或秘密。发问人全部匿名，绝不在前端露出姓名。${excludeUser ? "这一批不能出现 U 的问题。" : ""}只输出 {"questions":[{"text":"中文问题","senderId":"若 U 的收件箱且确有角色发问，填写上面候选角色的准确 ID；陌生人填空字符串"}]}。`, session.ownerId === "user" ? undefined : session.ownerId);
  const rows = Array.isArray(result.questions) ? result.questions : [];
  const valid = rows.slice(0, count).flatMap(value => {
    if (!value || typeof value !== "object") return [];
    const row = value as Record<string, unknown>;
    const body = clean(row.text, 600);
    const candidate = candidates.find(char => char.id === row.senderId);
    if (!chinese(body)) return [];
    return [{ id: newBoxId(), recipientId: session.ownerId, senderId: candidate?.id, senderName: "匿名", text: body, createdAt: Date.now() } satisfies BoxQuestion];
  });
  if (valid.length !== count) throw new Error("生成的问题数量或中文内容不完整，请重试。");
  return valid;
}

export async function generateBoxAnswers(session: BoxSession): Promise<Array<{ id: string; original: string; translated: string }>> {
  const char = loadCharacters().find(row => row.id === session.ownerId);
  if (!char) throw new Error("找不到回答者的角色资料。");
  const pending = [...session.questions.filter(question => !question.answer)].sort(() => Math.random() - .5).slice(0, 15);
  if (!pending.length) return [];
  const list = pending.map(question => ({ id: question.id, text: question.text, askedAt: new Date(question.createdAt).toISOString() }));
  const result = await ask(`你是角色 ${char.name}，正在查看自己提问箱里还没回答的匿名问题。人设：${char.persona.slice(0, 4200)}。现在可以结合近期聊天和经历决定回答哪些问题；可能一题、多题或一题都不答。不要仅为完成任务而强行回答，也不要无理由永久拖延。如果此前不知怎么回答，近期经历可能让你有了想法。发问者全部匿名；后台 senderId 不可见，也不能当作识别依据。你可以根据问题措辞和自己已知的经历不确定地猜测是谁，但不能声称知道发问者身份。问题列表：${JSON.stringify(list)}。只给出想回答的列表，每项准确填写原问题 id。回答要符合人设；original 用日常语言，如非中文 translated 给准确自然的简体中文译文，中文则相同。只输出 {"answers":[{"id":"问题id","original":"回答原话","translated":"中文译文"}]}，不回答可输出空数组。`, char.id);
  const rows = Array.isArray(result.answers) ? result.answers : [];
  const seen = new Set<string>();
  return rows.flatMap(item => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const id = typeof row.id === "string" ? row.id : "";
    const original = clean(row.original, 1400); const translated = clean(row.translated, 1600);
    if (!pending.some(question => question.id === id) || seen.has(id) || !original || !translated || (!/[\u4e00-\u9fff]/.test(original) && !/[\u4e00-\u9fff]/.test(translated))) return [];
    seen.add(id);
    return [{ id, original, translated }];
  });
}
