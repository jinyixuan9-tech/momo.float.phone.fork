import { kvGet, kvSet, registerKvMigration } from "./kv-db";

export const WEV_STATE_KEY = "ai_phone_weverse_state_v1";
export const WEV_UPDATED_EVENT = "weverse-updated";
registerKvMigration(WEV_STATE_KEY);

export type WeverseAccountProfile = {
  displayName: string;
  avatarUrl?: string;
  bio?: string;
};

export type WeverseMemberProfile = {
  characterId: string;
  displayName?: string;
  avatarUrl?: string;
  coverUrl?: string;
  bio?: string;
};

export type WeverseCommunity = {
  id: string;
  name: string;
  description?: string;
  /** Community 小图标。为空时前端继承 Official 头像；绝不拿大背景兜底。 */
  avatarUrl?: string;
  /** Community 进入后的 Hero 大背景。 */
  coverUrl?: string;
  official: WeverseAccountProfile;
  memberCharacterIds: string[];
  memberProfiles: Record<string, WeverseMemberProfile>;
  /** WVS 独有主体（官号）自己的官方媒体池，只保存 Photos photoId 引用。 */
  officialMediaPhotoIds?: string[];
  createdAt: number;
  updatedAt: number;
};

export type WeverseAuthorType = "user" | "fan" | "official" | "artist";

export type WeverseComment = {
  id: string;
  authorType: WeverseAuthorType;
  authorId: string;
  authorName?: string;
  authorAvatarUrl?: string;
  body: string;
  originalBody?: string;
  /** 真正的评论树关系。为空即顶级评论。 */
  parentId?: string;
  /** 删除父评论时保留占位，避免下面整串回复消失。 */
  deleted?: boolean;
  createdAt: number;
};

export type WeversePost = {
  id: string;
  communityId: string;
  authorType: WeverseAuthorType;
  authorId: string;
  authorName?: string;
  authorAvatarUrl?: string;
  body: string;
  originalBody?: string;
  imageUrl?: string;
  photoLibraryId?: string;
  photoSource?: "album" | "generated" | "manual";
  createdAt: number;
  likedByUser?: boolean;
  bookmarkedByUser?: boolean;
  comments: WeverseComment[];
};

export type WeverseUserProfile = {
  displayName?: string;
  avatarUrl?: string;
  bio?: string;
};

export type WeverseSettings = {
  /** 正文与评论打开时默认展示译文还是原文；单条仍可切换。 */
  translationDefault: "translated" | "original";
  autoTranslateComments: boolean;
  fanActivity: "quiet" | "normal" | "lively";
  /** 当前只提供韩国社区默认预设，保留字段方便后续扩展。 */
  fanLanguagePreset: "korean_mixed";
  generationScope: "current" | "all";
  notifications: {
    artistReply: boolean;
    fanReply: boolean;
    artistPost: boolean;
    officialPost: boolean;
    live: boolean;
  };
};

export type WeverseState = {
  version: 2;
  communities: WeverseCommunity[];
  posts: WeversePost[];
  userProfile?: WeverseUserProfile;
  settings: WeverseSettings;
};

export const DEFAULT_WEV_SETTINGS: WeverseSettings = {
  translationDefault: "translated",
  autoTranslateComments: true,
  fanActivity: "normal",
  fanLanguagePreset: "korean_mixed",
  generationScope: "current",
  notifications: {
    artistReply: true,
    fanReply: true,
    artistPost: true,
    officialPost: true,
    live: true,
  },
};

const EMPTY_STATE: WeverseState = { version: 2, communities: [], posts: [], userProfile: {}, settings: DEFAULT_WEV_SETTINGS };

function cloneEmpty(): WeverseState {
  return {
    version: 2,
    communities: [],
    posts: [],
    userProfile: {},
    settings: { ...DEFAULT_WEV_SETTINGS, notifications: { ...DEFAULT_WEV_SETTINGS.notifications } },
  };
}

function uniqueStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? Array.from(new Set(value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim())))
    : [];
}

function normalizeSettings(value: unknown): WeverseSettings {
  const raw = value && typeof value === "object" ? value as Partial<WeverseSettings> : {};
  const notifications: Partial<WeverseSettings["notifications"]> = raw.notifications && typeof raw.notifications === "object" ? raw.notifications : {};
  return {
    translationDefault: raw.translationDefault === "original" ? "original" : "translated",
    autoTranslateComments: raw.autoTranslateComments !== false,
    fanActivity: raw.fanActivity === "quiet" || raw.fanActivity === "lively" ? raw.fanActivity : "normal",
    fanLanguagePreset: "korean_mixed",
    generationScope: raw.generationScope === "all" ? "all" : "current",
    notifications: {
      artistReply: notifications.artistReply !== false,
      fanReply: notifications.fanReply !== false,
      artistPost: notifications.artistPost !== false,
      officialPost: notifications.officialPost !== false,
      live: notifications.live !== false,
    },
  };
}

function normalizeComment(raw: unknown): WeverseComment | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Partial<WeverseComment>;
  if (typeof item.id !== "string" || typeof item.authorId !== "string") return null;
  const authorType: WeverseAuthorType = item.authorType === "fan" || item.authorType === "official" || item.authorType === "artist" ? item.authorType : "user";
  return {
    id: item.id,
    authorType,
    authorId: item.authorId,
    authorName: typeof item.authorName === "string" ? item.authorName : undefined,
    authorAvatarUrl: typeof item.authorAvatarUrl === "string" ? item.authorAvatarUrl : undefined,
    body: typeof item.body === "string" ? item.body : "",
    originalBody: typeof item.originalBody === "string" ? item.originalBody : undefined,
    parentId: typeof item.parentId === "string" && item.parentId ? item.parentId : undefined,
    deleted: item.deleted === true,
    createdAt: typeof item.createdAt === "number" && Number.isFinite(item.createdAt) ? item.createdAt : Date.now(),
  };
}

function normalizeCommunity(raw: unknown): WeverseCommunity | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Partial<WeverseCommunity>;
  if (typeof item.id !== "string" || typeof item.name !== "string") return null;
  const officialRaw = item.official && typeof item.official === "object" ? item.official : { displayName: `${item.name} Official` };
  const profiles = item.memberProfiles && typeof item.memberProfiles === "object" ? item.memberProfiles : {};
  return {
    id: item.id,
    name: item.name,
    description: typeof item.description === "string" ? item.description : undefined,
    avatarUrl: typeof item.avatarUrl === "string" ? item.avatarUrl : undefined,
    coverUrl: typeof item.coverUrl === "string" ? item.coverUrl : undefined,
    official: {
      displayName: typeof officialRaw.displayName === "string" && officialRaw.displayName.trim() ? officialRaw.displayName : `${item.name} Official`,
      avatarUrl: typeof officialRaw.avatarUrl === "string" ? officialRaw.avatarUrl : undefined,
      bio: typeof officialRaw.bio === "string" ? officialRaw.bio : undefined,
    },
    memberCharacterIds: uniqueStrings(item.memberCharacterIds),
    memberProfiles: profiles as Record<string, WeverseMemberProfile>,
    officialMediaPhotoIds: uniqueStrings(item.officialMediaPhotoIds),
    createdAt: typeof item.createdAt === "number" && Number.isFinite(item.createdAt) ? item.createdAt : Date.now(),
    updatedAt: typeof item.updatedAt === "number" && Number.isFinite(item.updatedAt) ? item.updatedAt : Date.now(),
  };
}

function normalizeState(raw: unknown): WeverseState {
  if (!raw || typeof raw !== "object") return cloneEmpty();
  const source = raw as Partial<WeverseState>;
  const communities = Array.isArray(source.communities)
    ? source.communities.map(normalizeCommunity).filter((item): item is WeverseCommunity => Boolean(item))
    : [];
  const posts = Array.isArray(source.posts)
    ? source.posts.filter((item): item is WeversePost => Boolean(item && typeof item.id === "string" && typeof item.communityId === "string" && typeof item.body === "string"))
      .map((item) => ({
        ...item,
        comments: Array.isArray(item.comments) ? item.comments.map(normalizeComment).filter((comment): comment is WeverseComment => Boolean(comment)) : [],
      }))
    : [];
  const userProfile = source.userProfile && typeof source.userProfile === "object" ? source.userProfile as WeverseUserProfile : {};
  return { version: 2, communities, posts, userProfile, settings: normalizeSettings(source.settings) };
}

export function loadWeverseState(): WeverseState {
  if (typeof window === "undefined") return EMPTY_STATE;
  try {
    const raw = kvGet(WEV_STATE_KEY);
    if (!raw) return cloneEmpty();
    return normalizeState(JSON.parse(raw));
  } catch {
    return cloneEmpty();
  }
}

export function saveWeverseState(state: WeverseState): WeverseState {
  const normalized = normalizeState(state);
  if (typeof window !== "undefined") {
    kvSet(WEV_STATE_KEY, JSON.stringify(normalized));
    window.dispatchEvent(new CustomEvent(WEV_UPDATED_EVENT));
  }
  return normalized;
}

export function updateWeverseUserProfile(patch: Partial<WeverseUserProfile>): WeverseState {
  const state = loadWeverseState();
  return saveWeverseState({ ...state, userProfile: { ...(state.userProfile || {}), ...patch } });
}

export function updateWeverseSettings(patch: Partial<WeverseSettings>): WeverseState {
  const state = loadWeverseState();
  return saveWeverseState({
    ...state,
    settings: normalizeSettings({
      ...state.settings,
      ...patch,
      notifications: { ...state.settings.notifications, ...(patch.notifications || {}) },
    }),
  });
}

export function upsertWeverseCommunity(community: WeverseCommunity): WeverseState {
  const state = loadWeverseState();
  const index = state.communities.findIndex((item) => item.id === community.id);
  const communities = [...state.communities];
  if (index >= 0) communities[index] = community;
  else communities.unshift(community);
  return saveWeverseState({ ...state, communities });
}

export function deleteWeverseCommunity(communityId: string): WeverseState {
  const state = loadWeverseState();
  return saveWeverseState({
    ...state,
    communities: state.communities.filter((item) => item.id !== communityId),
    posts: state.posts.filter((item) => item.communityId !== communityId),
  });
}

export function addWeversePost(post: WeversePost): WeverseState {
  const state = loadWeverseState();
  return saveWeverseState({ ...state, posts: [post, ...state.posts] });
}

export function updateWeversePost(postId: string, patch: Partial<WeversePost>): WeverseState {
  const state = loadWeverseState();
  return saveWeverseState({
    ...state,
    posts: state.posts.map((item) => item.id === postId ? { ...item, ...patch } : item),
  });
}

export function deleteWeversePost(postId: string): WeverseState {
  const state = loadWeverseState();
  return saveWeverseState({ ...state, posts: state.posts.filter((item) => item.id !== postId) });
}

export function addWeverseComment(postId: string, comment: WeverseComment): WeverseState {
  const state = loadWeverseState();
  return saveWeverseState({
    ...state,
    posts: state.posts.map((item) => item.id === postId ? { ...item, comments: [...item.comments, comment] } : item),
  });
}

export function addWeverseComments(postId: string, comments: WeverseComment[]): WeverseState {
  if (!comments.length) return loadWeverseState();
  const state = loadWeverseState();
  return saveWeverseState({
    ...state,
    posts: state.posts.map((item) => item.id === postId ? { ...item, comments: [...item.comments, ...comments] } : item),
  });
}

export function deleteWeverseComment(postId: string, commentId: string): WeverseState {
  const state = loadWeverseState();
  return saveWeverseState({
    ...state,
    posts: state.posts.map((post) => {
      if (post.id !== postId) return post;
      const hasChildren = post.comments.some((comment) => comment.parentId === commentId);
      const comments = hasChildren
        ? post.comments.map((comment) => comment.id === commentId ? { ...comment, body: "", originalBody: undefined, deleted: true } : comment)
        : post.comments.filter((comment) => comment.id !== commentId);
      return { ...post, comments };
    }),
  });
}

export function createWeverseId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
