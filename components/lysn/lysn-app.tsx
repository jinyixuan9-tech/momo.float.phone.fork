"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Bell, Bookmark, Camera, ChevronLeft, ChevronRight, Heart, Image as ImageIcon, MessageCircle, Mic2, MoreHorizontal, Search, Send, Settings2, UserRound, X } from "lucide-react";
import { loadCharacters, CHARACTERS_UPDATED_EVENT } from "@/lib/character-storage";
import type { Character } from "@/lib/character-types";
import { getChatImageFromIndexedDB, saveChatImageToIndexedDB } from "@/lib/chat-asset-storage";
import { sendBrowserNotification } from "@/lib/browser-notification";
import { resolveMediaForUse } from "@/lib/media-resolver";
import { resolveVoiceConfig, synthesizeSpeech, playAudioBlobViaMediaElement, unlockAudioPlayback } from "@/lib/tts-service";
import { generateLysn } from "@/lib/lysn-engine";
import { appendLysn, loadLysn, resolveLysnRoom, saveLysn, LYSN_EVENT, type LysnMessage, type LysnProfile, type LysnRoomSettings, type LysnState, type LysnUserProfile } from "@/lib/lysn-storage";
import styles from "./lysn-app.module.css";

type Tab = "friends" | "chats" | "more";
type Route = "artist" | "chat" | "chatDetail" | "media" | "ourBox" | "artistEdit" | "myProfile" | "myEdit" | "settings" | null;
type UploadTarget = "artistAvatar" | "artistCover" | "userAvatar" | "userCover" | "roomAvatar";

function AssetImage({ src, className = "" }: { src: string; className?: string }) {
  const [url, setUrl] = useState(src.startsWith("asset://") ? "" : src);
  useEffect(() => {
    let active = true;
    if (!src.startsWith("asset://")) { setUrl(src); return; }
    getChatImageFromIndexedDB(src.slice(8)).then(value => { if (active) setUrl(value || ""); }).catch(() => { if (active) setUrl(""); });
    return () => { active = false; };
  }, [src]);
  return url ? <img src={url} className={className} alt="" /> : <span className={styles.fallback}><ImageIcon size={22}/></span>;
}
function Avatar({ src, name, className = "" }: { src?: string | null; name: string; className?: string }) {
  return <span className={`${styles.avatar} ${className}`}>{src ? <AssetImage src={src} /> : <UserRound aria-hidden size={26}/>}</span>;
}
function BubbleBrand() {
  return <span className={styles.bubbleBrand}><i>bubble</i><img src="/lysn/bubble-heart.png" alt="" /></span>;
}
function VoiceBubble({ message, onNotice }: { message: LysnMessage; onNotice?: (text: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(false);
  const playback = useRef<ReturnType<typeof playAudioBlobViaMediaElement> | null>(null);
  useEffect(() => () => playback.current?.abort(), []);
  const play = async () => {
    if (busy || playing) { playback.current?.abort(); playback.current = null; setPlaying(false); return; }
    const config = resolveVoiceConfig(message.characterId, "lysn");
    if (!config?.enableTTS) { onNotice?.("请在配置绑定中给这个角色的 LYSN 绑定语音方案"); return; }
    unlockAudioPlayback(); setBusy(true);
    try {
      const blob = await synthesizeSpeech(message.original, config);
      if (!blob) throw new Error("语音服务没有返回音频");
      setBusy(false); setPlaying(true);
      playback.current = playAudioBlobViaMediaElement(blob);
      await playback.current.promise;
    } catch (error) { onNotice?.(error instanceof Error ? error.message : "语音播放失败"); }
    finally { setBusy(false); setPlaying(false); playback.current = null; }
  };
  return <button type="button" className={styles.voice} onClick={play} disabled={busy}><Mic2 size={17}/>{busy ? "合成中…" : playing ? "停止播放" : "播放语音"}</button>;
}
function formatDate(timestamp: number) {
  const d = new Date(timestamp);
  const y = d.getFullYear(); const m = String(d.getMonth() + 1).padStart(2, "0"); const day = String(d.getDate()).padStart(2, "0");
  return `${y}/${m}/${day}`;
}
function groupByDate(rows: LysnMessage[]) {
  const groups: Array<{ date: string; rows: LysnMessage[] }> = [];
  for (const row of [...rows].sort((a, b) => b.createdAt - a.createdAt)) {
    const date = formatDate(row.createdAt);
    const last = groups.at(-1);
    if (last?.date === date) last.rows.push(row); else groups.push({ date, rows: [row] });
  }
  return groups;
}

export function LysnApp({ onClose, onNotice }: { onClose: () => void; onNotice?: (text: string) => void }) {
  const [state, setState] = useState<LysnState>(() => loadLysn());
  const [characters, setCharacters] = useState<Character[]>(() => loadCharacters());
  const [tab, setTab] = useState<Tab>("friends");
  const [route, setRoute] = useState<Route>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [settingsReturn, setSettingsReturn] = useState<Route>(null);
  const [artistDraft, setArtistDraft] = useState<LysnProfile>({ name: "", avatar: "", cover: "", bio: "", group: "", updatedAt: 0 });
  const [userDraft, setUserDraft] = useState<LysnUserProfile>(() => loadLysn().userProfile);
  const [translatedIds, setTranslatedIds] = useState<Record<string, boolean>>({});
  const [messageActionId, setMessageActionId] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const uploadTarget = useRef<UploadTarget>("artistAvatar");
  const openRef = useRef<(id: string) => void>(() => {});
  const longPressTimer = useRef<number | null>(null);

  useEffect(() => {
    const update = () => setState(loadLysn());
    const updateCharacters = () => setCharacters(loadCharacters());
    window.addEventListener(LYSN_EVENT, update);
    window.addEventListener(CHARACTERS_UPDATED_EVENT, updateCharacters);
    const handleOpen = (event: Event) => {
      const id = (event as CustomEvent<{ characterId?: string }>).detail?.characterId;
      if (id) openRef.current(id);
    };
    window.addEventListener("lysn-open-character", handleOpen);
    return () => {
      window.removeEventListener(LYSN_EVENT, update);
      window.removeEventListener(CHARACTERS_UPDATED_EVENT, updateCharacters);
      window.removeEventListener("lysn-open-character", handleOpen);
      if (longPressTimer.current) window.clearTimeout(longPressTimer.current);
    };
  }, []);
  useEffect(() => { if (route === "chat") endRef.current?.scrollIntoView({ block: "end" }); }, [state.messages.length, route, selected]);

  const character = characters.find(c => c.id === selected);
  const profile = selected ? state.profiles[selected] : undefined;
  const displayName = character ? profile?.name || character.name : "";
  const avatar = character ? profile?.avatar || character.avatar : "";
  const messages = selected ? state.messages.filter(m => m.characterId === selected) : [];
  const mediaMessages = messages.filter(m => m.kind === "photo" || m.kind === "voice");
  const ourBoxMessages = messages.filter(m => m.sender === "artist" && state.ourBoxIds.includes(m.id));
  const subscribed = Boolean(selected && state.subscribedIds.includes(selected));
  const user = state.userProfile;
  const room = selected ? resolveLysnRoom(state, selected) : null;
  const roomTitle = room?.roomName.trim() || displayName;
  const roomUserName = room?.userNickname.trim() || user.name;
  const roomUserAvatar = room?.userAvatar || user.avatar;

  const commit = (next: LysnState) => { saveLysn(next); setState(next); };
  const updateRoom = (patch: Partial<LysnRoomSettings>) => {
    if (!selected) return;
    const next = loadLysn();
    next.roomSettings[selected] = { ...resolveLysnRoom(next, selected), ...patch };
    commit(next);
  };
  const openChat = (id: string) => {
    const current = loadLysn();
    if (!current.subscribedIds.includes(id)) return;
    current.readAt[id] = Date.now(); commit(current); setSelected(id); setRoute("chat"); setTab("chats");
  };
  openRef.current = openChat;
  const subscribe = (id: string) => {
    const next = loadLysn();
    if (next.subscribedIds.includes(id)) next.subscribedIds = next.subscribedIds.filter(x => x !== id);
    else { next.subscribedIds = [...next.subscribedIds, id]; next.subscribedAt[id] = Date.now(); }
    commit(next);
    if (!next.subscribedIds.includes(id) && route === "chat") { setRoute("artist"); setTab("friends"); }
  };
  const createArtistMessage = async (id: string, mode: "new" | "reply", fanText?: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const generated = await generateLysn(id, loadLysn().messages.filter(m => m.characterId === id), mode, fanText);
      const rows: Omit<LysnMessage, "id" | "characterId" | "createdAt">[] = [];
      for (const item of [generated, ...(generated.extra || [])]) {
        let kind = item.kind;
        let imageUrl: string | undefined;
        let photoId: string | undefined;
        if (kind === "photo") {
          const media = await resolveMediaForUse({ actor: { type: "character", characterId: id }, description: item.photoDescription || item.original, intentKind: item.mediaIntent, channel: "bubble", targetId: id, appId: "lysn" });
          if (media?.imageUrl) { imageUrl = media.imageUrl; photoId = media.photoLibraryId; }
          else { kind = "text"; onNotice?.("没有匹配到能发送的照片，已改发文字消息"); }
        }
        rows.push({ sender: "artist", kind, original: item.original, translated: item.translated, quote: item.quote, imageUrl, photoId });
      }
      if (!loadLysn().subscribedIds.includes(id)) return;
      appendLysn(id, rows);
      const next = loadLysn();
      const roomSettings = resolveLysnRoom(next, id);
      if (route === "chat" && selected === id) { next.readAt[id] = Date.now(); saveLysn(next); }
      else if (next.settings.notificationsEnabled && !roomSettings.muted) {
        const name = next.profiles[id]?.name || characters.find(c => c.id === id)?.name || "艺人";
        sendBrowserNotification(`${name} · LYSN`, { body: generated.original.slice(0, 90), url: `/#lysn=${encodeURIComponent(id)}` });
        window.dispatchEvent(new CustomEvent("lysn-message-notice", { detail: { characterId: id, body: generated.original, title: `${name} · LYSN` } }));
      }
      onNotice?.(`收到 ${rows.length} 条 Bubble 消息`);
    } catch (error) { onNotice?.(error instanceof Error ? error.message : "消息生成失败"); }
    finally { setBusy(false); }
  };
  const sendFan = () => {
    const text = draft.trim(); if (!selected || !text) return;
    appendLysn(selected, [{ sender: "fan", kind: "text", original: text }]);
    setDraft("");
  };
  const summonArtist = async () => {
    if (!selected || busy) return;
    if (draft.trim()) sendFan();
    const history = loadLysn().messages.filter(m => m.characterId === selected);
    let latestArtistIndex = -1;
    history.forEach((message, index) => { if (message.sender === "artist") latestArtistIndex = index; });
    const pending = history.slice(latestArtistIndex + 1).filter(m => m.sender === "fan").map(m => m.original);
    await createArtistMessage(selected, pending.length ? "reply" : "new", pending.join("\n"));
  };
  const toggleOurBox = (messageId: string) => {
    const next = loadLysn();
    next.ourBoxIds = next.ourBoxIds.includes(messageId) ? next.ourBoxIds.filter(id => id !== messageId) : [...next.ourBoxIds, messageId];
    commit(next); setMessageActionId(null);
  };
  const beginLongPress = (messageId: string) => {
    if (longPressTimer.current) window.clearTimeout(longPressTimer.current);
    longPressTimer.current = window.setTimeout(() => setMessageActionId(messageId), 520);
  };
  const cancelLongPress = () => {
    if (longPressTimer.current) window.clearTimeout(longPressTimer.current);
    longPressTimer.current = null;
  };

  const startArtistEdit = () => {
    if (!character) return;
    setArtistDraft({ name: displayName, avatar: avatar || "", cover: profile?.cover || "", bio: profile?.bio || "", group: profile?.group || "", updatedAt: profile?.updatedAt || 0 });
    setRoute("artistEdit");
  };
  const saveArtist = () => {
    if (!character || !selected) return;
    const next = loadLysn();
    next.profiles[selected] = { ...artistDraft, name: artistDraft.name.trim() || character.name, updatedAt: Date.now() };
    commit(next); setRoute("artist");
    appendLysn(selected, [{ sender: "system", kind: "notice", original: "艺人更新了 LYSN 资料" }]);
  };
  const startUserEdit = () => { setUserDraft({ ...loadLysn().userProfile }); setRoute("myEdit"); };
  const saveUser = () => { const next = loadLysn(); next.userProfile = { ...userDraft, name: userDraft.name.trim() || "我" }; commit(next); setRoute("myProfile"); };
  const updateSetting = (patch: Partial<LysnState["settings"]>) => { const next = loadLysn(); next.settings = { ...next.settings, ...patch }; commit(next); };
  const requestUpload = (target: UploadTarget) => { uploadTarget.current = target; uploadRef.current?.click(); };
  const handleUpload = async (file?: File) => {
    if (!file) return;
    try {
      const assetId = await saveChatImageToIndexedDB(file);
      const url = `asset://${assetId}`;
      if (uploadTarget.current === "artistAvatar") setArtistDraft(prev => ({ ...prev, avatar: url }));
      if (uploadTarget.current === "artistCover") setArtistDraft(prev => ({ ...prev, cover: url }));
      if (uploadTarget.current === "userAvatar") setUserDraft(prev => ({ ...prev, avatar: url }));
      if (uploadTarget.current === "userCover") setUserDraft(prev => ({ ...prev, cover: url }));
      if (uploadTarget.current === "roomAvatar") updateRoom({ userAvatar: url });
    } catch { onNotice?.("图片保存失败，请重新选择"); }
  };
  const back = () => {
    if (route === "artistEdit") setRoute("artist");
    else if (route === "myEdit") setRoute("myProfile");
    else if (route === "chat") setRoute(null);
    else if (route === "chatDetail") setRoute("chat");
    else if (route === "media" || route === "ourBox") setRoute("chatDetail");
    else if (route === "settings") setRoute(settingsReturn);
    else if (route === "myProfile" || route === "artist") setRoute(null);
    else onClose();
  };
  const header = (title: string, right?: ReactNode) => <header className={styles.subHeader}><button type="button" onClick={back} aria-label="返回"><ChevronLeft size={25}/></button><strong>{title}</strong><span className={styles.headerAction}>{right}</span></header>;
  const editField = (label: string, value: string, setValue: (value: string) => void, placeholder = "") => <label className={styles.field}><span>{label}</span><input value={value} placeholder={placeholder} onChange={e => setValue(e.target.value)} /></label>;
  const filteredCharacters = characters.filter(c => `${state.profiles[c.id]?.name || c.name} ${state.profiles[c.id]?.group || ""}`.toLowerCase().includes(query.toLowerCase()));
  const root = route === null;

  return <div className={styles.app}>
    <input ref={uploadRef} className={styles.hiddenInput} type="file" accept="image/*" onChange={e => { void handleUpload(e.currentTarget.files?.[0]); e.currentTarget.value = ""; }} />
    {root && <>
      <header className={styles.rootHeader}><div><h1>{tab === "friends" ? "FRIENDS" : tab === "chats" ? "CHATS" : "MORE"}</h1></div><div className={styles.rootActions}>{tab !== "more" ? <button type="button" aria-label="搜索" onClick={() => setSearchOpen(v => !v)}><Search size={23}/></button> : null}{tab === "more" ? <button type="button" aria-label="设置" onClick={() => { setSettingsReturn(null); setRoute("settings"); }}><Settings2 size={22}/></button> : null}</div></header>
      {searchOpen && tab !== "more" && <input autoFocus className={styles.searchInput} aria-label="搜索角色" placeholder="搜索艺人" value={query} onChange={e => setQuery(e.target.value)} />}
      <main className={styles.rootScroll} key={tab}>
        {tab === "friends" && <><p className={styles.sectionLabel}>我的资料</p><button type="button" className={styles.myMini} onClick={() => setRoute("myProfile")}><Avatar src={user.avatar} name={user.name}/><span><b>{user.name}</b></span><ChevronRight size={18}/></button><div className={styles.sectionRule}/><p className={styles.sectionLabel}>推荐好友 <span>{filteredCharacters.length}</span></p>{filteredCharacters.map(c => <button type="button" className={styles.friendRow} key={c.id} onClick={() => { setSelected(c.id); setRoute("artist"); }}><Avatar src={state.profiles[c.id]?.avatar || c.avatar} name={c.name}/><span><b>{state.profiles[c.id]?.name || c.name}</b><small>{state.profiles[c.id]?.bio || state.profiles[c.id]?.group || ""}</small></span><ChevronRight size={16}/></button>)}{!characters.length && <p className={styles.empty}>还没有角色，先在小手机的角色页面创建。</p>}</>}
        {tab === "chats" && <><p className={styles.sectionLabel}>最近的聊天室</p>{characters.filter(c => state.subscribedIds.includes(c.id) && filteredCharacters.some(x => x.id === c.id)).sort((a, b) => { const pa = resolveLysnRoom(state, a.id).pinned ? 1 : 0; const pb = resolveLysnRoom(state, b.id).pinned ? 1 : 0; if (pa !== pb) return pb - pa; return (state.messages.filter(m => m.characterId === b.id).at(-1)?.createdAt || 0) - (state.messages.filter(m => m.characterId === a.id).at(-1)?.createdAt || 0); }).map(c => { const rows = state.messages.filter(m => m.characterId === c.id); const last = rows.at(-1); const unread = rows.filter(m => m.sender === "artist" && m.createdAt > (state.readAt[c.id] || 0)).length; const r = resolveLysnRoom(state, c.id); return <button type="button" className={styles.chatRow} key={c.id} onClick={() => openChat(c.id)}><Avatar src={state.profiles[c.id]?.avatar || c.avatar} name={c.name}/><span><b>{r.roomName || state.profiles[c.id]?.name || c.name}</b><small>{last?.original || "还没有消息"}</small></span><aside><time>{last ? new Date(last.createdAt).toLocaleDateString() : ""}</time>{unread > 0 && <i>{unread}</i>}</aside></button>; })}{!state.subscribedIds.length && <p className={styles.empty}>还没有聊天。到 FRIENDS 选择一位艺人，添加 bubble 好友。</p>}</>}
        {tab === "more" && <><button type="button" className={styles.moreProfile} onClick={() => setRoute("myProfile")}><Avatar src={user.avatar} name={user.name}/><b>{user.name}</b><small>编辑我的 LYSN 资料</small></button><div className={styles.sectionRule}/><button type="button" className={styles.moreRow} onClick={() => setRoute("myProfile")}><UserRound size={21}/>我的资料<ChevronRight size={19}/></button><button type="button" className={styles.moreRow} onClick={() => { setSettingsReturn(null); setRoute("settings"); }}><Settings2 size={21}/>设置<ChevronRight size={19}/></button><button type="button" className={styles.moreRow} onClick={onClose}><X size={21}/>返回桌面<ChevronRight size={19}/></button></>}
      </main>
      <nav className={styles.bottomNav} aria-label="LYSN 导航">{(["friends", "chats", "more"] as const).map(item => <button type="button" key={item} className={tab === item ? styles.activeTab : ""} onClick={() => { setTab(item); setSearchOpen(false); setQuery(""); }} aria-label={item === "friends" ? "好友" : item === "chats" ? "聊天" : "我的"}>{item === "friends" ? <UserRound size={24}/> : item === "chats" ? <MessageCircle size={24}/> : <MoreHorizontal size={25}/>}<small>{item === "friends" ? "好友" : item === "chats" ? "聊天" : "我的"}</small></button>)}</nav>
    </>}

    {route === "artist" && character && <div className={styles.fullProfile}>{profile?.cover ? <AssetImage src={profile.cover} className={styles.coverImage}/> : <div className={styles.coverFallback}/>}<div className={styles.coverShade}/><button type="button" className={styles.coverBack} onClick={back} aria-label="返回"><X size={29}/></button><button type="button" className={styles.coverEdit} onClick={startArtistEdit} aria-label="编辑艺人资料"><Settings2 size={21}/></button><div className={styles.profileIdentity}><Avatar src={avatar} name={displayName} className={styles.largeAvatar}/><h2><span className={styles.artistPill}>ARTIST</span>{displayName}</h2><p>{profile?.bio || ""}</p>{profile?.group && <span className={styles.groupPill}>{profile.group} · {character.name}</span>}</div><div className={styles.profileFooter}><button type="button" onClick={() => subscribed ? openChat(character.id) : subscribe(character.id)}>{subscribed ? "进入 bubble 聊天" : "添加 bubble 好友"}</button></div></div>}

    {route === "chat" && character && <><header className={styles.chatHeader}><button type="button" aria-label="返回聊天室列表" onClick={back}><ChevronLeft size={25}/></button><div><strong>{roomTitle}</strong><BubbleBrand/></div><button type="button" aria-label="聊天详情" onClick={() => setRoute("chatDetail")}><MoreHorizontal size={22}/></button></header><main className={styles.messages}>{messages.length ? messages.map(m => {
      const hasTranslation = m.sender === "artist" && Boolean(m.translated && m.translated !== m.original);
      const showTranslation = Boolean(translatedIds[m.id]);
      return <div key={m.id} className={`${styles.message} ${m.sender === "fan" ? styles.mine : ""}`}>
        {m.sender === "system" ? <span className={styles.system}>{m.original}</span> : <>{m.sender === "artist" && <Avatar src={avatar} name={displayName} className={styles.messageAvatar}/>}<div className={styles.messageBody}>{m.sender === "artist" && <div className={styles.senderLine}><span className={styles.artistPill}>ARTIST</span><b>{displayName}</b></div>}{m.sender === "artist" && m.quote && <div className={styles.quoteCard}><span>ARTIST 的回复：</span><p>{m.quote.original}</p>{m.quote.translated && m.quote.translated !== m.quote.original && <small>{m.quote.translated}</small>}</div>}<div className={`${styles.bubble} ${state.ourBoxIds.includes(m.id) ? styles.savedBubble : ""}`} onPointerDown={() => m.sender === "artist" && beginLongPress(m.id)} onPointerUp={cancelLongPress} onPointerCancel={cancelLongPress} onPointerLeave={cancelLongPress} onContextMenu={e => { if (m.sender === "artist") { e.preventDefault(); setMessageActionId(m.id); } }}>{m.kind === "photo" && m.imageUrl ? <AssetImage src={m.imageUrl} className={styles.photo}/> : null}{m.kind === "voice" && <VoiceBubble message={m} onNotice={onNotice}/>}<p>{hasTranslation && showTranslation && state.settings.translationMode === "replace" ? m.translated : m.original}</p>{hasTranslation && showTranslation && state.settings.translationMode === "fold" && <small className={styles.translation}>{m.translated}</small>}</div></div><div className={styles.messageMeta}><time>{new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>{hasTranslation && <button type="button" className={showTranslation ? styles.translatedButton : styles.translateButton} onClick={() => setTranslatedIds(prev => ({ ...prev, [m.id]: !prev[m.id] }))} aria-label={showTranslation ? "收起翻译" : "显示翻译"} title={state.settings.translationMode === "replace" ? "切换原文/中文" : "展开/收起中文"}>A</button>}</div></>}
      </div>;
    }) : <div className={styles.empty}>还没有消息。点右下角小飞机可以生成第一条艺人消息。</div>}<div ref={endRef}/></main><form className={styles.composer} onSubmit={e => { e.preventDefault(); void summonArtist(); }}><textarea rows={1} aria-label="回复艺人" placeholder="输入消息，回车发送…" value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); sendFan(); } }} /><button type="submit" disabled={busy} aria-label="召唤艺人回复" title="召唤艺人回复"><Send size={21}/></button></form></>}

    {route === "chatDetail" && character && room && <>{header("聊天详情")}<main className={styles.detailScroll}><section className={styles.detailHero}><div className={styles.detailArtist}><Avatar src={avatar} name={displayName} className={styles.detailArtistAvatar}/><div><div className={styles.detailName}><span className={styles.artistPill}>ARTIST</span><b>{displayName}</b></div><small>{state.subscribedAt[selected || ""] ? `${formatDate(state.subscribedAt[selected || ""])} 开始订阅` : "已订阅"}</small></div></div><div className={styles.detailUser}><Avatar src={roomUserAvatar} name={roomUserName}/><div><b>{roomUserName}</b><small>当前聊天室个人资料</small></div></div><button type="button" className={styles.ourBoxButton} onClick={() => setRoute("ourBox")}><Heart size={22} fill="currentColor"/>OUR BOX</button></section>
      <h3 className={styles.detailSectionTitle}>聊天</h3><section className={styles.detailCard}><button type="button" className={styles.detailRow} onClick={() => setRoute("media")}><span><ImageIcon size={20}/>图片和音频</span><small>{mediaMessages.length ? `${mediaMessages.length} 项` : ""}</small><ChevronRight size={21}/></button><div className={styles.detailRowStatic}><span>翻译设置</span><div className={styles.segment}><button type="button" className={state.settings.translationMode === "fold" ? styles.segmentActive : ""} onClick={() => updateSetting({ translationMode: "fold" })}>折叠翻译</button><button type="button" className={state.settings.translationMode === "replace" ? styles.segmentActive : ""} onClick={() => updateSetting({ translationMode: "replace" })}>覆盖原文</button></div></div></section>
      <div className={styles.detailSectionHead}><h3>聊天室设置</h3><small>仅当前聊天室生效</small></div><section className={styles.detailCard}><button type="button" className={styles.detailRow} onClick={() => requestUpload("roomAvatar")}><span>个人头像</span><Avatar src={roomUserAvatar} name={roomUserName} className={styles.roomAvatar}/><ChevronRight size={21}/></button><label className={styles.detailInputRow}><span><b>我的昵称</b><small>设置艺人对您的爱称</small></span><input value={room.userNickname} placeholder={user.name} onChange={e => updateRoom({ userNickname: e.target.value })}/></label><label className={styles.detailInputRow}><span><b>聊天室名称</b></span><input value={room.roomName} placeholder={displayName} onChange={e => updateRoom({ roomName: e.target.value })}/></label><label className={styles.switchRow}><span>置顶聊天</span><input type="checkbox" checked={room.pinned} onChange={e => updateRoom({ pinned: e.target.checked })}/></label><label className={styles.switchRow}><span>消息免打扰</span><input type="checkbox" checked={room.muted} onChange={e => updateRoom({ muted: e.target.checked })}/></label><label className={styles.switchRow}><span><b>多图折叠展示</b><small>开启后连续多张图片自动折叠展示</small></span><input type="checkbox" checked={room.collapseMedia} onChange={e => updateRoom({ collapseMedia: e.target.checked })}/></label></section>
    </main></>}

    {route === "media" && character && <>{header("图片和音频")}<main className={styles.archiveScroll}>{mediaMessages.length ? groupByDate(mediaMessages).map(group => <section key={group.date} className={styles.archiveGroup}><time>{group.date}</time><div className={styles.mediaGrid}>{group.rows.map(m => m.kind === "photo" && m.imageUrl ? <button type="button" className={styles.mediaPhoto} key={m.id}><AssetImage src={m.imageUrl}/></button> : <div className={styles.mediaVoice} key={m.id}><b>{m.sender === "artist" ? displayName : roomUserName}</b><Avatar src={m.sender === "artist" ? avatar : roomUserAvatar} name={m.sender === "artist" ? displayName : roomUserName}/><VoiceBubble message={m} onNotice={onNotice}/></div>)}</div></section>) : <div className={styles.empty}>这里会自动收纳当前聊天室里的所有图片和语音。</div>}</main></>}

    {route === "ourBox" && character && <>{header("OUR BOX")}<main className={styles.archiveScroll}>{ourBoxMessages.length ? groupByDate(ourBoxMessages).map(group => <section key={group.date} className={styles.archiveGroup}><time>{group.date}</time><div className={styles.ourBoxList}>{group.rows.map(m => <article className={styles.savedCard} key={m.id}><header><Avatar src={avatar} name={displayName}/><div><span className={styles.artistPill}>ARTIST</span><b>{displayName}</b></div><button type="button" aria-label="取消收藏" onClick={() => toggleOurBox(m.id)}><Bookmark size={18} fill="currentColor"/></button></header>{m.quote && <div className={styles.savedQuote}><p>{m.quote.original}</p>{m.quote.translated && m.quote.translated !== m.quote.original && <small>{m.quote.translated}</small>}</div>}{m.kind === "photo" && m.imageUrl && <AssetImage src={m.imageUrl} className={styles.savedPhoto}/>}<p>{m.original}</p>{m.kind === "voice" && <VoiceBubble message={m} onNotice={onNotice}/>}{m.translated && m.translated !== m.original && <small className={styles.savedTranslation}>{m.translated}</small>}<time>{new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time></article>)}</div></section>) : <div className={styles.empty}>长按对方消息气泡并收藏后，会出现在这里。</div>}</main></>}

    {route === "artistEdit" && character && <>{header("编辑艺人资料", <button type="button" onClick={saveArtist}>保存</button>)}<main className={styles.editScroll}><div className={styles.editCover}>{artistDraft.cover ? <AssetImage src={artistDraft.cover} className={styles.coverImage}/> : <div className={styles.coverFallback}/>}<button type="button" className={styles.editCoverButton} onClick={() => requestUpload("artistCover")}><Camera size={18}/>更换背景</button><button type="button" className={styles.editAvatarButton} onClick={() => requestUpload("artistAvatar")}><Avatar src={artistDraft.avatar} name={artistDraft.name} className={styles.editAvatar}/><Camera size={17}/></button></div><div className={styles.fields}>{editField("LYSN 昵称", artistDraft.name, value => setArtistDraft(prev => ({ ...prev, name: value })))}{editField("简介", artistDraft.bio || "", value => setArtistDraft(prev => ({ ...prev, bio: value })))}{editField("组合 / 所属", artistDraft.group || "", value => setArtistDraft(prev => ({ ...prev, group: value })))}{editField("头像图片链接（可选）", artistDraft.avatar, value => setArtistDraft(prev => ({ ...prev, avatar: value })))}{editField("背景图片链接（可选）", artistDraft.cover || "", value => setArtistDraft(prev => ({ ...prev, cover: value })))}<p>这里仅修改 LYSN 的显示资料，不影响 Chat 或 WVS。</p><button type="button" className={styles.primaryButton} onClick={saveArtist}>保存艺人资料</button></div></main></>}
    {route === "myProfile" && <div className={styles.fullProfile}>{user.cover ? <AssetImage src={user.cover} className={styles.coverImage}/> : <div className={styles.coverFallback}/>}<div className={styles.coverShade}/><button type="button" className={styles.coverBack} onClick={back} aria-label="返回"><X size={29}/></button><div className={styles.profileIdentity}><Avatar src={user.avatar} name={user.name} className={styles.largeAvatar}/><h2>{user.name}</h2><button type="button" className={styles.profileEditButton} onClick={startUserEdit}><Settings2 size={20}/>编辑个人资料</button></div></div>}
    {route === "myEdit" && <>{header("编辑个人资料", <button type="button" onClick={saveUser}>保存</button>)}<main className={styles.editScroll}><div className={styles.editCover}>{userDraft.cover ? <AssetImage src={userDraft.cover} className={styles.coverImage}/> : <div className={styles.coverFallback}/>}<button type="button" className={styles.editCoverButton} onClick={() => requestUpload("userCover")}><Camera size={18}/>更换背景</button><button type="button" className={styles.editAvatarButton} onClick={() => requestUpload("userAvatar")}><Avatar src={userDraft.avatar} name={userDraft.name} className={styles.editAvatar}/><Camera size={17}/></button></div><div className={styles.fields}>{editField("昵称", userDraft.name, value => setUserDraft(prev => ({ ...prev, name: value })))}{editField("生日（可选）", userDraft.birthday, value => setUserDraft(prev => ({ ...prev, birthday: value })))}{editField("性别（可选）", userDraft.gender, value => setUserDraft(prev => ({ ...prev, gender: value })))}<button type="button" className={styles.primaryButton} onClick={saveUser}>保存个人资料</button></div></main></>}
    {route === "settings" && <>{header("设置")}<main className={styles.settingsScroll}><h3>基本信息</h3><button type="button" className={styles.settingRow} onClick={startUserEdit}><Avatar src={user.avatar} name={user.name}/><span>{user.name}</span><small>编辑个人资料</small><ChevronRight size={18}/></button><h3>通知</h3><label className={styles.settingRow}><Bell size={20}/><span>LYSN 新消息通知</span><input type="checkbox" checked={state.settings.notificationsEnabled} onChange={e => updateSetting({ notificationsEnabled: e.target.checked })}/></label><h3>翻译</h3><div className={styles.settingChoice}><button type="button" className={state.settings.translationMode === "fold" ? styles.choiceActive : ""} onClick={() => updateSetting({ translationMode: "fold" })}>折叠翻译</button><button type="button" className={state.settings.translationMode === "replace" ? styles.choiceActive : ""} onClick={() => updateSetting({ translationMode: "replace" })}>覆盖原文</button></div><p className={styles.settingHint}>艺人引用里的被引用消息固定展开翻译；艺人正文仍按这里选择的模式显示。</p></main></>}

    {messageActionId && <div className={styles.overlay} onMouseDown={e => { if (e.target === e.currentTarget) setMessageActionId(null); }}><section className={styles.sheet}><header><b>消息操作</b><button type="button" onClick={() => setMessageActionId(null)} aria-label="关闭"><X size={19}/></button></header><button type="button" onClick={() => toggleOurBox(messageActionId)}><Bookmark size={18}/>{state.ourBoxIds.includes(messageActionId) ? "从 OUR BOX 移除" : "收藏到 OUR BOX"}</button></section></div>}
  </div>;
}
