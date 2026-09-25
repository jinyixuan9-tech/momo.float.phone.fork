import { loadCharacters } from "./character-storage";
import { loadChatMessages, loadChatSessions } from "./chat-storage";
import { getLatestRequestForCharacter } from "./friend-request-storage";
import { generateProactiveSms } from "./sms-engine";
import { appendSmsMessage, ensureSmsThread, loadSmsState, updateSmsThread } from "./sms-storage";
import { sendBrowserNotification } from "./browser-notification";

let running = false;

/**
 * Low-frequency native SMS scheduler. It checks at most one character per pass and
 * only calls the model after a local cooldown check, so keeping SMS enabled does not
 * create a request every minute.
 */
export async function maybeGenerateSmsBackgroundMessage(): Promise<void> {
  if (running || typeof window === "undefined") return;
  const state = loadSmsState();
  const freq = state.settings.proactiveFrequency;
  if (freq === "off") return;
  const now = Date.now();
  const minHours = { rare: 36, normal: 12, often: 4 }[freq];
  const chars = loadCharacters();
  const sessions = loadChatSessions();

  const candidate = chars.find(character => {
    const realThread = state.threads.find(row => row.characterId === character.id && row.senderIdentityId === "real");
    const chat = sessions.find(row => !row.isGroup && row.contactId === character.id);
    const latestRequest = getLatestRequestForCharacter(character.id);
    const hasReconnectReason = Boolean(chat?.isBlacklisted || latestRequest?.status === "pending");
    if (!realThread && !hasReconnectReason) return false;

    // Do not fire a friend request and an SMS at the same instant. Give a newly
    // pending Chat request some room; if the user keeps ignoring it, SMS becomes
    // another available route later.
    let reconnectEventAt = 0;
    if (latestRequest?.status === "pending") {
      const requestAt = new Date(latestRequest.createdAt).getTime();
      reconnectEventAt = Math.max(reconnectEventAt, requestAt);
      const requestAge = now - requestAt;
      if (requestAge < 2 * 3600000) return false;
    }
    if (chat?.isBlacklisted) {
      const blockMessage = loadChatMessages(chat.id).filter(message => message.role === "system" && message.mediaData?.blacklistEvent === "block").at(-1);
      if (blockMessage) {
        const blockAt = new Date(blockMessage.createdAt).getTime();
        reconnectEventAt = Math.max(reconnectEventAt, blockAt);
        const blockAge = now - blockAt;
        if (blockAge < 10 * 60000) return false;
      }
    }
    if (realThread?.blockedByUser || realThread?.blockedByCharacter) return false;
    const latestChar = realThread
      ? state.messages.filter(row => row.threadId === realThread.id && row.sender === "character").at(-1)?.createdAt || 0
      : 0;
    const lastAttempt = realThread?.lastProactiveAt || 0;
    // A fresh reconnect event may pull the *first* SMS attempt forward. Once the
    // character has already used SMS after that event, return to the user's normal
    // proactive frequency instead of pestering them every two hours.
    const alreadyUsedSmsForReconnect = reconnectEventAt > 0 && latestChar >= reconnectEventAt;
    const interval = hasReconnectReason && !alreadyUsedSmsForReconnect ? Math.min(minHours, 2) : minHours;
    return now - Math.max(latestChar, lastAttempt) >= interval * 3600000;
  });
  if (!candidate) return;

  const thread = ensureSmsThread(candidate.id, "real");
  updateSmsThread(thread.id, { lastProactiveAt: now });
  running = true;
  try {
    const result = await generateProactiveSms(candidate.id, true);
    if (!result.send) return;
    for (const row of result.messages) {
      appendSmsMessage(thread.id, {
        sender: "character",
        original: row.original,
        translated: row.translated,
        status: "delivered",
        proactive: true,
      });
    }
    const first = result.messages[0]?.original || "新短信";
    sendBrowserNotification(`${candidate.name} · 信息`, { body: first.slice(0, 90), url: "/" });
    window.dispatchEvent(new CustomEvent("sms-message-notice", { detail: { characterId: candidate.id, title: `${candidate.name} · 信息`, body: first } }));
  } catch {
    // Keep the recorded attempt timestamp so a broken API does not retry every minute.
  } finally {
    running = false;
  }
}
