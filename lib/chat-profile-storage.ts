import type { Character } from "./character-types";
import { kvGet, kvSet, registerKvMigration } from "./kv-db";
import { getChatImageFromIndexedDB } from "./chat-asset-storage";

export const CHAT_CHARACTER_PROFILES_KEY = "ai_phone_chat_character_profiles_v1";
export const CHAT_CHARACTER_PROFILES_UPDATED_EVENT = "chat-character-profiles-updated";
registerKvMigration(CHAT_CHARACTER_PROFILES_KEY);

/**
 * 角色在 Chat 这个平台里的账号资料。
 *
 * Character.name / Character.avatar 是角色本体资料；这里的字段只是 Chat 平台覆盖。
 * 没有覆盖时始终回退到角色本体，因此旧数据不需要迁移。
 */
export type ChatCharacterProfile = {
  characterId: string;
  displayName?: string;
  avatarUrl?: string;
  /** 仅记录角色“自主”修改，用于低频冷却；用户手动编辑/推荐头像不会占用这个冷却。 */
  lastAutonomousNameAt?: number;
  lastAutonomousAvatarAt?: number;
  updatedAt: number;
};

function cleanText(value: unknown, max = 80): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim().slice(0, max);
  return text || undefined;
}

const legacyAvatarHydrationInFlight = new Set<string>();

async function compressAvatarDataUrl(source: string): Promise<string> {
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

function hydrateLegacyAssetAvatar(characterId: string, assetRef: string): void {
  if (typeof window === "undefined" || !assetRef.startsWith("asset://")) return;
  const assetId = assetRef.slice("asset://".length).trim();
  if (!assetId || legacyAvatarHydrationInFlight.has(characterId)) return;
  legacyAvatarHydrationInFlight.add(characterId);
  void getChatImageFromIndexedDB(assetId)
    .then(async (source) => {
      if (!source) return;
      const avatarUrl = await compressAvatarDataUrl(source);
      const current = loadChatCharacterProfiles()[characterId];
      if (current?.avatarUrl !== assetRef) return;
      updateChatCharacterProfile(characterId, { avatarUrl });
    })
    .catch(() => undefined)
    .finally(() => legacyAvatarHydrationInFlight.delete(characterId));
}

function cleanAvatar(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  if (!text) return undefined;
  if (text.startsWith("data:") || text.startsWith("http://") || text.startsWith("https://") || text.startsWith("asset://")) {
    return text;
  }
  return undefined;
}

function normalizeProfile(raw: unknown): ChatCharacterProfile | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Partial<ChatCharacterProfile>;
  if (typeof source.characterId !== "string" || !source.characterId.trim()) return null;
  return {
    characterId: source.characterId,
    displayName: cleanText(source.displayName),
    avatarUrl: cleanAvatar(source.avatarUrl),
    lastAutonomousNameAt: typeof source.lastAutonomousNameAt === "number" && Number.isFinite(source.lastAutonomousNameAt) ? source.lastAutonomousNameAt : undefined,
    lastAutonomousAvatarAt: typeof source.lastAutonomousAvatarAt === "number" && Number.isFinite(source.lastAutonomousAvatarAt) ? source.lastAutonomousAvatarAt : undefined,
    updatedAt: typeof source.updatedAt === "number" && Number.isFinite(source.updatedAt) ? source.updatedAt : Date.now(),
  };
}

export function loadChatCharacterProfiles(): Record<string, ChatCharacterProfile> {
  if (typeof window === "undefined") return {};
  try {
    const raw = kvGet(CHAT_CHARACTER_PROFILES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const output: Record<string, ChatCharacterProfile> = {};
    for (const value of Object.values(parsed as Record<string, unknown>)) {
      const profile = normalizeProfile(value);
      if (profile) output[profile.characterId] = profile;
    }
    return output;
  } catch {
    return {};
  }
}

export function getChatCharacterProfile(characterId: string): ChatCharacterProfile | null {
  return loadChatCharacterProfiles()[characterId] || null;
}

export function updateChatCharacterProfile(
  characterId: string,
  patch: Partial<Pick<ChatCharacterProfile, "displayName" | "avatarUrl" | "lastAutonomousNameAt" | "lastAutonomousAvatarAt">>,
): ChatCharacterProfile {
  const profiles = loadChatCharacterProfiles();
  const previous = profiles[characterId];
  const next: ChatCharacterProfile = {
    characterId,
    displayName: patch.displayName !== undefined ? cleanText(patch.displayName) : previous?.displayName,
    avatarUrl: patch.avatarUrl !== undefined ? cleanAvatar(patch.avatarUrl) : previous?.avatarUrl,
    lastAutonomousNameAt: patch.lastAutonomousNameAt !== undefined ? patch.lastAutonomousNameAt : previous?.lastAutonomousNameAt,
    lastAutonomousAvatarAt: patch.lastAutonomousAvatarAt !== undefined ? patch.lastAutonomousAvatarAt : previous?.lastAutonomousAvatarAt,
    updatedAt: Date.now(),
  };

  if (!next.displayName && !next.avatarUrl) delete profiles[characterId];
  else profiles[characterId] = next;

  if (typeof window !== "undefined") {
    kvSet(CHAT_CHARACTER_PROFILES_KEY, JSON.stringify(profiles));
    window.dispatchEvent(new CustomEvent(CHAT_CHARACTER_PROFILES_UPDATED_EVENT, { detail: { characterId } }));
  }
  return next;
}

export function resetChatCharacterProfile(characterId: string): void {
  const profiles = loadChatCharacterProfiles();
  if (!(characterId in profiles)) return;
  delete profiles[characterId];
  if (typeof window !== "undefined") {
    kvSet(CHAT_CHARACTER_PROFILES_KEY, JSON.stringify(profiles));
    window.dispatchEvent(new CustomEvent(CHAT_CHARACTER_PROFILES_UPDATED_EVENT, { detail: { characterId } }));
  }
}

export function resolveChatCharacterDisplayName(character: Pick<Character, "id" | "name"> | null | undefined): string {
  if (!character) return "";
  return getChatCharacterProfile(character.id)?.displayName?.trim() || character.name;
}

export function resolveChatCharacterAvatar(character: Pick<Character, "id" | "avatar"> | null | undefined): string | null {
  if (!character) return null;
  const avatarUrl = getChatCharacterProfile(character.id)?.avatarUrl;
  if (avatarUrl?.startsWith("asset://")) {
    // v0.4.0/0.4.1 曾把 Photos 的内部 asset:// 直接写进 Profile，浏览器 img 无法显示。
    // 先回退默认头像，同时后台一次性把旧引用迁成可显示的压缩 Data URL。
    hydrateLegacyAssetAvatar(character.id, avatarUrl);
    return character.avatar || null;
  }
  return avatarUrl || character.avatar || null;
}
