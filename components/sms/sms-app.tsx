"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Ban,
  Check,
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  Menu,
  Mic,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings2,
  SquarePen,
  Trash2,
  Unlock,
  UserRound,
  Video,
  X,
} from "lucide-react";
import { CHARACTERS_UPDATED_EVENT, loadCharacters } from "@/lib/character-storage";
import type { Character } from "@/lib/character-types";
import { generateProactiveSms, generateSmsReply } from "@/lib/sms-engine";
import {
  SMS_COUNTRIES,
  SMS_UPDATED_EVENT,
  appendSmsMessage,
  createVirtualNumber,
  deleteSmsThread,
  deleteVirtualNumber,
  ensureSmsThread,
  getCharacterSmsPhone,
  getSmsMessages,
  getSmsSenderPhone,
  loadSmsState,
  markSmsThreadRead,
  setCharacterSmsPhone,
  updateSmsSettings,
  updateSmsThread,
  type SmsCountryCode,
  type SmsMessage,
  type SmsSenderIdentityId,
  type SmsState,
  type SmsThread,
} from "@/lib/sms-storage";
import styles from "./sms-app.module.css";

type Sheet = "menu" | "compose" | "settings" | "details" | "identity" | null;
type Props = { onClose: () => void; onNotice?: (message: string) => void };

function formatListDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}/${d.getDate()}`;
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

function formatClock(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function dayLabel(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return "今天";
  const y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return "昨天";
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

function Avatar({ character, small = false }: { character?: Character; small?: boolean }) {
  return (
    <span className={small ? styles.avatarSmall : styles.avatar}>
      {character?.avatar ? <img src={character.avatar} alt="" /> : <UserRound size={small ? 20 : 25} />}
    </span>
  );
}

function ChatAvatar({ character }: { character?: Character }) {
  return (
    <span className={styles.chatAvatar}>
      {character?.avatar ? <img src={character.avatar} alt="" /> : (character?.name?.slice(0, 1) || "?")}
    </span>
  );
}

function latestMessage(state: SmsState, threadId: string): SmsMessage | undefined {
  return state.messages.filter(row => row.threadId === threadId).sort((a, b) => b.createdAt - a.createdAt)[0];
}

export function SmsApp({ onClose, onNotice }: Props) {
  const [state, setState] = useState<SmsState>(() => loadSmsState());
  const [characters, setCharacters] = useState<Character[]>(() => loadCharacters());
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [search, setSearch] = useState("");
  const [contactSearch, setContactSearch] = useState("");
  const [draft, setDraft] = useState("");
  const [editMode, setEditMode] = useState(false);
  const [showTranslations, setShowTranslations] = useState<Set<string>>(new Set());
  const [replying, setReplying] = useState(false);
  const [proactiveLoading, setProactiveLoading] = useState(false);
  const [virtualCountry, setVirtualCountry] = useState<SmsCountryCode>("KR");
  const [userPhoneDraft, setUserPhoneDraft] = useState(state.settings.userPhone);
  const [charPhoneDraft, setCharPhoneDraft] = useState("");
  const [charCountryDraft, setCharCountryDraft] = useState<SmsCountryCode>("CN");
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const replyTimer = useRef<number | null>(null);

  const refresh = () => setState(loadSmsState());
  useEffect(() => {
    const onSms = () => refresh();
    const onChars = () => setCharacters(loadCharacters());
    window.addEventListener(SMS_UPDATED_EVENT, onSms);
    window.addEventListener(CHARACTERS_UPDATED_EVENT, onChars);
    return () => {
      window.removeEventListener(SMS_UPDATED_EVENT, onSms);
      window.removeEventListener(CHARACTERS_UPDATED_EVENT, onChars);
      if (replyTimer.current) window.clearTimeout(replyTimer.current);
    };
  }, []);

  const activeThread = activeThreadId ? state.threads.find(row => row.id === activeThreadId) ?? null : null;
  const activeCharacter = activeThread ? characters.find(row => row.id === activeThread.characterId) : undefined;
  const activeMessages = useMemo(() => activeThread ? state.messages.filter(row => row.threadId === activeThread.id).sort((a, b) => a.createdAt - b.createdAt) : [], [state, activeThread]);

  useEffect(() => {
    if (!activeThreadId) return;
    markSmsThreadRead(activeThreadId);
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }));
  }, [activeThreadId, activeMessages.length]);

  useEffect(() => {
    if (!activeThread) return;
    const phone = getCharacterSmsPhone(activeThread.characterId);
    setCharPhoneDraft(phone.phone);
    setCharCountryDraft(phone.country);
  }, [activeThreadId]);

  const visibleThreads = useMemo(() => {
    const q = search.trim().toLowerCase();
    return [...state.threads]
      .filter(thread => {
        if (!state.messages.some(row => row.threadId === thread.id)) return false;
        if (!q) return true;
        const character = characters.find(row => row.id === thread.characterId);
        const phone = getCharacterSmsPhone(thread.characterId).phone;
        const latest = latestMessage(state, thread.id)?.original || "";
        return [character?.name || "", phone, getSmsSenderPhone(thread, state), latest].some(value => value.toLowerCase().includes(q));
      })
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }, [state, characters, search]);

  const filteredContacts = useMemo(() => {
    const q = contactSearch.trim().toLowerCase();
    return characters.filter(char => !q || char.name.toLowerCase().includes(q) || String(char.wechatID || "").includes(q));
  }, [characters, contactSearch]);

  function openThread(thread: SmsThread) {
    setActiveThreadId(thread.id);
    setSheet(null);
    setDraft("");
    setEditMode(false);
  }

  function startRealThread(characterId: string) {
    const thread = ensureSmsThread(characterId, "real");
    refresh();
    openThread(thread);
  }

  function switchIdentity(identity: SmsSenderIdentityId) {
    if (!activeThread) return;
    const next = ensureSmsThread(activeThread.characterId, identity);
    refresh();
    setActiveThreadId(next.id);
    setSheet(null);
  }

  async function requestReply(threadId: string) {
    setReplying(true);
    try {
      const result = await generateSmsReply(threadId);
      const current = loadSmsState().threads.find(row => row.id === threadId);
      if (!current) return;
      if (result.recognition && current.senderIdentityId !== "real") {
        updateSmsThread(threadId, { recognition: result.recognition, recognitionNote: result.recognitionNote });
      }
      for (const row of result.messages) {
        appendSmsMessage(threadId, { sender: "character", original: row.original, translated: row.translated, status: "delivered" });
      }
      if (result.blockSender) updateSmsThread(threadId, { blockedByCharacter: true });
    } catch (error) {
      onNotice?.(error instanceof Error ? error.message : "短信回复失败，请重试。");
    } finally {
      setReplying(false);
      refresh();
    }
  }

  function scheduleReply(threadId: string) {
    if (replyTimer.current) window.clearTimeout(replyTimer.current);
    replyTimer.current = window.setTimeout(() => { void requestReply(threadId); }, 950);
  }

  function sendMessage() {
    if (!activeThread) return;
    const text = draft.trim();
    if (!text) return;
    const latestThread = loadSmsState().threads.find(row => row.id === activeThread.id);
    if (!latestThread) return;
    appendSmsMessage(activeThread.id, {
      sender: "user",
      original: text,
      translated: text,
      status: latestThread.blockedByCharacter ? "blocked" : "delivered",
    });
    setDraft("");
    refresh();
    if (!latestThread.blockedByUser && !latestThread.blockedByCharacter) scheduleReply(activeThread.id);
  }

  async function refreshProactive() {
    if (!activeThread || proactiveLoading) return;
    setProactiveLoading(true);
    try {
      const realThread = ensureSmsThread(activeThread.characterId, "real");
      const result = await generateProactiveSms(activeThread.characterId, true);
      updateSmsThread(realThread.id, { lastProactiveAt: Date.now() });
      if (!result.send) {
        onNotice?.(`${activeCharacter?.name || "角色"}现在没有想主动发短信。`);
        return;
      }
      result.messages.forEach(row => appendSmsMessage(realThread.id, { sender: "character", original: row.original, translated: row.translated, status: "delivered", proactive: true }));
      setActiveThreadId(realThread.id);
      onNotice?.("已刷新角色主动短信。");
    } catch (error) {
      onNotice?.(error instanceof Error ? error.message : "主动短信生成失败。");
    } finally {
      setProactiveLoading(false);
      refresh();
      setSheet(null);
    }
  }

  function toggleUserBlock() {
    if (!activeThread) return;
    updateSmsThread(activeThread.id, { blockedByUser: !activeThread.blockedByUser });
    refresh();
  }

  function saveCharacterPhone() {
    if (!activeThread) return;
    setCharacterSmsPhone(activeThread.characterId, charPhoneDraft, charCountryDraft);
    onNotice?.("短信号码已保存。");
    refresh();
  }

  function createNumber() {
    const row = createVirtualNumber(virtualCountry);
    refresh();
    onNotice?.(`已生成 ${row.countryName}虚拟号 ${row.phone}`);
  }

  function removeVirtual(id: string) {
    if (!deleteVirtualNumber(id)) {
      onNotice?.("这个虚拟号已有短信线程，先删除相关会话才能移除号码。");
      return;
    }
    refresh();
  }

  function closeSheet() { setSheet(null); }

  function renderList() {
    return (
      <div className={`${styles.screen} ${styles.listScreen}`}>
        <header className={styles.listHeader}>
          <div className={styles.headerActions}>
            <button className={styles.glassButton} onClick={() => setEditMode(value => !value)}>{editMode ? "完成" : "编辑"}</button>
            <button className={styles.circleButton} onClick={() => setSheet("menu")} aria-label="菜单"><Menu size={22}/></button>
          </div>
          <h1>信息</h1>
        </header>
        {visibleThreads.length ? (
          <div className={styles.listScroll}>
            {visibleThreads.map(thread => {
              const character = characters.find(row => row.id === thread.characterId);
              const last = latestMessage(state, thread.id);
              const virtual = thread.senderIdentityId !== "real";
              return (
                <button key={thread.id} className={styles.threadRow} onClick={() => editMode ? undefined : openThread(thread)}>
                  <Avatar character={character}/>
                  <span className={styles.threadMain}>
                    <span className={styles.threadTop}>
                      <span className={styles.threadName}>{thread.unreadCount ? <i className={styles.unreadDot}/> : null}{character?.name || getCharacterSmsPhone(thread.characterId).phone || "未知联系人"}</span>
                      <span className={styles.threadDate}>{formatListDate(thread.updatedAt)}</span>
                    </span>
                    <span className={styles.threadPreview}>{last?.original || "新对话"}</span>
                    {virtual ? <span className={styles.threadMeta}>发送自 {getSmsSenderPhone(thread, state)} · 虚拟号</span> : null}
                  </span>
                  {editMode ? (
                    <span className={styles.editDelete} onClick={event => { event.stopPropagation(); deleteSmsThread(thread.id); refresh(); }}><Trash2 size={14}/></span>
                  ) : <ChevronRight className={styles.chevron} size={18}/>} 
                </button>
              );
            })}
          </div>
        ) : (
          <div className={styles.empty}><b>还没有信息</b><small>点右下角写一条短信，角色短信和 Chat 会共享同一段关系记忆。</small></div>
        )}
        <div className={styles.bottomFloat}>
          <label className={styles.searchBar}><Search size={19}/><input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索"/><Mic size={18}/></label>
          <button className={styles.composeButton} onClick={() => setSheet("compose")} aria-label="新信息"><SquarePen size={22}/></button>
        </div>
      </div>
    );
  }

  function renderThread() {
    if (!activeThread || !activeCharacter) return renderList();
    const senderPhone = getSmsSenderPhone(activeThread, state);
    let lastDay = "";
    return (
      <div className={`${styles.screen} ${styles.chatScreen}`}>
        <header className={styles.chatHeader}>
          <button className={styles.circleButton} onClick={() => { setActiveThreadId(null); setSheet(null); }}><ChevronLeft size={25}/></button>
          <button className={styles.chatIdentity} onClick={() => setSheet("details")}>
            <ChatAvatar character={activeCharacter}/>
            <b>{activeCharacter.name} ›</b>
            <small>{getCharacterSmsPhone(activeCharacter.id).phone || "未设置对方号码"}</small>
          </button>
          <button className={styles.circleButton} onClick={() => setSheet("details")}><Video size={22}/></button>
        </header>
        <div className={styles.messageScroll} ref={scrollRef}>
          {activeMessages.map(message => {
            const key = dayKey(message.createdAt);
            const showDay = key !== lastDay;
            lastDay = key;
            const mine = message.sender === "user";
            const showTranslation = state.settings.translationEnabled && message.sender === "character" && message.translated && message.translated !== message.original;
            return (
              <div key={message.id}>
                {showDay ? <div className={styles.dayLabel}>{dayLabel(message.createdAt)}</div> : null}
                <div className={`${styles.messageRow} ${mine ? styles.mine : styles.theirs}`}>
                  <div className={styles.bubbleWrap}>
                    {!mine ? <span><div className={styles.bubble}>{message.original}</div>{showTranslation ? <><button className={styles.translationToggle} onClick={() => setShowTranslations(prev => { const next = new Set(prev); next.has(message.id) ? next.delete(message.id) : next.add(message.id); return next; })}>{showTranslations.has(message.id) ? "收起译文" : "译"}</button>{showTranslations.has(message.id) ? <div className={styles.translation}>{message.translated}</div> : null}</> : null}</span> : null}
                    {mine ? <div className={`${styles.bubble} ${message.status === "blocked" ? styles.blocked : ""}`}>{message.original}</div> : null}
                    <span className={styles.bubbleTime}>{message.status === "blocked" ? "未送达" : formatClock(message.createdAt)}</span>
                  </div>
                </div>
              </div>
            );
          })}
          {replying ? <div className={styles.typing}><i/><i/><i/></div> : null}
        </div>
        {activeThread.blockedByUser ? <div className={styles.blockedBanner}><Ban size={13}/>你已阻止此联系人<button onClick={toggleUserBlock}>解除拉黑</button></div> : null}
        <div className={styles.composerArea}>
          <button className={styles.identityPill} onClick={() => setSheet("identity")}>发送自 {senderPhone}{activeThread.senderIdentityId === "real" ? "" : " · 虚拟号"} ›</button>
          <div className={styles.composerRow}>
            <button className={styles.plusButton} onClick={() => setSheet("identity")}><Plus size={25}/></button>
            <div className={styles.composer}>
              <textarea rows={1} value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }} placeholder="iMessage 信息"/>
              {draft.trim() ? <button className={styles.sendButton} onClick={sendMessage}><Send size={16}/></button> : <button className={styles.micButton}><Mic size={18}/></button>}
            </div>
          </div>
        </div>
      </div>
    );
  }

  function renderMenuSheet() {
    return <SheetFrame title="信息" onClose={closeSheet}><div className={styles.card}>
      <button className={styles.row} onClick={() => setSheet("compose")}><SquarePen size={19}/><span><b>新信息</b><small>选择角色开始短信</small></span><ChevronRight size={17}/></button>
      <button className={styles.row} onClick={() => setSheet("settings")}><Settings2 size={19}/><span><b>短信设置</b><small>真实号码、虚拟号、主动频率与翻译</small></span><ChevronRight size={17}/></button>
      <button className={styles.row} onClick={onClose}><ChevronLeft size={19}/><span><b>返回桌面</b><small>关闭信息 App</small></span></button>
    </div></SheetFrame>;
  }

  function renderComposeSheet() {
    return <SheetFrame title="新信息" onClose={closeSheet}>
      <div className={styles.field}><input value={contactSearch} onChange={e => setContactSearch(e.target.value)} placeholder="搜索角色"/></div>
      <div className={styles.card}>{filteredContacts.map(char => <button className={styles.contactRow} key={char.id} onClick={() => startRealThread(char.id)}><Avatar character={char} small/><span><b>{char.name}</b><small>{getCharacterSmsPhone(char.id).phone || "未设置手机号"}</small></span><ChevronRight size={17}/></button>)}</div>
    </SheetFrame>;
  }

  function renderSettingsSheet() {
    const freq = state.settings.proactiveFrequency;
    return <SheetFrame title="短信设置" onClose={closeSheet}>
      <div className={styles.sectionTitle}>我的真实号码</div>
      <div className={styles.field}><label>号码只用于 ii-phone 内部身份与剧情，不会连接现实短信网络</label><input value={userPhoneDraft} onChange={e => setUserPhoneDraft(e.target.value)} placeholder="例如 +86 138 1234 5678"/></div>
      <button className={styles.primary} onClick={() => { updateSmsSettings({ userPhone: userPhoneDraft.trim() }); refresh(); onNotice?.("我的短信号码已保存。"); }}>保存真实号码</button>
      <div className={styles.sectionTitle}>角色主动短信</div>
      <div className={styles.segmented}>{(["off","rare","normal","often"] as const).map(value => <button key={value} className={freq === value ? styles.selected : ""} onClick={() => { updateSmsSettings({ proactiveFrequency: value }); refresh(); }}>{({off:"关闭",rare:"很少",normal:"偶尔",often:"较多"} as const)[value]}</button>)}</div>
      <div className={styles.notice}>频率只是主动联系机会，不强制角色发短信。Chat 被拉黑、好友申请未处理等关系事件会成为可参考的联系理由，但不会固定触发。</div>
      <div className={styles.sectionTitle}>翻译</div>
      <div className={styles.card}><button className={styles.row} onClick={() => { updateSmsSettings({ translationEnabled: !state.settings.translationEnabled }); refresh(); }}><span><b>角色短信中文译文</b><small>角色原文保留，译文按需展开</small></span><span className={`${styles.switch} ${state.settings.translationEnabled ? styles.on : ""}`}/></button></div>
      <div className={styles.sectionTitle}>虚拟号码</div>
      <div className={styles.field}><select value={virtualCountry} onChange={e => setVirtualCountry(e.target.value as SmsCountryCode)}>{SMS_COUNTRIES.map(row => <option value={row.code} key={row.code}>{row.label} · {row.sample}</option>)}</select></div>
      <button className={styles.primary} onClick={createNumber}><Plus size={17}/>随机生成该地区虚拟号</button>
      <div className={styles.card} style={{marginTop:10}}>{state.virtualNumbers.length ? state.virtualNumbers.map(row => <div className={styles.row} key={row.id}><span><b>{row.label}</b><small>{row.phone}</small></span><button className={`${styles.secondary} ${styles.danger}`} style={{width:"auto",margin:0,padding:"0 10px"}} onClick={() => removeVirtual(row.id)}><Trash2 size={14}/></button></div>) : <div className={styles.phoneHint}>还没有虚拟号。每个虚拟号在角色那边都是独立来信号码，也有独立的识别与拉黑状态。</div>}</div>
    </SheetFrame>;
  }

  function renderDetailsSheet() {
    if (!activeThread || !activeCharacter) return null;
    return <SheetFrame title={activeCharacter.name} onClose={closeSheet}>
      <div className={styles.card}><div className={styles.row}><Avatar character={activeCharacter} small/><span><b>{activeCharacter.name}</b><small>{getCharacterSmsPhone(activeCharacter.id).phone || "未设置号码"}</small></span></div></div>
      <div className={styles.sectionTitle}>对方短信号码</div>
      <div className={styles.field}><select value={charCountryDraft} onChange={e => setCharCountryDraft(e.target.value as SmsCountryCode)}>{SMS_COUNTRIES.map(row => <option key={row.code} value={row.code}>{row.label} {row.dial}</option>)}</select><input value={charPhoneDraft} onChange={e => setCharPhoneDraft(e.target.value)} placeholder="输入对方手机号"/></div>
      <button className={styles.secondary} onClick={saveCharacterPhone}><Check size={16}/>保存号码</button>
      <div className={styles.sectionTitle}>当前发送身份</div>
      <button className={styles.card + " " + styles.row} onClick={() => setSheet("identity")}><span><b>{getSmsSenderPhone(activeThread, state)}</b><small>{activeThread.senderIdentityId === "real" ? "我的真实号码" : "虚拟号码"}</small></span><ChevronRight size={17}/></button>
      <div className={styles.sectionTitle}>联系</div>
      <div className={styles.card}>
        <button className={styles.row} onClick={() => void refreshProactive()} disabled={proactiveLoading}>{proactiveLoading ? <LoaderCircle className={styles.loading} size={18}/> : <RefreshCw size={18}/>}<span><b>刷新角色主动短信</b><small>让角色按人设判断现在是否想主动发一条</small></span></button>
        <button className={`${styles.row} ${activeThread.blockedByUser ? "" : styles.danger}`} onClick={toggleUserBlock}>{activeThread.blockedByUser ? <Unlock size={18}/> : <Ban size={18}/>}<span><b>{activeThread.blockedByUser ? "解除拉黑" : "拉黑此联系人"}</b><small>只影响当前短信联系，不等于 Chat 拉黑</small></span></button>
        <button className={`${styles.row} ${styles.danger}`} onClick={() => { const id=activeThread.id; setActiveThreadId(null); setSheet(null); deleteSmsThread(id); refresh(); }}><Trash2 size={18}/><span><b>删除此短信会话</b><small>不会删除角色</small></span></button>
      </div>
      {activeThread.senderIdentityId !== "real" ? <div className={styles.notice}>小号身份在角色认知里独立保存。后台知道号码属于你，但不会把这个真相直接塞给角色；角色只能依据短信内容、人设与已知经历自行判断。</div> : null}
    </SheetFrame>;
  }

  function renderIdentitySheet() {
    if (!activeThread) return null;
    return <SheetFrame title="选择发送号码" onClose={closeSheet}>
      <div className={styles.card}>
        <button className={styles.row} onClick={() => switchIdentity("real")}><span><b>{state.settings.userPhone || "我的号码（未设置）"}</b><small>真实号码</small></span>{activeThread.senderIdentityId === "real" ? <Check size={18}/> : <ChevronRight size={17}/>}</button>
        {state.virtualNumbers.map(row => { const id = `virtual:${row.id}` as SmsSenderIdentityId; return <button className={styles.row} key={row.id} onClick={() => switchIdentity(id)}><span><b>{row.phone}<i className={styles.virtualBadge}>{row.countryName}小号</i></b><small>{row.label}</small></span>{activeThread.senderIdentityId === id ? <Check size={18}/> : <ChevronRight size={17}/>}</button>; })}
      </div>
      {!state.virtualNumbers.length ? <div className={styles.notice}>还没有虚拟号码。到「短信设置」里先选择国家/地区并随机生成。</div> : null}
      <button className={styles.secondary} onClick={() => setSheet("settings")}><Settings2 size={16}/>管理号码</button>
    </SheetFrame>;
  }

  function renderSheet() {
    if (!sheet) return null;
    if (sheet === "menu") return renderMenuSheet();
    if (sheet === "compose") return renderComposeSheet();
    if (sheet === "settings") return renderSettingsSheet();
    if (sheet === "details") return renderDetailsSheet();
    if (sheet === "identity") return renderIdentitySheet();
    return null;
  }

  return <div className={styles.app}>{activeThreadId ? renderThread() : renderList()}{renderSheet()}</div>;
}

function SheetFrame({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return <><button className={styles.overlay} onClick={onClose} aria-label="关闭"/><section className={styles.sheet}><header className={styles.sheetHeader}><b>{title}</b><button onClick={onClose}><X size={18}/></button></header><div className={styles.sheetScroll}>{children}</div></section></>;
}
