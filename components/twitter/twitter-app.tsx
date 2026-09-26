"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  ArrowLeft, Bell, Bookmark, Heart, Home, ImagePlus, Mail, MessageCircle,
  MoreHorizontal, Phone, Reply, Repeat2, Search, Send, Sparkles, Trash2, Video, X,
} from "lucide-react";
import { CHARACTERS_UPDATED_EVENT, loadCharacters } from "@/lib/character-storage";
import type { Character } from "@/lib/character-types";
import { resolveUserIdentity } from "@/lib/settings-storage";
import { getChatImageFromIndexedDB, saveChatImageToIndexedDB } from "@/lib/chat-asset-storage";
import { generateTwitterText } from "@/lib/twitter-engine";
import { generateTwitterComments, generateTwitterWorldBatch, type TwitterWorldComment } from "@/lib/twitter-world-engine";
import { TwitterManagement } from "./twitter-management";
import {
  createTwitterId, loadTwitterState, saveTwitterState, TWITTER_UPDATED_EVENT,
  type TwitterEngagement, type TwitterMessage, type TwitterPost, type TwitterProfile, type TwitterState,
} from "@/lib/twitter-storage";
import styles from "./twitter-app.module.css";

type Tab = "home" | "explore" | "notices" | "messages";
type Picker = "post" | "reply" | "dm" | null;
type Props = { onClose: () => void; onNotice?: (text: string) => void };

const timestamp = (value: number) => {
  const delta = Date.now() - value;
  if (delta < 60_000) return "刚刚";
  if (delta < 3600_000) return `${Math.max(1, Math.floor(delta / 60_000))} 分钟`;
  if (delta < 86400_000) return `${Math.floor(delta / 3600_000)} 小时`;
  return new Date(value).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
};
const messageDay = (value: number) => new Date(value).toLocaleDateString("zh-CN", { year: "numeric", month: "numeric", day: "numeric" });
const messageDate = (value: number) => new Date(value).toLocaleString("zh-CN", { month: "numeric", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit" });
const stableFraction = (key: string) => {
  let value = 2166136261;
  for (let i = 0; i < key.length; i++) value = Math.imul(value ^ key.charCodeAt(i), 16777619);
  return (value >>> 0) / 4294967295;
};
const engagementFor = (id: string, followers = 0, initialComments = 0): TwitterEngagement => {
  const reach = Math.max(9, Math.round(Math.sqrt(Math.max(0, followers)) * (4 + stableFraction(`${id}reach`) * 12)));
  return { views: reach, likes: Math.floor(reach * (.03 + stableFraction(`${id}likes`) * .18)), reposts: Math.floor(reach * (.002 + stableFraction(`${id}shares`) * .028)), comments: Math.max(initialComments, Math.floor(reach * (.001 + stableFraction(`${id}comments`) * .026))) };
};
const countLabel = (count: number) => count >= 10000 ? `${(count / 10000).toFixed(1)}万` : count ? String(count) : "";
const accountHandle = (text: string) => text.replace(/^@/, "").replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 28).toLowerCase() || "visitor";

function StoredImage({ imageRef, className = "" }: { imageRef?: string; className?: string }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!imageRef) { setUrl(""); return; }
    if (/^(https?:|data:)/.test(imageRef)) { setUrl(imageRef); return; }
    let live = true;
    getChatImageFromIndexedDB(imageRef).then(value => { if (live) setUrl(value || ""); });
    return () => { live = false; };
  }, [imageRef]);
  return url ? <img className={className} src={url} alt="" /> : null;
}

function Avatar({ image, label, size = "" }: { image?: string; label: string; size?: string }) {
  return <span className={`${styles.avatar} ${size === "large" ? styles.largeAvatar : ""}`}>
    {image ? <StoredImage imageRef={image} /> : <span>{label.slice(0, 1) || "?"}</span>}
  </span>;
}

function DmMessage({ message, reference, speaker, onReply, onJump }: {
  message: TwitterMessage;
  reference?: TwitterMessage;
  speaker: string;
  onReply: () => void;
  onJump: (id: string) => void;
}) {
  const [translationOpen, setTranslationOpen] = useState(false);
  const mine = message.role === "user";
  const canTranslate = !mine && !!message.translated && message.translated !== message.original;
  return <div id={`tw-dm-${message.id}`} className={`${styles.messageRow} ${mine ? styles.myMessageRow : ""}`}>
    <div className={`${styles.message} ${mine ? styles.mine : styles.theirs}`} title={messageDate(message.createdAt)}>
      {reference && <button type="button" className={styles.messageQuote} onClick={() => onJump(reference.id)}>
        <span><Reply size={12} />{reference.role === "user" ? "你" : speaker}</span>
        <span className={styles.quoteText}>{reference.original}</span>
      </button>}
      <span className={styles.messageText}>{message.original}</span>
      {canTranslate && <>
        <button type="button" className={styles.translateToggle} aria-expanded={translationOpen} onClick={() => setTranslationOpen(open => !open)}>{translationOpen ? "收起翻译 ↑" : "查看翻译 ↓"}</button>
        {translationOpen && <span className={styles.messageTranslation}>{message.translated}</span>}
      </>}
    </div>
    <button type="button" className={styles.replyAction} onClick={onReply} aria-label={`回复${mine ? "你的" : speaker + "的"}消息`} title="回复这条消息"><Reply size={16} /></button>
  </div>;
}

export function TwitterApp({ onClose, onNotice }: Props) {
  const [state, setState] = useState<TwitterState>(() => loadTwitterState());
  const stateRef = useRef(state);
  const [characters, setCharacters] = useState<Character[]>(() => loadCharacters());
  const [tab, setTab] = useState<Tab>("home");
  const [feedMode, setFeedMode] = useState<"forYou" | "following">("forYou");
  const [activeAccount, setActiveAccount] = useState("user");
  const [manageOpen, setManageOpen] = useState(false);
  const [communityId, setCommunityId] = useState<string | null>(null);
  const [composeCommunityId, setComposeCommunityId] = useState<string | null>(null);
  const [trendScope, setTrendScope] = useState<"world" | "region">("world");
  const [trendFilter, setTrendFilter] = useState<string | null>(null);
  const [feedHint, setFeedHint] = useState("");
  const [visibleComments, setVisibleComments] = useState(4);
  const [originalShown, setOriginalShown] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState("");
  const [threadId, setThreadId] = useState<string | null>(null);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [compose, setCompose] = useState(false);
  const [draft, setDraft] = useState("");
  const [imageRef, setImageRef] = useState("");
  const [replyDraft, setReplyDraft] = useState("");
  const [commentTargetId, setCommentTargetId] = useState<string | null>(null);
  const [messageDraft, setMessageDraft] = useState("");
  const [replyingToId, setReplyingToId] = useState<string | null>(null);
  const [picker, setPicker] = useState<Picker>(null);
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const userIdentity = resolveUserIdentity(undefined, "twitter");
  const user = { ...state.profile, name: state.profile.name === "我" ? userIdentity?.name || "我" : state.profile.name, avatarUrl: state.profile.avatarUrl || userIdentity?.avatarUrl || "" };
  const currentUserAccount = state.accounts[activeAccount] || user;

  const commit = useCallback((change: (current: TwitterState) => TwitterState) => {
    const next = change(stateRef.current);
    stateRef.current = next;
    setState(next);
    saveTwitterState(next);
  }, []);
  useEffect(() => {
    const onStorage = () => { const next = loadTwitterState(); stateRef.current = next; setState(next); };
    const onCharacters = () => setCharacters(loadCharacters());
    window.addEventListener(TWITTER_UPDATED_EVENT, onStorage);
    window.addEventListener(CHARACTERS_UPDATED_EVENT, onCharacters);
    return () => { window.removeEventListener(TWITTER_UPDATED_EVENT, onStorage); window.removeEventListener(CHARACTERS_UPDATED_EVENT, onCharacters); };
  }, []);

  const display = useCallback((id: string): TwitterProfile => {
    if (id === "user") return user;
    if (state.accounts[id]) return state.accounts[id];
    const char = characters.find(c => c.id === id);
    const own = state.characterProfiles[id];
    return { name: own?.name || char?.name || "已移除角色", handle: own?.handle || (char?.name || "character").replace(/\s+/g, "_").toLowerCase(), avatarUrl: own?.avatarUrl || char?.avatar || "", bannerUrl: own?.bannerUrl || "", bio: own?.bio || "" };
  }, [characters, state.characterProfiles, state.accounts, user]);

  const posts = useMemo(() => state.posts.filter(p => !p.replyToId).sort((a, b) => b.createdAt - a.createdAt), [state.posts]);
  const currentThread = state.posts.find(p => p.id === threadId);
  const currentConversation = state.conversations.find(c => c.id === conversationId);
  const threadReplies = useMemo(() => {
    if (!threadId) return [];
    const visible = new Set<string>();
    const walk = (parentId: string, depth: number): Array<{ post: TwitterPost; depth: number }> => state.posts.filter(p => p.replyToId === parentId && !visible.has(p.id)).sort((a, b) => a.createdAt - b.createdAt).flatMap(post => {
      visible.add(post.id);
      return [{ post, depth }, ...(depth < 5 ? walk(post.id, depth + 1) : [])];
    });
    return walk(threadId, 0);
  }, [state.posts, threadId]);

  const alert = (message: string) => { onNotice?.(message); };
  const addComments = (current: TwitterState, parentId: string, entries: TwitterWorldComment[], createdAt: number): TwitterState => {
    const accounts = { ...current.accounts };
    const newPosts: TwitterPost[] = entries.map((entry, index) => {
      const commenterId = `npc:${createTwitterId()}`;
      accounts[commenterId] = { name: entry.name || "路人", handle: accountHandle(entry.handle || entry.name), bio: "", visibility: "public" };
      return { id: createTwitterId(), authorId: commenterId, original: entry.original, translated: entry.translated, replyToId: parentId, createdAt: createdAt + index };
    });
    const ownPost = current.posts.find(p => p.id === parentId)?.authorId.startsWith("user");
    const notices = ownPost ? [...newPosts.map(p => ({ id: createTwitterId(), kind: "reply" as const, actorId: p.authorId, postId: parentId, text: p.original, createdAt: p.createdAt })), ...current.notices] : current.notices;
    return { ...current, accounts, notices, posts: [...current.posts.map(p => p.id === parentId ? { ...p, commentsGenerated: true, engagement: { ...(p.engagement || engagementFor(p.id)), comments: Math.max(p.engagement?.comments || 0, current.posts.filter(c => c.replyToId === parentId).length + newPosts.length) } } : p), ...newPosts] };
  };
  const refreshComments = async (post: TwitterPost) => {
    if (busy) return;
    if ((stateRef.current.accounts[post.authorId] || stateRef.current.characterProfiles[post.authorId] || (post.authorId === "user" ? stateRef.current.profile : undefined))?.visibility === "protected") { alert("私密账号暂不生成路人评论，避免出现未授权的围观者。"); return; }
    setBusy(true);
    try {
      const snapshot = stateRef.current;
      const previous = snapshot.posts.filter(p => p.replyToId === post.id).map(p => p.original);
      const comments = await generateTwitterComments(snapshot, post, display(post.authorId).name, previous);
      commit(current => addComments(current, post.id, comments, Date.now()));
      setVisibleComments(count => Math.max(count, previous.length + comments.length));
    } catch (error) { alert(error instanceof Error ? error.message : "评论刷新失败。"); }
    finally { setBusy(false); }
  };
  const refreshWorld = async (targetCommunityId?: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const targetCommunity = stateRef.current.communities.find(c => c.id === targetCommunityId);
      const communityHint = targetCommunity ? `围绕“${targetCommunity.name}”社区写日常讨论，关联角色：${targetCommunity.characterIds.map(id => display(id).name).join("、") || "无"}。${targetCommunity.includeUserPersona ? `社区也公开关联用户人设“${stateRef.current.profile.name}”。` : "不要把用户描写成主持人或公开关联人物。"}只使用公开信息，不揭露角色小号身份。` : "";
      const batch = await generateTwitterWorldBatch(stateRef.current, [feedHint, communityHint].filter(Boolean).join("。"));
      commit(current => {
        const now = Date.now();
        const trends = targetCommunity ? [] : batch.trends.map(t => ({ id: createTwitterId(), label: t.label, scope: t.scope, volume: Math.round(90 + stableFraction(t.label) * 9500), createdAt: now }));
        let next: TwitterState = { ...current, trends: [...current.trends, ...trends].slice(-40) };
        batch.posts.forEach((entry, index) => {
          const id = createTwitterId();
          const authorId = `npc:${createTwitterId()}`;
          next = { ...next, accounts: { ...next.accounts, [authorId]: { name: entry.name, handle: accountHandle(entry.handle || entry.name), bio: "", followers: Math.floor(stableFraction(id) * 600), visibility: "public" } } };
          const trend = trends.find(t => t.label === entry.trend) || current.trends.find(t => t.label === entry.trend);
          const post: TwitterPost = { id, authorId, original: entry.original, translated: entry.translated, trendId: targetCommunity ? undefined : trend?.id, communityId: targetCommunity?.id, createdAt: now + index, engagement: engagementFor(id, next.accounts[authorId].followers, entry.comments.length), commentsGenerated: true };
          next = { ...next, posts: [...next.posts, post] };
          next = addComments(next, id, entry.comments, now + index + 1);
        });
        return next;
      });
      setFeedHint("");
    } catch (error) { alert(error instanceof Error ? error.message : "动态刷新失败。"); }
    finally { setBusy(false); }
  };
  const uploadImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) { alert("请选择图片文件。"); return; }
    try {
      const ref = await saveChatImageToIndexedDB(file);
      setImageRef(ref);
    } catch { alert("图片保存失败，请重试。"); }
  };
  const publish = () => {
    const text = draft.trim();
    if (!text && !imageRef) return;
    const id = createTwitterId();
    const authorId = activeAccount === "user" || stateRef.current.accounts[activeAccount] ? activeAccount : "user";
    commit(current => ({ ...current, posts: [...current.posts, { id, authorId, original: text, imageRef: imageRef || undefined, communityId: composeCommunityId || undefined, createdAt: Date.now(), engagement: engagementFor(id, (authorId === "user" ? current.profile : current.accounts[authorId])?.followers), commentsGenerated: false }] }));
    setDraft(""); setImageRef(""); setCompose(false); setComposeCommunityId(null); setTab("home"); setFeedMode("forYou");
  };
  const reply = () => {
    const text = replyDraft.trim();
    if (!text || !threadId) return;
    const targetId = commentTargetId && stateRef.current.posts.some(p => p.id === commentTargetId) ? commentTargetId : threadId;
    commit(current => ({ ...current, posts: [...current.posts, { id: createTwitterId(), authorId: activeAccount, original: text, replyToId: targetId, createdAt: Date.now() }] }));
    setReplyDraft(""); setCommentTargetId(null);
  };
  const changePost = (id: string, field: "liked" | "bookmarked" | "reposted") => {
    commit(current => ({ ...current, posts: current.posts.map(p => p.id === id ? { ...p, [field]: !p[field] } : p) }));
  };
  const deletePost = (id: string) => {
    commit(current => ({ ...current, posts: current.posts.filter(p => p.id !== id && p.replyToId !== id), notices: current.notices.filter(n => n.postId !== id) }));
    if (threadId === id) setThreadId(null);
  };
  const openConversation = (characterId: string, mode: "real" | "anonymous", recipientAccountId = characterId) => {
    const userAccountId = activeAccount;
    const actualMode = userAccountId === "user:alt" || (userAccountId.startsWith("group:") && !stateRef.current.accounts[userAccountId]?.includeUserPersona) ? "anonymous" : mode;
    let convo = stateRef.current.conversations.find(c => c.characterId === characterId && c.mode === actualMode && (c.userAccountId || "user") === userAccountId && (c.recipientAccountId || c.characterId) === recipientAccountId);
    if (!convo) {
      convo = { id: createTwitterId(), characterId, userAccountId, recipientAccountId, mode: actualMode, messages: [], createdAt: Date.now() };
      const created = convo;
      commit(current => ({ ...current, conversations: [created, ...current.conversations] }));
    }
    setConversationId(convo.id); setReplyingToId(null); setPicker(null); setProfileId(null); setTab("messages");
  };
  const sendMessage = () => {
    const text = messageDraft.trim();
    if (!text || !conversationId) return;
    commit(current => ({ ...current, conversations: current.conversations.map(c => c.id === conversationId ? { ...c, messages: [...c.messages, { id: createTwitterId(), role: "user", original: text, replyToId: replyingToId && c.messages.some(m => m.id === replyingToId) ? replyingToId : undefined, createdAt: Date.now() }] } : c) }));
    setMessageDraft(""); setReplyingToId(null);
  };
  const aiGenerate = async (characterId: string, kind: "post" | "reply" | "dm", postAccountId = characterId) => {
    if (busy) return;
    setPicker(null); setBusy(true);
    try {
      const snapshot = stateRef.current;
      const thread = snapshot.posts.find(p => p.id === (commentTargetId || threadId));
      const convo = snapshot.conversations.find(c => c.id === conversationId);
      const requestedReplyId = replyingToId;
      if (kind === "reply" && !thread) throw new Error("先选择一条帖子。");
      if (kind === "dm" && !convo) throw new Error("先进入一段私信。");
      const speakingAccountId = kind === "dm" ? convo?.recipientAccountId || characterId : postAccountId;
      const lines = await generateTwitterText({ characterId, state: snapshot, kind, targetPost: thread, conversation: convo?.messages, replyToMessage: convo?.messages.find(msg => msg.id === requestedReplyId), anonymous: convo?.mode === "anonymous", senderName: snapshot.accounts[convo?.userAccountId || ""]?.name, accountProfile: snapshot.accounts[speakingAccountId], accountKind: speakingAccountId.endsWith(":alt") ? "alternate" : speakingAccountId.startsWith("group:") ? "group" : undefined, communityName: snapshot.communities.find(c => c.id === communityId)?.name, withComments: kind === "post" && snapshot.accounts[postAccountId]?.visibility !== "protected" && snapshot.characterProfiles[postAccountId]?.visibility !== "protected" });
      if (kind === "post" && postAccountId.endsWith(":alt")) {
        const main = snapshot.characterProfiles[characterId] || characters.find(c => c.id === characterId);
        const publicName = main?.name?.trim() || "";
        const mainHandle = snapshot.characterProfiles[characterId]?.handle || "";
        const text = [lines[0]?.original, ...(lines.comments || []).map(c => c.original)].join(" ");
        if ((publicName.length >= 2 && text.includes(publicName)) || (mainHandle.length >= 3 && text.includes(`@${mainHandle}`))) throw new Error("这条小号内容可能暴露大号身份，已取消发布。可以重试。");
      }
      const now = Date.now();
      if (kind === "dm") {
        const targetId = convo!.id;
        commit(current => ({ ...current, conversations: current.conversations.map(c => c.id === targetId ? { ...c, messages: [...c.messages, ...lines.map((line, index) => ({ id: createTwitterId(), role: "character" as const, ...line, replyToId: index === 0 && requestedReplyId && c.messages.some(m => m.id === requestedReplyId) ? requestedReplyId : undefined, createdAt: now + index }))] } : c) }));
        setReplyingToId(current => current === requestedReplyId ? null : current);
      } else {
        const id = createTwitterId();
        const actorId = kind === "post" ? postAccountId : characterId;
        const created: TwitterPost = { id, authorId: actorId, original: lines[0].original, translated: lines[0].translated, communityId: kind === "post" ? communityId || undefined : undefined, replyToId: kind === "reply" ? commentTargetId || threadId || undefined : undefined, createdAt: now, engagement: kind === "post" ? engagementFor(id, (snapshot.accounts[actorId] || snapshot.characterProfiles[actorId])?.followers, lines.comments?.length || 0) : undefined, commentsGenerated: kind === "post" };
        const protectedPost = snapshot.accounts[actorId]?.visibility === "protected" || snapshot.characterProfiles[actorId]?.visibility === "protected";
        let initialComments = lines.comments || [];
        if (kind === "post" && !protectedPost && !initialComments.length) {
          try { initialComments = await generateTwitterComments(snapshot, created, display(actorId).name, []); }
          catch { alert("帖子已生成，评论暂时失败；可以进入帖子后刷新评论。"); }
        }
        commit(current => {
          let next = { ...current, posts: [...current.posts, created], notices: kind === "reply" && thread?.authorId.startsWith("user") ? [{ id: createTwitterId(), kind: "reply" as const, actorId: characterId, postId: thread.id, text: created.original, createdAt: now }, ...current.notices] : current.notices };
          if (kind === "post" && !protectedPost && initialComments.length) next = addComments(next, id, initialComments, now + 1);
          return next;
        });
        if (kind === "reply") setCommentTargetId(null);
      }
    } catch (error) { alert(error instanceof Error ? error.message : "生成失败，请重试。"); }
    finally { setBusy(false); }
  };

  const renderPost = (post: TwitterPost, compact = false) => {
    const author = display(post.authorId);
    const replies = Math.max(state.posts.filter(row => row.replyToId === post.id).length, post.engagement?.comments || 0);
    const translated = !!post.translated && post.translated !== post.original;
    const showOriginal = !!originalShown[post.id];
    return <article className={`${styles.post} ${post.replyToId ? styles.commentPost : ""}`} key={post.id}>
      <button className={styles.avatarButton} onClick={() => { setProfileId(post.authorId); setThreadId(null); }}><Avatar image={author.avatarUrl} label={author.name} /></button>
      <div className={styles.postBody}>
        <div className={styles.postHeader}><button onClick={() => { setProfileId(post.authorId); setThreadId(null); }}><b>{author.name}</b> <span>@{author.handle} · {timestamp(post.createdAt)}</span></button>{(post.authorId === "user" || post.authorId === "user:alt" || post.authorId.startsWith("group:")) && <button aria-label="删除帖子" onClick={() => deletePost(post.id)}><Trash2 size={16} /></button>}</div>
        {translated && <button className={styles.postTranslationToggle} onClick={() => setOriginalShown(current => ({ ...current, [post.id]: !current[post.id] }))}>已翻译 · {showOriginal ? "显示译文" : "显示原文"}</button>}
        <button className={styles.postText} onClick={() => { if (!compact) { setThreadId(post.replyToId || post.id); setCommentTargetId(null); setVisibleComments(4); } }}>{translated && !showOriginal ? post.translated : post.original}</button>
        {post.imageRef && <div className={styles.postImage}><StoredImage imageRef={post.imageRef} /></div>}
        <div className={styles.actions}>
          <button title="回复" onClick={() => { if (compact && post.replyToId) setCommentTargetId(post.id); else { setThreadId(post.replyToId || post.id); setCommentTargetId(null); setVisibleComments(4); } }}><MessageCircle size={17} />{countLabel(replies)}</button>
          <button title="转推" className={post.reposted ? styles.engaged : ""} onClick={() => changePost(post.id, "reposted")}><Repeat2 size={18} />{countLabel((post.engagement?.reposts || 0) + Number(!!post.reposted))}</button>
          <button title="喜欢" className={post.liked ? styles.liked : ""} onClick={() => changePost(post.id, "liked")}><Heart size={17} fill={post.liked ? "currentColor" : "none"} />{countLabel((post.engagement?.likes || 0) + Number(!!post.liked))}</button>
          <button title="收藏" className={post.bookmarked ? styles.engaged : ""} onClick={() => changePost(post.id, "bookmarked")}><Bookmark size={17} fill={post.bookmarked ? "currentColor" : "none"} /></button>
          <button title="复制帖子" onClick={() => { void navigator.clipboard?.writeText(post.original); }}>复制</button>
        </div>
      </div>
    </article>;
  };

  const profile = profileId ? display(profileId) : null;
  const filtered = posts.filter(post => (feedMode !== "following" || post.authorId.startsWith("user") || state.importedCharacterIds.some(id => post.authorId === id || post.authorId === `${id}:alt`)) && !post.communityId && (!search.trim() || `${post.original} ${display(post.authorId).name}`.toLowerCase().includes(search.toLowerCase())));
  const selectedCommunity = state.communities.find(c => c.id === communityId);
  const pickerCharacters = characters.filter(char => state.importedCharacterIds.includes(char.id) && (picker !== "post" || !selectedCommunity || selectedCommunity.characterIds.includes(char.id) || !!state.accounts[selectedCommunity.groupAccountId || ""]?.characterIds?.includes(char.id)));

  return <div className={styles.app}>
    <header className={styles.header}>
      <button className={styles.headerAvatar} onClick={() => setManageOpen(true)} aria-label="账号与社区设置"><Avatar image={currentUserAccount.avatarUrl} label={currentUserAccount.name} /></button>
      <strong>{tab === "home" ? "推特" : tab === "explore" ? "探索" : tab === "notices" ? "通知" : "私信"}</strong>
      <button className={styles.close} onClick={onClose} aria-label="返回桌面"><X size={20} /></button>
    </header>

    <main className={styles.main}>
      {tab === "home" && <><div className={styles.feedTabs}><button className={feedMode === "forYou" ? styles.selected : ""} onClick={() => setFeedMode("forYou")}>为你推荐</button><button className={feedMode === "following" ? styles.selected : ""} onClick={() => setFeedMode("following")}>已引入角色</button></div>
        <div className={styles.feedTools}><span>{currentUserAccount.name} · @{currentUserAccount.handle}</span><button onClick={() => setManageOpen(true)}>账号 / 社区</button></div>
        <div className={styles.feedGeneration}><input value={feedHint} onChange={e => setFeedHint(e.target.value)} placeholder="这次想看什么？留空随机混合" /><button onClick={() => { void refreshWorld(); }} disabled={busy}><Sparkles size={16} />{busy ? "生成中" : "刷新动态"}</button></div>
        <div className={styles.feedTools}><button onClick={() => setPicker("post")} disabled={busy}>让角色发帖＋评论</button><button onClick={() => setManageOpen(true)}>引入已有角色</button></div>
        {filtered.length ? filtered.map(post => renderPost(post)) : <div className={styles.empty}><b>这里还没有帖子</b><p>写下第一条动态，或让一个角色先发帖。</p></div>}
      </>}
      {tab === "explore" && <><div className={styles.searchBox}><Search size={19} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索帖子、角色或话题" /></div>
        <div className={styles.feedTabs}><button className={trendScope === "world" ? styles.selected : ""} onClick={() => setTrendScope("world")}>世界趋势</button><button className={trendScope === "region" ? styles.selected : ""} onClick={() => setTrendScope("region")}>{state.regionName || "地区"}趋势</button></div>
        <div className={styles.feedTools}><span>虚构世界正在讨论</span><button onClick={() => { void refreshWorld(); }} disabled={busy}>刷新趋势</button></div>
        {state.trends.filter(t => t.scope === trendScope).length ? [...state.trends].filter(t => t.scope === trendScope).reverse().map(trend => <button className={styles.trend} key={trend.id} onClick={() => { setTrendFilter(trend.id); setSearch(""); }}><span>{trend.scope === "region" ? state.regionName || "地区" : "世界"} · 趋势</span><b>{trend.label}</b><small>{countLabel(trend.volume)} 次讨论</small></button>) : <div className={styles.empty}>点“刷新趋势”生成这套世界观里的话题。</div>}
        {(search.trim() || trendFilter) && <><h3 className={styles.heading}>{trendFilter ? <button onClick={() => setTrendFilter(null)}>← 返回趋势</button> : "搜索结果"}</h3>{posts.filter(post => !post.communityId && (trendFilter ? post.trendId === trendFilter : `${post.original} ${display(post.authorId).name}`.toLowerCase().includes(search.toLowerCase()))).map(post => renderPost(post))}</>}
      </>}
      {tab === "notices" && <><div className={styles.feedTools}><span>与你有关的互动</span>{state.notices.some(n => !n.read) && <button onClick={() => commit(current => ({ ...current, notices: current.notices.map(n => ({ ...n, read: true })) }))}>全部已读</button>}</div>
        {state.notices.length ? state.notices.map(notice => <button className={styles.notice} key={notice.id} onClick={() => { if (notice.postId) setThreadId(notice.postId); commit(current => ({ ...current, notices: current.notices.map(n => n.id === notice.id ? { ...n, read: true } : n) })); }}><Avatar label={display(notice.actorId).name} image={display(notice.actorId).avatarUrl} /><span><b>{display(notice.actorId).name}</b> {notice.kind === "reply" ? "回复了你的帖子" : notice.kind === "dm" ? "发来私信" : notice.kind === "follow" ? "关注了你" : "喜欢了你的帖子"}<small>{notice.text}</small></span>{!notice.read && <i className={styles.dot} />}</button>) : <div className={styles.empty}><b>还没有通知</b><p>角色回复你的帖子后，通知会显示在这里。</p></div>}
      </>}
      {tab === "messages" && <><div className={styles.feedTools}><span>私信</span><button onClick={() => setPicker("dm")}>新私信</button></div>
        {state.conversations.length ? [...state.conversations].sort((a, b) => (b.messages.at(-1)?.createdAt || b.createdAt) - (a.messages.at(-1)?.createdAt || a.createdAt)).map(convo => <div className={styles.conversationRow} key={convo.id}><button onClick={() => { setActiveAccount(convo.userAccountId || "user"); setConversationId(convo.id); }}><Avatar image={display(convo.recipientAccountId || convo.characterId).avatarUrl} label={display(convo.recipientAccountId || convo.characterId).name} /><span><b>{display(convo.recipientAccountId || convo.characterId).name} {convo.mode === "anonymous" && <em>匿名</em>}</b><small>{display(convo.userAccountId || "user").name} · {convo.messages.at(-1)?.original || "开始对话"}</small></span></button><button className={styles.rowDelete} onClick={() => commit(current => ({ ...current, conversations: current.conversations.filter(c => c.id !== convo.id) }))} title="删除对话"><Trash2 size={16} /></button></div>) : <div className={styles.empty}><b>还没有私信</b><p>选择角色，开始实名或匿名对话。</p></div>}
      </>}
    </main>

    {tab === "home" && <button className={styles.fab} onClick={() => { setComposeCommunityId(null); setCompose(true); }} aria-label="发帖">＋</button>}
    <nav className={styles.nav}>
      {([["home", Home, "主页"], ["explore", Search, "探索"], ["notices", Bell, "通知"], ["messages", Mail, "私信"]] as const).map(([key, Icon, label]) => <button key={key} className={tab === key ? styles.navActive : ""} onClick={() => { setTab(key); setThreadId(null); setProfileId(null); setConversationId(null); }} aria-label={label}><Icon size={23} fill={tab === key && key !== "explore" ? "currentColor" : "none"} />{key === "notices" && state.notices.some(n => !n.read) && <span className={styles.navDot} />}</button>)}
    </nav>

    {threadId && <div className={`${styles.page} ${styles.topPage}`}><div className={styles.pageHeader}><button onClick={() => setThreadId(null)} aria-label="返回"><ArrowLeft size={21} /></button><b>帖子</b></div><div className={styles.pageScroll}>{currentThread && renderPost(currentThread, true)}{currentThread && <div className={styles.postMeta}>{new Date(currentThread.createdAt).toLocaleString("zh-CN")} · {countLabel(currentThread.engagement?.views || 0)} 次查看</div>}<h3 className={styles.heading}>评论</h3>{threadReplies.slice(0, visibleComments).map(({ post, depth }) => <div key={post.id} className={depth ? styles.nestedComment : ""}>{renderPost(post, true)}</div>)}{threadReplies.length > visibleComments && <button className={styles.aiReply} onClick={() => setVisibleComments(count => count + 8)}>查看更多评论</button>}<button className={styles.aiReply} onClick={() => { if (currentThread) void refreshComments(currentThread); }} disabled={busy}><Sparkles size={16} />{busy ? "刷新中" : "刷新新评论"}</button></div><form className={styles.bottomComposer} onSubmit={event => { event.preventDefault(); reply(); }}>{commentTargetId && <button type="button" className={styles.replyingTo} onClick={() => setCommentTargetId(null)}>回复 @{display(state.posts.find(p => p.id === commentTargetId)?.authorId || "user").handle} ×</button>}<input value={replyDraft} onChange={event => setReplyDraft(event.target.value)} placeholder="发布回复" /><button disabled={!replyDraft.trim()} aria-label="发送回复"><Send size={19} /></button></form></div>}

    {profileId && profile && <div className={`${styles.page} ${styles.topPage}`}><div className={styles.pageHeader}><button onClick={() => setProfileId(null)} aria-label="返回"><ArrowLeft size={21} /></button><b>个人主页</b></div><div className={styles.pageScroll}><div className={styles.banner}>{profile.bannerUrl && <StoredImage imageRef={profile.bannerUrl} />}</div><div className={styles.profileIntro}><Avatar label={profile.name} image={profile.avatarUrl} size="large" />{(profileId === "user" || profileId === "user:alt" || profileId.startsWith("group:")) && <button onClick={() => setManageOpen(true)}>编辑资料</button>}</div><h2>{profile.name}</h2><div className={styles.handle}>@{profile.handle}{profile.visibility === "protected" ? " · 私密" : ""}</div><p>{profile.bio}</p><div className={styles.profileCounts}><b>{(profile.followingCount || 0).toLocaleString()}</b> 正在关注 <b>{(profile.followers || 0).toLocaleString()}</b> 关注者</div>{(characters.some(c => c.id === profileId) || (profileId.endsWith(":alt") && characters.some(c => `${c.id}:alt` === profileId))) && <button className={styles.rulesButton} onClick={() => openConversation(profileId!.replace(/:alt$/, ""), "real", profileId!)}><Mail size={16} />私信</button>}<h3 className={styles.heading}>帖子</h3>{posts.filter(p => p.authorId === profileId).map(p => renderPost(p))}</div></div>}

    {conversationId && currentConversation && <div className={`${styles.page} ${styles.topPage}`}><div className={styles.pageHeader}><button onClick={() => { setConversationId(null); setReplyingToId(null); }} aria-label="返回"><ArrowLeft size={21} /></button><Avatar label={display(currentConversation.recipientAccountId || currentConversation.characterId).name} image={display(currentConversation.recipientAccountId || currentConversation.characterId).avatarUrl} /><b>{display(currentConversation.recipientAccountId || currentConversation.characterId).name}{currentConversation.mode === "anonymous" && <span className={styles.anon}> · 匿名</span>}</b><span className={styles.dmHeaderDecoration} aria-label="通话功能暂未接入"><Phone size={21} /><Video size={23} /></span><button onClick={() => commit(current => ({ ...current, conversations: current.conversations.map(c => c.id === conversationId ? { ...c, blocked: !c.blocked } : c) }))} title="切换屏蔽状态"><MoreHorizontal size={21} /></button></div><div className={styles.messages}>
      {currentConversation.messages.map((msg, index) => <div key={msg.id} className={styles.messageGroup}>
        {(index === 0 || messageDay(msg.createdAt) !== messageDay(currentConversation.messages[index - 1].createdAt) || msg.createdAt - currentConversation.messages[index - 1].createdAt > 20 * 60_000) && <div className={styles.messageDate}>{messageDate(msg.createdAt)}</div>}
        <DmMessage message={msg} reference={currentConversation.messages.find(row => row.id === msg.replyToId)} speaker={display(currentConversation.recipientAccountId || currentConversation.characterId).name} onReply={() => setReplyingToId(msg.id)} onJump={id => document.getElementById(`tw-dm-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" })} />
      </div>)}
      {busy && <div className={styles.typing}>正在输入…</div>}
    </div>{replyingToId && currentConversation.messages.some(msg => msg.id === replyingToId) && <div className={styles.dmReplyPreview}><span>回复 {currentConversation.messages.find(msg => msg.id === replyingToId)?.role === "user" ? "你" : display(currentConversation.recipientAccountId || currentConversation.characterId).name}<small>{currentConversation.messages.find(msg => msg.id === replyingToId)?.original}</small></span><button type="button" onClick={() => setReplyingToId(null)} aria-label="取消回复"><X size={18} /></button></div>}<div className={styles.dmBottom}><button onClick={() => aiGenerate(currentConversation.characterId, "dm")} disabled={busy || currentConversation.blocked} aria-label="召唤回复" title="召唤回复"><Sparkles size={19} /></button><form onSubmit={event => { event.preventDefault(); sendMessage(); }}><input value={messageDraft} onChange={event => setMessageDraft(event.target.value)} placeholder={currentConversation.blocked ? "已屏蔽此会话" : "发送私信"} disabled={currentConversation.blocked} /><button disabled={!messageDraft.trim() || currentConversation.blocked} aria-label="发送私信"><Send size={19} /></button></form></div></div>}

    {communityId && state.communities.some(c => c.id === communityId) && <div className={styles.page}><div className={styles.pageHeader}><button onClick={() => setCommunityId(null)} aria-label="返回"><ArrowLeft size={21} /></button><b>社区</b><button onClick={() => setManageOpen(true)}>设置</button></div><div className={styles.pageScroll}>{state.communities.filter(c => c.id === communityId).map(c => <div key={c.id}><div className={styles.banner}>{c.bannerUrl && <StoredImage imageRef={c.bannerUrl} />}</div><div className={styles.communityInfo}><Avatar image={c.avatarUrl} label={c.name} size="large" /><h2>{c.name}</h2><span>{c.fans.toLocaleString()} 位粉丝 · {c.characterIds.length} 位关联角色</span><p>{c.characterIds.map(id => display(id).name).join("、")}{c.groupAccountId ? ` · ${display(c.groupAccountId).name}` : ""}</p></div></div>)}<div className={styles.feedTools}><button onClick={() => { setComposeCommunityId(communityId); setCompose(true); }}>在社区发帖</button><button onClick={() => setPicker("post")} disabled={busy}>生成角色帖子＋评论</button><button onClick={() => { void refreshWorld(communityId || undefined); }} disabled={busy}>刷新社区</button></div>{posts.filter(p => p.communityId === communityId).map(p => renderPost(p))}</div></div>}

    {compose && <div className={`${styles.page} ${styles.composePage}`}><div className={styles.pageHeader}><button onClick={() => { setCompose(false); setComposeCommunityId(null); }} aria-label="取消"><X size={22} /></button><b>{composeCommunityId ? "社区发帖" : "发帖"} · {currentUserAccount.name}</b><button className={styles.publish} onClick={publish} disabled={!draft.trim() && !imageRef}>发布</button></div><div className={styles.composeBody}><Avatar image={currentUserAccount.avatarUrl} label={currentUserAccount.name} /><textarea autoFocus value={draft} onChange={event => setDraft(event.target.value)} placeholder="有什么新鲜事？" maxLength={1200} /></div>{imageRef && <div className={styles.imagePreview}><StoredImage imageRef={imageRef} /><button onClick={() => setImageRef("")} aria-label="移除图片"><X size={17} /></button></div>}<div className={styles.composeTools}><button onClick={() => fileInputRef.current?.click()}><ImagePlus size={21} />添加照片</button><input ref={fileInputRef} type="file" accept="image/*" hidden onChange={event => { void uploadImage(event); }} /></div></div>}

    {picker && <div className={styles.overlay} onClick={() => setPicker(null)}><div className={styles.sheet} onClick={event => event.stopPropagation()}>
      <div className={styles.sheetHeader}><b>{picker === "post" ? "选择角色账号发帖" : picker === "reply" ? "选一个角色回复" : "开始私信"}</b><button onClick={() => setPicker(null)} aria-label="关闭"><X size={20} /></button></div>
      <div className={styles.sheetList}>{pickerCharacters.length ? pickerCharacters.map(char => <div className={styles.pickRow} key={char.id}>
        <Avatar label={display(char.id).name} image={display(char.id).avatarUrl} /><b>{display(char.id).name}</b>
        {picker === "dm" ? <><button onClick={() => openConversation(char.id, "real")}>大号</button>{state.accounts[`${char.id}:alt`] && <button onClick={() => openConversation(char.id, "real", `${char.id}:alt`)}>小号</button>}</> : picker === "post" ? <>
          <button onClick={() => { void aiGenerate(char.id, "post", char.id); }} disabled={busy}>大号</button>
          {!selectedCommunity && state.accounts[`${char.id}:alt`] && <button onClick={() => { void aiGenerate(char.id, "post", `${char.id}:alt`); }} disabled={busy}>小号</button>}
          {selectedCommunity?.groupAccountId && state.accounts[selectedCommunity.groupAccountId]?.characterIds?.includes(char.id) && <button onClick={() => { void aiGenerate(char.id, "post", selectedCommunity.groupAccountId!); }} disabled={busy}>团体号</button>}
        </> : <button onClick={() => { void aiGenerate(char.id, "reply"); }} disabled={busy}>选择</button>}
      </div>) : <p>先在“账号 / 社区”里引入角色；社区帖子需要先关联该角色。</p>}</div>
    </div></div>}

    {manageOpen && <TwitterManagement state={state} characters={characters} onChange={commit} onClose={() => setManageOpen(false)} onNotice={alert} onUserAccount={id => { setActiveAccount(id); setManageOpen(false); setProfileId(null); }} onCommunity={id => { setThreadId(null); setProfileId(null); setConversationId(null); setCommunityId(id); setManageOpen(false); }} />}
  </div>;
}
