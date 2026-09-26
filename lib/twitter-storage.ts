import { kvGet, kvSet, registerKvMigration } from "./kv-db";

export const TWITTER_STORAGE_KEY = "ai_phone_twitter_v1";
export const TWITTER_UPDATED_EVENT = "twitter-updated";
registerKvMigration(TWITTER_STORAGE_KEY);
export const DEFAULT_TWITTER_WORLD = "现在是2025—2026年。这里是面向世界各地用户的虚构 X／推特式交流平台，人们分享日常、学校生活、游戏、情感、娱乐和自己所在世界的热门话题。角色的公开身份与已设定人设一致；副账号是否公开关联主账号，以各自账号设置为准。路人只知道公开内容，不会自动知道角色与用户的私密关系。热门话题应符合用户写下的世界观，避免假称掌握真实世界的即时新闻、行程或未经设定的重大事件。";
export const TWITTER_LOCALES = ["简中（大陆）", "繁中（港澳台）", "日语（日本）", "韩语（韩国）", "英语国家", "泰语（泰国）"] as const;

export type TwitterProfile = {
  name: string; handle: string; bio: string; avatarUrl?: string; bannerUrl?: string;
  followers?: number; followingCount?: number; visibility?: "public" | "protected";
  identity?: string; // Public identity of an alternate account, not its private owner.
  createdAt?: number;
  birthday?: string;
  verification?: "none" | "blue" | "gold" | "grey";
  disclosure?: "independent" | "full" | "clues";
  disclosureClues?: string;
  characterIds?: string[]; // Group account only.
  includeUserPersona?: boolean;
};
export type TwitterTrend = { id: string; label: string; scope: "world" | "region"; volume: number; createdAt: number };
export type TwitterCommunity = {
  id: string; name: string; avatarUrl?: string; bannerUrl?: string;
  fans: number; characterIds: string[]; groupAccountId?: string;
  description?: string; manualCharacters?: string[];
  communityCharacterIds?: string[];
  includeUserPersona: boolean; createdAt: number;
};
export type TwitterCommunityCharacter = { id: string; name: string; handle: string; bio: string; persona: string; avatarUrl?: string; communityId: string };
export type TwitterAction = { id: string; actorId: string; targetPostId: string; kind: "like" | "bookmark"; communityId?: string; createdAt: number };
export type TwitterPendingReply = { id: string; commentId: string; targetPostId: string; createdAt: number; attempts: number };
export type TwitterEngagement = { likes: number; reposts: number; views: number; comments: number };
export type TwitterPost = {
  id: string;
  authorId: string; // "user" or character id
  original: string;
  translated?: string;
  imageRef?: string;
  imageRefs?: string[];
  imageDescription?: string;
  repostOfId?: string;
  quotePostId?: string;
  location?: string;
  replyPermission?: "everyone" | "following" | "mentioned";
  poll?: { options: string[]; votes: number[]; votedBy?: string[] };
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
  version: 2;
  profile: TwitterProfile;
  characterProfiles: Record<string, TwitterProfile>;
  worldRules: string;
  posts: TwitterPost[];
  conversations: TwitterConversation[];
  notices: TwitterNotice[];
  following: string[];
  accounts: Record<string, TwitterProfile>; // Alternate, group and fictional bystander accounts.
  actions: TwitterAction[];
  pendingReplies: TwitterPendingReply[];
  deletedCommentFingerprints: Record<string, string[]>;
  communityCharacters: Record<string, TwitterCommunityCharacter>;
  importedCharacterIds: string[];
  communities: TwitterCommunity[];
  trends: TwitterTrend[];
  regionName: string;
  publicWorldContext: string;
  audienceLocales: string[];
  alternateMediaPhotoIds: Record<string, string[]>;
};

export function createTwitterId(): string {
  return `tw_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function blankState(): TwitterState {
  return {
    version: 2,
    profile: { name: "我", handle: "my_twitter", bio: "" },
    characterProfiles: {},
    worldRules: "",
    posts: [], conversations: [], notices: [], following: [],
    accounts: {}, actions: [], pendingReplies: [], deletedCommentFingerprints: {}, communityCharacters: {}, importedCharacterIds: [], communities: [], trends: [], regionName: "", publicWorldContext: DEFAULT_TWITTER_WORLD,
    audienceLocales: ["日语（日本）", "韩语（韩国）", "英语国家"], alternateMediaPhotoIds: {},
  };
}

export function loadTwitterState(): TwitterState {
  if (typeof window === "undefined") return blankState();
  try {
    const raw = kvGet(TWITTER_STORAGE_KEY);
    if (!raw) return blankState();
    const row = JSON.parse(raw) as Partial<TwitterState>;
    const fallback = blankState();
    const communities = Array.isArray(row.communities) ? row.communities.filter(c => c && typeof c.id === "string" && Array.isArray(c.characterIds)) : [];
    const communityCharacters: Record<string, TwitterCommunityCharacter> = row.communityCharacters && typeof row.communityCharacters === "object" && !Array.isArray(row.communityCharacters) ? { ...row.communityCharacters } : {};
    for (const community of communities) {
      const legacy = community.manualCharacters || [];
      const ids = new Set(community.communityCharacterIds || []);
      legacy.forEach((name, index) => {
        const id = `community:${community.id}:${index}`;
        if (!communityCharacters[id]) communityCharacters[id] = { id, name, handle: `community_${index + 1}`, bio: "", persona: "", communityId: community.id };
        ids.add(id);
      });
      community.communityCharacterIds = [...ids];
      community.manualCharacters = [];
    }
    const posts = Array.isArray(row.posts) ? row.posts.filter(p => p && typeof p.id === "string" && typeof p.original === "string") : [];
    const legacyActions: TwitterAction[] = [];
    if (!Array.isArray(row.actions)) for (const post of posts) {
      for (const [field, kind] of [["liked", "like"], ["bookmarked", "bookmark"]] as const) if (post[field]) legacyActions.push({ id: `migrated_${post.id}_${kind}`, targetPostId: post.id, actorId: "user", kind, createdAt: post.createdAt });
    }
    const migrateProfile = (profile: TwitterProfile) => { if (row.version === 2) return profile; const next = { ...profile }; delete next.createdAt; return next; };
    const profiles = row.characterProfiles && typeof row.characterProfiles === "object" && !Array.isArray(row.characterProfiles) ? row.characterProfiles : {};
    const accounts = row.accounts && typeof row.accounts === "object" && !Array.isArray(row.accounts) ? row.accounts : {};
    return {
      version: 2,
      profile: migrateProfile(row.profile && typeof row.profile.name === "string" ? row.profile : fallback.profile),
      characterProfiles: Object.fromEntries(Object.entries(profiles).map(([id, profile]) => [id, migrateProfile(profile)])),
      worldRules: typeof row.worldRules === "string" ? row.worldRules : "",
      posts,
      conversations: Array.isArray(row.conversations) ? row.conversations.filter(c => c && typeof c.id === "string" && Array.isArray(c.messages)) : [],
      notices: Array.isArray(row.notices) ? row.notices.filter(n => n && typeof n.id === "string") : [],
      following: Array.isArray(row.following) ? row.following.filter(id => typeof id === "string") : [],
      accounts: Object.fromEntries(Object.entries(accounts).map(([id, profile]) => [id, migrateProfile(profile)])),
      actions: Array.isArray(row.actions) ? row.actions.filter(a => a && typeof a.id === "string" && typeof a.targetPostId === "string") : legacyActions,
      pendingReplies: Array.isArray(row.pendingReplies) ? row.pendingReplies.filter(p => p && typeof p.commentId === "string") : [],
      deletedCommentFingerprints: row.deletedCommentFingerprints && typeof row.deletedCommentFingerprints === "object" ? row.deletedCommentFingerprints : {},
      communityCharacters,
      importedCharacterIds: Array.isArray(row.importedCharacterIds) ? row.importedCharacterIds.filter((id): id is string => typeof id === "string") : [],
      communities,
      trends: Array.isArray(row.trends) ? row.trends.filter(t => t && typeof t.id === "string" && typeof t.label === "string") : [],
      regionName: typeof row.regionName === "string" ? row.regionName : "",
      publicWorldContext: typeof row.publicWorldContext === "string" && row.publicWorldContext.trim() ? row.publicWorldContext : DEFAULT_TWITTER_WORLD,
      audienceLocales: Array.isArray(row.audienceLocales) ? row.audienceLocales.filter((value): value is string => typeof value === "string" && TWITTER_LOCALES.includes(value as typeof TWITTER_LOCALES[number])) : fallback.audienceLocales,
      alternateMediaPhotoIds: row.alternateMediaPhotoIds && typeof row.alternateMediaPhotoIds === "object" && !Array.isArray(row.alternateMediaPhotoIds) ? row.alternateMediaPhotoIds : {},
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
