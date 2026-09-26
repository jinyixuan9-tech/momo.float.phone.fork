import { kvGet, kvSet, registerKvMigration } from "./kv-db";

export const TWITTER_STORAGE_KEY = "ai_phone_twitter_v1";
export const TWITTER_UPDATED_EVENT = "twitter-updated";
registerKvMigration(TWITTER_STORAGE_KEY);

export type TwitterProfile = {
  name: string; handle: string; bio: string; avatarUrl?: string; bannerUrl?: string;
  followers?: number; followingCount?: number; visibility?: "public" | "protected";
  identity?: string; // Public identity of an alternate account, not its private owner.
  createdAt?: number;
  characterIds?: string[]; // Group account only.
  includeUserPersona?: boolean;
};
export type TwitterTrend = { id: string; label: string; scope: "world" | "region"; volume: number; createdAt: number };
export type TwitterCommunity = {
  id: string; name: string; avatarUrl?: string; bannerUrl?: string;
  fans: number; characterIds: string[]; groupAccountId?: string;
  description?: string; manualCharacters?: string[];
  includeUserPersona: boolean; createdAt: number;
};
export type TwitterEngagement = { likes: number; reposts: number; views: number; comments: number };
export type TwitterPost = {
  id: string;
  authorId: string; // "user" or character id
  original: string;
  translated?: string;
  imageRef?: string;
  replyToId?: string;
  communityId?: string;
  trendId?: string;
  engagement?: TwitterEngagement;
  commentsGenerated?: boolean;
  createdAt: number;
  liked?: boolean;
  bookmarked?: boolean;
  reposted?: boolean;
};
export type TwitterMessage = { id: string; role: "user" | "character"; original: string; translated?: string; replyToId?: string; createdAt: number };
export type TwitterConversation = {
  id: string;
  characterId: string;
  userAccountId?: string;
  recipientAccountId?: string;
  mode: "real" | "anonymous";
  messages: TwitterMessage[];
  createdAt: number;
  blocked?: boolean;
  stranger?: boolean;
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
  accounts: Record<string, TwitterProfile>; // Alternate, group and fictional bystander accounts.
  importedCharacterIds: string[];
  communities: TwitterCommunity[];
  trends: TwitterTrend[];
  regionName: string;
  publicWorldContext: string;
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
    accounts: {}, importedCharacterIds: [], communities: [], trends: [], regionName: "", publicWorldContext: "",
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
      accounts: row.accounts && typeof row.accounts === "object" && !Array.isArray(row.accounts) ? row.accounts : {},
      importedCharacterIds: Array.isArray(row.importedCharacterIds) ? row.importedCharacterIds.filter((id): id is string => typeof id === "string") : [],
      communities: Array.isArray(row.communities) ? row.communities.filter(c => c && typeof c.id === "string" && Array.isArray(c.characterIds)) : [],
      trends: Array.isArray(row.trends) ? row.trends.filter(t => t && typeof t.id === "string" && typeof t.label === "string") : [],
      regionName: typeof row.regionName === "string" ? row.regionName : "",
      publicWorldContext: typeof row.publicWorldContext === "string" ? row.publicWorldContext : "",
    };
  } catch { return blankState(); }
}

export function saveTwitterState(state: TwitterState): void {
  if (typeof window === "undefined") return;
  kvSet(TWITTER_STORAGE_KEY, JSON.stringify(state));
  window.dispatchEvent(new Event(TWITTER_UPDATED_EVENT));
}

export function isPublicTwitterPost(state: TwitterState, post: TwitterPost): boolean {
  const profile = post.authorId === "user" ? state.profile : state.accounts[post.authorId] || state.characterProfiles[post.authorId];
  return profile?.visibility !== "protected";
}

export function getTwitterPrivateAccountContext(characterId: string): string {
  const alternate = loadTwitterState().accounts[`${characterId}:alt`];
  if (!alternate) return "";
  return `你自己在推特的小号是 @${alternate.handle}，对外身份为“${(alternate.identity || alternate.bio || "普通账号").slice(0, 600)}”。这条真实归属是私下信息，路人、评论者和公众默认不知道。用户在一对一聊天问起时，可按你的人设自行决定告诉、卖关子或拒绝；不要在公开发言中无端暴露关联。`;
}

export function loadTwitterProjectionEntries(characterId: string, afterTimestamp?: string): Array<{ id: string; timestamp: string; content: string }> {
  const state = loadTwitterState();
  const entries: Array<{ id: string; timestamp: string; content: string }> = [];
  const ownIds = new Set(["user", characterId, `${characterId}:alt`]);
  const visiblePosts = state.posts.filter(p => (ownIds.has(p.authorId) && (p.authorId !== "user" || isPublicTwitterPost(state, p))) || (p.replyToId && state.posts.some(parent => parent.id === p.replyToId && ownIds.has(parent.authorId) && isPublicTwitterPost(state, parent))));
  for (const post of visiblePosts) {
    if (!Number.isFinite(post.createdAt)) continue;
    const author = post.authorId.startsWith("user") ? state.accounts[post.authorId]?.name || state.profile.name : post.authorId === characterId ? "角色" : post.authorId === `${characterId}:alt` ? "角色的小号" : "其他人";
    entries.push({ id: `twitter_${post.id}`, timestamp: new Date(post.createdAt).toISOString(), content: `${author}在推特${post.replyToId ? "评论" : "发帖"}：“${post.original.slice(0, 300)}”` });
  }
  for (const convo of state.conversations.filter(c => c.characterId === characterId && c.mode === "real" && (!c.userAccountId || c.userAccountId === "user"))) {
    for (const msg of convo.messages.slice(-30)) if (Number.isFinite(msg.createdAt) && typeof msg.original === "string") entries.push({ id: `twitter_dm_${msg.id}`, timestamp: new Date(msg.createdAt).toISOString(), content: `推特私信：${msg.role === "user" ? state.profile.name : "角色"}说“${msg.original.slice(0, 260)}”` });
  }
  return entries.filter(e => !afterTimestamp || e.timestamp > afterTimestamp).sort((a, b) => a.timestamp.localeCompare(b.timestamp)).slice(-80);
}
