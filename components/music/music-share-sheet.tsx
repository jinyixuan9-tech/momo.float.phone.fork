"use client";

import { useMemo, useState } from "react";
import type { MusicTrack } from "@/lib/music-storage";
import { loadCharacters } from "@/lib/character-storage";
import { resolveChatCharacterAvatar, resolveChatCharacterDisplayName } from "@/lib/chat-profile-storage";
import { createOrGetSession, pushChatMessage } from "@/lib/chat-storage";
import { startListenSession } from "@/lib/together-listening";

export default function MusicShareSheet({ track, onClose, onShared }: {
    track: MusicTrack;
    onClose: () => void;
    onShared: (name: string) => void;
}) {
    const characters = useMemo(() => loadCharacters(), []);
    const [query, setQuery] = useState("");
    const visible = characters.filter(char => resolveChatCharacterDisplayName(char).toLowerCase().includes(query.trim().toLowerCase()));

    return <div className="mp-share-overlay" onClick={onClose}>
        <section className="mp-share-sheet" onClick={e => e.stopPropagation()} aria-label="分享音乐">
            <div className="mp-share-grip" />
            <div className="mp-share-heading"><div><span>把这一刻分享给</span><h2>分享音乐</h2></div><button onClick={onClose} aria-label="关闭">×</button></div>
            <div className="mp-share-track">
                {track.coverUrl ? <img src={track.coverUrl} alt="" /> : <span className="mp-share-cover-empty">♪</span>}
                <div><strong>{track.title}</strong><small>{track.artist || "未知歌手"}</small></div>
                <span className="mp-share-track-icon">♫</span>
            </div>
            {characters.length > 6 && <input className="mp-share-search" value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索角色" aria-label="搜索角色" />}
            <div className="mp-share-list">
                {visible.map(char => {
                    const name = resolveChatCharacterDisplayName(char);
                    const avatar = resolveChatCharacterAvatar(char);
                    return <div className="mp-share-person" key={char.id}>
                        <span className="mp-share-avatar">{avatar ? <img src={avatar} alt="" /> : name.slice(0, 1)}</span>
                        <span className="mp-share-person-name">{name}</span>
                        <button className="mp-share-action mp-share-together" onClick={() => { startListenSession(char.id); onClose(); }}>一起听</button>
                        <button className="mp-share-action mp-share-send" onClick={() => {
                            const session = createOrGetSession(char.id);
                            pushChatMessage({ sessionId: session.id, role: "user", content: "", mediaType: "music_share", mediaData: {
                                musicTitle: track.title, musicArtist: track.artist, musicCoverUrl: track.coverUrl, label: `${track.title} - ${track.artist}`,
                            } });
                            window.dispatchEvent(new CustomEvent("chat-messages-updated", { detail: { sessionId: session.id } }));
                            onClose();
                            onShared(name);
                        }}>分享</button>
                    </div>;
                })}
                {visible.length === 0 && <div className="mp-share-empty">{characters.length ? "没有找到角色" : "还没有角色"}</div>}
            </div>
            <p className="mp-share-hint">分享会发送音乐卡片 · 一起听会直接进入双人播放</p>
        </section>
    </div>;
}
