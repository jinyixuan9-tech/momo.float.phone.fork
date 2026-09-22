import { getChatImageFromIndexedDB } from "./chat-asset-storage";
import { sendLLMRequest } from "./chat-engine";
import { loadCharacters } from "./character-storage";
import { loadApiConfigs, loadBindingConfig, resolveBinding } from "./settings-storage";
import {
  appendPhotoUsage,
  loadPhotoLibrary,
} from "./photo-library-storage";
import type { PhotoRecord, PhotoSourceStrategy, PhotoUsageChannel } from "./photo-library-types";
import { appearanceToText, photoTraitsTextForCharacter } from "./photo-library-vision";

export type PhotoResolverRequest = {
  characterId: string;
  description: string;
  channel: PhotoUsageChannel;
  targetId?: string;
};

export type PhotoResolverMatch = {
  photo: PhotoRecord;
  dataUrl: string;
  score: number;
  reasons: string[];
};

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/浅金色|奶金色?|灰金色?|金黄色?|金色/g, "金发")
    .replace(/黑色(?=(?:短|长|中|卷|直)?发)/g, "黑")
    .replace(/红色(?=(?:短|长|中|卷|直)?发)/g, "红")
    .replace(/夏装|夏季/g, "夏天")
    .replace(/冬装|冬季/g, "冬天")
    .replace(/[\s\p{P}\p{S}]+/gu, "")
    .replace(/照片|图片|一张|拍一下|拍了|发给我|给我看/g, "");
}

function textFeatures(value: string): Set<string> {
  const normalized = normalizeText(value);
  const result = new Set<string>();
  const latin = value.toLowerCase().match(/[a-z0-9]{2,}/g) ?? [];
  latin.forEach((item) => result.add(item));
  for (let index = 0; index < normalized.length - 1; index += 1) {
    const pair = normalized.slice(index, index + 2);
    if ([...pair].some((item) => /\p{Script=Han}/u.test(item))) result.add(pair);
  }
  return result;
}

function similarity(a: string, b: string): number {
  if (!a.trim() || !b.trim()) return 0;
  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (na && nb && (na.includes(nb) || nb.includes(na))) return 1;
  const aa = textFeatures(a);
  const bb = textFeatures(b);
  if (aa.size === 0 || bb.size === 0) return 0;
  let overlap = 0;
  for (const token of aa) if (bb.has(token)) overlap += token.length > 1 ? 2 : 1;
  const denom = Math.max(3, Math.min([...aa].reduce((sum, item) => sum + (item.length > 1 ? 2 : 1), 0), 18));
  return Math.min(1, overlap / denom);
}

function photoSearchText(photo: PhotoRecord, characterId: string): string {
  const mappedAppearance = photoTraitsTextForCharacter(photo, characterId);
  const peopleText = (photo.people ?? []).map((person) => [
    person.position,
    appearanceToText(person.appearance),
  ].filter(Boolean).join(" ")).join(" ");
  return [
    photo.visionSummary,
    photo.subject,
    mappedAppearance,
    appearanceToText(photo.appearance),
    peopleText,
    ...(photo.visionTags ?? []),
  ].filter(Boolean).join(" ");
}

function isCurrentIntent(description: string): boolean {
  return /(?:刚刚|刚拍|现在|今天|今晚|此刻|现在的|今天的|刚才|current|today|now)/i.test(description);
}

function isPastIntent(description: string): boolean {
  return /(?:以前|之前|那时候|当时|旧照|旧照片|回忆|从前|过去|翻到|以前的|past|old photo)/i.test(description);
}

function scorePhoto(photo: PhotoRecord, request: PhotoResolverRequest): { score: number; reasons: string[] } {
  const state = loadPhotoLibrary();
  const search = photoSearchText(photo, request.characterId);
  const semantic = similarity(request.description, search);
  let score = semantic * 10;
  const reasons = [`内容匹配 ${semantic.toFixed(2)}`];
  const wanted = normalizeText(request.description);
  const directTerms = [photo.subject, ...(photo.visionTags ?? [])].filter((item): item is string => Boolean(item));
  const directMatches = directTerms.filter((term) => {
    const normalized = normalizeText(term);
    return normalized.length > 0 && (wanted.includes(normalized) || normalized.includes(wanted));
  });
  if (directMatches.length > 0) {
    score += Math.min(6, 3 + directMatches.length);
    reasons.push(`直接标签：${directMatches.slice(0, 3).join("、")}`);
  }

  // 已公开朋友圈的照片默认不再当“新图”私聊发给 user；朋友圈自己则不重复发同图。
  const hasMomentUse = photo.usageHistory.some((item) => item.characterId === request.characterId && item.channel === "moments");
  const hasWvsUse = photo.usageHistory.some((item) => item.characterId === request.characterId && item.channel === "wvs");
  const hasPublicUse = hasMomentUse || hasWvsUse;
  const hasDmUse = photo.usageHistory.some((item) => item.characterId === request.characterId && item.channel === "dm_user" && (!request.targetId || item.targetId === request.targetId));
  if (request.channel === "dm_user" && hasPublicUse) {
    score -= 100;
    reasons.push("已公开发布，排除主动私发");
  }
  if (request.channel === "moments" && hasMomentUse) {
    score -= 100;
    reasons.push("朋友圈已用过，排除重复");
  }
  if (request.channel === "wvs" && hasWvsUse) {
    score -= 100;
    reasons.push("Weverse 已用过，排除重复");
  }
  if (request.channel === "dm_user" && hasDmUse) {
    score -= 3.5;
    reasons.push("曾私发过，降权");
  }

  const current = state.currentTraitsByCharacter[request.characterId]?.text?.trim() || "";
  if (current) {
    const photoTraits = photoTraitsTextForCharacter(photo, request.characterId);
    const hasUnmappedMultiPeople = (photo.people ?? []).length > 1
      && !(photo.people ?? []).some((person) => person.mappedCharacterId === request.characterId);
    const currentSim = hasUnmappedMultiPeople ? 0 : similarity(current, photoTraits || search);
    if (isCurrentIntent(request.description)) {
      score += currentSim * 7;
      if (currentSim < 0.16) score -= 4;
      reasons.push(`当前特征 ${currentSim.toFixed(2)}（当前图意图）`);
    } else if (isPastIntent(request.description)) {
      score += (1 - currentSim) * 3;
      reasons.push(`当前特征 ${currentSim.toFixed(2)}（旧照意图）`);
    } else {
      score += currentSim * 2;
      reasons.push(`当前特征 ${currentSim.toFixed(2)}`);
    }
  } else {
    reasons.push("未设置当前特征，不限制时期");
  }

  return { score, reasons };
}

export function getPhotoSourceStrategy(_context: "chat" | "moments" | "wvs" | "bubble" | "sms" | "other"): PhotoSourceStrategy {
  const preferences = loadPhotoLibrary().preferences;
  // v0.3.4：改为一个统一媒体策略。旧 chat/moments 字段只做数据迁移兼容。
  return preferences.mediaStrategy || preferences.chatStrategy || preferences.momentsStrategy || "album_then_generated";
}

export function getPhotoResolverDebugEnabled(): boolean {
  return loadPhotoLibrary().preferences.resolverDebug === true;
}

export async function resolvePhotoForUse(request: PhotoResolverRequest): Promise<PhotoResolverMatch | null> {
  const photos = loadPhotoLibrary().photos
    .filter((photo) => photo.aiUsable)
    .filter((photo) => photo.linkedCharacterIds.includes(request.characterId))
    .filter((photo) => photo.visionStatus === "done");
  if (photos.length === 0) return null;

  const scored = photos
    .map((photo) => ({ photo, ...scorePhoto(photo, request) }))
    .filter((item) => item.score > -50)
    .sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best) return null;

  // 第一版阈值故意偏保守：宁可判“没合适图”，也不要硬塞错图。
  // 直接词/场景匹配通常能超过 1.4；完全无关图片只靠零碎汉字不会过线。
  if (best.score < 1.4) return null;
  const dataUrl = await getChatImageFromIndexedDB(best.photo.assetId).catch(() => null);
  if (!dataUrl) return null;
  return { photo: best.photo, dataUrl, score: best.score, reasons: best.reasons };
}

export function recordPhotoUse(match: PhotoResolverMatch, request: PhotoResolverRequest): void {
  appendPhotoUsage(match.photo.id, {
    channel: request.channel,
    characterId: request.characterId,
    targetId: request.targetId,
    usedAt: Date.now(),
  });
}

export async function generateAlbumNoMatchReply(characterId: string, wantedDescription: string): Promise<string> {
  const character = loadCharacters().find((item) => item.id === characterId);
  if (!character) return "这个先不给你看，下次再说。";
  const bindingConfig = loadBindingConfig();
  const binding = resolveBinding(bindingConfig, characterId, "chat");
  const apiConfig = (binding.apiConfigId ? loadApiConfigs().find((item) => item.id === binding.apiConfigId) : undefined) ?? loadApiConfigs()[0];
  if (!apiConfig) return "这个先不给你看，下次再说。";
  const persona = [character.persona, character.personality].filter(Boolean).join("\n").slice(0, 6000);
  const raw = await sendLLMRequest(apiConfig, null, [
    {
      role: "system",
      content: [
        `你是${character.name}。`,
        persona ? `人物设定：\n${persona}` : "",
        "本轮你原本有发照片的意图，但可用照片里没有足够合适的一张。绝对不要生成图片，也不要说‘系统、相册、匹配、AI、没有素材’等幕后原因。",
        "请根据你本人的性格和正常说话习惯，自然化解这次没发图：可以暂时保密、改口、说下次给看、等重新拍、含糊带过或转开话题。",
        "只输出真正要发送给对方的一小段话，不要旁白、动作描写、解释或标签；保持角色平时使用的语言。",
      ].filter(Boolean).join("\n"),
    },
    { role: "user", content: `原本想发的照片内容：${wantedDescription}` },
  ], [], { characterName: character.name }, {
    skipOutputRegex: true,
    appId: "photos",
    appTags: ["photos", "album-only-fallback"],
  }).catch(() => "");
  return raw.trim().replace(/^```[\s\S]*?\n|```$/g, "").trim() || "这个先不给你看，下次再说。";
}
