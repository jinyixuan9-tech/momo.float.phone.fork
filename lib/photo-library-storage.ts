import { kvGet, kvSet, registerKvMigration } from "./kv-db";
import type {
  CharacterCurrentTraits,
  PhotoAppearance,
  PhotoLibraryPreferences,
  PhotoLibraryState,
  PhotoPersonSlot,
  PhotoRecord,
  PhotoSourceStrategy,
} from "./photo-library-types";

export const PHOTO_LIBRARY_STORAGE_KEY = "ai_phone_photo_library_v1";
export const PHOTO_LIBRARY_UPDATED_EVENT = "photo-library-updated";

registerKvMigration(PHOTO_LIBRARY_STORAGE_KEY);

export const DEFAULT_PHOTO_LIBRARY_PREFERENCES: PhotoLibraryPreferences = {
  mediaStrategy: "album_then_generated",
  chatStrategy: "album_then_generated",
  momentsStrategy: "album_then_generated",
  resolverDebug: false,
};

const EMPTY_STATE: PhotoLibraryState = {
  version: 2,
  photos: [],
  currentTraitsByCharacter: {},
  preferences: DEFAULT_PHOTO_LIBRARY_PREFERENCES,
};

function uniqueStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)));
}

function cleanOptional(value: unknown, max = 600): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim().slice(0, max);
  return text || undefined;
}

function normalizeAppearance(value: unknown): PhotoAppearance | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const result: PhotoAppearance = {
    hair: cleanOptional(raw.hair, 160),
    accessories: cleanOptional(raw.accessories, 220),
    outfit: cleanOptional(raw.outfit, 260),
    season: cleanOptional(raw.season, 100),
    scene: cleanOptional(raw.scene, 220),
  };
  return Object.values(result).some(Boolean) ? result : undefined;
}

function normalizePeople(value: unknown): PhotoPersonSlot[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    if (!item || typeof item !== "object") return [];
    const raw = item as Record<string, unknown>;
    const appearance = normalizeAppearance(raw.appearance) ?? {};
    return [{
      id: cleanOptional(raw.id, 80) || `person_${index + 1}`,
      position: cleanOptional(raw.position, 100),
      mappedCharacterId: cleanOptional(raw.mappedCharacterId, 180),
      appearance,
    }];
  });
}

function normalizeUsageHistory(value: unknown): PhotoRecord["usageHistory"] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const item = raw as Record<string, unknown>;
    const channel = item.channel;
    if (!["dm_user", "moments", "dm_char", "bubble", "sms", "wvs", "other"].includes(String(channel))) return [];
    if (typeof item.characterId !== "string" || !item.characterId) return [];
    const usedAt = typeof item.usedAt === "number" && Number.isFinite(item.usedAt) ? item.usedAt : Date.now();
    return [{
      channel: channel as PhotoRecord["usageHistory"][number]["channel"],
      characterId: item.characterId,
      targetId: typeof item.targetId === "string" && item.targetId ? item.targetId : undefined,
      usedAt,
    }];
  });
}

function normalizeStrategy(value: unknown): PhotoSourceStrategy {
  return value === "album_only" || value === "generated_only" || value === "album_then_generated"
    ? value
    : "album_then_generated";
}

function normalizePhoto(raw: unknown): PhotoRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  if (typeof item.id !== "string" || !item.id) return null;
  if (typeof item.assetId !== "string" || !item.assetId) return null;

  const createdAt = typeof item.createdAt === "number" && Number.isFinite(item.createdAt) ? item.createdAt : Date.now();
  const updatedAt = typeof item.updatedAt === "number" && Number.isFinite(item.updatedAt) ? item.updatedAt : createdAt;
  const visionStatus = item.visionStatus === "pending" || item.visionStatus === "done" || item.visionStatus === "failed"
    ? item.visionStatus
    : "unprocessed";

  // v0.2.0 旧字段兼容：sceneTags / visionTags / shotType 会折叠进新的简洁信息结构。
  const legacyScene = uniqueStrings(item.sceneTags).join("、");
  const legacyShot = typeof item.shotType === "string" ? item.shotType : "";
  const appearance = normalizeAppearance(item.appearance) ?? (legacyScene || legacyShot ? {
    scene: legacyScene || undefined,
    outfit: legacyShot === "selfie" ? "自拍" : undefined,
  } : undefined);

  return {
    id: item.id,
    assetId: item.assetId,
    originalName: cleanOptional(item.originalName, 260),
    linkedCharacterIds: uniqueStrings(item.linkedCharacterIds),
    sharedPairIds: uniqueStrings(item.sharedPairIds),
    aiUsable: item.aiUsable !== false,
    visionStatus,
    visionSummary: cleanOptional(item.visionSummary, 900),
    subject: cleanOptional(item.subject, 180),
    appearance,
    people: normalizePeople(item.people),
    visionTags: uniqueStrings(item.visionTags),
    visionError: cleanOptional(item.visionError, 500),
    manualFields: uniqueStrings(item.manualFields),
    usageHistory: normalizeUsageHistory(item.usageHistory),
    createdAt,
    updatedAt,
  };
}

function normalizeCurrentTraits(value: unknown): Record<string, CharacterCurrentTraits> {
  if (!value || typeof value !== "object") return {};
  const result: Record<string, CharacterCurrentTraits> = {};
  for (const [characterId, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const text = cleanOptional(item.text, 1000);
    if (!text) continue;
    result[characterId] = {
      text,
      sourcePhotoId: cleanOptional(item.sourcePhotoId, 180),
      updatedAt: typeof item.updatedAt === "number" && Number.isFinite(item.updatedAt) ? item.updatedAt : Date.now(),
    };
  }
  return result;
}

function normalizeState(parsed: unknown): PhotoLibraryState {
  const root = parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  const rawPhotos = Array.isArray(parsed)
    ? parsed
    : Array.isArray(root.photos) ? root.photos : [];
  const rawPreferences = root.preferences && typeof root.preferences === "object"
    ? root.preferences as Record<string, unknown>
    : {};
  return {
    version: 2,
    photos: rawPhotos.map(normalizePhoto).filter((photo): photo is PhotoRecord => Boolean(photo)),
    currentTraitsByCharacter: normalizeCurrentTraits(root.currentTraitsByCharacter),
    preferences: {
      mediaStrategy: normalizeStrategy(rawPreferences.mediaStrategy ?? (rawPreferences.chatStrategy === rawPreferences.momentsStrategy ? rawPreferences.chatStrategy : "album_then_generated")),
      chatStrategy: normalizeStrategy(rawPreferences.chatStrategy ?? rawPreferences.mediaStrategy),
      momentsStrategy: normalizeStrategy(rawPreferences.momentsStrategy ?? rawPreferences.mediaStrategy),
      resolverDebug: rawPreferences.resolverDebug === true,
    },
  };
}

function emitUpdated(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(PHOTO_LIBRARY_UPDATED_EVENT));
}

export function createPhotoId(): string {
  return `photo_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function createPhotoSharedPairId(characterIdA: string, characterIdB: string): string {
  const ids = [characterIdA, characterIdB].filter(Boolean).sort();
  if (ids.length !== 2 || ids[0] === ids[1]) return "";
  return ids.map((id) => encodeURIComponent(id)).join("::");
}

export function parsePhotoSharedPairId(pairId: string): [string, string] | null {
  const parts = pairId.split("::");
  if (parts.length !== 2) return null;
  try {
    const a = decodeURIComponent(parts[0]);
    const b = decodeURIComponent(parts[1]);
    if (!a || !b || a === b) return null;
    return [a, b];
  } catch {
    return null;
  }
}

export function loadPhotoLibrary(): PhotoLibraryState {
  if (typeof window === "undefined") return EMPTY_STATE;
  try {
    const raw = kvGet(PHOTO_LIBRARY_STORAGE_KEY);
    if (!raw) return EMPTY_STATE;
    return normalizeState(JSON.parse(raw) as unknown);
  } catch {
    return EMPTY_STATE;
  }
}

export function savePhotoLibrary(state: PhotoLibraryState): PhotoLibraryState {
  const next = normalizeState(state);
  kvSet(PHOTO_LIBRARY_STORAGE_KEY, JSON.stringify(next));
  emitUpdated();
  return next;
}

export function appendPhotoRecords(records: PhotoRecord[]): PhotoLibraryState {
  const current = loadPhotoLibrary();
  return savePhotoLibrary({ ...current, photos: [...records, ...current.photos] });
}

export function updatePhotoRecord(photoId: string, patch: Partial<PhotoRecord>): PhotoRecord | null {
  const current = loadPhotoLibrary();
  let updated: PhotoRecord | null = null;
  const photos = current.photos.map((photo) => {
    if (photo.id !== photoId) return photo;
    updated = normalizePhoto({ ...photo, ...patch, id: photo.id, assetId: photo.assetId, updatedAt: Date.now() });
    return updated ?? photo;
  });
  savePhotoLibrary({ ...current, photos });
  return updated;
}

export function updatePhotoRecords(records: PhotoRecord[]): PhotoLibraryState {
  if (records.length === 0) return loadPhotoLibrary();
  const byId = new Map(records.map((record) => [record.id, record]));
  const current = loadPhotoLibrary();
  return savePhotoLibrary({
    ...current,
    photos: current.photos.map((photo) => byId.get(photo.id) ?? photo),
  });
}

export function removePhotoRecord(photoId: string): PhotoRecord | null {
  const current = loadPhotoLibrary();
  const removed = current.photos.find((photo) => photo.id === photoId) ?? null;
  if (!removed) return null;
  const traits = { ...current.currentTraitsByCharacter };
  for (const [characterId, value] of Object.entries(traits)) {
    if (value.sourcePhotoId === photoId) traits[characterId] = { ...value, sourcePhotoId: undefined };
  }
  savePhotoLibrary({ ...current, photos: current.photos.filter((photo) => photo.id !== photoId), currentTraitsByCharacter: traits });
  return removed;
}

export function setCharacterCurrentTraits(characterId: string, text: string, sourcePhotoId?: string): void {
  const current = loadPhotoLibrary();
  const next = { ...current.currentTraitsByCharacter };
  const cleaned = text.trim();
  if (!cleaned) delete next[characterId];
  else {
    const previous = current.currentTraitsByCharacter[characterId];
    next[characterId] = {
      text: cleaned.slice(0, 1000),
      sourcePhotoId: sourcePhotoId !== undefined ? sourcePhotoId : previous?.sourcePhotoId,
      updatedAt: Date.now(),
    };
  }
  savePhotoLibrary({ ...current, currentTraitsByCharacter: next });
}

export function setPhotoLibraryPreferences(patch: Partial<PhotoLibraryPreferences>): void {
  const current = loadPhotoLibrary();
  savePhotoLibrary({
    ...current,
    preferences: {
      mediaStrategy: normalizeStrategy(patch.mediaStrategy ?? current.preferences.mediaStrategy),
      chatStrategy: normalizeStrategy(patch.chatStrategy ?? patch.mediaStrategy ?? current.preferences.chatStrategy),
      momentsStrategy: normalizeStrategy(patch.momentsStrategy ?? patch.mediaStrategy ?? current.preferences.momentsStrategy),
      resolverDebug: patch.resolverDebug ?? current.preferences.resolverDebug,
    },
  });
}

export function appendPhotoUsage(photoId: string, usage: PhotoRecord["usageHistory"][number]): void {
  const current = loadPhotoLibrary();
  const photo = current.photos.find((item) => item.id === photoId);
  if (!photo) return;
  updatePhotoRecord(photoId, { usageHistory: [...photo.usageHistory, usage].slice(-120) });
}
