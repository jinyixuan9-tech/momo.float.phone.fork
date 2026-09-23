"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, Eye, Heart, Play, Send, Sparkles, X } from "lucide-react";
import type { WeverseLive } from "@/lib/weverse-storage";
import styles from "./weverse-app.module.css";

type Props = {
  live: WeverseLive;
  hostName: string;
  hostAvatarUrl?: string;
  userName: string;
  busy?: boolean;
  onBack: () => void;
  onContinue: () => void;
  onSummon: (comments: string[]) => void;
  onHeart: () => void;
  onFinalizeEnd: () => void;
  onManualEnd: () => void;
};

function compact(value: number): string {
  const n = Math.max(0, Math.round(value || 0));
  if (n < 1000) return String(n);
  if (n < 10000) return `${(n / 1000).toFixed(n >= 1000 ? 1 : 0).replace(/\.0$/, "")}K`;
  if (n < 100000000) return `${(n / 10000).toFixed(n >= 100000 ? 1 : 1).replace(/\.0$/, "")}万`;
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

export function WeverseLiveView({ live, hostName, hostAvatarUrl, userName, busy, onBack, onContinue, onSummon, onHeart, onFinalizeEnd, onManualEnd }: Props) {
  const [clock, setClock] = useState(() => Date.now());
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<string[]>([]);
  const [exitSheetOpen, setExitSheetOpen] = useState(false);
  const [transcriptPinned, setTranscriptPinned] = useState(true);
  const commentBoxRef = useRef<HTMLDivElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 450);
    return () => window.clearInterval(timer);
  }, []);

  const visibleSegments = useMemo(() => live.segments.filter((item) => item.createdAt <= clock), [live.segments, clock]);
  const visibleComments = useMemo(() => live.comments.filter((item) => item.createdAt <= clock), [live.comments, clock]);
  const bufferedUntil = Math.max(live.startedAt, ...live.segments.map((item) => item.createdAt), ...live.comments.map((item) => item.createdAt));
  const isPlaying = live.status === "live" && bufferedUntil > clock;
  const isEnding = live.status === "live" && Boolean(live.endedAt);

  useEffect(() => {
    if (live.status === "live" && live.endedAt && clock >= live.endedAt) onFinalizeEnd();
  }, [clock, live.status, live.endedAt, onFinalizeEnd]);

  useEffect(() => {
    const box = commentBoxRef.current;
    if (!box) return;
    box.scrollTop = box.scrollHeight;
  }, [visibleComments.length]);

  useEffect(() => {
    const box = transcriptRef.current;
    if (!box || !transcriptPinned) return;
    box.scrollTop = box.scrollHeight;
  }, [visibleSegments.length, transcriptPinned]);

  const queueComment = () => {
    const value = draft.trim();
    if (!value || live.status === "ended") return;
    setPending((prev) => [...prev, value].slice(-8));
    setDraft("");
  };

  const summon = () => {
    if (busy || isPlaying || isEnding || live.status === "ended" || !pending.length) return;
    const comments = pending.slice();
    setPending([]);
    onSummon(comments);
  };

  const commentsNode = (
    <div ref={commentBoxRef} className={`${styles.liveComments} ${live.orientation === "portrait" ? styles.liveCommentsOverlay : ""}`}>
      {visibleComments.map((comment) => (
        <div key={comment.id} className={`${styles.liveComment} ${comment.authorType === "user" ? styles.liveCommentMe : ""}`}>
          <div className={styles.liveCommentMeta}><b>{comment.authorType === "user" ? userName : comment.authorName}</b><time>{new Date(comment.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false })}</time></div>
          <p>{comment.originalBody || comment.body}</p>
          {comment.originalBody && comment.originalBody !== comment.body ? <small>{comment.body}</small> : null}
        </div>
      ))}
      {!visibleComments.length ? <div className={styles.liveWaiting}>观众正在进来…</div> : null}
    </div>
  );

  return (
    <div className={`${styles.liveRoom} ${live.orientation === "portrait" ? styles.livePortrait : styles.liveLandscape}`}>
      <header className={styles.liveHeader}>
        <button type="button" onClick={() => live.status === "live" ? setExitSheetOpen(true) : onBack()} aria-label="返回"><ChevronLeft size={23} /></button>
        <div className={styles.liveHostMini}>
          <span className={styles.liveHostAvatar}>{hostAvatarUrl ? <img src={hostAvatarUrl} alt="" /> : hostName.slice(0,1)}</span>
          <div><b>{hostName}</b><small>{live.status === "live" ? "LIVE" : "REPLAY"}</small></div>
        </div>
        <div className={styles.liveHeaderStats}><span><Eye size={14} /> {compact(live.viewerCount)}</span><span><Heart size={14} /> {compact(live.heartCount)}</span></div>
      </header>

      <section className={styles.liveStage}>
        <div className={styles.liveStageTop}><span className={live.status === "live" ? styles.liveBadge : styles.replayBadge}>{live.status === "live" ? "LIVE" : "REPLAY"}</span><span>{liveElapsed(live.startedAt, live.status === "ended" && live.endedAt ? live.endedAt : clock)}</span></div>
        <div ref={transcriptRef} className={styles.liveTranscript} onScroll={(event) => { const box = event.currentTarget; setTranscriptPinned(box.scrollHeight - box.scrollTop - box.clientHeight < 36); }}>
          {visibleSegments.length ? visibleSegments.map((segment) => (
            <div key={segment.id} className={segment.kind === "action" ? styles.liveActionLine : segment.kind === "system" ? styles.liveSystemLine : styles.liveSpeechLine}>
              {segment.kind === "speech" ? <b>{hostName}</b> : null}
              <p>{segment.original}</p>
              {segment.kind === "speech" && segment.translated && segment.translated !== segment.original ? <small>{segment.translated}</small> : null}
            </div>
          )) : <div className={styles.liveConnecting}><Sparkles size={18} /> 正在连接 LIVE…</div>}
        </div>
        {live.orientation === "portrait" ? commentsNode : null}
      </section>

      {live.orientation === "landscape" ? <div className={styles.liveBelowStage}>
        <div className={styles.liveTitleRow}><div><h2>{live.title}</h2><p>{live.theme ? `主题 · ${live.theme}` : "成员私人 LIVE"}</p></div></div>
        {commentsNode}
      </div> : <div className={styles.livePortraitTitle}><b>{live.title}</b><span>{live.theme || "成员私人 LIVE"}</span></div>}

      <div className={styles.liveBottomPanel}>
        {pending.length ? <div className={styles.livePending}><div><b>待发送 {pending.length} 条</b><span>召唤时会一起放进这一轮直播</span></div><div>{pending.map((item, index) => <button type="button" key={`${item}-${index}`} onClick={() => setPending((prev) => prev.filter((_, i) => i !== index))}>{item}<X size={12} /></button>)}</div></div> : null}
        {live.status === "live" ? <div className={styles.liveAdvanceRow}>
          <button type="button" className={styles.liveContinueBtn} disabled={busy || isPlaying || isEnding} onClick={onContinue}><Play size={15} fill="currentColor" /> {busy ? "生成中…" : isEnding ? "收尾中…" : isPlaying ? "播放中…" : "继续播放"}</button>
          <button type="button" className={styles.liveSummonBtn} disabled={busy || isPlaying || isEnding || !pending.length} onClick={summon}><Sparkles size={15} /> 召唤{pending.length ? ` · ${pending.length}` : ""}</button>
        </div> : <div className={styles.liveEndedBanner}>LIVE 已结束 · 现在是回放</div>}
        <div className={styles.liveComposer}>
          <input value={draft} disabled={live.status === "ended" || isEnding} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); queueComment(); } }} placeholder={live.status === "ended" ? "回放不能发送评论" : isEnding ? "角色正在收尾…" : "写评论，回车加入本轮…"} />
          <button type="button" onClick={queueComment} disabled={!draft.trim() || live.status === "ended"}><Send size={17} /></button>
          <button type="button" className={styles.liveHeartButton} onClick={onHeart}><Heart size={18} /></button>
        </div>
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
