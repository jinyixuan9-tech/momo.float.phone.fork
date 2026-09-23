"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { LoaderCircle, Pause, Play, Volume2 } from "lucide-react";
import type { WeversePost } from "@/lib/weverse-storage";
import { playAudioBlobViaMediaElement, resolveVoiceConfig, synthesizeSpeech, unlockAudioPlayback } from "@/lib/tts-service";
import styles from "./weverse-app.module.css";

type Props = {
  post: WeversePost;
  onNotice?: (message: string) => void;
};

const voicePostCache = new Map<string, Blob>();
const VOICE_POST_CACHE_LIMIT = 36;

function cacheVoice(key: string, blob: Blob): void {
  if (voicePostCache.has(key)) voicePostCache.delete(key);
  voicePostCache.set(key, blob);
  while (voicePostCache.size > VOICE_POST_CACHE_LIMIT) {
    const oldest = voicePostCache.keys().next().value as string | undefined;
    if (!oldest) break;
    voicePostCache.delete(oldest);
  }
}

function estimateDuration(text: string): string {
  const seconds = Math.max(2, Math.min(180, Math.ceil(text.replace(/\s+/g, "").length / 4.2)));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function WeverseVoicePost({ post, onNotice }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [translationOpen, setTranslationOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const requestIdRef = useRef(0);
  const playbackRef = useRef<{ promise: Promise<void>; abort: () => void } | null>(null);
  const original = (post.originalBody || post.body).trim();
  const translated = post.body.trim();
  const hasTranslation = Boolean(post.originalBody && post.originalBody !== post.body);
  const duration = useMemo(() => estimateDuration(original), [original]);

  const stop = () => {
    requestIdRef.current += 1;
    playbackRef.current?.abort();
    playbackRef.current = null;
    setLoading(false);
    setPlaying(false);
  };

  useEffect(() => () => stop(), [post.id]);

  const toggleVoice = async () => {
    setExpanded(true);
    if (loading || playing) {
      stop();
      return;
    }
    const voiceConfig = resolveVoiceConfig(post.authorId, "weverse");
    if (!voiceConfig || !voiceConfig.enableTTS) {
      onNotice?.("请先在配置绑定中为这个角色的 Weverse 绑定可用语音方案");
      return;
    }
    unlockAudioPlayback();
    const requestId = ++requestIdRef.current;
    setLoading(true);
    try {
      const cacheKey = [voiceConfig.id, voiceConfig.defaultVoice || "", voiceConfig.speechSpeed ?? 1, voiceConfig.speechPitch ?? 0, original].join("::");
      let blob = voicePostCache.get(cacheKey) || null;
      if (!blob) {
        blob = await synthesizeSpeech(original, voiceConfig);
        if (blob) cacheVoice(cacheKey, blob);
      }
      if (requestId !== requestIdRef.current) return;
      if (!blob) throw new Error("语音服务没有返回音频");
      setLoading(false);
      setPlaying(true);
      const playback = playAudioBlobViaMediaElement(blob);
      playbackRef.current = playback;
      await playback.promise;
    } catch (error) {
      if (requestId === requestIdRef.current) onNotice?.(error instanceof Error ? error.message : "语音播放失败，请检查语音配置");
    } finally {
      if (requestId === requestIdRef.current) {
        playbackRef.current = null;
        setLoading(false);
        setPlaying(false);
      }
    }
  };

  return <div className={styles.voicePostBlock}>
    <button type="button" className={`${styles.voicePostBar} ${playing ? styles.voicePostBarPlaying : ""}`} onClick={() => void toggleVoice()} aria-label={playing ? "暂停语音动态" : "播放语音动态"}>
      <span className={styles.voicePostPlay}>{loading ? <LoaderCircle size={15} className={styles.voicePostSpinner} /> : playing ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}</span>
      <span className={styles.voicePostWave} aria-hidden="true">{Array.from({ length: 22 }, (_, index) => <i key={index} style={{ height: `${7 + ((index * 11) % 17)}px` }} />)}</span>
      <span className={styles.voicePostDuration}>{duration}</span>
      <Volume2 size={15} />
    </button>
    {expanded ? <div className={styles.voicePostTranscript}>
      <p>{original}</p>
      {hasTranslation ? <button type="button" onClick={() => setTranslationOpen((value) => !value)}>{translationOpen ? "收起翻译" : "查看翻译"}</button> : null}
      {translationOpen && hasTranslation ? <small>{translated}</small> : null}
    </div> : null}
  </div>;
}
