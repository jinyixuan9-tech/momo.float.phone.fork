import { loadCharacters } from "./character-storage";
import { addFriendRequest, dispatchFriendRequestUpdated, loadFriendRequests } from "./friend-request-storage";
import { loadChatSessions, pushChatMessage } from "./chat-storage";
import { chatStatus } from "./sms-continuity";
import { generateSmsReply } from "./sms-engine";
import { addSmsMessage, ensureSmsThread, loadSms, saveSms, phoneFromPersona, smsId } from "./sms-storage";

let running = false;
/** Shared contact budget includes recent friend requests so the two channels do not pile up. */
export async function maybeGenerateSmsBackgroundMessage(): Promise<void> {
  if (running || typeof window === "undefined" || document.visibilityState !== "visible") return;
  const state = loadSms();
  if (state.proactive === "off" || !state.realNumber.trim()) return;
  const interval = { rare: 24*3600_000, normal: 8*3600_000, often: 3*3600_000, off: Infinity }[state.proactive];
  const now = Date.now();
  const requests = loadFriendRequests();
  const candidates = loadCharacters().filter(c => {
    const thread = state.threads.find(t => t.characterId === c.id && t.identityId === "real");
    const related = !!thread || chatStatus(c.id).blocked;
    if (!related || thread?.blockedByMe) return false;
    const recentRequest = requests.some(r => r.characterId === c.id && now-Date.parse(r.createdAt)<Math.min(interval, 3*3600_000));
    return !recentRequest && now-(state.lastAutoAt[c.id] || 0)>interval && now-(state.contactAttempts[c.id] || 0)>Math.min(interval, 3600_000);
  });
  if (!candidates.length) return;
  const character = candidates[Math.floor(Math.random()*candidates.length)];
  running = true;
  const initial = loadSms(); initial.lastAutoAt[character.id] = now; saveSms(initial);
  try {
    const thread = ensureSmsThread(initial, character.id, "real", initial.characterNumbers[character.id] || phoneFromPersona(character.persona) || "");
    const response = await generateSmsReply(thread, initial, "proactive");
    if (response.channel === "wait") return;
    if (response.channel === "request" && response.requestMessage && chatStatus(character.id).blocked) {
      const existing = loadFriendRequests().filter(r => r.characterId === character.id && now-Date.parse(r.createdAt)<24*3600_000);
      if (existing.some(r => r.status === "pending") || existing.length >= 3) return;
      addFriendRequest(character.id, response.requestMessage, existing.length + 1);
      const session = loadChatSessions().find(s => !s.isGroup && s.contactId === character.id);
      if (session) pushChatMessage({ sessionId: session.id, role: "system", content: `${character.name}尝试重新添加 Chat 好友，附言：${response.requestMessage}` });
      const afterRequest = loadSms(); afterRequest.contactAttempts[character.id] = Date.now(); saveSms(afterRequest);
      dispatchFriendRequestUpdated();
      return;
    }
    if (!response.messages.length) return;
    const fresh = loadSms(); const live = ensureSmsThread(fresh, character.id, "real", fresh.characterNumbers[character.id] || phoneFromPersona(character.persona) || "");
    if (live.blockedByMe) return;
    if (response.summary) live.summary = response.summary;
    const batchId = smsId();
    response.messages.forEach(m=>addSmsMessage(fresh,live,"incoming",m.original,m.translated,batchId));
    response.reactions?.forEach(reaction => { const target = fresh.messages.find(m => m.id === reaction.messageId && m.threadId === live.id && m.direction === "outgoing"); if (target) target.reactions = [...(target.reactions ?? []), { id: smsId(), emoji: reaction.emoji, by: "character" }]; });
    fresh.contactAttempts[character.id] = Date.now();saveSms(fresh);
  } catch { /* A failed background generation can be retried after the interval. */ }
  finally { running = false; }
}
