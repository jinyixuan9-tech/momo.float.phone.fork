import { deleteCalendarItemsByExternalId, upsertCalendarScheduleItem } from "./calendar-storage";
import { formatIsoDate, getWeekStartIso } from "./calendar-utils";
import { loadWeverseState, upsertWeverseScheduleItem, deleteWeverseScheduleItem, type WeverseScheduleItem } from "./weverse-storage";

function toDateParts(ts: number): { date: string; time: string } {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return { date: formatIsoDate(d), time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}

export function syncWeverseScheduleItemToCalendar(item: WeverseScheduleItem): void {
  deleteCalendarItemsByExternalId("weverse", item.id);
  if (!item.calendarSync) return;
  const start = toDateParts(item.startsAt);
  const end = toDateParts(item.endsAt || item.startsAt + 60 * 60 * 1000);
  const endTime = end.date === start.date && end.time > start.time ? end.time : "23:59";
  for (const characterId of item.memberCharacterIds) {
    upsertCalendarScheduleItem("character", characterId, getWeekStartIso(new Date(`${start.date}T00:00:00`)), {
      id: `wvs_${item.id}_${characterId}`,
      date: start.date,
      startTime: start.time,
      endTime,
      location: item.location || "",
      title: item.title,
      emoji: item.type === "performance" ? "🎵" : item.type === "recording" ? "🎬" : item.type === "shoot" ? "📸" : item.type === "brand" ? "🛍️" : item.type === "anniversary" ? "🎂" : "📌",
      source: "weverse",
      externalSource: "weverse",
      externalId: item.id,
    });
  }
}

export function removeWeverseScheduleItemEverywhere(itemId: string): void {
  deleteCalendarItemsByExternalId("weverse", itemId);
  deleteWeverseScheduleItem(itemId);
}

/**
 * 手机日历编辑了一个 WVS 投影时，把改动回写到 WVS 主数据；同一 Community 的其它成员投影随后重建。
 */
export function syncCalendarProjectionBackToWeverse(externalId: string, patch: { date: string; startTime: string; endTime: string; location: string; title: string }): void {
  const state = loadWeverseState();
  const current = state.schedules.find((item) => item.id === externalId);
  if (!current) return;
  const startsAt = new Date(`${patch.date}T${patch.startTime}:00`).getTime();
  const endsAt = new Date(`${patch.date}T${patch.endTime}:00`).getTime();
  const next: WeverseScheduleItem = {
    ...current,
    title: patch.title.trim() || current.title,
    location: patch.location.trim() || undefined,
    startsAt: Number.isFinite(startsAt) ? startsAt : current.startsAt,
    endsAt: Number.isFinite(endsAt) && endsAt > startsAt ? endsAt : current.endsAt,
    updatedAt: Date.now(),
  };
  upsertWeverseScheduleItem(next);
  syncWeverseScheduleItemToCalendar(next);
}
