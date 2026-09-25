"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  ArrowLeft, Bell, Bookmark, Heart, Home, ImagePlus, Mail, MessageCircle,
  MoreHorizontal, Repeat2, Search, Send, Settings2, Sparkles, Trash2, X,
} from "lucide-react";
import { CHARACTERS_UPDATED_EVENT, loadCharacters } from "@/lib/character-storage";
import type { Character } from "@/lib/character-types";
import { resolveUserIdentity } from "@/lib/settings-storage";
import { getChatImageFromIndexedDB, saveChatImageToIndexedDB } from "@/lib/chat-asset-storage";
import { generateTwitterText } from "@/lib/twitter-engine";
import {
  createTwitterId, loadTwitterState, saveTwitterState, TWITTER_UPDATED_EVENT,
  type TwitterPost, type TwitterProfile, type TwitterState,
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

export function TwitterApp({ onClose, onNotice }: Props) {
  const [state, setState] = useState<TwitterState>(() => loadTwitterState());
  const stateRef = useRef(state);
  const [characters, setCharacters] = useState<Character[]>(() => loadCharacters());
  const [tab, setTab] = useState<Tab>("home");
  const [feedMode, setFeedMode] = useState<"forYou" | "following">("forYou");
  const [search, setSearch] = useState("");
  const [threadId, setThreadId] = useState<string | null>(null);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [compose, setCompose] = useState(false);
  const [draft, setDraft] = useState("");
  const [imageRef, setImageRef] = useState("");
  const [replyDraft, setReplyDraft] = useState("");
  const [messageDraft, setMessageDraft] = useState("");
  const [picker, setPicker] = useState<Picker>(null);
  const [busy, setBusy] = useState(false);
  const [editProfile, setEditProfile] = useState(false);
  const [editRules, setEditRules] = useState(false);
  const [profileDraft, setProfileDraft] = useState<TwitterProfile>(state.profile);
  const [rulesDraft, setRulesDraft] = useState(state.worldRules);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const userIdentity = resolveUserIdentity(undefined, "twitter");
  const user = {
    ...state.profile,
    name: state.profile.name === "我" ? userIdentity?.name || "我" : state.profile.name,
    avatarUrl: state.profile.avatarUrl || userIdentity?.avatarUrl || "",
  };

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

  const display = useCallback((id: string) => {
    if (id === "user") return user;
    const char = characters.find(c => c.id === id);
    const own = state.characterProfiles[id];
    return { name: own?.name || char?.name || "已移除角色", handle: own?.handle || (char?.name || "character").replace(/\s+/g, "_").toLowerCase(), avatarUrl: own?.avatarUrl || char?.avatar || "", bannerUrl: own?.bannerUrl || "", bio: own?.bio || "" };
  }, [characters, state.characterProfiles, user]);

  const posts = useMemo(() => state.posts.filter(p => !p.replyToId).sort((a, b) => b.createdAt - a.createdAt), [state.posts]);
  const currentThread = state.posts.find(p => p.id === threadId);
  const currentConversation = state.conversations.find(c => c.id === conversationId);

  const alert = (message: string) => { onNotice?.(message); };
  const uploadImage = async (event: ChangeEvent<HTMLInputElement>, field: "post" | "avatar" | "banner") => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) { alert("请选择图片文件。"); return; }
    try {
      const ref = await saveChatImageToIndexedDB(file);
      if (field === "post") setImageRef(ref);
      else setProfileDraft(prev => ({ ...prev, [field === "avatar" ? "avatarUrl" : "bannerUrl"]: ref }));
    } catch { alert("图片保存失败，请重试。"); }
  };
  const publish = () => {
    const text = draft.trim();
    if (!text && !imageRef) return;
    commit(current => ({ ...current, posts: [...current.posts, { id: createTwitterId(), authorId: "user", original: text, imageRef: imageRef || undefined, createdAt: Date.now() }] }));
    setDraft(""); setImageRef(""); setCompose(false); setTab("home"); setFeedMode("forYou");
  };
  const reply = () => {
    const text = replyDraft.trim();
    if (!text || !threadId) return;
    commit(current => ({ ...current, posts: [...current.posts, { id: createTwitterId(), authorId: "user", original: text, replyToId: threadId, createdAt: Date.now() }] }));
    setReplyDraft("");
  };
  const changePost = (id: string, field: "liked" | "bookmarked" | "reposted") => {
    commit(current => ({ ...current, posts: current.posts.map(p => p.id === id ? { ...p, [field]: !p[field] } : p) }));
  };
  const deletePost = (id: string) => {
    commit(current => ({ ...current, posts: current.posts.filter(p => p.id !== id && p.replyToId !== id), notices: current.notices.filter(n => n.postId !== id) }));
    if (threadId === id) setThreadId(null);
  };
  const openConversation = (characterId: string, mode: "real" | "anonymous") => {
    let convo = stateRef.current.conversations.find(c => c.characterId === characterId && c.mode === mode);
    if (!convo) {
      convo = { id: createTwitterId(), characterId, mode, messages: [], createdAt: Date.now() };
      const created = convo;
      commit(current => ({ ...current, conversations: [created, ...current.conversations] }));
    }
    setConversationId(convo.id); setPicker(null); setProfileId(null); setTab("messages");
  };
  const sendMessage = () => {
    const text = messageDraft.trim();
    if (!text || !conversationId) return;
    commit(current => ({ ...current, conversations: current.conversations.map(c => c.id === conversationId ? { ...c, messages: [...c.messages, { id: createTwitterId(), role: "user", original: text, createdAt: Date.now() }] } : c) }));
    setMessageDraft("");
  };
  const aiGenerate = async (characterId: string, kind: "post" | "reply" | "dm") => {
    if (busy) return;
    setPicker(null); setBusy(true);
    try {
      const snapshot = stateRef.current;
      const thread = snapshot.posts.find(p => p.id === threadId);
      const convo = snapshot.conversations.find(c => c.id === conversationId);
      if (kind === "reply" && !thread) throw new Error("先选择一条帖子。");
      if (kind === "dm" && !convo) throw new Error("先进入一段私信。");
      const lines = await generateTwitterText({ characterId, state: snapshot, kind, targetPost: thread, conversation: convo?.messages, anonymous: convo?.mode === "anonymous" });
      const now = Date.now();
      if (kind === "dm") {
        const targetId = convo!.id;
        commit(current => ({ ...current, conversations: current.conversations.map(c => c.id === targetId ? { ...c, messages: [...c.messages, ...lines.map((line, index) => ({ id: createTwitterId(), role: "character" as const, ...line, createdAt: now + index }))] } : c) }));
      } else {
        const created: TwitterPost = { id: createTwitterId(), authorId: characterId, original: lines[0].original, translated: lines[0].translated, replyToId: kind === "reply" ? threadId || undefined : undefined, createdAt: now };
        commit(current => ({ ...current, posts: [...current.posts, created], notices: kind === "reply" && thread?.authorId === "user" ? [{ id: createTwitterId(), kind: "reply", actorId: characterId, postId: thread.id, text: created.original, createdAt: now }, ...current.notices] : current.notices }));
      }
    } catch (error) { alert(error instanceof Error ? error.message : "生成失败，请重试。"); }
    finally { setBusy(false); }
  };

  const renderPost = (post: TwitterPost, compact = false) => {
    const author = display(post.authorId);
    const replies = state.posts.filter(row => row.replyToId === post.id).length;
    return <article className={styles.post} key={post.id}>
      <button className={styles.avatarButton} onClick={() => { setProfileId(post.authorId); setThreadId(null); }}><Avatar image={author.avatarUrl} label={author.name} /></button>
      <div className={styles.postBody}>
        <div className={styles.postHeader}><button onClick={() => { setProfileId(post.authorId); setThreadId(null); }}><b>{author.name}</b> <span>@{author.handle} · {timestamp(post.createdAt)}</span></button>{post.authorId === "user" && <button aria-label="删除帖子" onClick={() => deletePost(post.id)}><Trash2 size={16} /></button>}</div>
        <button className={styles.postText} onClick={() => { if (!compact) setThreadId(post.replyToId || post.id); }}>{post.original}</button>
        {post.translated && post.translated !== post.original && <div className={styles.translation}>{post.translated}</div>}
        {post.imageRef && <div className={styles.postImage}><StoredImage imageRef={post.imageRef} /></div>}
        <div className={styles.actions}>
          <button title="回复" onClick={() => setThreadId(post.replyToId || post.id)}><MessageCircle size={17} />{replies || ""}</button>
          <button title="转推" className={post.reposted ? styles.engaged : ""} onClick={() => changePost(post.id, "reposted")}><Repeat2 size={18} /></button>
          <button title="喜欢" className={post.liked ? styles.liked : ""} onClick={() => changePost(post.id, "liked")}><Heart size={17} fill={post.liked ? "currentColor" : "none"} /></button>
          <button title="收藏" className={post.bookmarked ? styles.engaged : ""} onClick={() => changePost(post.id, "bookmarked")}><Bookmark size={17} fill={post.bookmarked ? "currentColor" : "none"} /></button>
        </div>
      </div>
    </article>;
  };

  const profile = profileId ? display(profileId) : null;
  const trendTags = useMemo(() => {
    const counts = new Map<string, number>();
    state.posts.forEach(post => { for (const tag of post.original.match(/#[\p{L}\p{N}_]+/gu) || []) counts.set(tag, (counts.get(tag) || 0) + 1); });
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [state.posts]);
  const filtered = posts.filter(post => (feedMode !== "following" || post.authorId === "user" || state.following.includes(post.authorId)) && (!search.trim() || `${post.original} ${display(post.authorId).name}`.toLowerCase().includes(search.toLowerCase())));

  return <div className={styles.app}>
    <header className={styles.header}>
      <button className={styles.headerAvatar} onClick={() => { setProfileId("user"); setThreadId(null); setConversationId(null); }}><Avatar image={user.avatarUrl} label={user.name} /></button>
      <strong>{tab === "home" ? "推特" : tab === "explore" ? "探索" : tab === "notices" ? "通知" : "私信"}</strong>
      <button className={styles.close} onClick={onClose} aria-label="返回桌面"><X size={20} /></button>
    </header>

    <main className={styles.main}>
      {tab === "home" && <><div className={styles.feedTabs}><button className={feedMode === "forYou" ? styles.selected : ""} onClick={() => setFeedMode("forYou")}>为你推荐</button><button className={feedMode === "following" ? styles.selected : ""} onClick={() => setFeedMode("following")}>正在关注</button></div>
        <div className={styles.feedTools}><span>你和角色的动态</span><button onClick={() => setPicker("post")} disabled={busy}><Sparkles size={16} />让角色发帖</button></div>
        {filtered.length ? filtered.map(post => renderPost(post)) : <div className={styles.empty}><b>这里还没有帖子</b><p>写下第一条动态，或让一个角色先发帖。</p></div>}
      </>}
      {tab === "explore" && <><div className={styles.searchBox}><Search size={19} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索帖子、角色或话题" /></div>
        <h3 className={styles.heading}>热门话题</h3>
        {trendTags.length ? trendTags.map(([tag, count]) => <button className={styles.trend} key={tag} onClick={() => setSearch(tag)}><span>推特 · 话题</span><b>{tag}</b><small>{count} 条帖子</small></button>) : <div className={styles.empty}>帖子带上 #话题 后会显示在这里。</div>}
        {search.trim() && <><h3 className={styles.heading}>搜索结果</h3>{posts.filter(post => `${post.original} ${display(post.authorId).name}`.toLowerCase().includes(search.toLowerCase())).map(post => renderPost(post))}</>}
      </>}
      {tab === "notices" && <><div className={styles.feedTools}><span>与你有关的互动</span>{state.notices.some(n => !n.read) && <button onClick={() => commit(current => ({ ...current, notices: current.notices.map(n => ({ ...n, read: true })) }))}>全部已读</button>}</div>
        {state.notices.length ? state.notices.map(notice => <button className={styles.notice} key={notice.id} onClick={() => { if (notice.postId) setThreadId(notice.postId); commit(current => ({ ...current, notices: current.notices.map(n => n.id === notice.id ? { ...n, read: true } : n) })); }}><Avatar label={display(notice.actorId).name} image={display(notice.actorId).avatarUrl} /><span><b>{display(notice.actorId).name}</b> {notice.kind === "reply" ? "回复了你的帖子" : notice.kind === "dm" ? "发来私信" : notice.kind === "follow" ? "关注了你" : "喜欢了你的帖子"}<small>{notice.text}</small></span>{!notice.read && <i className={styles.dot} />}</button>) : <div className={styles.empty}><b>还没有通知</b><p>角色回复你的帖子后，通知会显示在这里。</p></div>}
      </>}
      {tab === "messages" && <><div className={styles.feedTools}><span>私信</span><button onClick={() => setPicker("dm")}>新私信</button></div>
        {state.conversations.length ? [...state.conversations].sort((a, b) => (b.messages.at(-1)?.createdAt || b.createdAt) - (a.messages.at(-1)?.createdAt || a.createdAt)).map(convo => <div className={styles.conversationRow} key={convo.id}><button onClick={() => setConversationId(convo.id)}><Avatar image={display(convo.characterId).avatarUrl} label={display(convo.characterId).name} /><span><b>{display(convo.characterId).name} {convo.mode === "anonymous" && <em>匿名</em>}</b><small>{convo.messages.at(-1)?.original || "开始对话"}</small></span></button><button className={styles.rowDelete} onClick={() => commit(current => ({ ...current, conversations: current.conversations.filter(c => c.id !== convo.id) }))} title="删除对话"><Trash2 size={16} /></button></div>) : <div className={styles.empty}><b>还没有私信</b><p>选择角色，开始实名或匿名对话。</p></div>}
      </>}
    </main>

    {tab === "home" && <button className={styles.fab} onClick={() => setCompose(true)} aria-label="发帖">＋</button>}
    <nav className={styles.nav}>
      {([["home", Home, "主页"], ["explore", Search, "探索"], ["notices", Bell, "通知"], ["messages", Mail, "私信"]] as const).map(([key, Icon, label]) => <button key={key} className={tab === key ? styles.navActive : ""} onClick={() => { setTab(key); setThreadId(null); setProfileId(null); setConversationId(null); }} aria-label={label}><Icon size={23} fill={tab === key && key !== "explore" ? "currentColor" : "none"} />{key === "notices" && state.notices.some(n => !n.read) && <span className={styles.navDot} />}</button>)}
    </nav>

    {threadId && <div className={styles.page}><div className={styles.pageHeader}><button onClick={() => setThreadId(null)} aria-label="返回"><ArrowLeft size={21} /></button><b>帖子</b></div><div className={styles.pageScroll}>{currentThread && renderPost(currentThread, true)}<h3 className={styles.heading}>回复</h3>{state.posts.filter(p => p.replyToId === threadId).sort((a, b) => a.createdAt - b.createdAt).map(p => renderPost(p, true))}<button className={styles.aiReply} onClick={() => setPicker("reply")} disabled={busy}><Sparkles size={16} />让角色回复</button></div><form className={styles.bottomComposer} onSubmit={event => { event.preventDefault(); reply(); }}><input value={replyDraft} onChange={event => setReplyDraft(event.target.value)} placeholder="发布回复" /><button disabled={!replyDraft.trim()} aria-label="发送回复"><Send size={19} /></button></form></div>}

    {profileId && profile && <div className={styles.page}><div className={styles.pageHeader}><button onClick={() => setProfileId(null)} aria-label="返回"><ArrowLeft size={21} /></button><b>个人主页</b></div><div className={styles.pageScroll}><div className={styles.banner}>{profile.bannerUrl && <StoredImage imageRef={profile.bannerUrl} />}</div><div className={styles.profileIntro}><Avatar label={profile.name} image={profile.avatarUrl} size="large" />{profileId === "user" ? <button onClick={() => { setProfileDraft(state.profile); setEditProfile(true); }}>编辑资料</button> : <button onClick={() => commit(current => ({ ...current, following: current.following.includes(profileId!) ? current.following.filter(id => id !== profileId) : [...current.following, profileId!] }))}>{state.following.includes(profileId) ? "正在关注" : "关注"}</button>}</div><h2>{profile.name}</h2><div className={styles.handle}>@{profile.handle}</div><p>{profile.bio}</p>{profileId === "user" && <button className={styles.rulesButton} onClick={() => { setRulesDraft(state.worldRules); setEditRules(true); }}><Settings2 size={16} />推特世界观设置</button>}{profileId !== "user" && <button className={styles.rulesButton} onClick={() => openConversation(profileId!, "real")}><Mail size={16} />私信</button>}<h3 className={styles.heading}>帖子</h3>{posts.filter(p => p.authorId === profileId).map(p => renderPost(p))}</div></div>}

    {conversationId && currentConversation && <div className={styles.page}><div className={styles.pageHeader}><button onClick={() => setConversationId(null)} aria-label="返回"><ArrowLeft size={21} /></button><Avatar label={display(currentConversation.characterId).name} image={display(currentConversation.characterId).avatarUrl} /><b>{display(currentConversation.characterId).name}{currentConversation.mode === "anonymous" && <span className={styles.anon}> · 匿名</span>}</b><button onClick={() => commit(current => ({ ...current, conversations: current.conversations.map(c => c.id === conversationId ? { ...c, blocked: !c.blocked } : c) }))} title="切换屏蔽状态"><MoreHorizontal size={21} /></button></div><div className={styles.messages}>
      {currentConversation.messages.map(msg => <div key={msg.id} className={`${styles.message} ${msg.role === "user" ? styles.mine : styles.theirs}`}><span>{msg.original}</span>{msg.translated && msg.translated !== msg.original && <small>{msg.translated}</small>}<time>{timestamp(msg.createdAt)}</time></div>)}
      {busy && <div className={styles.typing}>正在输入…</div>}
    </div><div className={styles.dmBottom}><button onClick={() => aiGenerate(currentConversation.characterId, "dm")} disabled={busy || currentConversation.blocked} aria-label="召唤回复" title="召唤回复"><Sparkles size={19} /></button><form onSubmit={event => { event.preventDefault(); sendMessage(); }}><input value={messageDraft} onChange={event => setMessageDraft(event.target.value)} placeholder={currentConversation.blocked ? "已屏蔽此会话" : "发送私信"} disabled={currentConversation.blocked} /><button disabled={!messageDraft.trim() || currentConversation.blocked} aria-label="发送私信"><Send size={19} /></button></form></div></div>}

    {compose && <div className={styles.page}><div className={styles.pageHeader}><button onClick={() => setCompose(false)} aria-label="取消"><X size={22} /></button><b>发帖</b><button className={styles.publish} onClick={publish} disabled={!draft.trim() && !imageRef}>发布</button></div><div className={styles.composeBody}><Avatar image={user.avatarUrl} label={user.name} /><textarea autoFocus value={draft} onChange={event => setDraft(event.target.value)} placeholder="有什么新鲜事？" maxLength={1200} /></div>{imageRef && <div className={styles.imagePreview}><StoredImage imageRef={imageRef} /><button onClick={() => setImageRef("")} aria-label="移除图片"><X size={17} /></button></div>}<div className={styles.composeTools}><button onClick={() => fileInputRef.current?.click()}><ImagePlus size={21} />添加照片</button><input ref={fileInputRef} type="file" accept="image/*" hidden onChange={event => { void uploadImage(event, "post"); }} /></div></div>}

    {picker && <div className={styles.overlay} onClick={() => setPicker(null)}><div className={styles.sheet} onClick={event => event.stopPropagation()}><div className={styles.sheetHeader}><b>{picker === "post" ? "选一个角色发帖" : picker === "reply" ? "选一个角色回复" : "开始私信"}</b><button onClick={() => setPicker(null)} aria-label="关闭"><X size={20} /></button></div><div className={styles.sheetList}>{characters.length ? characters.map(char => <div className={styles.pickRow} key={char.id}><Avatar label={display(char.id).name} image={display(char.id).avatarUrl} /><b>{display(char.id).name}</b>{picker === "dm" ? <><button onClick={() => openConversation(char.id, "real")}>实名</button><button onClick={() => openConversation(char.id, "anonymous")}>匿名</button></> : <button onClick={() => { void aiGenerate(char.id, picker); }} disabled={busy}>选择</button>}</div>) : <p>先在小手机里创建角色。</p>}</div></div></div>}

    {editProfile && <div className={styles.page}><div className={styles.pageHeader}><button onClick={() => setEditProfile(false)} aria-label="返回"><ArrowLeft size={21} /></button><b>编辑资料</b><button onClick={() => { commit(current => ({ ...current, profile: { ...profileDraft, name: profileDraft.name.trim() || "我", handle: profileDraft.handle.trim().replace(/^@/, "") || "my_twitter" } })); setEditProfile(false); }}>保存</button></div><div className={styles.editForm}><label>名字<input value={profileDraft.name} onChange={e => setProfileDraft({ ...profileDraft, name: e.target.value })} /></label><label>用户名<input value={profileDraft.handle} onChange={e => setProfileDraft({ ...profileDraft, handle: e.target.value })} /></label><label>简介<textarea value={profileDraft.bio} onChange={e => setProfileDraft({ ...profileDraft, bio: e.target.value })} /></label><label>头像<input type="file" accept="image/*" onChange={e => { void uploadImage(e, "avatar"); }} /></label><label>主页背景<input type="file" accept="image/*" onChange={e => { void uploadImage(e, "banner"); }} /></label></div></div>}

    {editRules && <div className={styles.page}><div className={styles.pageHeader}><button onClick={() => setEditRules(false)} aria-label="返回"><ArrowLeft size={21} /></button><b>推特世界观</b><button onClick={() => { commit(current => ({ ...current, worldRules: rulesDraft.trim() })); setEditRules(false); }}>保存</button></div><div className={styles.editForm}><p>角色公开发帖、评论和私信时会参考这里的补充设定。原有角色卡和世界书仍生效。</p><textarea className={styles.rulesText} value={rulesDraft} onChange={e => setRulesDraft(e.target.value)} placeholder="例如：这是架空的娱乐圈，角色的地下关系不能公开。" /></div></div>}
  </div>;
}
