import { sendLLMRequest } from "./chat-engine";
import { loadCharacters } from "./character-storage";
import { loadApiConfigs, loadBindingConfig, loadPresets, loadWorldBooks, resolveBinding, resolveUserIdentity } from "./settings-storage";
import type { BoxQuestion, BoxSession } from "./question-box-storage";
import { newBoxId } from "./question-box-storage";

function parseObject(raw: string): Record<string, unknown> {
  const start = raw.indexOf("{"); const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("生成内容格式无效，请重试。");
  return JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
}
async function ask(prompt: string, characterId?: string) {
  const slot = resolveBinding(loadBindingConfig(), characterId, "question_box");
  const configs = loadApiConfigs();
  const api = configs.find(row => row.id === slot.apiConfigId) || configs.find(row => row.apiKey?.trim());
  if (!api?.apiKey?.trim()) throw new Error("请先配置提问箱使用的文字 API。");
  const preset = loadPresets().find(row => row.id === slot.presetId) || null;
  const world = loadWorldBooks().filter(row => slot.worldBookIds?.includes(row.id)).map(row => `${row.name}：${row.entries.filter(entry => !entry.disable).map(entry => entry.content).join("；")}`).join("\n").slice(0, 4500);
  const raw = await sendLLMRequest(api, preset, [
    { role: "system", content: `${prompt}\n关联世界书：${world || "无"}。只输出有效 JSON，不要代码块。` },
    { role: "user", content: "现在生成。" },
  ], [], undefined, { appId: "question_box", appTags: ["question_box", "questions"], skipOutputRegex: true });
  return parseObject(raw);
}
const text = (value: unknown, limit = 700) => typeof value === "string" ? value.trim().slice(0, limit) : "";

export async function generateBoxQuestions(session: BoxSession, count: number): Promise<BoxQuestion[]> {
  const chars = loadCharacters().filter(row => session.participantIds.includes(row.id));
  const user = resolveUserIdentity(undefined, "question_box");
  const roster = [session.participantIds.includes("user") ? `user=U（${user?.name || "用户"}）` : "", ...chars.map(row => `${row.id}=${row.name}；人设 ${row.persona.slice(0, 550)}`)].filter(Boolean).join("\n");
  const history = session.questions.slice(-20).map(row => `${row.recipientId}：${row.text}`).join("；");
  const result = await ask(`你在模拟私人提问箱开放期间陆续收到的提问。当前参与者（唯一允许收题的人）：\n${roster}。用户的身份资料：${[user?.bio, user?.customSettings].filter(Boolean).join("；").slice(0, 700) || "无"}。本期已有问题：${history || "无"}。现在只生成 ${count} 个自然、有差异的问题；所有问题文本必须是中文，即使收件人是外国角色也用中文写问题。可以有陌生人问 U/C，也可由参与的 C 向 U 提问（仅当 U 参与）；绝不替 U 自动向 C 发问。避免机械地每题都关于角色关系，不剧透匿名者的真实身份。严格 JSON：{"questions":[{"recipientId":"参与者的准确 ID","senderId":"发问 C 的准确 ID；陌生人为 null","anonymous":true,"text":"中文问题"}]}。`);
  const rows = Array.isArray(result.questions) ? result.questions : [];
  const now = Date.now();
  const allowed = new Set(session.participantIds);
  const resultRows = rows.slice(0, count).flatMap((value, index) => {
    if (!value || typeof value !== "object") return [];
    const row = value as Record<string, unknown>;
    const recipientId = text(row.recipientId, 80);
    const senderId = text(row.senderId, 80);
    const body = text(row.text, 600);
    if (!allowed.has(recipientId) || !body || !/[\u4e00-\u9fff]/.test(body) || /[\uac00-\ud7af\u3040-\u30ff]/.test(body) || (senderId && (!chars.some(c => c.id === senderId) || recipientId !== "user"))) return [];
    const sender = chars.find(c => c.id === senderId);
    const anonymous = sender ? row.anonymous !== false : true;
    return [{ id: newBoxId(), recipientId, senderId: sender?.id, senderName: sender && !anonymous ? sender.name : "匿名", anonymous, text: body, createdAt: now + index } satisfies BoxQuestion];
  });
  if (resultRows.length !== count) throw new Error("问题数量或中文内容不完整，请重试。");
  return resultRows;
}

export async function generateBoxAnswer(question: BoxQuestion): Promise<{ original: string; translated: string }> {
  const character = loadCharacters().find(row => row.id === question.recipientId);
  if (!character) throw new Error("找不到回答这个问题的角色。");
  const user = resolveUserIdentity(character.id, "question_box");
  const result = await ask(`你正在为角色 ${character.name} 写提问箱回答。角色人设：${character.persona.slice(0, 4200)}。用户：${user?.name || "U"}；${[user?.bio, user?.customSettings].filter(Boolean).join("；").slice(0, 600)}。问题来自${question.senderId ? "相识的用户或角色" : "陌生人"}，提问者显示：${question.anonymous ? "匿名" : question.senderName}。问题（中文）：${question.text}。角色可以结合性格直答、婉拒或回避，不能捏造确切事实。original 用角色自然使用的语言写回答；如果 original 不是中文，translated 必须提供准确自然的简体中文译文；中文时两个字段相同。只输出 JSON：{"original":"回答原话","translated":"中文翻译"}。`, character.id);
  const original = text(result.original, 1400);
  const translated = text(result.translated, 1600);
  if (!original || !translated || (!/[\u4e00-\u9fff]/.test(original) && !/[\u4e00-\u9fff]/.test(translated))) throw new Error("回答或中文翻译不完整，请重试。");
  return { original, translated };
}
