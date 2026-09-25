import { loadChatSessions, loadChatMessages, loadChatContacts } from "./chat-storage";
import { loadFriendRequests } from "./friend-request-storage";
import { loadSms, type SmsThread } from "./sms-storage";
const compact = (text: string, n = 130) => text.replace(/\s+/g, " ").trim().slice(0, n);
export function chatStatus(characterId: string): { blocked: boolean; recent: string[]; requests: string[] } {
  const contacts = loadChatContacts().filter(x => x.characterId === characterId);
  const session = loadChatSessions().find(s => !s.isGroup && (s.contactId === characterId || contacts.some(c => c.id === s.contactId)));
  const recent = session ? loadChatMessages(session.id, 8).filter(m => (m.role === "user" || m.role === "assistant") && !m.isRetracted && !m.mediaType).slice(-5).map(m => `${m.role === "user" ? "用户" : "角色"}: ${compact(m.content, 100)}`) : [];
  const requests = loadFriendRequests().filter(r => r.characterId === characterId).slice(-3).map(r => `${r.status}: ${compact(r.message, 55)}`);
  return { blocked: !!session?.isBlacklisted, recent, requests };
}
/** Only expose knowledge the character has acquired. Never put identity ownership in an unknown-number prompt. */
export function smsChatContext(characterId: string): string | null {
  const state = loadSms();
  const threads = state.threads.filter(t => t.characterId === characterId);
  const real = threads.find(t => t.identityId === "real");
  const known = threads.filter(t => t.identityId !== "real" && t.awareness === "confirmed");
  const unknown = threads.filter(t => t.identityId !== "real" && t.awareness !== "confirmed");
  const realMessages = real ? state.messages.filter(m => m.threadId === real.id && m.delivered).slice(-4).map(m => `${m.direction === "incoming" ? "我" : "用户"}: ${compact(m.original, 100)}`) : [];
  if (!realMessages.length && !known.length && !unknown.length) return null;
  return ["【短信近期认知；仅是角色已知信息】", ...(real?.summary ? [`已知真实号码的短信近况：${compact(real.summary, 300)}`] : []), ...realMessages, ...known.slice(-2).map(t => `已确认短信号码 ${t.number} 属于用户。`), ...unknown.slice(-2).map(t => t.awareness === "suspected" ? `陌生号码 ${t.number}：怀疑可能是用户，但没有证据。` : `陌生号码 ${t.number} 发过短信，身份未知。`)].join("\n").slice(0, 850);
}

