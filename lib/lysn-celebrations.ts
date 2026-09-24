import { loadLysn, subscriptionDays } from "./lysn-storage";

export const LYSN_MILESTONES = [1, 30, 52, 100, 300, 365, 500, 1000];
/** Celebrations now live in the calendar; keep old caller harmless. */
export async function maybeCelebrateLysn(id: string): Promise<void> {
  const current = loadLysn();
  if (!current.subscribedIds.includes(id)) return;
  subscriptionDays(current, id); // day-count remains available to the room header
}
