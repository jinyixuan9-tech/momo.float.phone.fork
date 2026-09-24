import type { Character } from "./character-types";
import type { ChatMessage } from "./chat-storage";
import { loadPhotoLibrary } from "./photo-library-storage";
import { getChatImageFromIndexedDB, saveChatImageToIndexedDB } from "./chat-asset-storage";
import { appendLysn, loadLysn, saveLysn } from "./lysn-storage";

const COOLDOWN = 14 * 24 * 60 * 60 * 1000;
export function explicitLysnProfileRequest(history: ChatMessage[], sessionId: string): boolean {
  const turns = history.filter(x => x.sessionId === sessionId);
  const recent: ChatMessage[] = [];
  for (let i = turns.length - 1; i >= 0; i--) { if (turns[i].role === "assistant") break; if (turns[i].role === "user") recent.unshift(turns[i]); }
  const text = recent.map(x => x.content).join(" ");
  // A conversation about a profile is not an instruction to change it now.
  return /(?:lysn|bubble|泡泡)/i.test(text)
    && /(?:头像|昵称|名字|显示名|profile|프사|닉네임)/i.test(text)
    && /(?:给我|帮我|请你|把|让你|现在|直接|立刻|马上).{0,32}(?:lysn|bubble|泡泡).{0,24}(?:头像|昵称|显示名|名字).{0,16}(?:换成|改成|设为|设置为|用这张|更换|修改)|(?:lysn|bubble|泡泡).{0,24}(?:头像|昵称|显示名|名字).{0,16}(?:现在|直接|立刻|马上).{0,12}(?:换成|改成|设为|用这张)/i.test(text);
}
export function lysnProfilePrompt(character: Character, requested = false): string | null {
  const state = loadLysn();
  if (!state.subscribedIds.includes(character.id)) return null;
  const profile = state.profiles[character.id];
  const eligible = requested || ((!profile?.updatedAt || Date.now() - profile.updatedAt > COOLDOWN) && Math.random() < 0.015);
  const candidates = loadPhotoLibrary().photos.filter(x => x.linkedCharacterIds.includes(character.id) && x.aiUsable && x.visionStatus === "done").slice(-10).map(x => `${x.id}: ${x.subject || x.visionSummary || "角色照片"}`);
  return ["【LYSN 资料行为】LYSN/Bubble 是订阅粉丝频道，资料独立于 Chat/WVS。", `当前昵称：${profile?.name || character.name}；头像：${profile?.avatar ? "已设置" : "使用默认头像"}。`, requested ? "用户明确要求现在修改 LYSN 资料。你可以接受、拒绝或先讨论，不是强制修改。" : eligible ? "你偶尔可以自己决定更改 LYSN 资料，但一般聊天不要改；谈到资料或询问意见不等于已经决定更换。" : "你可以自然讨论或询问头像昵称，但这轮不要立刻修改。", eligible ? `如果真的决定换昵称，附隐藏动作：[资料更新 "lysn"]{"name":"新昵称","requested":${requested}}[/资料更新]。` : "", candidates.length && eligible ? `如果决定从 Photos 中自主挑头像，限以下真实素材：${candidates.join("；")}。动作：[资料更新 "lysn"]{"avatarPhotoId":"已有 photoId","requested":${requested}}[/资料更新]。` : "", "若本轮用户直接发图推荐头像，使用已有头像推荐接受/拒绝机制，别另选相册图。若没有决定修改，就不要输出资料更新动作。"].filter(Boolean).join("\n");
}
/** A rare independent choice; mentioning a profile in a fan message never grants permission. */
export function lysnAutonomousProfilePrompt(characterId: string): string | null {
  const state = loadLysn();
  if (!state.subscribedIds.includes(characterId)) return null;
  const profile = state.profiles[characterId];
  if (profile?.updatedAt && Date.now() - profile.updatedAt < COOLDOWN) return null;
  if (Math.random() >= 0.04) return null;
  const photos = loadPhotoLibrary().photos
    .filter(photo => photo.linkedCharacterIds.includes(characterId) && photo.aiUsable && photo.visionStatus === "done")
    .slice(-8);
  return [
    "这是一次很偶然的自主资料选择机会，不需要更换也不应为了使用功能而更换。粉丝提到头像或昵称，只能算聊天话题，不构成修改指令。",
    `当前公开昵称：${profile?.name || "未设置"}；${profile?.avatar ? "已有头像" : "使用默认头像"}。`,
    photos.length ? `如果你自己真想换头像，只能从以下关联 Photos 照片选 avatarPhotoId：${photos.map(photo => `${photo.id}（${photo.subject || photo.visionSummary || "照片"}）`).join("、")}。` : "目前没有可选的关联照片，不要提出更换头像动作。",
    "如独立决定改变，顶层 JSON 可附 profileUpdate，格式为 {\"name\":\"新昵称\"} 或 {\"avatarPhotoId\":\"列表中的照片 ID\"}；否则省略。询问粉丝意见时先正常说话，不能同时修改。",
  ].join("\n");
}
export async function setLysnAvatarFromRecommendation(characterId: string, source: string): Promise<boolean> {
  if (!source) return false;
  let avatar = source;
  if (source.startsWith("data:")) {
    try { const blob = await (await fetch(source)).blob(); const id = await saveChatImageToIndexedDB(blob); avatar = `asset://${id}`; } catch { /* use source */ }
  }
  const state = loadLysn();
  const previous = state.profiles[characterId];
  state.profiles[characterId] = { ...previous, name: previous?.name || "", avatar, updatedAt: Date.now() };
  saveLysn(state);
  appendLysn(characterId, [{ sender: "system", kind: "notice", original: "艺人更换了 LYSN 头像" }]);
  return true;
}
export async function applyLysnProfileAction(characterId: string, content: string): Promise<boolean> {
  let value: Record<string, unknown>;
  try { value = JSON.parse(content) as Record<string, unknown>; } catch { return false; }
  const state = loadLysn();
  if (!state.subscribedIds.includes(characterId)) return false;
  const current = state.profiles[characterId] || { name: "", avatar: "", updatedAt: 0 };
  if (value.requested !== true && Date.now() - current.updatedAt < COOLDOWN) return false;
  let name = current.name; let avatar = current.avatar;
  if (typeof value.name === "string") name = value.name.trim().slice(0, 40) || name;
  if (typeof value.avatarPhotoId === "string") {
    const photo = loadPhotoLibrary().photos.find(x => x.id === value.avatarPhotoId && x.linkedCharacterIds.includes(characterId) && x.aiUsable && x.visionStatus === "done");
    if (photo && await getChatImageFromIndexedDB(photo.assetId).catch(() => null)) avatar = `asset://${photo.assetId}`;
  }
  if (name === current.name && avatar === current.avatar) return false;
  state.profiles[characterId] = { ...current, name, avatar, updatedAt: Date.now() };
  saveLysn(state);
  appendLysn(characterId, [{ sender: "system", kind: "notice", original: avatar !== current.avatar ? "艺人更换了 LYSN 头像" : "艺人更换了 LYSN 昵称" }]);
  return true;
}
