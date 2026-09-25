import { loadCharacters } from "./character-storage";
import { sendLLMRequest } from "./chat-engine";
import { assemblePromptPayload, type LLMMessage } from "./llm-prompt-assembler";
import { loadApiConfigs, loadBindingConfig, loadPresets, loadRegexes, loadWorldBooks, resolveBinding } from "./settings-storage";
import type { RegexConfig, WorldBookConfig } from "./settings-types";
import { buildCharacterTimeContext } from "./character-time";
import { loadLysn, type LysnMessage, type LysnQuote } from "./lysn-storage";
import { lysnAutonomousProfilePrompt } from "./lysn-profile-autonomy";
import { lysnPublicBoundary } from "./lysn-identity";
import { loadPhotoLibrary } from "./photo-library-storage";

export type GeneratedLysn = {
  kind: "text" | "photo" | "voice" | "sticker";
  original: string; translated: string; quote?: LysnQuote; stickerName?: string;
  photoDescription?: string;
  photoId?: string;
  profileUpdate?: { name?: string; avatarPhotoId?: string };
  mediaIntent?: "selfie" | "portrait" | "group" | "food" | "scenery" | "object" | "pet" | "other";
};
function parseJson(raw: string): Record<string, unknown> {
  const start = raw.indexOf("{"); const end = raw.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("LYSN 没有返回有效消息，请重试。");
  return JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
}
const asText = (value: unknown) => typeof value === "string" ? value.trim() : "";
const claimsPhotoSent = (value: string) => /(?:发了|发给|这张|给你看|看看这张|发(?:一张|张|个)?(?:照|图)|照片(?:是|里|给你)|보냈|보내줄|사진.*(?:보여|보내)|here.*(?:photo|pic))/i.test(value);
/** Empty result is a deliberate decision to stay silent, rather than an error. */
export async function generateLysn(characterId: string, history: LysnMessage[], mode: "new" | "reply" | "opening" | "birthday", fanMessage?: string, configuredOpener?: string, birthdayYear?: number): Promise<GeneratedLysn[]> {
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
  const photoChoices = loadPhotoLibrary().photos.filter(p => p.linkedCharacterIds.includes(characterId) && p.aiUsable && p.visionStatus === "done").slice(-20);
  // There is no private Chat history or Chat user identity in this prompt.
  const prompt = assemblePromptPayload({ character, history: [], preset, worldBooks, regexes,
    appId: "lysn", appTags: ["lysn", "bubble"], timeContext: buildCharacterTimeContext(character.timeZone) });
  const timeline = history.slice(-18).map(m => `${m.sender === "fan" ? "匿名粉丝" : m.sender === "artist" ? m.opener ? "频道开场白" : "艺人" : "系统"}: ${m.original}`).join("\n");
  const photoRequest = mode === "reply" && /(?:照片|自拍|图片|发图|发张图|photo|picture|사진|셀카)/i.test(fanMessage || "");
  const quoteTest = mode === "reply" && /(?:引用|测试引用|quote|인용|引用して)/i.test(fanMessage || "");
  const mayQuote = (mode === "new" || mode === "reply") && (quoteTest || Math.random() < ({ rare: .1, normal: .32, often: .7 }[room?.quoteStyle || "normal"]));
  const quotedFan = quoteTest ? [...history].reverse().find(m => m.sender === "fan" && m.kind === "text" && m.original.trim()) : undefined;
  const profilePrompt = mode === "new" || mode === "reply" ? lysnAutonomousProfilePrompt(characterId) : null;
  const instruction: LLMMessage = { role: "system", content: [
    mode === "birthday" ? "你正在写一张仅当前订阅者能看到的 Bubble 生日卡片；这不是公开频道消息，也不进入聊天记录。按你的本来语言写祝福并附中文译文，不要声称知道订阅者真实身份或私下关系。" : "你正在 LYSN Bubble 面向全部订阅者的艺人频道发消息。回复是匿名粉丝反馈，不是与某个人的私聊。绝不识别发送者真实身份、推断私下关系或泄露秘密。",
    lysnPublicBoundary(characterId),
    "自然地按人设发短消息，不要总写公告。original 必须使用角色本人最自然的语言（例如人设为韩国人的角色主要用韩语，日本人的角色主要用日语）；translated 是忠实简体中文翻译，原文中文则相同。语音逐字稿也遵守这一要求，不能因为译文是中文就把原文改成中文。",
    "艺人可以使用 {{nickname}} 占位符自然称呼每位订阅者；系统会为每位订阅者替换，绝不能把某人的私密姓名写进面向全部粉丝的文本。",
    mode === "birthday" ? "生日留言写成适合卡片的一段话，可以亲切但不伪装你和这个订阅者私下相识。" : "频道里的匿名粉丝留言可以作为灵感，但不必一条一条轮流答复；像本人随手分享近况那样，自然时可连发短句，安静时也可不发。别把每次出现都写成有问必答的私聊。",
    mode === "opening" ? configuredOpener ? "这是首次进入频道显示的一次性开场白。用户提供了开场白内容：保持意思和语气，用角色本人自然的语言写 original；用户已用角色语言写成原文时保留原文措辞；translated 是忠实的简体中文翻译。只写一条，不要增添新信息。" : "这是首次进入频道显示的一次性开场白，写一条符合人设的开场消息。它不算正式到场或回复，也不要提及已经读到粉丝来信。" : "",
    mode === "birthday" ? `这是订阅者 ${birthdayYear || "这一"} 年的生日卡片。写一条符合人设的生日祝福，可以使用 {{nickname}} 占位符；不要声称今天就是生日，用户可能在日历回看往年的卡片。` : "",
    mode === "reply" ? "你看到了若干匿名粉丝来信。可以因此发新消息，也可以选择暂时不公开发消息；没有发消息不表示没看到。" : "",
    quoteTest && quotedFan ? `这轮粉丝明确要求测试引用。请引用这条已存在的匿名留言并自然回复，不要编造另一条替代：${quotedFan.original.slice(0, 300)}。只引用文字，不暴露发言者身份；本轮 publish=true，至少一条消息。` : mayQuote ? "如果自然合适，可以先模拟一条匿名粉丝留言并引用它，然后再作公开回复。quote 必须有 original 和 translated，两者分别是模拟留言原文和中文翻译。引用只存在于艺人消息里，不要把模拟留言当作用户发言。" : "这轮不要引用粉丝留言，也不要输出 quote。",
    profilePrompt || "这次不修改资料；即使对话提到了昵称或头像，也不要输出 profileUpdate。你可以自然问问大家的意见。",
    stickers.length ? `本聊天室可发送表情包的名称：${stickers.map(s => s.name).join("、")}。发送时 kind=sticker 且 stickerName 严格使用列表中某个名称，original 填该名称。` : "没有配置表情包，不要发送表情包。",
    photoChoices.length ? `这是已关联到你且可用的相册候选（只允许从中选择）：${photoChoices.map(p => `${p.id}：${[p.subject, p.visionSummary, ...(p.visionTags || [])].filter(Boolean).join("、").slice(0, 95) || "未填写内容"}`).join("；")}。如果你决定现在发一张已有关联照片，输出 kind=photo 并填写准确的 photoId；正文仍按你的语言说，不要因为照片描述是中文就改说中文。不要声称已经发图却只输出文字。` : "当前没有已关联、允许使用且完成识图的角色照片；不要说照片已发出。如果这轮想发图，先按人设解释暂时发不了。",
    photoRequest ? "匿名粉丝正在请求照片。你可以按人设决定发或不发；若你说‘发了、给你看这张’等已经发送的措辞，这一条必须输出 kind=photo，并填写相册中的 photoId。只用文字形容照片不算发送照片。" : "",
    "只输出 JSON：{\"publish\":true/false,\"messages\":[{\"kind\":\"text/photo/voice/sticker\",\"original\":\"...\",\"translated\":\"...\",\"quote\":{\"original\":\"...\",\"translated\":\"...\"},\"stickerName\":\"...\",\"photoId\":\"已关联相册照片ID\",\"photoDescription\":\"...\",\"mediaIntent\":\"selfie/portrait/group/food/scenery/object/pet/other\"}]}。无需 quote 时省略该字段。",
    mode === "opening" || mode === "birthday" || quoteTest && quotedFan ? "publish 必须为 true，写至少一条消息。" : "可以决定 publish=false 且 messages=[]，这表示艺人暂时没有公开消息。publish=true 时自然发一至三条。",
    "photo 必须填写照片描述，voice 的 original 是逐字稿。",
    `频道最近消息：\n${timeline || "暂无消息"}`,
    fanMessage ? `最近收到的匿名粉丝来信：${fanMessage}` : "",
    configuredOpener ? `用户设定的开场白内容（仅作开场白，不是粉丝来信）：${configuredOpener}` : "",
  ].filter(Boolean).join("\n") };
  const messages: LLMMessage[] = [...prompt, instruction, { role: "user", content: mode === "opening" ? configuredOpener ? "按用户设定内容，生成角色语言原文和简体中文译文的开场白。" : "生成一次性频道开场白。" : mode === "birthday" ? "今天生日，发送一条生日祝福。" : mode === "reply" ? "判断艺人现在是否想公开发消息，如想发请自然回应匿名反馈。" : "判断艺人现在是否想公开发新消息。" }];
  const requestMeta = { characterName: `LYSN:${character.name}`, userName: "订阅粉丝" };
  const requestOptions = { appId: "lysn", appTags: ["lysn", "bubble"], skipOutputRegex: true };
  let raw = await sendLLMRequest(api, preset, messages, regexes, requestMeta, requestOptions);
  let data = parseJson(raw);
  const initialRows = Array.isArray(data.messages) ? data.messages as Record<string, unknown>[] : [];
  const promisedPhotoOnly = photoRequest && photoChoices.length > 0 && initialRows.some(row => claimsPhotoSent(asText(row.original)) && !["photo", "image", "picture", "照片", "图片", "사진"].includes(asText(row.kind).toLowerCase()));
  if (promisedPhotoOnly || quoteTest && quotedFan && (data.publish === false || !initialRows.length)) {
    const correction = promisedPhotoOnly ? "你刚才说照片已经发出，却只输出文字。请重新输出 JSON：若确实要发，必须有 kind=photo 和候选列表中的 photoId；否则明确说暂时不能发，不要假装已经发出。" : "粉丝明确要求测试引用，但你刚才没有发消息。请写一条自然回复，并引用最近这条已有的匿名粉丝留言。";
    raw = await sendLLMRequest(api, preset, [...messages, { role: "assistant", content: raw }, { role: "user", content: correction }], regexes, requestMeta, requestOptions);
    data = parseJson(raw);
  }
  if (data.publish === false && mode !== "opening" && mode !== "birthday" && !(quoteTest && quotedFan)) return [];
  const rows: GeneratedLysn[] = (Array.isArray(data.messages) ? data.messages : [data]).slice(0, 3).map((item, index) => {
    const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const rawKind = asText(row.kind);
    let kind: GeneratedLysn["kind"] = ["photo", "image", "picture", "照片", "图片", "사진"].includes(rawKind.toLowerCase()) ? "photo" : rawKind === "voice" || rawKind === "sticker" ? rawKind : "text";
    const sticker = kind === "sticker" ? stickers.find(s => s.name === asText(row.stickerName) || s.name === asText(row.original)) : undefined;
    if (kind === "sticker" && !sticker) kind = "text";
    const original = kind === "sticker" && sticker ? sticker.name : asText(row.original);
    const quoteData = mayQuote && row.quote && typeof row.quote === "object" ? row.quote as Record<string, unknown> : null;
    const quote = quoteTest && quotedFan ? index === 0 ? { original: quotedFan.original, translated: quotedFan.translated || quotedFan.original } : undefined : quoteData && asText(quoteData.original) ? { original: asText(quoteData.original), translated: asText(quoteData.translated) || asText(quoteData.original) } : undefined;
    const chosenPhotoId = photoChoices.some(p => p.id === asText(row.photoId)) ? asText(row.photoId) : undefined;
    if (kind === "text" && photoRequest && chosenPhotoId && claimsPhotoSent(original)) kind = "photo";
    return { kind, original, translated: asText(row.translated) || original, quote, stickerName: sticker?.name, photoId: chosenPhotoId, photoDescription: asText(row.photoDescription), mediaIntent: ["selfie", "portrait", "group", "food", "scenery", "object", "pet", "other"].includes(asText(row.mediaIntent)) ? asText(row.mediaIntent) as GeneratedLysn["mediaIntent"] : "other" } satisfies GeneratedLysn;
  }).filter(row => row.original);
  if (photoRequest && photoChoices.length && rows.some(row => row.kind === "text" && claimsPhotoSent(row.original)) && !rows.some(row => row.kind === "photo")) throw new Error("艺人只描述了照片，没有真正发出图片；这次未发送虚假的照片消息，请重试。");
  if (quoteTest && quotedFan && rows.length && !rows.some(row => row.quote)) rows[0].quote = { original: quotedFan.original, translated: quotedFan.translated || quotedFan.original };
  if (!rows.length && (data.publish !== false || quoteTest && quotedFan)) throw new Error("LYSN 没有返回有效正文，请重试。");
  if (rows.length && profilePrompt && data.profileUpdate && typeof data.profileUpdate === "object") {
    const proposed = data.profileUpdate as Record<string, unknown>;
    const name = typeof proposed.name === "string" ? proposed.name.trim().slice(0, 40) : undefined;
    const avatarPhotoId = typeof proposed.avatarPhotoId === "string" ? proposed.avatarPhotoId.trim() : undefined;
    if (name || avatarPhotoId) rows[0].profileUpdate = { name, avatarPhotoId };
  }
  return rows;
}
