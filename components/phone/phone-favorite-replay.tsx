"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { loadMediaBlob } from "@/lib/media-cache-storage";
import { playAudioBlobViaMediaElement } from "@/lib/tts-service";
import type { PhoneCallRecord } from "@/lib/phone-storage";
import styles from "./phone-app.module.css";

export function PhoneFavoriteReplay({ call, name }: { call: PhoneCallRecord; name: string }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [audioAvailable, setAudioAvailable] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollTimerRef = useRef<number | null>(null);
  const audioAbortRef = useRef<(() => void) | null>(null);
  const audioGenerationRef = useRef(0);

  const playLine = useCallback(async (index: number) => {
    const generation = ++audioGenerationRef.current;
    audioAbortRef.current?.();
    audioAbortRef.current = null;
    setAudioAvailable(true);
    const line = call.transcript[index];
    if (line?.role !== "assistant" || !line.audioRef) return;
    try {
      const media = await loadMediaBlob(line.audioRef);
      if (generation !== audioGenerationRef.current) return;
      if (!media) { setAudioAvailable(false); return; }
      const { promise, abort } = playAudioBlobViaMediaElement(media.blob);
      audioAbortRef.current = abort;
      await promise;
      if (generation === audioGenerationRef.current) audioAbortRef.current = null;
    } catch {
      if (generation === audioGenerationRef.current) setAudioAvailable(false);
    }
  }, [call.transcript]);

  useEffect(() => {
    void playLine(activeIndex);
    return () => {
      audioGenerationRef.current++;
      audioAbortRef.current?.();
      audioAbortRef.current = null;
    };
  }, [activeIndex, playLine]);

  useEffect(() => () => {
    if (scrollTimerRef.current !== null) window.clearTimeout(scrollTimerRef.current);
  }, []);

  const handleScroll = () => {
    if (scrollTimerRef.current !== null) window.clearTimeout(scrollTimerRef.current);
    scrollTimerRef.current = window.setTimeout(() => {
      const viewport = scrollRef.current;
      if (!viewport || !call.transcript.length) return;
      const index = Math.max(0, Math.min(call.transcript.length - 1,
        Math.round(viewport.scrollTop / viewport.clientHeight)));
      setActiveIndex(index);
    }, 130);
  };

  return <div id={`phone-replay-${call.id}`} className={styles.replaySheet}>
    <div className={styles.replayGrip} aria-hidden="true" />
    <div className={styles.replayHeading}><strong>通话回放</strong><span>{call.transcript.length ? `${activeIndex + 1} / ${call.transcript.length}` : "0 句"}</span></div>
    {call.transcript.length ? <>
      <div ref={scrollRef} className={styles.replayViewport} onScroll={handleScroll} aria-label="逐句通话记录，上下滑动切换">
        {call.transcript.map((line, index) => <div key={line.id} className={`${styles.replaySlide} ${index === activeIndex ? styles.replaySlideActive : ""}`}>
          <div className={styles.replaySpeech}>
            <span className={styles.replaySpeaker}>{line.role === "assistant" ? `${name}的话` : "我方的话"}</span>
            <p className={styles.replayOriginal}>{line.original}</p>
            {line.role === "assistant" && line.translated && <p className={styles.replayTranslation}>{line.translated}</p>}
            {line.role === "assistant" && line.audioRef && <button type="button" className={styles.replayAudioButton} onClick={() => void playLine(index)} aria-label="重播这一句语音">{index === activeIndex && !audioAvailable ? "语音已失效" : "▶ 重播语音"}</button>}
          </div>
        </div>)}
      </div>
      <p className={styles.replayHint}>上下滑动切换句子 · 对方语音随句播放</p>
    </> : <p className={styles.replayEmpty}>这通电话没有保存逐句内容。</p>}
  </div>;
}
