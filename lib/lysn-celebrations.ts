import { generateLysn } from "./lysn-engine";
import { prepareLysnMessages } from "./lysn-message";
import { appendLysn, loadLysn, saveLysn, replyCharacterLimit, subscriptionDays } from "./lysn-storage";

const MILESTONES = [50, 77, 100, 150, 200, 300, 365, 400, 500];
/** Idempotent for each room, birthday year and subscription milestone. */
export async function maybeCelebrateLysn(id: string): Promise<void> {
  const current = loadLysn();
  if (!current.subscribedIds.includes(id) || !current.rooms[id]?.openerShown) return;
  const today = new Date();
  const birthday = current.userProfile.birthday;
  const match = birthday.match(/(?:\d{4}[-/])?(\d{1,2})[-/](\d{1,2})$/);
  if (match && Number(match[1]) === today.getMonth() + 1 && Number(match[2]) === today.getDate() && current.rooms[id]?.birthdayCelebratedYear !== today.getFullYear()) {
    // Claim first so simultaneous chat opening and scheduler ticks cannot duplicate a celebration.
    current.rooms[id] = { ...current.rooms[id], birthdayCelebratedYear: today.getFullYear() }; saveLysn(current);
    appendLysn(id, [{ sender: "system", kind: "notice", original: "🎂 生日快乐！今天是你的特别日子。" }]);
    try {
      const generated = await generateLysn(id, loadLysn().messages.filter(m => m.characterId === id), "birthday");
      if (generated.length && loadLysn().subscribedIds.includes(id)) appendLysn(id, await prepareLysnMessages(id, generated));
    } catch { /* The visible birthday marker remains if the API is unavailable. */ }
  }
  const latest = loadLysn();
  const count = subscriptionDays(latest, id, today);
  if (MILESTONES.includes(count) && !(latest.rooms[id]?.anniversariesShown || []).includes(count)) {
    latest.rooms[id] = { ...latest.rooms[id], anniversariesShown: [...(latest.rooms[id]?.anniversariesShown || []), count] }; saveLysn(latest);
    appendLysn(id, [{ sender: "system", kind: "notice", original: `💜 今天是你订阅这间聊天室的第 ${count} 天！每条回复现可写 ${replyCharacterLimit(count)} 字。` }]);
  }
}
