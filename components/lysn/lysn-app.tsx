"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, Image as ImageIcon, LoaderCircle, Mic2, Send, Sparkles, UserRound, X } from "lucide-react";
import { loadCharacters, CHARACTERS_UPDATED_EVENT } from "@/lib/character-storage";
import type { Character } from "@/lib/character-types";
import { getChatImageFromIndexedDB } from "@/lib/chat-asset-storage";
import { sendBrowserNotification } from "@/lib/browser-notification";
import { resolveMediaForUse } from "@/lib/media-resolver";
import { resolveVoiceConfig, synthesizeSpeech, playAudioBlobViaMediaElement, unlockAudioPlayback } from "@/lib/tts-service";
import { generateLysn } from "@/lib/lysn-engine";
import { appendLysn, loadLysn, saveLysn, LYSN_EVENT, type LysnMessage, type LysnState } from "@/lib/lysn-storage";
import styles from "./lysn-app.module.css";

function AssetImage({ src, className = "" }: { src: string; className?: string }) {
  const [url, setUrl] = useState(src.startsWith("asset://") ? "" : src);
  useEffect(() => {
    let active = true;
    if (!src.startsWith("asset://")) { setUrl(src); return; }
    getChatImageFromIndexedDB(src.slice(8)).then(value => { if (active) setUrl(value || ""); });
    return () => { active = false; };
  }, [src]);
  return url ? <img src={url} className={className} alt="" /> : <span className={styles.fallback}><ImageIcon size={22}/></span>;
}
function Avatar({ src, name }: { src?: string | null; name: string }) {
  return <span className={styles.avatar}>{src ? <AssetImage src={src} /> : <span>{name.slice(0, 1) || <UserRound/>}</span>}</span>;
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
    } catch (e) { onNotice?.(e instanceof Error ? e.message : "语音播放失败"); }
    finally { setBusy(false); setPlaying(false); playback.current = null; }
  };
  return <button type="button" className={styles.voice} onClick={play} disabled={busy}><Mic2 size={17}/>{busy ? "合成中…" : playing ? "停止播放" : "播放语音"}</button>;
}

export function LysnApp({ onClose, onNotice }: { onClose: () => void; onNotice?: (text: string) => void }) {
  const [state, setState] = useState<LysnState>(() => loadLysn());
  const [characters, setCharacters] = useState<Character[]>(() => loadCharacters());
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [avatarDraft, setAvatarDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const update = () => setState(loadLysn());
    const updateCharacters = () => setCharacters(loadCharacters());
    window.addEventListener(LYSN_EVENT, update);
    window.addEventListener(CHARACTERS_UPDATED_EVENT, updateCharacters);
    return () => { window.removeEventListener(LYSN_EVENT, update); window.removeEventListener(CHARACTERS_UPDATED_EVENT, updateCharacters); };
  }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [state.messages.length, selected]);
  useEffect(() => {
    const handler = (event: Event) => {
      const id = (event as CustomEvent<{ characterId?: string }>).detail?.characterId;
      if (id && loadLysn().subscribedIds.includes(id)) open(id);
    };
    window.addEventListener("lysn-open-character", handler);
    return () => window.removeEventListener("lysn-open-character", handler);
  // open reads the latest persisted state; the event listener needs only the current subscription.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const character = characters.find(c => c.id === selected);
  const profile = selected ? state.profiles[selected] : undefined;
  const messages = selected ? state.messages.filter(m => m.characterId === selected) : [];
  const displayName = character ? profile?.name || character.name : "";
  const avatar = character ? profile?.avatar || character.avatar : "";
  const commit = (next: LysnState) => { saveLysn(next); setState(next); };
  const subscribe = (id: string) => {
    const next = loadLysn();
    next.subscribedIds = next.subscribedIds.includes(id) ? next.subscribedIds.filter(x => x !== id) : [...next.subscribedIds, id];
    if (next.subscribedIds.includes(id)) next.subscribedAt[id] = Date.now();
    commit(next);
    if (!next.subscribedIds.includes(id) && selected === id) setSelected(null);
  };
  const open = (id: string) => {
    if (!state.subscribedIds.includes(id)) return;
    const next = loadLysn(); next.readAt[id] = Date.now(); commit(next); setSelected(id);
  };
  const createArtistMessage = async (id: string, mode: "new" | "reply", fanText?: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const generated = await generateLysn(id, loadLysn().messages.filter(m => m.characterId === id), mode, fanText);
      let kind = generated.kind;
      let imageUrl: string | undefined;
      let photoId: string | undefined;
      if (kind === "photo") {
        const media = await resolveMediaForUse({ actor: { type: "character", characterId: id }, description: generated.photoDescription || generated.original, intentKind: generated.mediaIntent, channel: "bubble", targetId: id, appId: "lysn" });
        if (media?.imageUrl) { imageUrl = media.imageUrl; photoId = media.photoLibraryId; }
        else { kind = "text"; onNotice?.("没有匹配到能发送的照片，已改发文字消息"); }
      }
      appendLysn(id, [{ sender: "artist", kind, original: generated.original, translated: generated.translated, imageUrl, photoId }]);
      const next = loadLysn();
      if (selected !== id) { sendBrowserNotification(`${next.profiles[id]?.name || characters.find(c => c.id === id)?.name || "艺人"} · LYSN`, { body: generated.original.slice(0, 90), url: `/#lysn=${encodeURIComponent(id)}` }); }
      else { next.readAt[id] = Date.now(); saveLysn(next); }
      window.dispatchEvent(new CustomEvent("lysn-message-notice", { detail: { characterId: id, body: generated.original, title: `${next.profiles[id]?.name || characters.find(c => c.id === id)?.name || "艺人"} · LYSN` } }));
      onNotice?.("收到一条新的 Bubble 消息");
    } catch (e) { onNotice?.(e instanceof Error ? e.message : "消息生成失败"); }
    finally { setBusy(false); }
  };
  const sendReply = async () => {
    const text = draft.trim(); if (!selected || !text || busy) return;
    appendLysn(selected, [{ sender: "fan", kind: "text", original: text }]);
    setDraft("");
    await createArtistMessage(selected, "reply", text);
  };
  const editProfile = () => {
    setNameDraft(displayName); setAvatarDraft(avatar || ""); setProfileOpen(true);
  };
  const saveProfile = () => {
    if (!selected || !character) return;
    const next = loadLysn();
    next.profiles[selected] = { name: nameDraft.trim() || character.name, avatar: avatarDraft.trim(), updatedAt: Date.now() };
    commit(next); setProfileOpen(false);
    appendLysn(selected, [{ sender: "system", kind: "notice", original: "艺人更新了 LYSN 资料" }]);
  };
  return <div className={styles.app}>
    <header className={styles.header}><button type="button" onClick={selected ? () => setSelected(null) : onClose} aria-label="返回"><ChevronLeft size={23}/></button><strong>{selected ? displayName : "LYSN"}</strong>{selected ? <button type="button" onClick={editProfile} aria-label="艺人资料"><UserRound size={21}/></button> : <span/>}</header>
    {selected && character ? <>
      <div className={styles.channelInfo}><Avatar src={avatar} name={displayName}/><div><b>{displayName}</b><small>艺人频道 · 已订阅</small></div><button type="button" onClick={() => createArtistMessage(selected, "new")} disabled={busy} title="生成新的艺人消息">{busy ? <LoaderCircle size={19} className={styles.spin}/> : <Sparkles size={19}/>}</button></div>
      <main className={styles.messages}>{messages.length ? messages.map(m => <div key={m.id} className={`${styles.message} ${m.sender === "fan" ? styles.mine : ""}`}>
        {m.sender === "system" ? <span className={styles.system}>{m.original}</span> : <div className={styles.bubble}>
          {m.kind === "photo" && m.imageUrl ? <AssetImage src={m.imageUrl} className={styles.photo}/> : null}
          {m.kind === "voice" ? <VoiceBubble message={m} onNotice={onNotice}/> : null}
          <p>{m.original}</p>{m.sender === "artist" && m.translated && m.translated !== m.original ? <small className={styles.translation}>{m.translated}</small> : null}
          <time>{new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
        </div>}
      </div>) : <div className={styles.empty}>还没有 Bubble 消息。点右上角的星星，让艺人发送第一条。</div>}<div ref={endRef}/></main>
      <form className={styles.composer} onSubmit={e => { e.preventDefault(); void sendReply(); }}><input aria-label="回复艺人" placeholder="给艺人回复…" value={draft} onChange={e => setDraft(e.target.value)} disabled={busy}/><button type="submit" disabled={!draft.trim() || busy} aria-label="发送"><Send size={20}/></button></form>
    </> : <main className={styles.list}><p className={styles.intro}>订阅艺人，收看他们发来的 Bubble 消息。</p><h2>已订阅</h2>{characters.filter(c => state.subscribedIds.includes(c.id)).map(c => { const rows = state.messages.filter(m => m.characterId === c.id); const last = rows[rows.length - 1]; const unread = rows.filter(m => m.sender === "artist" && m.createdAt > (state.readAt[c.id] || 0)).length; return <button type="button" className={styles.row} key={c.id} onClick={() => open(c.id)}><Avatar src={state.profiles[c.id]?.avatar || c.avatar} name={state.profiles[c.id]?.name || c.name}/><span><b>{state.profiles[c.id]?.name || c.name}</b><small>{last?.original || "等待第一条消息"}</small></span>{unread ? <i>{unread}</i> : null}</button>; })}{!state.subscribedIds.length ? <p className={styles.hint}>还没有订阅艺人</p> : null}<h2>发现艺人</h2>{characters.filter(c => !state.subscribedIds.includes(c.id)).map(c => <div className={styles.row} key={c.id}><Avatar src={c.avatar} name={c.name}/><span><b>{c.name}</b><small>LYSN Bubble</small></span><button type="button" className={styles.subscribe} onClick={() => subscribe(c.id)}>订阅</button></div>)}{!characters.length ? <p className={styles.hint}>先在角色页面创建角色。</p> : null}</main>}
    {profileOpen && selected ? <div className={styles.overlay} onMouseDown={e => { if (e.target === e.currentTarget) setProfileOpen(false); }}><section className={styles.sheet}><header><b>LYSN 艺人资料</b><button type="button" onClick={() => setProfileOpen(false)}><X size={19}/></button></header><label>昵称<input value={nameDraft} onChange={e => setNameDraft(e.target.value)} maxLength={40}/></label><label>头像链接或素材地址<input value={avatarDraft} onChange={e => setAvatarDraft(e.target.value)} placeholder="图片 URL 或 asset://…"/></label><p>这里的昵称和头像只用于 LYSN，不会修改 Chat 或 WVS 资料。</p><button type="button" className={styles.save} onClick={saveProfile}>保存资料</button><button type="button" className={styles.unsubscribe} onClick={() => { subscribe(selected); setProfileOpen(false); }}>取消订阅</button></section></div> : null}
  </div>;
}
