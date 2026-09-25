"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Ban, Check, ChevronRight, ImagePlus, MoreHorizontal, Pencil, Plus, Search, Send, Settings2, ShieldOff, X } from "lucide-react";
import { loadCharacters } from "@/lib/character-storage";
import { addSmsMessage, createVirtualIdentity, ensureSmsThread, loadSms, saveSms, phoneFromPersona, SMS_EVENT, SMS_REGIONS, type SmsState, type SmsThread } from "@/lib/sms-storage";
import { generateSmsReply } from "@/lib/sms-engine";
import styles from "./sms-app.module.css";

const date = (n: number) => new Date(n).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
const clock = (n: number) => new Date(n).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
export function SmsApp({ onClose, onNotice }: { onClose: () => void; onNotice?: (text: string) => void }) {
  const [state, setState] = useState<SmsState>(() => loadSms());
  const [route, setRoute] = useState<"list" | "compose" | "chat" | "detail" | "settings">("list");
  const [selected, setSelected] = useState<string | null>(null);
  const [characterId, setCharacterId] = useState("");
  const [identityId, setIdentityId] = useState("real");
  const [region, setRegion] = useState("KR");
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [menu, setMenu] = useState(false);
  const [settingsReturn, setSettingsReturn] = useState<"list" | "compose" | "chat" | "detail">("list");
  function openSettings(from: "list" | "compose" | "chat" | "detail") { setSettingsReturn(from); setRoute("settings"); }
  const [editing, setEditing] = useState(false);
  const [showTranslation, setShowTranslation] = useState<Record<string,boolean>>({});
  const listRef = useRef<HTMLDivElement>(null);
  const characters = useMemo(() => loadCharacters(), [route]);
  const selectedThread = state.threads.find(t => t.id === selected) ?? null;
  const activeCharacter = characters.find(c => c.id === selectedThread?.characterId);
  const messages = state.messages.filter(m => m.threadId === selected);
  const threads = useMemo(() => state.threads.filter(t => state.messages.some(m => m.threadId === t.id)).sort((a,b) => b.updatedAt-a.updatedAt).filter(t => {
    const name = characters.find(c => c.id === t.characterId)?.name ?? "";
    return `${name} ${t.number} ${state.messages.filter(m=>m.threadId===t.id).at(-1)?.original ?? ""}`.toLowerCase().includes(search.toLowerCase());
  }), [state, search, characters]);
  useEffect(() => { const handler = () => setState(loadSms()); window.addEventListener(SMS_EVENT, handler); return () => window.removeEventListener(SMS_EVENT, handler); }, []);
  useEffect(() => { if (route === "chat") listRef.current?.scrollTo({ top: listRef.current.scrollHeight }); }, [messages.length, selected, route]);
  function persist(next: SmsState) { saveSms(next); setState({ ...next }); }
  function back() { setError(""); setMenu(false); if (route === "detail") setRoute("chat"); else if (route === "chat" || route === "compose" || route === "settings") setRoute("list"); else onClose(); }
  function start() {
    if (!characterId) return setError("先选择收件人");
    const character = characters.find(c => c.id === characterId);
    if (!character) return;
    const next = loadSms();
    const thread = ensureSmsThread(next, characterId, identityId, next.characterNumbers[characterId] || phoneFromPersona(character.persona) || "");
    persist(next); setSelected(thread.id); setRoute("chat"); setError(""); setDraft("");
  }
  async function requestReply(threadId: string) {
    const next = loadSms(); const thread = next.threads.find(t => t.id === threadId);
    if (!thread || thread.blockedByCharacter) return;
    setBusy(true);
    try {
      const reply = await generateSmsReply(thread, next);
      const fresh = loadSms(); const live = fresh.threads.find(t => t.id === thread.id);
      if (!live) return;
      if (reply.summary) live.summary = reply.summary;
      if (live.identityId !== "real" && reply.awareness) { live.awareness = reply.awareness; live.suspicion = reply.suspicion; }
      if (reply.block) live.blockedByCharacter = true;
      if (!live.blockedByMe) reply.messages.forEach(m => addSmsMessage(fresh, live, "incoming", m.original, m.translated));
      persist(fresh);
    } catch (e) { setError(e instanceof Error ? e.message : "回复生成失败"); } finally { setBusy(false); }
  }
  async function send() {
    if (!selectedThread || !draft.trim() || busy) return;
    const next = loadSms(); const thread = next.threads.find(t => t.id === selectedThread.id);
    if (!thread) return;
    addSmsMessage(next, thread, "outgoing", draft.trim()); persist(next); setDraft(""); setError("");
    if (!thread.blockedByCharacter) await requestReply(thread.id);
  }
  function toggleBlock() {
    if (!selectedThread) return;
    const next = loadSms(); const thread = next.threads.find(t => t.id === selectedThread.id);
    if (!thread) return;
    thread.blockedByMe = !thread.blockedByMe; persist(next);
  }
  function deleteThread(id: string) {
    if (!window.confirm("删除这个号码的短信会话？")) return;
    const next = loadSms(); next.threads = next.threads.filter(t => t.id !== id); next.messages = next.messages.filter(m => m.threadId !== id);
    persist(next); setSelected(null); setRoute("list");
  }
  function updateReal(value: string) {
    const next = loadSms(); next.realNumber = value;
    next.threads.filter(t => t.identityId === "real").forEach(t => { t.number = value; }); persist(next);
  }
  function updateCharacterPhone(id: string, value: string) {
    const next = loadSms(); next.characterNumbers[id] = value;
    next.threads.filter(t=>t.characterId===id).forEach(t=>{t.characterNumber=value;});persist(next);
  }
  function addVirtual() {
    const next = loadSms(); const identity = createVirtualIdentity(next, region);persist(next);setIdentityId(identity.id);onNotice?.(`已创建虚拟号码 ${identity.number}`);
  }
  async function uploadBackground(file?: File) {
    if (!file) return;
    if (file.size > 2_000_000) return setError("背景图请小于 2 MB");
    const reader = new FileReader(); reader.onload = () => { const next=loadSms();next.background=String(reader.result);persist(next); }; reader.readAsDataURL(file);
  }
  const avatar = (id: string) => { const c = characters.find(c => c.id === id); return <span className={styles.avatar}>{c?.avatar ? <img src={c.avatar} alt="" /> : <span>{(c?.name ?? "?").slice(0,1)}</span>}</span>; };
  const name = (thread: SmsThread) => thread.identityId === "real" ? characters.find(c => c.id === thread.characterId)?.name ?? thread.characterNumber : `${characters.find(c => c.id === thread.characterId)?.name ?? "角色"} · ${thread.number || "陌生号码"}`;
  return <div className={styles.app}>
    {route === "list" && <>
      <div className={styles.listHeader}><div className={styles.toolbar}><button className={styles.glass} onClick={()=>setEditing(v=>!v)}>{editing?"完成":"编辑"}</button><button className={styles.glass} aria-label="更多" onClick={()=>setMenu(v=>!v)}><MoreHorizontal size={20}/></button></div><h1>信息</h1></div>
      {menu && <div className={styles.popover}><button onClick={()=>{openSettings("list");setMenu(false);}}><Settings2 size={16}/> 短信设置</button><button onClick={onClose}><ArrowLeft size={16}/> 返回桌面</button></div>}
      <div className={styles.threadList}>{threads.length ? threads.map(thread=>{ const last=state.messages.filter(m=>m.threadId===thread.id).at(-1); return <button key={thread.id} className={styles.threadRow} onClick={()=>{if(editing){deleteThread(thread.id);return;}setSelected(thread.id);setRoute("chat");setError("");}}>{editing ? <span className={styles.editDot}>−</span> : avatar(thread.characterId)}<span className={styles.threadText}><span className={styles.threadTop}><strong>{name(thread)}</strong><time>{date(thread.updatedAt)}</time></span><span className={styles.preview}>{last?.original || "开始一段短信"}</span></span><ChevronRight size={17} className={styles.chevron}/></button>}) : <div className={styles.empty}>还没有短信<br/>点击右下角写一条</div>}</div>
      <div className={styles.listDock}><label className={styles.search}><Search size={20}/><input placeholder="搜索" value={search} onChange={e=>setSearch(e.target.value)} /></label><button className={styles.composeButton} aria-label="新建短信" onClick={()=>{setRoute("compose");setError("");}}><Pencil size={22}/></button></div>
    </>}
    {route === "compose" && <><header className={styles.subHeader}><button className={styles.glass} onClick={back}><ArrowLeft size={20}/></button><strong>新建信息</strong><button className={styles.glass} onClick={()=>openSettings("compose")}><Settings2 size={20}/></button></header><div className={styles.form}><label>收件人<select value={characterId} onChange={e=>setCharacterId(e.target.value)}><option value="">选择角色</option>{characters.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>发件号码<select value={identityId} onChange={e=>setIdentityId(e.target.value)}><option value="real">真实号码 {state.realNumber || "（设置中填写）"}</option>{state.identities.map(i=><option key={i.id} value={i.id}>{i.number}</option>)}</select></label><button className={styles.primary} onClick={start}>进入会话</button><button className={styles.secondary} onClick={()=>openSettings("compose")}>管理我的号码 / 生成小号</button></div></>}
    {route === "chat" && selectedThread && <div className={styles.conversation} style={state.background ? {backgroundImage:`linear-gradient(#ffffff22,#ffffff22),url(${state.background})`} : undefined}>
      <header className={styles.chatHeader}><button className={styles.glass} aria-label="返回" onClick={back}><ArrowLeft size={20}/></button><button className={styles.person} onClick={()=>setRoute("detail")}>{avatar(selectedThread.characterId)}<span>{name(selectedThread)}</span><ChevronRight size={14}/></button><button className={styles.glass} aria-label="详情" onClick={()=>setRoute("detail")}><MoreHorizontal size={20}/></button></header>
      <div className={styles.bubbles} ref={listRef}>{messages.length===0 && <div className={styles.chatEmpty}>发送第一条短信</div>}{messages.map(m=><div key={m.id} className={`${styles.message} ${m.direction==="outgoing"?styles.mine:styles.theirs}`}><div className={styles.bubble}>{m.original}</div>{m.translated && m.translated!==m.original && <button className={styles.translate} onClick={()=>setShowTranslation(v=>({...v,[m.id]:!v[m.id]}))}>{showTranslation[m.id]?m.translated:"译"}</button>}<small>{clock(m.createdAt)}{m.direction==="outgoing"&&!m.delivered?" · 已发送": ""}</small></div>)}{busy && <div className={styles.typing}>···</div>}</div>
      {error && <p className={styles.error}>{error} {!busy && !selectedThread.blockedByCharacter && <button type="button" onClick={()=>{setError("");void requestReply(selectedThread.id);}}>重试回复</button>}</p>}
      <form className={styles.composer} onSubmit={e=>{e.preventDefault();void send();}}><button type="button" className={styles.round} onClick={()=>setRoute("detail")}><Plus size={22}/></button><input aria-label="短信内容" placeholder="短信" value={draft} onChange={e=>setDraft(e.target.value)} /><button type="submit" className={styles.round} disabled={!draft.trim()||busy}><Send size={18}/></button></form>
    </div>}
    {route === "detail" && selectedThread && <><header className={styles.subHeader}><button className={styles.glass} onClick={back}><ArrowLeft size={20}/></button><strong>联系人详情</strong><span/></header><div className={styles.details}>{avatar(selectedThread.characterId)}<h2>{name(selectedThread)}</h2><p>{selectedThread.characterNumber || "尚未填写角色手机号码"}</p><div className={styles.card}><span>发件身份</span><b>{selectedThread.identityId==="real" ? `真实号码 ${state.realNumber||"未设置"}` : selectedThread.number}</b></div><div className={styles.card}><span>此号码已被我屏蔽</span><button onClick={toggleBlock}>{selectedThread.blockedByMe ? <><ShieldOff size={17}/>解除拉黑</> : <><Ban size={17}/>拉黑号码</>}</button></div>{selectedThread.identityId!=="real" && <div className={styles.card}><span>对方对身份的判断</span><b>{selectedThread.awareness==="unknown"?"未知":selectedThread.awareness==="suspected"?"怀疑中":"已确认"}</b></div>}<button className={styles.secondary} onClick={()=>openSettings("detail")}><ImagePlus size={16}/> 设置聊天背景 / 号码</button><button className={styles.danger} onClick={()=>deleteThread(selectedThread.id)}>删除会话</button></div></>}
    {route === "settings" && <><header className={styles.subHeader}><button className={styles.glass} onClick={()=>setRoute(settingsReturn)}><ArrowLeft size={20}/></button><strong>短信设置</strong><button className={styles.glass} onClick={()=>setRoute("list")}><X size={20}/></button></header><div className={styles.settings}><h3>我的号码</h3><label>真实号码<input placeholder="例如 +82 10 1234 5678" value={state.realNumber} onChange={e=>updateReal(e.target.value)} /></label><p>号码只用于虚构手机内的短信。发件身份按号码独立保存。</p><h3>虚拟号码</h3><div className={styles.inline}><select value={region} onChange={e=>setRegion(e.target.value)}>{SMS_REGIONS.map(r=><option value={r.code} key={r.code}>{r.name}</option>)}</select><button onClick={addVirtual}>随机生成</button></div>{state.identities.map(i=><div className={styles.number} key={i.id}>{i.number}<Check size={16}/></div>)}<h3>角色号码</h3>{characters.map(c=><label key={c.id}>{c.name}<input placeholder={phoneFromPersona(c.persona) || "输入手机号"} value={state.characterNumbers[c.id] ?? ""} onChange={e=>updateCharacterPhone(c.id,e.target.value)} /></label>)}<h3>角色主动短信</h3><select value={state.proactive} onChange={e=>{const next=loadSms();next.proactive=e.target.value as SmsState["proactive"];persist(next);}}><option value="off">关闭</option><option value="rare">较少</option><option value="normal">普通</option><option value="often">较多</option></select><h3>会话背景</h3><label className={styles.upload}>选择照片<input type="file" hidden accept="image/*" onChange={e=>void uploadBackground(e.target.files?.[0])}/></label>{state.background && <button className={styles.secondary} onClick={()=>{const next=loadSms();next.background="";persist(next);}}>清除背景</button>}</div></>}
    {error && route!=="chat" && <p className={styles.error}>{error}</p>}
  </div>;
}
