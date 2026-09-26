import { kvGet, kvSet, registerKvMigration } from "./kv-db";

export const TWITTER_STORAGE_KEY = "ai_phone_twitter_v1";
export const TWITTER_UPDATED_EVENT = "twitter-updated";
registerKvMigration(TWITTER_STORAGE_KEY);

export type TwitterProfile = { name: string; handle: string; bio: string; avatarUrl?: string; bannerUrl?: string };
export type TwitterPost = {
  id: string;
  authorId: string; // "user" or character id
  original: string;
  translated?: string;
  imageRef?: string;
  replyToId?: string;
  createdAt: number;
  liked?: boolean;
  bookmarked?: boolean;
  reposted?: boolean;
};
export type TwitterMessage = { id: string; role: "user" | "character"; original: string; translated?: string; replyToId?: string; createdAt: number };
export type TwitterConversation = {
  id: string;
  characterId: string;
  mode: "real" | "anonymous";
  messages: TwitterMessage[];
  createdAt: number;
  blocked?: boolean;
};
export type TwitterNotice = {
  id: string;
  kind: "reply" | "like" | "follow" | "dm";
  actorId: string;
  postId?: string;
  text?: string;
  createdAt: number;
  read?: boolean;
};
export type TwitterState = {
  version: 1;
  profile: TwitterProfile;
  characterProfiles: Record<string, TwitterProfile>;
  worldRules: string;
  posts: TwitterPost[];
  conversations: TwitterConversation[];
  notices: TwitterNotice[];
  following: string[];
};

export function createTwitterId(): string {
  return `tw_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function blankState(): TwitterState {
  return {
    version: 1,
    profile: { name: "我", handle: "my_twitter", bio: "" },
    characterProfiles: {},
    worldRules: "",
    posts: [], conversations: [], notices: [], following: [],
  };
}

export function loadTwitterState(): TwitterState {
  if (typeof window === "undefined") return blankState();
  try {
    const raw = kvGet(TWITTER_STORAGE_KEY);
    if (!raw) return blankState();
    const row = JSON.parse(raw) as Partial<TwitterState>;
    const fallback = blankState();
    return {
      version: 1,
      profile: row.profile && typeof row.profile.name === "string" ? row.profile : fallback.profile,
      characterProfiles: row.characterProfiles && typeof row.characterProfiles === "object" && !Array.isArray(row.characterProfiles) ? row.characterProfiles : {},
      worldRules: typeof row.worldRules === "string" ? row.worldRules : "",
      posts: Array.isArray(row.posts) ? row.posts.filter(p => p && typeof p.id === "string" && typeof p.original === "string") : [],
      conversations: Array.isArray(row.conversations) ? row.conversations.filter(c => c && typeof c.id === "string" && Array.isArray(c.messages)) : [],
      notices: Array.isArray(row.notices) ? row.notices.filter(n => n && typeof n.id === "string") : [],
      following: Array.isArray(row.following) ? row.following.filter(id => typeof id === "string") : [],
    };
  } catch { return blankState(); }
}

export function saveTwitterState(state: TwitterState): void {
  if (typeof window === "undefined") return;
  kvSet(TWITTER_STORAGE_KEY, JSON.stringify(state));
  window.dispatchEvent(new Event(TWITTER_UPDATED_EVENT));
}

export function loadTwitterProjectionEntries(characterId: string, afterTimestamp?: string): Array<{ id: string; timestamp: string; content: string }> {
  const state = loadTwitterState();
  const entries: Array<{ id: string; timestamp: string; content: string }> = [];
  const visiblePosts = state.posts.filter(p => p.authorId === "user" || p.authorId === characterId || (p.replyToId && state.posts.some(parent => parent.id === p.replyToId && (parent.authorId === "user" || parent.authorId === characterId))));
  for (const post of visiblePosts) {
    if (!Number.isFinite(post.createdAt)) continue;
    const author = post.authorId === "user" ? state.profile.name : post.authorId === characterId ? "角色" : "其他人";
    entries.push({ id: `twitter_${post.id}`, timestamp: new Date(post.createdAt).toISOString(), content: `${author}在推特${post.replyToId ? "评论" : "发帖"}：“${post.original.slice(0, 300)}”` });
  }
  for (const convo of state.conversations.filter(c => c.characterId === characterId && c.mode === "real")) {
    for (const msg of convo.messages.slice(-30)) if (Number.isFinite(msg.createdAt) && typeof msg.original === "string") entries.push({ id: `twitter_dm_${msg.id}`, timestamp: new Date(msg.createdAt).toISOString(), content: `推特私信：${msg.role === "user" ? state.profile.name : "角色"}说“${msg.original.slice(0, 260)}”` });
  }
  return entries.filter(e => !afterTimestamp || e.timestamp > afterTimestamp).sort((a, b) => a.timestamp.localeCompare(b.timestamp)).slice(-80);
}
