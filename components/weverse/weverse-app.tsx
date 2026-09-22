"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bell,
  Bookmark,
  CalendarDays,
  Camera,
  ChevronLeft,
  ChevronRight,
  CircleUserRound,
  Heart,
  ImagePlus,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  Radio,
  Search,
  Send,
  Settings,
  Sparkles,
  Trash2,
  UserRound,
  UsersRound,
  Video,
  X,
} from "lucide-react";

import { loadCharacters, CHARACTERS_UPDATED_EVENT } from "@/lib/character-storage";
import type { Character } from "@/lib/character-types";
import { resolveUserIdentity, USER_IDENTITIES_UPDATED_EVENT } from "@/lib/settings-storage";
import {
  addWeverseComment,
  addWeversePost,
  createWeverseId,
  deleteWeverseCommunity,
  deleteWeversePost,
  loadWeverseState,
  updateWeversePost,
  updateWeverseUserProfile,
  upsertWeverseCommunity,
  WEV_UPDATED_EVENT,
  type WeverseAuthorType,
  type WeverseComment,
  type WeverseCommunity,
  type WeversePost,
  type WeverseState,
} from "@/lib/weverse-storage";
import { generateWeverseArtistPost, generateWeverseFanBatch } from "@/lib/weverse-engine";
import { getPhotoSourceStrategy, recordPhotoUse, resolvePhotoForUse } from "@/lib/photo-library-resolver";
import { recordWeverseArtistPostEvent, deleteWeverseProjectionEventsForPost } from "@/lib/weverse-memory";
import { incrementEventCounter } from "@/lib/memory-storage";
import { maybeRunSummarization } from "@/lib/memory-summarizer";
import { getChatImageFromIndexedDB } from "@/lib/chat-asset-storage";

import styles from "./weverse-app.module.css";

type Props = {
  onClose: () => void;
  onNotice?: (message: string) => void;
};

type MainTab = "feed" | "community";
type CommunityTab = "home" | "feed" | "media";
type CommunityFeedFilter = "highlight" | "fan" | "artist";
type ArtistTab = "posts" | "comments" | "live";
type Route =
  | { type: "root" }
  | { type: "community"; id: string }
  | { type: "artist"; communityId: string; characterId: string }
  | { type: "post"; postId: string };

type CommunityEditorDraft = {
  id?: string;
  name: string;
  description: string;
  avatarUrl: string;
  coverUrl: string;
  officialName: string;
  officialAvatarUrl: string;
  officialBio: string;
  selectedCharacterIds: string[];
};

type MemberEditorDraft = {
  communityId: string;
  characterId: string;
  displayName: string;
  avatarUrl: string;
  coverUrl: string;
  bio: string;
};

type UserProfileDraft = {
  displayName: string;
  avatarUrl: string;
  bio: string;
};

function fileToDataUrl(file: File, maxSize = 900, quality = 0.86): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const scale = Math.min(maxSize / img.width, maxSize / img.height, 1);
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("无法读取图片"));
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/webp", quality));
      };
      img.onerror = reject;
      img.src = String(reader.result || "");
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function relativeTime(ts: number): string {
  const diff = Math.max(0, Date.now() - ts);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return "刚刚";
  if (diff < hour) return `${Math.floor(diff / minute)}分钟前`;
  if (diff < day) return `${Math.floor(diff / hour)}小时前`;
  if (diff < day * 7) return `${Math.floor(diff / day)}天前`;
  return new Date(ts).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

function Avatar({
  text,
  imageUrl,
  tone = "dark",
  className = "",
}: {
  text: string;
  imageUrl?: string | null;
  tone?: "dark" | "teal" | "soft";
  className?: string;
}) {
  if (imageUrl) {
    return <span className={`${styles.avatar} ${styles.avatarImage} ${className}`}><img src={imageUrl} alt="" /></span>;
  }
  return <span className={`${styles.avatar} ${styles[tone]} ${className}`}>{text.trim().slice(0, 1) || "W"}</span>;
}

function Verified() {
  return <span className={styles.verify}>✓</span>;
}
function ResolvedAssetImage({ src, className = "", alt = "" }: { src: string; className?: string; alt?: string }) {
  const [resolved, setResolved] = useState(src.startsWith("asset://") ? "" : src);
  useEffect(() => {
    let cancelled = false;
    if (!src.startsWith("asset://")) { setResolved(src); return; }
    getChatImageFromIndexedDB(src.slice(8)).then((url) => { if (!cancelled) setResolved(url || ""); }).catch(() => { if (!cancelled) setResolved(""); });
    return () => { cancelled = true; };
  }, [src]);
  if (!resolved) return <span className={styles.assetImagePlaceholder}>…</span>;
  return <img className={className} src={resolved} alt={alt} />;
}

function WeversePostImage({ src, onClick }: { src: string; onClick?: () => void }) {
  return <button type="button" className={styles.postImageButton} onClick={onClick}><ResolvedAssetImage src={src} className={styles.postImage} alt="WVS post" /></button>;
}


export function WeverseApp({ onClose, onNotice }: Props) {
  const [tab, setTab] = useState<MainTab>("feed");
  const [routeStack, setRouteStack] = useState<Route[]>([{ type: "root" }]);
  const [state, setState] = useState<WeverseState>(() => loadWeverseState());
  const [characters, setCharacters] = useState<Character[]>(() => loadCharacters());
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerAuthorType, setComposerAuthorType] = useState<WeverseAuthorType>("user");
  const [editingPostId, setEditingPostId] = useState<string | null>(null);
  const [postMenuId, setPostMenuId] = useState<string | null>(null);
  const [communityMenuId, setCommunityMenuId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [communityEditor, setCommunityEditor] = useState<CommunityEditorDraft | null>(null);
  const [communityEditorError, setCommunityEditorError] = useState("");
  const [memberEditor, setMemberEditor] = useState<MemberEditorDraft | null>(null);
  const [draftText, setDraftText] = useState("");
  const [draftImageUrl, setDraftImageUrl] = useState("");
  const [draftCommunityId, setDraftCommunityId] = useState("");
  const [commentDraft, setCommentDraft] = useState("");
  const [communityTab, setCommunityTab] = useState<CommunityTab>("home");
  const [communityFeedFilter, setCommunityFeedFilter] = useState<CommunityFeedFilter>("highlight");
  const [artistTab, setArtistTab] = useState<ArtistTab>("posts");
  const [searchText, setSearchText] = useState("");
  const [userProfileDraft, setUserProfileDraft] = useState<UserProfileDraft | null>(null);
  const [showOriginalByPost, setShowOriginalByPost] = useState<Record<string, boolean>>({});
  const [generatingCommunityId, setGeneratingCommunityId] = useState<string | null>(null);
  const [, setIdentityTick] = useState(0);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const communityAvatarInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const officialAvatarInputRef = useRef<HTMLInputElement>(null);
  const memberAvatarInputRef = useRef<HTMLInputElement>(null);
  const memberCoverInputRef = useRef<HTMLInputElement>(null);
  const userAvatarInputRef = useRef<HTMLInputElement>(null);

  const route = routeStack[routeStack.length - 1] ?? { type: "root" as const };
  const immersiveRoute = route.type === "community" || route.type === "artist";
  const userIdentity = resolveUserIdentity(undefined, "weverse") ?? resolveUserIdentity();
  const userName = state.userProfile?.displayName?.trim() || userIdentity?.name?.trim() || "我";
  const userAvatar = state.userProfile?.avatarUrl || userIdentity?.avatarUrl || "";
  const userBio = state.userProfile?.bio?.trim() || userIdentity?.bio?.trim() || "Fan account";

  useEffect(() => {
    const reloadState = () => setState(loadWeverseState());
    const reloadCharacters = () => setCharacters(loadCharacters());
    const reloadIdentity = () => setIdentityTick((value) => value + 1);
    window.addEventListener(WEV_UPDATED_EVENT, reloadState);
    window.addEventListener(CHARACTERS_UPDATED_EVENT, reloadCharacters);
    window.addEventListener(USER_IDENTITIES_UPDATED_EVENT, reloadIdentity);
    return () => {
      window.removeEventListener(WEV_UPDATED_EVENT, reloadState);
      window.removeEventListener(CHARACTERS_UPDATED_EVENT, reloadCharacters);
      window.removeEventListener(USER_IDENTITIES_UPDATED_EVENT, reloadIdentity);
    };
  }, []);

  useEffect(() => {
    if (!draftCommunityId && state.communities[0]?.id) setDraftCommunityId(state.communities[0].id);
    if (draftCommunityId && !state.communities.some((item) => item.id === draftCommunityId)) {
      setDraftCommunityId(state.communities[0]?.id || "");
    }
  }, [draftCommunityId, state.communities]);

  const characterMap = useMemo(() => new Map(characters.map((item) => [item.id, item])), [characters]);
  const communityMap = useMemo(() => new Map(state.communities.map((item) => [item.id, item])), [state.communities]);
  const postMap = useMemo(() => new Map(state.posts.map((item) => [item.id, item])), [state.posts]);
  const filteredCommunities = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    if (!query) return state.communities;
    return state.communities.filter((item) => item.name.toLowerCase().includes(query));
  }, [searchText, state.communities]);

  const showTodo = (label: string) => onNotice?.(`${label}后续接入`);
  const navigate = (next: Route) => setRouteStack((prev) => [...prev, next]);
  const back = () => {
    if (routeStack.length > 1) setRouteStack((prev) => prev.slice(0, -1));
    else onClose();
  };
  const goRoot = (nextTab: MainTab) => {
    setTab(nextTab);
    setRouteStack([{ type: "root" }]);
  };

  const resolveMember = (community: WeverseCommunity, characterId: string) => {
    const char = characterMap.get(characterId);
    const override = community.memberProfiles[characterId];
    return {
      character: char,
      displayName: override?.displayName?.trim() || char?.name?.trim() || "未命名成员",
      avatarUrl: override?.avatarUrl || char?.avatar || "",
      coverUrl: override?.coverUrl || community.coverUrl || "",
      bio: override?.bio || "",
    };
  };

  const resolvePostAuthor = (post: WeversePost) => {
    const community = communityMap.get(post.communityId);
    if (post.authorType === "user") {
      return { name: userName, avatarUrl: userAvatar, verified: false, meta: `${community?.name || "Community"} · Fan` };
    }
    if (post.authorType === "fan") {
      return { name: post.authorName || "匿名粉丝", avatarUrl: post.authorAvatarUrl || "", verified: false, meta: `${community?.name || "Community"} · Fan` };
    }
    if (post.authorType === "official") {
      return {
        name: community?.official.displayName || `${community?.name || "Community"} Official`,
        avatarUrl: community?.official.avatarUrl || "",
        verified: true,
        meta: `${community?.name || "Community"} · Official`,
      };
    }
    if (community) {
      const member = resolveMember(community, post.authorId);
      return { name: member.displayName, avatarUrl: member.avatarUrl, verified: true, meta: `${community.name} · Artist` };
    }
    return { name: characterMap.get(post.authorId)?.name || "Artist", avatarUrl: characterMap.get(post.authorId)?.avatar || "", verified: true, meta: "Artist" };
  };

  const resolveCommentAuthor = (comment: WeverseComment, post: WeversePost) => {
    const community = communityMap.get(post.communityId);
    if (comment.authorType === "user") return { name: userName, avatarUrl: userAvatar, verified: false };
    if (comment.authorType === "fan") return { name: comment.authorName || "匿名粉丝", avatarUrl: comment.authorAvatarUrl || "", verified: false };
    if (comment.authorType === "official") return { name: community?.official.displayName || "Official", avatarUrl: community?.official.avatarUrl || "", verified: true };
    if (community) {
      const member = resolveMember(community, comment.authorId);
      return { name: member.displayName, avatarUrl: member.avatarUrl, verified: true };
    }
    return { name: "Artist", avatarUrl: "", verified: true };
  };

  const openCommunityEditor = (community?: WeverseCommunity) => {
    setCommunityEditorError("");
    setCommunityEditor({
      id: community?.id,
      name: community?.name || "",
      description: community?.description || "",
      avatarUrl: community?.avatarUrl || "",
      coverUrl: community?.coverUrl || "",
      officialName: community?.official.displayName || "",
      officialAvatarUrl: community?.official.avatarUrl || "",
      officialBio: community?.official.bio || "",
      selectedCharacterIds: community?.memberCharacterIds || [],
    });
  };

  const saveCommunityEditor = () => {
    if (!communityEditor) return;
    const name = communityEditor.name.trim();
    if (!name) {
      setCommunityEditorError("先填写 Community 名称");
      onNotice?.("先填写 Community 名称");
      return;
    }
    if (communityEditor.selectedCharacterIds.length === 0) {
      setCommunityEditorError("至少选择 1 个成员角色");
      onNotice?.("至少选择 1 个成员角色");
      return;
    }
    setCommunityEditorError("");
    const existing = communityEditor.id ? communityMap.get(communityEditor.id) : undefined;
    const now = Date.now();
    const id = existing?.id || createWeverseId("wvs_community");
    const memberProfiles = { ...(existing?.memberProfiles || {}) };
    Object.keys(memberProfiles).forEach((key) => {
      if (!communityEditor.selectedCharacterIds.includes(key)) delete memberProfiles[key];
    });
    const next: WeverseCommunity = {
      id,
      name,
      description: communityEditor.description.trim(),
      avatarUrl: communityEditor.avatarUrl || undefined,
      coverUrl: communityEditor.coverUrl || undefined,
      official: {
        displayName: communityEditor.officialName.trim() || `${name} Official`,
        avatarUrl: communityEditor.officialAvatarUrl || undefined,
        bio: communityEditor.officialBio.trim() || "Official Community",
      },
      memberCharacterIds: communityEditor.selectedCharacterIds,
      memberProfiles,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    const nextState = upsertWeverseCommunity(next);
    setState(nextState);
    setCommunityEditor(null);
    setDraftCommunityId(id);
    setTab("community");
    setRouteStack([{ type: "root" }, { type: "community", id }]);
    onNotice?.(existing ? "Community 已更新" : "Community 已创建");
  };

  const removeCommunity = (community: WeverseCommunity) => {
    if (!window.confirm(`删除「${community.name}」Community？该社区里的 WVS 帖子也会一起删除。`)) return;
    state.posts.filter((post) => post.communityId === community.id && post.authorType === "artist").forEach((post) => deleteWeverseProjectionEventsForPost(post.id));
    setState(deleteWeverseCommunity(community.id));
    setCommunityEditor(null);
    setCommunityMenuId(null);
    setRouteStack([{ type: "root" }]);
    setTab("community");
    onNotice?.("Community 已删除");
  };

  const openMemberEditor = (community: WeverseCommunity, characterId: string) => {
    const member = resolveMember(community, characterId);
    setMemberEditor({
      communityId: community.id,
      characterId,
      displayName: member.displayName,
      avatarUrl: member.avatarUrl,
      coverUrl: community.memberProfiles[characterId]?.coverUrl || "",
      bio: member.bio,
    });
  };

  const saveMemberEditor = () => {
    if (!memberEditor) return;
    const community = communityMap.get(memberEditor.communityId);
    if (!community) return;
    const char = characterMap.get(memberEditor.characterId);
    const next: WeverseCommunity = {
      ...community,
      memberProfiles: {
        ...community.memberProfiles,
        [memberEditor.characterId]: {
          characterId: memberEditor.characterId,
          displayName: memberEditor.displayName.trim() || char?.name || "成员",
          avatarUrl: memberEditor.avatarUrl || undefined,
          coverUrl: memberEditor.coverUrl || undefined,
          bio: memberEditor.bio.trim() || undefined,
        },
      },
      updatedAt: Date.now(),
    };
    setState(upsertWeverseCommunity(next));
    setMemberEditor(null);
    onNotice?.("成员 WVS 资料已保存，不影响角色本体资料");
  };

  const openUserProfileEditor = () => {
    setDrawerOpen(false);
    setUserProfileDraft({
      displayName: state.userProfile?.displayName || userIdentity?.name || "",
      avatarUrl: state.userProfile?.avatarUrl || userIdentity?.avatarUrl || "",
      bio: state.userProfile?.bio || userIdentity?.bio || "",
    });
  };

  const saveUserProfile = () => {
    if (!userProfileDraft) return;
    const nextState = updateWeverseUserProfile({
      displayName: userProfileDraft.displayName.trim() || undefined,
      avatarUrl: userProfileDraft.avatarUrl || undefined,
      bio: userProfileDraft.bio.trim() || undefined,
    });
    setState(nextState);
    setUserProfileDraft(null);
    onNotice?.("WVS 粉丝资料已保存，只影响 Weverse 展示");
  };

  const generateCommunityRound = async (community: WeverseCommunity) => {
    if (generatingCommunityId) return;
    if (!community.memberCharacterIds.length) return onNotice?.("这个 Community 还没有成员");
    setCommunityMenuId(null);
    setGeneratingCommunityId(community.id);
    onNotice?.("正在生成这一轮 WVS 社区动态…");
    try {
      const artistCounts = new Map<string, number>();
      for (const characterId of community.memberCharacterIds) {
        artistCounts.set(characterId, state.posts.filter((post) => post.communityId === community.id && post.authorType === "artist" && post.authorId === characterId).length);
      }
      const characterId = [...community.memberCharacterIds].sort((a, b) => (artistCounts.get(a) || 0) - (artistCounts.get(b) || 0))[0];
      const member = resolveMember(community, characterId);
      const generated = await generateWeverseArtistPost(characterId, community);
      let imageUrl: string | undefined;
      let photoLibraryId: string | undefined;
      let photoSource: WeversePost["photoSource"];
      const strategy = getPhotoSourceStrategy("wvs");
      if (generated.photoDescription && strategy !== "generated_only") {
        const match = await resolvePhotoForUse({ characterId, description: generated.photoDescription, channel: "wvs", targetId: community.id }).catch(() => null);
        if (match) {
          imageUrl = `asset://${match.photo.assetId}`;
          photoLibraryId = match.photo.id;
          photoSource = "album";
          recordPhotoUse(match, { characterId, description: generated.photoDescription, channel: "wvs", targetId: community.id });
        }
      }
      const artistPost: WeversePost = {
        id: createWeverseId("wvs_post"),
        communityId: community.id,
        authorType: "artist",
        authorId: characterId,
        body: generated.translated,
        originalBody: generated.original !== generated.translated ? generated.original : undefined,
        imageUrl,
        photoLibraryId,
        photoSource,
        createdAt: Date.now(),
        comments: [],
      };
      addWeversePost(artistPost);
      recordWeverseArtistPostEvent({
        characterId,
        characterName: member.displayName,
        communityName: community.name,
        postId: artistPost.id,
        body: artistPost.body,
        originalBody: artistPost.originalBody,
        hasPhoto: Boolean(artistPost.imageUrl),
        timestamp: new Date(artistPost.createdAt).toISOString(),
      });
      incrementEventCounter(characterId);
      maybeRunSummarization(characterId, member.displayName).catch(() => undefined);

      const fanBatch = await generateWeverseFanBatch(community, [artistPost, ...state.posts]);
      for (const item of fanBatch.posts) {
        addWeversePost({
          id: createWeverseId("wvs_fan_post"),
          communityId: community.id,
          authorType: "fan",
          authorId: createWeverseId("fan"),
          authorName: item.displayName,
          body: item.body,
          createdAt: Date.now() + Math.floor(Math.random() * 1200),
          comments: [],
        });
      }
      for (const item of fanBatch.comments) {
        addWeverseComment(artistPost.id, {
          id: createWeverseId("wvs_fan_comment"),
          authorType: "fan",
          authorId: createWeverseId("fan"),
          authorName: item.displayName,
          body: item.body,
          createdAt: Date.now() + Math.floor(Math.random() * 1200),
        });
      }
      setState(loadWeverseState());
      setCommunityTab("feed");
      setCommunityFeedFilter("highlight");
      onNotice?.(`${member.displayName} 发了一条 Artist Post，社区也刷新了粉丝内容`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      onNotice?.(`WVS 生成失败：${message}`);
    } finally {
      setGeneratingCommunityId(null);
    }
  };

  const openComposer = (authorType: "user" | "official", communityId: string) => {
    const community = communityMap.get(communityId);
    if (!community) return onNotice?.("Community 不存在");
    setComposerAuthorType(authorType);
    setEditingPostId(null);
    setDraftCommunityId(communityId);
    setDraftText("");
    setDraftImageUrl("");
    setComposerOpen(true);
  };

  const openPostEditor = (post: WeversePost) => {
    setPostMenuId(null);
    setComposerAuthorType(post.authorType);
    setEditingPostId(post.id);
    setDraftCommunityId(post.communityId);
    setDraftText(post.body);
    setDraftImageUrl(post.imageUrl || "");
    setComposerOpen(true);
  };

  const publish = () => {
    const body = draftText.trim();
    if (!body && !draftImageUrl) return onNotice?.("先写点内容或加一张图片吧");
    const community = communityMap.get(draftCommunityId);
    if (!community) return onNotice?.("请选择发布到哪个 Community");

    if (editingPostId) {
      const existingPost = postMap.get(editingPostId);
      setState(updateWeversePost(editingPostId, { body, originalBody: undefined, imageUrl: draftImageUrl || undefined }));
      if (existingPost?.authorType === "artist") {
        const character = characterMap.get(existingPost.authorId);
        recordWeverseArtistPostEvent({
          characterId: existingPost.authorId,
          characterName: character?.name || "Artist",
          communityName: community.name,
          postId: existingPost.id,
          body,
          hasPhoto: Boolean(draftImageUrl),
          timestamp: new Date(existingPost.createdAt).toISOString(),
        });
      }
      setComposerOpen(false);
      setEditingPostId(null);
      setDraftText("");
      setDraftImageUrl("");
      onNotice?.("贴文已更新");
      return;
    }

    const post: WeversePost = {
      id: createWeverseId("wvs_post"),
      communityId: community.id,
      authorType: composerAuthorType,
      authorId: composerAuthorType === "user" ? (userIdentity?.id || "user") : community.id,
      body,
      imageUrl: draftImageUrl || undefined,
      createdAt: Date.now(),
      comments: [],
    };
    setState(addWeversePost(post));
    setComposerOpen(false);
    setDraftText("");
    setDraftImageUrl("");
    onNotice?.(composerAuthorType === "official" ? "已用 Official Account 发布" : "已发布到 Community");
  };

  const removePost = (post: WeversePost) => {
    if (!window.confirm("删除这条贴文？")) return;
    setState(deleteWeversePost(post.id));
    if (post.authorType === "artist") deleteWeverseProjectionEventsForPost(post.id);
    setPostMenuId(null);
    if (route.type === "post" && route.postId === post.id) back();
    onNotice?.("贴文已删除");
  };

  const toggleLike = (post: WeversePost) => setState(updateWeversePost(post.id, { likedByUser: !post.likedByUser }));
  const toggleBookmark = (post: WeversePost) => setState(updateWeversePost(post.id, { bookmarkedByUser: !post.bookmarkedByUser }));

  const submitComment = (post: WeversePost) => {
    const body = commentDraft.trim();
    if (!body) return;
    setState(addWeverseComment(post.id, {
      id: createWeverseId("wvs_comment"),
      authorType: "user",
      authorId: userIdentity?.id || "user",
      body,
      createdAt: Date.now(),
    }));
    setCommentDraft("");
  };

  const renderPostActions = (post: WeversePost, detail = false) => (
    <div className={styles.actions}>
      <div className={styles.actionLeft}>
        <button type="button" className={`${styles.actionBtn} ${post.likedByUser ? styles.activeAction : ""}`} onClick={() => toggleLike(post)}><Heart size={18} fill={post.likedByUser ? "currentColor" : "none"} />{post.likedByUser ? "1" : ""}</button>
        <button type="button" className={styles.actionBtn} onClick={() => detail ? document.getElementById("wvs-comment-input")?.focus() : navigate({ type: "post", postId: post.id })}><MessageCircle size={18} />{post.comments.length || ""}</button>
      </div>
      <button type="button" className={`${styles.actionBtn} ${post.bookmarkedByUser ? styles.activeAction : ""}`} onClick={() => toggleBookmark(post)}><Bookmark size={18} fill={post.bookmarkedByUser ? "currentColor" : "none"} /></button>
    </div>
  );

  const renderPost = (post: WeversePost, detail = false) => {
    const author = resolvePostAuthor(post);
    const community = communityMap.get(post.communityId);
    return (
      <article className={`${styles.post} ${post.authorType === "official" ? styles.officialPost : ""}`} key={post.id}>
        <div className={styles.postHead}>
          <button type="button" className={styles.avatarButton} onClick={() => {
            if (post.authorType === "artist" && community) { setArtistTab("posts"); navigate({ type: "artist", communityId: community.id, characterId: post.authorId }); }
            else if (community) navigate({ type: "community", id: community.id });
          }}>
            <Avatar text={author.name} imageUrl={author.avatarUrl} tone={post.authorType === "official" ? "teal" : "soft"} />
          </button>
          <div className={styles.who}><div className={styles.name}>{author.name} {author.verified ? <Verified /> : null}</div><div className={styles.meta}>{author.meta} · {relativeTime(post.createdAt)}</div></div>
          <button type="button" className={styles.more} onClick={() => setPostMenuId(post.id)} aria-label="贴文菜单"><MoreHorizontal size={20} /></button>
        </div>
        {post.authorType === "official" ? <div className={styles.noticeTag}>OFFICIAL</div> : null}
        {post.body ? <div className={styles.postBody} onClick={() => !detail && navigate({ type: "post", postId: post.id })}>{showOriginalByPost[post.id] && post.originalBody ? post.originalBody : post.body}</div> : null}
        {post.imageUrl ? <WeversePostImage src={post.imageUrl} onClick={() => !detail && navigate({ type: "post", postId: post.id })} /> : null}
        {post.originalBody && post.originalBody !== post.body ? <button type="button" className={styles.translateBtn} onClick={() => setShowOriginalByPost((prev) => ({ ...prev, [post.id]: !prev[post.id] }))}>{showOriginalByPost[post.id] ? "查看翻译" : "查看原文"}</button> : null}
        {renderPostActions(post, detail)}
      </article>
    );
  };

  const currentTitle = () => {
    if (route.type === "post") return "Post";
    return null;
  };

  const renderTopbar = () => {
    if (immersiveRoute) return null;
    return (
      <header className={styles.topbar}>
        <div className={styles.toprow}>
          <div className={styles.leftTop}>
            <button type="button" className={styles.iconBtn} onClick={back} aria-label="返回"><ChevronLeft size={22} /></button>
            {currentTitle() ? <strong className={styles.pageTitle}>{currentTitle()}</strong> : <div className={styles.brand}>weverse<span>✦</span></div>}
          </div>
          <div className={styles.topActions}>
            <button type="button" className={styles.iconBtn} onClick={() => showTodo("Ask Weverse") } aria-label="Ask Weverse"><Sparkles size={20} /></button>
            <button type="button" className={styles.iconBtn} onClick={() => showTodo("通知页") } aria-label="通知"><Bell size={20} /></button>
            <button type="button" className={styles.iconBtn} onClick={() => setDrawerOpen(true)} aria-label="我的"><CircleUserRound size={21} /></button>
          </div>
        </div>
      </header>
    );
  };

  const renderFeed = () => {
    const posts = [...state.posts]
      .filter((post) => post.authorType === "artist" || post.authorType === "official")
      .sort((a, b) => b.createdAt - a.createdAt);
    return (
      <div className={styles.scrollArea}>
        <div className={styles.artistFeedHeading}>艺人动态</div>
        {posts.length ? posts.map((post) => renderPost(post)) : (
          <div className={styles.emptyState}>
            <Sparkles size={30} />
            <b>还没有艺人动态</b>
            <p>首页只显示 Artist / Official 内容。Fan Post 会留在各自的 Community 里。</p>
            <button type="button" onClick={() => goRoot("community")}>进入 Community</button>
          </div>
        )}
        <div className={styles.bottomSpacer} />
      </div>
    );
  };

  const renderCommunityList = () => (
    <div className={styles.scrollArea}>
      <div className={styles.communityHeader}><h2>Community</h2><button type="button" className={styles.iconBtn} onClick={() => openCommunityEditor()}><Plus size={20} /></button></div>
      <div className={styles.search}><Search size={18} /><input value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="搜索我的社区" /></div>
      <div className={styles.sectionTitle}>我的社区</div>
      <div className={styles.communityGrid}>
        {filteredCommunities.map((community) => (
          <button type="button" className={styles.communityCard} key={community.id} onClick={() => { setCommunityTab("home"); navigate({ type: "community", id: community.id }); }}>
            <div className={styles.communityLogo}>{community.avatarUrl || community.official.avatarUrl ? <img src={community.avatarUrl || community.official.avatarUrl} alt="" /> : community.name.slice(0, 2)}</div>
            <div className={styles.communityInfo}><b>{community.name}</b><p>{community.memberCharacterIds.length} 位成员 · {community.official.displayName}</p></div><ChevronRight size={21} />
          </button>
        ))}
        <button type="button" className={`${styles.communityCard} ${styles.newCard}`} onClick={() => openCommunityEditor()}><Plus size={18} /> 新建 Community</button>
      </div>
      {!state.communities.length ? <div className={styles.tipCard}><Sparkles size={18} /><div><b>从这里开始</b><p>建立 Community → 设置官号 → 从现有角色里勾选成员。没有勾选的角色不会进入 WVS。</p></div></div> : null}
      <div className={styles.bottomSpacer} />
    </div>
  );

  const renderCommunityHero = (community: WeverseCommunity) => (
    <div className={styles.communityHero} style={community.coverUrl ? { backgroundImage: `linear-gradient(180deg,rgba(0,0,0,.05),rgba(0,0,0,.72)),url(${community.coverUrl})` } : undefined}>
      <div className={styles.immersiveControls}>
        <button type="button" onClick={back}><ChevronLeft size={24} /></button>
        <div><button type="button" onClick={() => showTodo("Ask Weverse")}><Sparkles size={20} /></button><button type="button" onClick={() => showTodo("通知页")}><Bell size={20} /></button><button type="button" onClick={() => setCommunityMenuId(community.id)}><MoreHorizontal size={22} /></button></div>
      </div>
      <div className={styles.communityHeroText}>
        <span>{community.memberCharacterIds.length} members · ✓ 已加入</span>
        <h1>{community.name}</h1>
      </div>
    </div>
  );

  const renderCommunityHome = (community: WeverseCommunity) => {
    const officialPosts = state.posts.filter((post) => post.communityId === community.id && post.authorType === "official").sort((a, b) => b.createdAt - a.createdAt);
    return (
      <div className={styles.communityPane}>
        <section className={styles.homeSection}>
          <h3>公告</h3>
          <button type="button" className={styles.homeCard} onClick={() => officialPosts[0] ? navigate({ type: "post", postId: officialPosts[0].id }) : showTodo("官方公告 AI") }>
            <div><b>{officialPosts[0]?.body || `请查看 ${community.name} 公告`}</b><small>{officialPosts[0] ? "Official Post" : "暂无公告，之后可由官号发布"}</small></div><ChevronRight size={20} />
          </button>
        </section>
        <section className={styles.homeSection}>
          <h3>Calendar</h3>
          <button type="button" className={styles.homeCard} onClick={() => showTodo("WVS Schedule → 原生日历联动") }>
            <div><b>请查看 {community.name} 的日程</b><small>Schedule / Calendar 将在后续版本接入</small></div><ChevronRight size={20} />
          </button>
        </section>
        <section className={styles.homeSection}>
          <h3>About</h3>
          <div className={styles.aboutCard}>
            <div className={styles.aboutMembers}>
              {community.memberCharacterIds.map((characterId) => {
                const member = resolveMember(community, characterId);
                return <button type="button" key={characterId} onClick={() => { setArtistTab("posts"); navigate({ type: "artist", communityId: community.id, characterId }); }}><Avatar text={member.displayName} imageUrl={member.avatarUrl} tone="soft" /><span>{member.displayName}</span></button>;
              })}
            </div>
            <p>{community.description || `${community.name} Official Community`}</p>
          </div>
        </section>
      </div>
    );
  };

  const renderCommunityFeed = (community: WeverseCommunity) => {
    const posts = state.posts
      .filter((post) => post.communityId === community.id)
      .filter((post) => communityFeedFilter === "highlight"
        ? post.authorType === "artist" || post.authorType === "official"
        : communityFeedFilter === "fan"
          ? post.authorType === "user" || post.authorType === "fan"
          : post.authorType === "artist")
      .sort((a, b) => b.createdAt - a.createdAt);
    return (
      <div className={styles.communityPane}>
        <div className={styles.feedFilters}>
          {(["highlight", "fan", "artist"] as const).map((item) => <button key={item} type="button" className={communityFeedFilter === item ? styles.activeFilter : ""} onClick={() => setCommunityFeedFilter(item)}>{item === "highlight" ? "Highlight" : item === "fan" ? "Fan" : "Artist"}</button>)}
        </div>
        <div className={styles.communityFeedTitle}>{communityFeedFilter === "fan" ? "粉丝帖子" : communityFeedFilter === "artist" ? "最近艺人帖子" : "Community Highlight"}</div>
        {posts.length ? posts.map((post) => renderPost(post)) : <div className={styles.emptyMini}>这里还没有对应内容。</div>}
      </div>
    );
  };

  const renderCommunityMedia = (community: WeverseCommunity) => (
    <div className={styles.communityPane}>
      <section className={styles.mediaSection}>
        <div className={styles.mediaSectionTitle}><h3>最新 LIVE</h3><button type="button" onClick={() => showTodo("Community LIVE 列表")}><ChevronRight size={20} /></button></div>
        <button type="button" className={styles.liveReplayCard} onClick={() => showTodo("Community LIVE / 回放") }>
          <div className={styles.replayThumb}><span>REPLAY</span><Play size={31} /></div>
          <b>{community.name} LIVE</b><small>成员个人 LIVE 与官方 LIVE 会汇总在这里</small>
        </button>
      </section>
      <section className={styles.mediaSection}>
        <div className={styles.mediaSectionTitle}><h3>最新媒体内容</h3><button type="button" onClick={() => showTodo("Community 媒体内容")}><ChevronRight size={20} /></button></div>
        <div className={styles.mediaGrid}>
          <button type="button" onClick={() => showTodo("官方媒体") }><Video size={25} /><span>Official Media</span></button>
          <button type="button" onClick={() => showTodo("成员公开视频") }><Camera size={25} /><span>Artist Media</span></button>
        </div>
      </section>
    </div>
  );

  const renderCommunity = (community: WeverseCommunity) => (
    <div className={styles.scrollArea}>
      {renderCommunityHero(community)}
      <div className={styles.communityNav}>
        {(["home", "feed", "media"] as const).map((item) => <button key={item} type="button" className={communityTab === item ? styles.activeCommunityNav : ""} onClick={() => setCommunityTab(item)}>{item === "home" ? "Home" : item === "feed" ? "Feed" : "LIVE·Media"}</button>)}
      </div>
      {communityTab === "home" ? renderCommunityHome(community) : communityTab === "feed" ? renderCommunityFeed(community) : renderCommunityMedia(community)}
      <button type="button" className={styles.communityFab} aria-label="发布 Fan Post" onClick={() => openComposer("user", community.id)}><Plus size={25} /></button>
      <div className={styles.bottomSpacer} />
    </div>
  );

  const renderArtistPosts = (community: WeverseCommunity, characterId: string) => {
    const posts = state.posts.filter((post) => post.communityId === community.id && post.authorType === "artist" && post.authorId === characterId).sort((a, b) => b.createdAt - a.createdAt);
    return posts.length ? <>{posts.map((post) => renderPost(post))}</> : <div className={styles.emptyMini}>还没有 Artist Post。AI 自动发帖接入后会显示在这里。</div>;
  };

  const renderArtistLive = (memberName: string) => (
    <div className={styles.artistLivePane}>
      <section className={styles.artistLiveCurrent}>
        <div><Radio size={20} /><b>当前 LIVE</b></div>
        <p>{memberName} 现在没有开播。</p>
        <button type="button" onClick={() => showTodo("艺人个人 LIVE")}>LIVE 功能后续接入</button>
      </section>
      <section className={styles.artistReplaySection}>
        <h3>过往直播回放</h3>
        <button type="button" className={styles.artistReplayCard} onClick={() => showTodo("个人直播回放") }><div><Play size={22} /></div><span><b>Replay</b><small>之后会按时间展示这个成员自己的直播回放</small></span></button>
      </section>
    </div>
  );

  const renderArtist = (community: WeverseCommunity, characterId: string) => {
    const member = resolveMember(community, characterId);
    const memberPosts = state.posts.filter((post) => post.communityId === community.id && post.authorType === "artist" && post.authorId === characterId).sort((a, b) => b.createdAt - a.createdAt);
    const mediaPosts = memberPosts.filter((post) => post.imageUrl).slice(0, 5);
    return (
      <div className={styles.scrollArea}>
        <div className={styles.artistHero} style={member.coverUrl ? { backgroundImage: `linear-gradient(180deg,rgba(0,0,0,.04),rgba(0,0,0,.72)),url(${member.coverUrl})` } : undefined}>
          <div className={styles.immersiveControls}><button type="button" onClick={back}><ChevronLeft size={24} /></button><div><button type="button" onClick={() => showTodo("分享成员主页")}><Send size={20} /></button><button type="button" onClick={() => openMemberEditor(community, characterId)}><Pencil size={20} /></button></div></div>
          <div className={styles.artistIdentity}>
            <Avatar text={member.displayName} imageUrl={member.avatarUrl} className={styles.artistProfileAvatar} />
            <h1>{member.displayName} <Verified /></h1>
            <p>{member.bio || `${community.name} · Artist`}</p>
            <button type="button" onClick={() => showTodo("关注状态")}>✓ 关注</button>
          </div>
        </div>
        <div className={styles.artistMediaStrip}>
          {mediaPosts.length ? mediaPosts.map((post) => <button type="button" key={post.id} onClick={() => navigate({ type: "post", postId: post.id })}><ResolvedAssetImage src={post.imageUrl!} alt="" /></button>) : <button type="button" className={styles.mediaEmpty} onClick={() => showTodo("成员媒体历史")}>Media</button>}
        </div>
        <div className={styles.artistTabs}>
          {(["posts", "comments", "live"] as const).map((item) => <button type="button" key={item} className={artistTab === item ? styles.activeArtistTab : ""} onClick={() => setArtistTab(item)}>{item === "posts" ? "帖子" : item === "comments" ? "评论" : "LIVE"}</button>)}
        </div>
        {artistTab === "posts" ? renderArtistPosts(community, characterId) : artistTab === "comments" ? <div className={styles.emptyMini}>这里以后汇总这个成员在 Community 里回复过的粉丝帖子与评论。</div> : renderArtistLive(member.displayName)}
        <div className={styles.bottomSpacer} />
      </div>
    );
  };

  const renderPostDetail = (post: WeversePost) => (
    <div className={styles.scrollArea}>
      {renderPost(post, true)}
      <div className={styles.commentsTitle}>Comments <span>{post.comments.length}</span></div>
      <div className={styles.commentsList}>
        {post.comments.map((comment) => {
          const author = resolveCommentAuthor(comment, post);
          return <div className={styles.commentCard} key={comment.id}><Avatar text={author.name} imageUrl={author.avatarUrl} tone="soft" /><div><b>{author.name} {author.verified ? <Verified /> : null}</b><small>{relativeTime(comment.createdAt)}</small><p>{comment.body}</p></div></div>;
        })}
        {!post.comments.length ? <div className={styles.emptyComment}>还没有评论</div> : null}
      </div>
      <div className={styles.commentComposer}><input id="wvs-comment-input" value={commentDraft} onChange={(e) => setCommentDraft(e.target.value)} placeholder="留下评论…" onKeyDown={(e) => { if (e.key === "Enter") submitComment(post); }} /><button type="button" onClick={() => submitComment(post)}><Send size={17} /></button></div>
      <div className={styles.bottomSpacer} />
    </div>
  );

  const renderContent = () => {
    if (route.type === "community") {
      const community = communityMap.get(route.id);
      return community ? renderCommunity(community) : renderCommunityList();
    }
    if (route.type === "artist") {
      const community = communityMap.get(route.communityId);
      return community ? renderArtist(community, route.characterId) : renderCommunityList();
    }
    if (route.type === "post") {
      const post = postMap.get(route.postId);
      return post ? renderPostDetail(post) : renderFeed();
    }
    return tab === "feed" ? renderFeed() : renderCommunityList();
  };

  return (
    <div className={styles.root}>
      {renderTopbar()}
      <main className={`${styles.main} ${immersiveRoute ? styles.mainImmersive : ""}`}>{renderContent()}</main>

      {route.type === "root" ? (
        <nav className={styles.dock} aria-label="Weverse 导航">
          <button type="button" className={tab === "feed" ? styles.activeDock : ""} onClick={() => goRoot("feed")}><span className={styles.dockGlyph}>W</span><small>Feed</small></button>
          <button type="button" className={tab === "community" ? styles.activeDock : ""} onClick={() => goRoot("community")}><UsersRound size={22} /><small>Community</small></button>
        </nav>
      ) : null}

      {composerOpen ? (
        <div className={styles.sheetMask} onMouseDown={(event) => { if (event.currentTarget === event.target) { setComposerOpen(false); setEditingPostId(null); } }}>
          <section className={styles.sheet}>
            <div className={styles.sheetHandle} />
            <div className={styles.sheetTitle}><h2>{editingPostId ? `编辑${composerAuthorType === "artist" ? " Artist" : composerAuthorType === "official" ? " Official" : ""}贴文` : composerAuthorType === "official" ? "Official Post" : "Fan Post"}</h2><button type="button" className={styles.iconBtn} onClick={() => { setComposerOpen(false); setEditingPostId(null); }}><X size={20} /></button></div>
            <label className={styles.fieldLabel}>发布到</label>
            <div className={styles.lockedCommunity}>{communityMap.get(draftCommunityId)?.name || "Community"}</div>
            <textarea className={styles.textarea} value={draftText} onChange={(event) => setDraftText(event.target.value)} placeholder={composerAuthorType === "official" ? "写一条官方公告或动态…" : "写点什么吧…"} />
            {draftImageUrl ? <div className={styles.composePreview}><ResolvedAssetImage src={draftImageUrl} alt="预览" /><button type="button" onClick={() => setDraftImageUrl("")}><X size={16} /></button></div> : null}
            <div className={styles.mediaTools}><button type="button" onClick={() => fileInputRef.current?.click()}><ImagePlus size={18} /> 本地图片</button><button type="button" onClick={() => showTodo("Photos Resolver") }><Sparkles size={18} /> 照片库</button></div>
            <input ref={fileInputRef} className={styles.hiddenInput} type="file" accept="image/*" onChange={async (event) => { const file = event.target.files?.[0]; if (file) setDraftImageUrl(await fileToDataUrl(file)); event.currentTarget.value = ""; }} />
            <button type="button" className={styles.primaryButton} onClick={publish}><Send size={18} /> {editingPostId ? "保存修改" : "发布"}</button>
          </section>
        </div>
      ) : null}

      {postMenuId ? (() => {
        const post = postMap.get(postMenuId);
        if (!post) return null;
        return <div className={styles.sheetMask} onMouseDown={(event) => { if (event.currentTarget === event.target) setPostMenuId(null); }}><section className={`${styles.sheet} ${styles.actionSheet}`}><div className={styles.sheetHandle} /><button type="button" onClick={() => openPostEditor(post)}><Pencil size={18} /> 编辑贴文</button><button type="button" className={styles.dangerSheetAction} onClick={() => removePost(post)}><Trash2 size={18} /> 删除贴文</button><button type="button" onClick={() => setPostMenuId(null)}>取消</button></section></div>;
      })() : null}

      {communityMenuId ? (() => {
        const community = communityMap.get(communityMenuId);
        if (!community) return null;
        return <div className={styles.sheetMask} onMouseDown={(event) => { if (event.currentTarget === event.target) setCommunityMenuId(null); }}><section className={`${styles.sheet} ${styles.actionSheet}`}><div className={styles.sheetHandle} /><div className={styles.sheetTitle}><h2>{community.name} 管理</h2><button type="button" className={styles.iconBtn} onClick={() => setCommunityMenuId(null)}><X size={19} /></button></div><button type="button" onClick={() => { setCommunityMenuId(null); openCommunityEditor(community); }}><Settings size={18} /> 管理 Community</button><button type="button" onClick={() => { setCommunityMenuId(null); openComposer("official", community.id); }}><Send size={18} /> 用官号发布</button><button type="button" disabled={generatingCommunityId === community.id} onClick={() => generateCommunityRound(community)}><Sparkles size={18} /> {generatingCommunityId === community.id ? "正在生成…" : "生成一轮 AI 社区动态"}</button><button type="button" onClick={() => showTodo("Official Schedule / Calendar") }><CalendarDays size={18} /> 安排行程</button><button type="button" onClick={() => showTodo("Official LIVE") }><Radio size={18} /> 发起官方 LIVE</button><button type="button" onClick={() => setCommunityMenuId(null)}>取消</button></section></div>;
      })() : null}

      {communityEditor ? (
        <div className={styles.fullModal}>
          <div className={styles.modalHeader}><button type="button" className={styles.modalBackBtn} aria-label="返回" onPointerDown={(e) => e.stopPropagation()} onClick={() => { setCommunityEditorError(""); setCommunityEditor(null); }}><ChevronLeft size={22} /></button><b>{communityEditor.id ? "管理 Community" : "新建 Community"}</b><button type="button" className={styles.saveTextBtn} onPointerDown={(e) => e.stopPropagation()} onClick={saveCommunityEditor}>保存</button></div>
          <div className={styles.modalScroll}>
            {communityEditorError ? <div className={styles.editorError}>{communityEditorError}</div> : null}
            <div className={styles.editorSection}><h3>Community</h3><label>名称<input value={communityEditor.name} onChange={(e) => setCommunityEditor({ ...communityEditor, name: e.target.value })} placeholder="例如 NCT WISH" /></label><label>简介<textarea value={communityEditor.description} onChange={(e) => setCommunityEditor({ ...communityEditor, description: e.target.value })} placeholder="这个 Community 的简介" /></label><div className={styles.imageEditRow}><Avatar text={communityEditor.name || "C"} imageUrl={communityEditor.avatarUrl || communityEditor.officialAvatarUrl} tone="soft" className={styles.editorAvatar} /><button type="button" onClick={() => communityAvatarInputRef.current?.click()}><Camera size={16} /> Community 图标</button>{communityEditor.avatarUrl ? <button type="button" onClick={() => setCommunityEditor({ ...communityEditor, avatarUrl: "" })}>清除</button> : null}</div><div className={styles.imageEditRow}><button type="button" onClick={() => coverInputRef.current?.click()}><ImagePlus size={16} /> Community 大背景</button>{communityEditor.coverUrl ? <button type="button" onClick={() => setCommunityEditor({ ...communityEditor, coverUrl: "" })}>清除背景</button> : null}</div><input ref={communityAvatarInputRef} className={styles.hiddenInput} type="file" accept="image/*" onChange={async (e) => { const file = e.target.files?.[0]; if (file) setCommunityEditor({ ...communityEditor, avatarUrl: await fileToDataUrl(file, 500) }); e.currentTarget.value = ""; }} /><input ref={coverInputRef} className={styles.hiddenInput} type="file" accept="image/*" onChange={async (e) => { const file = e.target.files?.[0]; if (file) setCommunityEditor({ ...communityEditor, coverUrl: await fileToDataUrl(file, 1400) }); e.currentTarget.value = ""; }} /></div>
            <div className={styles.editorSection}><h3>Official Account</h3><label>官号昵称<input value={communityEditor.officialName} onChange={(e) => setCommunityEditor({ ...communityEditor, officialName: e.target.value })} placeholder={communityEditor.name ? `${communityEditor.name} Official` : "Official Account"} /></label><label>官号简介<input value={communityEditor.officialBio} onChange={(e) => setCommunityEditor({ ...communityEditor, officialBio: e.target.value })} placeholder="公告 · Schedule · 官方 LIVE" /></label><div className={styles.imageEditRow}><Avatar text={communityEditor.officialName || communityEditor.name || "O"} imageUrl={communityEditor.officialAvatarUrl} tone="teal" className={styles.editorAvatar} /><button type="button" onClick={() => officialAvatarInputRef.current?.click()}><Camera size={16} /> 官号头像</button>{communityEditor.officialAvatarUrl ? <button type="button" onClick={() => setCommunityEditor({ ...communityEditor, officialAvatarUrl: "" })}>清除</button> : null}</div><input ref={officialAvatarInputRef} className={styles.hiddenInput} type="file" accept="image/*" onChange={async (e) => { const file = e.target.files?.[0]; if (file) setCommunityEditor({ ...communityEditor, officialAvatarUrl: await fileToDataUrl(file, 500) }); e.currentTarget.value = ""; }} /></div>
            <div className={styles.editorSection}><h3>绑定成员</h3><p className={styles.editorHint}>只勾选真正属于这个 Community 的角色。Solo 只选 1 人也可以。</p><div className={styles.memberPicker}>{characters.map((char) => { const checked = communityEditor.selectedCharacterIds.includes(char.id); return <button type="button" key={char.id} className={`${styles.memberPickCard} ${checked ? styles.memberPickActive : ""}`} onClick={() => setCommunityEditor({ ...communityEditor, selectedCharacterIds: checked ? communityEditor.selectedCharacterIds.filter((id) => id !== char.id) : [...communityEditor.selectedCharacterIds, char.id] })}><Avatar text={char.name} imageUrl={char.avatar} tone="soft" className={styles.memberPickAvatar} /><span className={styles.memberPickName}>{char.name}</span><i>{checked ? "✓" : "+"}</i></button>; })}</div>{!characters.length ? <div className={styles.emptyMini}>当前还没有角色，请先在「角色」App 建立角色。</div> : null}</div>
            {communityEditor.id ? <div className={styles.editorSection}><h3>危险操作</h3><button type="button" className={styles.dangerButton} onClick={() => { const community = communityMap.get(communityEditor.id!); if (community) removeCommunity(community); }}><Trash2 size={16} /> 删除 Community</button></div> : null}
          </div>
        </div>
      ) : null}

      {memberEditor ? (
        <div className={styles.sheetMask} onMouseDown={(event) => { if (event.currentTarget === event.target) setMemberEditor(null); }}>
          <section className={styles.sheet}>
            <div className={styles.sheetHandle} /><div className={styles.sheetTitle}><h2>成员 WVS 资料</h2><button type="button" className={styles.iconBtn} onClick={() => setMemberEditor(null)}><X size={20} /></button></div>
            <div className={styles.memberEditProfile}><Avatar text={memberEditor.displayName} imageUrl={memberEditor.avatarUrl} className={styles.bigAvatar} /><button type="button" onClick={() => memberAvatarInputRef.current?.click()}><Camera size={16} /> 换头像</button><button type="button" onClick={() => memberCoverInputRef.current?.click()}><ImagePlus size={16} /> 换背景</button></div>
            <input ref={memberAvatarInputRef} className={styles.hiddenInput} type="file" accept="image/*" onChange={async (e) => { const file = e.target.files?.[0]; if (file) setMemberEditor({ ...memberEditor, avatarUrl: await fileToDataUrl(file, 500) }); e.currentTarget.value = ""; }} />
            <input ref={memberCoverInputRef} className={styles.hiddenInput} type="file" accept="image/*" onChange={async (e) => { const file = e.target.files?.[0]; if (file) setMemberEditor({ ...memberEditor, coverUrl: await fileToDataUrl(file, 1400) }); e.currentTarget.value = ""; }} />
            <label className={styles.fieldLabel}>WVS 显示昵称</label><input className={styles.select} value={memberEditor.displayName} onChange={(e) => setMemberEditor({ ...memberEditor, displayName: e.target.value })} />
            <label className={styles.fieldLabel}>简介</label><textarea className={styles.textareaSmall} value={memberEditor.bio} onChange={(e) => setMemberEditor({ ...memberEditor, bio: e.target.value })} placeholder="可选，只影响 WVS 展示" />
            <button type="button" className={styles.primaryButton} onClick={saveMemberEditor}>保存</button>
          </section>
        </div>
      ) : null}

      {userProfileDraft ? (
        <div className={styles.sheetMask} onMouseDown={(event) => { if (event.currentTarget === event.target) setUserProfileDraft(null); }}>
          <section className={styles.sheet}>
            <div className={styles.sheetHandle} />
            <div className={styles.sheetTitle}><h2>编辑 WVS 身份</h2><button type="button" className={styles.iconBtn} onClick={() => setUserProfileDraft(null)}><X size={20} /></button></div>
            <p className={styles.editorHint}>默认继承当前 User Identity；这里修改只影响 Weverse 里的粉丝昵称、头像和简介。</p>
            <div className={styles.memberEditProfile}><Avatar text={userProfileDraft.displayName || userName} imageUrl={userProfileDraft.avatarUrl} className={styles.bigAvatar} /><button type="button" onClick={() => userAvatarInputRef.current?.click()}><Camera size={16} /> 换头像</button>{userProfileDraft.avatarUrl ? <button type="button" onClick={() => setUserProfileDraft({ ...userProfileDraft, avatarUrl: "" })}>清除</button> : null}</div>
            <input ref={userAvatarInputRef} className={styles.hiddenInput} type="file" accept="image/*" onChange={async (e) => { const file = e.target.files?.[0]; if (file) setUserProfileDraft({ ...userProfileDraft, avatarUrl: await fileToDataUrl(file, 500) }); e.currentTarget.value = ""; }} />
            <label className={styles.fieldLabel}>WVS 昵称</label><input className={styles.select} value={userProfileDraft.displayName} onChange={(e) => setUserProfileDraft({ ...userProfileDraft, displayName: e.target.value })} placeholder={userIdentity?.name || "我的昵称"} />
            <label className={styles.fieldLabel}>简介</label><textarea className={styles.textareaSmall} value={userProfileDraft.bio} onChange={(e) => setUserProfileDraft({ ...userProfileDraft, bio: e.target.value })} placeholder="Fan account" />
            <button type="button" className={styles.primaryButton} onClick={saveUserProfile}>保存 WVS 身份</button><button type="button" className={styles.secondaryButton} onClick={() => { const nextState = updateWeverseUserProfile({ displayName: undefined, avatarUrl: undefined, bio: undefined }); setState(nextState); setUserProfileDraft({ displayName: userIdentity?.name || "", avatarUrl: userIdentity?.avatarUrl || "", bio: userIdentity?.bio || "" }); onNotice?.("已恢复继承 User Identity"); }}>恢复继承 User Identity</button>
          </section>
        </div>
      ) : null}

      <div className={`${styles.drawerMask} ${drawerOpen ? styles.show : ""}`} onClick={() => setDrawerOpen(false)} />
      <aside className={`${styles.drawer} ${drawerOpen ? styles.show : ""}`}>
        <button type="button" className={styles.userCardButton} onClick={openUserProfileEditor}><div className={styles.userCard}><Avatar text={userName} imageUrl={userAvatar} tone="soft" className={styles.userAvatar} /><div><h3>{userName}</h3><p>{userBio}</p></div></div><Pencil size={16} /></button>
        <button type="button" className={styles.drawerItem} onClick={openUserProfileEditor}><UserRound size={20} /><span>编辑 WVS 身份</span></button>
        <button type="button" className={styles.drawerItem} onClick={() => showTodo("我的帖子与评论") }><MessageCircle size={20} /><span>我的帖子与评论</span></button>
        <button type="button" className={styles.drawerItem} onClick={() => showTodo("收藏页") }><Bookmark size={20} /><span>收藏</span></button>
        <button type="button" className={styles.drawerItem} onClick={() => showTodo("WVS 设置") }><Settings size={20} /><span>WVS 设置</span></button>
        <button type="button" className={styles.drawerItem} onClick={onClose}><ChevronLeft size={20} /><span>返回桌面</span></button>
      </aside>
    </div>
  );
}
