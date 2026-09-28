import { kvGet, kvSet, registerKvMigration } from "./kv-db";

export type BoxQuestion = {
  id: string;
  recipientId: string;
  senderId?: string;
  senderName: string;
  text: string;
  createdAt: number;
  answer?: { original: string; translated: string; createdAt: number };
};
export type BoxProfile = { nickname?: string; avatarUrl?: string; coverUrl?: string };
export type BoxTopicMode = "custom" | "persona" | "free";
export type BoxSession = {
  id: string;
  ownerId: string;
  startsAt: number;
  endsAt: number;
  topicMode: BoxTopicMode;
  topic: string;
  maxQuestions: number;
  participantIds?: string[];
  lastArrivalAt: number;
  questions: BoxQuestion[];
  profileSnapshot: BoxProfile;
};
export type BoxState = { sessions: BoxSession[]; profiles: Record<string, BoxProfile> };
const KEY = "ai_phone_question_box_v2";
const OLD_KEY = "ai_phone_question_box_v1";
registerKvMigration(KEY);
registerKvMigration(OLD_KEY);
export const newBoxId = () => `qb_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
export const emptyBoxState = (): BoxState => ({ sessions: [], profiles: {} });
export function loadBoxState(): BoxState {
  if (typeof window === "undefined") return emptyBoxState();
  try {
    const raw = kvGet(KEY);
    if (raw) {
      const row = JSON.parse(raw) as Partial<BoxState>;
      return { sessions: Array.isArray(row.sessions) ? row.sessions : [], profiles: row.profiles && typeof row.profiles === "object" ? row.profiles : {} };
    }
    // Earlier preview versions grouped all owners into one session. Preserve their questions in owner-specific archives.
    const old = JSON.parse(kvGet(OLD_KEY) || "null") as { sessions?: Array<{ id: string; startsAt: number; endsAt: number; participantIds: string[]; refreshCount: number; questions: BoxQuestion[] }> } | null;
    if (!Array.isArray(old?.sessions)) return emptyBoxState();
    const sessions = old.sessions.flatMap(row => (Array.isArray(row.participantIds) ? row.participantIds : []).map(ownerId => ({
      id: `${row.id}_${ownerId}`, ownerId, startsAt: row.startsAt, endsAt: row.endsAt, topicMode: "free" as const, topic: "",
      maxQuestions: Math.min(5, Math.max(1, row.refreshCount || 3)), lastArrivalAt: row.startsAt,
      participantIds: ownerId === "user" ? row.participantIds.filter(id => id !== "user") : undefined,
      questions: (row.questions || []).filter(q => q.recipientId === ownerId).map(q => ({ ...q, senderName: "匿名" })), profileSnapshot: {},
    })));
    return { sessions, profiles: {} };
  } catch { return emptyBoxState(); }
}
export function saveBoxState(state: BoxState) { if (typeof window !== "undefined") kvSet(KEY, JSON.stringify(state)); }
