import { sendLLMRequest } from "./chat-engine";
import { loadCharacters } from "./character-storage";
import { loadApiConfigs, loadBindingConfig, loadPresets, loadWorldBooks, resolveBinding, resolveUserIdentity } from "./settings-storage";
import type { BoxQuestion, BoxSession } from "./question-box-storage";
import { newBoxId } from "./question-box-storage";

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
  const output = await sendLLMRequest(api, preset, [
    { role: "system", content: `${prompt}\n相关世界书：${world || "无"}。只输出 JSON，不能输出 Markdown。` },
    { role: "user", content: "生成这次内容。" },
  ], [], undefined, { appId: "question_box", appTags: ["question_box", "questions"], skipOutputRegex: true });
  return parse(output);
}
const chinese = (text: string) => /[\u4e00-\u9fff]/.test(text) && !/[\uac00-\ud7af\u3040-\u30ff]/.test(text);

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
  const roster = candidates.map(row => `${row.id}=${row.name}：${row.persona.slice(0, 450)}`).join("\n");
  const previous = session.questions.slice(-14).map(row => row.text).join("；");
  const topic = session.topic ? `本期主题「${session.topic}」，问题应围绕主题但角度多样。` : "没有指定主题，问题题材自然多样。";
  const recipient = session.ownerId === "user" ? `U（${user?.name || "用户"}）。身份介绍：${[user?.bio, user?.customSettings].filter(Boolean).join("；").slice(0, 650)}。候选角色（允许部分角色提问，也允许陌生人提问）：${roster || "本期没有参与的角色，只能由陌生人提问"}。` : `${owner?.name || "角色"}。人设：${owner?.persona.slice(0, 1800) || "无"}。只能由虚构陌生人提问，不能代 U 发问。`;
  const result = await ask(`你在为一期开着的提问箱新增恰好 ${count} 个问题。收件人：${recipient}${topic}已有问题避免重复：${previous || "无"}。全部问题正文必须写自然中文，不得写韩语或日语。不要每题都围绕恋爱或私人关系；尊重人物的公开与私密边界。发问人全部匿名，绝不在前端露出姓名。${excludeUser ? "这一批不能出现 U 的问题。" : ""}只输出 {"questions":[{"text":"中文问题","senderId":"若 U 的收件箱且确有角色发问，填写上面候选角色的准确 ID；陌生人填空字符串"}]}。`, session.ownerId === "user" ? undefined : session.ownerId);
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

export async function generateBoxAnswer(question: BoxQuestion): Promise<{ original: string; translated: string }> {
  const char = loadCharacters().find(row => row.id === question.recipientId);
  if (!char) throw new Error("找不到回答者的角色资料。");
  const result = await ask(`请替角色 ${char.name} 回答私人提问箱的一道匿名问题。角色人设：${char.persona.slice(0, 4200)}。提问者身份未知，不能根据后台身份、用户私聊或元数据认出；只有问题文字本身提供明确线索时，角色才可以不确定地猜。匿名问题：${question.text}。回答符合人设，可以直答、回避或婉拒；不编造现实事实。original 用角色日常使用的语言写；如不是中文，translated 必须是准确、自然的简体中文译文；中文回答时两字段相同。只输出 {"original":"回答原话","translated":"中文译文"}。`, char.id);
  const original = clean(result.original, 1400); const translated = clean(result.translated, 1600);
  if (!original || !translated || (!/[\u4e00-\u9fff]/.test(original) && !/[\u4e00-\u9fff]/.test(translated))) throw new Error("回答或中文翻译不完整，请重试。");
  return { original, translated };
}
