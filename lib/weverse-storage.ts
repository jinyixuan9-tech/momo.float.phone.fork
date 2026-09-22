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
  avatarUrl?: string;
  coverUrl?: string;
  official: WeverseAccountProfile;
  memberCharacterIds: string[];
  memberProfiles: Record<string, WeverseMemberProfile>;
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

export type WeverseState = {
  version: 1;
  communities: WeverseCommunity[];
  posts: WeversePost[];
  userProfile?: WeverseUserProfile;
};

const EMPTY_STATE: WeverseState = { version: 1, communities: [], posts: [], userProfile: {} };

function cloneEmpty(): WeverseState {
  return { version: 1, communities: [], posts: [], userProfile: {} };
}

function normalizeState(raw: unknown): WeverseState {
  if (!raw || typeof raw !== "object") return cloneEmpty();
  const source = raw as Partial<WeverseState>;
  const communities = Array.isArray(source.communities)
    ? source.communities.filter((item): item is WeverseCommunity => Boolean(item && typeof item.id === "string" && typeof item.name === "string"))
    : [];
  const posts = Array.isArray(source.posts)
    ? source.posts.filter((item): item is WeversePost => Boolean(item && typeof item.id === "string" && typeof item.communityId === "string" && typeof item.body === "string"))
      .map((item) => ({ ...item, comments: Array.isArray(item.comments) ? item.comments : [] }))
    : [];
  const userProfile = source.userProfile && typeof source.userProfile === "object" ? source.userProfile as WeverseUserProfile : {};
  return { version: 1, communities, posts, userProfile };
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
  return saveWeverseState({
    ...state,
    posts: state.posts.filter((item) => item.id !== postId),
  });
}

export function addWeverseComment(postId: string, comment: WeverseComment): WeverseState {
  const state = loadWeverseState();
  return saveWeverseState({
    ...state,
    posts: state.posts.map((item) => item.id === postId ? { ...item, comments: [...item.comments, comment] } : item),
  });
}

export function createWeverseId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
