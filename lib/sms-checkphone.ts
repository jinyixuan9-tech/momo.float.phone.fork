import type { CheckPhoneMessagesPayload, CheckPhoneMessageThread } from "./checkphone-config";
import { loadSms } from "./sms-storage";
import { resolveUserIdentity } from "./settings-storage";

/** Ten rows are a view of the phone, never its full database. Real conversation gets one slot;
 * virtual numbers share at most two. The remaining slots stay available to generated life. */
export function mergeSmsIntoCheckPhone(characterId: string, payload: CheckPhoneMessagesPayload): CheckPhoneMessagesPayload {
  const state = loadSms();
  const virtual = state.threads.filter(t => t.characterId === characterId && t.identityId !== "real" && state.messages.some(m => m.threadId === t.id && m.delivered))
    .sort((a,b) => b.updatedAt-a.updatedAt).slice(0, 2);
  const real = state.threads.find(t => t.characterId === characterId && t.identityId === "real" && state.messages.some(m => m.threadId === t.id && m.delivered));
  const selected = [...(real ? [real] : []), ...virtual];
  const projected: CheckPhoneMessageThread[] = selected.map(t => {
    const records = state.messages.filter(m => m.threadId === t.id && m.delivered).slice(-32);
    const last = records.at(-1)!;
    const label = t.identityId === "real" ? resolveUserIdentity(characterId, "chat")?.name || state.realNumber || "用户" : t.number || "陌生号码";
    return { id: `sms:${t.id}`, sender: label, preview: last.original, timeLabel: new Date(last.createdAt).toLocaleString("zh-CN", {month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"}), kind: "personal", messages: records.map(m => ({ id:m.id, text:m.translated && m.direction==="incoming" && m.translated!==m.original ? `${m.original}\n${m.translated}` : m.original, timeLabel:new Date(m.createdAt).toLocaleTimeString("zh-CN",{hour:"2-digit",minute:"2-digit"}), direction: m.direction === "outgoing" ? "incoming" : "outgoing" })) };
  });
  const generated = payload.threads.filter(t => !t.id.startsWith("sms:"));
  const limit = 10;
  return { ...payload, threads: [...projected, ...generated.slice(0, limit-projected.length)], featuredThreadId: projected[0]?.id ?? generated[0]?.id };
}
