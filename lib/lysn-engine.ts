import { loadCharacters } from "./character-storage";
import { sendLLMRequest } from "./chat-engine";
import { assemblePromptPayload, type LLMMessage } from "./llm-prompt-assembler";
import { loadApiConfigs, loadBindingConfig, loadPresets, loadRegexes, loadWorldBooks, resolveBinding } from "./settings-storage";
import type { RegexConfig, WorldBookConfig } from "./settings-types";
import { buildCharacterTimeContext } from "./character-time";
import { loadLysn, type LysnMessage, type LysnQuote } from "./lysn-storage";

export type GeneratedLysn = {
  kind: "text" | "photo" | "voice" | "sticker";
  original: string; translated: string; quote?: LysnQuote; stickerName?: string;
  photoDescription?: string;
  mediaIntent?: "selfie" | "portrait" | "group" | "food" | "scenery" | "object" | "pet" | "other";
};
function parseJson(raw: string): Record<string, unknown> {
  const start = raw.indexOf("{"); const end = raw.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("LYSN 没有返回有效消息，请重试。");
  return JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
}
const asText = (value: unknown) => typeof value === "string" ? value.trim() : "";
/** Empty result is a deliberate decision to stay silent, rather than an error. */
export async function generateLysn(characterId: string, history: LysnMessage[], mode: "new" | "reply" | "opening" | "birthday", fanMessage?: string): Promise<GeneratedLysn[]> {
  const character = loadCharacters().find(c => c.id === characterId);
  if (!character) throw new Error("角色已不存在。");
  const slot = resolveBinding(loadBindingConfig(), characterId, "lysn");
  const api = loadApiConfigs().find(x => x.id === slot.apiConfigId) || loadApiConfigs()[0];
  if (!api) throw new Error("请先为 LYSN 配置可用的文字 API。");
  const presets = loadPresets();
  const preset = presets.find(x => x.id === slot.presetId) || presets.find(x => x.builtIn) || null;
  const worldBooks = (slot.worldBookIds || []).map(id => loadWorldBooks().find(x => x.id === id)).filter(Boolean) as WorldBookConfig[];
  const regexes = (slot.regexIds || []).map(id => loadRegexes().find(x => x.id === id)).filter(Boolean) as RegexConfig[];
  const room = loadLysn().rooms[characterId];
  const stickers = (room?.stickerPacks || []).flatMap(p => p.stickers).filter(s => s.name.trim() && s.imageUrl);
  // There is no private Chat history or Chat user identity in this prompt.
  const prompt = assemblePromptPayload({ character, history: [], preset, worldBooks, regexes,
    appId: "lysn", appTags: ["lysn", "bubble"], timeContext: buildCharacterTimeContext(character.timeZone) });
  const timeline = history.slice(-18).map(m => `${m.sender === "fan" ? "匿名粉丝" : m.sender === "artist" ? m.opener ? "频道开场白" : "艺人" : "系统"}: ${m.original}`).join("\n");
  const mayQuote = (mode === "new" || mode === "reply") && Math.random() < ({ rare: .1, normal: .32, often: .7 }[room?.quoteStyle || "normal"]);
  const instruction: LLMMessage = { role: "system", content: [
    "你正在 LYSN Bubble 面向全部订阅者的艺人频道发消息。回复是匿名粉丝反馈，不是与某个人的私聊。绝不识别发送者真实身份、推断私下关系或泄露秘密。",
    "自然地按人设发短消息，不要总写公告。original 使用你实际说话语言，translated 是忠实简体中文翻译；原文中文则相同。",
    "艺人可以使用 {{nickname}} 占位符自然称呼每位订阅者；系统会为每位订阅者替换，绝不能把某人的私密姓名写进面向全部粉丝的文本。",
    mode === "opening" ? "这是首次进入频道显示的一次性开场白，写一条符合人设的开场消息。它不算正式到场或回复，也不要提及已经读到粉丝来信。" : "",
    mode === "birthday" ? "今天是当前订阅者的生日。写一条给订阅者的生日祝福，可以使用 {{nickname}} 占位符。" : "",
    mode === "reply" ? "你看到了若干匿名粉丝来信。可以因此发新消息，也可以选择暂时不公开发消息；没有发消息不表示没看到。" : "",
    mayQuote ? "如果自然合适，可以先模拟一条匿名粉丝留言并引用它，然后再作公开回复。quote 必须有 original 和 translated，两者分别是模拟留言原文和中文翻译。引用只存在于艺人消息里，不要把模拟留言当作用户发言。" : "这轮不要引用粉丝留言，也不要输出 quote。",
    stickers.length ? `本聊天室可发送表情包的名称：${stickers.map(s => s.name).join("、")}。发送时 kind=sticker 且 stickerName 严格使用列表中某个名称，original 填该名称。` : "没有配置表情包，不要发送表情包。",
    "只输出 JSON：{\"publish\":true/false,\"messages\":[{\"kind\":\"text/photo/voice/sticker\",\"original\":\"...\",\"translated\":\"...\",\"quote\":{\"original\":\"...\",\"translated\":\"...\"},\"stickerName\":\"...\",\"photoDescription\":\"...\",\"mediaIntent\":\"selfie/portrait/group/food/scenery/object/pet/other\"}]}。无需 quote 时省略该字段。",
    mode === "opening" || mode === "birthday" ? "publish 必须为 true，写一条消息。" : "可以决定 publish=false 且 messages=[]，这表示艺人暂时没有公开消息。publish=true 时自然发一至三条。",
    "photo 必须填写照片描述，voice 的 original 是逐字稿。",
    `频道最近消息：\n${timeline || "暂无消息"}`,
    fanMessage ? `最近收到的匿名粉丝来信：${fanMessage}` : "",
  ].filter(Boolean).join("\n") };
  const raw = await sendLLMRequest(api, preset, [...prompt, instruction, { role: "user", content: mode === "opening" ? "生成一次性频道开场白。" : mode === "birthday" ? "今天生日，发送一条生日祝福。" : mode === "reply" ? "判断艺人现在是否想公开发消息，如想发请自然回应匿名反馈。" : "判断艺人现在是否想公开发新消息。" }], regexes, { characterName: `LYSN:${character.name}`, userName: "订阅粉丝" }, { appId: "lysn", appTags: ["lysn", "bubble"], skipOutputRegex: true });
  const data = parseJson(raw);
  if (data.publish === false && mode !== "opening" && mode !== "birthday") return [];
  const rows = (Array.isArray(data.messages) ? data.messages : [data]).slice(0, 3).map(item => {
    const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const rawKind = asText(row.kind);
    let kind: GeneratedLysn["kind"] = rawKind === "photo" || rawKind === "voice" || rawKind === "sticker" ? rawKind : "text";
    const sticker = kind === "sticker" ? stickers.find(s => s.name === asText(row.stickerName) || s.name === asText(row.original)) : undefined;
    if (kind === "sticker" && !sticker) kind = "text";
    const original = kind === "sticker" && sticker ? sticker.name : asText(row.original);
    const quoteData = mayQuote && row.quote && typeof row.quote === "object" ? row.quote as Record<string, unknown> : null;
    const quote = quoteData && asText(quoteData.original) ? { original: asText(quoteData.original), translated: asText(quoteData.translated) || asText(quoteData.original) } : undefined;
    return { kind, original, translated: asText(row.translated) || original, quote, stickerName: sticker?.name, photoDescription: asText(row.photoDescription), mediaIntent: ["selfie", "portrait", "group", "food", "scenery", "object", "pet", "other"].includes(asText(row.mediaIntent)) ? asText(row.mediaIntent) as GeneratedLysn["mediaIntent"] : "other" } satisfies GeneratedLysn;
  }).filter(row => row.original);
  if (!rows.length && data.publish !== false) throw new Error("LYSN 没有返回有效正文，请重试。");
  return rows;
}
