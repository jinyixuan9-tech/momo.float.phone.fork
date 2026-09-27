import type { Character } from "./character-types";
import type { CheckPhoneXPayload } from "./checkphone-config";
import { generateTwitterText } from "./twitter-engine";
import { generateTwitterComments } from "./twitter-world-engine";
import { resolveMediaForUse } from "./media-resolver";
import { createTwitterId, loadTwitterState, saveTwitterState, type TwitterEngagement, type TwitterPost, type TwitterState } from "./twitter-storage";

const strangerAvatar = "https://imgbed.heliar.top/i/Q3w-VKasJ0oD-MB1_%E2%9A%AB%EF%B8%8F_1_see3lvy__%E6%9D%A5%E8%87%AA%E5%B0%8F%E7%BA%A2%E4%B9%A6%E7%BD%91%E9%A1%B5%E7%89%88.jpg";
const handle = (value: string) => value.replace(/^@/, "").replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 28).toLowerCase() || "visitor";
const body = (post: TwitterPost) => post.translated && post.translated !== post.original ? `${post.original}|${post.translated}` : post.original;
const metrics = (post: TwitterPost, state: TwitterState) => ({
  replyCount: Math.max(post.engagement?.comments || 0, state.posts.filter(reply => reply.replyToId === post.id).length),
  repostCount: post.engagement?.reposts || 0,
  likeCount: post.engagement?.likes || 0,
  viewCount: post.engagement?.views || 0,
});

/** Check Phone shows the actual main account, never an independently generated copy. */
export function projectCharacterTwitter(character: Character, state: TwitterState): CheckPhoneXPayload {
  const profile = state.characterProfiles[character.id];
  const name = profile?.name || character.name;
  const account = {
    name,
    handle: profile?.handle || character.name.replace(/\s+/g, "_").toLowerCase(),
    bio: profile?.bio || "",
    avatarUrl: profile?.avatarUrl || character.avatar || undefined,
    bannerUrl: profile?.bannerUrl,
    followingCount: profile?.followingCount || 0,
    followerCount: profile?.followers || 0,
    joinedAt: profile?.createdAt ? `${new Date(profile.createdAt).getFullYear()}年${new Date(profile.createdAt).getMonth() + 1}月` : undefined,
  };
  const own = state.posts.filter(post => post.authorId === character.id).sort((a, b) => b.createdAt - a.createdAt);
  const posts = own.filter(post => !post.replyToId && !post.repostOfId).map(post => ({
    id: post.id, body: body(post), imageRef: post.imageRef || post.imageRefs?.[0],
    mediaDescription: post.imageDescription,
    createdAt: new Date(post.createdAt).toISOString(), ...metrics(post, state), note: "",
  }));
  const replies = own.filter(post => !!post.replyToId).map(post => {
    const target = state.posts.find(item => item.id === post.replyToId);
    const targetProfile = target?.authorId === "user" ? state.profile : target ? state.accounts[target.authorId] || state.characterProfiles[target.authorId] : undefined;
    return {
      id: post.id,
      targetName: targetProfile?.handle ? `@${targetProfile.handle.replace(/^@/, "")}` : targetProfile?.name || "对方",
      targetSnippet: target ? body(target) : "原帖已删除",
      body: body(post), createdAt: new Date(post.createdAt).toISOString(), ...metrics(post, state), note: "",
    };
  });
  const likes = state.actions.filter(action => action.kind === "like" && action.actorId === character.id)
    .sort((a, b) => b.createdAt - a.createdAt).flatMap(action => {
      const post = state.posts.find(item => item.id === action.targetPostId);
      if (!post) return [];
      const author = post.authorId === "user" ? state.profile : state.accounts[post.authorId] || state.characterProfiles[post.authorId];
      return [{ id: action.id, authorName: author?.name || "用户", authorHandle: author?.handle || "user", body: body(post), imageRef: post.imageRef || post.imageRefs?.[0], mediaDescription: post.imageDescription, createdAt: new Date(action.createdAt).toISOString(), ...metrics(post, state), likeReason: "" }];
    });
  return { headerTitle: "X", headerSubtitle: "账号动态", profile: account, posts, replies, media: [], likes };
}

function engagement(id: string, followers: number, comments: number): TwitterEngagement {
  // Follows the same follower-based scale as the X character post flow.
  const reach = Math.max(9, Math.round(Math.sqrt(Math.max(0, followers)) * 9));
  return { views: reach, likes: Math.round(reach * .09), reposts: Math.round(reach * .01), comments: Math.max(comments, Math.round(reach * .01)) };
}

/** Explicitly publish to the native X store; both phone views then read this post ID. */
export async function publishCharacterTwitterFromCheckPhone(character: Character): Promise<string> {
  const snapshot = loadTwitterState();
  const account = snapshot.characterProfiles[character.id];
  const lines = await generateTwitterText({ characterId: character.id, state: snapshot, kind: "post", withComments: account?.visibility !== "protected" });
  const line = lines[0];
  const id = createTwitterId();
  let imageRef: string | undefined;
  let imageDescription: string | undefined;
  if (line.photoDescription) {
    const media = await resolveMediaForUse({ actor: { type: "character", characterId: character.id }, description: line.photoDescription, intentKind: /自拍|人像|selfie|portrait/i.test(line.photoDescription) ? "portrait" : "other", channel: "other", appId: "twitter", targetId: id }).catch(() => null);
    imageRef = media?.imageUrl?.replace(/^asset:\/\//, "");
    imageDescription = media?.placeholderDescription;
  }
  const now = Date.now();
  const post: TwitterPost = { id, authorId: character.id, original: line.original, translated: line.translated, imageRef, imageDescription, createdAt: now, engagement: engagement(id, account?.followers || 0, lines.comments?.length || 0), commentsGenerated: false };
  let comments = lines.comments || [];
  if (account?.visibility !== "protected" && comments.length < 5) {
    try { comments = [...comments, ...await generateTwitterComments(snapshot, post, account?.name || character.name, comments.map(item => item.original))].slice(0, 10); }
    catch { /* A post can still be published when its comments fail to generate. */ }
  }
  // Reload after the async calls so unrelated X activity is not overwritten.
  const latest = loadTwitterState();
  const accounts = { ...latest.accounts };
  const replyPosts: TwitterPost[] = account?.visibility === "protected" ? [] : comments.map((comment, index) => {
    const authorId = `npc:${createTwitterId()}`;
    accounts[authorId] = { name: comment.name || "路人", handle: handle(comment.handle || comment.name), bio: "", visibility: "public", avatarUrl: strangerAvatar };
    return { id: createTwitterId(), authorId, original: comment.original, translated: comment.translated, replyToId: id, createdAt: now + index + 1 };
  });
  post.commentsGenerated = replyPosts.length > 0;
  post.engagement = engagement(id, account?.followers || 0, replyPosts.length);
  saveTwitterState({ ...latest, accounts, posts: [...latest.posts, post, ...replyPosts] });
  return id;
}
