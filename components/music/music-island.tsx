"use client";

import { useEffect, useState } from "react";
import { useMusicPlayerOptional } from "@/lib/music-context";
import { useListenSessions } from "@/lib/together-listening";

export default function MusicIsland({ onOpen }: { onOpen: () => void }) {
    const player = useMusicPlayerOptional();
    const together = useListenSessions().some(s => !s.endedAt);
    const [expanded, setExpanded] = useState(false);
    const track = player?.currentTrack;
    useEffect(() => { if (!track) setExpanded(false); }, [track?.id]);

    if (!player || !track) return <span className="status-island" aria-label="灵动岛" />;
    return <div className={`status-island music-island${expanded ? " music-island-expanded" : ""}`}>
        {!expanded ? <button className="music-island-compact" onClick={() => setExpanded(true)} aria-label="展开音乐播放控制">
            {track.coverUrl ? <img src={track.coverUrl} alt="" /> : <span className="music-island-art-empty">♫</span>}
            <span className="music-island-compact-name">{together ? "一起听 · " : ""}{track.title}</span>
            <span className={`music-island-eq${player.isPlaying ? "" : " paused"}`}><i/><i/><i/><i/></span>
        </button> : <div className="music-island-detail">
            <div className="music-island-head">
                <button className="music-island-art" onClick={onOpen} aria-label="打开音乐播放器">{track.coverUrl ? <img src={track.coverUrl} alt="" /> : "♫"}</button>
                <button className="music-island-title" onClick={onOpen}><strong>{track.title}</strong><small>{together ? "一起听 · " : ""}{track.artist}</small></button>
                <button className="music-island-collapse" onClick={() => setExpanded(false)} aria-label="收起">⌃</button>
            </div>
            <div className="music-island-progress"><span style={{ width: `${Math.min(100, player.duration ? player.currentTime / player.duration * 100 : 0)}%` }} /></div>
            <div className="music-island-actions">
                <button onClick={() => player.prev()} aria-label="上一首"><svg viewBox="0 0 36 36" fill="currentColor" aria-hidden="true"><path d="M18 5 3 18l15 13V5Zm15 0L18 18l15 13V5Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg></button>
                <button onClick={() => player.togglePlay()} aria-label={player.isPlaying ? "暂停" : "播放"}>
                    {player.isPlaying ? <svg viewBox="0 0 36 36" fill="currentColor" aria-hidden="true"><rect x="7" y="4" width="8" height="28" rx="2"/><rect x="21" y="4" width="8" height="28" rx="2"/></svg>
                        : <svg viewBox="0 0 36 36" fill="currentColor" aria-hidden="true"><path d="M9 4v28l23-14L9 4Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.5"/></svg>}
                </button>
                <button onClick={() => player.next()} aria-label="下一首"><svg viewBox="0 0 36 36" fill="currentColor" aria-hidden="true"><path d="M18 5 3 18l15 13V5Zm15 0L18 18l15 13V5Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/></svg></button>
            </div>
        </div>}
    </div>;
}
