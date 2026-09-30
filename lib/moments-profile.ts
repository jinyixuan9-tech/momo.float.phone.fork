import { kvGet, kvSet, registerKvMigration } from "./kv-db";
import type { MomentPost } from "./moments-types";

const NAME_KEY = "moments_screen_name";
const SIGNATURE_KEY = "moments_signature";
const FEATURED_KEY = "moments_featured_photos_v1";
const MANUAL_KEY = "moments_manual_photos_v1";
const HIDDEN_KEY = "moments_album_hidden_photos_v1";
const MUSIC_KEY = "moments_profile_music_id";
for (const key of [NAME_KEY, SIGNATURE_KEY, FEATURED_KEY, MANUAL_KEY, HIDDEN_KEY, MUSIC_KEY]) registerKvMigration(key);

export type MomentsPhoto = { url: string; postId?: string; addedAt: string };
const readPhotos = (key: string): MomentsPhoto[] => {
    if (typeof window === "undefined") return [];
    try {
        const value = JSON.parse(kvGet(key) || "[]");
        return Array.isArray(value) ? value.filter((p: MomentsPhoto) => typeof p?.url === "string") : [];
    } catch { return []; }
};
export const getMomentsScreenName = () => typeof window === "undefined" ? "我的朋友圈" : kvGet(NAME_KEY)?.trim() || "我的朋友圈";
/** 只返回用户明确填写的网名，供引用消息回退到用户本名。 */
export const getSavedMomentsScreenName = () => {
    if (typeof window === "undefined") return "";
    const value = kvGet(NAME_KEY)?.trim() || "";
    return value === "我的朋友圈" ? "" : value;
};
export const getMomentsSignature = () => typeof window === "undefined" ? "写下你的签名" : kvGet(SIGNATURE_KEY) || "写下你的签名";
export const saveMomentsProfile = (name: string, signature: string) => {
    kvSet(NAME_KEY, name.trim() || "我的朋友圈");
    kvSet(SIGNATURE_KEY, signature.trim());
    window.dispatchEvent(new Event("moments-profile-updated"));
};
export const getFeaturedPhotos = () => readPhotos(FEATURED_KEY);
export const getManualPhotos = () => readPhotos(MANUAL_KEY);
export const addFeaturedPhoto = (photo: MomentsPhoto) => {
    kvSet(FEATURED_KEY, JSON.stringify([photo, ...getFeaturedPhotos().filter(p => p.url !== photo.url)].slice(0, 3)));
    kvSet(HIDDEN_KEY, JSON.stringify(getHiddenAlbumPhotos().filter(url => url !== photo.url)));
    window.dispatchEvent(new Event("moments-profile-updated"));
};
export const removeFeaturedPhoto = (url: string) => {
    kvSet(FEATURED_KEY, JSON.stringify(getFeaturedPhotos().filter(p => p.url !== url)));
    window.dispatchEvent(new Event("moments-profile-updated"));
};
export const addManualPhoto = (url: string) => {
    kvSet(MANUAL_KEY, JSON.stringify([{ url, addedAt: new Date().toISOString() }, ...getManualPhotos()]));
    kvSet(HIDDEN_KEY, JSON.stringify(getHiddenAlbumPhotos().filter(hiddenUrl => hiddenUrl !== url)));
    window.dispatchEvent(new Event("moments-profile-updated"));
};
const getHiddenAlbumPhotos = (): string[] => {
    if (typeof window === "undefined") return [];
    try {
        const urls = JSON.parse(kvGet(HIDDEN_KEY) || "[]");
        return Array.isArray(urls) ? urls.filter((url: unknown): url is string => typeof url === "string") : [];
    } catch { return []; }
};
export const removeAlbumPhoto = (photo: MomentsPhoto) => {
    if (photo.postId) {
        kvSet(HIDDEN_KEY, JSON.stringify([...new Set([...getHiddenAlbumPhotos(), photo.url])]));
    } else {
        kvSet(MANUAL_KEY, JSON.stringify(getManualPhotos().filter(p => p.url !== photo.url)));
    }
    kvSet(FEATURED_KEY, JSON.stringify(getFeaturedPhotos().filter(p => p.url !== photo.url)));
    window.dispatchEvent(new Event("moments-profile-updated"));
};
export const getMomentsMusicId = () => typeof window === "undefined" ? "" : kvGet(MUSIC_KEY) || "";
export const setMomentsMusicId = (id: string) => { kvSet(MUSIC_KEY, id); window.dispatchEvent(new Event("moments-profile-updated")); };
export const getPostPhotos = (post: MomentPost): string[] => post.photoUrls?.length ? post.photoUrls : post.photoUrl ? [post.photoUrl] : [];
export const getMyMomentsPhotos = (posts: MomentPost[]): MomentsPhoto[] => {
    const fromPosts = posts.filter(p => p.authorType === "user").flatMap(p => getPostPhotos(p).map(url => ({ url, postId: p.id, addedAt: p.createdAt })));
    const seen = new Set<string>();
    const hidden = new Set(getHiddenAlbumPhotos());
    return [...fromPosts, ...getManualPhotos(), ...getFeaturedPhotos()].sort((a, b) => b.addedAt.localeCompare(a.addedAt)).filter(p => !hidden.has(p.url) && !seen.has(p.url) && !!seen.add(p.url));
};
