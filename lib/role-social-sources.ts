import { loadOwnerCalendarPlans } from "./calendar-storage";
import { loadWeverseState } from "./weverse-storage";

export type RoleSocialSources = { includeCalendar: boolean; includeWeverseSchedule: boolean };
export const DEFAULT_ROLE_SOCIAL_SOURCES: RoleSocialSources = { includeCalendar: false, includeWeverseSchedule: false };

/** Only the selected character's sources are read; anonymous public feeds never get this context. */
export function roleSocialContext(characterId: string, setting?: RoleSocialSources): string {
  if (!setting?.includeCalendar && !setting?.includeWeverseSchedule) return "";
  const now = Date.now();
  const lower = new Date(now - 3 * 86400000).toISOString().slice(0, 10);
  const upper = new Date(now + 35 * 86400000).toISOString().slice(0, 10);
  const lines: string[] = [];
  if (setting.includeCalendar) {
    for (const plan of loadOwnerCalendarPlans(characterId === "user" ? "user" : "character", characterId === "user" ? "self" : characterId)) {
      for (const item of plan.items) if (item.date >= lower && item.date <= upper) {
        lines.push(`本人日历 ${item.date} ${item.startTime} ${item.title.slice(0, 80)}`);
      }
    }
  }
  if (setting.includeWeverseSchedule) {
    const wvs = loadWeverseState();
    const linked = new Set(wvs.communities.filter(c => characterId === "user" || c.memberCharacterIds.includes(characterId)).map(c => c.id));
    for (const item of wvs.schedules) if (item.visibility === "public" && linked.has(item.communityId)
      && characterId !== "user" && (!item.memberCharacterIds.length || item.memberCharacterIds.includes(characterId))
      && item.startsAt >= now - 3 * 86400000 && item.startsAt <= now + 35 * 86400000) {
      lines.push(`WVS公开日程 ${new Date(item.startsAt).toISOString().slice(0, 16)} ${item.title.slice(0, 80)}`);
    }
    for (const post of wvs.posts) if (linked.has(post.communityId) && post.createdAt >= now - 3 * 86400000
      && post.createdAt <= now && (characterId === "user" ? post.authorType === "user" : post.authorType === "official" || post.authorType === "artist" && post.authorId === characterId)) {
      lines.push(`WVS公开动态 ${new Date(post.createdAt).toISOString().slice(0, 16)} ${post.body.slice(0, 150)}`);
    }
  }
  return lines.slice(0, 14).join("；").slice(0, 1800);
}
