"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BadgeCheck, ChevronRight, Heart, LoaderCircle, Play, Send, Square, Volume2, X } from "lucide-react";
import type { WeverseLive } from "@/lib/weverse-storage";
import { playAudioBlobViaMediaElement, resolveVoiceConfig, synthesizeSpeech, unlockAudioPlayback } from "@/lib/tts-service";
import styles from "./weverse-app.module.css";

type Props = {
  live: WeverseLive;
  speakerNames: Record<string, string>;
  userName: string;
  busy?: boolean;
  onBack: () => void;
  onAdvance: () => void;
  onSendComment: (body: string) => void;
  onHeart: () => void;
  onFinalizeEnd: () => void;
  onManualEnd: () => void;
};

const liveVoiceCache = new Map<string, Blob>();
const LIVE_VOICE_CACHE_LIMIT = 36;

function cacheLiveVoice(key: string, blob: Blob): void {
  if (liveVoiceCache.has(key)) liveVoiceCache.delete(key);
  liveVoiceCache.set(key, blob);
  while (liveVoiceCache.size > LIVE_VOICE_CACHE_LIMIT) {
    const oldest = liveVoiceCache.keys().next().value as string | undefined;
    if (!oldest) break;
    liveVoiceCache.delete(oldest);
  }
}

function compact(value: number): string {
  const n = Math.max(0, Math.round(value || 0));
  if (n < 1000) return String(n);
  if (n < 10000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  if (n < 100000000) return `${(n / 10000).toFixed(1).replace(/\.0$/, "")}万`;
  return `${(n / 100000000).toFixed(1).replace(/\.0$/, "")}亿`;
}

function liveElapsed(startedAt: number, endAt: number): string {
  const ms = Math.max(0, endAt - startedAt);
  const sec = Math.floor(ms / 1000);
  const min = Math.floor(sec / 60);
  const hour = Math.floor(min / 60);
  if (hour) return `${hour}:${String(min % 60).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;
  return `${String(min).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;
}

export function WeverseLiveView({ live, speakerNames, userName, busy, onBack, onAdvance, onSendComment, onHeart, onFinalizeEnd, onManualEnd }: Props) {
  const [clock, setClock] = useState(() => Date.now());
  const [draft, setDraft] = useState("");
  const [exitSheetOpen, setExitSheetOpen] = useState(false);
  const [artistCommentsOpen, setArtistCommentsOpen] = useState(false);
  const [transcriptPinned, setTranscriptPinned] = useState(true);
  const [heartBursts, setHeartBursts] = useState<Array<{ id: number; x: number }>>([]);
  const [voiceLoadingSegmentId, setVoiceLoadingSegmentId] = useState<string | null>(null);
  const [playingVoiceSegmentId, setPlayingVoiceSegmentId] = useState<string | null>(null);
  const [voiceNotice, setVoiceNotice] = useState<string | null>(null);
  const heartIdRef = useRef(0);
  const voiceRequestIdRef = useRef(0);
  const voicePlaybackRef = useRef<{ promise: Promise<void>; abort: () => void } | null>(null);
  const voiceNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commentBoxRef = useRef<HTMLDivElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 300);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => () => {
    voiceRequestIdRef.current += 1;
    voicePlaybackRef.current?.abort();
    voicePlaybackRef.current = null;
    if (voiceNoticeTimerRef.current) clearTimeout(voiceNoticeTimerRef.current);
  }, [live.id]);

  const visibleSegments = useMemo(
    () => [...live.segments].filter((item) => item.createdAt <= clock).sort((a, b) => a.createdAt - b.createdAt),
    [live.segments, clock],
  );
  const visibleComments = useMemo(
    () => [...live.comments].filter((item) => item.createdAt <= clock).sort((a, b) => a.createdAt - b.createdAt),
    [live.comments, clock],
  );
  const visibleArtistComments = useMemo(() => visibleComments.filter((item) => item.authorType === "artist"), [visibleComments]);
  const bufferedUntil = Math.max(live.startedAt, ...live.segments.map((item) => item.createdAt), ...live.comments.map((item) => item.createdAt));
  const isPlaying = live.status === "live" && bufferedUntil > clock;
  const isEnding = live.status === "live" && Boolean(live.endedAt);

  useEffect(() => {
    if (live.status === "live" && live.endedAt && clock >= live.endedAt) onFinalizeEnd();
  }, [clock, live.status, live.endedAt, onFinalizeEnd]);

  useEffect(() => {
    const box = commentBoxRef.current;
    if (!box) return;
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 110;
    if (nearBottom) box.scrollTop = box.scrollHeight;
  }, [visibleComments.length]);

  useEffect(() => {
    const box = transcriptRef.current;
    if (!box || !transcriptPinned) return;
    box.scrollTop = box.scrollHeight;
  }, [visibleSegments.length, transcriptPinned]);

  const showVoiceNotice = (message: string) => {
    setVoiceNotice(message);
    if (voiceNoticeTimerRef.current) clearTimeout(voiceNoticeTimerRef.current);
    voiceNoticeTimerRef.current = setTimeout(() => setVoiceNotice(null), 2600);
  };

  const stopVoice = () => {
    voiceRequestIdRef.current += 1;
    voicePlaybackRef.current?.abort();
    voicePlaybackRef.current = null;
    setVoiceLoadingSegmentId(null);
    setPlayingVoiceSegmentId(null);
  };

  const playSegmentVoice = async (segment: WeverseLive["segments"][number]) => {
    if (segment.kind !== "speech" || !segment.original.trim()) return;

    if (playingVoiceSegmentId === segment.id || voiceLoadingSegmentId === segment.id) {
      stopVoice();
      return;
    }

    const characterId = segment.characterId || live.hostCharacterIds[0];
    if (!characterId) {
      showVoiceNotice("这段发言没有对应的角色语音");
      return;
    }

    const voiceConfig = resolveVoiceConfig(characterId, "weverse");
    if (!voiceConfig || !voiceConfig.enableTTS) {
      showVoiceNotice("请先在配置绑定中为 Weverse 绑定可用的语音方案");
      return;
    }

    unlockAudioPlayback();
    stopVoice();
    const requestId = ++voiceRequestIdRef.current;
    setVoiceLoadingSegmentId(segment.id);

    try {
      const cacheKey = [
        voiceConfig.id,
        voiceConfig.defaultVoice || "",
        voiceConfig.speechSpeed ?? 1,
        voiceConfig.speechPitch ?? 0,
        segment.original,
      ].join("::");
      let blob = liveVoiceCache.get(cacheKey) || null;
      if (!blob) {
        blob = await synthesizeSpeech(segment.original, voiceConfig);
        if (blob) cacheLiveVoice(cacheKey, blob);
      }
      if (requestId !== voiceRequestIdRef.current) return;
      if (!blob) throw new Error("语音服务没有返回音频");

      setVoiceLoadingSegmentId(null);
      setPlayingVoiceSegmentId(segment.id);
      const playback = playAudioBlobViaMediaElement(blob);
      voicePlaybackRef.current = playback;
      await playback.promise;
    } catch (error) {
      if (requestId === voiceRequestIdRef.current) {
        showVoiceNotice(error instanceof Error ? error.message : "语音播放失败，请检查语音配置");
      }
    } finally {
      if (requestId === voiceRequestIdRef.current) {
        voicePlaybackRef.current = null;
        setVoiceLoadingSegmentId(null);
        setPlayingVoiceSegmentId(null);
      }
    }
  };

  const sendDraft = () => {
    const value = draft.trim();
    if (!value || live.status === "ended") return;
    onSendComment(value);
    setDraft("");
  };

  const tapHeart = () => {
    onHeart();
    const id = ++heartIdRef.current;
    const x = 18 + Math.random() * 64;
    setHeartBursts((prev) => [...prev.slice(-11), { id, x }]);
    window.setTimeout(() => setHeartBursts((prev) => prev.filter((item) => item.id !== id)), 1250);
  };

  const canAdvance = live.status === "live" && !busy && !isPlaying && !isEnding;

  return (
    <div className={styles.liveRoom}>
      <header className={styles.liveWvsHeader}>
        <span />
        <div className={styles.liveWvsStatus}>{live.status === "live" ? <><i /> LIVE</> : "REPLAY"}</div>
        <button type="button" onClick={() => live.status === "live" ? setExitSheetOpen(true) : onBack()} aria-label="关闭"><X size={25} /></button>
      </header>

      <section className={styles.liveStage}>
        <div ref={transcriptRef} className={styles.liveTranscript} onScroll={(event) => {
          const box = event.currentTarget;
          setTranscriptPinned(box.scrollHeight - box.scrollTop - box.clientHeight < 38);
        }}>
          {visibleSegments.length ? visibleSegments.map((segment) => {
            const speaker = segment.characterId ? (speakerNames[segment.characterId] || segment.characterId) : "";
            const isVoiceLoading = voiceLoadingSegmentId === segment.id;
            const isVoicePlaying = playingVoiceSegmentId === segment.id;
            return <div key={segment.id} className={segment.kind === "action" ? styles.liveActionLine : segment.kind === "system" ? styles.liveSystemLine : styles.liveSpeechLine}>
              {speaker && segment.kind !== "system" ? <b>{speaker}</b> : null}
              {segment.kind === "speech" ? <div className={styles.liveSpeechAudioRow}>
                <button
                  type="button"
                  className={`${styles.liveSpeechVoiceButton} ${isVoiceLoading || isVoicePlaying ? styles.liveSpeechVoiceButtonActive : ""}`}
                  onClick={() => void playSegmentVoice(segment)}
                  aria-label={isVoiceLoading ? "停止生成语音" : isVoicePlaying ? "停止播放" : "播放这条发言"}
                  title={isVoiceLoading ? "停止生成语音" : isVoicePlaying ? "停止播放" : "播放这条发言"}
                >
                  {isVoiceLoading ? <LoaderCircle size={12} className={styles.liveVoiceSpinner} /> : isVoicePlaying ? <Square size={10} fill="currentColor" /> : <Volume2 size={13} />}
                </button>
                <p>{segment.original}</p>
              </div> : <p>{segment.original}</p>}
              {segment.kind === "speech" && segment.translated && segment.translated !== segment.original ? <small className={styles.liveSpeechTranslation}>{segment.translated}</small> : null}
            </div>;
          }) : <div className={styles.liveConnecting}>正在连接 LIVE…</div>}
        </div>
        <time className={styles.liveStageTime}>{liveElapsed(live.startedAt, live.status === "ended" && live.endedAt ? live.endedAt : clock)}</time>
        {voiceNotice ? <div className={styles.liveVoiceNotice}>{voiceNotice}</div> : null}
      </section>

      <div className={styles.liveMetricRow}>
        <span><Play size={13} fill="currentColor" /> {compact(live.viewerCount)}</span>
        <span><Heart size={14} /> {compact(live.heartCount)}</span>
      </div>

      {visibleArtistComments.length ? <button
        type="button"
        className={styles.liveArtistCommentEntry}
        data-open={artistCommentsOpen ? "true" : "false"}
        onClick={() => setArtistCommentsOpen((value) => !value)}
        aria-expanded={artistCommentsOpen}
      >
        <span className={styles.liveArtistEntryAvatars}>{visibleArtistComments.slice(-3).map((comment) => <i key={comment.id}>{comment.authorAvatarUrl ? <img src={comment.authorAvatarUrl} alt="" /> : comment.authorName.slice(0, 1)}</i>)}</span>
        <b>{visibleArtistComments.length} 条艺人评论</b><ChevronRight size={16} />
      </button> : null}

      {artistCommentsOpen && visibleArtistComments.length ? <div className={styles.liveArtistDrawer}>
        <div className={styles.liveArtistPanelList}>{visibleArtistComments.map((comment) => <article key={comment.id}>
          <span className={styles.liveArtistPanelAvatar}>{comment.authorAvatarUrl ? <img src={comment.authorAvatarUrl} alt="" /> : comment.authorName.slice(0,1)}</span>
          <div><div><b>{comment.authorName} <BadgeCheck size={13} fill="currentColor" /></b><time>{new Date(comment.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false })}</time></div><p>{comment.originalBody || comment.body}</p>{comment.originalBody && comment.originalBody !== comment.body ? <small>{comment.body}</small> : null}</div>
        </article>)}</div>
      </div> : null}

      <div ref={commentBoxRef} className={styles.liveComments}>
        {visibleComments.map((comment) => (
          <div key={comment.id} className={`${styles.liveComment} ${comment.authorType === "user" ? styles.liveCommentMe : ""} ${comment.authorType === "artist" ? styles.liveCommentArtist : ""}`}>
            {comment.authorType === "artist" ? <span className={styles.liveArtistCommentAvatar}>{comment.authorAvatarUrl ? <img src={comment.authorAvatarUrl} alt="" /> : comment.authorName.slice(0,1)}</span> : null}
            <div className={styles.liveCommentBody}>
              <div className={styles.liveCommentMeta}><b>{comment.authorType === "user" ? userName : comment.authorName}{comment.authorType === "artist" ? <BadgeCheck size={12} fill="currentColor" /> : null}</b><time>{new Date(comment.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false })}</time></div>
              <p>{comment.originalBody || comment.body}</p>
              {comment.originalBody && comment.originalBody !== comment.body ? <small>{comment.body}</small> : null}
            </div>
          </div>
        ))}
        {!visibleComments.length ? <div className={styles.liveWaiting}>观众正在进来…</div> : null}
      </div>

      <div className={styles.liveBottomPanel}>
        {live.status === "live" ? <div className={styles.liveComposer}>
          <input
            value={draft}
            disabled={isEnding}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); sendDraft(); } }}
            placeholder={isEnding ? "角色正在收尾…" : "输入评论，回车发送"}
          />
          <button type="button" className={styles.livePlaneButton} onClick={onAdvance} disabled={!canAdvance} aria-label={busy ? "生成中" : isPlaying ? "播放中" : "召唤或继续播放"}><Send size={18} /></button>
          <button type="button" className={styles.liveHeartButton} onClick={tapHeart} aria-label="点赞"><Heart size={20} fill="currentColor" /></button>
          <div className={styles.liveHeartFloatLayer}>{heartBursts.map((item) => <Heart key={item.id} className={styles.liveHeartFloat} style={{ left: `${item.x}%` }} size={19} fill="currentColor" />)}</div>
        </div> : <div className={styles.liveEndedBanner}>LIVE 已结束</div>}
      </div>

      {exitSheetOpen ? <div className={styles.liveExitMask} onMouseDown={(event) => { if (event.currentTarget === event.target) setExitSheetOpen(false); }}>
        <section className={styles.liveExitSheet}>
          <div className={styles.liveExitHandle} />
          <h3>退出直播？</h3>
          <p>可以只退出页面并保留后台播放，或者直接关闭本场直播。</p>
          <button type="button" className={styles.liveExitKeepBtn} onClick={() => { setExitSheetOpen(false); onBack(); }}>仅退出，保留后台播放</button>
          <button type="button" className={styles.liveExitEndBtn} disabled={busy} onClick={() => { setExitSheetOpen(false); onManualEnd(); }}>关闭直播</button>
          <button type="button" className={styles.liveExitCancelBtn} onClick={() => setExitSheetOpen(false)}>取消</button>
        </section>
      </div> : null}
    </div>
  );
}
