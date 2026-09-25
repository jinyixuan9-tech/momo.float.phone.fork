"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { loadLysn, localDay, subscriptionDays, type LysnState } from "@/lib/lysn-storage";
import { LYSN_MILESTONES } from "@/lib/lysn-celebrations";
import { getChatImageFromIndexedDB } from "@/lib/chat-asset-storage";
import styles from "./lysn-calendar.module.css";

export type LysnBirthdayCard = { original: string; translated: string };
export type LysnCelebrationEvent = { kind: "birthday"; year: number } | { kind: "anniversary"; days: number };
type Event = LysnCelebrationEvent;
const dateForDay = (value: string) => new Date(`${value}T12:00:00`);

export function LysnCalendar({ state, characterId, artistName, avatar, onDateChange, onBirthday }: {
  state: LysnState; characterId: string; artistName: string; avatar: string;
  onDateChange: (value: string) => void;
  onBirthday: (year: number) => Promise<LysnBirthdayCard>;
}) {
  const today = localDay(new Date());
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [selected, setSelected] = useState(today);
  const [event, setEvent] = useState<Event | null>(null);
  const [letter, setLetter] = useState<LysnBirthdayCard | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const room = state.rooms[characterId];
  const start = room?.subscriptionDate || (state.subscribedAt[characterId] ? localDay(new Date(state.subscribedAt[characterId])) : today);
  const startValid = /^\d{4}-\d{2}-\d{2}$/.test(start) && !Number.isNaN(dateForDay(start).getTime());
  const birthday = state.userProfile.birthday.match(/(?:\d{4}[-/])?(\d{1,2})[-/](\d{1,2})$/);
  const firstWeekday = (new Date(month.getFullYear(), month.getMonth(), 1).getDay() + 6) % 7;
  const size = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const days = Array.from({ length: firstWeekday + size }, (_, n) => n < firstWeekday ? null : new Date(month.getFullYear(), month.getMonth(), n - firstWeekday + 1));
  const markers = (key: string) => {
    if (!startValid || key < start || key > today) return [] as Event[];
    const d = dateForDay(key);
    const count = subscriptionDays(state, characterId, d);
    const result: Event[] = [];
    if (birthday && Number(birthday[1]) === d.getMonth() + 1 && Number(birthday[2]) === d.getDate()) result.push({ kind: "birthday", year: d.getFullYear() });
    if (LYSN_MILESTONES.includes(count)) result.push({ kind: "anniversary", days: count });
    return result;
  };
  const openEvent = (item: Event) => {
    setEvent(item); setLetter(null); setError("");
    if (item.kind !== "birthday") return;
    const cached = room?.birthdayCards?.[String(item.year)];
    if (cached) { setLetter(cached); return; }
    setLoading(true);
    void onBirthday(item.year).then(setLetter).catch(e => setError(e instanceof Error ? e.message : "生日留言生成失败，请重试")).finally(() => setLoading(false));
  };
  const chosen = markers(selected);
  return <div className={styles.calendar}>
    <div className={styles.subscription}><div><span>订阅起始日</span><strong>{startValid ? start : "尚未设置"}</strong></div><label>修改日期 <input aria-label="选择本聊天室的订阅日期" type="date" max={today} value={startValid ? start : today} onChange={e => { if (e.target.value && e.target.value <= today) { onDateChange(e.target.value); setMonth(new Date(dateForDay(e.target.value).getFullYear(), dateForDay(e.target.value).getMonth(), 1)); setSelected(e.target.value); } }}/></label></div>
    <div className={styles.month}><button type="button" aria-label="上个月" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><ChevronLeft size={20}/></button><strong>{month.getFullYear()} 年 {month.getMonth() + 1} 月</strong><button type="button" aria-label="下个月" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><ChevronRight size={20}/></button></div>
    <div className={styles.weekdays}>{["一", "二", "三", "四", "五", "六", "日"].map(d => <span key={d}>{d}</span>)}</div>
    <div className={styles.grid}>{days.map((d, i) => {
      if (!d) return <span key={`empty-${i}`}/>;
      const key = localDay(d); const special = markers(key); const active = key >= start && key <= today;
      return <button type="button" key={key} className={`${styles.day} ${!active ? styles.inactive : ""} ${key === today ? styles.today : ""} ${key === selected ? styles.selected : ""}`} onClick={() => { setSelected(key); if (special.length === 1) openEvent(special[0]); }} aria-label={`${key}${special.map(x => x.kind === "birthday" ? "，生日" : `，第 ${x.days} 天纪念`).join("")}`}><span>{d.getDate()}</span><small>{special.some(x => x.kind === "birthday") ? "🎂" : special.length ? "♥" : active && key === start ? "始" : ""}</small></button>;
    })}</div>
    <div className={styles.selection}><strong>{selected}</strong>{selected >= start && selected <= today ? <span>第 {subscriptionDays(state, characterId, dateForDay(selected))} 天</span> : <span>{selected < start ? "订阅之前" : "还没到这一天"}</span>}{chosen.map((item, i) => <button key={i} type="button" onClick={() => openEvent(item)}>{item.kind === "birthday" ? "查看生日留言" : `查看第 ${item.days} 天纪念`} ›</button>)}</div>
    {event && <LysnCelebrationCardView event={event} artistName={artistName} avatar={avatar} letter={letter} loading={loading} error={error} onRetry={() => openEvent(event)} onClose={() => setEvent(null)}/>}
  </div>;
}

/** Shared by the calendar and the dated cards inside the Bubble chat history. */
export function LysnCelebrationCardView({ event, artistName, avatar, letter, loading, error, onRetry, onClose }: {
  event: LysnCelebrationEvent; artistName: string; avatar: string;
  letter?: LysnBirthdayCard | null; loading?: boolean; error?: string;
  onRetry?: () => void; onClose: () => void;
}) {
  const [portraitUrl, setPortraitUrl] = useState(avatar.startsWith("asset://") ? "" : avatar);
  useEffect(() => {
    if (!avatar.startsWith("asset://")) { setPortraitUrl(avatar); return; }
    let alive = true;
    void getChatImageFromIndexedDB(avatar.slice(8)).then(url => { if (alive) setPortraitUrl(url || ""); });
    return () => { alive = false; };
  }, [avatar]);
  return <div className={styles.backdrop} onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <section role="dialog" aria-modal="true" aria-label={event.kind === "birthday" ? "生日留言" : "订阅纪念"} className={event.kind === "birthday" ? styles.birthday : styles.anniversary}>
      <button type="button" aria-label="关闭卡片" className={styles.close} onClick={onClose}><X size={21}/></button>
      {event.kind === "birthday" ? <>
        <div className={styles.portrait}>{portraitUrl ? <img src={portraitUrl} alt=""/> : artistName.slice(0, 1)}</div>
        <div className={styles.from}><i>from.</i> {artistName}</div>
        <div className={styles.letter}><span>✦ &nbsp; Birthday note &nbsp; ✦</span>{loading ? <p>正在写生日留言…</p> : error ? <button type="button" onClick={onRetry}>{error} · 重试</button> : <><p>{letter?.original || ""}</p><small>{letter?.translated || ""}</small></>}<img className={styles.cake} src="/lysn-assets/birthday-cake.webp" alt="粉色蝴蝶结生日蛋糕"/></div>
      </> : <>
        <div className={styles.anniversaryTitle}>♥ &nbsp; HAPPY &nbsp; ♥<strong>bubble</strong><span>ANNIVERSARY</span></div>
        <div className={styles.cartoonNumber}>{event.days}<span>DAYS</span></div>
        <img className={styles.gifts} src="/lysn-assets/anniversary-gifts.webp" alt="一堆彩色礼物"/>
        <p>我们在 Bubble 的第 {event.days} 天</p><div className={styles.confetti}>♥　✦　♥　✳</div>
      </>}
    </section>
  </div>;
}
