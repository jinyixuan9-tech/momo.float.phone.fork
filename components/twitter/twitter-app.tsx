"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  ArrowLeft, Bell, Bookmark, Heart, Home, ImagePlus, MessageCircle,
  MoreHorizontal, Plus, RefreshCw, Reply, Repeat2, Search, Send, Settings2, Sparkles, Trash2, UserRoundPlus, X,
} from "lucide-react";
import { CHARACTERS_UPDATED_EVENT, loadCharacters } from "@/lib/character-storage";
import type { Character } from "@/lib/character-types";
import { resolveUserIdentity } from "@/lib/settings-storage";
import { getChatImageFromIndexedDB, saveChatImageToIndexedDB } from "@/lib/chat-asset-storage";
import { generateTwitterText, type TwitterGeneratedLine, type TwitterCommentDraft } from "@/lib/twitter-engine";
import { generateTwitterComments, generateTwitterStrangerDms, generateTwitterStrangerReply, generateTwitterTrends, generateTwitterWorldBatch, translateTwitterLegacy, type TwitterWorldComment } from "@/lib/twitter-world-engine";
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
const sourceLanguage = (original: string) => {
  const body = original.replace(/#[\p{L}\p{N}_]+/gu, "");
  return /[가-힣ㄱ-ㅎㅏ-ㅣ]/.test(body) ? "韩语" : /[ぁ-ゟ゠-ヿ]/.test(body) ? "日语" : "";
};
const tagsIn = (text: string) => [...text.matchAll(/#[\p{L}\p{N}_]+/gu)].map(match => match[0]);
const translatedBody = (original: string, translated?: string) => {
  const tags = tagsIn(original);
  const body = translated || original;
  return { body: body.replace(/#[\p{L}\p{N}_]+/gu, "").trim(), tags };
};
const hasTranslatedVersion = (original: string, translated?: string) => !!translated && translated !== original && (!/[\u3400-\u9fff]/.test(original.replace(/#[\p{L}\p{N}_]+/gu, "")) || !!sourceLanguage(original));

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

function DmMessage({ message, reference, speaker, onReply, onJump, onContext }: {
  message: TwitterMessage;
  reference?: TwitterMessage;
  speaker: string;
  onReply: () => void;
  onJump: (id: string) => void;
  onContext: () => void;
}) {
  const [showOriginal, setShowOriginal] = useState(false);
  const mine = message.role === "user";
  const canTranslate = !mine && hasTranslatedVersion(message.original, message.translated);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelPress = () => { if (pressTimer.current) clearTimeout(pressTimer.current); pressTimer.current = null; };
  return <div id={`tw-dm-${message.id}`} className={`${styles.messageRow} ${mine ? styles.myMessageRow : ""}`}>
    <div className={`${styles.message} ${mine ? styles.mine : styles.theirs}`} title={messageDate(message.createdAt)} onContextMenu={event => { event.preventDefault(); cancelPress(); onContext(); }} onTouchStart={() => { cancelPress(); pressTimer.current = setTimeout(onContext, 520); }} onTouchEnd={cancelPress} onTouchMove={cancelPress} onTouchCancel={cancelPress}>
      {reference && <button type="button" className={styles.messageQuote} onClick={() => onJump(reference.id)}>
        <span><Reply size={12} />{reference.role === "user" ? "你" : speaker}</span>
        <span className={styles.quoteText}>{reference.original}</span>
      </button>}
      {canTranslate && <div className={styles.dmTranslationLine}><span>{sourceLanguage(message.original) ? `翻译自${sourceLanguage(message.original)}` : "已翻译"}</span><button type="button" className={styles.translateToggle} onClick={() => setShowOriginal(open => !open)}>{showOriginal ? "显示译文" : "显示原文"}</button></div>}
      <span className={styles.messageText}>{canTranslate && !showOriginal ? message.translated : message.original}</span>
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
  const [managementOptions, setManagementOptions] = useState<{ initialTab?: "accounts" | "characters" | "communities" | "world"; initialAccountId?: string; createCommunity?: boolean; closeOnSave?: boolean; onlyCharacters?: boolean }>({});
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [followPageOpen, setFollowPageOpen] = useState(false);
  const [dmMenuOpen, setDmMenuOpen] = useState(false);
  const [dmContextId, setDmContextId] = useState<string | null>(null);
  const [dmEditDraft, setDmEditDraft] = useState<string | null>(null);
  const [dmTranslationDraft, setDmTranslationDraft] = useState("");
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [profileFeedTab, setProfileFeedTab] = useState<"posts" | "replies">("posts");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const pullStartRef = useRef<number | null>(null);
  const [communityId, setCommunityId] = useState<string | null>(null);
  const [composeCommunityId, setComposeCommunityId] = useState<string | null>(null);
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
  const openManagement = (options: typeof managementOptions = {}) => { setManagementOptions(options); setManageOpen(true); };

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
  useEffect(() => {
    const ids = characters.map(char => char.id);
    if (ids.some(id => !stateRef.current.importedCharacterIds.includes(id))) {
      commit(current => ({ ...current, importedCharacterIds: [...new Set([...current.importedCharacterIds, ...ids])] }));
    }
  }, [characters, commit]);

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
  const refreshWorld = async (targetCommunityId?: string, topicHint?: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const targetCommunity = stateRef.current.communities.find(c => c.id === targetCommunityId);
      const communityHint = targetCommunity ? `围绕“${targetCommunity.name}”社群写日常讨论，讨论主题：${targetCommunity.description || "日常交流"}；关联角色：${[...targetCommunity.characterIds.map(id => display(id).name), ...(targetCommunity.manualCharacters || [])].join("、") || "无"}。${targetCommunity.includeUserPersona ? `社群也公开关联用户人设“${stateRef.current.profile.name}”。` : "不要把用户描写成主持人或公开关联人物。"}只使用公开信息，不揭露角色小号身份。` : "";
      const batch = await generateTwitterWorldBatch(stateRef.current, [feedHint, communityHint, topicHint ? `所有新帖子都围绕当前热门“${topicHint}”，trend 字段填写这条话题原文` : ""].filter(Boolean).join("。"));
      commit(current => {
        const now = Date.now();
        const trends = targetCommunity ? [] : batch.trends.map(t => ({ id: createTwitterId(), label: t.label, scope: t.scope, volume: Math.round(90 + stableFraction(t.label) * 9500), createdAt: now }));
        let next: TwitterState = { ...current };
        batch.posts.forEach((entry, index) => {
          const id = createTwitterId();
          const authorId = `npc:${createTwitterId()}`;
          next = { ...next, accounts: { ...next.accounts, [authorId]: { name: entry.name, handle: accountHandle(entry.handle || entry.name), bio: "", followers: Math.floor(stableFraction(id) * 600), visibility: "public" } } };
          const trend = current.trends.find(t => t.label === topicHint) || trends.find(t => t.label === entry.trend) || current.trends.find(t => t.label === entry.trend);
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
  const refreshTrends = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const labels = await generateTwitterTrends(stateRef.current);
      commit(current => ({ ...current, trends: labels.map(label => ({ id: createTwitterId(), label, scope: "world" as const, volume: Math.round(90 + stableFraction(label) * 9500), createdAt: Date.now() })) }));
      setTrendFilter(null);
    } catch (error) { alert(error instanceof Error ? error.message : "热门刷新失败。"); }
    finally { setBusy(false); }
  };
  const refreshStrangerDms = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const generated = await generateTwitterStrangerDms(stateRef.current);
      commit(current => {
        const accounts = { ...current.accounts };
        const conversations = generated.map(item => {
          const id = `npc:${createTwitterId()}`;
          accounts[id] = { name: item.name, handle: accountHandle(item.handle || item.name), bio: "", visibility: "public" as const };
          return { id: createTwitterId(), characterId: id, recipientAccountId: id, userAccountId: "user", stranger: true, mode: "real" as const, messages: [{ id: createTwitterId(), role: "character" as const, original: item.original, translated: item.translated, createdAt: Date.now() }], createdAt: Date.now() };
        });
        return { ...current, accounts, conversations: [...conversations, ...current.conversations] };
      });
    } catch (error) { alert(error instanceof Error ? error.message : "私信刷新失败。"); }
    finally { setBusy(false); }
  };
  const backfillTranslations = async () => {
    if (busy) return;
    const snapshot = stateRef.current;
    const likelyForeign = (value: string) => /[가-힣ぁ-ゟ゠-ヿ]/.test(value.replace(/#[\p{L}\p{N}_]+/gu, "")) || (!/[\u3400-\u9fff]/.test(value) && /[A-Za-z]{4,}/.test(value));
    const entries = [...snapshot.posts.filter(post => (!post.translated || post.translated === post.original) && likelyForeign(post.original)).map(post => ({ id: post.id, original: post.original })), ...snapshot.conversations.flatMap(convo => convo.messages.filter(message => message.role === "character" && (!message.translated || message.translated === message.original) && likelyForeign(message.original)).map(message => ({ id: message.id, original: message.original })))];
    if (!entries.length) { alert("没有需要补译的旧内容。"); return; }
    setBusy(true);
    try {
      let completed = 0;
      for (let index = 0; index < entries.length; index += 10) {
        const translations = await translateTwitterLegacy(entries.slice(index, index + 10));
        completed += translations.size;
        commit(current => ({ ...current, posts: current.posts.map(post => translations.has(post.id) ? { ...post, translated: translations.get(post.id) } : post), conversations: current.conversations.map(convo => ({ ...convo, messages: convo.messages.map(message => translations.has(message.id) ? { ...message, translated: translations.get(message.id) } : message) })) }));
      }
      alert(`已补译 ${completed} 条旧内容。`);
    } catch (error) { alert(error instanceof Error ? error.message : "旧内容补译失败。"); }
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
    setConversationId(convo.id); setReplyingToId(null); setDmContextId(null); setDmMenuOpen(false); setPicker(null); setProfileId(null); setFollowPageOpen(false); setTab("messages");
  };
  const sendMessage = () => {
    const text = messageDraft.trim();
    if (!text || !conversationId) return;
    commit(current => ({ ...current, conversations: current.conversations.map(c => c.id === conversationId ? { ...c, messages: [...c.messages, { id: createTwitterId(), role: "user", original: text, replyToId: replyingToId && c.messages.some(m => m.id === replyingToId) ? replyingToId : undefined, createdAt: Date.now() }] } : c) }));
    setMessageDraft(""); setReplyingToId(null);
  };
  const aiGenerate = async (characterId: string, kind: "post" | "reply" | "dm", postAccountId = characterId, replaceMessageId?: string) => {
    if (busy) return;
    setPicker(null); setBusy(true);
    try {
      const snapshot = stateRef.current;
      const thread = snapshot.posts.find(p => p.id === (commentTargetId || threadId));
      const convo = snapshot.conversations.find(c => c.id === conversationId);
      const priorMessages = replaceMessageId && convo ? convo.messages.slice(0, convo.messages.findIndex(message => message.id === replaceMessageId)) : convo?.messages;
      const requestedReplyId = replyingToId;
      if (kind === "reply" && !thread) throw new Error("先选择一条帖子。");
      if (kind === "dm" && !convo) throw new Error("先进入一段私信。");
      const speakingAccountId = kind === "dm" ? convo?.recipientAccountId || characterId : postAccountId;
      const lines: TwitterGeneratedLine[] & { comments?: TwitterCommentDraft[] } = kind === "dm" && convo?.stranger ? [await generateTwitterStrangerReply(snapshot, snapshot.accounts[speakingAccountId]?.name || "陌生人", priorMessages || []).then(reply => ({ original: reply.original, translated: reply.translated || "" }))] : await generateTwitterText({ characterId, state: snapshot, kind, targetPost: thread, conversation: priorMessages, replyToMessage: convo?.messages.find(msg => msg.id === requestedReplyId), anonymous: convo?.mode === "anonymous", senderName: snapshot.accounts[convo?.userAccountId || ""]?.name, accountProfile: snapshot.accounts[speakingAccountId], accountKind: speakingAccountId.endsWith(":alt") ? "alternate" : undefined, communityName: snapshot.communities.find(c => c.id === communityId)?.name, withComments: kind === "post" && snapshot.accounts[postAccountId]?.visibility !== "protected" && snapshot.characterProfiles[postAccountId]?.visibility !== "protected" });
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
        commit(current => ({ ...current, conversations: current.conversations.map(c => c.id === targetId ? { ...c, messages: replaceMessageId ? c.messages.map(message => message.id === replaceMessageId ? { ...message, original: lines[0].original, translated: lines[0].translated } : message) : [...c.messages, ...lines.map((line, index) => ({ id: createTwitterId(), role: "character" as const, ...line, replyToId: index === 0 && requestedReplyId && c.messages.some(m => m.id === requestedReplyId) ? requestedReplyId : undefined, createdAt: now + index }))] } : c) }));
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
    const translated = hasTranslatedVersion(post.original, post.translated);
    const showOriginal = !!originalShown[post.id];
    const content = translatedBody(post.original, translated && !showOriginal ? post.translated : undefined);
    return <article className={`${styles.post} ${post.replyToId ? styles.commentPost : ""}`} key={post.id}>
      <button className={styles.avatarButton} onClick={() => { setProfileId(post.authorId); setProfileFeedTab("posts"); setProfileMenuOpen(false); setThreadId(null); }}><Avatar image={author.avatarUrl} label={author.name} /></button>
      <div className={styles.postBody}>
        <div className={styles.postHeader}><button onClick={() => { setProfileId(post.authorId); setProfileFeedTab("posts"); setProfileMenuOpen(false); setThreadId(null); }}><b>{author.name}</b> <span>@{author.handle} · {timestamp(post.createdAt)}</span></button>{(post.authorId === "user" || post.authorId === "user:alt" || post.authorId.startsWith("group:")) && <button aria-label="删除帖子" onClick={() => deletePost(post.id)}><Trash2 size={16} /></button>}</div>
        {translated && <div className={styles.postTranslationLine}><span>{sourceLanguage(post.original) ? `翻译自${sourceLanguage(post.original)}` : "已翻译"}</span><button className={styles.postTranslationToggle} onClick={() => setOriginalShown(current => ({ ...current, [post.id]: !current[post.id] }))}>{showOriginal ? "显示译文" : "显示原文"}</button></div>}
        <button className={styles.postText} onClick={() => { if (!compact) { setThreadId(post.replyToId || post.id); setCommentTargetId(null); setVisibleComments(4); } }}>{content.body}</button>
        {content.tags.length > 0 && <div className={styles.postTags}>{content.tags.map((tag, index) => <button key={`${tag}-${index}`} onClick={() => { setTab("explore"); setSearch(tag); setTrendFilter(null); setThreadId(null); }}>{tag}</button>)}</div>}
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
  const profileCharacterId = profileId ? state.importedCharacterIds.find(id => id === profileId || `${id}:alt` === profileId) : undefined;
  const filtered = posts.filter(post => {
    if (post.communityId) return false;
    const mine = post.authorId.startsWith("user");
    if (feedMode === "following") return mine || (state.following.includes(post.authorId) && state.importedCharacterIds.includes(post.authorId));
    return mine || (!state.importedCharacterIds.includes(post.authorId) && !post.authorId.endsWith(":alt") && !post.authorId.startsWith("group:"));
  });
  const selectedCommunity = state.communities.find(c => c.id === communityId);
  const pickerCharacters = characters.filter(char => !selectedCommunity || picker !== "post" || selectedCommunity.characterIds.includes(char.id));

  return <div className={styles.app}>
    <header className={styles.header}>
      <button className={styles.headerAvatar} onClick={() => setDrawerOpen(true)} aria-label="打开我的菜单"><Avatar image={currentUserAccount.avatarUrl} label={currentUserAccount.name} /></button>
      <strong className={tab === "home" ? styles.xMark : ""}>{tab === "home" ? "𝕏" : tab === "explore" ? "搜索" : tab === "notices" ? "通知" : "私信"}</strong>
      <button className={styles.headerPeople} onClick={() => setFollowPageOpen(true)} aria-label="角色关注列表"><UserRoundPlus size={27} strokeWidth={2.2} /></button>
    </header>

    <main className={styles.main} onTouchStart={event => { pullStartRef.current = tab === "home" && feedMode === "forYou" && event.currentTarget.scrollTop <= 0 ? event.touches[0].clientY : null; }} onTouchEnd={event => { const start = pullStartRef.current; pullStartRef.current = null; if (start !== null && event.changedTouches[0].clientY - start > 85) void refreshWorld(); }}>
      {tab === "home" && <><div className={styles.homeTabs}><div className={styles.homeTabScroll}><div className={styles.homeTabSlot}><button className={feedMode === "forYou" ? styles.homeTabSelected : ""} onClick={() => setFeedMode("forYou")}>为你推荐</button><button className={styles.tabRefresh} onClick={() => { void refreshWorld(); }} disabled={busy} title="刷新世界动态" aria-label="刷新为你推荐"><RefreshCw size={16} className={busy ? styles.spinning : ""} /></button></div><button className={feedMode === "following" ? styles.homeTabSelected : ""} onClick={() => setFeedMode("following")}>正在关注</button></div></div>
        {filtered.length ? filtered.map(post => renderPost(post)) : <div className={styles.empty}><b>{feedMode === "following" ? "还没有关注角色的动态" : "这里还没有动态"}</b><p>{feedMode === "following" ? "点右上角头像＋，关注已有角色。" : "点刷新按钮生成世界动态。"}</p></div>}
        {feedMode === "following" && <button className={styles.feedGenerateAction} onClick={() => setPicker("post")} disabled={busy}><Sparkles size={17} />让关注的角色发帖</button>}
      </>}
      {tab === "explore" && <><div className={styles.searchBox}><Search size={19} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索帖子、角色或话题" /></div>
        <div className={styles.feedTools}><strong>当前热门</strong><button onClick={() => { void refreshTrends(); }} disabled={busy}><RefreshCw size={15} />刷新趋势</button></div>
        {state.trends.length ? state.trends.map(trend => <button className={styles.trend} key={trend.id} onClick={() => { setTrendFilter(trend.id); setSearch(""); }}><span>当前热门</span><b>{trend.label}</b><small>{countLabel(trend.volume)} 次讨论</small></button>) : <div className={styles.empty}>点“刷新趋势”生成这套世界观里的五条热门话题。</div>}
        {(search.trim() || trendFilter) && <><h3 className={styles.heading}>{trendFilter ? <button onClick={() => setTrendFilter(null)}>← 返回热门</button> : "搜索结果"}</h3>{posts.filter(post => !post.communityId && (trendFilter ? post.trendId === trendFilter || `${post.original} ${post.translated || ""}`.includes(state.trends.find(t => t.id === trendFilter)?.label || "\u0000") : `${post.original} ${post.translated || ""} ${display(post.authorId).name}`.toLowerCase().includes(search.toLowerCase()))).map(post => renderPost(post))}{trendFilter && <button className={styles.aiReply} onClick={() => { void refreshWorld(undefined, state.trends.find(t => t.id === trendFilter)?.label); }} disabled={busy}>刷新该话题帖子</button>}</>}
      </>}
      {tab === "notices" && <><div className={styles.feedTools}><span>与你有关的互动</span>{state.notices.some(n => !n.read) && <button onClick={() => commit(current => ({ ...current, notices: current.notices.map(n => ({ ...n, read: true })) }))}>全部已读</button>}</div>
        {state.notices.length ? state.notices.map(notice => <button className={styles.notice} key={notice.id} onClick={() => { if (notice.postId) setThreadId(notice.postId); commit(current => ({ ...current, notices: current.notices.map(n => n.id === notice.id ? { ...n, read: true } : n) })); }}><Avatar label={display(notice.actorId).name} image={display(notice.actorId).avatarUrl} /><span><b>{display(notice.actorId).name}</b> {notice.kind === "reply" ? "回复了你的帖子" : notice.kind === "dm" ? "发来私信" : notice.kind === "follow" ? "关注了你" : "喜欢了你的帖子"}<small>{notice.text}</small></span>{!notice.read && <i className={styles.dot} />}</button>) : <div className={styles.empty}><b>还没有通知</b><p>角色回复你的帖子后，通知会显示在这里。</p></div>}
      </>}
      {tab === "messages" && <><div className={styles.feedTools}><span>私信</span><div className={styles.dmInboxActions}><button onClick={() => { void refreshStrangerDms(); }} disabled={busy}><RefreshCw size={15} />刷新私信</button><button onClick={() => setPicker("dm")}><Plus size={15} />新私信</button></div></div>
        {state.conversations.length ? [...state.conversations].sort((a, b) => (b.messages.at(-1)?.createdAt || b.createdAt) - (a.messages.at(-1)?.createdAt || a.createdAt)).map(convo => <div className={styles.conversationRow} key={convo.id}><button onClick={() => { setActiveAccount(convo.userAccountId || "user"); setConversationId(convo.id); setDmContextId(null); setDmMenuOpen(false); }}><Avatar image={display(convo.recipientAccountId || convo.characterId).avatarUrl} label={display(convo.recipientAccountId || convo.characterId).name} /><span><b>{display(convo.recipientAccountId || convo.characterId).name} {convo.mode === "anonymous" && <em>匿名</em>}</b><small>{display(convo.userAccountId || "user").name} · {convo.messages.at(-1)?.translated || convo.messages.at(-1)?.original || "开始对话"}</small></span></button><button className={styles.rowDelete} onClick={() => commit(current => ({ ...current, conversations: current.conversations.filter(c => c.id !== convo.id) }))} title="删除对话"><Trash2 size={16} /></button></div>) : <div className={styles.empty}><b>还没有私信</b><p>选择角色，开始实名或匿名对话。</p></div>}
      </>}
    </main>

    {tab === "home" && <button className={styles.fab} onClick={() => { setComposeCommunityId(null); setCompose(true); }} aria-label="发帖">＋</button>}
    <nav className={styles.nav}>
      {([["home", Home, "主页"], ["explore", Search, "搜索"], ["notices", Bell, "通知"], ["messages", MessageCircle, "私信"]] as const).map(([key, Icon, label]) => <button key={key} className={tab === key ? styles.navActive : ""} onClick={() => { setTab(key); setThreadId(null); setProfileId(null); setConversationId(null); }} aria-label={label}><Icon size={23} fill={tab === key && key !== "explore" ? "currentColor" : "none"} />{key === "notices" && state.notices.some(n => !n.read) && <span className={styles.navDot} />}</button>)}
    </nav>

    {drawerOpen && <div className={styles.drawerScrim} onClick={() => setDrawerOpen(false)}><aside className={styles.drawer} onClick={event => event.stopPropagation()}>
      <button className={styles.drawerIdentity} onClick={() => { setDrawerOpen(false); setProfileId(activeAccount === "user:alt" ? "user:alt" : "user"); }}><Avatar image={currentUserAccount.avatarUrl} label={currentUserAccount.name} size="large" /><b>{currentUserAccount.name}</b><span>@{currentUserAccount.handle}</span><small>{(currentUserAccount.followingCount || 0).toLocaleString()} 正在关注　{(currentUserAccount.followers || 0).toLocaleString()} 关注者</small></button>
      <div className={styles.drawerLinks}>
        <button onClick={() => { setDrawerOpen(false); setProfileId(activeAccount === "user:alt" ? "user:alt" : "user"); }}><Home size={22} />个人资料</button>
        <button onClick={() => { setDrawerOpen(false); openManagement({ initialTab: "accounts", onlyCharacters: true }); }}><UserRoundPlus size={22} />角色资料</button>
        <button onClick={() => { setDrawerOpen(false); openManagement({ initialTab: "world" }); }}><Sparkles size={22} />世界观</button>
        <button onClick={() => { setDrawerOpen(false); openManagement({ initialTab: "communities" }); }}><MessageCircle size={22} />社群</button>
        <button onClick={() => { setDrawerOpen(false); setSettingsOpen(true); }}><Settings2 size={22} />设置</button>
      </div>
      <button className={styles.drawerExit} onClick={onClose}>退出推特</button>
    </aside></div>}

    {followPageOpen && <div className={`${styles.page} ${styles.followPage}`}><div className={styles.pageHeader}><button onClick={() => setFollowPageOpen(false)} aria-label="返回"><ArrowLeft size={23} /></button><b>关注</b></div><div className={styles.followList}>
      {characters.map(char => { const info = display(char.id); const followed = state.following.includes(char.id); return <div className={styles.followRow} key={char.id}><button className={styles.followPerson} onClick={() => { setProfileId(char.id); setProfileFeedTab("posts"); setProfileMenuOpen(false); }}><Avatar image={info.avatarUrl} label={info.name} size="large" /><span><b>{info.name}</b><small>@{info.handle}</small>{info.bio && <span className={styles.followBio}>{info.bio}</span>}</span></button><button className={followed ? styles.followingButton : styles.followButton} onClick={() => commit(current => ({ ...current, following: followed ? current.following.filter(id => id !== char.id) : [...current.following, char.id] }))}>{followed ? "正在关注" : "关注"}</button></div>; })}
      {!characters.length && <div className={styles.empty}><b>还没有角色</b><p>在小手机里创建角色后，这里会自动显示。</p></div>}
    </div></div>}

    {settingsOpen && <div className={`${styles.page} ${styles.topPage}`}><div className={styles.pageHeader}><button onClick={() => setSettingsOpen(false)} aria-label="返回"><ArrowLeft size={21} /></button><b>设置</b></div><div className={styles.settingsPlaceholder}><h3>语言与翻译</h3><p>有译文的动态、评论和私信默认显示中文。旧内容如果缺少译文，可以手动补译。</p><button className={styles.aiReply} onClick={() => { void backfillTranslations(); }} disabled={busy}>补译已有外语内容</button><h3>图片生成</h3><p>图片设置将在后续版本中加入。</p></div></div>}

    {threadId && <div className={`${styles.page} ${styles.topPage}`}><div className={styles.pageHeader}><button onClick={() => setThreadId(null)} aria-label="返回"><ArrowLeft size={21} /></button><b>帖子</b></div><div className={styles.pageScroll}>{currentThread && renderPost(currentThread, true)}{currentThread && <div className={styles.postMeta}>{new Date(currentThread.createdAt).toLocaleString("zh-CN")} · {countLabel(currentThread.engagement?.views || 0)} 次查看</div>}<h3 className={styles.heading}>评论</h3>{threadReplies.slice(0, visibleComments).map(({ post, depth }) => <div key={post.id} className={depth ? styles.nestedComment : ""}>{renderPost(post, true)}</div>)}{threadReplies.length > visibleComments && <button className={styles.aiReply} onClick={() => setVisibleComments(count => count + 8)}>查看更多评论</button>}<button className={styles.aiReply} onClick={() => { if (currentThread) void refreshComments(currentThread); }} disabled={busy}><Sparkles size={16} />{busy ? "刷新中" : "刷新新评论"}</button></div><form className={styles.bottomComposer} onSubmit={event => { event.preventDefault(); reply(); }}>{commentTargetId && <button type="button" className={styles.replyingTo} onClick={() => setCommentTargetId(null)}>回复 @{display(state.posts.find(p => p.id === commentTargetId)?.authorId || "user").handle} ×</button>}<input value={replyDraft} onChange={event => setReplyDraft(event.target.value)} placeholder="发布回复" /><button disabled={!replyDraft.trim()} aria-label="发送回复"><Send size={19} /></button></form></div>}

    {profileId && profile && <div className={`${styles.page} ${styles.topPage}`}>
      <div className={styles.profileTopBar}><button onClick={() => { setProfileId(null); setProfileMenuOpen(false); }} aria-label="返回"><ArrowLeft size={23} /></button><b>{profile.name}</b>{(profileCharacterId || profileId === "user" || profileId === "user:alt" || profileId.startsWith("group:")) && <button onClick={() => setProfileMenuOpen(open => !open)} aria-label="主页设置"><Settings2 size={22} /></button>}</div>
      {profileMenuOpen && <div className={styles.profileMenu}>
        <button onClick={() => { setProfileMenuOpen(false); openManagement({ initialAccountId: profileId, closeOnSave: true }); }}>编辑主页</button>
        {profileCharacterId && !profileId.endsWith(":alt") && <button onClick={() => { setProfileMenuOpen(false); openManagement({ initialAccountId: `${profileCharacterId}:alt`, closeOnSave: true }); }}>设置该角色小号</button>}
        {(profileId === "user" || profileId === "user:alt") && <button onClick={() => { setProfileMenuOpen(false); openManagement({ initialAccountId: "user:alt", closeOnSave: true }); }}>设置我的小号</button>}
      </div>}
      <div className={styles.pageScroll}>
        <div className={styles.profileBanner}>{profile.bannerUrl && <StoredImage imageRef={profile.bannerUrl} />}</div>
        <div className={styles.profileIdentity}>
          <div className={styles.profilePortrait}><Avatar label={profile.name} image={profile.avatarUrl} size="large" /></div>
          <h2>{profile.name}</h2>
          <div className={styles.profileHandle}>@{profile.handle}{profile.visibility === "protected" ? " · 私密账号" : ""}</div>
          {profile.bio && <p className={styles.profileBio}>{profile.bio}</p>}
          {profile.createdAt && <p className={styles.profileJoined}>加入于 {new Date(profile.createdAt).toLocaleDateString("zh-CN", { year: "numeric", month: "long" })}</p>}
          <div className={styles.profileCounts}><b>{(profile.followingCount || 0).toLocaleString()}</b> 正在关注 <b>{(profile.followers || 0).toLocaleString()}</b> 关注者</div>
          {profileCharacterId && !profileId.endsWith(":alt") ? <div className={styles.profileControls}><button className={styles.profileDm} onClick={() => openConversation(profileCharacterId, "real", profileId)}>私信</button><button className={state.following.includes(profileCharacterId) ? styles.profileFollowing : styles.profileFollow} onClick={() => commit(current => ({ ...current, following: current.following.includes(profileCharacterId) ? current.following.filter(id => id !== profileCharacterId) : [...current.following, profileCharacterId] }))}>{state.following.includes(profileCharacterId) ? "正在关注" : "关注"}</button></div> : (profileId === "user" || profileId === "user:alt" || profileId.startsWith("group:")) ? <button className={styles.profileEdit} onClick={() => openManagement({ initialAccountId: profileId, closeOnSave: true })}>编辑个人资料</button> : null}
        </div>
        <div className={styles.profileTabs}><button className={profileFeedTab === "posts" ? styles.profileTabSelected : ""} onClick={() => setProfileFeedTab("posts")}>帖子</button><button className={profileFeedTab === "replies" ? styles.profileTabSelected : ""} onClick={() => setProfileFeedTab("replies")}>回复</button></div>
        {state.posts.filter(p => p.authorId === profileId && (profileFeedTab === "posts" ? !p.replyToId : !!p.replyToId)).sort((a, b) => b.createdAt - a.createdAt).map(p => renderPost(p))}
      </div>
    </div>}

    {conversationId && currentConversation && <div className={`${styles.page} ${styles.topPage}`}><div className={styles.pageHeader}><button onClick={() => { setConversationId(null); setReplyingToId(null); setDmMenuOpen(false); setDmContextId(null); }} aria-label="返回"><ArrowLeft size={21} /></button><Avatar label={display(currentConversation.recipientAccountId || currentConversation.characterId).name} image={display(currentConversation.recipientAccountId || currentConversation.characterId).avatarUrl} /><b>{display(currentConversation.recipientAccountId || currentConversation.characterId).name}{currentConversation.mode === "anonymous" && <span className={styles.anon}> · 匿名</span>}</b><button onClick={() => setDmMenuOpen(open => !open)} aria-label="私信设置"><MoreHorizontal size={21} /></button></div>{dmMenuOpen && <div className={styles.dmMenu}><button onClick={() => { commit(current => ({ ...current, conversations: current.conversations.map(c => c.id === conversationId ? { ...c, messages: [] } : c) })); setDmMenuOpen(false); setReplyingToId(null); }}>清除聊天记录</button><button onClick={() => { commit(current => ({ ...current, conversations: current.conversations.map(c => c.id === conversationId ? { ...c, blocked: !c.blocked } : c) })); setDmMenuOpen(false); }}>{currentConversation.blocked ? "取消屏蔽" : "屏蔽此人"}</button></div>}<div className={styles.messages}>
      {currentConversation.messages.map((msg, index) => <div key={msg.id} className={styles.messageGroup}>
        {(index === 0 || messageDay(msg.createdAt) !== messageDay(currentConversation.messages[index - 1].createdAt) || msg.createdAt - currentConversation.messages[index - 1].createdAt > 20 * 60_000) && <div className={styles.messageDate}>{messageDate(msg.createdAt)}</div>}
        <DmMessage message={msg} reference={currentConversation.messages.find(row => row.id === msg.replyToId)} speaker={display(currentConversation.recipientAccountId || currentConversation.characterId).name} onReply={() => setReplyingToId(msg.id)} onContext={() => { setDmContextId(msg.id); setDmEditDraft(null); }} onJump={id => document.getElementById(`tw-dm-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" })} />
      </div>)}
      {busy && <div className={styles.typing}>正在输入…</div>}
    </div>{replyingToId && currentConversation.messages.some(msg => msg.id === replyingToId) && <div className={styles.dmReplyPreview}><span>回复 {currentConversation.messages.find(msg => msg.id === replyingToId)?.role === "user" ? "你" : display(currentConversation.recipientAccountId || currentConversation.characterId).name}<small>{currentConversation.messages.find(msg => msg.id === replyingToId)?.original}</small></span><button type="button" onClick={() => setReplyingToId(null)} aria-label="取消回复"><X size={18} /></button></div>}<div className={styles.dmBottom}><input value={messageDraft} onChange={event => setMessageDraft(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); sendMessage(); } }} placeholder={currentConversation.blocked ? "已屏蔽此会话" : "发送私信 · 回车发送"} disabled={currentConversation.blocked} /><button onClick={() => { void aiGenerate(currentConversation.characterId, "dm"); }} disabled={busy || currentConversation.blocked} aria-label="召唤回复" title="点击请求对方回复"><Send size={20} /></button></div></div>}

    {dmContextId && currentConversation && <div className={styles.overlay} onClick={() => { setDmContextId(null); setDmEditDraft(null); }}><div className={styles.sheet} onClick={event => event.stopPropagation()}><div className={styles.sheetHeader}><b>消息操作</b><button onClick={() => setDmContextId(null)} aria-label="关闭"><X size={20} /></button></div>{dmEditDraft !== null ? <div className={styles.dmEditArea}><label>正文<textarea value={dmEditDraft} onChange={event => setDmEditDraft(event.target.value)} /></label>{currentConversation.messages.find(message => message.id === dmContextId)?.role === "character" && <label>中文译文<textarea value={dmTranslationDraft} onChange={event => setDmTranslationDraft(event.target.value)} placeholder="原文是中文可留空" /></label>}<button onClick={() => { const value = dmEditDraft.trim(); if (!value) return; commit(current => ({ ...current, conversations: current.conversations.map(c => c.id === conversationId ? { ...c, messages: c.messages.map(message => message.id === dmContextId ? { ...message, original: value, translated: message.role === "character" ? dmTranslationDraft.trim() || undefined : undefined } : message) } : c) })); setDmContextId(null); setDmEditDraft(null); }}>保存编辑</button></div> : <div className={styles.dmContextActions}><button onClick={() => { setReplyingToId(dmContextId); setDmContextId(null); }}>回复</button><button onClick={() => { const row = currentConversation.messages.find(message => message.id === dmContextId); setDmEditDraft(row?.original || ""); setDmTranslationDraft(row?.translated || ""); }}>编辑{currentConversation.messages.find(message => message.id === dmContextId)?.role === "character" ? "正文与译文" : ""}</button>{currentConversation.messages.find(message => message.id === dmContextId)?.role === "character" && <button onClick={() => { const id = dmContextId; setDmContextId(null); void aiGenerate(currentConversation.characterId, "dm", currentConversation.characterId, id); }}>重回</button>}<button className={styles.destructive} onClick={() => { commit(current => ({ ...current, conversations: current.conversations.map(c => c.id === conversationId ? { ...c, messages: c.messages.filter(message => message.id !== dmContextId).map(message => message.replyToId === dmContextId ? { ...message, replyToId: undefined } : message) } : c) })); setDmContextId(null); }}>删除</button></div>}</div></div>}

    {communityId && state.communities.some(c => c.id === communityId) && <div className={styles.page}><div className={styles.pageHeader}><button onClick={() => setCommunityId(null)} aria-label="返回"><ArrowLeft size={21} /></button><b>社群</b><button onClick={() => openManagement({ initialTab: "communities" })}>设置</button></div><div className={styles.pageScroll}>{state.communities.filter(c => c.id === communityId).map(c => <div key={c.id}><div className={styles.banner}>{c.bannerUrl && <StoredImage imageRef={c.bannerUrl} />}</div><div className={styles.communityInfo}><Avatar image={c.avatarUrl} label={c.name} size="large" /><h2>{c.name}</h2><span>{c.fans.toLocaleString()} 位粉丝 · {c.characterIds.length + (c.manualCharacters || []).length} 位关联人物</span>{c.description && <p>{c.description}</p>}<p>{[...c.characterIds.map(id => display(id).name), ...(c.manualCharacters || [])].join("、")}</p></div></div>)}<div className={styles.feedTools}><button onClick={() => { setComposeCommunityId(communityId); setCompose(true); }}>在社群发帖</button><button onClick={() => setPicker("post")} disabled={busy}>生成角色帖子＋评论</button><button onClick={() => { void refreshWorld(communityId || undefined); }} disabled={busy}>刷新社群</button></div>{posts.filter(p => p.communityId === communityId).map(p => renderPost(p))}</div></div>}

    {compose && <div className={`${styles.page} ${styles.composePage}`}><div className={styles.pageHeader}><button onClick={() => { setCompose(false); setComposeCommunityId(null); }} aria-label="取消"><X size={22} /></button><b>{composeCommunityId ? "社区发帖" : "发帖"} · {currentUserAccount.name}</b><button className={styles.publish} onClick={publish} disabled={!draft.trim() && !imageRef}>发布</button></div><div className={styles.composeBody}><Avatar image={currentUserAccount.avatarUrl} label={currentUserAccount.name} /><textarea autoFocus value={draft} onChange={event => setDraft(event.target.value)} placeholder="有什么新鲜事？" maxLength={1200} /></div>{imageRef && <div className={styles.imagePreview}><StoredImage imageRef={imageRef} /><button onClick={() => setImageRef("")} aria-label="移除图片"><X size={17} /></button></div>}<div className={styles.composeTools}><button onClick={() => fileInputRef.current?.click()}><ImagePlus size={21} />添加照片</button><input ref={fileInputRef} type="file" accept="image/*" hidden onChange={event => { void uploadImage(event); }} /></div></div>}

    {picker && <div className={styles.overlay} onClick={() => setPicker(null)}><div className={styles.sheet} onClick={event => event.stopPropagation()}>
      <div className={styles.sheetHeader}><b>{picker === "post" ? "选择角色账号发帖" : picker === "reply" ? "选一个角色回复" : "开始私信"}</b><button onClick={() => setPicker(null)} aria-label="关闭"><X size={20} /></button></div>
      <div className={styles.sheetList}>{pickerCharacters.length ? pickerCharacters.map(char => <div className={styles.pickRow} key={char.id}>
        <Avatar label={display(char.id).name} image={display(char.id).avatarUrl} /><b>{display(char.id).name}</b>
        {picker === "dm" ? <><button onClick={() => openConversation(char.id, "real")}>大号</button>{state.accounts[`${char.id}:alt`] && <button onClick={() => openConversation(char.id, "real", `${char.id}:alt`)}>小号</button>}</> : picker === "post" ? <>
          <button onClick={() => { void aiGenerate(char.id, "post", char.id); }} disabled={busy}>大号</button>
          {!selectedCommunity && state.accounts[`${char.id}:alt`] && <button onClick={() => { void aiGenerate(char.id, "post", `${char.id}:alt`); }} disabled={busy}>小号</button>}
        </> : <button onClick={() => { void aiGenerate(char.id, "reply"); }} disabled={busy}>选择</button>}
      </div>) : <p>{selectedCommunity ? "请先给社群关联已有角色，或者刷新社群生成路人动态。" : "在小手机里创建角色后，便可以选择角色。"}</p>}</div>
    </div></div>}

    {manageOpen && <TwitterManagement key={`${managementOptions.initialTab || "accounts"}-${managementOptions.initialAccountId || ""}-${managementOptions.createCommunity || ""}`} {...managementOptions} state={state} characters={characters} onChange={commit} onClose={() => setManageOpen(false)} onNotice={alert} onUserAccount={id => { setActiveAccount(id); setManageOpen(false); setProfileId(null); }} onCommunity={id => { setThreadId(null); setProfileId(null); setConversationId(null); setCommunityId(id); setManageOpen(false); }} />}
  </div>;
}
