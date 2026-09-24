import { kvGet, kvSet, registerKvMigration } from "./kv-db";

export const LYSN_KEY = "ai_phone_lysn_v1";
export const LYSN_EVENT = "lysn-updated";
registerKvMigration(LYSN_KEY);

export type LysnMessage = {
  id: string; characterId: string; sender: "artist" | "fan" | "system";
  kind: "text" | "photo" | "voice" | "notice";
  original: string; translated?: string; imageUrl?: string; photoId?: string;
  createdAt: number;
};
export type LysnProfile = { name: string; avatar: string; cover?: string; bio?: string; group?: string; updatedAt: number };
export type LysnUserProfile = { name: string; avatar: string; cover: string; birthday: string; gender: string };
export type LysnSettings = { notificationsEnabled: boolean; fontSize: "small" | "normal" | "large"; enterToSend: boolean; translationMode: "replace" | "fold" };
export const DEFAULT_LYSN_SETTINGS: LysnSettings = { notificationsEnabled: true, fontSize: "normal", enterToSend: true, translationMode: "fold" };
export const DEFAULT_LYSN_USER: LysnUserProfile = { name: "我", avatar: "", cover: "", birthday: "", gender: "" };
export type LysnState = {
  version: 1; subscribedIds: string[]; profiles: Record<string, LysnProfile>;
  messages: LysnMessage[]; readAt: Record<string, number>;
  subscribedAt: Record<string, number>; lastAutoAt: Record<string, number>;
  userProfile: LysnUserProfile; settings: LysnSettings;
};
const EMPTY: LysnState = { version: 1, subscribedIds: [], profiles: {}, messages: [], readAt: {}, subscribedAt: {}, lastAutoAt: {}, userProfile: DEFAULT_LYSN_USER, settings: DEFAULT_LYSN_SETTINGS };
export function loadLysn(): LysnState {
  try {
    const value = kvGet(LYSN_KEY);
    if (!value) return { ...EMPTY };
    const parsed = JSON.parse(value) as Partial<LysnState>;
    return { version: 1, subscribedIds: Array.isArray(parsed.subscribedIds) ? parsed.subscribedIds.filter((x): x is string => typeof x === "string") : [], profiles: parsed.profiles && typeof parsed.profiles === "object" ? parsed.profiles : {}, messages: Array.isArray(parsed.messages) ? parsed.messages.filter(x => x && typeof x.id === "string" && typeof x.characterId === "string") : [], readAt: parsed.readAt && typeof parsed.readAt === "object" ? parsed.readAt : {}, subscribedAt: parsed.subscribedAt && typeof parsed.subscribedAt === "object" ? parsed.subscribedAt : {}, lastAutoAt: parsed.lastAutoAt && typeof parsed.lastAutoAt === "object" ? parsed.lastAutoAt : {}, userProfile: { name: parsed.userProfile?.name || DEFAULT_LYSN_USER.name, avatar: parsed.userProfile?.avatar || "", cover: parsed.userProfile?.cover || "", birthday: parsed.userProfile?.birthday || "", gender: parsed.userProfile?.gender || "" }, settings: { ...DEFAULT_LYSN_SETTINGS, ...parsed.settings } };
  } catch { return { ...EMPTY }; }
}
export function saveLysn(state: LysnState): void {
  kvSet(LYSN_KEY, JSON.stringify(state));
  if (typeof window !== "undefined") window.dispatchEvent(new Event(LYSN_EVENT));
}
export function lysnId(): string { return `lysn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`; }
export function appendLysn(characterId: string, rows: Omit<LysnMessage, "id" | "characterId" | "createdAt">[]): LysnState {
  const state = loadLysn();
  const now = Date.now();
  state.messages.push(...rows.map((row, i) => ({ ...row, id: lysnId(), characterId, createdAt: now + i })));
  saveLysn(state);
  return state;
}
