import { loadCharacters } from "./character-storage";
import { generateLysn } from "./lysn-engine";
import { resolveMediaForUse } from "./media-resolver";
import { appendLysn, loadLysn, saveLysn } from "./lysn-storage";
import { sendBrowserNotification } from "./browser-notification";

const FIRST_MESSAGE_WAIT_MS = 15 * 60 * 1000;
const MESSAGE_INTERVAL_MS = 4 * 60 * 60 * 1000;
const RETRY_WAIT_MS = 30 * 60 * 1000;
let running = false;

/** A low-frequency in-page scheduler. It runs only while the phone is open. */
export async function maybeGenerateLysnBackgroundMessage(): Promise<void> {
  if (running || typeof document === "undefined") return;
  const state = loadLysn();
  const now = Date.now();
  const id = state.subscribedIds.find(characterId => {
    const latest = state.messages.filter(m => m.characterId === characterId && m.sender === "artist").at(-1)?.createdAt || 0;
    const joined = state.subscribedAt[characterId] || now;
    return now - Math.max(latest, state.lastAutoAt[characterId] || 0, joined) >= (latest ? MESSAGE_INTERVAL_MS : FIRST_MESSAGE_WAIT_MS);
  });
  if (!id || !loadCharacters().some(c => c.id === id)) return;
  running = true;
  // Claim this interval before the async request, so a tab refresh never starts a burst.
  state.lastAutoAt[id] = now; saveLysn(state);
  try {
    const result = await generateLysn(id, state.messages.filter(m => m.characterId === id), "new");
    const rows = [];
    for (const item of [result, ...(result.extra || [])]) {
      let kind = item.kind;
      let imageUrl: string | undefined;
      let photoId: string | undefined;
      if (kind === "photo") {
        const media = await resolveMediaForUse({ actor: { type: "character", characterId: id }, description: item.photoDescription || item.original, intentKind: item.mediaIntent, channel: "bubble", targetId: id, appId: "lysn" });
        if (media?.imageUrl) { imageUrl = media.imageUrl; photoId = media.photoLibraryId; }
        else kind = "text";
      }
      rows.push({ sender: "artist" as const, kind, original: item.original, translated: item.translated, imageUrl, photoId });
    }
    // Recheck: subscription can change while the model is responding.
    if (!loadLysn().subscribedIds.includes(id)) return;
    appendLysn(id, rows);
    const latest = loadLysn();
    if (latest.settings.notificationsEnabled) {
      const character = loadCharacters().find(c => c.id === id);
      const name = latest.profiles[id]?.name || character?.name || "艺人";
      sendBrowserNotification(`${name} · LYSN`, { body: result.original.slice(0, 90), url: `/#lysn=${encodeURIComponent(id)}` });
      window.dispatchEvent(new CustomEvent("lysn-message-notice", { detail: { characterId: id, title: `${name} · LYSN`, body: result.original } }));
    }
  } catch {
    const latest = loadLysn();
    const hasArtistMessage = latest.messages.some(m => m.characterId === id && m.sender === "artist");
    latest.lastAutoAt[id] = Date.now() - (hasArtistMessage ? MESSAGE_INTERVAL_MS : FIRST_MESSAGE_WAIT_MS) + RETRY_WAIT_MS;
    saveLysn(latest);
  } finally { running = false; }
}
