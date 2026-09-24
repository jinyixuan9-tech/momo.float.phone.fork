import type { Character } from "./character-types";
import type { ChatMessage } from "./chat-storage";
import { loadPhotoLibrary } from "./photo-library-storage";
import { getChatImageFromIndexedDB, saveChatImageToIndexedDB } from "./chat-asset-storage";
import { appendLysn, loadLysn, saveLysn } from "./lysn-storage";

const COOLDOWN = 72 * 60 * 60 * 1000;
export function explicitLysnProfileRequest(history: ChatMessage[], sessionId: string): boolean {
  const turns = history.filter(x => x.sessionId === sessionId);
  const recent: ChatMessage[] = [];
  for (let i = turns.length - 1; i >= 0; i--) { if (turns[i].role === "assistant") break; if (turns[i].role === "user") recent.unshift(turns[i]); }
  const text = recent.map(x => x.content).join(" ");
  return /(?:lysn|bubble|泡泡)/i.test(text) && /(?:头像|昵称|名字|显示名|profile|프사|닉네임)/i.test(text);
}
export function lysnProfilePrompt(character: Character, requested = false): string | null {
  const state = loadLysn();
  if (!state.subscribedIds.includes(character.id)) return null;
  const profile = state.profiles[character.id];
  const eligible = requested || !profile?.updatedAt || Date.now() - profile.updatedAt > COOLDOWN;
  const candidates = loadPhotoLibrary().photos.filter(x => x.linkedCharacterIds.includes(character.id) && x.aiUsable && x.visionStatus === "done").slice(-10).map(x => `${x.id}: ${x.subject || x.visionSummary || "角色照片"}`);
  return ["【LYSN 资料行为】LYSN/Bubble 是订阅粉丝频道，资料独立于 Chat/WVS。", `当前昵称：${profile?.name || character.name}；头像：${profile?.avatar ? "已设置" : "使用默认头像"}。`, requested ? "用户这轮推荐你换 LYSN 昵称或头像，你可以接受、拒绝或提出自己的想法，不是强制修改。" : eligible ? "你偶尔可以自己决定更改 LYSN 资料，但一般聊天不要改。" : "近期刚改过 LYSN 资料，暂不自主重复更改。", eligible ? `如果真的决定换昵称，附隐藏动作：[资料更新 "lysn"]{"name":"新昵称","requested":${requested}}[/资料更新]。` : "", candidates.length && eligible ? `如果决定从 Photos 中自主挑头像，限以下真实素材：${candidates.join("；")}。动作：[资料更新 "lysn"]{"avatarPhotoId":"已有 photoId","requested":${requested}}[/资料更新]。` : "", "若本轮用户直接发图推荐头像，使用已有头像推荐接受/拒绝机制，别另选相册图。若没有决定修改，就不要输出资料更新动作。"].filter(Boolean).join("\n");
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
