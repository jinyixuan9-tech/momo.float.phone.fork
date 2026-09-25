"use client";

import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowUp,
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  Heart,
  Image as ImageIcon,
  LoaderCircle,
  MessageCircle,
  MoreHorizontal,
  Search,
  Settings2,
  Trash2,
  UserRound,
  X,
  Pencil,
  RotateCcw,
  Play,
  Pause,
  Bookmark,
  CalendarDays,
  Smile,
} from "lucide-react";
import { LysnCalendar, LysnCelebrationCardView, type LysnBirthdayCard, type LysnCelebrationEvent } from "./lysn-calendar";
import { LysnSubscriptionPicker } from "./lysn-subscription-picker";
import { LysnStickerManager } from "./lysn-sticker-manager";
import { loadCharacters, CHARACTERS_UPDATED_EVENT } from "@/lib/character-storage";
import type { Character } from "@/lib/character-types";
import { getChatImageFromIndexedDB, saveChatImageToIndexedDB } from "@/lib/chat-asset-storage";
import { sendBrowserNotification } from "@/lib/browser-notification";
import { resolveVoiceConfig, synthesizeSpeech, playAudioBlobViaMediaElement, unlockAudioPlayback } from "@/lib/tts-service";
import { generateLysn } from "@/lib/lysn-engine";
import { prepareLysnMessages } from "@/lib/lysn-message";
import { resolveMediaForUse } from "@/lib/media-resolver";
import { lysnDatedCards, maybeCelebrateLysn, syncLysnDatedCards } from "@/lib/lysn-celebrations";
import { applyLysnProfileAction } from "@/lib/lysn-profile-autonomy";
import { noteLysnFanMessage } from "@/lib/lysn-identity";
import {
  appendLysn,
  countReplyCharacters,
  loadLysn,
  localDay,
  lysnId,
  remainingFanReplies,
  replyCharacterLimit,
  saveLysn,
  subscriptionDays,
  LYSN_EVENT,
  type LysnMessage,
  type LysnProfile,
  type LysnRoom,
  type LysnState,
  type LysnStickerPack,
  type LysnUserProfile,
} from "@/lib/lysn-storage";
import styles from "./lysn-app.module.css";

type Tab = "friends" | "chats" | "more";
type Route = "artist" | "chat" | "details" | "calendar" | "ourBox" | "media" | "stickers" | "myStickers" | "artistEdit" | "myProfile" | "myEdit" | "settings" | null;
type UploadTarget = "artistAvatar" | "artistCover" | "userAvatar" | "userCover" | "roomAvatar" | "roomBackground";
const QUICK_EMOJI = ["💜", "🥹", "😂", "😭", "🫶", "🥰", "😍", "😎", "🤍", "✨", "🎂", "🐰", "👍", "👏", "💕", "😴"];
function AssetImage({ src, className = "" }: { src: string; className?: string }) {
  const [url, setUrl] = useState(src.startsWith("asset://") ? "" : src);
  useEffect(() => {
    let active = true;
    if (!src.startsWith("asset://")) {
      setUrl(src);
      return;
    }
    getChatImageFromIndexedDB(src.slice(8))
      .then(value => {
        if (active) setUrl(value || "");
      })
      .catch(() => {
        if (active) setUrl("");
      });
    return () => {
      active = false;
    };
  }, [src]);
  return url ? <img src={url} className={className} alt="" /> : <span className={styles.fallback}><ImageIcon size={22}/></span>;
}

function Avatar({ src, name, className = "" }: { src?: string | null; name: string; className?: string }) {
  return (
    <span className={`${styles.avatar} ${className}`}>
      <span className={styles.avatarInner}>{src ? <AssetImage src={src} /> : <UserRound aria-label={name} size={26}/>}</span>
    </span>
  );
}

function ArtistBadge() {
  return <span className={styles.artistBadgeImage}>ARTIST</span>;
}

function BubbleBrand({ days }: { days: number }) {
  return (
    <span className={styles.bubbleDays} aria-label={`bubble 订阅第 ${days} 天`}><span>bubble</span><svg viewBox="0 0 28 28" aria-hidden="true"><defs><linearGradient id="lysnHeart" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#ff9cc9"/><stop offset="1" stopColor="#965dff"/></linearGradient></defs><path d="M14 25 3.6 14.8C-3 8.1 5.8-1.9 13.9 5.7 22-1.9 31 8.1 24.4 14.8 14 25Z" fill="url(#lysnHeart)"/></svg><b>+ {days}</b></span>
  );
}

function OurBoxMark() {
  return <svg className={styles.ourBoxIconImage} viewBox="0 0 32 32" aria-hidden="true"><defs><linearGradient id="ourBoxHeart" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#bf66f2"/><stop offset="1" stopColor="#8554da"/></linearGradient></defs><path d="M15.5 3H27a2 2 0 0 1 2 2v11.5a3 3 0 0 1-.88 2.12L18.6 28.15a3 3 0 0 1-4.24 0L3.85 17.64a3 3 0 0 1 0-4.24L13.38 3.88A3 3 0 0 1 15.5 3Z" fill="url(#ourBoxHeart)"/><circle cx="24.3" cy="7.8" r="1.7" fill="white"/></svg>;
}

function formatClock(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDateGroup(ts: number) {
  const d = new Date(ts);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}

function estimateVoiceSeconds(message: LysnMessage) {
  const base = Math.max(4, Math.round((message.original || message.translated || "").replace(/\s+/g, "").length / 4));
  return Math.min(59, base);
}

function durationLabel(message: LysnMessage) {
  const seconds = estimateVoiceSeconds(message);
  return `${seconds}''`;
}

function spokenVoiceText(message: LysnMessage): string {
  const nickname = loadLysn().rooms[message.characterId]?.nickname?.trim();
  if (!nickname) return message.original;
  const escaped = nickname.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return message.original.replace(new RegExp(escaped, "g"), "").replace(/([，,、])\s*([，,、])/g, "$1").replace(/^\s*[，,、：:]\s*/, "").trim();
}

function VoicePlayer({ message, className = "", compact = false, iconOnly = false, onNotice }: { message: LysnMessage; className?: string; compact?: boolean; iconOnly?: boolean; onNotice?: (text: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(false);
  const playback = useRef<ReturnType<typeof playAudioBlobViaMediaElement> | null>(null);
  useEffect(() => () => playback.current?.abort(), []);

  const play = async () => {
    if (busy || playing) {
      playback.current?.abort();
      playback.current = null;
      setPlaying(false);
      return;
    }
    const config = resolveVoiceConfig(message.characterId, "lysn");
    if (!config?.enableTTS) {
      onNotice?.("请先在配置绑定中给这位艺人的 LYSN 配置语音方案");
      return;
    }
    unlockAudioPlayback();
    setBusy(true);
    try {
      const blob = await synthesizeSpeech(spokenVoiceText(message), config);
      if (!blob) throw new Error("语音服务没有返回音频");
      setBusy(false);
      setPlaying(true);
      playback.current = playAudioBlobViaMediaElement(blob);
      await playback.current.promise;
    } catch (error) {
      onNotice?.(error instanceof Error ? error.message : "语音播放失败");
    } finally {
      setBusy(false);
      setPlaying(false);
      playback.current = null;
    }
  };

  return (
    <button type="button" className={`${styles.voiceButton} ${compact ? styles.voiceButtonCompact : ""} ${className}`} onClick={e => { e.stopPropagation(); void play(); }} disabled={busy} aria-label={playing ? "暂停语音" : "播放语音"}>
      <span className={styles.voiceIconWrap}>{busy ? <LoaderCircle size={20} className={styles.spin}/> : playing ? <Pause size={20} fill="currentColor"/> : iconOnly ? <Play size={20} fill="currentColor"/> : <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="4" cy="12" r="2" fill="currentColor"/><path d="M9 8a6 6 0 0 1 0 8m4-12a11 11 0 0 1 0 16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"/></svg>}</span>
      {!iconOnly && <span className={styles.voiceDuration}>{durationLabel(message)}</span>}
    </button>
  );
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
  const [chatSearchOpen, setChatSearchOpen] = useState(false);
  const [chatSearchQuery, setChatSearchQuery] = useState("");
  const [chatSearchTarget, setChatSearchTarget] = useState<string | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const [subscriptionChoice, setSubscriptionChoice] = useState<string | null>(null);
  const [celebrationEvent, setCelebrationEvent] = useState<LysnCelebrationEvent | null>(null);
  const [celebrationLetter, setCelebrationLetter] = useState<LysnBirthdayCard | null>(null);
  const [celebrationLoading, setCelebrationLoading] = useState(false);
  const [celebrationError, setCelebrationError] = useState("");
  const [roomSheet, setRoomSheet] = useState(false);
  const [settingsReturn, setSettingsReturn] = useState<Route>(null);
  const [userEditReturn, setUserEditReturn] = useState<Route>("myProfile");
  const [artistReturn, setArtistReturn] = useState<Route>(null);
  const [detailsReturn, setDetailsReturn] = useState<Route>("chat");
  const [artistDraft, setArtistDraft] = useState<LysnProfile>({ name: "", avatar: "", cover: "", bio: "", group: "", updatedAt: 0 });
  const [artistOpenerDraft, setArtistOpenerDraft] = useState("");
  const [userDraft, setUserDraft] = useState<LysnUserProfile>(() => loadLysn().userProfile);
  const [translatedIds, setTranslatedIds] = useState<Record<string, boolean>>({});
  const [emojiCategory, setEmojiCategory] = useState("all");
  const [viewerUrl, setViewerUrl] = useState("");
  const [voiceViewer, setVoiceViewer] = useState<LysnMessage | null>(null);
  const [messageMenu, setMessageMenu] = useState<LysnMessage | null>(null);
  const [rerollTarget, setRerollTarget] = useState<LysnMessage | null>(null);
  const [editDraft, setEditDraft] = useState<{ id: string; sender: LysnMessage["sender"]; kind: LysnMessage["kind"]; original: string; translated: string } | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const uploadTarget = useRef<UploadTarget>("artistAvatar");
  const openRef = useRef<(id: string) => void>(() => {});
  const openingRef = useRef<Set<string>>(new Set());
  const touchTimer = useRef<number | null>(null);
  const touchActionOpened = useRef(false);

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
    };
  }, []);

  useEffect(() => {
    if (route === "chat") endRef.current?.scrollIntoView({ block: "end" });
  }, [state.messages.length, route, selected]);

  const character = characters.find(c => c.id === selected);
  const profile = selected ? state.profiles[selected] : undefined;
  const room = selected ? state.rooms[selected] || {} : {};
  const displayName = character ? profile?.name || character.name : "";
  const roomName = room.chatName?.trim() || displayName;
  const avatar = character ? profile?.avatar || character.avatar : "";
  const messages = selected ? state.messages.filter(m => m.characterId === selected) : [];
  const searchedMessages = chatSearchQuery.trim() ? messages.filter(m => [m.original, m.translated, m.quote?.original, m.quote?.translated].some(value => value?.toLocaleLowerCase().includes(chatSearchQuery.trim().toLocaleLowerCase()))) : [];
  const subscribed = Boolean(selected && state.subscribedIds.includes(selected));
  const user = state.userProfile;
  const userPacks = user.stickerPacks?.length ? user.stickerPacks : (user.stickers?.length ? [{ id: "lysn_legacy_user_stickers", name: "我的表情", stickers: user.stickers }] : []);
  const days = selected ? subscriptionDays(state, selected) : 1;
  const limit = replyCharacterLimit(days);
  const remaining = selected ? remainingFanReplies(state, selected) : 3;
  const showName = (value: string) => value.replaceAll("{{nickname}}", room.nickname?.trim() || user.name);


  const commit = (next: LysnState) => {
    saveLysn(next);
    setState(next);
  };

  const updateRoom = (patch: Partial<LysnRoom>) => {
    if (!selected) return;
    const next = loadLysn();
    next.rooms[selected] = { ...next.rooms[selected], ...patch };
    if (patch.subscriptionDate) syncLysnDatedCards(next, selected, localDay(new Date()));
    commit(next);
  };

  const clearChat = () => {
    if (!selected) return;
    if (!window.confirm(`清空 ${displayName} 的聊天记录？此操作不会取消订阅。`)) return;
    const next = loadLysn();
    next.messages = next.messages.filter(m => m.characterId !== selected);
    next.readAt[selected] = Date.now();
    next.rooms[selected] = { ...next.rooms[selected], favoriteMessageIds: [], openerShown: false, anniversariesShown: [] };
    commit(next);
    setTranslatedIds({});
    onNotice?.("聊天记录已清空");
  };

  const removeMessage = (id: string) => {
    const next = loadLysn();
    next.messages = next.messages.filter(m => m.id !== id);
    Object.keys(next.rooms).forEach(roomId => {
      const ids = next.rooms[roomId]?.favoriteMessageIds || [];
      if (ids.includes(id)) next.rooms[roomId] = { ...next.rooms[roomId], favoriteMessageIds: ids.filter(x => x !== id) };
    });
    commit(next);
    setMessageMenu(null);
    onNotice?.("已删除消息");
  };

  const saveEditedMessage = () => {
    if (!editDraft) return;
    const next = loadLysn();
    next.messages = next.messages.map(message => message.id === editDraft.id ? editDraft.kind === "photo" ? { ...message, photoDescription: editDraft.original, original: editDraft.original, translated: editDraft.original, imageUrl: undefined, photoId: undefined, photoCaptionDetached: true } : { ...message, original: editDraft.original, translated: editDraft.sender === "artist" ? editDraft.translated || editDraft.original : editDraft.original } : message);
    commit(next);
    setEditDraft(null);
    onNotice?.("已保存修改");
  };

  const generateEditedPhoto = async () => {
    if (!editDraft || editDraft.kind !== "photo") return;
    const draft = editDraft;
    saveEditedMessage();
    const message = loadLysn().messages.find(row => row.id === draft.id);
    if (!message) return;
    const media = await resolveMediaForUse({ actor: { type: "character", characterId: message.characterId }, description: draft.original, channel: "bubble", targetId: message.characterId, appId: "lysn", mode: "generate" }).catch(() => null);
    if (!media?.imageUrl) { onNotice?.("生图未配置或生成失败，已保留文字照片"); return; }
    const next = loadLysn();
    next.messages = next.messages.map(row => row.id === draft.id ? { ...row, imageUrl: media.imageUrl, photoId: media.photoLibraryId } : row);
    commit(next);
  };

  const rerollMessage = async (message: LysnMessage, mode: "single" | "session") => {
    if (!selected || message.sender !== "artist") {
      onNotice?.("只有艺人消息支持重回");
      return;
    }
    try {
      setBusy(true);
      const latest = loadLysn();
      const history = latest.messages.filter(m => m.characterId === selected).sort((a, b) => a.createdAt - b.createdAt);
      const targetIndex = history.findIndex(m => m.id === message.id);
      if (targetIndex < 0) return;
      const before = history.slice(0, targetIndex);
      const generated = await generateLysn(selected, before, "new");
      if (!generated.length) {
        onNotice?.("这次没有生成可替换的消息");
        return;
      }
      const prepared = (await prepareLysnMessages(selected, generated)).map(row => ({
        ...row,
        id: lysnId(),
        characterId: selected,
        createdAt: Date.now(),
      }));
      const next = loadLysn();
      const all = next.messages.sort((a, b) => a.createdAt - b.createdAt);
      const globalIndex = all.findIndex(m => m.id === message.id);
      if (globalIndex < 0) return;
      if (mode === "single") {
        all.splice(globalIndex, 1, prepared[0]);
      } else {
        const cutoff = message.createdAt;
        next.messages = next.messages.filter(m => !(m.characterId === selected && m.createdAt >= cutoff));
        next.messages.push(...prepared);
        commit(next);
        setRerollTarget(null);
        onNotice?.("已重回本次");
        return;
      }
      next.messages = all;
      commit(next);
      setRerollTarget(null);
      onNotice?.("已重回本条");
    } catch (error) {
      onNotice?.(error instanceof Error ? error.message : "重回失败");
    } finally {
      setBusy(false);
    }
  };

  const getBirthdayCard = async (id: string, year: number): Promise<LysnBirthdayCard> => {
    const saved = loadLysn().rooms[id]?.birthdayCards?.[String(year)];
    if (saved) return saved;
    const currentState = loadLysn();
    const birthdayDate = currentState.userProfile.birthday.match(/(?:\d{4}[-/])?(\d{1,2})[-/](\d{1,2})$/);
    const historicalCutoff = birthdayDate ? new Date(year, Number(birthdayDate[1]) - 1, Number(birthdayDate[2]), 23, 59, 59).getTime() : Date.now();
    const history = currentState.messages.filter(m => m.characterId === id && m.createdAt <= historicalCutoff);
    const generated = await generateLysn(id, history, "birthday", undefined, undefined, year);
    if (!generated.length) throw new Error("还没有生成生日留言");
    const card = { original: generated[0].original, translated: generated[0].translated || generated[0].original };
    const latest = loadLysn();
    latest.rooms[id] = { ...latest.rooms[id], birthdayCards: { ...latest.rooms[id]?.birthdayCards, [year]: card } };
    saveLysn(latest);
    return card;
  };

  const openCelebration = (event: LysnCelebrationEvent) => {
    setCelebrationEvent(event);
    setCelebrationLetter(null);
    setCelebrationError("");
    if (event.kind !== "birthday" || !selected) return;
    const id = selected;
    setCelebrationLoading(true);
    void getBirthdayCard(id, event.year).then(setCelebrationLetter).catch(error => setCelebrationError(error instanceof Error ? error.message : "生日留言生成失败"))
      .finally(() => setCelebrationLoading(false));
  };

  const openChat = (id: string) => {
    const current = loadLysn();
    if (!current.subscribedIds.includes(id)) return;
    current.readAt[id] = Date.now();
    commit(current);
    setSelected(id);
    setChatSearchOpen(false);
    setChatSearchQuery("");
    setChatSearchTarget(null);
    setEmojiOpen(false);
    setRoute("chat");
    setTab("chats");
    const latest = loadLysn();
    if (!latest.rooms[id]?.openerShown && !openingRef.current.has(id)) {
      openingRef.current.add(id);
      setOpening(id);
      const configured = latest.rooms[id]?.openerText?.trim();
      const historicalDate = latest.rooms[id]?.onboardingComplete && !latest.rooms[id]?.historyInitialized ? latest.rooms[id]?.subscriptionDate : undefined;
      const firstMessage = generateLysn(id, latest.messages.filter(m => m.characterId === id), "opening", undefined, configured, undefined, historicalDate);
      void firstMessage
        .then(async generated => {
          if (!loadLysn().subscribedIds.includes(id) || !generated.length) return;
          const latestState = loadLysn();
          if (latestState.rooms[id]?.openerShown) return;
          const prepared = await prepareLysnMessages(id, generated);
          const current = loadLysn();
          if (!current.subscribedIds.includes(id) || current.rooms[id]?.openerShown || !prepared.length) return;
          if (current.rooms[id]?.onboardingComplete && !current.rooms[id]?.historyInitialized) {
            const start = current.rooms[id]?.subscriptionDate || localDay(new Date());
            const historical = lysnDatedCards(id, start, localDay(new Date()), current.userProfile.birthday);
            const opener = prepared.slice(0, 1).map(row => ({ ...row, id: lysnId(), characterId: id, opener: true, createdAt: Math.min(Date.now() - (historical.length + 2) * 1000, new Date(`${start}T09:00:00`).getTime()) }));
            current.messages.push(...opener, ...historical);
            current.messages.sort((a, b) => a.createdAt - b.createdAt);
            current.rooms[id] = { ...current.rooms[id], historyInitialized: true, openerShown: true };
            saveLysn(current);
          } else {
            current.rooms[id] = { ...current.rooms[id], openerShown: true };
            saveLysn(current);
            appendLysn(id, prepared.map(row => ({ ...row, opener: true })));
          }
        })
        .catch(error => onNotice?.(error instanceof Error ? `开场白生成失败：${error.message}` : "开场白生成失败，可重新进入聊天室重试"))
        .finally(() => {
          openingRef.current.delete(id);
          setOpening(null);
          if (loadLysn().subscribedIds.includes(id) && loadLysn().rooms[id]?.openerShown) void maybeCelebrateLysn(id);
        });
    } else if (latest.rooms[id]?.openerShown) {
      void maybeCelebrateLysn(id);
    }
  };
  openRef.current = openChat;

  const subscribe = (id: string, chosenDate?: string) => {
    const next = loadLysn();
    if (next.subscribedIds.includes(id)) next.subscribedIds = next.subscribedIds.filter(x => x !== id);
    else {
      const firstSubscription = !next.subscribedAt[id];
      next.subscribedIds = [...next.subscribedIds, id];
      next.subscribedAt[id] = Date.now();
      next.rooms[id] = {
        ...next.rooms[id],
        subscriptionDate: chosenDate || (firstSubscription ? next.rooms[id]?.subscriptionDate || localDay(new Date()) : localDay(new Date())),
        openerShown: false,
        onboardingComplete: chosenDate ? true : next.rooms[id]?.onboardingComplete,
        historyInitialized: chosenDate ? false : next.rooms[id]?.historyInitialized,
        anniversariesShown: [],
        foldPhotos: next.rooms[id]?.foldPhotos ?? true,
      };
    }
    commit(next);
    if (!next.subscribedIds.includes(id)) {
      setRoomSheet(false);
      setArtistReturn(null);
      setRoute("artist");
      setTab("friends");
    } else openChat(id);
  };

  const beginSubscription = (id: string) => {
    if (loadLysn().subscribedIds.includes(id)) { openChat(id); return; }
    setSelected(id);
    setSubscriptionChoice(id);
  };

  const summonArtist = async () => {
    if (!selected || busy) return;
    const id = selected;
    if (draft.trim() && !sendFan()) return;
    setBusy(true);
    try {
      const history = loadLysn().messages.filter(m => m.characterId === id);
      let latestArtistIndex = -1;
      history.forEach((message, index) => {
        if (message.sender === "artist" && !message.opener) latestArtistIndex = index;
      });
      const pending = history.slice(latestArtistIndex + 1).filter(m => m.sender === "fan").map(m => m.original);
      const generated = await generateLysn(id, history, pending.length ? "reply" : "new", pending.join("\n"));
      if (!generated.length) {
        onNotice?.("艺人暂时没有公开发消息");
        return;
      }
      const mediaFailures: string[] = [];
      const rows = await prepareLysnMessages(id, generated, reason => mediaFailures.push(reason));
      if (!rows.length) {
        onNotice?.(mediaFailures.length ? `照片未发送：${mediaFailures.join("；")}` : "这次没有可发送的消息");
        return;
      }
      if (!loadLysn().subscribedIds.includes(id)) return;
      const newlyObserved = loadLysn().messages.filter(m => m.characterId === id && m.sender === "fan" && m.kind === "text" && !m.seenAt);
      appendLysn(id, rows);
      newlyObserved.forEach(message => noteLysnFanMessage(id, message.original));
      if (generated[0]?.profileUpdate) await applyLysnProfileAction(id, JSON.stringify(generated[0].profileUpdate));
      const latest = loadLysn();
      if (route === "chat" && selected === id) {
        latest.readAt[id] = Date.now();
        saveLysn(latest);
      } else if (latest.settings.notificationsEnabled && !latest.rooms[id]?.muted) {
        const name = latest.rooms[id]?.chatName || latest.profiles[id]?.name || character?.name || "艺人";
        sendBrowserNotification(`${name} · LYSN`, { body: generated[0].original.slice(0, 90), url: `/#lysn=${encodeURIComponent(id)}` });
      }
      onNotice?.(mediaFailures.length ? `收到 ${rows.length} 条 Bubble 消息；照片未发送：${mediaFailures.join("；")}` : `收到 ${rows.length} 条 Bubble 消息`);
    } catch (error) {
      onNotice?.(error instanceof Error ? error.message : "消息生成失败");
    } finally {
      setBusy(false);
    }
  };

  const sendFan = (): boolean => {
    const text = draft.trim();
    if (!selected || !text) return false;
    const latest = loadLysn();
    if (latest.settings.deepRealism) {
      if (remainingFanReplies(latest, selected) <= 0) {
        onNotice?.("已发满三条，等艺人发消息或满一天后可继续发送");
        return false;
      }
      const maximum = replyCharacterLimit(subscriptionDays(latest, selected));
      if (countReplyCharacters(text) > maximum) {
        onNotice?.(`本聊天室当前每条最多 ${maximum} 字`);
        return false;
      }
    }
    appendLysn(selected, [{ sender: "fan", kind: "text", original: text, translated: text }]);
    setDraft("");
    return true;
  };

  const sendFanSticker = (name: string, imageUrl: string) => {
    if (!selected || !imageUrl) return;
    const current = loadLysn();
    if (current.settings.deepRealism && remainingFanReplies(current, selected) <= 0) {
      onNotice?.("已发满三条，等艺人发消息或满一天后可继续发送");
      return;
    }
    appendLysn(selected, [{ sender: "fan", kind: "sticker", original: name, translated: name, imageUrl }]);
    setEmojiOpen(false);
  };

  const startArtistEdit = () => {
    if (!character || !selected) return;
    setArtistDraft({
      name: displayName,
      avatar: avatar || "",
      cover: profile?.cover || "",
      bio: profile?.bio || "",
      group: profile?.group || "",
      updatedAt: profile?.updatedAt || 0,
    });
    setArtistOpenerDraft(room.openerText || "");
    setRoute("artistEdit");
  };

  const saveArtist = () => {
    if (!character || !selected) return;
    const next = loadLysn();
    next.profiles[selected] = { ...artistDraft, name: artistDraft.name.trim() || character.name, updatedAt: Date.now() };
    next.rooms[selected] = { ...next.rooms[selected], openerText: artistOpenerDraft };
    commit(next);
    setRoute("artist");
  };

  const startUserEdit = () => {
    setUserEditReturn(route);
    setUserDraft({ ...loadLysn().userProfile });
    setRoute("myEdit");
  };

  const saveUser = () => {
    const next = loadLysn();
    next.userProfile = { ...next.userProfile, ...userDraft, stickers: next.userProfile.stickers, stickerPacks: next.userProfile.stickerPacks, name: userDraft.name.trim() || "我" };
    if (next.userProfile.birthday !== state.userProfile.birthday) next.subscribedIds.forEach(id => {
      next.rooms[id] = { ...next.rooms[id], birthdayCards: {} };
      syncLysnDatedCards(next, id, localDay(new Date()));
    });
    commit(next);
    setRoute(userEditReturn === "settings" ? "settings" : userEditReturn === "chat" ? "chat" : "myProfile");
  };

  const updateSetting = (patch: Partial<LysnState["settings"]>) => {
    const next = loadLysn();
    next.settings = { ...next.settings, ...patch };
    commit(next);
  };

  const requestUpload = (target: UploadTarget) => {
    uploadTarget.current = target;
    uploadRef.current?.click();
  };

  const handleUpload = async (file?: File) => {
    if (!file) return;
    try {
      const assetId = await saveChatImageToIndexedDB(file);
      const url = `asset://${assetId}`;
      if (uploadTarget.current === "artistAvatar") setArtistDraft(prev => ({ ...prev, avatar: url }));
      if (uploadTarget.current === "artistCover") setArtistDraft(prev => ({ ...prev, cover: url }));
      if (uploadTarget.current === "userAvatar") setUserDraft(prev => ({ ...prev, avatar: url }));
      if (uploadTarget.current === "userCover") setUserDraft(prev => ({ ...prev, cover: url }));
      if (uploadTarget.current === "roomAvatar") updateRoom({ avatar: url });
      if (uploadTarget.current === "roomBackground") updateRoom({ backgroundUrl: url });
    } catch {
      onNotice?.("图片保存失败，请重新选择");
    }
  };

  const updatePacks = (packs: LysnStickerPack[]) => updateRoom({ stickerPacks: packs });
  const updateUserPacks = (packs: LysnStickerPack[]) => {
    const next = loadLysn();
    next.userProfile = { ...next.userProfile, stickerPacks: packs, stickers: [] };
    commit(next);
  };

  const toggleFavorite = (id: string) => {
    const saved = room.favoriteMessageIds || [];
    updateRoom({ favoriteMessageIds: saved.includes(id) ? saved.filter(x => x !== id) : [...saved, id] });
    onNotice?.(saved.includes(id) ? "已从 OUR BOX 移除" : "已收藏到 OUR BOX");
  };

  const openEditMessage = (message: LysnMessage) => {
    setEditDraft({ id: message.id, sender: message.sender, kind: message.kind, original: message.kind === "photo" ? message.photoDescription || message.original : message.original, translated: message.translated || message.original });
    setMessageMenu(null);
  };

  const back = () => {
    if (voiceViewer) { setVoiceViewer(null); return; }
    if (viewerUrl) { setViewerUrl(""); return; }
    if (roomSheet) { setRoomSheet(false); return; }
    if (route === "stickers") setRoute("details");
    else if (route === "myStickers") setRoute(null);
    else if (route === "ourBox" || route === "media" || route === "calendar") setRoute("details");
    else if (route === "details") setRoute(detailsReturn);
    else if (route === "artistEdit") setRoute("artist");
    else if (route === "myEdit") setRoute(userEditReturn);
    else if (route === "chat") { setChatSearchOpen(false); setEmojiOpen(false); setRoute(null); }
    else if (route === "settings") setRoute(settingsReturn);
    else if (route === "myProfile") setRoute(null);
    else if (route === "artist") setRoute(artistReturn);
    else if (tab !== "more") setTab("more");
    else onClose();
  };

  const header = (title: string, right?: ReactNode) => (
    <header className={styles.subHeader}>
      <button type="button" onClick={back} aria-label="返回"><ChevronLeft size={25}/></button>
      <strong>{title}</strong>
      <span className={styles.headerAction}>{right}</span>
    </header>
  );

  const editField = (label: string, value: string, setValue: (value: string) => void, placeholder = "") => (
    <label className={styles.field}><span>{label}</span><input value={value} placeholder={placeholder} onChange={e => setValue(e.target.value)} /></label>
  );
  const imageLinkField = (label: string, value: string, setValue: (value: string) => void) => (
    <label className={styles.field}><span>{label}</span><input value={value.startsWith("asset://") || value.startsWith("data:") ? "" : value} placeholder={value ? "已上传图片；粘贴链接可替换" : "粘贴图片 URL"} onChange={e => setValue(e.target.value)} /></label>
  );

  const filteredCharacters = characters.filter(c => `${state.profiles[c.id]?.name || c.name} ${state.profiles[c.id]?.group || ""}`.toLowerCase().includes(query.toLowerCase()));
  const root = route === null;

  const messageItems: Array<LysnMessage | LysnMessage[]> = [];
  for (const message of messages) {
    const previous = messageItems.at(-1);
    if (!chatSearchOpen && room.foldPhotos !== false && message.sender === "artist" && message.kind === "photo" && (message.imageUrl || message.photoDescription) && previous) {
      const last = Array.isArray(previous) ? previous.at(-1) : previous;
      if (last?.sender === "artist" && last.kind === "photo" && (last.imageUrl || last.photoDescription) && !last.quote && !message.quote && (last.photoCaptionDetached || !last.original || /^(?:照片|图片|photo|picture|사진)$/i.test(last.original)) && (message.photoCaptionDetached || !message.original || /^(?:照片|图片|photo|picture|사진)$/i.test(message.original)) && message.createdAt - last.createdAt < 120000) {
        if (Array.isArray(previous)) previous.push(message);
        else messageItems[messageItems.length - 1] = [previous, message];
        continue;
      }
    }
    messageItems.push(message);
  }

  const mediaItems = useMemo(() => [...messages].filter(m => m.sender === "artist" && (m.kind === "photo" || m.kind === "voice")).sort((a, b) => b.createdAt - a.createdAt), [messages]);

  const renderMessage = (item: LysnMessage | LysnMessage[]) => {
    if (Array.isArray(item)) {
      return (
        <div key={item[0].id} id={`lysn-msg-${item[0].id}`} className={styles.message}>
          <Avatar src={avatar} name={roomName} className={`${styles.messageAvatar} ${styles.artistAvatarRing}`}/>
          <div className={styles.messageBody}>
            <div className={styles.senderLine}><ArtistBadge/><b>{displayName}</b></div>
            <PhotoStack rows={item} onOpen={setViewerUrl} onEdit={openEditMessage}/>
          </div>
          <div className={styles.messageMeta}><time>{formatClock(item.at(-1)!.createdAt)}</time></div>
        </div>
      );
    }
    const m = item;
    if (m.celebration) return <button type="button" key={m.id} id={`lysn-msg-${m.id}`} className={styles.historyCard} onClick={() => openCelebration(m.celebration!)}><span>{m.celebration.kind === "birthday" ? "🎂  BIRTHDAY" : "♥  HAPPY bubble"}</span><b>{m.celebration.kind === "birthday" ? `${m.celebration.year} 年生日留言` : `订阅第 ${m.celebration.days} 天`}</b><small>点击查看卡片 › · {formatClock(m.createdAt)}</small></button>;
    if (m.sender === "system") return <div key={m.id} id={`lysn-msg-${m.id}`} className={styles.message}><span className={styles.system}>{m.original}</span></div>;
    const hasTranslation = m.sender === "artist" && Boolean(m.translated && m.translated !== m.original);
    const showTranslation = Boolean(translatedIds[m.id]);
    const displayText = hasTranslation && showTranslation && state.settings.translationMode === "replace" ? m.translated || m.original : m.original;
    const translationText = hasTranslation ? showName(m.translated || "") : "";
    const bubbleClick = () => {
      if (touchActionOpened.current) { touchActionOpened.current = false; return; }
      if (m.sender === "artist" && hasTranslation && m.kind !== "photo" && m.kind !== "sticker") {
        setTranslatedIds(prev => ({ ...prev, [m.id]: !prev[m.id] }));
      }
    };
    const openMenu = () => setMessageMenu(m);
    return (
      <div
        key={m.id}
        id={`lysn-msg-${m.id}`}
        className={`${styles.message} ${m.sender === "fan" ? styles.mine : ""} ${chatSearchTarget === m.id ? styles.searchHit : ""}`}
        onContextMenu={e => { e.preventDefault(); openMenu(); }}
        onTouchStart={() => {
          touchActionOpened.current = false;
          touchTimer.current = window.setTimeout(() => {
            touchTimer.current = null;
            touchActionOpened.current = true;
            openMenu();
          }, 520);
        }}
        onTouchEnd={() => { if (touchTimer.current) window.clearTimeout(touchTimer.current); touchTimer.current = null; }}
        onTouchMove={() => { if (touchTimer.current) window.clearTimeout(touchTimer.current); touchTimer.current = null; }}
      >
        {m.sender === "artist" && <Avatar src={avatar} name={roomName} className={`${styles.messageAvatar} ${styles.artistAvatarRing}`}/>}        
        <div className={styles.messageBody}>
          {m.sender === "artist" && <div className={styles.senderLine}><ArtistBadge/><b>{displayName}</b></div>}
          {m.quote && <div className={styles.quoteBubble}><span>ARTIST 的回复：</span><p>{showName(m.quote.original)}</p><small>{showName(m.quote.translated)}</small></div>}
          <div className={`${styles.bubble} ${m.kind === "voice" ? styles.voiceBubbleShell : ""} ${m.kind === "photo" ? styles.photoBubbleOnly : ""}`} onClick={bubbleClick}>
            {m.kind === "photo" && m.imageUrl && <button type="button" className={styles.photoButton} onClick={() => setViewerUrl(m.imageUrl || "")}><AssetImage src={m.imageUrl} className={styles.photo}/></button>}
            {m.kind === "photo" && !m.imageUrl && <button type="button" className={styles.textPhoto} onClick={() => openEditMessage(m)}><span className={styles.photoTextScroll}>{m.photoDescription || m.original}</span></button>}
            {m.kind === "sticker" && m.imageUrl && <AssetImage src={m.imageUrl} className={styles.stickerBubble}/>}
            {m.kind === "voice" && <VoicePlayer message={m} onNotice={onNotice} />}
            {m.kind !== "sticker" && m.kind !== "voice" && m.kind !== "photo" && <p>{showName(displayText)}</p>}
            {m.sender === "fan" && m.sourceText && <small className={styles.fanSourceText}>{m.sourceText}</small>}
            {hasTranslation && showTranslation && state.settings.translationMode === "fold" && m.kind !== "voice" && <small className={styles.translation}>{translationText}</small>}
          </div>
          {m.kind === "photo" && !m.photoCaptionDetached && m.original && !/^(?:照片|图片|photo|picture|사진)$/i.test(m.original) && <div className={`${styles.bubble} ${styles.legacyPhotoCaption}`}><p>{showName(m.original)}</p></div>}
          {m.kind === "voice" && <button type="button" className={styles.voiceTranscript} onClick={bubbleClick} aria-label={hasTranslation ? showTranslation ? "收起语音翻译" : "查看语音翻译" : "语音原文"}><span>{hasTranslation && showTranslation && state.settings.translationMode === "replace" ? translationText : showName(m.original)}</span>{hasTranslation && showTranslation && state.settings.translationMode === "fold" && <small>{translationText}</small>}</button>}
        </div>
        <div className={styles.messageMeta}>{m.sender === "fan" && <span className={`${styles.readReceipt} ${m.seenAt || messages.some(next => next.sender === "artist" && !next.opener && next.createdAt > m.createdAt) ? styles.readReceiptSeen : ""}`} aria-label={m.seenAt || messages.some(next => next.sender === "artist" && !next.opener && next.createdAt > m.createdAt) ? "已读" : "未读"}>{(m.seenAt || messages.some(next => next.sender === "artist" && !next.opener && next.createdAt > m.createdAt)) && <Check size={10} strokeWidth={3}/>}</span>}<time>{formatClock(m.createdAt)}</time></div>
      </div>
    );
  };

  const settingsSwitch = (label: string, checked: boolean, onChange: (value: boolean) => void, hint?: string) => (
    <label className={styles.settingRow}><span>{label}{hint && <small className={styles.rowHint}>{hint}</small>}</span><input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)}/></label>
  );

  return (
    <div className={styles.app} data-lysn-app-root="" data-root={root ? "true" : undefined}>
      <input ref={uploadRef} className={styles.hiddenInput} type="file" accept="image/*" onChange={e => { void handleUpload(e.currentTarget.files?.[0]); e.currentTarget.value = ""; }} />

      {root && <>
        <header className={styles.rootHeader}><h1>{tab === "friends" ? "FRIENDS" : tab === "chats" ? "CHATS" : "MORE"}</h1><div className={styles.rootActions}>{tab !== "more" ? <button type="button" aria-label="搜索" onClick={() => setSearchOpen(v => !v)}><Search size={23}/></button> : <button type="button" aria-label="设置" onClick={() => { setSettingsReturn(null); setRoute("settings"); }}><Settings2 size={22}/></button>}</div></header>
        {searchOpen && tab !== "more" && <input autoFocus className={styles.searchInput} aria-label="搜索角色" placeholder="搜索艺人" value={query} onChange={e => setQuery(e.target.value)} />}
        <main className={styles.rootScroll} key={tab}>
          {tab === "friends" && <><p className={styles.sectionLabel}>我的资料</p><button type="button" className={styles.myMini} onClick={() => setRoute("myProfile")}><Avatar src={user.avatar} name={user.name}/><span><b>{user.name}</b></span><ChevronRight size={18}/></button><div className={styles.sectionRule}/><p className={styles.sectionLabel}>推荐好友 <span>{filteredCharacters.length}</span></p>{filteredCharacters.map(c => <button type="button" className={styles.friendRow} key={c.id} onClick={() => { setArtistReturn(null); setSelected(c.id); setRoute("artist"); }}><Avatar src={state.profiles[c.id]?.avatar || c.avatar} name={c.name}/><span><b>{state.profiles[c.id]?.name || c.name}</b><small>{state.profiles[c.id]?.bio || state.profiles[c.id]?.group || ""}</small></span><ChevronRight size={16}/></button>)}{!characters.length && <p className={styles.empty}>还没有角色，先在小手机的角色页面创建。</p>}</>}
          {tab === "chats" && <><p className={styles.sectionLabel}>最近的聊天室</p>{characters.filter(c => state.subscribedIds.includes(c.id) && filteredCharacters.some(x => x.id === c.id)).sort((a, b) => Number(Boolean(state.rooms[b.id]?.pinned)) - Number(Boolean(state.rooms[a.id]?.pinned)) || (state.messages.filter(m => m.characterId === b.id).at(-1)?.createdAt || 0) - (state.messages.filter(m => m.characterId === a.id).at(-1)?.createdAt || 0)).map(c => { const rows = state.messages.filter(m => m.characterId === c.id); const last = rows.at(-1); const unread = rows.filter(m => m.sender === "artist" && m.createdAt > (state.readAt[c.id] || 0)).length; return <button type="button" className={styles.chatRow} key={c.id} onClick={() => openChat(c.id)}><Avatar src={state.profiles[c.id]?.avatar || c.avatar} name={c.name}/><span><b>{state.rooms[c.id]?.pinned ? "⌃ " : ""}{state.rooms[c.id]?.chatName || state.profiles[c.id]?.name || c.name}</b><small>{last?.original || "还没有消息"}</small></span><aside><time>{last ? new Date(last.createdAt).toLocaleDateString() : ""}</time>{unread > 0 && <i>{unread}</i>}</aside></button>; })}{!state.subscribedIds.length && <p className={styles.empty}>还没有聊天。到 FRIENDS 选择一位艺人，添加 bubble 好友。</p>}</>}
          {tab === "more" && <><button type="button" className={styles.moreProfile} onClick={() => setRoute("myProfile")}><Avatar src={user.avatar} name={user.name}/><b>{user.name}</b></button><div className={styles.sectionRule}/><button type="button" className={styles.moreRow} onClick={() => setRoute("myProfile")}><UserRound size={21}/>我的资料<ChevronRight size={19}/></button><button type="button" className={styles.moreRow} onClick={() => setRoute("myStickers")}><Smile size={21}/>我的表情包<ChevronRight size={19}/></button><button type="button" className={styles.moreRow} onClick={() => { setSettingsReturn(null); setRoute("settings"); }}><Settings2 size={21}/>设置<ChevronRight size={19}/></button><button type="button" className={styles.moreRow} onClick={onClose}><X size={21}/>返回桌面<ChevronRight size={19}/></button></>}
        </main>
        <nav className={styles.bottomNav} aria-label="LYSN 导航">{(["friends", "chats", "more"] as const).map(item => <button type="button" key={item} className={tab === item ? styles.activeTab : ""} onClick={() => { setTab(item); setSearchOpen(false); setQuery(""); }} aria-label={item === "friends" ? "好友" : item === "chats" ? "聊天" : "我的"}>{item === "friends" ? <UserRound size={24}/> : item === "chats" ? <MessageCircle size={24}/> : <MoreHorizontal size={25}/>}<small>{item === "friends" ? "好友" : item === "chats" ? "聊天" : "我的"}</small></button>)}</nav>
      </>}

      {route === "artist" && character && <div className={styles.fullProfile}>{profile?.cover ? <AssetImage src={profile.cover} className={styles.coverImage}/> : <div className={styles.coverFallback}/>}<div className={styles.coverShade}/><button type="button" className={styles.coverBack} onClick={back} aria-label="返回"><X size={29}/></button><button type="button" className={styles.coverEdit} onClick={startArtistEdit} aria-label="编辑艺人资料"><Settings2 size={21}/></button><div className={styles.profileIdentity}><Avatar src={avatar} name={displayName} className={`${styles.largeAvatar} ${styles.artistAvatarRing}`}/><h2><ArtistBadge/>{displayName}</h2><p>{profile?.bio || ""}</p>{profile?.group && <span className={styles.groupPill}>{profile.group} · {character.name}</span>}</div><div className={styles.profileFooter}>{!subscribed && <button type="button" className={styles.preSubscribeButton} onClick={() => { setDetailsReturn("artist"); setRoute("details"); setRoomSheet(true); }}>订阅前设置</button>}<button type="button" onClick={() => subscribed ? openChat(character.id) : beginSubscription(character.id)}>{subscribed ? "进入 bubble 聊天" : "添加 bubble 好友"}</button></div></div>}

      {route === "chat" && character && <><header className={styles.chatHeader}><button type="button" aria-label="返回聊天室列表" onClick={back}><ChevronLeft size={25}/></button><div className={styles.chatTitle}><strong>{roomName}</strong><BubbleBrand days={days}/></div><div className={styles.chatHeaderActions}><button type="button" aria-label="搜索聊天记录" onClick={() => { setChatSearchOpen(v => !v); setChatSearchQuery(""); setChatSearchTarget(null); setEmojiOpen(false); }}><Search size={21}/></button><button type="button" aria-label="聊天详情" onClick={() => { setDetailsReturn("chat"); setRoute("details"); }}><MoreHorizontal size={22}/></button></div></header><div className={styles.chatView}>{chatSearchOpen && <div className={styles.chatSearchPanel}><div className={styles.chatSearchField}><Search size={17}/><input autoFocus aria-label="搜索聊天消息" placeholder="搜索原文或翻译" value={chatSearchQuery} onChange={e => setChatSearchQuery(e.target.value)}/><button type="button" onClick={() => { setChatSearchOpen(false); setChatSearchQuery(""); setChatSearchTarget(null); }} aria-label="关闭搜索"><X size={17}/></button></div>{chatSearchQuery.trim() && <div className={styles.chatSearchResults}><small>{searchedMessages.length ? `找到 ${searchedMessages.length} 条消息` : "没有找到消息"}</small>{searchedMessages.map(m => <button type="button" key={m.id} onClick={() => { setChatSearchTarget(m.id); document.getElementById(`lysn-msg-${m.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }); }}><time>{formatDateGroup(m.createdAt)} {formatClock(m.createdAt)}</time><span>{m.original || m.translated}</span></button>)}</div>}</div>}{room.backgroundUrl && <div className={styles.chatBackground}><AssetImage src={room.backgroundUrl}/></div>}<main className={styles.messages}>{messageItems.length ? messageItems.map((item, index) => {
          const first = Array.isArray(item) ? item[0] : item;
          const previous = messageItems[index - 1];
          const lastDate = previous ? formatDateGroup((Array.isArray(previous) ? previous[0] : previous).createdAt) : "";
          const date = formatDateGroup(first.createdAt);
          return <Fragment key={first.id}>{date !== lastDate && <div className={styles.timelineDate}>{date.replaceAll("/", "-")}</div>}{renderMessage(item)}</Fragment>;
        }) : <div className={styles.empty}>{opening === selected ? "正在准备开场白…" : "还没有消息。点击发送召唤艺人。"}</div>}{room.historyInitialized && !messages.some(message => message.sender === "fan" || message.sender === "artist" && !message.opener) && <div className={styles.timelineNow}>今天 · 从这里开始聊天</div>}<div ref={endRef}/></main></div><div className={styles.composerWrap}><form className={styles.composer} onSubmit={e => { e.preventDefault(); void summonArtist(); }}><div className={styles.composerMain}><div className={styles.inputShell}><textarea rows={1} aria-label="回复艺人" placeholder={state.settings.deepRealism ? `${remaining}/3 条 · 每条 ${limit} 字` : "输入消息"} value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); sendFan(); } }} /></div><button type="button" className={styles.emojiToggle} aria-label="选择表情" aria-expanded={emojiOpen} onClick={() => { setEmojiCategory(category => userPacks.some(pack => pack.id === category) ? category : "all"); setEmojiOpen(v => !v); setChatSearchOpen(false); }}><Smile size={23}/></button><button type="submit" disabled={busy} aria-label="发送并召唤艺人回复" title="发送并召唤艺人回复">{busy ? <LoaderCircle size={19} className={styles.spin}/> : <ArrowUp size={19}/>}</button></div>{emojiOpen && <div className={styles.emojiPanel}><div className={styles.emojiCategories}><button type="button" className={emojiCategory === "all" ? styles.emojiCategoryActive : ""} onClick={() => setEmojiCategory("all")}>全部</button>{userPacks.map(pack => <button type="button" key={pack.id} className={emojiCategory === pack.id ? styles.emojiCategoryActive : ""} onClick={() => setEmojiCategory(pack.id)}>{pack.name}</button>)}</div><div className={styles.quickEmoji}>{(emojiCategory === "all" ? userPacks.flatMap(pack => pack.stickers) : userPacks.find(pack => pack.id === emojiCategory)?.stickers || []).map(sticker => <button type="button" key={sticker.id} title={`发送${sticker.name}`} onClick={() => sendFanSticker(sticker.name, sticker.imageUrl)}><AssetImage src={sticker.imageUrl}/></button>)}{userPacks.length === 0 && QUICK_EMOJI.map(emoji => <button key={emoji} type="button" onClick={() => { setDraft(value => value + emoji); setEmojiOpen(false); }} aria-label={`插入${emoji}`}>{emoji}</button>)}</div></div>}</form></div></>}

      {route === "details" && character && <><>{header("聊天详情")}</><main className={styles.detailsScroll}>
        <section className={styles.detailsCard}><button type="button" className={styles.identityRow} onClick={() => { setArtistReturn("details"); setRoute("artist"); }}><Avatar src={avatar} name={displayName} className={styles.artistAvatarRing}/><span><b><ArtistBadge/> {displayName}</b><small>查看艺人资料</small></span><ChevronRight size={19}/></button><div className={styles.identityRow}><Avatar src={room.avatar || user.avatar} name={room.nickname || user.name}/><span><b>{room.nickname || user.name}</b><small>当前聊天室的我的资料</small></span></div><button type="button" className={styles.ourBoxButton} onClick={() => setRoute("ourBox")}><OurBoxMark/> OUR BOX</button></section>
        <h3>聊天</h3><section className={styles.detailsCard}><button type="button" className={styles.detailsRow} onClick={() => setRoute("media")}><ImageIcon size={21}/>图片和语音<ChevronRight size={19}/></button><button type="button" className={styles.detailsRow} onClick={() => setRoomSheet(true)}><Settings2 size={21}/>聊天室设置<ChevronRight size={19}/></button><button type="button" className={styles.detailsRow} onClick={() => setRoute("calendar")}><CalendarDays size={21}/>日历<ChevronRight size={19}/></button><button type="button" className={styles.detailsRow} onClick={() => setRoute("stickers")}><Smile size={21}/>该聊天室的表情包<ChevronRight size={19}/></button></section>
        {subscribed && <button type="button" className={styles.clearChatButton} onClick={clearChat}><Trash2 size={16}/>清空聊天记录</button>}
        {subscribed ? <button type="button" className={styles.unsubscribeButton} onClick={() => { if (window.confirm(`取消订阅 ${displayName}？聊天记录会保留。`)) subscribe(character.id); }}>取消订阅</button> : <button type="button" className={styles.primaryButton} onClick={() => beginSubscription(character.id)}>添加 bubble 好友并进入聊天</button>}
      </main></>}

      {route === "calendar" && character && selected && <>{header("日历")}<LysnCalendar state={state} characterId={selected} artistName={displayName} avatar={avatar || ""} onDateChange={value => updateRoom({ subscriptionDate: value })} onBirthday={year => getBirthdayCard(selected, year)}/></>}

      {route === "ourBox" && <>{header("OUR BOX")}<main className={styles.libraryScroll}>{messages.filter(m => (room.favoriteMessageIds || []).includes(m.id)).length ? messages.filter(m => (room.favoriteMessageIds || []).includes(m.id)).map(m => <div key={m.id} className={styles.savedMessage}><time>{new Date(m.createdAt).toLocaleString()}</time><div>{m.sender === "artist" ? <Avatar src={avatar} name={displayName} className={styles.artistAvatarRing}/> : <Avatar src={room.avatar || user.avatar} name={room.nickname || user.name}/>}<p>{showName(m.original)}</p></div><button type="button" onClick={() => toggleFavorite(m.id)}>移出收藏</button></div>) : <p className={styles.empty}>长按消息，就能收藏到这里。</p>}</main></>}

      {route === "media" && <>{header("总览")}<main className={`${styles.libraryScroll} ${styles.mediaGrid}`}>{mediaItems.length ? mediaItems.map((m, index, arr) => <div key={m.id} className={styles.mediaTile}>{(index === 0 || formatDateGroup(arr[index - 1].createdAt) !== formatDateGroup(m.createdAt)) && <p className={styles.libraryDate}>{formatDateGroup(m.createdAt)}</p>}{m.kind === "photo" ? m.imageUrl ? <button type="button" className={styles.mediaImage} onClick={() => setViewerUrl(m.imageUrl || "")}><AssetImage src={m.imageUrl}/></button> : <button type="button" className={styles.textPhoto} onClick={() => openEditMessage(m)}><span className={styles.photoTextScroll}>{m.photoDescription || m.original}</span></button> : <button type="button" className={styles.mediaVoiceCard} onClick={() => setVoiceViewer(m)}><div className={styles.mediaVoiceCardName}>{displayName}</div><Avatar src={avatar} name={displayName} className={styles.mediaVoiceAvatar}/><div className={styles.mediaVoiceDuration}>{`00:${String(estimateVoiceSeconds(m)).padStart(2, "0")}`}</div></button>}</div>) : <p className={styles.empty}>艺人发送的图片和语音会自动收在这里。</p>}</main></>}

      {route === "myStickers" && <>{header("我的表情包")}<main className={styles.libraryScroll}><LysnStickerManager title="我的表情包" packs={userPacks} onChange={updateUserPacks} onNotice={onNotice}/></main></>}
      {route === "stickers" && <>{header("该聊天室的表情包")}<main className={styles.libraryScroll}><LysnStickerManager title="该聊天室的表情包" packs={room.stickerPacks || []} onChange={updatePacks} onNotice={onNotice}/></main></>}

      {route === "artistEdit" && character && <>{header("编辑艺人资料", <button type="button" onClick={saveArtist}>保存</button>)}<main className={styles.editScroll}><div className={styles.editCover}>{artistDraft.cover ? <AssetImage src={artistDraft.cover} className={styles.coverImage}/> : <div className={styles.coverFallback}/>}<button type="button" className={styles.editCoverButton} onClick={() => requestUpload("artistCover")}><Camera size={18}/>更换背景</button><button type="button" className={styles.editAvatarButton} onClick={() => requestUpload("artistAvatar")}><Avatar src={artistDraft.avatar} name={artistDraft.name} className={`${styles.editAvatar} ${styles.artistAvatarRing}`}/><Camera size={17}/></button></div><div className={styles.fields}>{editField("LYSN 昵称", artistDraft.name, value => setArtistDraft(prev => ({ ...prev, name: value })))}{editField("简介", artistDraft.bio || "", value => setArtistDraft(prev => ({ ...prev, bio: value })))}{editField("组合 / 所属", artistDraft.group || "", value => setArtistDraft(prev => ({ ...prev, group: value })))}{imageLinkField("头像图片链接（可选）", artistDraft.avatar, value => setArtistDraft(prev => ({ ...prev, avatar: value })))}{imageLinkField("背景图片链接（可选）", artistDraft.cover || "", value => setArtistDraft(prev => ({ ...prev, cover: value })))}<label className={styles.field}><span>开场白设置</span><textarea value={artistOpenerDraft} placeholder="用中文写内容也可以；会按艺人人设生成其使用语言的原文和中文译文。留空由艺人生成" onChange={e => setArtistOpenerDraft(e.target.value)} /></label><p>这里仅修改 LYSN 的显示资料，不影响 Chat 或 WVS。</p><button type="button" className={styles.primaryButton} onClick={saveArtist}>保存艺人资料</button></div></main></>}

      {route === "myProfile" && <div className={styles.fullProfile}>{user.cover ? <AssetImage src={user.cover} className={styles.coverImage}/> : <div className={styles.coverFallback}/>}<div className={styles.coverShade}/><button type="button" className={styles.coverBack} onClick={back} aria-label="返回"><X size={29}/></button><div className={styles.profileIdentity}><Avatar src={user.avatar} name={user.name} className={styles.largeAvatar}/><h2>{user.name}</h2><button type="button" className={styles.profileEditButton} onClick={startUserEdit}><Settings2 size={20}/>编辑个人资料</button></div></div>}

      {route === "myEdit" && <>{header("编辑个人资料", <button type="button" onClick={saveUser}>保存</button>)}<main className={styles.editScroll}><div className={styles.editCover}>{userDraft.cover ? <AssetImage src={userDraft.cover} className={styles.coverImage}/> : <div className={styles.coverFallback}/>}<button type="button" className={styles.editCoverButton} onClick={() => requestUpload("userCover")}><Camera size={18}/>更换背景</button><button type="button" className={styles.editAvatarButton} onClick={() => requestUpload("userAvatar")}><Avatar src={userDraft.avatar} name={userDraft.name} className={styles.editAvatar}/><Camera size={17}/></button></div><div className={styles.fields}>{editField("昵称", userDraft.name, value => setUserDraft(prev => ({ ...prev, name: value })))}{editField("生日（可选，例：2001-07-17）", userDraft.birthday, value => setUserDraft(prev => ({ ...prev, birthday: value })))}{editField("性别（可选）", userDraft.gender, value => setUserDraft(prev => ({ ...prev, gender: value })))}<button type="button" className={styles.primaryButton} onClick={saveUser}>保存个人资料</button></div></main></>}

      {route === "settings" && <>{header("设置")}<main className={styles.settingsScroll}><h3>基本信息</h3><button type="button" className={styles.settingRow} onClick={startUserEdit}><Avatar src={user.avatar} name={user.name}/><span>{user.name}</span><small>编辑个人资料</small><ChevronRight size={18}/></button><h3>通知与体验</h3>{settingsSwitch("LYSN 新消息通知", state.settings.notificationsEnabled, value => updateSetting({ notificationsEnabled: value }))}{settingsSwitch("艺人自主发消息", state.settings.autonomousMessages, value => updateSetting({ autonomousMessages: value }), "关闭后只在点发送时尝试生成新消息")}{settingsSwitch("加深拟真", state.settings.deepRealism, value => updateSetting({ deepRealism: value }), "每次艺人回复后或一天后可再发三条；字数随订阅天数增加")}{settingsSwitch("测试模式", state.settings.testMode === true, value => updateSetting({ testMode: value }), "打开后优先执行明确的发照片、语音和引用请求；默认关闭")}
        <h3>翻译显示</h3>{([ ["fold", "折叠翻译"], ["replace", "覆盖原文"] ] as const).map(([value, label]) => <button type="button" className={styles.settingRow} key={value} onClick={() => updateSetting({ translationMode: value })}><span>{label}</span>{state.settings.translationMode === value && <Check size={20} className={styles.selectedCheck}/>}</button>)}

      </main></>}

      {roomSheet && route === "details" && <div className={styles.overlay} onMouseDown={e => { if (e.target === e.currentTarget) setRoomSheet(false); }}><section className={`${styles.sheet} ${styles.roomSheet}`} role="dialog" aria-label="聊天室设置"><header><b>聊天室设置</b><button type="button" onClick={() => setRoomSheet(false)} aria-label="关闭"><X size={21}/></button></header><div className={styles.roomSheetScroll}><p className={styles.roomSection}>个人资料 <small>仅当前聊天室生效</small></p><button type="button" className={styles.settingRow} onClick={() => requestUpload("roomAvatar")}><span>个人头像</span><Avatar src={room.avatar || user.avatar} name={room.nickname || user.name}/><Camera size={17}/></button><label className={styles.field}><span>我的昵称 · 艺人称呼你时使用</span><input value={room.nickname || ""} placeholder={user.name} onChange={e => updateRoom({ nickname: e.target.value })}/></label><p className={styles.roomSection}>艺人</p><label className={styles.field}><span>聊天室名称 · 你看到的名字</span><input value={room.chatName || ""} placeholder={displayName} onChange={e => updateRoom({ chatName: e.target.value })}/></label><p className={styles.roomSection}>艺人泡泡状态</p><label className={styles.field}><span>出现频率</span><select value={room.activity || "normal"} onChange={e => updateRoom({ activity: e.target.value as LysnRoom["activity"] })}><option value="quiet">不常来</option><option value="normal">普通</option><option value="frequent">经常来</option></select></label><label className={styles.field}><span>看粉丝消息</span><select value={room.readStyle || "normal"} onChange={e => updateRoom({ readStyle: e.target.value as LysnRoom["readStyle"], nextFanReadAt: undefined })}><option value="rare">不常看</option><option value="normal">普通</option><option value="often">经常看</option></select></label><label className={styles.field}><span>引用粉丝消息</span><select value={room.quoteStyle || "normal"} onChange={e => updateRoom({ quoteStyle: e.target.value as LysnRoom["quoteStyle"] })}><option value="rare">很少引用</option><option value="normal">偶尔引用</option><option value="often">喜欢引用</option></select></label><p className={styles.settingsNote}>这些是大致偏好，看消息和引用会有随机变化；看过消息不一定马上回复。</p><p className={styles.roomSection}>当前聊天室背景</p><div className={styles.roomBackgroundControl}><div className={styles.roomBackgroundPreview}>{room.backgroundUrl ? <AssetImage src={room.backgroundUrl}/> : <span>默认背景</span>}</div><div className={styles.roomBackgroundActions}><button type="button" onClick={() => requestUpload("roomBackground")}>上传图片</button>{room.backgroundUrl && <button type="button" onClick={() => updateRoom({ backgroundUrl: "" })}>恢复默认</button>}</div></div><label className={styles.field}><span>或输入背景图片链接</span><input type="url" value={room.backgroundUrl?.startsWith("asset://") ? "" : room.backgroundUrl || ""} placeholder="https://…" onChange={e => updateRoom({ backgroundUrl: e.target.value.trim() })}/></label><p className={styles.roomSection}>通知与显示</p>{settingsSwitch("置顶聊天", Boolean(room.pinned), value => updateRoom({ pinned: value }))}{settingsSwitch("消息免打扰", Boolean(room.muted), value => updateRoom({ muted: value }))}{settingsSwitch("多图折叠展示", room.foldPhotos !== false, value => updateRoom({ foldPhotos: value }), "连续发送的多张图片叠放轮播，点击展开可逐张看")}</div></section></div>}

      {messageMenu && <div className={styles.overlay} onMouseDown={e => { if (e.target === e.currentTarget) setMessageMenu(null); }}><section className={`${styles.sheet} ${styles.actionSheet}`} role="dialog" aria-label="消息操作"><button type="button" className={styles.actionSheetButton} onClick={() => { toggleFavorite(messageMenu.id); setMessageMenu(null); }}><Bookmark size={18}/>{(room.favoriteMessageIds || []).includes(messageMenu.id) ? "取消收藏" : "收藏"}</button><button type="button" className={styles.actionSheetButton} onClick={() => openEditMessage(messageMenu)}><Pencil size={18}/>编辑</button><button type="button" className={styles.actionSheetButton} onClick={() => { setRerollTarget(messageMenu); setMessageMenu(null); }}><RotateCcw size={18}/>重回</button><button type="button" className={`${styles.actionSheetButton} ${styles.actionDanger}`} onClick={() => removeMessage(messageMenu.id)}><Trash2 size={18}/>删除</button><button type="button" className={styles.actionCancel} onClick={() => setMessageMenu(null)}>取消</button></section></div>}

      {rerollTarget && <div className={styles.overlay} onMouseDown={e => { if (e.target === e.currentTarget) setRerollTarget(null); }}><section className={`${styles.sheet} ${styles.actionSheet}`} role="dialog" aria-label="重回消息"><button type="button" className={styles.actionSheetButton} onClick={() => { void rerollMessage(rerollTarget, "single"); }}><RotateCcw size={18}/>重回本条</button><button type="button" className={styles.actionSheetButton} onClick={() => { void rerollMessage(rerollTarget, "session"); }}><RotateCcw size={18}/>重回本次</button><button type="button" className={styles.actionCancel} onClick={() => setRerollTarget(null)}>取消</button></section></div>}

      {editDraft && <div className={styles.overlay} onMouseDown={e => { if (e.target === e.currentTarget) setEditDraft(null); }}><section className={`${styles.sheet} ${styles.editMessageSheet}`} role="dialog" aria-label="编辑消息"><header><b>{editDraft.kind === "photo" ? "编辑照片描述" : "编辑消息"}</b><button type="button" onClick={() => setEditDraft(null)} aria-label="关闭"><X size={20}/></button></header><div className={styles.editMessageFields}><label className={styles.field}><span>{editDraft.kind === "photo" ? "画面描述" : "原文"}</span><textarea value={editDraft.original} onChange={e => setEditDraft(prev => prev ? { ...prev, original: e.target.value } : prev)} /></label>{editDraft.sender === "artist" && editDraft.kind !== "photo" && <label className={styles.field}><span>翻译</span><textarea value={editDraft.translated} onChange={e => setEditDraft(prev => prev ? { ...prev, translated: e.target.value } : prev)} /></label>}</div><button type="button" className={styles.primaryButton} disabled={!editDraft.original.trim()} onClick={saveEditedMessage}>{editDraft.kind === "photo" ? "仅保存文字" : "保存修改"}</button>{editDraft.kind === "photo" && <button type="button" className={styles.primaryButton} disabled={!editDraft.original.trim()} onClick={() => void generateEditedPhoto()}>开始生图</button>}</section></div>}

      {viewerUrl && <div className={styles.imageViewer} role="dialog" aria-label="查看图片" onClick={() => setViewerUrl("")}><button type="button" aria-label="关闭图片"><X size={26}/></button><AssetImage src={viewerUrl}/></div>}

      {subscriptionChoice && <LysnSubscriptionPicker artistName={state.profiles[subscriptionChoice]?.name || characters.find(c => c.id === subscriptionChoice)?.name || "艺人"} onClose={() => setSubscriptionChoice(null)} onChoose={date => { const id = subscriptionChoice; setSubscriptionChoice(null); if (id) subscribe(id, date); }}/>} 
      {celebrationEvent && route === "chat" && <LysnCelebrationCardView event={celebrationEvent} artistName={displayName} avatar={avatar || ""} letter={celebrationLetter} loading={celebrationLoading} error={celebrationError} onRetry={() => openCelebration(celebrationEvent)} onClose={() => setCelebrationEvent(null)}/>}

      {voiceViewer && <div className={styles.voiceViewer} role="dialog" aria-label="查看语音"><button type="button" className={styles.voiceViewerClose} onClick={() => setVoiceViewer(null)} aria-label="关闭语音"><X size={24}/></button><div className={styles.voiceViewerCard}><div className={styles.voiceViewerPortrait}><Avatar src={avatar} name={displayName} className={styles.voiceViewerAvatar}/><VoicePlayer message={voiceViewer} onNotice={onNotice} className={styles.voiceViewerPlayer} iconOnly/></div><h3>{displayName}</h3><p>语音 · 0:{String(estimateVoiceSeconds(voiceViewer)).padStart(2, "0")}</p><button type="button" className={styles.voiceViewerTranslation} onClick={() => setTranslatedIds(prev => ({ ...prev, [voiceViewer.id]: !prev[voiceViewer.id] }))} aria-label={translatedIds[voiceViewer.id] ? "收起语音翻译" : "查看语音翻译"}><span>{translatedIds[voiceViewer.id] && voiceViewer.translated && voiceViewer.translated !== voiceViewer.original && state.settings.translationMode === "replace" ? showName(voiceViewer.translated) : showName(voiceViewer.original)}</span>{translatedIds[voiceViewer.id] && voiceViewer.translated && voiceViewer.translated !== voiceViewer.original && state.settings.translationMode === "fold" && <small>{showName(voiceViewer.translated)}</small>}</button></div></div>}
    </div>
  );
}

function PhotoStack({ rows, onOpen, onEdit }: { rows: LysnMessage[]; onOpen: (url: string) => void; onEdit: (message: LysnMessage) => void }) {
  const [active, setActive] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [dragX, setDragX] = useState(0);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [flipping, setFlipping] = useState<1 | -1 | null>(null);
  const startX = useRef<number | null>(null);
  const startY = useRef<number | null>(null);
  const flipTimer = useRef<number | null>(null);
  const holdTimer = useRef<number | null>(null);
  const longPressed = useRef(false);
  useEffect(() => () => { if (flipTimer.current !== null) window.clearTimeout(flipTimer.current); if (holdTimer.current !== null) window.clearTimeout(holdTimer.current); }, []);
  const canFlip = (nextDirection: 1 | -1) => active + nextDirection >= 0 && active + nextDirection < rows.length;
  const flip = (nextDirection: 1 | -1) => {
    if (flipping || !canFlip(nextDirection)) { setDragX(0); return; }
    setDirection(nextDirection);
    setFlipping(nextDirection);
    setDragX(nextDirection === 1 ? -150 : 150);
    flipTimer.current = window.setTimeout(() => {
      setActive(index => index + nextDirection);
      setDragX(0);
      setFlipping(null);
      flipTimer.current = null;
    }, 230);
  };
  if (expanded) return <div className={styles.photoExpanded}><div className={styles.photoExpandedGrid}>{rows.map(row => <button type="button" key={row.id} onClick={() => row.imageUrl ? onOpen(row.imageUrl) : onEdit(row)} onContextMenu={e => { e.preventDefault(); onEdit(row); }} aria-label={`查看照片 ${rows.indexOf(row) + 1}`}>{row.imageUrl ? <AssetImage src={row.imageUrl}/> : <span className={styles.photoTextCard}><span className={styles.photoTextScroll}>{row.photoDescription || row.original}</span></span>}</button>)}</div><button type="button" className={styles.photoViewAll} onClick={() => setExpanded(false)}>收起照片</button></div>;
  return <div className={styles.stackWrap}><div className={styles.photoDeck} role="group" aria-label={`${rows.length} 张照片，左右滑动翻页`}>
    {rows.map((_, depth) => {
      const index = active + depth * direction;
      if (index < 0 || index >= rows.length) return null;
      const row = rows[index];
      const front = depth === 0;
      const moveX = front ? dragX : flipping && depth === 1 ? 0 : depth * 6;
      const moveY = front ? 0 : flipping && depth === 1 ? 0 : depth * 5;
      const angle = front ? dragX / 15 : flipping && depth === 1 ? 0 : depth * 3;
      return <button type="button" key={row.id} tabIndex={front ? 0 : -1} aria-hidden={!front} aria-label={`第 ${index + 1} 张，共 ${rows.length} 张；轻点或滑动翻页`} className={styles.photoCard} style={{ zIndex: rows.length - depth, transform: `translate(${moveX}px,${moveY}px) rotate(${angle}deg)`, transition: front && startX.current !== null && !flipping ? "none" : undefined, pointerEvents: front ? "auto" : "none" }}
        onDragStart={e => e.preventDefault()}
        onContextMenu={front ? e => { e.preventDefault(); onEdit(row); } : undefined}
        onPointerDown={front ? e => { if (flipping) return; startX.current = e.clientX; startY.current = e.clientY; longPressed.current = false; if (holdTimer.current !== null) window.clearTimeout(holdTimer.current); holdTimer.current = window.setTimeout(() => { longPressed.current = true; startX.current = null; onEdit(row); holdTimer.current = null; }, 520); e.currentTarget.setPointerCapture(e.pointerId); } : undefined}
        onPointerMove={front ? e => { if (startX.current === null || flipping) return; const delta = Math.max(-135, Math.min(135, e.clientX - startX.current)); const vertical = Math.abs(e.clientY - (startY.current ?? e.clientY)); if ((Math.abs(delta) > 8 || vertical > 8) && holdTimer.current !== null) { window.clearTimeout(holdTimer.current); holdTimer.current = null; } if (vertical > Math.abs(delta)) { setDragX(0); return; } const nextDirection = delta < 0 ? 1 : -1; setDragX(canFlip(nextDirection) ? delta : 0); if (Math.abs(delta) > 8 && canFlip(nextDirection)) setDirection(nextDirection); } : undefined}
        onPointerUp={front ? e => { if (holdTimer.current !== null) { window.clearTimeout(holdTimer.current); holdTimer.current = null; } if (longPressed.current) { longPressed.current = false; return; } if (startX.current === null) return; const delta = e.clientX - startX.current; const vertical = Math.abs(e.clientY - (startY.current ?? e.clientY)); startX.current = null; startY.current = null; if (vertical > 8 && vertical > Math.abs(delta)) { setDragX(0); return; } if (Math.abs(delta) > 28) flip(delta < 0 ? 1 : -1); else { setDragX(0); if (Math.abs(delta) < 8) row.imageUrl ? flip(1) : onEdit(row); } } : undefined}
        onPointerCancel={front ? () => { if (holdTimer.current !== null) window.clearTimeout(holdTimer.current); holdTimer.current = null; startX.current = null; startY.current = null; setDragX(0); } : undefined}
        onClick={front ? e => { if (e.detail === 0) flip(1); } : undefined}
        onKeyDown={front ? e => { if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); flip(e.key === "ArrowLeft" ? -1 : 1); } } : undefined}>
        {row.imageUrl ? <AssetImage src={row.imageUrl}/> : <span className={styles.photoTextCard}><span className={styles.photoTextScroll}>{row.photoDescription || row.original}</span></span>}
      </button>;
    })}
  </div><div className={styles.photoDeckControls}><button type="button" className={styles.photoViewAll} onClick={() => setExpanded(true)}>展开全部 {rows.length}</button></div></div>;
}
