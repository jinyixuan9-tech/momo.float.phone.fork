import { getChatImageFromIndexedDB, saveChatImageToIndexedDB } from "./chat-asset-storage";
import { generateImageFromConfiguredApi } from "./image-generation-service";
import { getPhotoResolverDebugEnabled, getPhotoSourceStrategy, recordPhotoUse, resolvePhotoForUse } from "./photo-library-resolver";
import { loadPhotoLibrary } from "./photo-library-storage";
import type { PhotoRecord, PhotoUsageChannel } from "./photo-library-types";

export type MediaIntentKind = "selfie" | "portrait" | "group" | "food" | "scenery" | "object" | "pet" | "official" | "other";

export type CharacterMediaActor = {
  type: "character";
  characterId: string;
  /** 可选平台专用公开素材池；传入时只允许从这些 Photos photoId 中匹配。 */
  photoIds?: string[];
};

export type OfficialMediaActor = {
  type: "official";
  officialId: string;
  photoIds: string[];
  /** WVS 已经公开用过的官方素材；用于避免官号重复把旧图当新图。 */
  excludedPhotoIds?: string[];
  /** Official 生成时若模型明确从媒体池看中了某一张，可以优先命中它。 */
  preferredPhotoId?: string;
};

export type MediaResolverRequest = {
  actor: CharacterMediaActor | OfficialMediaActor;
  description: string;
  intentKind?: MediaIntentKind;
  channel: PhotoUsageChannel;
  targetId?: string;
  appId: string;
};

export type MediaResolverResult = {
  imageUrl?: string;
  /** 允许生图但当前未配置/调用失败时，沿用 Float 文字图片兜底。 */
  placeholderDescription?: string;
  source: "album" | "generated" | "text_placeholder";
  photoLibraryId?: string;
  debug?: {
    strategy: string;
    intentKind: MediaIntentKind;
    reason: string;
    albumReasons?: string[];
  };
};

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "")
    .replace(/照片|图片|一张|拍一下|拍了|发一下|发给我|给我看/g, "");
}

function bigrams(value: string): Set<string> {
  const normalized = normalizeText(value);
  const set = new Set<string>();
  for (let i = 0; i < normalized.length - 1; i += 1) set.add(normalized.slice(i, i + 2));
  for (const token of value.toLowerCase().match(/[a-z0-9]{2,}/g) || []) set.add(token);
  return set;
}

function similarity(a: string, b: string): number {
  if (!a.trim() || !b.trim()) return 0;
  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (na && nb && (na.includes(nb) || nb.includes(na))) return 1;
  const aa = bigrams(a);
  const bb = bigrams(b);
  if (!aa.size || !bb.size) return 0;
  let hit = 0;
  aa.forEach((token) => { if (bb.has(token)) hit += 1; });
  return hit / Math.max(2, Math.min(aa.size, bb.size));
}

function photoText(photo: PhotoRecord): string {
  return [
    photo.subject,
    photo.visionSummary,
    photo.appearance?.hair,
    photo.appearance?.accessories,
    photo.appearance?.outfit,
    photo.appearance?.season,
    photo.appearance?.scene,
    ...(photo.visionTags || []),
  ].filter(Boolean).join(" ");
}

async function resolveCharacterPoolPhoto(request: MediaResolverRequest & { actor: CharacterMediaActor }): Promise<{ photo: PhotoRecord; dataUrl: string; score: number } | null> {
  const ids = request.actor.photoIds;
  if (!ids) return null;
  const allowed = new Set(ids);
  if (!allowed.size) return null;
  const candidates = loadPhotoLibrary().photos
    .filter((photo) => allowed.has(photo.id))
    .filter((photo) => photo.aiUsable && photo.visionStatus === "done")
    .map((photo) => ({ photo, score: similarity(request.description, photoText(photo)) }))
    .sort((a, b) => b.score - a.score);
  const best = candidates[0];
  if (!best || best.score < 0.13) return null;
  const dataUrl = await getChatImageFromIndexedDB(best.photo.assetId).catch(() => null);
  if (!dataUrl) return null;
  return { photo: best.photo, dataUrl, score: best.score };
}

async function resolveOfficialPoolPhoto(request: MediaResolverRequest & { actor: OfficialMediaActor }): Promise<{ photo: PhotoRecord; dataUrl: string; score: number } | null> {
  const allowed = new Set(request.actor.photoIds);
  const excluded = new Set(request.actor.excludedPhotoIds || []);
  const all = loadPhotoLibrary().photos;
  const preferred = request.actor.preferredPhotoId
    ? all.find((photo) => photo.id === request.actor.preferredPhotoId && allowed.has(photo.id) && !excluded.has(photo.id) && photo.aiUsable && photo.visionStatus === "done")
    : undefined;
  if (preferred) {
    const dataUrl = await getChatImageFromIndexedDB(preferred.assetId).catch(() => null);
    if (dataUrl) return { photo: preferred, dataUrl, score: 1 };
  }
  const candidates = all
    .filter((photo) => allowed.has(photo.id))
    .filter((photo) => !excluded.has(photo.id))
    .filter((photo) => photo.aiUsable && photo.visionStatus === "done")
    .map((photo) => ({ photo, score: similarity(request.description, photoText(photo)) }))
    .sort((a, b) => b.score - a.score);
  const best = candidates[0];
  if (!best || best.score < 0.13) return null;
  const dataUrl = await getChatImageFromIndexedDB(best.photo.assetId).catch(() => null);
  if (!dataUrl) return null;
  return { photo: best.photo, dataUrl, score: best.score };
}

function shouldGenerateInSmartMode(intentKind: MediaIntentKind): boolean {
  // 人物中心内容优先尊重真实相册，不匹配时宁可不挂图；生活物件/食物/风景允许补生图。
  return !["selfie", "portrait", "group"].includes(intentKind);
}

async function generateMedia(request: MediaResolverRequest, intentKind: MediaIntentKind): Promise<MediaResolverResult | null> {
  const characterId = request.actor.type === "character" ? request.actor.characterId : undefined;
  const generated = await generateImageFromConfiguredApi({
    description: request.description,
    characterId,
    appId: request.appId,
    useReferenceImage: request.actor.type === "character" && ["selfie", "portrait", "group"].includes(intentKind),
  }).catch(() => null);
  if (!generated) {
    return {
      source: "text_placeholder",
      placeholderDescription: request.description,
      debug: getPhotoResolverDebugEnabled() ? {
        strategy: getPhotoSourceStrategy(request.appId === "weverse" ? "wvs" : "other"),
        intentKind,
        reason: "当前策略允许生图，但未获得真实生成图片；回退为 Float 文字图片。",
      } : undefined,
    };
  }
  const assetId = await saveChatImageToIndexedDB(generated.blob).catch(() => "");
  if (!assetId) return null;
  return {
    imageUrl: `asset://${assetId}`,
    source: "generated",
    debug: getPhotoResolverDebugEnabled() ? {
      strategy: getPhotoSourceStrategy(request.appId === "weverse" ? "wvs" : "other"),
      intentKind,
      reason: "素材池未找到合适图片，按智能规则进入生图。",
    } : undefined,
  };
}

/**
 * 统一媒体解析入口 v1。
 * App 只告诉它“谁要发、想发什么、在哪发”，不自己决定相册还是生图。
 */
export async function resolveMediaForUse(request: MediaResolverRequest): Promise<MediaResolverResult | null> {
  const description = request.description.trim();
  if (!description) return null;
  const strategy = getPhotoSourceStrategy(request.appId === "weverse" ? "wvs" : "other");
  const intentKind = request.intentKind || "other";
  const debugEnabled = getPhotoResolverDebugEnabled();

  if (strategy !== "generated_only") {
    if (request.actor.type === "character") {
      if (request.actor.photoIds) {
        const poolMatch = await resolveCharacterPoolPhoto(request as MediaResolverRequest & { actor: CharacterMediaActor }).catch(() => null);
        if (poolMatch) {
          return {
            imageUrl: `asset://${poolMatch.photo.assetId}`,
            source: "album",
            photoLibraryId: poolMatch.photo.id,
            debug: debugEnabled ? { strategy, intentKind, reason: `命中 WVS 角色公开素材池（匹配 ${poolMatch.score.toFixed(2)}）。` } : undefined,
          };
        }
      } else {
        const match = await resolvePhotoForUse({
          characterId: request.actor.characterId,
          description,
          channel: request.channel,
          targetId: request.targetId,
        }).catch(() => null);
        if (match) {
          recordPhotoUse(match, {
            characterId: request.actor.characterId,
            description,
            channel: request.channel,
            targetId: request.targetId,
          });
          return {
            imageUrl: `asset://${match.photo.assetId}`,
            source: "album",
            photoLibraryId: match.photo.id,
            debug: debugEnabled ? {
              strategy,
              intentKind,
              reason: "命中角色素材池。",
              albumReasons: match.reasons,
            } : undefined,
          };
        }
      }
    } else {
      const match = await resolveOfficialPoolPhoto(request as MediaResolverRequest & { actor: OfficialMediaActor }).catch(() => null);
      if (match) {
        return {
          imageUrl: `asset://${match.photo.assetId}`,
          source: "album",
          photoLibraryId: match.photo.id,
          debug: debugEnabled ? {
            strategy,
            intentKind,
            reason: `命中 WVS 官号媒体池（匹配 ${match.score.toFixed(2)}）。`,
          } : undefined,
        };
      }
    }
  }

  if (strategy === "album_only") return null;
  if (strategy === "album_then_generated" && !shouldGenerateInSmartMode(intentKind)) return null;
  return generateMedia(request, intentKind);
}
