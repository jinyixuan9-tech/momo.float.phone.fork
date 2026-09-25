import { kvGet, kvSet, registerKvMigration } from "./kv-db";
import { loadCharacters } from "./character-storage";

export const SMS_STORAGE_KEY = "ai_phone_sms_v1";
export const SMS_UPDATED_EVENT = "sms-updated";
registerKvMigration(SMS_STORAGE_KEY);

export type SmsProactiveFrequency = "off" | "rare" | "normal" | "often";
export type SmsRecognitionState = "unknown" | "suspected" | "confirmed";
export type SmsSenderIdentityId = "real" | `virtual:${string}`;
export type SmsMessageStatus = "sent" | "delivered" | "read" | "blocked" | "failed";

export type SmsVirtualNumber = {
  id: string;
  country: SmsCountryCode;
  countryName: string;
  phone: string;
  label: string;
  createdAt: number;
};

export type SmsThread = {
  id: string;
  characterId: string;
  senderIdentityId: SmsSenderIdentityId;
  createdAt: number;
  updatedAt: number;
  unreadCount: number;
  blockedByUser?: boolean;
  blockedByCharacter?: boolean;
  recognition: SmsRecognitionState;
  recognitionNote?: string;
  lastProactiveAt?: number;
};

export type SmsMessage = {
  id: string;
  threadId: string;
  sender: "user" | "character" | "system";
  original: string;
  translated?: string;
  createdAt: number;
  status: SmsMessageStatus;
  proactive?: boolean;
};

export type SmsSettings = {
  userPhone: string;
  userPhoneCountry: SmsCountryCode;
  proactiveFrequency: SmsProactiveFrequency;
  translationEnabled: boolean;
};

export type SmsState = {
  version: 1;
  settings: SmsSettings;
  characterPhones: Record<string, { phone: string; country: SmsCountryCode }>;
  virtualNumbers: SmsVirtualNumber[];
  threads: SmsThread[];
  messages: SmsMessage[];
};

export type SmsCountryCode = "CN" | "KR" | "JP" | "SG" | "US" | "GB" | "AU" | "CA";

export const SMS_COUNTRIES: Array<{ code: SmsCountryCode; label: string; dial: string; sample: string }> = [
  { code: "CN", label: "中国", dial: "+86", sample: "+86 138 1234 5678" },
  { code: "KR", label: "韩国", dial: "+82", sample: "+82 10-1234-5678" },
  { code: "JP", label: "日本", dial: "+81", sample: "+81 90-1234-5678" },
  { code: "SG", label: "新加坡", dial: "+65", sample: "+65 8123 4567" },
  { code: "US", label: "美国", dial: "+1", sample: "+1 (415) 555-0123" },
  { code: "CA", label: "加拿大", dial: "+1", sample: "+1 (604) 555-0123" },
  { code: "GB", label: "英国", dial: "+44", sample: "+44 7700 900123" },
  { code: "AU", label: "澳大利亚", dial: "+61", sample: "+61 412 345 678" },
];

const DEFAULT_SETTINGS: SmsSettings = {
  userPhone: "",
  userPhoneCountry: "CN",
  proactiveFrequency: "normal",
  translationEnabled: true,
};

function emptyState(): SmsState {
  return {
    version: 1,
    settings: { ...DEFAULT_SETTINGS },
    characterPhones: {},
    virtualNumbers: [],
    threads: [],
    messages: [],
  };
}

function isCountry(value: unknown): value is SmsCountryCode {
  return SMS_COUNTRIES.some(item => item.code === value);
}

function normalizeIdentityId(value: unknown): SmsSenderIdentityId {
  return typeof value === "string" && (value === "real" || value.startsWith("virtual:"))
    ? value as SmsSenderIdentityId
    : "real";
}

export function loadSmsState(): SmsState {
  if (typeof window === "undefined") return emptyState();
  try {
    const raw = kvGet(SMS_STORAGE_KEY);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw) as Partial<SmsState>;
    const virtualNumbers = Array.isArray(parsed.virtualNumbers)
      ? parsed.virtualNumbers.filter(row => row && typeof row.id === "string" && typeof row.phone === "string" && isCountry(row.country))
      : [];
    const validVirtualIds = new Set(virtualNumbers.map(row => row.id));
    const threads = Array.isArray(parsed.threads)
      ? parsed.threads
          .filter(row => row && typeof row.id === "string" && typeof row.characterId === "string")
          .map(row => ({
            ...row,
            senderIdentityId: normalizeIdentityId(row.senderIdentityId),
            recognition: (row.recognition === "suspected" || row.recognition === "confirmed" ? row.recognition : "unknown") as SmsRecognitionState,
            unreadCount: Math.max(0, Number(row.unreadCount) || 0),
            createdAt: Number(row.createdAt) || Date.now(),
            updatedAt: Number(row.updatedAt) || Number(row.createdAt) || Date.now(),
          }))
          .filter(row => row.senderIdentityId === "real" || validVirtualIds.has(row.senderIdentityId.slice("virtual:".length)))
      : [];
    const threadIds = new Set(threads.map(row => row.id));
    const messages = Array.isArray(parsed.messages)
      ? parsed.messages.filter(row => row && typeof row.id === "string" && threadIds.has(row.threadId) && typeof row.original === "string")
      : [];
    const characterPhones: SmsState["characterPhones"] = {};
    if (parsed.characterPhones && typeof parsed.characterPhones === "object") {
      for (const [id, row] of Object.entries(parsed.characterPhones)) {
        if (!row || typeof row !== "object") continue;
        const phone = typeof row.phone === "string" ? row.phone.trim() : "";
        const country = isCountry(row.country) ? row.country : "CN";
        if (phone) characterPhones[id] = { phone, country };
      }
    }
    const freq = parsed.settings?.proactiveFrequency;
    return {
      version: 1,
      settings: {
        ...DEFAULT_SETTINGS,
        ...(parsed.settings || {}),
        userPhone: typeof parsed.settings?.userPhone === "string" ? parsed.settings.userPhone : "",
        userPhoneCountry: isCountry(parsed.settings?.userPhoneCountry) ? parsed.settings.userPhoneCountry : "CN",
        proactiveFrequency: freq === "off" || freq === "rare" || freq === "often" ? freq : "normal",
        translationEnabled: parsed.settings?.translationEnabled !== false,
      },
      characterPhones,
      virtualNumbers,
      threads,
      messages,
    };
  } catch {
    return emptyState();
  }
}

export function saveSmsState(state: SmsState): void {
  if (typeof window === "undefined") return;
  kvSet(SMS_STORAGE_KEY, JSON.stringify(state));
  window.dispatchEvent(new Event(SMS_UPDATED_EVENT));
}

export function smsId(prefix = "sms"): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

export function getThreadId(characterId: string, senderIdentityId: SmsSenderIdentityId): string {
  return `sms_thread:${characterId}:${senderIdentityId}`;
}

export function ensureSmsThread(characterId: string, senderIdentityId: SmsSenderIdentityId = "real"): SmsThread {
  const state = loadSmsState();
  const id = getThreadId(characterId, senderIdentityId);
  let thread = state.threads.find(row => row.id === id);
  if (!thread) {
    const now = Date.now();
    thread = {
      id,
      characterId,
      senderIdentityId,
      createdAt: now,
      updatedAt: now,
      unreadCount: 0,
      recognition: senderIdentityId === "real" ? "confirmed" : "unknown",
    };
    state.threads.push(thread);
    saveSmsState(state);
  }
  return thread;
}

export function getSmsThread(threadId: string): SmsThread | null {
  return loadSmsState().threads.find(row => row.id === threadId) ?? null;
}

export function getSmsThreads(characterId?: string): SmsThread[] {
  return loadSmsState().threads
    .filter(row => !characterId || row.characterId === characterId)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getSmsMessages(threadId: string): SmsMessage[] {
  return loadSmsState().messages.filter(row => row.threadId === threadId).sort((a, b) => a.createdAt - b.createdAt);
}

export function appendSmsMessage(
  threadId: string,
  input: Omit<SmsMessage, "id" | "threadId" | "createdAt"> & { createdAt?: number },
): SmsMessage {
  const state = loadSmsState();
  const thread = state.threads.find(row => row.id === threadId);
  if (!thread) throw new Error("短信会话不存在。");
  const message: SmsMessage = {
    ...input,
    id: smsId("msg"),
    threadId,
    createdAt: input.createdAt ?? Date.now(),
  };
  state.messages.push(message);
  thread.updatedAt = Math.max(thread.updatedAt, message.createdAt);
  if (message.sender === "character") thread.unreadCount = (thread.unreadCount || 0) + 1;
  saveSmsState(state);
  return message;
}

export function markSmsThreadRead(threadId: string): void {
  const state = loadSmsState();
  const thread = state.threads.find(row => row.id === threadId);
  if (!thread || thread.unreadCount === 0) return;
  thread.unreadCount = 0;
  for (const message of state.messages) {
    if (message.threadId === threadId && message.sender === "character" && message.status !== "blocked") message.status = "read";
  }
  saveSmsState(state);
}

export function updateSmsThread(threadId: string, patch: Partial<Pick<SmsThread, "blockedByUser" | "blockedByCharacter" | "recognition" | "recognitionNote" | "lastProactiveAt">>): void {
  const state = loadSmsState();
  const thread = state.threads.find(row => row.id === threadId);
  if (!thread) return;
  Object.assign(thread, patch);
  thread.updatedAt = Math.max(thread.updatedAt, Date.now());
  saveSmsState(state);
}

export function deleteSmsThread(threadId: string): void {
  const state = loadSmsState();
  state.threads = state.threads.filter(row => row.id !== threadId);
  state.messages = state.messages.filter(row => row.threadId !== threadId);
  saveSmsState(state);
}

export function updateSmsSettings(patch: Partial<SmsSettings>): void {
  const state = loadSmsState();
  state.settings = { ...state.settings, ...patch };
  saveSmsState(state);
}

export function setCharacterSmsPhone(characterId: string, phone: string, country: SmsCountryCode = "CN"): void {
  const state = loadSmsState();
  const value = phone.trim();
  if (!value) delete state.characterPhones[characterId];
  else state.characterPhones[characterId] = { phone: value, country };
  saveSmsState(state);
}

export function getCharacterSmsPhone(characterId: string): { phone: string; country: SmsCountryCode } {
  const state = loadSmsState();
  const saved = state.characterPhones[characterId];
  if (saved?.phone) return saved;
  const char = loadCharacters().find(row => row.id === characterId);
  const fallback = String(char?.wechatID || "").trim();
  return { phone: fallback, country: "CN" };
}

const rand = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
const digits = (count: number) => Array.from({ length: count }, () => rand(0, 9)).join("");

export function generateVirtualPhone(country: SmsCountryCode): string {
  if (country === "CN") {
    const prefix = ["130", "131", "132", "135", "136", "137", "138", "150", "156", "157", "158", "166", "176", "186", "188", "199"][rand(0, 15)];
    const rest = digits(8);
    return `+86 ${prefix} ${rest.slice(0, 4)} ${rest.slice(4)}`;
  }
  if (country === "KR") return `+82 10-${digits(4)}-${digits(4)}`;
  if (country === "JP") return `+81 ${["70", "80", "90"][rand(0, 2)]}-${digits(4)}-${digits(4)}`;
  if (country === "SG") return `+65 ${[8, 9][rand(0, 1)]}${digits(3)} ${digits(4)}`;
  if (country === "GB") return `+44 7${digits(3)} ${digits(6)}`;
  if (country === "AU") return `+61 4${digits(2)} ${digits(3)} ${digits(3)}`;
  const areas = country === "CA" ? ["416", "604", "647", "778"] : ["212", "310", "415", "646", "917"];
  const area = areas[rand(0, areas.length - 1)];
  return `+1 (${area}) ${rand(200, 899)}-${digits(4)}`;
}

export function createVirtualNumber(country: SmsCountryCode): SmsVirtualNumber {
  const state = loadSmsState();
  const meta = SMS_COUNTRIES.find(row => row.code === country) || SMS_COUNTRIES[0];
  const sameCountryCount = state.virtualNumbers.filter(row => row.country === country).length;
  const row: SmsVirtualNumber = {
    id: smsId("virtual"),
    country,
    countryName: meta.label,
    phone: generateVirtualPhone(country),
    label: `${meta.label}小号${sameCountryCount ? ` ${sameCountryCount + 1}` : ""}`,
    createdAt: Date.now(),
  };
  state.virtualNumbers.push(row);
  saveSmsState(state);
  return row;
}

export function deleteVirtualNumber(id: string): boolean {
  const state = loadSmsState();
  const identityId = `virtual:${id}`;
  if (state.threads.some(row => row.senderIdentityId === identityId)) return false;
  state.virtualNumbers = state.virtualNumbers.filter(row => row.id !== id);
  saveSmsState(state);
  return true;
}

export function getSmsSenderPhone(thread: SmsThread, state = loadSmsState()): string {
  if (thread.senderIdentityId === "real") return state.settings.userPhone.trim() || "我的号码";
  const id = thread.senderIdentityId.slice("virtual:".length);
  return state.virtualNumbers.find(row => row.id === id)?.phone || "虚拟号码";
}

export type SmsProjectionEntry = { id: string; timestamp: string; content: string };

/**
 * SMS raw history stays in its own DB. The shared memory timeline only receives a small
 * role-knowledge-safe projection, one compact entry per recent thread. This prevents SMS
 * chatter and multiple virtual numbers from multiplying prompt size.
 */
export function loadSmsProjectionEntries(
  characterId: string,
  options?: { afterTimestamp?: string; userName?: string; charName?: string; excludeThreadId?: string },
): SmsProjectionEntry[] {
  const state = loadSmsState();
  const threads = state.threads
    .filter(row => row.characterId === characterId && row.id !== options?.excludeThreadId)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 4);
  const afterMs = options?.afterTimestamp ? new Date(options.afterTimestamp).getTime() : 0;
  const userName = options?.userName || "用户";
  const charName = options?.charName || "角色";
  const result: SmsProjectionEntry[] = [];
  for (const thread of threads) {
    if (afterMs && thread.updatedAt <= afterMs) continue;
    const rows = state.messages.filter(row => row.threadId === thread.id).sort((a, b) => a.createdAt - b.createdAt).slice(-8);
    if (!rows.length) continue;
    const senderPhone = getSmsSenderPhone(thread, state);
    let identityDescription = `陌生号码 ${senderPhone}`;
    if (thread.senderIdentityId === "real") identityDescription = `${userName}（${senderPhone}）`;
    else if (thread.recognition === "confirmed") identityDescription = `${userName}使用的虚拟号码 ${senderPhone}`;
    else if (thread.recognition === "suspected") identityDescription = `陌生号码 ${senderPhone}（${charName}怀疑可能与${userName}有关，但尚未确认）`;
    const snippets = rows.map(row => {
      const speaker = row.sender === "character" ? charName : row.sender === "user" ? identityDescription : "系统";
      const text = row.original.replace(/\s+/g, " ").trim().slice(0, 180);
      return `${speaker}: ${text}`;
    }).join("\n");
    const block = [
      `短信线程：${identityDescription}`,
      thread.blockedByCharacter ? `${charName}已屏蔽该号码。` : "",
      thread.blockedByUser ? `${userName}已在短信中屏蔽${charName}。` : "",
      snippets,
    ].filter(Boolean).join("\n").slice(0, 1200);
    result.push({ id: `sms_projection:${thread.id}`, timestamp: new Date(thread.updatedAt).toISOString(), content: block });
  }
  return result.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}
