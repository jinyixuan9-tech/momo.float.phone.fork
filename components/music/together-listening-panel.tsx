"use client";

import { useEffect, useState } from "react";
import { loadCharacters } from "@/lib/character-storage";
import { useMusicControls } from "@/lib/music-context";
import { isNeteaseConfigured } from "@/lib/music-service";
import {
    endListenSession, recordListenEntry,
    startListenSession, useListenSessions,
} from "@/lib/together-listening";
import { getMusicControlBridge } from "@/lib/music-control-bridge";

function clock(seconds: number): string {
    const minutes = Math.floor(Math.max(0, seconds) / 60);
    return `${Math.floor(minutes / 60).toString().padStart(2, "0")}:${(minutes % 60).toString().padStart(2, "0")}`;
}

export default function TogetherListeningPanel({ onClose }: { onClose: () => void }) {
    const player = useMusicControls();
    const sessions = useListenSessions();
    const active = sessions.find(s => !s.endedAt) || null;
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [query, setQuery] = useState("");
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState("");
    const [now, setNow] = useState(Date.now());
    const [characters, setCharacters] = useState(() => loadCharacters());
    useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
    useEffect(() => { setCharacters(loadCharacters()); }, [sessions]);
    const selected = sessions.find(s => s.id === selectedId) || active;
    const participant = selected && characters.find(c => c.id === selected.characterId);

    const request = async () => {
        const text = query.trim();
        if (!text || !active || busy) return;
        const bridge = getMusicControlBridge();
        if (!bridge) { setNotice("播放器还没准备好"); return; }
        setBusy(true);
        try {
            const result = await bridge.playByQuery(text);
            if (result.ok && result.track) {
                recordListenEntry("user", `点歌：${result.track.title}`, result.track.id);
                setQuery("");
            }
            setNotice(result.message);
        } catch (error) {
            setNotice(error instanceof Error ? error.message : "点歌失败，请重试");
        } finally { setBusy(false); }
    };

    return (
        <div className="together-sheet" role="dialog" aria-label="一起听">
            <div className="together-sheet-header"><strong>一起听</strong><button onClick={onClose} aria-label="关闭">×</button></div>
            {!isNeteaseConfigured() && <p>在线音乐需要先在 Music 设置中填写网易云 API 地址；本地歌曲仍可一起听。</p>}
            {active ? (
                <div className="together-active">
                    <span>与 {characters.find(c => c.id === active.characterId)?.name || "TA"} 一起听</span>
                    <b>{clock((now - active.startedAt) / 1000)}</b>
                    <button onClick={() => { endListenSession(); setSelectedId(active.id); }}>结束</button>
                </div>
            ) : (
                <div className="together-people">
                    <p>选一个人，一起听当前 Music 里的歌</p>
                    {characters.map(c => <button key={c.id} onClick={() => { startListenSession(c.id); setSelectedId(null); }}>
                        {c.avatar && <img src={c.avatar} alt="" />}<span>{c.name}</span>
                    </button>)}
                    {characters.length === 0 && <p>先在 Chat 里添加角色</p>}
                </div>
            )}
            {active && <div className="together-controls">
                <div>{player.currentTrack ? `${player.currentTrack.title} · ${player.currentTrack.artist}` : "还没播放歌曲"}</div>
                <div className="together-buttons">
                    <button onClick={player.prev} aria-label="上一首">⏮</button>
                    <button onClick={player.togglePlay} aria-label={player.isPlaying ? "暂停" : "播放"}>{player.isPlaying ? "⏸" : "▶"}</button>
                    <button onClick={player.next} aria-label="下一首">⏭</button>
                    <button onClick={() => { player.openFullPlayer(); onClose(); }}>打开播放器 · 收藏</button>
                </div>
                <div className="together-request"><input value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === "Enter") void request(); }} placeholder="点一首歌" /><button disabled={busy || !query.trim()} onClick={() => void request()}>点歌</button></div>
                {notice && <small>{notice}</small>}
            </div>}
            {selected && <div className="together-history">
                <h3>{participant?.name || "TA"} · {selected.endedAt ? `已结束 · ${clock((selected.endedAt - selected.startedAt) / 1000)}` : "进行中"}</h3>
                {selected.entries.length ? selected.entries.map((entry, index) => <p key={`${entry.at}-${index}`}><span>{new Date(entry.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · {entry.by === "user" ? "我" : participant?.name || "TA"}</span> {entry.text}</p>) : <p>还没有播放记录</p>}
            </div>}
            <div className="together-sessions">{sessions.filter(s => s.endedAt && s.id !== selected?.id).slice(0, 10).map(s => <button key={s.id} onClick={() => setSelectedId(s.id)}>{characters.find(c => c.id === s.characterId)?.name || "TA"} · {new Date(s.startedAt).toLocaleDateString()} · {clock(((s.endedAt || now) - s.startedAt) / 1000)}</button>)}</div>
        </div>
    );
}
