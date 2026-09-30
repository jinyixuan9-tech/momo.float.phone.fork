"use client";

import { useEffect, useState, useRef } from "react";
import { loadCharacters } from "@/lib/character-storage";
import { loadChatContacts } from "@/lib/chat-storage";
import { addMomentPost } from "@/lib/moments-storage";
import { onUserPost } from "@/lib/moments-engine";
import { resolveUserIdentity } from "@/lib/settings-storage";
import { saveMomentsImage } from "@/lib/moments-image-upload";
import { ChatFallbackAvatar } from "./chat-fallback-avatar";

type Props = {
    onClose: () => void;
    onPublished: () => void;
};

export function MomentsCompose({ onClose, onPublished }: Props) {
    const [text, setText] = useState("");
    const [photos, setPhotos] = useState<{ url: string; preview: string }[]>([]);
    const [uploading, setUploading] = useState(false);
    const [photoDesc, setPhotoDesc] = useState("");
    const [location, setLocation] = useState("");
    const [locationDraft, setLocationDraft] = useState("");
    const [mentionIds, setMentionIds] = useState<Set<string>>(new Set());

    // Panel toggles
    const [showMention, setShowMention] = useState(false);
    const [showLocation, setShowLocation] = useState(false);
    const [showVisibility, setShowVisibility] = useState(false);

    const [visibility, setVisibility] = useState<Record<string, boolean>>(() => {
        const contacts = loadChatContacts();
        const chars = loadCharacters();
        const map: Record<string, boolean> = {};
        contacts.forEach(c => {
            const char = chars.find(ch => ch.id === c.characterId);
            if (char) map[c.characterId] = true;
        });
        return map;
    });

    const fileRef = useRef<HTMLInputElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const previewsRef = useRef<string[]>([]);

    const contacts = loadChatContacts();
    const chars = loadCharacters();

    const enrichedContacts = contacts
        .map(c => ({ ...c, char: chars.find(ch => ch.id === c.characterId) }))
        .filter(c => c.char);

    const visibleCount = Object.values(visibility).filter(Boolean).length;
    const isAllSelected = enrichedContacts.length > 0 && enrichedContacts.every(c => visibility[c.characterId]);

    // ── Handlers ──

    useEffect(() => {
        const frame = window.requestAnimationFrame(() => {
            const textarea = textareaRef.current;
            if (!textarea) return;
            textarea.focus({ preventScroll: true });
            const cursor = textarea.value.length;
            textarea.setSelectionRange(cursor, cursor);
        });
        return () => window.cancelAnimationFrame(frame);
    }, []);

    const handleSelectAll = () => {
        const newVal = !isAllSelected;
        const map: Record<string, boolean> = {};
        enrichedContacts.forEach(c => { map[c.characterId] = newVal; });
        setVisibility(map);
    };

    const handleToggleChar = (charId: string) => {
        setVisibility(prev => ({ ...prev, [charId]: !prev[charId] }));
    };

    const handleToggleMention = (charId: string) => {
        setMentionIds(prev => {
            const next = new Set(prev);
            if (next.has(charId)) next.delete(charId);
            else next.add(charId);
            return next;
        });
    };

    const handleImageSelect = () => fileRef.current?.click();

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []).slice(0, 3 - photos.length);
        e.target.value = "";
        if (!files.length) return;
        setUploading(true);
        try {
            for (const file of files) {
                const url = await saveMomentsImage(file);
                const preview = URL.createObjectURL(file);
                previewsRef.current.push(preview);
                setPhotos(prev => prev.length < 3 ? [...prev, { url, preview }] : prev);
            }
        } catch (error) { console.error("[Moments] photo upload failed", error); }
        finally { setUploading(false); }
    };

    const handleRemovePhoto = (index: number) => {
        setPhotos(prev => {
            URL.revokeObjectURL(prev[index].preview);
            return prev.filter((_, i) => i !== index);
        });
    };

    useEffect(() => () => { previewsRef.current.forEach(url => URL.revokeObjectURL(url)); }, []);

    const handleConfirmLocation = () => {
        if (locationDraft.trim()) {
            setLocation(locationDraft.trim());
        }
        setShowLocation(false);
    };

    const handleRemoveLocation = () => {
        setLocation("");
        setLocationDraft("");
    };

    const handleRemoveMention = (charId: string) => {
        setMentionIds(prev => {
            const next = new Set(prev);
            next.delete(charId);
            return next;
        });
    };

    const handlePublish = () => {
        if ((!text.trim() && !photos.length) || uploading) return;

        // Build content with @mentions appended
        let content = text.trim();
        if (mentionIds.size > 0) {
            const names = Array.from(mentionIds)
                .map(id => chars.find(c => c.id === id)?.name)
                .filter(Boolean);
            if (names.length > 0) {
                content += " " + names.map(n => `@${n}`).join(" ");
            }
        }

        const visibleCharIds = Object.entries(visibility)
            .filter(([, v]) => v)
            .map(([k]) => k);

        const post = addMomentPost({
            authorType: "user",
            authorId: "user",
            content,
            photoUrl: photos[0]?.url,
            photoUrls: photos.map(p => p.url),
            photoDescription: photoDesc.trim() || undefined,
            visibility: visibleCharIds,
            location: location || undefined,
        });

        if (post) {
            try { onUserPost(post); } catch (e) { console.warn("[Compose] onUserPost error:", e); }
        }
        onPublished();
    };

    const canPublish = !uploading && (text.trim().length > 0 || photos.length > 0);

    // Get char name/avatar helpers
    const getCharName = (charId: string) => chars.find(c => c.id === charId)?.name ?? "未知";

    return (
        <div className="modal-overlay" data-ui="modal" role="presentation" onClick={onClose}>
            <div
                className="compose-modal"
                data-ui="modal-dialog"
                role="dialog"
                aria-modal="true"
                aria-label="发朋友圈"
                onClick={e => e.stopPropagation()}
            >
                <div className="compose-modal-header">
                    <button onClick={onClose} className="compose-header-icon" aria-label="取消">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                    </button>
                    <span className="compose-modal-title">发朋友圈</span>
                    <button onClick={handlePublish} disabled={!canPublish} className="compose-header-icon compose-header-send" aria-label="发表">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
                        </svg>
                    </button>
                </div>
                <div className="compose-modal-body">
                {/* ── Main Top Area: textarea + photo grid ── */}
                <div className="compose-top-area">
                    <textarea
                        ref={textareaRef}
                        value={text}
                        onChange={e => setText(e.target.value)}
                        placeholder="这一刻的想法..."
                        className="compose-textarea"
                    />

                    {/* Photo block */}
                    <div className="compose-media-grid">
                        {photos.map((photo, index) => (
                            <div className="compose-photo-block-preview" key={photo.url}>
                                <img src={photo.preview} alt={`照片 ${index + 1}`} />
                                <button type="button" onClick={() => handleRemovePhoto(index)} className="ui-close-sm compose-photo-remove" aria-label="移除照片">×</button>
                            </div>
                        ))}
                        {photos.length < 3 && <button type="button" onClick={handleImageSelect} disabled={uploading} className="compose-photo-block" aria-label="添加照片">
                            {uploading ? "上传中…" : <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>}
                        </button>}
                    </div>
                    <input ref={fileRef} type="file" accept="image/*" multiple onChange={handleFileChange} className="hidden" />
                </div>

                {/* ── Action Rows (Location, Mention, Visibility) ── */}
                <div className="compose-nav-list">
                    {/* Location Section */}
                    <div className="compose-nav-row" onClick={() => { setShowLocation(!showLocation); if (!showLocation) setLocationDraft(location); }}>
                        <div className="compose-nav-left">
                            <svg className="compose-nav-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                                <circle cx="12" cy="10" r="3" />
                            </svg>
                            <span className="compose-nav-label">所在位置</span>
                        </div>
                        <div className="compose-nav-right">
                            <span className="compose-nav-value">{location || ""}</span>
                            <svg className="compose-nav-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: showLocation ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }}>
                                <polyline points="9 18 15 12 9 6" />
                            </svg>
                        </div>
                    </div>
                    {showLocation && (
                        <div className="compose-panel-inline" style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 16px" }}>
                            <input
                                className="compose-location-input"
                                value={locationDraft}
                                onChange={e => setLocationDraft(e.target.value)}
                                placeholder="输入地点名称..."
                                onKeyDown={e => { if (e.key === "Enter") handleConfirmLocation(); }}
                            />
                            <button className="compose-inline-btn" onClick={handleConfirmLocation}>确定</button>
                        </div>
                    )}

                    {/* Mentions Section */}
                    <div className="compose-nav-row" onClick={() => setShowMention(!showMention)}>
                        <div className="compose-nav-left">
                            <span className="compose-nav-icon-text">@</span>
                            <span className="compose-nav-label">提醒谁看</span>
                        </div>
                        <div className="compose-nav-right">
                            <span className="compose-nav-value">{mentionIds.size > 0 ? `${Array.from(mentionIds).map(getCharName).join(", ")}` : ""}</span>
                            <svg className="compose-nav-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: showMention ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }}>
                                <polyline points="9 18 15 12 9 6" />
                            </svg>
                        </div>
                    </div>
                    {showMention && (
                        <div className="compose-panel-inline" style={{ padding: "12px 16px" }}>
                            <div className="chat-contact-list">
                                {enrichedContacts.map(c => (
                                    <div
                                        key={c.characterId}
                                        className="chat-contact-item"
                                        onClick={() => handleToggleMention(c.characterId)}
                                    >
                                        <div className="chat-contact-avatar" style={mentionIds.has(c.characterId) ? { outline: "2px solid var(--c-primary, #07C160)", outlineOffset: "2px" } : undefined}>
                                            {c.char!.avatar ? (
                                                <img src={c.char!.avatar} alt="" />
                                            ) : (
                                                <ChatFallbackAvatar />
                                            )}
                                        </div>
                                        <span className="chat-contact-name">{c.char!.name}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Visibility Section */}
                    <div className="compose-nav-row" onClick={() => setShowVisibility(!showVisibility)} style={{ borderBottom: showVisibility ? "0.5px solid var(--c-card-border)" : "none" }}>
                        <div className="compose-nav-left">
                            <svg className="compose-nav-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                                <circle cx="12" cy="12" r="3" />
                            </svg>
                            <span className="compose-nav-label">谁可以看</span>
                        </div>
                        <div className="compose-nav-right">
                            <span className="compose-nav-value">{visibleCount === enrichedContacts.length ? "公开" : `部分可见(${visibleCount})`}</span>
                            <svg className="compose-nav-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: showVisibility ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }}>
                                <polyline points="9 18 15 12 9 6" />
                            </svg>
                        </div>
                    </div>
                    {showVisibility && (
                        <div className="compose-panel-inline" style={{ padding: "12px 16px", borderBottom: "none" }}>
                            <div className="chat-contact-list">
                                <div
                                    className="chat-contact-item"
                                    onClick={handleSelectAll}
                                >
                                    <div className="chat-contact-avatar" style={isAllSelected ? { outline: "2px solid var(--c-primary, #07C160)", outlineOffset: "2px" } : undefined}>
                                        <span className="chat-contact-avatar-fallback">
                                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                                <circle cx="12" cy="12" r="10" />
                                                <path d="M2 12h20" />
                                                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                                            </svg>
                                        </span>
                                    </div>
                                    <span className="chat-contact-name">全部公开</span>
                                </div>
                                {enrichedContacts.map(c => (
                                    <div
                                        key={c.characterId}
                                        className="chat-contact-item"
                                        onClick={() => handleToggleChar(c.characterId)}
                                    >
                                        <div className="chat-contact-avatar" style={visibility[c.characterId] ? { outline: "2px solid var(--c-primary, #07C160)", outlineOffset: "2px" } : undefined}>
                                            {c.char!.avatar ? (
                                                <img src={c.char!.avatar} alt="" />
                                            ) : (
                                                <ChatFallbackAvatar />
                                            )}
                                        </div>
                                        <span className="chat-contact-name">{c.char!.name}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                </div>
            </div>
        </div>
    );
}
