"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ChevronRight, Clock3, Plus, RefreshCw, Send, Trash2 } from "lucide-react";
import { loadCharacters } from "@/lib/character-storage";
import { generateBoxAnswer, generateBoxQuestions } from "@/lib/question-box-engine";
import { loadBoxState, newBoxId, saveBoxState, type BoxQuestion, type BoxSession, type BoxState } from "@/lib/question-box-storage";
import styles from "./question-box-app.module.css";

type View = "inbox" | "new" | "archive" | "session" | "question" | "ask";
const durations = [{ label: "3 小时", hours: 3 }, { label: "1 天", hours: 24 }, { label: "3 天", hours: 72 }];
const date = (at: number) => new Date(at).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
const remaining = (end: number, now: number) => { const minutes = Math.max(0, Math.ceil((end - now) / 60000)); return minutes >= 1440 ? `${Math.ceil(minutes / 1440)} 天` : minutes >= 60 ? `${Math.ceil(minutes / 60)} 小时` : `${minutes} 分钟`; };

export function QuestionBoxApp({ onClose, onNotice }: { onClose: () => void; onNotice?: (message: string) => void }) {
  const [state, setState] = useState<BoxState>(() => loadBoxState());
  const [view, setView] = useState<View>("inbox");
  const [now, setNow] = useState(() => Date.now());
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [questionId, setQuestionId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>(["user"]);
  const [hours, setHours] = useState(24);
  const [customHours, setCustomHours] = useState("24");
  const [randomCount, setRandomCount] = useState(3);
  const [draft, setDraft] = useState("");
  const [anonymous, setAnonymous] = useState(false);
  const [recipientId, setRecipientId] = useState("");
  const [busy, setBusy] = useState(false);
  const characters = useMemo(() => loadCharacters(), []);
  useEffect(() => saveBoxState(state), [state]);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 30000); return () => window.clearInterval(timer); }, []);
  const name = (id: string) => id === "user" ? "U" : characters.find(c => c.id === id)?.name || "已删除的角色";
  const current = state.sessions.find(row => row.endsAt > now) || null;
  const opened = state.sessions.find(row => row.id === sessionId) || current;
  const question = opened?.questions.find(row => row.id === questionId);
  const active = Boolean(opened && opened.endsAt > now);
  const updateSession = (id: string, change: (session: BoxSession) => BoxSession) => setState(prev => ({ ...prev, sessions: prev.sessions.map(row => row.id === id ? change(row) : row) }));
  const goBack = () => { if (busy) return; if (view === "question" || view === "ask") setView("session"); else if (view === "session") setView(opened?.endsAt && opened.endsAt <= now ? "archive" : "inbox"); else if (view !== "inbox") setView("inbox"); else onClose(); };
  const openSession = (id: string) => { setSessionId(id); setView("session"); };
  const pickRandom = () => {
    const pool = [...characters];
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    pool.splice(Math.min(randomCount, characters.length));
    setSelected(prev => [ ...(prev.includes("user") ? ["user"] : []), ...pool.map(c => c.id) ]);
  };
  const start = () => {
    const duration = hours === 0 ? Number(customHours) : hours;
    if (!selected.length) { onNotice?.("请至少选择一位参与者。"); return; }
    if (!Number.isFinite(duration) || duration < 1 || duration > 720) { onNotice?.("开放时长请输入 1 至 720 小时。"); return; }
    if (current) { onNotice?.("当前一期还在开放中。"); return; }
    const startAt = Date.now(); const item: BoxSession = { id: newBoxId(), startsAt: startAt, endsAt: startAt + duration * 3600000, participantIds: selected, refreshCount: state.refreshCount, lastArrivalAt: startAt, questions: [] };
    setState(prev => ({ ...prev, sessions: [item, ...prev.sessions] })); setSessionId(item.id); setView("session");
  };
  const refresh = async (requested?: BoxSession) => {
    const target = requested || opened; if (!target || busy || target.endsAt <= Date.now()) return;
    setBusy(true);
    try {
      const batch = await generateBoxQuestions(target, target.refreshCount);
      // The session can expire during the request. Never append late questions.
      if (Date.now() >= target.endsAt) { setNow(Date.now()); onNotice?.("本期已到期，新的问题没有加入。"); return; }
      updateSession(target.id, old => ({ ...old, lastArrivalAt: Date.now(), questions: [...old.questions, ...batch] }));
      onNotice?.(`收到了 ${batch.length} 个新问题。`);
    } catch (error) { onNotice?.(error instanceof Error ? error.message : "收题失败，请重试。"); } finally { setBusy(false); }
  };
  // Arrivals are caught up on reopening; the session never queues an unbounded number of API calls.
  useEffect(() => {
    const row = current;
    if (!row || busy || (view !== "inbox" && view !== "session")) return;
    const interval = Math.min(3 * 3600000, Math.max(15 * 60000, (row.endsAt - row.startsAt) / 3));
    if (now - row.lastArrivalAt < interval) return;
    void refresh(row);
  // refresh captures the current session and is intentionally retried only when its persisted arrival time changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, current?.id, current?.lastArrivalAt, busy, view]);
  const answer = async () => {
    const target = opened; const row = question; if (!target || !row || busy || target.endsAt <= Date.now() || row.answer) return;
    const content = draft.trim();
    if (row.recipientId === "user" && !content) return;
    setBusy(true);
    try {
      const result = row.recipientId === "user" ? { original: content, translated: content } : await generateBoxAnswer(row);
      if (Date.now() >= target.endsAt) { setNow(Date.now()); onNotice?.("本期已到期，这次回答未发布。"); return; }
      updateSession(target.id, old => ({ ...old, questions: old.questions.map(q => q.id === row.id ? { ...q, answer: { ...result, createdAt: Date.now() } } : q) }));
      setDraft(""); onNotice?.("已回答。");
    } catch (error) { onNotice?.(error instanceof Error ? error.message : "回答失败，请重试。"); } finally { setBusy(false); }
  };
  const ask = () => {
    const target = opened; const content = draft.trim();
    if (!target || !recipientId || !content || target.endsAt <= Date.now()) return;
    const item: BoxQuestion = { id: newBoxId(), recipientId, senderId: "user", senderName: "U", anonymous, text: content.slice(0, 600), createdAt: Date.now() };
    updateSession(target.id, old => ({ ...old, questions: [...old.questions, item] }));
    setDraft(""); setView("session"); onNotice?.("问题已投递；角色可以稍后回答。");
  };
  const deleteQuestion = () => {
    if (!opened || !question || !window.confirm("删除这道问题及其回答？")) return;
    updateSession(opened.id, old => ({ ...old, questions: old.questions.filter(q => q.id !== question.id) })); setView("session");
  };
  const title = ({ inbox: "提问箱", new: "开启新一期", archive: "往期记录", session: opened?.endsAt && opened.endsAt <= now ? "往期提问箱" : "本期提问箱", question: "问题详情", ask: "向 TA 提问" } as Record<View, string>)[view];
  const questionCard = (row: BoxQuestion) => <button key={row.id} className={styles.card} onClick={() => { setQuestionId(row.id); setView("question"); }}>
    <span className={styles.cardTop}><span className={styles.avatar}>{name(row.recipientId).slice(0, 1)}</span><span className={styles.muted}>问 {name(row.recipientId)} · {row.anonymous && !row.revealed ? "匿名" : row.senderName} · {date(row.createdAt)}</span><ChevronRight size={16}/></span>
    <span className={styles.questionText}>{row.text}</span><span className={row.answer ? styles.muted : styles.pill}>{row.answer ? "已回答" : opened && opened.endsAt <= now ? "已过期 · 未回答" : "待回答"}</span>
  </button>;
  return <div className={styles.app}>
    <header className={styles.header}><button aria-label="返回" onClick={goBack}><ArrowLeft size={21}/></button><strong>{title}</strong><span>{view === "inbox" ? <button aria-label="新建一期" onClick={() => setView("new")}><Plus size={22}/></button> : view === "session" && active ? <button aria-label="向角色提问" onClick={() => { const id = opened?.participantIds.find(p => p !== "user") || ""; setRecipientId(id); setDraft(""); setView("ask"); }}><Send size={19}/></button> : null}</span></header>
    <main className={styles.main}>
      {view === "inbox" && <><div className={styles.intro}><span>QUESTION BOX</span><h1>想答的时候再回答。</h1><p>每期开一段时间，问题和回答都会留在这里。</p></div>
        {current ? <button className={styles.sessionCard} onClick={() => openSession(current.id)}><span className={styles.live}>● 开放中 · 还剩 {remaining(current.endsAt, now)}</span><strong>本期提问箱</strong><span className={styles.muted}>{current.participantIds.map(name).join(" · ")}　·　{current.questions.length} 个问题</span><ChevronRight size={18}/></button> : <button className={styles.primary} onClick={() => setView("new")}><Plus size={18}/> 开启新一期</button>}
        <div className={styles.sectionTitle}>往期记录 <button onClick={() => setView("archive")}>查看全部 <ChevronRight size={15}/></button></div>
        {state.sessions.filter(s => s.endsAt <= now).slice(0, 3).map(s => <button className={styles.archiveRow} key={s.id} onClick={() => openSession(s.id)}><span>{date(s.startsAt)} – {date(s.endsAt)}<small>{s.questions.length} 个问题 · {s.questions.filter(q => !q.answer).length} 个未回答</small></span><ChevronRight size={16}/></button>)}
        {!state.sessions.length && <p className={styles.empty}>还没有开启过提问箱。</p>}</>}
      {view === "new" && <><section className={styles.group}><h2>开放时长</h2><p>到期停止收题，未回答的问题留在往期记录。</p><div className={styles.chips}>{durations.map(item => <button key={item.hours} className={hours === item.hours ? styles.chosen : ""} onClick={() => setHours(item.hours)}>{item.label}</button>)}<button className={hours === 0 ? styles.chosen : ""} onClick={() => setHours(0)}>自定义</button></div>{hours === 0 && <label className={styles.inputLine}>小时 <input type="number" min="1" max="720" value={customHours} onChange={e => setCustomHours(e.target.value)}/></label>}</section>
        <section className={styles.group}><h2>参与者</h2><p>选 U 或 C。随机抽取只抽 C，开启后名单固定。</p><div className={styles.people}><button className={selected.includes("user") ? styles.personOn : ""} onClick={() => setSelected(prev => prev.includes("user") ? prev.filter(id => id !== "user") : ["user", ...prev])}>U</button>{characters.map(c => <button key={c.id} title={c.name} className={selected.includes(c.id) ? styles.personOn : ""} onClick={() => setSelected(prev => prev.includes(c.id) ? prev.filter(id => id !== c.id) : [...prev, c.id])}>{c.name.slice(0, 2)}<small>{c.name}</small></button>)}</div><div className={styles.random}><button onClick={() => setRandomCount(v => Math.max(1, v - 1))}>−</button>随机抽取 {Math.min(randomCount, Math.max(1, characters.length))} 位 C<button onClick={() => setRandomCount(v => Math.min(Math.max(1, characters.length), v + 1))}>＋</button><button onClick={pickRandom} disabled={!characters.length}><RefreshCw size={15}/> 抽取 / 重抽</button></div></section>
        <section className={styles.group}><h2>每次刷新</h2><p>每次刷出的问题数，不限制整期总数。</p><div className={styles.chips}>{[1, 2, 3, 4, 5].map(n => <button key={n} className={state.refreshCount === n ? styles.chosen : ""} onClick={() => setState(prev => ({ ...prev, refreshCount: n }))}>{n}</button>)}</div></section><button className={styles.primary} onClick={start}>开始开放</button></>}
      {view === "archive" && <>{state.sessions.filter(s => s.endsAt <= now).map(s => <button className={styles.archiveRow} key={s.id} onClick={() => openSession(s.id)}><span>{date(s.startsAt)} – {date(s.endsAt)}<small>{s.participantIds.map(name).join(" · ")} · {s.questions.length} 个问题，{s.questions.filter(q => !q.answer).length} 个未回答</small></span><ChevronRight size={18}/></button>)}{!state.sessions.some(s => s.endsAt <= now) && <p className={styles.empty}>还没有往期记录。</p>}</>}
      {view === "session" && opened && <><div className={styles.status}><Clock3 size={16}/>{active ? `开放中 · 还剩 ${remaining(opened.endsAt, now)}` : "已结束"}<small>{date(opened.startsAt)} – {date(opened.endsAt)}</small></div><div className={styles.members}>{opened.participantIds.map(id => <span key={id}>{name(id)}</span>)}</div><div className={styles.sectionTitle}>{opened.questions.length} 个问题</div>{[...opened.questions].reverse().map(questionCard)}{!opened.questions.length && <p className={styles.empty}>本期还没有问题。</p>}{active && <button className={styles.refresh} disabled={busy} onClick={() => void refresh()}><RefreshCw size={17} className={busy ? styles.spin : ""}/> {busy ? "正在收题…" : `刷新 ${opened.refreshCount} 题`}</button>}{active && !opened.participantIds.some(id => id !== "user") && <p className={styles.hint}>本期只开放了 U，角色不会收题。</p>}</>}
      {view === "question" && question && opened && <><div className={styles.detail}><div className={styles.muted}>问 {name(question.recipientId)} · {question.anonymous && !question.revealed ? "匿名" : question.senderName} · {date(question.createdAt)}</div><h2>{question.text}</h2>{question.answer ? <div className={styles.answer}><b>{name(question.recipientId)} 回答</b><p>{question.answer.original}</p>{question.answer.translated !== question.answer.original && <p className={styles.translation}>{question.answer.translated}</p>}</div> : <span className={styles.pill}>{active ? "待回答" : "已过期 · 未回答"}</span>}</div>{!question.answer && active && (question.recipientId === "user" ? <div className={styles.composer}><textarea placeholder="写下你的回答…" value={draft} onChange={e => setDraft(e.target.value)}/><button disabled={busy || !draft.trim()} onClick={answer}><Send size={18}/> 发布回答</button></div> : <button className={styles.primary} disabled={busy} onClick={answer}>{busy ? "正在回答…" : `让 ${name(question.recipientId)} 回答`}</button>)}<button className={styles.delete} onClick={deleteQuestion}><Trash2 size={16}/> 删除问题</button></>}
      {view === "ask" && opened && <><section className={styles.group}><h2>收件人</h2><div className={styles.chips}>{opened.participantIds.filter(id => id !== "user").map(id => <button key={id} className={recipientId === id ? styles.chosen : ""} onClick={() => setRecipientId(id)}>{name(id)}</button>)}</div></section><section className={styles.group}><h2>提问身份</h2><div className={styles.chips}><button className={!anonymous ? styles.chosen : ""} onClick={() => setAnonymous(false)}>实名</button><button className={anonymous ? styles.chosen : ""} onClick={() => setAnonymous(true)}>匿名</button></div><p>匿名并非绝对保密，回答者可能从问题中的线索认出你。</p></section><textarea className={styles.askInput} placeholder="写一条问题…" value={draft} maxLength={600} onChange={e => setDraft(e.target.value)}/><button className={styles.primary} disabled={!draft.trim() || !recipientId} onClick={ask}>发送问题</button></>}
    </main>
    <nav className={styles.tabs}><button className={view === "inbox" || view === "session" || view === "question" ? styles.tabActive : ""} onClick={() => setView("inbox")}>收件箱</button><button onClick={() => setView("new")}><Plus size={18}/> 开启新一期</button><button className={view === "archive" ? styles.tabActive : ""} onClick={() => setView("archive")}>往期</button></nav>
  </div>;
}
