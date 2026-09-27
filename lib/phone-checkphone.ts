import type { CheckPhonePhonePayload, CheckPhoneCallLog } from "./checkphone-config";
import { loadPhoneState } from "./phone-storage";
import { resolveUserIdentity } from "./settings-storage";

function durationLabel(sec: number): string {
  if (sec <= 0) return "未接通";
  const m = Math.floor(sec / 60); const s = sec % 60;
  return m > 0 ? `${m}分${s.toString().padStart(2,"0")}秒` : `${s}秒`;
}

/** Merge real Phone-app calls into the character's generated check-phone log. */
export function mergeNativePhoneIntoCheckPhone(characterId: string, payload: CheckPhonePhonePayload): CheckPhonePhonePayload {
  const userName = resolveUserIdentity(characterId, "chat")?.name || "用户";
  const actual: CheckPhoneCallLog[] = loadPhoneState().calls
    .filter(call => call.characterId === characterId)
    .map(call => {
      const fromUser = call.direction === "outgoing";
      const direction: CheckPhoneCallLog["direction"] = fromUser
        ? (call.status === "missed" || call.status === "canceled" ? "missed" : "incoming")
        : "outgoing";
      const spoken = call.transcript.filter(line => line.role === "assistant").map(line => line.original).join(" ").slice(0, 120);
      return {
        id: `native:${call.id}`,
        name: userName,
        createdAt: new Date(call.startedAt).toISOString(),
        durationLabel: durationLabel(call.durationSec),
        direction,
        summary: spoken || (call.status === "completed" ? "与用户的真实通话记录" : "未接通"),
        innerThought: "这是实际发生并同步到本机的通话记录。",
      };
    });
  const generated = payload.recents.filter(item => !item.id.startsWith("native:"));
  const recents = [...actual, ...generated].sort((a,b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 80);
  return { ...payload, recents };
}
