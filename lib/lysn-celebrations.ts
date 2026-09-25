import { loadLysn, lysnId, subscriptionDays, type LysnMessage, type LysnState } from "./lysn-storage";

export const LYSN_MILESTONES = [1, 30, 52, 100, 300, 365, 500, 1000];
export type LysnHistoryEvent = { date: string; celebration: { kind: "birthday"; year: number } | { kind: "anniversary"; days: number } };

/** Calendar and first-subscription history share the same inclusive day count. */
export function lysnHistoryEvents(start: string, today: string, birthday: string): LysnHistoryEvent[] {
  const startMs = Date.parse(`${start}T12:00:00Z`);
  const endMs = Date.parse(`${today}T12:00:00Z`);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs > endMs) return [];
  const events: LysnHistoryEvent[] = [];
  for (const days of LYSN_MILESTONES) {
    const dateMs = startMs + (days - 1) * 86400000;
    if (dateMs <= endMs) events.push({ date: new Date(dateMs).toISOString().slice(0, 10), celebration: { kind: "anniversary", days } });
  }
  const match = birthday.match(/(?:\d{4}[-/])?(\d{1,2})[-/](\d{1,2})$/);
  if (match) {
    const month = Number(match[1]); const day = Number(match[2]);
    for (let year = new Date(startMs).getUTCFullYear(); year <= new Date(endMs).getUTCFullYear(); year += 1) {
      const dateMs = Date.UTC(year, month - 1, day, 12);
      const date = new Date(dateMs);
      if (date.getUTCMonth() === month - 1 && date.getUTCDate() === day && dateMs >= startMs && dateMs <= endMs) {
        events.push({ date: date.toISOString().slice(0, 10), celebration: { kind: "birthday", year } });
      }
    }
  }
  return events.sort((a, b) => a.date.localeCompare(b.date) || (a.celebration.kind === "anniversary" ? -1 : 1));
}

export function lysnDatedCards(characterId: string, start: string, today: string, birthday: string): LysnMessage[] {
  const events = lysnHistoryEvents(start, today, birthday);
  return events.map((event, index) => ({
    id: lysnId(), characterId, sender: "system", kind: "notice",
    original: event.celebration.kind === "birthday" ? "生日留言 · 点击查看" : `第 ${event.celebration.days} 天纪念 · 点击查看`,
    celebration: event.celebration,
    createdAt: Math.min(Date.now() - (events.length - index + 1) * 1000, new Date(`${event.date}T09:${String(Math.min((index + 1) * 4, 55)).padStart(2, "0")}:00`).getTime()),
  }));
}

/** Changing a subscription date or birthday updates dated cards, without rewriting real chat messages. */
export function syncLysnDatedCards(state: LysnState, characterId: string, today: string): void {
  const room = state.rooms[characterId];
  if (!room?.historyInitialized || !room.subscriptionDate) return;
  const opener = state.messages.find(message => message.characterId === characterId && message.opener);
  if (!opener) return; // Clearing the chat must not silently recreate historical cards.
  opener.createdAt = Math.min(Date.now() - 1000, new Date(`${room.subscriptionDate}T09:00:00`).getTime());
  state.messages = state.messages.filter(message => message.characterId !== characterId || !message.celebration);
  state.messages.push(...lysnDatedCards(characterId, room.subscriptionDate, today, state.userProfile.birthday));
  state.messages.sort((a, b) => a.createdAt - b.createdAt);
}
/** Celebrations now live in the calendar; keep old caller harmless. */
export async function maybeCelebrateLysn(id: string): Promise<void> {
  const current = loadLysn();
  if (!current.subscribedIds.includes(id)) return;
  subscriptionDays(current, id); // day-count remains available to the room header
}
