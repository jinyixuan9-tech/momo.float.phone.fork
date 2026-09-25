"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { localDay } from "@/lib/lysn-storage";
import styles from "./lysn-subscription-picker.module.css";

export function LysnSubscriptionPicker({ artistName, onChoose, onClose }: {
  artistName: string; onChoose: (startDate: string) => void; onClose: () => void;
}) {
  const today = localDay(new Date());
  const [past, setPast] = useState(false);
  const [chosen, setChosen] = useState(today);
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const first = (month.getDay() + 6) % 7;
  const count = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const days = Array.from({ length: first + count }, (_, index) => index < first ? null : localDay(new Date(month.getFullYear(), month.getMonth(), index - first + 1)));
  const duration = Math.floor((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${chosen}T12:00:00Z`)) / 86400000) + 1;
  return <div className={styles.backdrop} onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className={styles.dialog} role="dialog" aria-modal="true" aria-label="选择 Bubble 订阅日期">
      <button type="button" className={styles.close} onClick={onClose} aria-label="关闭"><X size={18}/></button>
      <div className={styles.brand}>bubble ♡</div>
      <h2>开始订阅 {artistName}</h2>
      {!past ? <>
        <p>这段 Bubble 聊天从哪一天开始？选择后会补上开场白和期间的纪念卡片。</p>
        <button type="button" className={styles.primary} onClick={() => onChoose(today)}>从今天开始 · 第 1 天</button>
        <button type="button" className={styles.secondary} onClick={() => setPast(true)}>选择过去的订阅日期</button>
      </> : <>
        <p>选定过去的起始日，聊天会按日期排列开场白、生日和订阅纪念。</p>
        <div className={styles.month}><button type="button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label="上个月"><ChevronLeft size={19}/></button><strong>{month.getFullYear()} 年 {month.getMonth() + 1} 月</strong><button type="button" disabled={month.getFullYear() === new Date().getFullYear() && month.getMonth() === new Date().getMonth()} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label="下个月"><ChevronRight size={19}/></button></div>
        <div className={styles.weekdays}>{["一", "二", "三", "四", "五", "六", "日"].map(day => <span key={day}>{day}</span>)}</div>
        <div className={styles.grid}>{days.map((day, index) => day ? <button key={day} type="button" disabled={day > today} aria-label={day} aria-pressed={day === chosen} className={day === chosen ? styles.selected : ""} onClick={() => setChosen(day)}>{Number(day.slice(-2))}</button> : <span key={`gap-${index}`}/>)}</div>
        <div className={styles.summary}>从 {chosen} 开始，到今天是 <b>第 {duration} 天</b></div>
        <button type="button" className={styles.primary} onClick={() => onChoose(chosen)}>使用这个日期</button>
        <button type="button" className={styles.back} onClick={() => setPast(false)}>返回选择</button>
      </>}
    </section>
  </div>;
}
