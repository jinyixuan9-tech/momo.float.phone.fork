import { kvGet, kvSet, registerKvMigration } from "./kv-db";
import { loadSms, saveSms, phoneFromPersona } from "./sms-storage";
import { loadCharacters } from "./character-storage";

export const PHONE_KEY = "ai_phone_native_phone_v1";
export const PHONE_EVENT = "phone-updated";
registerKvMigration(PHONE_KEY);

export type PhoneCallStatus = "completed" | "missed" | "declined" | "canceled" | "busy";
export type PhoneCallDirection = "incoming" | "outgoing";
export type PhoneTranscriptLine = {
  id: string;
  role: "user" | "assistant";
  original: string;
  translated?: string;
  createdAt: number;
  audioRef?: string;
};
export type PhoneCallRecord = {
  id: string;
  characterId: string;
  number: string;
  direction: PhoneCallDirection;
  status: PhoneCallStatus;
  startedAt: number;
  connectedAt?: number;
  endedAt: number;
  durationSec: number;
  favorite?: boolean;
  transcript: PhoneTranscriptLine[];
  source?: "phone" | "chat" | "sms" | "system";
};
export type PhoneState = { version: 1; calls: PhoneCallRecord[] };

const empty = (): PhoneState => ({ version: 1, calls: [] });
export function loadPhoneState(): PhoneState {
  try {
    const raw = kvGet(PHONE_KEY);
    if (!raw) return empty();
    const parsed = JSON.parse(raw) as Partial<PhoneState>;
    return { version: 1, calls: Array.isArray(parsed.calls) ? parsed.calls : [] };
  } catch { return empty(); }
}
export function savePhoneState(state: PhoneState): void {
  kvSet(PHONE_KEY, JSON.stringify(state));
  if (typeof window !== "undefined") window.dispatchEvent(new Event(PHONE_EVENT));
}
export function phoneId(prefix = "call"): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}
export function getUserPhoneNumber(): string { return loadSms().realNumber || ""; }
export function setUserPhoneNumber(number: string): void {
  const sms = loadSms();
  sms.realNumber = number.trim();
  sms.threads.filter(thread => thread.identityId === "real").forEach(thread => { thread.number = sms.realNumber; });
  saveSms(sms);
  if (typeof window !== "undefined") window.dispatchEvent(new Event(PHONE_EVENT));
}
export function getCharacterPhoneNumber(characterId: string): string {
  const sms = loadSms();
  const existing = sms.characterNumbers[characterId];
  if (existing) return existing;
  const character = loadCharacters().find(c => c.id === characterId);
  const fromPersona = character ? phoneFromPersona(character.persona || "") : "";
  if (fromPersona) {
    sms.characterNumbers[characterId] = fromPersona;
    saveSms(sms);
  }
  return fromPersona;
}
export function setCharacterPhoneNumber(characterId: string, number: string): void {
  const sms = loadSms();
  sms.characterNumbers[characterId] = number.trim();
  sms.threads.filter(thread => thread.characterId === characterId).forEach(thread => { thread.characterNumber = sms.characterNumbers[characterId]; });
  saveSms(sms);
  if (typeof window !== "undefined") window.dispatchEvent(new Event(PHONE_EVENT));
}
export function appendPhoneCall(record: PhoneCallRecord): void {
  const state = loadPhoneState();
  const idx = state.calls.findIndex(c => c.id === record.id);
  if (idx >= 0) state.calls[idx] = record;
  else state.calls.unshift(record);
  state.calls = state.calls.slice(0, 500);
  savePhoneState(state);
}
export function togglePhoneFavorite(callId: string): void {
  const state = loadPhoneState();
  const call = state.calls.find(c => c.id === callId);
  if (!call) return;
  call.favorite = !call.favorite;
  savePhoneState(state);
}
