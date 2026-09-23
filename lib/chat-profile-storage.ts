import type { Character } from "./character-types";
import { kvGet, kvSet, registerKvMigration } from "./kv-db";

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
  return getChatCharacterProfile(character.id)?.avatarUrl || character.avatar || null;
}
