import { kvGet, kvSet, registerKvMigration } from "./kv-db";

export type BoxQuestion = {
  id: string;
  recipientId: string;
  senderId?: string;
  senderName: string;
  anonymous: boolean;
  revealed?: boolean;
  text: string;
  createdAt: number;
  answer?: { original: string; translated: string; createdAt: number };
};
export type BoxSession = {
  id: string;
  startsAt: number;
  endsAt: number;
  participantIds: string[];
  refreshCount: number;
  lastArrivalAt: number;
  questions: BoxQuestion[];
};
export type BoxState = { sessions: BoxSession[]; refreshCount: number };
const KEY = "ai_phone_question_box_v1";
registerKvMigration(KEY);
export const newBoxId = () => `qb_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
export function loadBoxState(): BoxState {
  if (typeof window === "undefined") return { sessions: [], refreshCount: 3 };
  try {
    const row = JSON.parse(kvGet(KEY) || "null") as Partial<BoxState> | null;
    return { sessions: Array.isArray(row?.sessions) ? row.sessions : [], refreshCount: Math.min(5, Math.max(1, Number(row?.refreshCount) || 3)) };
  } catch { return { sessions: [], refreshCount: 3 }; }
}
export function saveBoxState(state: BoxState) { if (typeof window !== "undefined") kvSet(KEY, JSON.stringify(state)); }
