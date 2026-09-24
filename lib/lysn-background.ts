import { loadCharacters } from "./character-storage";
import { generateLysn } from "./lysn-engine";
import { prepareLysnMessages } from "./lysn-message";
import { appendLysn, loadLysn, saveLysn } from "./lysn-storage";
import { sendBrowserNotification } from "./browser-notification";
import { maybeCelebrateLysn } from "./lysn-celebrations";

const FIRST_MESSAGE_WAIT_MS = 15 * 60 * 1000;
const RETRY_WAIT_MS = 30 * 60 * 1000;
let running = false;
/** A low-frequency scheduler running only while the phone is open. */
export async function maybeGenerateLysnBackgroundMessage(): Promise<void> {
  if (running || typeof document === "undefined") return;
  const state = loadLysn();
  state.subscribedIds.forEach(id => { void maybeCelebrateLysn(id); });
  if (!state.settings.autonomousMessages) return;
  const now = Date.now();
  const id = state.subscribedIds.find(characterId => {
    const room = state.rooms[characterId];
    if (!room?.openerShown) return false;
    const activity = room.activity || "normal";
    const interval = ({ quiet: 12, normal: 4, frequent: 1 }[activity]) * 3600000;
    const firstWait = ({ quiet: 4 * 3600000, normal: FIRST_MESSAGE_WAIT_MS, frequent: 5 * 60000 }[activity]);
    const latest = state.messages.filter(m => m.characterId === characterId && m.sender === "artist" && !m.opener).at(-1)?.createdAt || 0;
    const joined = state.subscribedAt[characterId] || now;
    return now - Math.max(latest, state.lastAutoAt[characterId] || 0, joined) >= (latest ? interval : firstWait);
  });
  if (!id || !loadCharacters().some(c => c.id === id)) return;
  running = true;
  state.lastAutoAt[id] = now; saveLysn(state);
  try {
    const result = await generateLysn(id, state.messages.filter(m => m.characterId === id), "new");
    if (!result.length) return;
    const rows = await prepareLysnMessages(id, result);
    if (!loadLysn().subscribedIds.includes(id)) return;
    appendLysn(id, rows);
    const latest = loadLysn();
    if (latest.settings.notificationsEnabled && !latest.rooms[id]?.muted) {
      const character = loadCharacters().find(c => c.id === id);
      const name = latest.rooms[id]?.chatName || latest.profiles[id]?.name || character?.name || "艺人";
      sendBrowserNotification(`${name} · LYSN`, { body: result[0].original.slice(0, 90), url: `/#lysn=${encodeURIComponent(id)}` });
      window.dispatchEvent(new CustomEvent("lysn-message-notice", { detail: { characterId: id, title: `${name} · LYSN`, body: result[0].original } }));
    }
  } catch {
    const latest = loadLysn();
    latest.lastAutoAt[id] = Date.now() - FIRST_MESSAGE_WAIT_MS + RETRY_WAIT_MS;
    saveLysn(latest);
  } finally { running = false; }
}
