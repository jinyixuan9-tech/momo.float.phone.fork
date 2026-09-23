import { kvGet, kvKeysWithPrefix, kvRemove, kvSet, registerDynamicPrefix } from "./kv-db";
import { formatChatTimestamp } from "./llm-prompt-assembler";

const WEV_EVENT_PREFIX = "ai_phone_weverse_events_";
const MAX_EVENTS_PER_CHARACTER = 120;

registerDynamicPrefix(WEV_EVENT_PREFIX);

export type WeverseProjectionEntry = {
  id: string;
  timestamp: string;
  content: string;
  postId?: string;
  commentId?: string;
};

function storageKey(characterId: string): string {
  return `${WEV_EVENT_PREFIX}${characterId}`;
}

function cleanText(value: unknown, maxLength: number): string {
  const text = String(value ?? "").replace(/\r\n?/g, "\n").replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function loadEventsByKey(key: string): WeverseProjectionEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = kvGet(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is WeverseProjectionEntry => Boolean(entry)
        && typeof (entry as Partial<WeverseProjectionEntry>).id === "string"
        && typeof (entry as Partial<WeverseProjectionEntry>).timestamp === "string"
        && typeof (entry as Partial<WeverseProjectionEntry>).content === "string")
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  } catch {
    return [];
  }
}

function saveEventsByKey(key: string, events: WeverseProjectionEntry[]): void {
  if (typeof window === "undefined") return;
  const compacted = [...events].sort((a, b) => a.timestamp.localeCompare(b.timestamp)).slice(-MAX_EVENTS_PER_CHARACTER);
  kvSet(key, JSON.stringify(compacted));
}

function upsert(characterId: string, entry: WeverseProjectionEntry): void {
  const key = storageKey(characterId);
  const current = loadEventsByKey(key);
  saveEventsByKey(key, [...current.filter((item) => item.id !== entry.id), entry]);
}

export function recordWeverseArtistPostEvent(input: {
  characterId: string;
  characterName: string;
  communityName: string;
  postId: string;
  body: string;
  originalBody?: string;
  hasPhoto?: boolean;
  timestamp?: string;
}): void {
  const timestamp = input.timestamp || new Date().toISOString();
  const name = cleanText(input.characterName, 80) || "角色";
  const community = cleanText(input.communityName, 80) || "Community";
  const body = cleanText(input.originalBody || input.body, 520);
  if (!body && !input.hasPhoto) return;
  upsert(input.characterId, {
    id: `weverse_post_${input.postId}`,
    postId: input.postId,
    timestamp,
    content: `[Weverse ${formatChatTimestamp(timestamp)}] ${name}在「${community}」Community 发布了 Artist Post${body ? `：“${body}”` : ""}${input.hasPhoto ? "，并附带了一张照片" : ""}。`,
  });
}

export function recordWeverseArtistReplyEvent(input: {
  characterId: string;
  characterName: string;
  communityName: string;
  postId: string;
  commentId: string;
  targetName: string;
  targetBody?: string;
  replyBody: string;
  timestamp?: string;
}): void {
  const timestamp = input.timestamp || new Date().toISOString();
  const name = cleanText(input.characterName, 80) || "角色";
  const target = cleanText(input.targetName, 80) || "粉丝";
  const reply = cleanText(input.replyBody, 360);
  if (!reply) return;
  upsert(input.characterId, {
    id: `weverse_reply_${input.commentId}`,
    postId: input.postId,
    commentId: input.commentId,
    timestamp,
    content: `[Weverse ${formatChatTimestamp(timestamp)}] ${name}在「${cleanText(input.communityName, 80) || "Community"}」回复了${target}${input.targetBody ? `的内容“${cleanText(input.targetBody, 220)}”` : ""}，回复：“${reply}”。`,
  });
}

export function deleteWeverseProjectionEventForComment(commentId: string): void {
  if (!commentId || typeof window === "undefined") return;
  for (const key of kvKeysWithPrefix(WEV_EVENT_PREFIX)) {
    const current = loadEventsByKey(key);
    const next = current.filter((entry) => entry.commentId !== commentId && entry.id !== `weverse_reply_${commentId}`);
    if (next.length === current.length) continue;
    if (next.length === 0) kvRemove(key);
    else saveEventsByKey(key, next);
  }
}

export function deleteWeverseProjectionEventsForPost(postId: string): void {
  if (!postId || typeof window === "undefined") return;
  for (const key of kvKeysWithPrefix(WEV_EVENT_PREFIX)) {
    const current = loadEventsByKey(key);
    const next = current.filter((entry) => entry.postId !== postId && entry.id !== `weverse_post_${postId}`);
    if (next.length === current.length) continue;
    if (next.length === 0) kvRemove(key);
    else saveEventsByKey(key, next);
  }
}

export function loadWeverseProjectionEntries(characterId: string, options?: { afterTimestamp?: string }): WeverseProjectionEntry[] {
  const entries = loadEventsByKey(storageKey(characterId));
  if (!options?.afterTimestamp) return entries;
  return entries.filter((entry) => entry.timestamp > options.afterTimestamp!);
}

export function recordWeverseLiveParticipationEvent(input: {
  liveId: string;
  characterId: string;
  characterName: string;
  communityName: string;
  startedAt: number;
  endedAt?: number;
  role: "host" | "guest";
  coParticipants?: string[];
  ownSpeech?: string[];
  title?: string;
}): void {
  const timestamp = new Date(input.endedAt || input.startedAt || Date.now()).toISOString();
  const name = cleanText(input.characterName, 80) || "角色";
  const community = cleanText(input.communityName, 80) || "Community";
  const others = (input.coParticipants || []).map((item) => cleanText(item, 60)).filter(Boolean).slice(0, 5);
  const speech = (input.ownSpeech || []).map((item) => cleanText(item, 130)).filter(Boolean).slice(-3);
  const pieces = [
    `[Weverse LIVE ${formatChatTimestamp(timestamp)}] ${name}${input.role === "host" ? "开了" : "中途加入了"}「${community}」Community 的一场 LIVE${input.title ? `（${cleanText(input.title, 100)}）` : ""}`,
    others.length ? `，同场还有${others.join("、")}` : "",
    speech.length ? `。期间自己说过：${speech.map((item) => `“${item}”`).join("、")}` : "",
    "。",
  ];
  upsert(input.characterId, {
    id: `weverse_live_participant_${input.liveId}_${input.characterId}`,
    timestamp,
    content: pieces.join(""),
  });
}

export function recordWeverseLiveViewerEvent(input: {
  liveId: string;
  characterId: string;
  characterName: string;
  communityName: string;
  hostNames: string[];
  watchedAt: number;
  comments?: string[];
  title?: string;
}): void {
  const timestamp = new Date(input.watchedAt || Date.now()).toISOString();
  const name = cleanText(input.characterName, 80) || "角色";
  const hosts = input.hostNames.map((item) => cleanText(item, 60)).filter(Boolean).slice(0, 5);
  const comments = (input.comments || []).map((item) => cleanText(item, 150)).filter(Boolean).slice(-3);
  upsert(input.characterId, {
    id: `weverse_live_viewer_${input.liveId}_${input.characterId}`,
    timestamp,
    content: `[Weverse LIVE ${formatChatTimestamp(timestamp)}] ${name}作为普通观众看过${hosts.length ? `${hosts.join("、")}的` : "一场"}「${cleanText(input.communityName, 80) || "Community"}」LIVE${input.title ? `（${cleanText(input.title, 100)}）` : ""}${comments.length ? `，并在艺人评论里说过：${comments.map((item) => `“${item}”`).join("、")}` : ""}。`,
  });
}
