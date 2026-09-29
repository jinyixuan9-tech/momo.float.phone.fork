"use client";

import { useEffect, useState } from "react";
import { useMusicPlayerOptional } from "@/lib/music-context";
import { useListenSessions } from "@/lib/together-listening";
import { addTracksToPlaylist, getTrackPlaylistId, getUserPlaylists, isNeteaseConfigured, recordTrackPlaylist, removeTrackPlaylistRecord, removeTracksFromPlaylist, type NeteasePlaylist } from "@/lib/music-service";

export default function MusicIsland({ onOpen }: { onOpen: () => void }) {
    const player = useMusicPlayerOptional();
    const together = useListenSessions().some(s => !s.endedAt);
    const [expanded, setExpanded] = useState(false);
    const [playlists, setPlaylists] = useState<NeteasePlaylist[] | null>(null);
    const [feedback, setFeedback] = useState("");
    const track = player?.currentTrack;
    const neteaseId = track?.id.startsWith("netease_") ? Number(track.id.slice(8)) : 0;
    const liked = neteaseId ? Boolean(getTrackPlaylistId(neteaseId)) : Boolean(track?.liked);
    useEffect(() => { if (!track) { setExpanded(false); setPlaylists(null); } }, [track?.id]);

    const favorite = async () => {
        if (!player || !track) return;
        if (neteaseId && isNeteaseConfigured()) {
            if (liked) {
                const pid = getTrackPlaylistId(neteaseId);
                if (!pid) return;
                const result = await removeTracksFromPlaylist(pid, [neteaseId]);
                if (result.ok) { removeTrackPlaylistRecord(neteaseId); player.setTrackLiked(track.id, false); }
                else setFeedback(result.message);
            } else {
                const list = await getUserPlaylists();
                if (list.length) setPlaylists(list);
                else setFeedback("还没有可用歌单");
            }
        } else player.setTrackLiked(track.id, !liked);
    };

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
                <button onClick={() => player.prev()} aria-label="上一首">|◀</button>
                <button onClick={() => player.togglePlay()} aria-label={player.isPlaying ? "暂停" : "播放"}>{player.isPlaying ? "Ⅱ" : "▶"}</button>
                <button onClick={() => player.next()} aria-label="下一首">▶|</button>
                <button onClick={() => { void favorite(); }} aria-label={liked ? "取消收藏" : "收藏"} className={liked ? "liked" : ""}>{liked ? "♥" : "♡"}</button>
            </div>
            {playlists && <div className="music-island-playlists"><span>收藏到歌单</span>{playlists.map(list => <button key={list.id} onClick={async () => {
                const result = await addTracksToPlaylist(list.id, [neteaseId]);
                if (result.ok) { recordTrackPlaylist(neteaseId, list.id); player.setTrackLiked(track.id, true); setPlaylists(null); }
                else setFeedback(result.message);
            }}>{list.name}</button>)}<button onClick={() => setPlaylists(null)}>取消</button></div>}
            {feedback && <span className="music-island-feedback" onClick={() => setFeedback("")}>{feedback}</span>}
        </div>}
    </div>;
}
