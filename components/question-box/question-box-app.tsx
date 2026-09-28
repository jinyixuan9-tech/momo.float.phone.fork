"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, ChevronRight, Clock3, ImagePlus, Plus, RefreshCw, Send, Settings2, Trash2, X } from "lucide-react";
import { loadCharacters } from "@/lib/character-storage";
import { generateBoxAnswer, generateBoxQuestions, generateBoxTopic } from "@/lib/question-box-engine";
import { emptyBoxState, loadBoxState, newBoxId, saveBoxState, type BoxProfile, type BoxQuestion, type BoxSession, type BoxState, type BoxTopicMode } from "@/lib/question-box-storage";
import styles from "./question-box-app.module.css";

// Visual preview only. Turn off when the real cards are approved; never persisted or sent to an API.
const SHOW_QUESTION_BOX_DEMO = true;
type Page = "home" | "box" | "question" | "archive";
type Modal = "user" | "characters" | "delivery" | "participants" | null;
const presetHours = [3, 12, 24, 72];
const pick = <T,>(rows: T[]) => rows[Math.floor(Math.random() * rows.length)];
const randomCount = (max: number) => 1 + Math.floor(Math.random() * Math.max(1, max));
const shuffle = <T,>(rows: T[]) => { const copy = [...rows]; for (let i = copy.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [copy[i], copy[j]] = [copy[j], copy[i]]; } return copy; };
const at = (time: number) => new Date(time).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
const left = (end: number, now: number) => { const m = Math.max(0, Math.ceil((end - now) / 60000)); return m >= 1440 ? `${Math.ceil(m / 1440)} 天` : m >= 60 ? `${Math.ceil(m / 60)} 小时` : `${m} 分钟`; };
async function imageData(file: File, cover: boolean): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("请选择图片文件。");
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas"); canvas.width = cover ? 960 : 320; canvas.height = cover ? 440 : 320;
    const ctx = canvas.getContext("2d"); if (!ctx) throw new Error("图片处理失败。");
    const scale = Math.max(canvas.width / bitmap.width, canvas.height / bitmap.height);
    const w = bitmap.width * scale; const h = bitmap.height * scale;
    ctx.drawImage(bitmap, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
    return canvas.toDataURL("image/webp", .76);
  } finally { bitmap.close(); }
}

export function QuestionBoxApp({ onClose, onNotice }: { onClose: () => void; onNotice?: (text: string) => void }) {
  const [state, setState] = useState<BoxState>(() => loadBoxState());
  const [page, setPage] = useState<Page>("home");
  const [modal, setModal] = useState<Modal>(null);
  const [drawer, setDrawer] = useState(false);
  const [editOwner, setEditOwner] = useState("user");
  const [now, setNow] = useState(() => Date.now());
  const [boxId, setBoxId] = useState<string | null>(null);
  const [questionId, setQuestionId] = useState<string | null>(null);
  const [demoView, setDemoView] = useState(false);
  const [busy, setBusy] = useState(false);
  const [topic, setTopic] = useState("");
  const [topicMode, setTopicMode] = useState<BoxTopicMode>("persona");
  const [duration, setDuration] = useState(24);
  const [customDuration, setCustomDuration] = useState("24");
  const [maxQuestions, setMaxQuestions] = useState(5);
  const [selectedCharacters, setSelectedCharacters] = useState<string[]>([]);
  const [participants, setParticipants] = useState<string[] | undefined>(undefined);
  const [draft, setDraft] = useState("");
  const [deliveryMode, setDeliveryMode] = useState<"solo" | "mixed">("solo");
  const characters = useMemo(() => loadCharacters(), []);
  useEffect(() => saveBoxState(state), [state]);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 30000); return () => window.clearInterval(timer); }, []);

  const demo = useMemo<BoxSession>(() => ({ id: "__question_box_demo__", ownerId: "user", startsAt: Date.now() - 3600000, endsAt: Date.now() + 18 * 3600000, topicMode: "custom", topic: "最近有什么想问的？", maxQuestions: 5, lastArrivalAt: Date.now(), questions: [
    { id: "demo_1", recipientId: "user", senderName: "匿名", text: "如果能重新过最近的一天，你会选哪天？", createdAt: Date.now() - 1400000 },
    { id: "demo_2", recipientId: "user", senderName: "匿名", text: "这周最让你开心的一件小事是什么？", createdAt: Date.now() - 3400000, answer: { original: "下班路上遇到一只很亲人的小猫。", translated: "下班路上遇到一只很亲人的小猫。", createdAt: Date.now() - 2800000 } },
  ], profileSnapshot: {} }), []);
  const activeBoxes = state.sessions.filter(box => box.endsAt > now).sort((a, b) => a.ownerId === "user" ? -1 : b.ownerId === "user" ? 1 : a.endsAt - b.endsAt);
  const closedBoxes = state.sessions.filter(box => box.endsAt <= now).sort((a, b) => b.endsAt - a.endsAt);
  const showDemo = SHOW_QUESTION_BOX_DEMO && activeBoxes.length === 0;
  const box = demoView ? demo : state.sessions.find(row => row.id === boxId) || null;
  const question = box?.questions.find(row => row.id === questionId) || null;
  const boxOpen = !!box && box.endsAt > now;
  const name = (ownerId: string) => ownerId === "user" ? "U" : characters.find(c => c.id === ownerId)?.name || "已移除的角色";
  const fallbackAvatar = (ownerId: string) => ownerId === "user" ? "" : characters.find(c => c.id === ownerId)?.avatar || "";
  const profile = (ownerId: string, archived = false, row?: BoxSession): BoxProfile => archived ? row?.profileSnapshot || {} : state.profiles[ownerId] || {};
  const display = (ownerId: string, archived = false, row?: BoxSession) => profile(ownerId, archived, row).nickname?.trim() || name(ownerId);
  const updateBox = (id: string, change: (row: BoxSession) => BoxSession) => setState(prev => ({ ...prev, sessions: prev.sessions.map(row => row.id === id ? change(row) : row) }));
  const setOwnerProfile = (id: string, change: Partial<BoxProfile>) => setState(prev => ({ ...prev, profiles: { ...prev.profiles, [id]: { ...prev.profiles[id], ...change } } }));
  const back = () => { if (drawer) { setDrawer(false); return; } if (modal) { setModal(null); return; } if (page === "question") { setPage("box"); return; } if (page === "box") { setPage(demoView || boxOpen ? "home" : "archive"); setDemoView(false); return; } if (page === "archive") { setPage("home"); return; } onClose(); };
  const openBox = (row: BoxSession, isDemo = false) => { setDemoView(isDemo); setBoxId(row.id); setPage("box"); setQuestionId(null); };
  const startUser = () => {
    if (state.sessions.some(row => row.ownerId === "user" && row.endsAt > Date.now())) { onNotice?.("U 的提问箱已经在开放中。"); return; }
    const hours = duration === 0 ? Number(customDuration) : duration;
    if (!Number.isFinite(hours) || hours < 1 || hours > 720) { onNotice?.("开放时长请输入 1 至 720 小时。"); return; }
    const startAt = Date.now(); const row: BoxSession = { id: newBoxId(), ownerId: "user", startsAt: startAt, endsAt: startAt + hours * 3600000, topicMode: topic.trim() ? "custom" : "free", topic: topic.trim().slice(0, 100), maxQuestions, lastArrivalAt: startAt, questions: [], profileSnapshot: { ...state.profiles.user } };
    setState(prev => ({ ...prev, sessions: [row, ...prev.sessions] })); setBoxId(row.id); setDemoView(false); setPage("box"); setModal(null); setTopic("");
  };
  const startCharacters = () => {
    const available = characters.filter(c => !state.sessions.some(row => row.ownerId === c.id && row.endsAt > Date.now()));
    if (!available.length) { onNotice?.("目前没有可新开箱的 C。"); return; }
    const explicit = selectedCharacters.length > 0;
    const chosen = explicit ? available.filter(c => selectedCharacters.includes(c.id)) : shuffle(available).slice(0, randomCount(Math.min(3, available.length)));
    if (!chosen.length) { onNotice?.("选中的 C 已经开箱，换一位试试。"); return; }
    const hours = duration === 0 ? Number(customDuration) : duration;
    if (duration !== -1 && (!Number.isFinite(hours) || hours < 1 || hours > 720)) { onNotice?.("开放时长请输入 1 至 720 小时。"); return; }
    const startAt = Date.now();
    const rows: BoxSession[] = chosen.map(c => {
      const mode = explicit ? topicMode : pick(["persona", "free"] as BoxTopicMode[]);
      const length = duration === -1 ? pick(presetHours) : hours;
      return { id: newBoxId(), ownerId: c.id, startsAt: startAt, endsAt: startAt + length * 3600000, topicMode: mode, topic: mode === "custom" ? topic.trim().slice(0, 100) : "", maxQuestions, lastArrivalAt: startAt, questions: [], profileSnapshot: { ...state.profiles[c.id] } };
    });
    setState(prev => ({ ...prev, sessions: [...rows, ...prev.sessions] })); setModal(null); setSelectedCharacters([]); setTopic(""); setPage("home");
    onNotice?.(`已为 ${rows.length} 位 C 开箱，进各自的箱子刷新后才会收到问题。`);
  };
  const refresh = async () => {
    const target = box; if (!target || !boxOpen || demoView || busy) return;
    setBusy(true);
    try {
      const count = randomCount(target.maxQuestions);
      const actualTopic = target.topicMode === "persona" && !target.topic ? await generateBoxTopic(target.ownerId) : target.topic;
      const batch = await generateBoxQuestions({ ...target, topic: actualTopic }, count);
      if (Date.now() >= target.endsAt) { setNow(Date.now()); onNotice?.("本期已结束，新问题没有加入。"); return; }
      updateBox(target.id, row => ({ ...row, topic: actualTopic || row.topic, questions: [...row.questions, ...batch], lastArrivalAt: Date.now() }));
      onNotice?.(`收到 ${batch.length} 条新问题。`);
    } catch (error) { onNotice?.(error instanceof Error ? error.message : "收题失败，请重试。"); } finally { setBusy(false); }
  };
  const answer = async () => {
    if (!box || !question || demoView || !boxOpen || question.answer || busy) return;
    const input = draft.trim(); if (box.ownerId === "user" && !input) return;
    setBusy(true);
    try {
      const output = box.ownerId === "user" ? { original: input, translated: input } : await generateBoxAnswer(question);
      if (Date.now() >= box.endsAt) { setNow(Date.now()); onNotice?.("本期已结束，回答没有发布。"); return; }
      updateBox(box.id, row => ({ ...row, questions: row.questions.map(q => q.id === question.id ? { ...q, answer: { ...output, createdAt: Date.now() } } : q) }));
      setDraft("");
    } catch (error) { onNotice?.(error instanceof Error ? error.message : "回答失败，请重试。"); } finally { setBusy(false); }
  };
  const deliver = async () => {
    if (!box || box.ownerId === "user" || box.endsAt <= Date.now() || demoView || !draft.trim() || busy) return;
    const target = box; const body = draft.trim().slice(0, 600);
    const userQuestion: BoxQuestion = { id: newBoxId(), recipientId: target.ownerId, senderId: "user", senderName: "匿名", text: body, createdAt: Date.now() };
    setDraft(""); setModal(null);
    if (deliveryMode === "solo" || target.maxQuestions <= 1) { updateBox(target.id, row => ({ ...row, questions: [...row.questions, userQuestion] })); onNotice?.(target.maxQuestions <= 1 && deliveryMode === "mixed" ? "每次最多 1 题，这次已单独匿名投递。" : "匿名问题已投递。"); return; }
    setBusy(true);
    try {
      const others = await generateBoxQuestions(target, randomCount(Math.max(1, target.maxQuestions - 1)), true);
      const position = Math.floor(Math.random() * (others.length + 1));
      others.splice(position, 0, userQuestion);
      if (Date.now() >= target.endsAt) { setNow(Date.now()); onNotice?.("本期已结束，问题没有投递。"); setDraft(body); return; }
      updateBox(target.id, row => ({ ...row, questions: [...row.questions, ...others], lastArrivalAt: Date.now() }));
      onNotice?.("匿名问题已混入这一批。");
    } catch { if (Date.now() < target.endsAt) { updateBox(target.id, row => ({ ...row, questions: [...row.questions, userQuestion] })); onNotice?.("其他问题暂时生成失败，你的问题已单独投递。"); } else { setDraft(body); onNotice?.("本期已结束，问题没有投递。"); } } finally { setBusy(false); }
  };
  const eraseAll = () => { if (!window.confirm("将删除全部提问箱记录、头像和封面。确定继续？")) return; if (!window.confirm("再次确认：全部提问箱数据删除后无法恢复。")) return; setState(emptyBoxState()); setPage("home"); setBoxId(null); setDrawer(false); setDemoView(false); onNotice?.("提问箱数据已清除。"); };
  const readImage = async (file: File | undefined, kind: "avatar" | "cover") => { if (!file) return; try { setOwnerProfile(editOwner, { [kind === "avatar" ? "avatarUrl" : "coverUrl"]: await imageData(file, kind === "cover") }); } catch (error) { onNotice?.(error instanceof Error ? error.message : "图片导入失败。"); } };
  const updateParticipants = () => { if (!box || demoView || box.ownerId !== "user") return; updateBox(box.id, row => ({ ...row, participantIds: participants })); setModal(null); };
  const sessionCard = (row: BoxSession, isDemo = false) => {
    const archived = row.endsAt <= now && !isDemo;
    const p = profile(row.ownerId, archived, row);
    const avatar = p.avatarUrl || fallbackAvatar(row.ownerId);
    const cover = p.coverUrl;
    return <button key={row.id} className={styles.boxCard} onClick={() => openBox(row, isDemo)}>
      <div className={styles.cover} style={cover ? { backgroundImage: `url(${cover})` } : undefined}><span className={styles.coverLabel}>QUESTION BOX</span>{!cover && <span className={styles.coverMotif}>Q.</span>}{isDemo && <span className={styles.demoTag}>界面示意</span>}</div>
      <div className={styles.cardInfo}><span className={styles.ownerAvatar}>{avatar ? <img src={avatar} alt=""/> : display(row.ownerId, archived, row).slice(0, 1)}</span><div className={styles.ownerText}><strong>{display(row.ownerId, archived, row)}</strong><span className={styles.topic}>{row.topic || (row.topicMode === "persona" ? "主题由 TA 决定" : "随便问问")}</span></div><div className={styles.cardState}><b>{archived ? "已经关闭" : "正在开箱"}</b><small>{archived ? "已结束" : `还剩 ${left(row.endsAt, now)}`}</small></div></div>
    </button>;
  };
  const questionCard = (row: BoxQuestion) => <button key={row.id} className={styles.questionCard} onClick={() => { setQuestionId(row.id); setPage("question"); setDraft(""); }}><span className={styles.questionTop}>匿名提问 <span>{at(row.createdAt)}</span></span><strong>{row.text}</strong><span className={row.answer ? styles.answered : styles.unanswered}>{row.answer ? "已回答" : "未回答"}</span></button>;
  const pageTitle = page === "home" ? "提问箱" : page === "archive" ? "往期" : page === "question" ? "问题详情" : box ? display(box.ownerId, !boxOpen, box) + "的提问箱" : "提问箱";

  return <div className={styles.app}>
    <header className={styles.header}><button aria-label="返回" onClick={back}><ArrowLeft size={21}/></button><strong>{pageTitle}</strong><div className={styles.headerActions}>{page === "home" && <button aria-label="刷新 C 的提问箱" title="为 C 开启提问箱" onClick={() => { setSelectedCharacters([]); setTopic(""); setTopicMode("persona"); setDuration(-1); setModal("characters"); }}><RefreshCw size={19}/></button>}<button aria-label="提问箱设置" onClick={() => setDrawer(true)}><Settings2 size={20}/></button></div></header>
    <main className={styles.main}>
      {page === "home" && <><div className={styles.pageLead}><span>OPEN NOW</span><h1>正在开箱</h1><p>想回答的时候再回答。</p></div>{activeBoxes.map(row => sessionCard(row))}{showDemo && <>{sessionCard(demo, true)}<p className={styles.demoNote}>这张示意卡只用于看界面，不会收题或保存数据。</p></>}{!activeBoxes.length && !showDemo && <p className={styles.empty}>现在没有开放的提问箱。</p>}</>}
      {page === "archive" && <><div className={styles.pageLead}><span>PAST BOXES</span><h1>往期</h1><p>已经关闭的问题和回答都留在这里。</p></div>{closedBoxes.map(row => sessionCard(row))}{!closedBoxes.length && <p className={styles.empty}>还没有往期提问箱。</p>}</>}
      {page === "box" && box && <>{sessionCard(box, demoView)}<div className={styles.boxMeta}><span><Clock3 size={14}/> {at(box.startsAt)} — {at(box.endsAt)}</span>{!demoView && box.ownerId === "user" && boxOpen && <button onClick={() => { setParticipants(box.participantIds); setModal("participants"); }}>本期提问者 <ChevronRight size={14}/></button>}</div><div className={styles.sectionTitle}><strong>收到的问题</strong><span>{box.questions.length}</span></div>{[...box.questions].reverse().map(questionCard)}{!box.questions.length && <p className={styles.empty}>现在还是空箱。点刷新，看看谁来提问。</p>}{demoView && <p className={styles.demoNote}>界面示意：正式开箱后，刷新和回答才会生效。</p>}{boxOpen && !demoView && <div className={styles.boxActions}><button disabled={busy} onClick={() => void refresh()}><RefreshCw size={17} className={busy ? styles.spin : ""}/>{busy ? "正在收题" : "刷新"}</button>{box.ownerId !== "user" && <button disabled={busy} onClick={() => { setDraft(""); setDeliveryMode("solo"); setModal("delivery"); }}><Send size={17}/>投递</button>}</div>}</>}
      {page === "question" && box && question && <><div className={styles.detail}><span className={styles.muted}>匿名提问 · {at(question.createdAt)}</span><h2>{question.text}</h2><span className={question.answer ? styles.answered : styles.unanswered}>{question.answer ? "已回答" : "未回答"}</span>{question.answer && <div className={styles.answer}><strong>{display(box.ownerId, !boxOpen, box)}的回答</strong><p>{question.answer.original}</p>{question.answer.translated !== question.answer.original && <p className={styles.translation}>{question.answer.translated}</p>}</div>}</div>{boxOpen && !question.answer && !demoView && (box.ownerId === "user" ? <div className={styles.reply}><textarea placeholder="写下你的回答…" value={draft} onChange={e => setDraft(e.target.value)}/><button disabled={!draft.trim() || busy} onClick={() => void answer()}>发布回答</button></div> : <button className={styles.primary} disabled={busy} onClick={() => void answer()}>{busy ? "正在回答…" : `让 ${display(box.ownerId)} 回答`}</button>)}{!demoView && <button className={styles.deleteQuestion} onClick={() => { if (!window.confirm("删除这道问题和它的回答？")) return; updateBox(box.id, row => ({ ...row, questions: row.questions.filter(q => q.id !== question.id) })); setPage("box"); }}><Trash2 size={15}/> 删除问题</button>}</>}
    </main>
    <nav className={styles.pillNav}><button className={page === "home" || page === "box" || page === "question" ? styles.navSelected : ""} onClick={() => { setDemoView(false); setPage("home"); }}>首页</button><button className={styles.navPlus} aria-label="开启 U 的新一期" onClick={() => { setDuration(24); setMaxQuestions(5); setTopic(""); setModal("user"); }}><Plus size={22}/></button><button className={page === "archive" ? styles.navSelected : ""} onClick={() => { setDemoView(false); setPage("archive"); }}>往期</button></nav>

    {modal && <div className={styles.scrim} onClick={() => setModal(null)}><section className={styles.modal} role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}><div className={styles.modalHead}><strong>{modal === "user" ? "开启我的提问箱" : modal === "characters" ? "为 C 开启提问箱" : modal === "delivery" ? "匿名投递" : "本期提问者"}</strong><button aria-label="关闭" onClick={() => setModal(null)}><X size={18}/></button></div>
      {modal === "user" && <><label className={styles.field}>本期主题 <small>选填</small><input placeholder="不填就随便问问" value={topic} maxLength={100} onChange={e => setTopic(e.target.value)}/></label><DurationPicker value={duration} setValue={setDuration} custom={customDuration} setCustom={setCustomDuration}/><CountPicker value={maxQuestions} setValue={setMaxQuestions}/><p className={styles.hint}>开启后是空箱，进入箱子点刷新才会收题。</p><button className={styles.primary} onClick={startUser}>开始开箱</button></>}
      {modal === "characters" && <><p className={styles.hint}>不选择 C，就随机开启一部分尚未开箱的 C；主题和开放时长也会随机。</p><div className={styles.characterGrid}>{characters.map(c => <button key={c.id} className={selectedCharacters.includes(c.id) ? styles.characterSelected : ""} onClick={() => setSelectedCharacters(prev => prev.includes(c.id) ? prev.filter(id => id !== c.id) : [...prev, c.id])}><span>{state.profiles[c.id]?.avatarUrl || c.avatar ? <img src={state.profiles[c.id]?.avatarUrl || c.avatar || ""} alt=""/> : c.name.slice(0, 1)}</span>{state.profiles[c.id]?.nickname || c.name}{selectedCharacters.includes(c.id) && <Check size={13}/>}</button>)}</div><div className={styles.field}>本期主题<div className={styles.segment}><button className={topicMode === "custom" ? styles.selected : ""} onClick={() => setTopicMode("custom")}>自己指定</button><button className={topicMode === "persona" ? styles.selected : ""} onClick={() => setTopicMode("persona")}>由 TA 定</button><button className={topicMode === "free" ? styles.selected : ""} onClick={() => setTopicMode("free")}>随便问</button></div>{topicMode === "custom" && <input placeholder="给选中的 C 设置主题" value={topic} maxLength={100} onChange={e => setTopic(e.target.value)}/>}</div><DurationPicker value={duration} setValue={setDuration} custom={customDuration} setCustom={setCustomDuration} random/><CountPicker value={maxQuestions} setValue={setMaxQuestions}/><button className={styles.primary} onClick={startCharacters}>开启提问箱</button></>}
      {modal === "delivery" && <><textarea className={styles.deliveryText} placeholder="写下想匿名问 TA 的问题…" value={draft} maxLength={600} onChange={e => setDraft(e.target.value)}/><div className={styles.segment}><button className={deliveryMode === "solo" ? styles.selected : ""} onClick={() => setDeliveryMode("solo")}>单独投递</button><button className={deliveryMode === "mixed" ? styles.selected : ""} onClick={() => setDeliveryMode("mixed")}>混入其他问题</button></div><p className={styles.hint}>两种方式对 TA 都只显示匿名；投递后不会立刻回答。</p><button className={styles.primary} disabled={!draft.trim()} onClick={() => void deliver()}>投递问题</button></>}
      {modal === "participants" && <><p className={styles.hint}>默认每次从引入的 C 中随机抽一部分提问，也可能有陌生人。指定后只有勾选的 C 和陌生人参与。</p><button className={styles.choiceRow} onClick={() => setParticipants(undefined)}><span>随机抽取 C</span>{!participants && <Check size={16}/>}</button><div className={styles.characterGrid}>{characters.map(c => <button key={c.id} className={participants?.includes(c.id) ? styles.characterSelected : ""} onClick={() => setParticipants(prev => prev?.includes(c.id) ? prev.filter(id => id !== c.id) : [...(prev || []), c.id])}>{state.profiles[c.id]?.nickname || c.name}{participants?.includes(c.id) && <Check size={13}/>}</button>)}</div><button className={styles.primary} onClick={updateParticipants}>保存本期设置</button></>}
    </section></div>}

    {drawer && <div className={styles.drawerScrim} onClick={() => setDrawer(false)}><aside className={styles.drawer} onClick={e => e.stopPropagation()}><div className={styles.drawerHead}><strong>提问箱设置</strong><button aria-label="关闭设置" onClick={() => setDrawer(false)}><X size={19}/></button></div><div className={styles.drawerBody}><span className={styles.drawerLabel}>我的</span><button className={editOwner === "user" ? styles.drawerOwnerSelected : styles.drawerOwner} onClick={() => setEditOwner("user")}>U · 我的资料 <ChevronRight size={15}/></button><span className={styles.drawerLabel}>角色设置</span>{characters.map(c => <button key={c.id} className={editOwner === c.id ? styles.drawerOwnerSelected : styles.drawerOwner} onClick={() => setEditOwner(c.id)}>{c.name}<ChevronRight size={15}/></button>)}<div className={styles.profileEdit}><strong>{name(editOwner)} · 本 App 展示</strong><p>头像、昵称与封面只在提问箱显示，不改角色人设或其他 App 资料。</p><label>昵称<input placeholder={name(editOwner)} value={state.profiles[editOwner]?.nickname || ""} onChange={e => setOwnerProfile(editOwner, { nickname: e.target.value })}/></label><div className={styles.photoRow}><span>头像</span><label><ImagePlus size={16}/> 选择图片<input type="file" accept="image/*" onChange={e => { void readImage(e.target.files?.[0], "avatar"); e.target.value = ""; }}/></label>{state.profiles[editOwner]?.avatarUrl && <button onClick={() => setOwnerProfile(editOwner, { avatarUrl: "" })}>移除</button>}</div><div className={styles.photoRow}><span>提问箱封面</span><label><ImagePlus size={16}/> 选择图片<input type="file" accept="image/*" onChange={e => { void readImage(e.target.files?.[0], "cover"); e.target.value = ""; }}/></label>{state.profiles[editOwner]?.coverUrl && <button onClick={() => setOwnerProfile(editOwner, { coverUrl: "" })}>移除</button>}</div>{state.profiles[editOwner]?.coverUrl && <img className={styles.coverPreview} src={state.profiles[editOwner].coverUrl} alt="当前提问箱封面"/>}</div><button className={styles.eraseAll} onClick={eraseAll}><Trash2 size={16}/> 清除所有提问箱数据</button></div></aside></div>}
  </div>;
}

function DurationPicker({ value, setValue, custom, setCustom, random = false }: { value: number; setValue: (v: number) => void; custom: string; setCustom: (v: string) => void; random?: boolean }) {
  return <div className={styles.field}>开放时长<div className={styles.segment}>{presetHours.map(hour => <button key={hour} className={value === hour ? styles.selected : ""} onClick={() => setValue(hour)}>{hour < 24 ? `${hour} 小时` : `${hour / 24} 天`}</button>)}<button className={value === 0 ? styles.selected : ""} onClick={() => setValue(0)}>自定</button>{random && <button className={value === -1 ? styles.selected : ""} onClick={() => setValue(-1)}>随机</button>}</div>{value === 0 && <input type="number" min="1" max="720" value={custom} onChange={e => setCustom(e.target.value)} placeholder="小时数"/>}</div>;
}
function CountPicker({ value, setValue }: { value: number; setValue: (v: number) => void }) {
  return <div className={styles.field}>每次最多收几题<div className={styles.segment}>{[1, 2, 3, 4, 5].map(count => <button key={count} className={value === count ? styles.selected : ""} onClick={() => setValue(count)}>{count}</button>)}</div><small>这是上限；选 5 题也可能只收到 3 题。</small></div>;
}
