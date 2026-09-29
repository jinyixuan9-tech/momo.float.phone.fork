"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { Pause, Play, RotateCcw, RotateCw, Star, Trash2 } from "lucide-react";
import { loadMediaBlob } from "@/lib/media-cache-storage";
import { getTtsVolume } from "@/lib/tts-service";
import type { PhoneCallRecord } from "@/lib/phone-storage";
import styles from "./phone-app.module.css";

function clock(seconds: number): string {
  const safe = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}

export function PhoneFavoriteReplay({
  call, name, userName, onUnfavorite, onDelete,
}: {
  call: PhoneCallRecord;
  name: string;
  userName: string;
  onUnfavorite: () => void;
  onDelete: () => void;
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [audioReady, setAudioReady] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const scrollTimerRef = useRef<number | null>(null);
  const generationRef = useRef(0);

  useEffect(() => {
    const generation = ++generationRef.current;
    let url: string | null = null;
    let audio: HTMLAudioElement | null = null;
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setAudioReady(false);
    const line = call.transcript[activeIndex];
    if (line?.role === "assistant" && line.audioRef) {
      void loadMediaBlob(line.audioRef).then(media => {
        if (!media || generationRef.current !== generation) return;
        url = URL.createObjectURL(media.blob);
        audio = new Audio(url);
        audio.volume = getTtsVolume();
        audioRef.current = audio;
        audio.onloadedmetadata = () => setDuration(Number.isFinite(audio!.duration) ? audio!.duration : 0);
        audio.ontimeupdate = () => setCurrentTime(audio!.currentTime);
        audio.onplay = () => setPlaying(true);
        audio.onpause = () => setPlaying(false);
        audio.onended = () => setPlaying(false);
        audio.onerror = () => { setAudioReady(false); setPlaying(false); };
        setAudioReady(true);
        void audio.play().catch(() => setPlaying(false));
      }).catch(() => { /* Old recordings may have text without a surviving audio blob. */ });
    }
    return () => {
      generationRef.current++;
      if (audio) {
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
      }
      if (audioRef.current === audio) audioRef.current = null;
      if (url) URL.revokeObjectURL(url);
    };
  }, [activeIndex, call.transcript]);

  useEffect(() => () => {
    if (scrollTimerRef.current !== null) window.clearTimeout(scrollTimerRef.current);
  }, []);

  const switchTo = useCallback((index: number) => {
    if (index < 0 || index >= call.transcript.length) return;
    if (scrollTimerRef.current !== null) window.clearTimeout(scrollTimerRef.current);
    viewportRef.current?.scrollTo({ top: index * viewportRef.current.clientHeight, behavior: "auto" });
    setActiveIndex(index);
  }, [call.transcript.length]);

  const handleScroll = () => {
    if (scrollTimerRef.current !== null) window.clearTimeout(scrollTimerRef.current);
    scrollTimerRef.current = window.setTimeout(() => {
      const viewport = viewportRef.current;
      if (!viewport?.clientHeight) return;
      setActiveIndex(Math.min(call.transcript.length - 1, Math.max(0,
        Math.round(viewport.scrollTop / viewport.clientHeight))));
    }, 130);
  };

  const togglePlayback = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      if (audio.ended) audio.currentTime = 0;
      void audio.play().catch(() => setPlaying(false));
    } else audio.pause();
  };

  const line = call.transcript[activeIndex];
  return <div id={`phone-replay-${call.id}`} className={styles.replaySheet}>
    <div className={styles.replayGrip} aria-hidden="true" />
    <div className={styles.replayHeading}><strong>通话回放</strong><span>{call.transcript.length ? `${activeIndex + 1} / ${call.transcript.length}` : "0 句"}</span></div>
    {line ? <>
      <div ref={viewportRef} className={styles.replayViewport} onScroll={handleScroll} aria-label="逐句通话记录，上下滑动切换">
        {call.transcript.map((item, index) => <div key={item.id} className={`${styles.replaySlide} ${index === activeIndex ? styles.replaySlideActive : ""}`}>
          <div className={styles.replaySpeech}>
            <span className={styles.replaySpeaker}>{item.role === "assistant" ? name : userName}</span>
            <p className={styles.replayOriginal}>{item.original}</p>
            {item.role === "assistant" && item.translated && <p className={styles.replayTranslation}>{item.translated}</p>}
          </div>
        </div>)}
      </div>
      <div className={styles.replayProgress}>
        <input type="range" min={0} max={Math.max(duration, 1)} step="0.01" value={Math.min(currentTime, Math.max(duration, 1))}
          disabled={!audioReady || !duration} aria-label="当前语音播放进度"
          onChange={event => { const audio = audioRef.current; if (audio) { audio.currentTime = Number(event.target.value); setCurrentTime(audio.currentTime); } }}
          style={{ "--replay-progress": `${duration ? currentTime / duration * 100 : 0}%` } as CSSProperties} />
        <div className={styles.replayTimes}><span>{clock(currentTime)}</span><span>-{clock(duration - currentTime)}</span></div>
      </div>
      <div className={styles.replayControls}>
        <button type="button" aria-label="取消收藏" title="取消收藏" onClick={onUnfavorite}><Star size={21} fill="currentColor" /></button>
        <button type="button" aria-label="上一句" title="上一句" onClick={() => switchTo(activeIndex - 1)} disabled={activeIndex === 0}><RotateCcw size={27}/><span>15</span></button>
        <button type="button" className={styles.replayMainControl} aria-label={playing ? "暂停" : "播放当前语音"} title={playing ? "暂停" : "播放当前语音"} onClick={togglePlayback} disabled={!audioReady}>{playing ? <Pause size={28} fill="currentColor"/> : <Play size={28} fill="currentColor"/>}</button>
        <button type="button" aria-label="下一句" title="下一句" onClick={() => switchTo(activeIndex + 1)} disabled={activeIndex === call.transcript.length - 1}><RotateCw size={27}/><span>15</span></button>
        <button type="button" aria-label="删除通话记录" title="删除通话记录" onClick={onDelete}><Trash2 size={22}/></button>
      </div>
    </> : <div className={styles.replayEmpty}>这通电话没有保存逐句内容。<div className={styles.replayControls}><button type="button" onClick={onUnfavorite} aria-label="取消收藏"><Star fill="currentColor"/></button><button type="button" onClick={onDelete} aria-label="删除通话记录"><Trash2/></button></div></div>}
  </div>;
}
