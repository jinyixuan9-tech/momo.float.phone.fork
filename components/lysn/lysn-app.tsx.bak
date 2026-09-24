"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Bell, Bookmark, Camera, Check, ChevronLeft, ChevronRight, Heart, Image as ImageIcon, LoaderCircle, MessageCircle, Mic2, MoreHorizontal, Search, Send, Settings2, Smile, UserRound, X } from "lucide-react";
import { loadCharacters, CHARACTERS_UPDATED_EVENT } from "@/lib/character-storage";
import type { Character } from "@/lib/character-types";
import { getChatImageFromIndexedDB, saveChatImageToIndexedDB } from "@/lib/chat-asset-storage";
import { sendBrowserNotification } from "@/lib/browser-notification";
import { resolveVoiceConfig, synthesizeSpeech, playAudioBlobViaMediaElement, unlockAudioPlayback } from "@/lib/tts-service";
import { generateLysn } from "@/lib/lysn-engine";
import { prepareLysnMessages } from "@/lib/lysn-message";
import { maybeCelebrateLysn } from "@/lib/lysn-celebrations";
import { appendLysn, countReplyCharacters, loadLysn, localDay, lysnId, remainingFanReplies, replyCharacterLimit, saveLysn, subscriptionDays, LYSN_EVENT, type LysnMessage, type LysnProfile, type LysnRoom, type LysnState, type LysnStickerPack, type LysnUserProfile } from "@/lib/lysn-storage";
import styles from "./lysn-app.module.css";

type Tab = "friends" | "chats" | "more";
type Route = "artist" | "chat" | "details" | "ourBox" | "media" | "stickers" | "stickerPack" | "artistEdit" | "myProfile" | "myEdit" | "settings" | null;
type UploadTarget = "artistAvatar" | "artistCover" | "userAvatar" | "userCover" | "roomAvatar" | "sticker";
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
  return <span className={`${styles.avatar} ${className}`}>{src ? <AssetImage src={src} /> : <UserRound aria-label={name} size={26}/>}</span>;
}
function VoiceBubble({ message, onNotice }: { message: LysnMessage; onNotice?: (text: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(false);
  const playback = useRef<ReturnType<typeof playAudioBlobViaMediaElement> | null>(null);
  useEffect(() => () => playback.current?.abort(), []);
  const play = async () => {
    if (busy || playing) { playback.current?.abort(); playback.current = null; setPlaying(false); return; }
    const config = resolveVoiceConfig(message.characterId, "lysn");
    if (!config?.enableTTS) { onNotice?.("请先在配置绑定中给这位艺人的 LYSN 配置语音方案"); return; }
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
function BubbleDays({ days }: { days: number }) {
  return <span className={styles.bubbleDays}><em>bubble</em><span className={styles.twoHearts} aria-label="爱心"><i/><i/></span><b>+ {days}</b></span>;
}
function PhotoStack({ rows, onOpen }: { rows: LysnMessage[]; onOpen: (url: string) => void }) {
  const [active, setActive] = useState(0);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (expanded || rows.length < 2) return;
    const timer = window.setInterval(() => setActive(index => (index + 1) % rows.length), 1900);
    return () => clearInterval(timer);
  }, [expanded, rows.length]);
  if (expanded) return <div className={styles.photoExpanded}>{rows.map(row => <button type="button" key={row.id} onClick={() => row.imageUrl && onOpen(row.imageUrl)}><AssetImage src={row.imageUrl || ""}/></button>)}<button type="button" className={styles.stackToggle} onClick={() => setExpanded(false)}>收起</button></div>;
  return <div className={styles.stackWrap}><button type="button" className={styles.photoStack} onClick={() => setExpanded(true)} aria-label={`展开 ${rows.length} 张图片`}><span className={styles.stackBack}/><span className={styles.stackMiddle}/><AssetImage src={rows[active]?.imageUrl || ""}/></button><button type="button" className={styles.stackToggle} onClick={() => setExpanded(true)}>展开 ›</button></div>;
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
  const [opening, setOpening] = useState<string | null>(null);
  const [roomSheet, setRoomSheet] = useState(false);
  const [settingsReturn, setSettingsReturn] = useState<Route>(null);
  const [userEditReturn, setUserEditReturn] = useState<Route>("myProfile");
  const [artistReturn, setArtistReturn] = useState<Route>(null);
  const [detailsReturn, setDetailsReturn] = useState<Route>("chat");
  const [artistDraft, setArtistDraft] = useState<LysnProfile>({ name: "", avatar: "", cover: "", bio: "", group: "", updatedAt: 0 });
  const [userDraft, setUserDraft] = useState<LysnUserProfile>(() => loadLysn().userProfile);
  const [translatedIds, setTranslatedIds] = useState<Record<string, boolean>>({});
  const [activePackId, setActivePackId] = useState<string | null>(null);
  const [stickerName, setStickerName] = useState("");
  const [stickerUrl, setStickerUrl] = useState("");
  const [stickerPackName, setStickerPackName] = useState("");
  const [viewerUrl, setViewerUrl] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const uploadTarget = useRef<UploadTarget>("artistAvatar");
  const openRef = useRef<(id: string) => void>(() => {});
  const openingRef = useRef<Set<string>>(new Set());
  const touchTimer = useRef<number | null>(null);
  const lastTouchFavorite = useRef(0);
  useEffect(() => {
    const update = () => setState(loadLysn());
    const updateCharacters = () => setCharacters(loadCharacters());
    window.addEventListener(LYSN_EVENT, update);
    window.addEventListener(CHARACTERS_UPDATED_EVENT, updateCharacters);
    const handleOpen = (event: Event) => { const id = (event as CustomEvent<{ characterId?: string }>).detail?.characterId; if (id) openRef.current(id); };
    window.addEventListener("lysn-open-character", handleOpen);
    return () => { window.removeEventListener(LYSN_EVENT, update); window.removeEventListener(CHARACTERS_UPDATED_EVENT, updateCharacters); window.removeEventListener("lysn-open-character", handleOpen); };
  }, []);
  useEffect(() => { if (route === "chat") endRef.current?.scrollIntoView({ block: "end" }); }, [state.messages.length, route, selected]);
  const character = characters.find(c => c.id === selected);
  const profile = selected ? state.profiles[selected] : undefined;
  const room = selected ? state.rooms[selected] || {} : {};
  const displayName = character ? profile?.name || character.name : "";
  const roomName = room.chatName?.trim() || displayName;
  const avatar = character ? profile?.avatar || character.avatar : "";
  const messages = selected ? state.messages.filter(m => m.characterId === selected) : [];
  const subscribed = Boolean(selected && state.subscribedIds.includes(selected));
  const user = state.userProfile;
  const days = selected ? subscriptionDays(state, selected) : 1;
  const limit = replyCharacterLimit(days);
  const remaining = selected ? remainingFanReplies(state, selected) : 3;
  const showName = (value: string) => value.replaceAll("{{nickname}}", room.nickname?.trim() || user.name);
  const commit = (next: LysnState) => { saveLysn(next); setState(next); };
  const updateRoom = (patch: Partial<LysnRoom>) => {
    if (!selected) return;
    const next = loadLysn(); next.rooms[selected] = { ...next.rooms[selected], ...patch }; commit(next);
  };
  const openChat = (id: string) => {
    const current = loadLysn(); if (!current.subscribedIds.includes(id)) return;
    current.readAt[id] = Date.now(); commit(current); setSelected(id); setRoute("chat"); setTab("chats");
    const latest = loadLysn();
    if (!latest.rooms[id]?.openerShown && !openingRef.current.has(id)) {
      openingRef.current.add(id); setOpening(id);
      const configured = latest.rooms[id]?.openerText?.trim();
      const firstMessage = configured ? Promise.resolve([{ kind: "text" as const, original: configured, translated: configured }]) : generateLysn(id, latest.messages.filter(m => m.characterId === id), "opening");
      void firstMessage.then(async generated => {
        if (!loadLysn().subscribedIds.includes(id) || !generated.length) return;
        const latestState = loadLysn();
        if (latestState.rooms[id]?.openerShown) return;
        // Claim the opener before appending, preventing a second entry from issuing another API call.
        latestState.rooms[id] = { ...latestState.rooms[id], openerShown: true }; saveLysn(latestState);
        appendLysn(id, (await prepareLysnMessages(id, generated)).map(row => ({ ...row, opener: true })));
      }).catch(error => onNotice?.(error instanceof Error ? `开场白生成失败：${error.message}` : "开场白生成失败，可重新进入聊天室重试"))
        .finally(() => { openingRef.current.delete(id); setOpening(null); if (loadLysn().subscribedIds.includes(id) && loadLysn().rooms[id]?.openerShown) void maybeCelebrateLysn(id); });
    } else if (latest.rooms[id]?.openerShown) void maybeCelebrateLysn(id);
  };
  openRef.current = openChat;
  const subscribe = (id: string) => {
    const next = loadLysn();
    if (next.subscribedIds.includes(id)) next.subscribedIds = next.subscribedIds.filter(x => x !== id);
    else {
      const firstSubscription = !next.subscribedAt[id];
      next.subscribedIds = [...next.subscribedIds, id]; next.subscribedAt[id] = Date.now();
      next.rooms[id] = { ...next.rooms[id], subscriptionDate: firstSubscription ? next.rooms[id]?.subscriptionDate || localDay(new Date()) : localDay(new Date()), openerShown: false, anniversariesShown: [], foldPhotos: next.rooms[id]?.foldPhotos ?? true };
    }
    commit(next);
    if (!next.subscribedIds.includes(id)) { setRoomSheet(false); setArtistReturn(null); setRoute("artist"); setTab("friends"); }
    else openChat(id);
  };
  const summonArtist = async () => {
    if (!selected || busy) return;
    const id = selected;
    if (draft.trim() && !sendFan()) return;
    setBusy(true);
    try {
      const history = loadLysn().messages.filter(m => m.characterId === id);
      let latestArtistIndex = -1;
      history.forEach((message, index) => { if (message.sender === "artist" && !message.opener) latestArtistIndex = index; });
      const pending = history.slice(latestArtistIndex + 1).filter(m => m.sender === "fan").map(m => m.original);
      const generated = await generateLysn(id, history, pending.length ? "reply" : "new", pending.join("\n"));
      if (!generated.length) { onNotice?.("艺人暂时没有公开发消息"); return; }
      const rows = await prepareLysnMessages(id, generated);
      if (!loadLysn().subscribedIds.includes(id)) return;
      appendLysn(id, rows);
      const latest = loadLysn();
      if (route === "chat" && selected === id) { latest.readAt[id] = Date.now(); saveLysn(latest); }
      else if (latest.settings.notificationsEnabled && !latest.rooms[id]?.muted) {
        const name = latest.rooms[id]?.chatName || latest.profiles[id]?.name || character?.name || "艺人";
        sendBrowserNotification(`${name} · LYSN`, { body: generated[0].original.slice(0, 90), url: `/#lysn=${encodeURIComponent(id)}` });
      }
      onNotice?.(`收到 ${rows.length} 条 Bubble 消息`);
    } catch (error) { onNotice?.(error instanceof Error ? error.message : "消息生成失败"); }
    finally { setBusy(false); }
  };
  const sendFan = (): boolean => {
    const text = draft.trim(); if (!selected || !text) return false;
    const latest = loadLysn();
    if (latest.settings.deepRealism) {
      if (remainingFanReplies(latest, selected) <= 0) { onNotice?.("已发满三条，等艺人发消息或满一天后可继续发送"); return false; }
      const maximum = replyCharacterLimit(subscriptionDays(latest, selected));
      if (countReplyCharacters(text) > maximum) { onNotice?.(`本聊天室当前每条最多 ${maximum} 字`); return false; }
    }
    appendLysn(selected, [{ sender: "fan", kind: "text", original: text }]); setDraft(""); return true;
  };
  const startArtistEdit = () => {
    if (!character) return;
    setArtistDraft({ name: displayName, avatar: avatar || "", cover: profile?.cover || "", bio: profile?.bio || "", group: profile?.group || "", updatedAt: profile?.updatedAt || 0 });
    setRoute("artistEdit");
  };
  const saveArtist = () => {
    if (!character || !selected) return;
    const next = loadLysn(); next.profiles[selected] = { ...artistDraft, name: artistDraft.name.trim() || character.name, updatedAt: Date.now() };
    commit(next); setRoute("artist");
  };
  const startUserEdit = () => { setUserEditReturn(route); setUserDraft({ ...loadLysn().userProfile }); setRoute("myEdit"); };
  const saveUser = () => { const next = loadLysn(); next.userProfile = { ...userDraft, name: userDraft.name.trim() || "我" }; commit(next); setRoute(userEditReturn === "settings" ? "settings" : "myProfile"); };
  const updateSetting = (patch: Partial<LysnState["settings"]>) => { const next = loadLysn(); next.settings = { ...next.settings, ...patch }; commit(next); };
  const requestUpload = (target: UploadTarget) => { uploadTarget.current = target; uploadRef.current?.click(); };
  const handleUpload = async (file?: File) => {
    if (!file) return;
    try {
      const assetId = await saveChatImageToIndexedDB(file); const url = `asset://${assetId}`;
      if (uploadTarget.current === "artistAvatar") setArtistDraft(prev => ({ ...prev, avatar: url }));
      if (uploadTarget.current === "artistCover") setArtistDraft(prev => ({ ...prev, cover: url }));
      if (uploadTarget.current === "userAvatar") setUserDraft(prev => ({ ...prev, avatar: url }));
      if (uploadTarget.current === "userCover") setUserDraft(prev => ({ ...prev, cover: url }));
      if (uploadTarget.current === "roomAvatar") updateRoom({ avatar: url });
      if (uploadTarget.current === "sticker" && activePackId) addSticker(file.name.replace(/\.[^.]+$/, ""), url);
    } catch { onNotice?.("图片保存失败，请重新选择"); }
  };
  const updatePacks = (packs: LysnStickerPack[]) => updateRoom({ stickerPacks: packs });
  const addSticker = (name: string, imageUrl: string) => {
    if (!selected || !activePackId || !name.trim() || !imageUrl.trim()) return;
    const packs = (loadLysn().rooms[selected]?.stickerPacks || []).map(pack => pack.id === activePackId ? { ...pack, stickers: [...pack.stickers, { id: lysnId(), name: name.trim(), imageUrl: imageUrl.trim() }] } : pack);
    updatePacks(packs); setStickerName(""); setStickerUrl("");
  };
  const toggleFavorite = (id: string) => {
    const saved = room.favoriteMessageIds || [];
    updateRoom({ favoriteMessageIds: saved.includes(id) ? saved.filter(x => x !== id) : [...saved, id] });
    onNotice?.(saved.includes(id) ? "已从 OUR BOX 移除" : "已收藏到 OUR BOX");
  };
  const back = () => {
    if (viewerUrl) { setViewerUrl(""); return; }
    if (roomSheet) { setRoomSheet(false); return; }
    if (route === "stickerPack") setRoute("stickers");
    else if (route === "stickers") { setRoute("details"); setRoomSheet(true); }
    else if (route === "ourBox" || route === "media") setRoute("details");
    else if (route === "details") setRoute(detailsReturn);
    else if (route === "artistEdit") setRoute("artist");
    else if (route === "myEdit") setRoute(userEditReturn);
    else if (route === "chat") setRoute(null);
    else if (route === "settings") setRoute(settingsReturn);
    else if (route === "myProfile") setRoute(null);
    else if (route === "artist") setRoute(artistReturn);
    else if (tab !== "more") setTab("more");
    else onClose();
  };
  const header = (title: string, right?: ReactNode) => <header className={styles.subHeader}><button type="button" onClick={back} aria-label="返回"><ChevronLeft size={25}/></button><strong>{title}</strong><span className={styles.headerAction}>{right}</span></header>;
  const editField = (label: string, value: string, setValue: (value: string) => void, placeholder = "") => <label className={styles.field}><span>{label}</span><input value={value} placeholder={placeholder} onChange={e => setValue(e.target.value)} /></label>;
  const imageLinkField = (label: string, value: string, setValue: (value: string) => void) => <label className={styles.field}><span>{label}</span><input value={value.startsWith("asset://") || value.startsWith("data:") ? "" : value} placeholder={value ? "已上传图片；粘贴链接可替换" : "粘贴图片 URL"} onChange={e => setValue(e.target.value)} /></label>;
  const filteredCharacters = characters.filter(c => `${state.profiles[c.id]?.name || c.name} ${state.profiles[c.id]?.group || ""}`.toLowerCase().includes(query.toLowerCase()));
  const root = route === null;
  const messageItems: Array<LysnMessage | LysnMessage[]> = [];
  for (const message of messages) {
    const previous = messageItems.at(-1);
    if (room.foldPhotos !== false && message.sender === "artist" && message.kind === "photo" && message.imageUrl && previous) {
      const last = Array.isArray(previous) ? previous.at(-1) : previous;
      if (last?.sender === "artist" && last.kind === "photo" && last.imageUrl && !last.quote && !message.quote && message.createdAt - last.createdAt < 120000) {
        if (Array.isArray(previous)) previous.push(message);
        else messageItems[messageItems.length - 1] = [previous, message];
        continue;
      }
    }
    messageItems.push(message);
  }
  const renderMessage = (item: LysnMessage | LysnMessage[]) => {
    if (Array.isArray(item)) return <div key={item[0].id} className={styles.message}><Avatar src={avatar} name={roomName} className={styles.messageAvatar}/><div className={styles.messageBody}><div className={styles.senderLine}><span className={styles.artistPill}>ARTIST</span><b>{displayName}</b></div><PhotoStack rows={item} onOpen={setViewerUrl}/></div><div className={styles.messageMeta}><time>{new Date(item.at(-1)!.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time></div></div>;
    const m = item;
    if (m.sender === "system") return <div key={m.id} className={styles.message}><span className={styles.system}>{m.original}</span></div>;
    const hasTranslation = m.sender === "artist" && Boolean(m.translated && m.translated !== m.original);
    const showTranslation = Boolean(translatedIds[m.id]);
    return <div key={m.id} className={`${styles.message} ${m.sender === "fan" ? styles.mine : ""}`}
      onContextMenu={e => { if (m.sender === "artist") { e.preventDefault(); if (Date.now() - lastTouchFavorite.current > 1000) toggleFavorite(m.id); } }}
      onTouchStart={() => { if (m.sender === "artist") touchTimer.current = window.setTimeout(() => { touchTimer.current = null; lastTouchFavorite.current = Date.now(); toggleFavorite(m.id); }, 600); }}
      onTouchEnd={() => { if (touchTimer.current) window.clearTimeout(touchTimer.current); touchTimer.current = null; }}
      onTouchMove={() => { if (touchTimer.current) window.clearTimeout(touchTimer.current); touchTimer.current = null; }}>
      {m.sender === "artist" && <Avatar src={avatar} name={roomName} className={styles.messageAvatar}/>}
      <div className={styles.messageBody}>
        {m.sender === "artist" && <div className={styles.senderLine}><span className={styles.artistPill}>ARTIST</span><b>{displayName}</b>{m.opener && <small className={styles.openingTag}>开场白</small>}</div>}
        {m.quote && <div className={styles.quoteBubble}><span>ARTIST 的回复：</span><p>{showName(m.quote.original)}</p><small>{showName(m.quote.translated)}</small></div>}
        <div className={styles.bubble}>
          {m.kind === "photo" && m.imageUrl && <button type="button" className={styles.photoButton} onClick={() => setViewerUrl(m.imageUrl || "")}><AssetImage src={m.imageUrl} className={styles.photo}/></button>}
          {m.kind === "sticker" && m.imageUrl && <AssetImage src={m.imageUrl} className={styles.stickerBubble}/>}
          {m.kind === "voice" && <VoiceBubble message={m} onNotice={onNotice}/>}
          {m.kind !== "sticker" && <p>{showName(hasTranslation && showTranslation && state.settings.translationMode === "replace" ? m.translated || m.original : m.original)}</p>}
          {hasTranslation && showTranslation && state.settings.translationMode === "fold" && <small className={styles.translation}>{showName(m.translated || "")}</small>}
        </div>
      </div>
      <div className={styles.messageMeta}><time>{new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
        {hasTranslation && <button type="button" className={showTranslation ? styles.translatedButton : styles.translateButton} onClick={() => setTranslatedIds(prev => ({ ...prev, [m.id]: !prev[m.id] }))} aria-label={showTranslation ? "显示原文" : "显示翻译"}>A</button>}
        {m.sender === "fan" && <button type="button" className={styles.translateButton} aria-label="翻译我发送的消息" onClick={() => onNotice?.(state.settings.translationApiUrl && state.settings.translationApiKey ? "翻译 API 的请求格式还未提供；配置已保存，接入后即可使用" : "请先在我的设置中填写翻译 API")}>A</button>}
      </div>
    </div>;
  };
  const settingsSwitch = (label: string, checked: boolean, onChange: (value: boolean) => void, hint?: string) => <label className={styles.settingRow}><span>{label}{hint && <small className={styles.rowHint}>{hint}</small>}</span><input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)}/></label>;

  return <div className={styles.app} data-root={root ? "true" : undefined}>
    <input ref={uploadRef} className={styles.hiddenInput} type="file" accept="image/*" onChange={e => { void handleUpload(e.currentTarget.files?.[0]); e.currentTarget.value = ""; }} />
    {root && <>
      <header className={styles.rootHeader}><h1>{tab === "friends" ? "FRIENDS" : tab === "chats" ? "CHATS" : "MORE"}</h1><div className={styles.rootActions}>{tab !== "more" ? <button type="button" aria-label="搜索" onClick={() => setSearchOpen(v => !v)}><Search size={23}/></button> : <button type="button" aria-label="设置" onClick={() => { setSettingsReturn(null); setRoute("settings"); }}><Settings2 size={22}/></button>}</div></header>
      {searchOpen && tab !== "more" && <input autoFocus className={styles.searchInput} aria-label="搜索角色" placeholder="搜索艺人" value={query} onChange={e => setQuery(e.target.value)} />}
      <main className={styles.rootScroll} key={tab}>
        {tab === "friends" && <><p className={styles.sectionLabel}>我的资料</p><button type="button" className={styles.myMini} onClick={() => setRoute("myProfile")}><Avatar src={user.avatar} name={user.name}/><span><b>{user.name}</b></span><ChevronRight size={18}/></button><div className={styles.sectionRule}/><p className={styles.sectionLabel}>推荐好友 <span>{filteredCharacters.length}</span></p>{filteredCharacters.map(c => <button type="button" className={styles.friendRow} key={c.id} onClick={() => { setArtistReturn(null); setSelected(c.id); setRoute("artist"); }}><Avatar src={state.profiles[c.id]?.avatar || c.avatar} name={c.name}/><span><b>{state.profiles[c.id]?.name || c.name}</b><small>{state.profiles[c.id]?.bio || state.profiles[c.id]?.group || ""}</small></span><ChevronRight size={16}/></button>)}{!characters.length && <p className={styles.empty}>还没有角色，先在小手机的角色页面创建。</p>}</>}
        {tab === "chats" && <><p className={styles.sectionLabel}>最近的聊天室</p>{characters.filter(c => state.subscribedIds.includes(c.id) && filteredCharacters.some(x => x.id === c.id)).sort((a, b) => Number(Boolean(state.rooms[b.id]?.pinned)) - Number(Boolean(state.rooms[a.id]?.pinned)) || (state.messages.filter(m => m.characterId === b.id).at(-1)?.createdAt || 0) - (state.messages.filter(m => m.characterId === a.id).at(-1)?.createdAt || 0)).map(c => { const rows = state.messages.filter(m => m.characterId === c.id); const last = rows.at(-1); const unread = rows.filter(m => m.sender === "artist" && m.createdAt > (state.readAt[c.id] || 0)).length; return <button type="button" className={styles.chatRow} key={c.id} onClick={() => openChat(c.id)}><Avatar src={state.profiles[c.id]?.avatar || c.avatar} name={c.name}/><span><b>{state.rooms[c.id]?.pinned ? "⌃ " : ""}{state.rooms[c.id]?.chatName || state.profiles[c.id]?.name || c.name}</b><small>{last?.original || "还没有消息"}</small></span><aside><time>{last ? new Date(last.createdAt).toLocaleDateString() : ""}</time>{unread > 0 && <i>{unread}</i>}</aside></button>; })}{!state.subscribedIds.length && <p className={styles.empty}>还没有聊天。到 FRIENDS 选择一位艺人，添加 bubble 好友。</p>}</>}
        {tab === "more" && <><button type="button" className={styles.moreProfile} onClick={() => setRoute("myProfile")}><Avatar src={user.avatar} name={user.name}/><b>{user.name}</b></button><div className={styles.sectionRule}/><button type="button" className={styles.moreRow} onClick={() => setRoute("myProfile")}><UserRound size={21}/>我的资料<ChevronRight size={19}/></button><button type="button" className={styles.moreRow} onClick={() => { setSettingsReturn(null); setRoute("settings"); }}><Settings2 size={21}/>设置<ChevronRight size={19}/></button><button type="button" className={styles.moreRow} onClick={onClose}><X size={21}/>返回桌面<ChevronRight size={19}/></button></>}
      </main>
      <nav className={styles.bottomNav} aria-label="LYSN 导航">{(["friends", "chats", "more"] as const).map(item => <button type="button" key={item} className={tab === item ? styles.activeTab : ""} onClick={() => { setTab(item); setSearchOpen(false); setQuery(""); }} aria-label={item === "friends" ? "好友" : item === "chats" ? "聊天" : "我的"}>{item === "friends" ? <UserRound size={24}/> : item === "chats" ? <MessageCircle size={24}/> : <MoreHorizontal size={25}/>}<small>{item === "friends" ? "好友" : item === "chats" ? "聊天" : "我的"}</small></button>)}</nav>
    </>}
    {route === "artist" && character && <div className={styles.fullProfile}>{profile?.cover ? <AssetImage src={profile.cover} className={styles.coverImage}/> : <div className={styles.coverFallback}/>}<div className={styles.coverShade}/><button type="button" className={styles.coverBack} onClick={back} aria-label="返回"><X size={29}/></button><button type="button" className={styles.coverEdit} onClick={startArtistEdit} aria-label="编辑艺人资料"><Settings2 size={21}/></button><div className={styles.profileIdentity}><Avatar src={avatar} name={displayName} className={styles.largeAvatar}/><h2><span className={styles.artistPill}>ARTIST</span>{displayName}</h2><p>{profile?.bio || ""}</p>{profile?.group && <span className={styles.groupPill}>{profile.group} · {character.name}</span>}</div><div className={styles.profileFooter}>{!subscribed && <button type="button" className={styles.preSubscribeButton} onClick={() => { setDetailsReturn("artist"); setRoute("details"); setRoomSheet(true); }}>订阅前设置开场白</button>}<button type="button" onClick={() => subscribed ? openChat(character.id) : subscribe(character.id)}>{subscribed ? "进入 bubble 聊天" : "添加 bubble 好友"}</button></div></div>}
    {route === "chat" && character && <><header className={styles.chatHeader}><button type="button" aria-label="返回聊天室列表" onClick={back}><ChevronLeft size={25}/></button><div><strong>{roomName}</strong><BubbleDays days={days}/></div><button type="button" aria-label="聊天详情" onClick={() => { setDetailsReturn("chat"); setRoute("details"); }}><MoreHorizontal size={23}/></button></header><main className={styles.messages}>{messageItems.length ? messageItems.map(renderMessage) : <div className={styles.empty}>{opening === selected ? "正在准备开场白…" : "还没有消息。点击小飞机召唤艺人。"}</div>}<div ref={endRef}/></main>{opening === selected && <p className={styles.openingNote}>首次开场白生成中；它不会算作艺人回复。</p>}<form className={styles.composer} onSubmit={e => { e.preventDefault(); void summonArtist(); }}><textarea rows={1} aria-label="回复艺人" placeholder={state.settings.deepRealism ? `回车发送 · ${remaining}/3 条 · 每条 ${limit} 字` : "回车发送，点小飞机召唤回复"} value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); sendFan(); } }} /><button type="submit" disabled={busy} aria-label="召唤艺人回复" title="召唤艺人回复">{busy ? <LoaderCircle size={21} className={styles.spin}/> : <Send size={21}/>}</button></form></>}
    {route === "details" && character && <>{header("聊天详情")}<main className={styles.detailsScroll}>
      <section className={styles.detailsCard}><button type="button" className={styles.identityRow} onClick={() => { setArtistReturn("details"); setRoute("artist"); }}><Avatar src={avatar} name={displayName}/><span><b><span className={styles.artistPill}>ARTIST</span> {displayName}</b><small>查看艺人资料</small></span><ChevronRight size={19}/></button><div className={styles.identityRow}><Avatar src={room.avatar || user.avatar} name={room.nickname || user.name}/><span><b>{room.nickname || user.name}</b><small>当前聊天室的我的资料</small></span></div><button type="button" className={styles.ourBoxButton} onClick={() => setRoute("ourBox")}><Heart size={21} fill="currentColor"/> OUR BOX <small>{(room.favoriteMessageIds || []).length}</small></button></section>
      <h3>聊天</h3><section className={styles.detailsCard}><button type="button" className={styles.detailsRow} onClick={() => setRoute("media")}><ImageIcon size={21}/>图片和语音<ChevronRight size={19}/></button><button type="button" className={styles.detailsRow} onClick={() => setRoomSheet(true)}><Settings2 size={21}/>聊天室设置<ChevronRight size={19}/></button></section>
      {subscribed ? <button type="button" className={styles.unsubscribeButton} onClick={() => { if (window.confirm(`取消订阅 ${displayName}？聊天记录会保留。`)) subscribe(character.id); }}>取消订阅</button> : <button type="button" className={styles.primaryButton} onClick={() => subscribe(character.id)}>添加 bubble 好友并进入聊天</button>}
    </main></>}
    {route === "ourBox" && <>{header("OUR BOX")}<main className={styles.libraryScroll}>{messages.filter(m => (room.favoriteMessageIds || []).includes(m.id)).length ? messages.filter(m => (room.favoriteMessageIds || []).includes(m.id)).map(m => <div key={m.id} className={styles.savedMessage}><time>{new Date(m.createdAt).toLocaleString()}</time><div><Avatar src={avatar} name={displayName}/><p>{showName(m.original)}</p></div><button type="button" onClick={() => toggleFavorite(m.id)}>移出收藏</button></div>) : <p className={styles.empty}>长按艺人的消息，就能收藏到这里。</p>}</main></>}
    {route === "media" && <>{header("图片和语音")}<main className={styles.libraryScroll}>{messages.filter(m => m.sender === "artist" && ((m.kind === "photo" && m.imageUrl) || m.kind === "voice")).length ? [...messages].filter(m => m.sender === "artist" && ((m.kind === "photo" && m.imageUrl) || m.kind === "voice")).reverse().map((m, index, arr) => <div key={m.id}>{(index === 0 || new Date(arr[index - 1].createdAt).toDateString() !== new Date(m.createdAt).toDateString()) && <p className={styles.libraryDate}>{new Date(m.createdAt).toLocaleDateString()}</p>}{m.kind === "photo" && m.imageUrl ? <button type="button" className={styles.mediaImage} onClick={() => setViewerUrl(m.imageUrl || "")}><AssetImage src={m.imageUrl}/></button> : <div className={styles.mediaVoice}><VoiceBubble message={m} onNotice={onNotice}/><small>{m.original}</small></div>}</div>) : <p className={styles.empty}>艺人发送的图片和语音会自动收在这里。</p>}</main></>}
    {route === "stickers" && <>{header("本聊天室的表情包", <button type="button" onClick={() => { const name = stickerPackName.trim(); if (!name) { onNotice?.("先填写分类名称"); return; } updatePacks([...(room.stickerPacks || []), { id: lysnId(), name, stickers: [] }]); setStickerPackName(""); }}>创建</button>)}<main className={styles.libraryScroll}><p className={styles.settingsNote}>只供 {roomName} 在 LYSN 使用，与「聊天」App 的表情库分开。</p><label className={styles.field}><span>新分类名称</span><input value={stickerPackName} onChange={e => setStickerPackName(e.target.value)} placeholder="例如：小动物、日常表情" /></label><div className={styles.packGrid}>{(room.stickerPacks || []).map(pack => <button type="button" key={pack.id} onClick={() => { setActivePackId(pack.id); setRoute("stickerPack"); }}><Smile size={30}/><b>{pack.name}</b><small>{pack.stickers.length} 个表情</small></button>)}</div>{!(room.stickerPacks || []).length && <p className={styles.empty}>创建分类后，可以上传图片或填写图片 URL。</p>}</main></>}
    {route === "stickerPack" && <>{header((room.stickerPacks || []).find(p => p.id === activePackId)?.name || "表情包", <button type="button" onClick={() => { if (!activePackId || !window.confirm("删除整个分类和其中的表情？")) return; updatePacks((room.stickerPacks || []).filter(p => p.id !== activePackId)); setRoute("stickers"); }}>删除分类</button>)}<main className={styles.libraryScroll}>
      <div className={styles.stickerAdder}><button type="button" onClick={() => requestUpload("sticker")}><Camera size={17}/> 上传图片</button><label>表情名称<input value={stickerName} onChange={e => setStickerName(e.target.value)} placeholder="例如：开心兔兔" /></label><label>图片 URL<input value={stickerUrl} onChange={e => setStickerUrl(e.target.value)} placeholder="https://..." /></label><button type="button" onClick={() => { if (!stickerName.trim() || !/^https?:\/\//i.test(stickerUrl.trim())) { onNotice?.("请填写名称和 http(s) 图片 URL"); return; } addSticker(stickerName, stickerUrl); }}>添加 URL 表情</button></div>
      {(room.stickerPacks || []).filter(p => p.id === activePackId).map(pack => <div className={styles.stickerGrid} key={pack.id}>{pack.stickers.map(sticker => <div className={styles.stickerItem} key={sticker.id}><AssetImage src={sticker.imageUrl}/><input aria-label="表情名称" value={sticker.name} onChange={e => updatePacks((room.stickerPacks || []).map(p => p.id === pack.id ? { ...p, stickers: p.stickers.map(s => s.id === sticker.id ? { ...s, name: e.target.value } : s) } : p))}/><button type="button" onClick={() => updatePacks((room.stickerPacks || []).map(p => p.id === pack.id ? { ...p, stickers: p.stickers.filter(s => s.id !== sticker.id) } : p))}>删除</button></div>)}</div>)}
    </main></>}
    {route === "artistEdit" && character && <>{header("编辑艺人资料", <button type="button" onClick={saveArtist}>保存</button>)}<main className={styles.editScroll}><div className={styles.editCover}>{artistDraft.cover ? <AssetImage src={artistDraft.cover} className={styles.coverImage}/> : <div className={styles.coverFallback}/>}<button type="button" className={styles.editCoverButton} onClick={() => requestUpload("artistCover")}><Camera size={18}/>更换背景</button><button type="button" className={styles.editAvatarButton} onClick={() => requestUpload("artistAvatar")}><Avatar src={artistDraft.avatar} name={artistDraft.name} className={styles.editAvatar}/><Camera size={17}/></button></div><div className={styles.fields}>{editField("LYSN 昵称", artistDraft.name, value => setArtistDraft(prev => ({ ...prev, name: value })))}{editField("简介", artistDraft.bio || "", value => setArtistDraft(prev => ({ ...prev, bio: value })))}{editField("组合 / 所属", artistDraft.group || "", value => setArtistDraft(prev => ({ ...prev, group: value })))}{imageLinkField("头像图片链接（可选）", artistDraft.avatar, value => setArtistDraft(prev => ({ ...prev, avatar: value })))}{imageLinkField("背景图片链接（可选）", artistDraft.cover || "", value => setArtistDraft(prev => ({ ...prev, cover: value })))}<p>这里仅修改 LYSN 的显示资料，不影响 Chat 或 WVS。</p><button type="button" className={styles.primaryButton} onClick={saveArtist}>保存艺人资料</button></div></main></>}
    {route === "myProfile" && <div className={styles.fullProfile}>{user.cover ? <AssetImage src={user.cover} className={styles.coverImage}/> : <div className={styles.coverFallback}/>}<div className={styles.coverShade}/><button type="button" className={styles.coverBack} onClick={back} aria-label="返回"><X size={29}/></button><div className={styles.profileIdentity}><Avatar src={user.avatar} name={user.name} className={styles.largeAvatar}/><h2>{user.name}</h2><button type="button" className={styles.profileEditButton} onClick={startUserEdit}><Settings2 size={20}/>编辑个人资料</button></div></div>}
    {route === "myEdit" && <>{header("编辑个人资料", <button type="button" onClick={saveUser}>保存</button>)}<main className={styles.editScroll}><div className={styles.editCover}>{userDraft.cover ? <AssetImage src={userDraft.cover} className={styles.coverImage}/> : <div className={styles.coverFallback}/>}<button type="button" className={styles.editCoverButton} onClick={() => requestUpload("userCover")}><Camera size={18}/>更换背景</button><button type="button" className={styles.editAvatarButton} onClick={() => requestUpload("userAvatar")}><Avatar src={userDraft.avatar} name={userDraft.name} className={styles.editAvatar}/><Camera size={17}/></button></div><div className={styles.fields}>{editField("昵称", userDraft.name, value => setUserDraft(prev => ({ ...prev, name: value })))}{editField("生日（可选，例：2001-07-17）", userDraft.birthday, value => setUserDraft(prev => ({ ...prev, birthday: value })))}{editField("性别（可选）", userDraft.gender, value => setUserDraft(prev => ({ ...prev, gender: value })))}<button type="button" className={styles.primaryButton} onClick={saveUser}>保存个人资料</button></div></main></>}
    {route === "settings" && <>{header("设置")}<main className={styles.settingsScroll}><h3>基本信息</h3><button type="button" className={styles.settingRow} onClick={startUserEdit}><Avatar src={user.avatar} name={user.name}/><span>{user.name}</span><small>编辑个人资料</small><ChevronRight size={18}/></button><h3>通知与体验</h3>{settingsSwitch("LYSN 新消息通知", state.settings.notificationsEnabled, value => updateSetting({ notificationsEnabled: value }))}{settingsSwitch("艺人自主发消息", state.settings.autonomousMessages, value => updateSetting({ autonomousMessages: value }), "关闭后只在点小飞机时尝试生成新消息")}{settingsSwitch("加深拟真", state.settings.deepRealism, value => updateSetting({ deepRealism: value }), "每次艺人回复后或一天后可再发三条；字数随订阅天数增加")}
      <h3>翻译显示</h3>{([ ["fold", "折叠翻译"], ["replace", "覆盖原文"] ] as const).map(([value, label]) => <button type="button" className={styles.settingRow} key={value} onClick={() => updateSetting({ translationMode: value })}><span>{label}</span>{state.settings.translationMode === value && <Check size={20} className={styles.selectedCheck}/>}</button>)}
      <h3>用户消息翻译 API</h3><p className={styles.settingsNote}>可先保存 URL 和 Key。收到具体接口的请求、鉴权及返回格式后才能启用发送消息的翻译。</p><label className={styles.field}><span>接口 URL</span><input type="url" value={state.settings.translationApiUrl} onChange={e => updateSetting({ translationApiUrl: e.target.value })} placeholder="https://..." autoComplete="off" /></label><label className={styles.field}><span>API Key</span><input type="password" value={state.settings.translationApiKey} onChange={e => updateSetting({ translationApiKey: e.target.value })} placeholder="填写密钥" autoComplete="off" /></label>
    </main></>}
    {roomSheet && route === "details" && <div className={styles.overlay} onMouseDown={e => { if (e.target === e.currentTarget) setRoomSheet(false); }}><section className={`${styles.sheet} ${styles.roomSheet}`} role="dialog" aria-label="聊天室设置"><header><b>聊天室设置</b><button type="button" onClick={() => setRoomSheet(false)} aria-label="关闭"><X size={21}/></button></header><div className={styles.roomSheetScroll}>
      <p className={styles.roomSection}>个人资料 <small>仅当前聊天室生效</small></p><button type="button" className={styles.settingRow} onClick={() => requestUpload("roomAvatar")}><span>个人头像</span><Avatar src={room.avatar || user.avatar} name={room.nickname || user.name}/><Camera size={17}/></button><label className={styles.field}><span>我的昵称 · 艺人称呼你时使用</span><input value={room.nickname || ""} placeholder={user.name} onChange={e => updateRoom({ nickname: e.target.value })}/></label>
      <p className={styles.roomSection}>艺人</p><label className={styles.field}><span>聊天室名称 · 你看到的名字</span><input value={room.chatName || ""} placeholder={displayName} onChange={e => updateRoom({ chatName: e.target.value })}/></label>
      <p className={styles.roomSection}>订阅与开场白</p><label className={styles.field}><span>订阅本聊天室的日期 · 当天为第 1 天</span><input type="date" max={localDay(new Date())} value={room.subscriptionDate || (selected && state.subscribedAt[selected] ? localDay(new Date(state.subscribedAt[selected])) : localDay(new Date()))} onChange={e => { if (e.target.value && e.target.value <= localDay(new Date())) updateRoom({ subscriptionDate: e.target.value, anniversariesShown: [] }); }}/></label><p className={styles.settingsNote}>当前第 {days} 天 · 每条可发 {limit} 字（开启「加深拟真」后生效）</p><label className={styles.field}><span>专属开场白 · 首次进入时显示一次</span><textarea value={room.openerText || ""} placeholder={room.openerShown ? "已显示过开场白，修改不会再次弹出" : "留空则首次进入时让 AI 根据人设生成一次"} onChange={e => updateRoom({ openerText: e.target.value })}/></label>
      <p className={styles.roomSection}>艺人泡泡状态</p><label className={styles.field}><span>出现频率</span><select value={room.activity || "normal"} onChange={e => updateRoom({ activity: e.target.value as LysnRoom["activity"] })}><option value="quiet">不常来</option><option value="normal">普通</option><option value="frequent">经常来</option></select></label><label className={styles.field}><span>引用粉丝消息</span><select value={room.quoteStyle || "normal"} onChange={e => updateRoom({ quoteStyle: e.target.value as LysnRoom["quoteStyle"] })}><option value="rare">很少引用</option><option value="normal">偶尔引用</option><option value="often">喜欢引用</option></select></label><p className={styles.settingsNote}>这两项是艺人的偏好：生成时仍可能暂时没有公开消息。</p>
      <button type="button" className={styles.detailsRow} onClick={() => { setRoomSheet(false); setRoute("stickers"); }}><Smile size={20}/>本聊天室的表情包<ChevronRight size={19}/></button>
      <p className={styles.roomSection}>通知与显示</p>{settingsSwitch("置顶聊天", Boolean(room.pinned), value => updateRoom({ pinned: value }))}{settingsSwitch("消息免打扰", Boolean(room.muted), value => updateRoom({ muted: value }))}{settingsSwitch("多图折叠展示", room.foldPhotos !== false, value => updateRoom({ foldPhotos: value }), "连续发送的多张图片叠放轮播，点击展开可逐张看")}
    </div></section></div>}
    {viewerUrl && <div className={styles.imageViewer} role="dialog" aria-label="查看图片" onClick={() => setViewerUrl("")}><button type="button" aria-label="关闭图片"><X size={26}/></button><AssetImage src={viewerUrl}/></div>}
  </div>;
}
