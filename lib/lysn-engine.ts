import { loadCharacters } from "./character-storage";
import { sendLLMRequest } from "./chat-engine";
import { assemblePromptPayload, type LLMMessage } from "./llm-prompt-assembler";
import { loadApiConfigs, loadBindingConfig, loadPresets, loadRegexes, loadWorldBooks, resolveBinding } from "./settings-storage";
import type { RegexConfig, WorldBookConfig } from "./settings-types";
import { buildCharacterTimeContext } from "./character-time";
import type { LysnMessage } from "./lysn-storage";

type Generated = { kind: "text" | "photo" | "voice"; original: string; translated: string; photoDescription?: string; mediaIntent?: "selfie" | "portrait" | "group" | "food" | "scenery" | "object" | "pet" | "other" };
function parseJson(raw: string): Record<string, unknown> {
  const start = raw.indexOf("{"); const end = raw.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("LYSN 没有返回有效消息，请重试。");
  return JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
}
export async function generateLysn(characterId: string, history: LysnMessage[], mode: "new" | "reply", fanMessage?: string): Promise<Generated> {
  const character = loadCharacters().find(c => c.id === characterId);
  if (!character) throw new Error("角色已不存在。");
  const slot = resolveBinding(loadBindingConfig(), characterId, "lysn");
  const api = loadApiConfigs().find(x => x.id === slot.apiConfigId) || loadApiConfigs()[0];
  if (!api) throw new Error("请先为 LYSN 配置可用的文字 API。");
  const presets = loadPresets();
  const preset = presets.find(x => x.id === slot.presetId) || presets.find(x => x.builtIn) || null;
  const worldBooks = (slot.worldBookIds || []).map(id => loadWorldBooks().find(x => x.id === id)).filter(Boolean) as WorldBookConfig[];
  const regexes = (slot.regexIds || []).map(id => loadRegexes().find(x => x.id === id)).filter(Boolean) as RegexConfig[];
  // LYSN deliberately has no private Chat history or Chat user identity in its prompt.
  const prompt = assemblePromptPayload({ character, history: [], preset, worldBooks, regexes,
    appId: "lysn", appTags: ["lysn", "bubble"], timeContext: buildCharacterTimeContext(character.timeZone) });
  const timeline = history.slice(-18).map(m => `${m.sender === "fan" ? "订阅粉丝" : m.sender === "artist" ? "艺人" : "系统"}: ${m.original}`).join("\n");
  const instruction: LLMMessage = { role: "system", content: [
    "你正在 LYSN 的 Bubble 订阅频道给粉丝发消息。这是面向所有订阅粉丝的艺人频道，不是你和某个人的私人 Chat。",
    "订阅粉丝可以回复，但你看到的是匿名粉丝反馈；即使现实中认识这个人，也不能由此认定这条消息是对方发的，不能泄露私下关系、昵称或秘密。",
    "自然地写符合本人语言习惯的短消息，不要每次像营业公告。只在适合时发送照片或语音。",
    "original 使用角色实际说话的语言；translated 提供简体中文忠实翻译，原文是中文时两项相同。不要翻译系统状态。",
    "只输出 JSON：{\"kind\":\"text/photo/voice\",\"original\":\"...\",\"translated\":\"...\",\"photoDescription\":\"想发的照片内容或空\",\"mediaIntent\":\"selfie/portrait/group/food/scenery/object/pet/other\"}。",
    "kind=photo 时必须填 photoDescription；kind=voice 时正文就是适合直接读出的逐字稿；没合适照片就发文字。",
    `频道最近消息：\n${timeline || "暂无消息"}`,
    fanMessage ? `最近收到的一条匿名粉丝回复：${fanMessage}` : "",
  ].filter(Boolean).join("\n") };
  const raw = await sendLLMRequest(api, preset, [...prompt, instruction, { role: "user", content: mode === "reply" ? "根据粉丝反馈，自然发出下一条面向所有订阅粉丝的消息。" : "发一条新的 Bubble 消息。" }], regexes, { characterName: `LYSN:${character.name}`, userName: "订阅粉丝" }, { appId: "lysn", appTags: ["lysn", "bubble"], skipOutputRegex: true });
  const data = parseJson(raw);
  const original = String(data.original || "").trim();
  if (!original) throw new Error("LYSN 没有返回有效正文，请重试。");
  const kind = data.kind === "photo" || data.kind === "voice" ? data.kind : "text";
  return { kind, original, translated: String(data.translated || original).trim(), photoDescription: String(data.photoDescription || "").trim(), mediaIntent: ["selfie", "portrait", "group", "food", "scenery", "object", "pet", "other"].includes(String(data.mediaIntent)) ? data.mediaIntent as Generated["mediaIntent"] : "other" };
}
