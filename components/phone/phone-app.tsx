"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, Clock3, ContactRound, Delete, Keyboard, MicOff, Phone, PhoneOff, Search, Settings2, Star, Trash2, UserRound, X } from "lucide-react";
import { loadCharacters, CHARACTERS_UPDATED_EVENT } from "@/lib/character-storage";
import { loadSms, SMS_EVENT } from "@/lib/sms-storage";
import { resolveUserIdentity } from "@/lib/settings-storage";
import { createOrGetSession, findChatSessionById } from "@/lib/chat-storage";
import { resolveVoiceConfig, synthesizeSpeech, playAudioBlobViaMediaElement } from "@/lib/tts-service";
import { loadMediaBlob, storeMediaBlob } from "@/lib/media-cache-storage";
import { decidePhoneAnswer, generatePhoneReply, queuePhoneUserLine } from "@/lib/phone-engine";
import {
  appendPhoneCall,
  getCharacterPhoneNumber,
  getUserPhoneNumber,
  loadPhoneState,
  markMissedCallsSeen,
  savePhoneState,
  PHONE_EVENT,
  phoneId,
  setUserPhoneNumber,
  setCharacterPhoneNumber,
  togglePhoneFavorite,
  removePhoneCall,
  type PhoneCallRecord,
  type PhoneTranscriptLine,
} from "@/lib/phone-storage";
import styles from "./phone-app.module.css";
import { PhoneFavoriteReplay } from "./phone-favorite-replay";

type Tab = "favorites" | "recents" | "contacts" | "keypad";
type CallPhase = "ringing" | "incoming" | "connected" | "ended";

type ActiveCall = {
  id: string;
  characterId: string;
  number: string;
  direction: "incoming" | "outgoing";
  startedAt: number;
  connectedAt?: number;
  phase: CallPhase;
  status?: PhoneCallRecord["status"];
  transcript: PhoneTranscriptLine[];
};

function fmtDuration(sec: number) {
  const m = Math.floor(sec / 60).toString().padStart(2, "0");
  const s = Math.max(0, sec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}
function fmtRecent(ts: number) {
  const d = new Date(ts); const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

export function PhoneApp({ onClose, onNotice }: { onClose: () => void; onNotice?: (text: string) => void }) {
  const [tab, setTab] = useState<Tab>("recents");
  const [showPhoneSettings, setShowPhoneSettings] = useState(false);
  const [ringtoneDraft, setRingtoneDraft] = useState(() => loadPhoneState().ringtoneUrl || "");
  const [revision, setRevision] = useState(0);
  const [query, setQuery] = useState("");
  const [recentFilter, setRecentFilter] = useState<"all" | "missed">("all");
  const [expandedFavoriteId, setExpandedFavoriteId] = useState<string | null>(null);
  const [dial, setDial] = useState("");
  const [editingMe, setEditingMe] = useState(false);
  const [myNumberDraft, setMyNumberDraft] = useState(getUserPhoneNumber());
  const [editingCharacterId, setEditingCharacterId] = useState<string | null>(null);
  const [characterNumberDraft, setCharacterNumberDraft] = useState("");
  const [activeCall, setActiveCall] = useState<ActiveCall | null>(null);
  const [typed, setTyped] = useState("");
  const [queued, setQueued] = useState(0);
  const [busy, setBusy] = useState(false);
  const [uiHidden, setUiHidden] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const activeCallRef = useRef<ActiveCall | null>(null);
  const startOutgoingRef = useRef<((characterId: string) => Promise<void>) | null>(null);
  const audioAbortRef = useRef<(() => void) | null>(null);
  const characters = useMemo(() => loadCharacters(), [revision]);
  const calls = useMemo(() => loadPhoneState().calls, [revision]);
  const sms = useMemo(() => loadSms(), [revision]);

  useEffect(() => { activeCallRef.current = activeCall; }, [activeCall]);
  useEffect(() => { if (tab === "recents") markMissedCallsSeen(); }, [tab, revision]);
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("phone-call-state", { detail: activeCall?.phase === "connected"
      ? { active: true, characterId: activeCall.characterId, connectedAt: activeCall.connectedAt }
      : { active: false } }));
    return () => { window.dispatchEvent(new CustomEvent("phone-call-state", { detail: { active: false } })); };
  }, [activeCall?.phase, activeCall?.characterId, activeCall?.connectedAt]);
  useEffect(() => {
    const refresh = () => setRevision(v => v + 1);
    window.addEventListener(PHONE_EVENT, refresh); window.addEventListener(SMS_EVENT, refresh); window.addEventListener(CHARACTERS_UPDATED_EVENT, refresh);
    return () => { window.removeEventListener(PHONE_EVENT, refresh); window.removeEventListener(SMS_EVENT, refresh); window.removeEventListener(CHARACTERS_UPDATED_EVENT, refresh); };
  }, []);
  useEffect(() => {
    if (!activeCall?.connectedAt || activeCall.phase !== "connected") return;
    const tick = () => setElapsed(Math.floor((Date.now() - activeCall.connectedAt!) / 1000));
    tick(); const id = window.setInterval(tick, 1000); return () => window.clearInterval(id);
  }, [activeCall?.connectedAt, activeCall?.phase]);
  useEffect(() => {
    if (!uiHidden && transcriptRef.current) transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
  }, [activeCall?.transcript.length, uiHidden]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { sessionId?: string; answered?: boolean } | undefined;
      const session = detail?.sessionId ? findChatSessionById(detail.sessionId) : null;
      if (!session?.contactId) return;
      const character = loadCharacters().find(c => c.id === session.contactId);
      if (!character) return;
      const now = Date.now();
      const incoming: ActiveCall = { id: phoneId(), characterId: character.id, number: getCharacterPhoneNumber(character.id), direction: "incoming", startedAt: now, phase: detail?.answered ? "connected" : "incoming", connectedAt: detail?.answered ? now : undefined, transcript: [] };
      activeCallRef.current = incoming; setActiveCall(incoming);
    };
    window.addEventListener("phone-open-incoming", handler);
    return () => window.removeEventListener("phone-open-incoming", handler);
  }, []);

  useEffect(() => {
    const handler = (e: Event) => { const id = String((e as CustomEvent).detail?.characterId || ""); if (id) void startOutgoingRef.current?.(id); };
    window.addEventListener("phone-start-outgoing", handler); return () => window.removeEventListener("phone-start-outgoing", handler);
  }, []);

  const characterById = useCallback((id: string) => characters.find(c => c.id === id), [characters]);
  const aliasFor = useCallback((id: string) => {
    const thread = sms.threads.find(t => t.characterId === id && t.identityId === "real");
    const session = createOrGetSession(id);
    return thread?.alias || session.alias || characterById(id)?.name || "未知号码";
  }, [sms.threads, characterById]);

  const finishCall = useCallback((status: PhoneCallRecord["status"] = "completed") => {
    const call = activeCallRef.current; if (!call) return;
    audioAbortRef.current?.(); audioAbortRef.current = null;
    const endedAt = Date.now();
    const durationSec = call.connectedAt ? Math.max(0, Math.floor((endedAt - call.connectedAt) / 1000)) : 0;
    appendPhoneCall({ id: call.id, characterId: call.characterId, number: call.number, direction: call.direction, status, startedAt: call.startedAt, connectedAt: call.connectedAt, endedAt, durationSec, transcript: call.transcript, source: "phone" });
    setActiveCall(prev => prev ? { ...prev, phase: "ended", status } : null);
    setTimeout(() => { setActiveCall(null); setElapsed(0); setTyped(""); setQueued(0); setBusy(false); setUiHidden(false); }, 700);
  }, []);

  const startOutgoing = useCallback(async (characterId: string) => {
    const number = getCharacterPhoneNumber(characterId);
    const call: ActiveCall = { id: phoneId(), characterId, number, direction: "outgoing", startedAt: Date.now(), phase: "ringing", transcript: [] };
    activeCallRef.current = call; setActiveCall(call); setElapsed(0); setBusy(true);
    const decision = await decidePhoneAnswer(characterId);
    if (!activeCallRef.current || activeCallRef.current.id !== call.id) return;
    if (decision === "answer") {
      setActiveCall(prev => prev ? { ...prev, phase: "connected", connectedAt: Date.now() } : prev); setBusy(false); return;
    }
    setBusy(false); finishCall(decision === "busy" ? "busy" : decision === "decline" ? "declined" : "missed");
  }, [finishCall]);

  useEffect(() => { startOutgoingRef.current = startOutgoing; }, [startOutgoing]);

  const acceptIncoming = useCallback(() => setActiveCall(prev => { const next = prev ? { ...prev, phase: "connected" as const, connectedAt: Date.now() } : prev; activeCallRef.current = next; return next; }), []);

  const sendTyped = useCallback(() => {
    const text = typed.trim(); const call = activeCallRef.current;
    if (!text || !call || call.phase !== "connected" || busy) return;
    const { message } = queuePhoneUserLine(call.characterId, text);
    const line: PhoneTranscriptLine = { id: message.id, role: "user", original: text, createdAt: Date.now() };
    setActiveCall(prev => prev ? { ...prev, transcript: [...prev.transcript, line] } : prev);
    setTyped(""); setQueued(v => v + 1);
  }, [typed, busy]);

  const summon = useCallback(async () => {
    const call = activeCallRef.current; if (!call || call.phase !== "connected" || busy) return;
    setBusy(true);
    try {
      const result = await generatePhoneReply(call.characterId);
      for (const reply of result.lines) {
        const line: PhoneTranscriptLine = { id: reply.id, role: "assistant", original: reply.original, translated: reply.translated, createdAt: Date.now() };
        const voice = resolveVoiceConfig(call.characterId, "chat");
        if (voice) {
          try {
            const blob = await synthesizeSpeech(reply.original, voice); // translation is display-only, never sent to TTS
            if (blob) {
              line.audioRef = await storeMediaBlob(blob, blob.type || "audio/mpeg", "audio");
              const { promise, abort } = playAudioBlobViaMediaElement(blob); audioAbortRef.current = abort; await promise; audioAbortRef.current = null;
            }
          } catch { /* keep text reply even when TTS fails */ }
        }
        setActiveCall(prev => prev ? { ...prev, transcript: [...prev.transcript, line] } : prev);
      }
      setQueued(0);
      if (result.hangup) setTimeout(() => finishCall("completed"), 250);
    } catch (e) { onNotice?.(e instanceof Error ? e.message : "电话回复失败"); }
    finally { setBusy(false); }
  }, [busy, onNotice, finishCall]);

  const replayLine = useCallback(async (line: PhoneTranscriptLine) => {
    if (!line.audioRef) return;
    const media = await loadMediaBlob(line.audioRef); if (!media) return;
    const { promise } = playAudioBlobViaMediaElement(media.blob); await promise;
  }, []);

  if (activeCall) {
    const character = characterById(activeCall.characterId);
    const name = aliasFor(activeCall.characterId);
    const connected = activeCall.phase === "connected";
    return <div className={styles.callScreen}>
      <div className={styles.callBackdrop} style={character?.avatar ? { backgroundImage: `url(${character.avatar})` } : undefined} />
      <div className={styles.callTint} />
      <div className={styles.callTop}>
        <div className={styles.callName}>{name}</div>
        <div className={styles.callStatus}>{activeCall.phase === "incoming" ? "来电" : activeCall.phase === "ringing" ? "正在呼叫…" : activeCall.phase === "ended" ? "通话已结束" : fmtDuration(elapsed)}</div>
      </div>
      {!uiHidden && connected && <div className={styles.glassPanel}>
        <div ref={transcriptRef} className={styles.transcript}>
          {activeCall.transcript.map(line => <div key={line.id} className={`${styles.line} ${line.role === "user" ? styles.userLine : styles.charLine}`}>
            <div className={styles.original}>{line.original}</div>
            {line.role === "assistant" && line.translated && <div className={styles.translation}>{line.translated}</div>}
            {line.role === "assistant" && line.audioRef && <button className={styles.replayMini} onClick={() => replayLine(line)}>▶</button>}
          </div>)}
          {busy && <div className={`${styles.line} ${styles.charLine}`}><div className={styles.translation}>对方正在回应…</div></div>}
        </div>
        <div className={styles.inputRow}>
          <input value={typed} onChange={e => setTyped(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendTyped(); } }} placeholder="输入通话内容" />
          <button onClick={summon} disabled={busy} aria-label={queued ? `召唤回复，已发送 ${queued} 条` : "召唤回复"}>↑</button>
        </div>
      </div>}
      <div className={styles.callControls}>
        {activeCall.phase === "incoming" ? <>
          <button className={`${styles.roundBtn} ${styles.decline}`} onClick={() => finishCall("declined")}><PhoneOff /></button>
          <button className={`${styles.roundBtn} ${styles.accept}`} onClick={acceptIncoming}><Phone /></button>
        </> : <>
          {connected && <button className={styles.roundBtn} data-active={uiHidden ? "1" : "0"} onClick={() => setUiHidden(v => !v)} title="隐藏/显示台词"><MicOff /></button>}
          <button className={`${styles.roundBtn} ${styles.decline}`} onClick={() => finishCall(activeCall.phase === "ringing" ? "canceled" : "completed")}><PhoneOff /></button>
        </>}
      </div>
    </div>;
  }

  const filteredChars = characters.filter(c => !query.trim() || `${aliasFor(c.id)} ${getCharacterPhoneNumber(c.id)}`.toLowerCase().includes(query.trim().toLowerCase()));
  const filteredCalls = calls.filter(c => (recentFilter === "all" || c.status === "missed") && (!query.trim() || `${aliasFor(c.characterId)} ${c.number}`.toLowerCase().includes(query.trim().toLowerCase())));
  const favoriteCalls = calls.filter(c => c.favorite);
  const normalizedDial = dial.replace(/\D/g, "");
  const dialCandidates = normalizedDial.length >= 2 ? characters.filter(c => {
    const number = getCharacterPhoneNumber(c.id);
    return number && number.replace(/\D/g, "").includes(normalizedDial);
  }).slice(0, 5) : [];
  const matchDial = normalizedDial ? characters.find(c => getCharacterPhoneNumber(c.id).replace(/\D/g, "") === normalizedDial) : undefined;

  return <div className={styles.app}>
    <header className={styles.header}><button className={styles.backButton} aria-label="返回桌面" title="返回桌面" onClick={onClose}><ChevronLeft size={22}/></button><span>电话</span><button className={styles.backButton} aria-label="电话设置" title="电话设置" onClick={()=>{setRingtoneDraft(loadPhoneState().ringtoneUrl || "");setShowPhoneSettings(true)}}><Settings2 size={19}/></button></header>
    <main className={styles.main}>
      {tab === "recents" && <section><div className={styles.segment}><button className={recentFilter==="all"?styles.activeSeg:undefined} onClick={()=>setRecentFilter("all")}>所有通话</button><button className={recentFilter==="missed"?styles.activeSeg:undefined} onClick={()=>setRecentFilter("missed")}>未接来电</button></div><h1>最近通话</h1><div className={styles.search}><Search size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="搜索" /></div><div className={styles.list}>{filteredCalls.map(call => <div className={styles.row} key={call.id} onClick={()=>startOutgoing(call.characterId)}><div className={styles.avatar}>{characterById(call.characterId)?.avatar ? <img src={characterById(call.characterId)!.avatar!} alt=""/> : aliasFor(call.characterId).slice(0,1)}</div><div className={styles.rowText}><strong className={call.status === "missed" ? styles.missed : undefined}>{aliasFor(call.characterId)}</strong><span>{call.direction === "incoming" ? "来电" : "去电"}{call.status !== "completed" ? ` · ${call.status === "missed" ? "未接" : call.status === "busy" ? "忙线" : call.status === "declined" ? "已拒绝" : "已取消"}` : call.durationSec ? ` · ${fmtDuration(call.durationSec)}` : ""}</span></div><span className={styles.time}>{fmtRecent(call.startedAt)}</span><button className={styles.infoBtn} onClick={e=>{e.stopPropagation(); togglePhoneFavorite(call.id)}} aria-label={call.favorite ? "取消收藏" : "收藏通话"}><Star fill={call.favorite ? "currentColor" : "none"} size={17}/></button><button className={styles.deleteCallBtn} onClick={e=>{e.stopPropagation(); removePhoneCall(call.id)}} aria-label="删除通话记录"><Trash2 size={17}/></button></div>)}</div></section>}
      {tab === "contacts" && <section><h1>通讯录</h1><div className={styles.search}><Search size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="搜索" /></div><button className={styles.meCard} onClick={()=>{setMyNumberDraft(getUserPhoneNumber());setEditingMe(true)}}><div className={styles.meAvatar}><UserRound/></div><div><strong>{resolveUserIdentity(characters[0]?.id || "", "chat")?.name || "我的名片"}</strong><span>{getUserPhoneNumber() || "点击填写我的电话号码"}</span></div></button><div className={styles.list}>{filteredChars.map(c=><div className={styles.row} key={c.id} onClick={()=>{setEditingCharacterId(c.id);setCharacterNumberDraft(getCharacterPhoneNumber(c.id));}}><div className={styles.avatar}>{c.avatar?<img src={c.avatar} alt=""/>:c.name.slice(0,1)}</div><div className={styles.rowText}><strong>{aliasFor(c.id)}</strong><span>{getCharacterPhoneNumber(c.id)||"未设置号码 · 点击编辑"}</span></div><button className={styles.phoneMini} onClick={e=>{e.stopPropagation();startOutgoing(c.id)}} disabled={!getCharacterPhoneNumber(c.id)}><Phone size={18}/></button></div>)}</div></section>}
      {tab === "favorites" && <section><h1>个人收藏</h1><p className={styles.subtle}>点开回放，上下滑动查看双方说过的每一句；滑到对方的话时播放已保存的语音。</p><div className={styles.list}>{favoriteCalls.map(call=><div className={styles.favoriteGroup} key={call.id}><div className={styles.favoriteCard}><div><strong>{aliasFor(call.characterId)}</strong><span>{new Date(call.startedAt).toLocaleString("zh-CN")} · {fmtDuration(call.durationSec)}</span></div><button onClick={()=>setExpandedFavoriteId(id=>id===call.id?null:call.id)} aria-expanded={expandedFavoriteId===call.id} aria-controls={`phone-replay-${call.id}`}>{expandedFavoriteId===call.id?"收起":"回放"}</button><button onClick={()=>togglePhoneFavorite(call.id)} aria-label="取消收藏"><Star fill="currentColor" size={18}/></button><button className={styles.favoriteDelete} onClick={()=>removePhoneCall(call.id)} aria-label="删除通话记录"><Trash2 size={18}/></button></div>{expandedFavoriteId===call.id && <PhoneFavoriteReplay call={call} name={aliasFor(call.characterId)} />}</div>)}</div></section>}
      {tab === "keypad" && <section className={styles.keypadPage}><div className={styles.dialDisplay}>{dial || " "}</div><button className={styles.addNumber}>添加号码</button>{dialCandidates.length > 0 && !matchDial && <div className={styles.dialSuggestions}>{dialCandidates.map(c=><button key={c.id} onClick={()=>setDial(getCharacterPhoneNumber(c.id))}><span className={styles.suggestionAvatar}>{c.avatar?<img src={c.avatar} alt=""/>:aliasFor(c.id).slice(0,1)}</span><span><strong>{aliasFor(c.id)}</strong><small>{getCharacterPhoneNumber(c.id)}</small></span></button>)}</div>}{matchDial && <div className={styles.dialMatch}>{aliasFor(matchDial.id)} · {getCharacterPhoneNumber(matchDial.id)}</div>}<div className={styles.keypad}>{[["1",""],["2","ABC"],["3","DEF"],["4","GHI"],["5","JKL"],["6","MNO"],["7","PQRS"],["8","TUV"],["9","WXYZ"],["*",""],["0","+"],["#",""]].map(([n,l])=><button key={n} onClick={()=>setDial(v=>v+n)}><strong>{n}</strong><span>{l}</span></button>)}</div><div className={styles.keypadBottom}><span/><button className={styles.callKey} disabled={!matchDial} onClick={()=>matchDial&&startOutgoing(matchDial.id)}><Phone/></button><button className={styles.deleteKey} onClick={()=>setDial(v=>v.slice(0,-1))}><Delete/></button></div></section>}
    </main>
    <nav className={styles.tabs}><button className={tab==="favorites"?styles.selected:undefined} onClick={()=>setTab("favorites")}><Star/><span>个人收藏</span></button><button className={tab==="recents"?styles.selected:undefined} onClick={()=>setTab("recents")}><Clock3/><span>最近通话</span></button><button className={tab==="contacts"?styles.selected:undefined} onClick={()=>setTab("contacts")}><ContactRound/><span>通讯录</span></button><button className={tab==="keypad"?styles.selected:undefined} onClick={()=>setTab("keypad")}><Keyboard/><span>拨号键盘</span></button></nav>
    {showPhoneSettings && <div className={styles.modal} role="dialog" aria-modal="true" aria-label="电话设置"><div className={styles.modalCard}><button className={styles.modalClose} onClick={()=>setShowPhoneSettings(false)} aria-label="关闭"><X/></button><h2>电话设置</h2><label>来电铃声 MP3 URL<input type="url" placeholder="https://.../ringtone.mp3" value={ringtoneDraft} onChange={event=>setRingtoneDraft(event.target.value)}/></label><p className={styles.modalHint}>角色来电时优先播放这个地址；留空则继续使用 Chat 提示音里的来电铃声。</p><button className={styles.saveBtn} onClick={()=>{const url=ringtoneDraft.trim();if(url && !/^https?:\/\//i.test(url)){onNotice?.("请填写 http 或 https 音频地址");return;}const next=loadPhoneState();next.ringtoneUrl=url;savePhoneState(next);setShowPhoneSettings(false)}}>保存</button></div></div>}
    {editingMe && <div className={styles.modal}><div className={styles.modalCard}><button className={styles.modalClose} onClick={()=>setEditingMe(false)}><X/></button><h2>我的名片</h2><label>电话号码<input value={myNumberDraft} onChange={e=>setMyNumberDraft(e.target.value)} placeholder="例如 +86 138 0000 0000"/></label><p className={styles.modalHint}>这里与 SMS 的真实号码共用同一份数据，保存后两边同步。</p><button className={styles.saveBtn} onClick={()=>{setUserPhoneNumber(myNumberDraft);setEditingMe(false)}}>保存</button></div></div>}
    {editingCharacterId && <div className={styles.modal}><div className={styles.modalCard}><button className={styles.modalClose} onClick={()=>setEditingCharacterId(null)}><X/></button><h2>{aliasFor(editingCharacterId)}</h2><label>电话号码<input value={characterNumberDraft} onChange={e=>setCharacterNumberDraft(e.target.value)} placeholder="输入角色电话号码"/></label><p className={styles.modalHint}>Phone 与 SMS 共用这个号码；在任一处修改，另一边都会同步显示。</p><button className={styles.saveBtn} onClick={()=>{setCharacterPhoneNumber(editingCharacterId,characterNumberDraft);setEditingCharacterId(null)}}>保存</button></div></div>}
  </div>;
}
