import { kvGet, kvSet, registerKvMigration } from "./kv-db";
import type { PhotoLibraryState, PhotoRecord } from "./photo-library-types";

export const PHOTO_LIBRARY_STORAGE_KEY = "ai_phone_photo_library_v1";
export const PHOTO_LIBRARY_UPDATED_EVENT = "photo-library-updated";

registerKvMigration(PHOTO_LIBRARY_STORAGE_KEY);

const EMPTY_STATE: PhotoLibraryState = { version: 1, photos: [] };

function uniqueStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)));
}

function normalizeUsageHistory(value: unknown): PhotoRecord["usageHistory"] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const item = raw as Record<string, unknown>;
    const channel = item.channel;
    if (channel !== "dm_user" && channel !== "moments" && channel !== "dm_char") return [];
    if (typeof item.characterId !== "string" || !item.characterId) return [];
    const usedAt = typeof item.usedAt === "number" && Number.isFinite(item.usedAt) ? item.usedAt : Date.now();
    return [{
      channel,
      characterId: item.characterId,
      targetId: typeof item.targetId === "string" && item.targetId ? item.targetId : undefined,
      usedAt,
    }];
  });
}

function normalizePhoto(raw: unknown): PhotoRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  if (typeof item.id !== "string" || !item.id) return null;
  if (typeof item.assetId !== "string" || !item.assetId) return null;

  const createdAt = typeof item.createdAt === "number" && Number.isFinite(item.createdAt)
    ? item.createdAt
    : Date.now();
  const updatedAt = typeof item.updatedAt === "number" && Number.isFinite(item.updatedAt)
    ? item.updatedAt
    : createdAt;
  const visionStatus = item.visionStatus === "pending" || item.visionStatus === "done" || item.visionStatus === "failed"
    ? item.visionStatus
    : "unprocessed";
  const shotType = item.shotType === "selfie" || item.shotType === "taken_by_character" || item.shotType === "other"
    ? item.shotType
    : undefined;

  return {
    id: item.id,
    assetId: item.assetId,
    originalName: typeof item.originalName === "string" && item.originalName ? item.originalName : undefined,
    linkedCharacterIds: uniqueStrings(item.linkedCharacterIds),
    sharedPairIds: uniqueStrings(item.sharedPairIds),
    aiUsable: item.aiUsable !== false,
    visionStatus,
    visionSummary: typeof item.visionSummary === "string" && item.visionSummary ? item.visionSummary : undefined,
    visionTags: uniqueStrings(item.visionTags),
    sceneTags: uniqueStrings(item.sceneTags),
    shotType,
    usageHistory: normalizeUsageHistory(item.usageHistory),
    createdAt,
    updatedAt,
  };
}

function emitUpdated(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(PHOTO_LIBRARY_UPDATED_EVENT));
  }
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
    const parsed = JSON.parse(raw) as unknown;
    const items = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object" && Array.isArray((parsed as { photos?: unknown }).photos)
        ? (parsed as { photos: unknown[] }).photos
        : [];
    return {
      version: 1,
      photos: items.map(normalizePhoto).filter((photo): photo is PhotoRecord => Boolean(photo)),
    };
  } catch {
    return EMPTY_STATE;
  }
}

export function savePhotoLibrary(state: PhotoLibraryState): PhotoLibraryState {
  const next: PhotoLibraryState = {
    version: 1,
    photos: state.photos.map((photo) => normalizePhoto(photo)).filter((photo): photo is PhotoRecord => Boolean(photo)),
  };
  kvSet(PHOTO_LIBRARY_STORAGE_KEY, JSON.stringify(next));
  emitUpdated();
  return next;
}

export function appendPhotoRecords(records: PhotoRecord[]): PhotoLibraryState {
  const current = loadPhotoLibrary();
  return savePhotoLibrary({ version: 1, photos: [...records, ...current.photos] });
}

export function updatePhotoRecord(photoId: string, patch: Partial<PhotoRecord>): PhotoRecord | null {
  const current = loadPhotoLibrary();
  let updated: PhotoRecord | null = null;
  const photos = current.photos.map((photo) => {
    if (photo.id !== photoId) return photo;
    updated = {
      ...photo,
      ...patch,
      id: photo.id,
      assetId: photo.assetId,
      updatedAt: Date.now(),
    };
    return updated;
  });
  savePhotoLibrary({ version: 1, photos });
  return updated;
}

export function removePhotoRecord(photoId: string): PhotoRecord | null {
  const current = loadPhotoLibrary();
  const removed = current.photos.find((photo) => photo.id === photoId) ?? null;
  if (!removed) return null;
  savePhotoLibrary({ version: 1, photos: current.photos.filter((photo) => photo.id !== photoId) });
  return removed;
}
