import { useSyncExternalStore } from "react";
import { kvGet, kvSet, registerKvMigration } from "./kv-db";
import type { MusicTrack } from "./music-storage";

export type ListenEntry = { at: number; by: "user" | "character"; text: string; trackId?: string };
export type ListenSession = {
    id: string;
    characterId: string;
    startedAt: number;
    endedAt?: number;
    entries: ListenEntry[];
};

const KEY = "ai_phone_together_listening_v1";
export const TOGETHER_LISTENING_EVENT = "together-listening-changed";
registerKvMigration(KEY);
let cachedRaw: string | null = null;
let cached: ListenSession[] = [];
const empty: ListenSession[] = [];
let nextTrackActorUntil = 0;

export function markNextListenTrackAsCharacter() { nextTrackActorUntil = Date.now() + 10_000; }
export function consumeListenTrackActor(): ListenEntry["by"] {
    const character = Date.now() < nextTrackActorUntil;
    nextTrackActorUntil = 0;
    return character ? "character" : "user";
}

export function loadListenSessions(): ListenSession[] {
    if (typeof window === "undefined") return empty;
    const raw = kvGet(KEY);
    if (raw !== cachedRaw) {
        cachedRaw = raw;
        try {
            const parsed = JSON.parse(raw || "[]");
            cached = Array.isArray(parsed) ? parsed.filter(item => item && typeof item.characterId === "string") : [];
        } catch { cached = []; }
    }
    return cached;
}

function write(sessions: ListenSession[]) {
    cached = sessions.slice(0, 50);
    cachedRaw = JSON.stringify(cached);
    kvSet(KEY, cachedRaw);
    window.dispatchEvent(new Event(TOGETHER_LISTENING_EVENT));
}

export function activeListenSession(): ListenSession | null {
    return loadListenSessions().find(s => !s.endedAt) || null;
}

export function startListenSession(characterId: string): ListenSession {
    const active = activeListenSession();
    if (active?.characterId === characterId) return active;
    const now = Date.now();
    const old = loadListenSessions().map(s => s.endedAt ? s : { ...s, endedAt: now });
    const next: ListenSession = { id: `listen_${now}`, characterId, startedAt: now, entries: [] };
    write([next, ...old]);
    return next;
}

export function endListenSession(): void {
    if (!activeListenSession()) return;
    write(loadListenSessions().map(s => s.endedAt ? s : { ...s, endedAt: Date.now() }));
}

export function recordListenEntry(by: ListenEntry["by"], text: string, trackId?: string) {
    const active = activeListenSession();
    if (!active) return;
    const entry: ListenEntry = { at: Date.now(), by, text, ...(trackId ? { trackId } : {}) };
    write(loadListenSessions().map(s => s.id === active.id ? { ...s, entries: [...s.entries, entry].slice(-200) } : s));
}

export function recordListenTrack(track: MusicTrack, by: ListenEntry["by"]) {
    const active = activeListenSession();
    if (!active || active.entries.some((entry, index) => index === active.entries.length - 1 && entry.trackId === track.id)) return;
    recordListenEntry(by, `播放了「${track.title}」 · ${track.artist}`, track.id);
}

export function creditCharacterListenTrack(track: MusicTrack) {
    const active = activeListenSession();
    if (!active) return;
    const entries = [...active.entries];
    const last = entries[entries.length - 1];
    if (last?.trackId === track.id && Date.now() - last.at < 10_000) {
        entries[entries.length - 1] = { ...last, by: "character", text: `播放了「${track.title}」 · ${track.artist}` };
        write(loadListenSessions().map(s => s.id === active.id ? { ...s, entries } : s));
    } else recordListenTrack(track, "character");
}

export function canCharacterChangeListenTrack(): boolean {
    const active = activeListenSession();
    if (!active) return true;
    const last = [...active.entries].reverse().find(entry => entry.by === "character" && entry.trackId);
    return !last || Date.now() - last.at >= 180_000;
}

export function useListenSessions(): ListenSession[] {
    return useSyncExternalStore(
        callback => { window.addEventListener(TOGETHER_LISTENING_EVENT, callback); return () => window.removeEventListener(TOGETHER_LISTENING_EVENT, callback); },
        loadListenSessions,
        () => empty,
    );
}
