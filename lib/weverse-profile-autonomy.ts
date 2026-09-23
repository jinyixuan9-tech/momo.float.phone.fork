import type { Character } from "./character-types";
import type { ChatMessage } from "./chat-storage";
import { getChatImageFromIndexedDB } from "./chat-asset-storage";
import { loadPhotoLibrary } from "./photo-library-storage";
import {
  getWeverseCommunitiesForCharacter,
  loadWeverseState,
  updateWeverseMemberProfile,
  type WeverseCommunity,
  type WeverseMemberProfile,
} from "./weverse-storage";

const WVS_NAME_COOLDOWN_MS = 72 * 60 * 60 * 1000;
const WVS_AVATAR_COOLDOWN_MS = 72 * 60 * 60 * 1000;
const MAX_WVS_AVATAR_CANDIDATES = 10;

function currentUserTurnText(history: ChatMessage[], sessionId: string): string {
  const messages = history.filter((message) => message.sessionId === sessionId);
  const turn: ChatMessage[] = [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "assistant") break;
    if (message.role === "user") turn.unshift(message);
  }
  return turn
    .map((message) => [message.content, message.mediaData?.label].filter(Boolean).join(" "))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isExplicitWeverseProfileRequestTurn(history: ChatMessage[], sessionId: string): boolean {
  const text = currentUserTurnText(history, sessionId);
  if (!text || !/(?:\bwvs\b|weverse|위버스)/i.test(text)) return false;
  return /(?:头像|头图|昵称|网名|显示名|名字|profile|프로필|프사|닉네임)/i.test(text);
}

function cleanSummary(value: unknown, max = 140): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

function buildPhotoSummary(photo: ReturnType<typeof loadPhotoLibrary>["photos"][number], characterId: string): string {
  const mapped = (photo.people || []).find((person) => person.mappedCharacterId === characterId);
  const appearance = mapped?.appearance || photo.appearance;
  return [
    cleanSummary(photo.subject, 60),
    cleanSummary(photo.visionSummary, 110),
    cleanSummary(appearance?.hair, 40),
    cleanSummary(appearance?.outfit, 50),
    cleanSummary(appearance?.accessories, 40),
    cleanSummary(appearance?.scene, 50),
    ...(photo.visionTags || []).slice(0, 5).map((item) => cleanSummary(item, 30)),
  ].filter(Boolean).join(" / ").slice(0, 260);
}

function pickCommunity(characterId: string, communityId?: string, hintText?: string): WeverseCommunity | null {
  const communities = getWeverseCommunitiesForCharacter(characterId);
  if (!communities.length) return null;
  if (communityId) {
    const exact = communities.find((community) => community.id === communityId);
    if (exact) return exact;
  }
  const hint = (hintText || "").toLowerCase();
  if (hint) {
    const named = [...communities]
      .sort((a, b) => b.name.length - a.name.length)
      .find((community) => hint.includes(community.name.toLowerCase()));
    if (named) return named;
  }
  return communities[0];
}

/** 用户在 Chat 推荐一张图片作为 WVS 头像：沿用原头像推荐链，只改变最终落库平台。 */
export function setWeverseMemberAvatarFromRecommendation(
  characterId: string,
  source: string,
  hintText?: string,
): boolean {
  const raw = source.trim();
  if (!raw) return false;
  const community = pickCommunity(characterId, undefined, hintText);
  if (!community) return false;
  updateWeverseMemberProfile(characterId, { avatarUrl: raw }, community.id);
  return true;
}

function parseJsonObject(content: string): Record<string, unknown> | null {
  const trimmed = content.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

async function assetToAvatarDataUrl(assetId: string): Promise<string | null> {
  const source = await getChatImageFromIndexedDB(assetId).catch(() => null);
  if (!source) return null;
  if (typeof document === "undefined" || typeof Image === "undefined") return source;
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      try {
        const maxSize = 640;
        const width = image.naturalWidth || image.width;
        const height = image.naturalHeight || image.height;
        if (!width || !height) { resolve(source); return; }
        const scale = Math.min(1, maxSize / Math.max(width, height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(width * scale));
        canvas.height = Math.max(1, Math.round(height * scale));
        const context = canvas.getContext("2d");
        if (!context) { resolve(source); return; }
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.86));
      } catch {
        resolve(source);
      }
    };
    image.onerror = () => resolve(source);
    image.src = source;
  });
}

/**
 * Chat 中给模型的 WVS 资料行为能力。
 * WVS 本身不承担“聊要不要换资料”的入口；这里只允许通过 Chat 讨论或角色自己低频起意。
 */
export function buildWeverseProfileAutonomyPrompt(
  character: Character,
  options?: { explicitRequest?: boolean },
  now = Date.now(),
): string | null {
  const communities = getWeverseCommunitiesForCharacter(character.id);
  if (!communities.length) return null;
  const explicitRequest = options?.explicitRequest === true;
  const library = loadPhotoLibrary();
  const currentTraits = cleanSummary(library.currentTraitsByCharacter[character.id]?.text, 220);

  const communityLines = communities.map((community) => {
    const profile = community.memberProfiles[character.id];
    const name = profile?.displayName?.trim() || character.name;
    const nameEligible = explicitRequest || !profile?.lastAutonomousNameAt || now - profile.lastAutonomousNameAt >= WVS_NAME_COOLDOWN_MS;
    const avatarEligible = explicitRequest || !profile?.lastAutonomousAvatarAt || now - profile.lastAutonomousAvatarAt >= WVS_AVATAR_COOLDOWN_MS;
    return `- ${community.id} | ${community.name} | 当前昵称：${name} | ${profile?.avatarUrl ? "已有独立 WVS 头像" : "头像回退角色默认"} | 昵称${nameEligible ? "可改" : "冷却中"} / 头像${avatarEligible ? "可改" : "冷却中"}`;
  });

  const anyAvatarEligible = communities.some((community) => {
    const profile = community.memberProfiles[character.id];
    return explicitRequest || !profile?.lastAutonomousAvatarAt || now - profile.lastAutonomousAvatarAt >= WVS_AVATAR_COOLDOWN_MS;
  });
  const photoCandidates = anyAvatarEligible
    ? library.photos
      .filter((photo) => photo.aiUsable && photo.visionStatus === "done" && photo.linkedCharacterIds.includes(character.id) && Boolean(photo.assetId))
      .sort((a, b) => Math.max(b.updatedAt || 0, b.createdAt || 0) - Math.max(a.updatedAt || 0, a.createdAt || 0))
      .slice(0, MAX_WVS_AVATAR_CANDIDATES)
    : [];
  const candidateLines = photoCandidates.map((photo) => `- ${photo.id} | ${buildPhotoSummary(photo, character.id) || "已识别的角色照片"}`);

  return [
    "【WVS 平台资料行为】",
    "WVS 是公开粉丝社区，不是本轮私聊渠道。你可以在 Chat 里聊到自己的 WVS 头像/昵称，并在合适时修改 WVS 资料；修改结果只体现在 WVS，不要改 Character 本体或 Chat Profile。",
    explicitRequest
      ? "本轮用户明确谈到了你的 WVS 头像/昵称。你仍然可以按人设接受、拒绝、暂时不改，或选择你自己更喜欢的方案；用户的建议不是强制命令。"
      : "你拥有偶尔自己心血来潮修改 WVS 头像/昵称的能力，但这是低频公开账号行为。绝大多数普通聊天不要修改，也不要因为看到这段说明就立刻改。",
    "你当前加入的 WVS Community：",
    ...communityLines,
    currentTraits ? `当前外观参考：${currentTraits}` : "当前没有额外外观参考。",
    "如果要改昵称，在自然回复末尾额外输出隐藏动作：[资料更新 \"wvs\"]{\"communityId\":\"目标 Community id\",\"displayName\":\"新昵称\"" + (explicitRequest ? ",\"requested\":true" : "") + "}[/资料更新]。",
    candidateLines.length
      ? [
          "如果要从 Photos 自主挑 WVS 头像，只能选下面真实候选中的 photoId；不要编造素材，也不要为了换头像调用联网、搜索、生图、文件或发送照片工具。",
          ...candidateLines,
          "动作格式：[资料更新 \"wvs\"]{\"communityId\":\"目标 Community id\",\"avatarPhotoId\":\"photoId\"" + (explicitRequest ? ",\"requested\":true" : "") + "}[/资料更新]。",
        ].join("\n")
      : "当前没有可用于自主更换 WVS 头像的真实 Photos 候选；不要输出 avatarPhotoId。",
    "如果用户本轮已经直接发了一张图片推荐作为 WVS 头像，请不要用 avatarPhotoId 绕开推荐图；那一轮走独立的接受/拒绝头像推荐机制。",
    "如果没有真心决定修改 WVS 资料，就不要输出任何 [资料更新 \"wvs\"]。隐藏动作不会展示给用户，不要解释动作标签。",
  ].join("\n");
}

/** 执行模型输出的 WVS Profile 更新。 */
export async function applyAutonomousWeverseProfileAction(characterId: string, content: string): Promise<boolean> {
  const payload = parseJsonObject(content);
  if (!payload) return false;
  const requested = payload.requested === true;
  const community = pickCommunity(
    characterId,
    typeof payload.communityId === "string" ? payload.communityId.trim() : undefined,
  );
  if (!community) return false;

  const currentState = loadWeverseState();
  const currentCommunity = currentState.communities.find((item) => item.id === community.id);
  const profile = currentCommunity?.memberProfiles[characterId];
  const now = Date.now();
  const patch: Partial<Omit<WeverseMemberProfile, "characterId">> = {};

  if (typeof payload.displayName === "string") {
    const nextName = payload.displayName.replace(/\s+/g, " ").trim().slice(0, 40);
    const currentName = profile?.displayName?.trim() || "";
    const cooldownReady = requested || !profile?.lastAutonomousNameAt || now - profile.lastAutonomousNameAt >= WVS_NAME_COOLDOWN_MS;
    if (nextName && nextName !== currentName && cooldownReady) {
      patch.displayName = nextName;
      if (!requested) patch.lastAutonomousNameAt = now;
    }
  }

  if (typeof payload.avatarPhotoId === "string") {
    const requestedId = payload.avatarPhotoId.trim();
    const cooldownReady = requested || !profile?.lastAutonomousAvatarAt || now - profile.lastAutonomousAvatarAt >= WVS_AVATAR_COOLDOWN_MS;
    if (requestedId && cooldownReady) {
      const photo = loadPhotoLibrary().photos.find((item) =>
        item.id === requestedId
        && item.aiUsable
        && item.visionStatus === "done"
        && item.linkedCharacterIds.includes(characterId)
        && Boolean(item.assetId),
      );
      if (photo) {
        const nextAvatar = await assetToAvatarDataUrl(photo.assetId);
        if (nextAvatar && nextAvatar !== profile?.avatarUrl) {
          patch.avatarUrl = nextAvatar;
          if (!requested) patch.lastAutonomousAvatarAt = now;
        }
      }
    }
  }

  if (!Object.keys(patch).length) return false;
  updateWeverseMemberProfile(characterId, patch, community.id);
  return true;
}
