import { kvGet, kvSet, registerKvMigration } from "./kv-db";

export const WEV_STATE_KEY = "ai_phone_weverse_state_v1";
export const WEV_UPDATED_EVENT = "weverse-updated";
registerKvMigration(WEV_STATE_KEY);

export type WeverseAccountProfile = { displayName: string; avatarUrl?: string; bio?: string };
export type WeverseMemberProfile = { characterId: string; displayName?: string; avatarUrl?: string; coverUrl?: string; bio?: string };
export type WeverseHistoryMode = "new" | "existing" | "custom";

export type WeverseCommunity = {
  id: string; name: string; description?: string; avatarUrl?: string; coverUrl?: string;
  official: WeverseAccountProfile;
  memberCharacterIds: string[];
  memberProfiles: Record<string, WeverseMemberProfile>;
  officialMediaPhotoIds?: string[];
  /** 用于模拟公开互动量，不等于本地真正生成的 fan 账号数量。 */
  fanCount: number;
  historyMode?: WeverseHistoryMode;
  historyStartAt?: number;
  historyInitializedAt?: number;
  /** 已生成历史内容里最早的时间；继续“加载更早动态”时从这里往前延伸。 */
  historyCursorAt?: number;
  createdAt: number; updatedAt: number;
};

export type WeverseAuthorType = "user" | "fan" | "official" | "artist";
export type WeverseComment = {
  id: string; authorType: WeverseAuthorType; authorId: string; authorName?: string; authorAvatarUrl?: string;
  body: string; originalBody?: string; parentId?: string; deleted?: boolean; createdAt: number;
};
export type WeversePost = {
  id: string; communityId: string; authorType: WeverseAuthorType; authorId: string; authorName?: string; authorAvatarUrl?: string;
  body: string; originalBody?: string; imageUrl?: string; photoLibraryId?: string; photoSource?: "album" | "generated" | "manual";
  createdAt: number; likedByUser?: boolean; bookmarkedByUser?: boolean;
  /** 公开 UI 展示的模拟互动总量；和 comments[] 可见样本数量分开。 */
  likeCount: number; commentCount: number;
  /** 历史回填内容不会当作“刚发生”写入角色近期记忆。 */
  historical?: boolean;
  comments: WeverseComment[];
};
export type WeverseUserProfile = { displayName?: string; avatarUrl?: string; bio?: string };
export type WeverseSettings = {
  translationDefault: "translated" | "original";
  autoTranslateComments: boolean;
  fanActivity: "quiet" | "normal" | "lively";
  fanLanguagePreset: "korean_mixed";
  generationScope: "current" | "all";
  notifications: { artistReply: boolean; fanReply: boolean; artistPost: boolean; officialPost: boolean; live: boolean };
};
export type WeverseState = { version: 3; communities: WeverseCommunity[]; posts: WeversePost[]; userProfile?: WeverseUserProfile; settings: WeverseSettings };

export const DEFAULT_WEV_SETTINGS: WeverseSettings = {
  translationDefault: "translated", autoTranslateComments: true, fanActivity: "normal", fanLanguagePreset: "korean_mixed", generationScope: "current",
  notifications: { artistReply: true, fanReply: true, artistPost: true, officialPost: true, live: true },
};
const EMPTY_STATE: WeverseState = { version: 3, communities: [], posts: [], userProfile: {}, settings: DEFAULT_WEV_SETTINGS };
function cloneEmpty(): WeverseState { return { version: 3, communities: [], posts: [], userProfile: {}, settings: { ...DEFAULT_WEV_SETTINGS, notifications: { ...DEFAULT_WEV_SETTINGS.notifications } } }; }
function uniqueStrings(value: unknown): string[] { return Array.isArray(value) ? Array.from(new Set(value.filter((v): v is string => typeof v === "string" && Boolean(v.trim())).map(v => v.trim()))) : []; }
function finiteNonNegative(value: unknown, fallback = 0): number { const n = Number(value); return Number.isFinite(n) && n >= 0 ? Math.round(n) : fallback; }
function normalizeSettings(value: unknown): WeverseSettings {
  const raw = value && typeof value === "object" ? value as Partial<WeverseSettings> : {};
  const notifications = raw.notifications && typeof raw.notifications === "object" ? raw.notifications : {} as Partial<WeverseSettings["notifications"]>;
  return { translationDefault: raw.translationDefault === "original" ? "original" : "translated", autoTranslateComments: raw.autoTranslateComments !== false,
    fanActivity: raw.fanActivity === "quiet" || raw.fanActivity === "lively" ? raw.fanActivity : "normal", fanLanguagePreset: "korean_mixed", generationScope: raw.generationScope === "all" ? "all" : "current",
    notifications: { artistReply: notifications.artistReply !== false, fanReply: notifications.fanReply !== false, artistPost: notifications.artistPost !== false, officialPost: notifications.officialPost !== false, live: notifications.live !== false } };
}
function normalizeComment(raw: unknown): WeverseComment | null {
  if (!raw || typeof raw !== "object") return null; const item = raw as Partial<WeverseComment>; if (typeof item.id !== "string" || typeof item.authorId !== "string") return null;
  const authorType: WeverseAuthorType = item.authorType === "fan" || item.authorType === "official" || item.authorType === "artist" ? item.authorType : "user";
  return { id: item.id, authorType, authorId: item.authorId, authorName: typeof item.authorName === "string" ? item.authorName : undefined, authorAvatarUrl: typeof item.authorAvatarUrl === "string" ? item.authorAvatarUrl : undefined,
    body: typeof item.body === "string" ? item.body : "", originalBody: typeof item.originalBody === "string" ? item.originalBody : undefined, parentId: typeof item.parentId === "string" && item.parentId ? item.parentId : undefined,
    deleted: item.deleted === true, createdAt: typeof item.createdAt === "number" && Number.isFinite(item.createdAt) ? item.createdAt : Date.now() };
}
function normalizeCommunity(raw: unknown): WeverseCommunity | null {
  if (!raw || typeof raw !== "object") return null; const item = raw as Partial<WeverseCommunity>; if (typeof item.id !== "string" || typeof item.name !== "string") return null;
  const officialRaw = item.official && typeof item.official === "object" ? item.official : { displayName: `${item.name} Official` };
  const profiles = item.memberProfiles && typeof item.memberProfiles === "object" ? item.memberProfiles : {};
  const historyMode: WeverseHistoryMode = item.historyMode === "new" || item.historyMode === "custom" ? item.historyMode : item.historyMode === "existing" ? "existing" : "new";
  return { id: item.id, name: item.name, description: typeof item.description === "string" ? item.description : undefined, avatarUrl: typeof item.avatarUrl === "string" ? item.avatarUrl : undefined, coverUrl: typeof item.coverUrl === "string" ? item.coverUrl : undefined,
    official: { displayName: typeof officialRaw.displayName === "string" && officialRaw.displayName.trim() ? officialRaw.displayName : `${item.name} Official`, avatarUrl: typeof officialRaw.avatarUrl === "string" ? officialRaw.avatarUrl : undefined, bio: typeof officialRaw.bio === "string" ? officialRaw.bio : undefined },
    memberCharacterIds: uniqueStrings(item.memberCharacterIds), memberProfiles: profiles as Record<string, WeverseMemberProfile>, officialMediaPhotoIds: uniqueStrings(item.officialMediaPhotoIds), fanCount: finiteNonNegative(item.fanCount, 100000),
    historyMode, historyStartAt: typeof item.historyStartAt === "number" && Number.isFinite(item.historyStartAt) ? item.historyStartAt : undefined,
    historyInitializedAt: typeof item.historyInitializedAt === "number" && Number.isFinite(item.historyInitializedAt) ? item.historyInitializedAt : undefined,
    historyCursorAt: typeof item.historyCursorAt === "number" && Number.isFinite(item.historyCursorAt) ? item.historyCursorAt : undefined,
    createdAt: typeof item.createdAt === "number" && Number.isFinite(item.createdAt) ? item.createdAt : Date.now(), updatedAt: typeof item.updatedAt === "number" && Number.isFinite(item.updatedAt) ? item.updatedAt : Date.now() };
}
function hash01(text: string): number { let h = 2166136261; for (let i=0;i<text.length;i+=1) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967295; }
function legacyCounts(id: string, type: WeverseAuthorType, fanCount: number, visibleComments: number): { likeCount:number; commentCount:number } {
  const r = hash01(id); const base = Math.max(1000, fanCount);
  const likeRatio = type === "artist" ? .035 + r*.085 : type === "official" ? .018+r*.05 : .00008+r*.0012;
  const commentRatio = type === "artist" ? .0015+r*.008 : type === "official" ? .0007+r*.004 : .00001+r*.00018;
  return { likeCount: Math.max(type === "fan" ? 3 : 30, Math.round(base*likeRatio)), commentCount: Math.max(visibleComments, Math.round(base*commentRatio)) };
}
function normalizeState(raw: unknown): WeverseState {
  if (!raw || typeof raw !== "object") return cloneEmpty(); const source = raw as Partial<WeverseState>;
  const communities = Array.isArray(source.communities) ? source.communities.map(normalizeCommunity).filter((v): v is WeverseCommunity => Boolean(v)) : [];
  const communityMap = new Map(communities.map(c=>[c.id,c]));
  const posts = Array.isArray(source.posts) ? source.posts.filter((item): item is WeversePost => Boolean(item && typeof item.id === "string" && typeof item.communityId === "string" && typeof item.body === "string")).map((item) => {
    const comments = Array.isArray(item.comments) ? item.comments.map(normalizeComment).filter((c): c is WeverseComment => Boolean(c)) : [];
    const fallback = legacyCounts(item.id, item.authorType, communityMap.get(item.communityId)?.fanCount || 100000, comments.length);
    return { ...item, comments, likeCount: finiteNonNegative(item.likeCount, fallback.likeCount), commentCount: finiteNonNegative(item.commentCount, fallback.commentCount), historical: item.historical === true };
  }) : [];
  return { version: 3, communities, posts, userProfile: source.userProfile && typeof source.userProfile === "object" ? source.userProfile as WeverseUserProfile : {}, settings: normalizeSettings(source.settings) };
}
export function loadWeverseState(): WeverseState { if (typeof window === "undefined") return EMPTY_STATE; try { const raw=kvGet(WEV_STATE_KEY); return raw ? normalizeState(JSON.parse(raw)) : cloneEmpty(); } catch { return cloneEmpty(); } }
export function saveWeverseState(state: WeverseState): WeverseState { const normalized=normalizeState(state); if (typeof window !== "undefined") { kvSet(WEV_STATE_KEY, JSON.stringify(normalized)); window.dispatchEvent(new CustomEvent(WEV_UPDATED_EVENT)); } return normalized; }
export function updateWeverseUserProfile(patch: Partial<WeverseUserProfile>): WeverseState { const state=loadWeverseState(); return saveWeverseState({...state,userProfile:{...(state.userProfile||{}),...patch}}); }
export function updateWeverseSettings(patch: Partial<WeverseSettings>): WeverseState { const state=loadWeverseState(); return saveWeverseState({...state,settings:normalizeSettings({...state.settings,...patch,notifications:{...state.settings.notifications,...(patch.notifications||{})}})}); }
export function upsertWeverseCommunity(community: WeverseCommunity): WeverseState { const state=loadWeverseState(); const i=state.communities.findIndex(v=>v.id===community.id); const communities=[...state.communities]; if(i>=0) communities[i]=community; else communities.unshift(community); return saveWeverseState({...state,communities}); }
export function deleteWeverseCommunity(communityId:string):WeverseState { const state=loadWeverseState(); return saveWeverseState({...state,communities:state.communities.filter(v=>v.id!==communityId),posts:state.posts.filter(v=>v.communityId!==communityId)}); }
export function addWeversePost(post:WeversePost):WeverseState { const state=loadWeverseState(); return saveWeverseState({...state,posts:[post,...state.posts]}); }
export function addWeversePosts(posts:WeversePost[]):WeverseState { if(!posts.length) return loadWeverseState(); const state=loadWeverseState(); return saveWeverseState({...state,posts:[...posts,...state.posts]}); }
export function updateWeversePost(postId:string,patch:Partial<WeversePost>):WeverseState { const state=loadWeverseState(); return saveWeverseState({...state,posts:state.posts.map(v=>v.id===postId?{...v,...patch}:v)}); }
export function deleteWeversePost(postId:string):WeverseState { const state=loadWeverseState(); return saveWeverseState({...state,posts:state.posts.filter(v=>v.id!==postId)}); }
export function addWeverseComment(postId:string,comment:WeverseComment):WeverseState { const state=loadWeverseState(); return saveWeverseState({...state,posts:state.posts.map(v=>v.id===postId?{...v,comments:[...v.comments,comment]}:v)}); }
export function addWeverseComments(postId:string,comments:WeverseComment[]):WeverseState { if(!comments.length)return loadWeverseState(); const state=loadWeverseState(); return saveWeverseState({...state,posts:state.posts.map(v=>v.id===postId?{...v,comments:[...v.comments,...comments]}:v)}); }
export function deleteWeverseComment(postId:string,commentId:string):WeverseState { const state=loadWeverseState(); return saveWeverseState({...state,posts:state.posts.map(post=>{ if(post.id!==postId)return post; const hasChildren=post.comments.some(c=>c.parentId===commentId); const comments=hasChildren?post.comments.map(c=>c.id===commentId?{...c,body:"",originalBody:undefined,deleted:true}:c):post.comments.filter(c=>c.id!==commentId); return {...post,comments}; })}); }
export function createWeverseId(prefix:string):string { return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2,8)}`; }
