"use client";

import { useState, useEffect, useCallback, useLayoutEffect, useRef } from "react";
import { getAllPosts, deleteMomentPost, getUnreadMomentsNotifications, saveMomentsLastSeen, addMomentComment } from "@/lib/moments-storage";
import { loadChatContacts } from "@/lib/chat-storage";
import { resolveUserIdentity, USER_IDENTITIES_UPDATED_EVENT } from "@/lib/settings-storage";
import { saveChatImageToIndexedDB, getChatImageFromIndexedDB } from "@/lib/chat-asset-storage";
import type { MomentComment, MomentPost } from "@/lib/moments-types";
import { MomentPostCard } from "./moment-post-card";
import { MomentsCompose } from "./moments-compose";
import { ConfirmDialog } from "@/components/ui/modal";
import { PageShell } from "@/components/ui/page-shell";
import { AlertCircle, Camera, Music2, Play, Pause, ChevronRight, SquarePen, Images } from "lucide-react";
import { getMomentsScreenName, getMomentsSignature, saveMomentsProfile, getFeaturedPhotos, getMyMomentsPhotos, addFeaturedPhoto, removeFeaturedPhoto, addManualPhoto, getMomentsMusicId, setMomentsMusicId, type MomentsPhoto } from "@/lib/moments-profile";
import { saveMomentsImage } from "@/lib/moments-image-upload";
import { MomentsPhotoImage, useMomentsPhotoUrl } from "./moments-photo";
import { loadAllTracks, type MusicTrack } from "@/lib/music-storage";
import { useMusicControlsOptional } from "@/lib/music-context";
import { kvGet, kvSet, registerKvMigration } from "@/lib/kv-db";
import { onUserComment, MOMENT_PHOTO_GENERATION_FAILED_EVENT } from "@/lib/moments-engine";
import { GeneratedImageErrorDialog } from "./generated-image-error-dialog";

const COVER_ASSET_KEY = "moments_cover_asset_id";
registerKvMigration(COVER_ASSET_KEY);


const MOMENTS_INITIAL_POST_COUNT = 10;
const MOMENTS_LOAD_MORE_COUNT = 10;

type MomentScrollAnchorSnapshot = {
    postId: string;
    offsetDelta: number;
};

type ActiveMomentComposer = {
    postId: string;
    replyTo?: {
        commentId: string;
        authorId: string;
        authorType: "user" | "character" | "npc";
        name: string;
    };
};

type MomentsFeedProps = {
    onCloseApp: () => void;
};

export function MomentsFeed({ onCloseApp }: MomentsFeedProps) {
    const [posts, setPosts] = useState<MomentPost[]>([]);
    const [showCompose, setShowCompose] = useState(false);
    const openMyLife = () => setShowCompose(true);
    const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
    // 后台生图失败：弹一次弹窗提示，关掉即消失（同时多条失败只提示第一条）
    const [photoFailureNotice, setPhotoFailureNotice] = useState<string | null>(null);
    const [coverUrl, setCoverUrl] = useState<string | null>(null);
    const coverInputRef = useRef<HTMLInputElement>(null);
    const scrollRef = useRef<HTMLDivElement>(null);
    const [userIdentity, setUserIdentity] = useState(() => resolveUserIdentity());
    const [screenName, setScreenName] = useState("我的朋友圈");
    const [signature, setSignature] = useState("写下你的签名");
    const [editProfile, setEditProfile] = useState(false);
    const [draftName, setDraftName] = useState(screenName);
    const [draftSignature, setDraftSignature] = useState(signature);
    const [featured, setFeatured] = useState<MomentsPhoto[]>([]);
    const [showGallery, setShowGallery] = useState(false);
    const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
    const [musicPicker, setMusicPicker] = useState(false);
    const [musicTracks, setMusicTracks] = useState<MusicTrack[]>([]);
    const [musicId, setMusicId] = useState("");
    const [uploadingPhoto, setUploadingPhoto] = useState(false);
    const manualInputRef = useRef<HTMLInputElement>(null);
    const touchX = useRef<number | null>(null);
    const music = useMusicControlsOptional();
    const selectedTrack = [...musicTracks, ...(music?.queue || []), ...(music?.currentTrack ? [music.currentTrack] : [])].find(t => t.id === musicId);
    const galleryPhotos = getMyMomentsPhotos(posts);
    const lightboxPhoto = lightboxIndex === null ? null : galleryPhotos[lightboxIndex];
    const lightboxSrc = useMomentsPhotoUrl(lightboxPhoto?.url);

    useEffect(() => {
        const syncIdentity = () => setUserIdentity(resolveUserIdentity());
        const syncProfile = () => { setScreenName(getMomentsScreenName()); setSignature(getMomentsSignature()); setFeatured(getFeaturedPhotos()); setMusicId(getMomentsMusicId()); };
        window.addEventListener(USER_IDENTITIES_UPDATED_EVENT, syncIdentity);
        window.addEventListener("moments-profile-updated", syncProfile);
        syncProfile();
        loadAllTracks().then(setMusicTracks).catch(console.error);
        return () => { window.removeEventListener(USER_IDENTITIES_UPDATED_EVENT, syncIdentity); window.removeEventListener("moments-profile-updated", syncProfile); };
    }, []);

    const uploadStandalonePhoto = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) return;
        setUploadingPhoto(true);
        try { const url = await saveMomentsImage(file); addManualPhoto(url); if (getFeaturedPhotos().length < 3) addFeaturedPhoto({ url, addedAt: new Date().toISOString() }); }
        catch (error) { console.error("[Moments] photo upload failed", error); }
        finally { setUploadingPhoto(false); }
    };
    const jumpToPost = (postId: string) => {
        setLightboxIndex(null);
        setShowGallery(false);
        setVisiblePostCount(posts.length);
        window.setTimeout(() => {
            const el = Array.from(document.querySelectorAll<HTMLElement>("[data-moment-post-id]")).find(node => node.dataset.momentPostId === postId);
            el?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 80);
    };

    const [unreadNotifs, setUnreadNotifs] = useState<ReturnType<typeof getUnreadMomentsNotifications>>([]);
    const [showNotifModal, setShowNotifModal] = useState(false);
    const [headerScrolled, setHeaderScrolled] = useState(false);
    const [visiblePostCount, setVisiblePostCount] = useState(MOMENTS_INITIAL_POST_COUNT);
    const [activeComposer, setActiveComposer] = useState<ActiveMomentComposer | null>(null);
    const [composerText, setComposerText] = useState("");
    const composerInputRef = useRef<HTMLTextAreaElement>(null);
    const loadMoreRestoreRef = useRef<{ scrollHeight: number; scrollTop: number } | null>(null);
    const loadMoreAnchorRef = useRef<MomentScrollAnchorSnapshot | null>(null);
    const loadMoreResizeObserverRef = useRef<ResizeObserver | null>(null);
    const loadMoreAnchorTimerRef = useRef<number | null>(null);

    const getScrollElement = useCallback(() => {
        if (scrollRef.current) return scrollRef.current;
        if (typeof document === "undefined") return null;
        const el = document.querySelector<HTMLDivElement>(".moments-feed-page .page-body");
        if (el) scrollRef.current = el;
        return el;
    }, []);

    const stopLoadMoreAnchorTracking = useCallback(() => {
        loadMoreResizeObserverRef.current?.disconnect();
        loadMoreResizeObserverRef.current = null;
        if (loadMoreAnchorTimerRef.current !== null) {
            window.clearTimeout(loadMoreAnchorTimerRef.current);
            loadMoreAnchorTimerRef.current = null;
        }
        loadMoreAnchorRef.current = null;
    }, []);

    useEffect(() => stopLoadMoreAnchorTracking, [stopLoadMoreAnchorTracking]);

    const refreshPosts = useCallback(() => {
        const contactIds = new Set(loadChatContacts().map(c => c.characterId));
        setPosts(getAllPosts().filter(p => p.authorType === "user" || contactIds.has(p.authorId)));
        setUnreadNotifs(getUnreadMomentsNotifications());
    }, []);

    const captureScrollAnchor = useCallback((): MomentScrollAnchorSnapshot | null => {
        const el = getScrollElement();
        if (!el) return null;
        const containerRect = el.getBoundingClientRect();
        const candidates = Array.from(el.querySelectorAll<HTMLElement>("[data-moment-post-id]"));
        for (const candidate of candidates) {
            const rect = candidate.getBoundingClientRect();
            if (rect.bottom <= containerRect.top) continue;
            if (rect.top >= containerRect.bottom) continue;
            const postId = candidate.dataset.momentPostId;
            if (!postId) continue;
            return {
                postId,
                offsetDelta: candidate.offsetTop - el.scrollTop,
            };
        }
        return null;
    }, [getScrollElement]);

    const restoreScrollAnchor = useCallback((anchor: MomentScrollAnchorSnapshot | null): boolean => {
        const el = getScrollElement();
        if (!el || !anchor) return false;
        const target = Array.from(el.querySelectorAll<HTMLElement>("[data-moment-post-id]"))
            .find(candidate => candidate.dataset.momentPostId === anchor.postId);
        if (!target) return false;
        el.scrollTop = target.offsetTop - anchor.offsetDelta;
        return true;
    }, [getScrollElement]);

    const watchLoadMoreAnchorImages = useCallback((anchor: MomentScrollAnchorSnapshot | null) => {
        const el = getScrollElement();
        if (!el || !anchor) {
            stopLoadMoreAnchorTracking();
            return;
        }
        const target = Array.from(el.querySelectorAll<HTMLElement>("[data-moment-post-id]"))
            .find(candidate => candidate.dataset.momentPostId === anchor.postId);
        if (!target) {
            stopLoadMoreAnchorTracking();
            return;
        }

        loadMoreResizeObserverRef.current?.disconnect();
        loadMoreResizeObserverRef.current = null;
        if (loadMoreAnchorTimerRef.current !== null) {
            window.clearTimeout(loadMoreAnchorTimerRef.current);
            loadMoreAnchorTimerRef.current = null;
        }

        const targetTop = target.getBoundingClientRect().top;
        const imagesAboveAnchor = Array.from(el.querySelectorAll("img"))
            .filter(img => img.getBoundingClientRect().top < targetTop);

        if (imagesAboveAnchor.length === 0) {
            stopLoadMoreAnchorTracking();
            return;
        }

        const restoreAfterImageResize = () => {
            if (loadMoreAnchorRef.current !== anchor) return;
            restoreScrollAnchor(anchor);
            requestAnimationFrame(() => restoreScrollAnchor(anchor));
        };

        if (typeof ResizeObserver !== "undefined") {
            const observer = new ResizeObserver(restoreAfterImageResize);
            imagesAboveAnchor.forEach(img => observer.observe(img));
            loadMoreResizeObserverRef.current = observer;
        }

        imagesAboveAnchor.forEach(img => {
            img.addEventListener("load", restoreAfterImageResize, { once: true });
            img.addEventListener("error", restoreAfterImageResize, { once: true });
            img.decode?.().then(restoreAfterImageResize).catch(() => {});
        });

        loadMoreAnchorTimerRef.current = window.setTimeout(() => {
            if (loadMoreAnchorRef.current === anchor) {
                stopLoadMoreAnchorTracking();
            }
        }, 3000);
    }, [getScrollElement, restoreScrollAnchor, stopLoadMoreAnchorTracking]);

    const visiblePosts = posts.slice(0, visiblePostCount);
    const hasMorePosts = visiblePostCount < posts.length;

    const handleLoadMorePosts = useCallback(() => {
        if (!hasMorePosts) return;
        stopLoadMoreAnchorTracking();
        const el = getScrollElement();
        if (el) {
            loadMoreAnchorRef.current = captureScrollAnchor();
            loadMoreRestoreRef.current = {
                scrollHeight: el.scrollHeight,
                scrollTop: el.scrollTop,
            };
        }
        setVisiblePostCount(current => Math.min(current + MOMENTS_LOAD_MORE_COUNT, posts.length));
    }, [captureScrollAnchor, getScrollElement, hasMorePosts, posts.length, stopLoadMoreAnchorTracking]);

    const closeComposer = useCallback(() => {
        setActiveComposer(null);
        setComposerText("");
        composerInputRef.current?.blur();
    }, []);

    const openCommentComposer = useCallback((post: MomentPost) => {
        setComposerText("");
        setActiveComposer({ postId: post.id });
    }, []);

    const openReplyComposer = useCallback((post: MomentPost, comment: MomentComment, replyName: string) => {
        setComposerText("");
        setActiveComposer({
            postId: post.id,
            replyTo: {
                commentId: comment.id,
                authorId: comment.authorId,
                authorType: comment.authorType,
                name: replyName,
            },
        });
    }, []);

    const submitComposer = useCallback(() => {
        const text = composerText.trim();
        const target = activeComposer;
        if (!text || !target) return;

        addMomentComment({
            postId: target.postId,
            authorType: "user",
            authorId: "user",
            content: text,
            replyToCommentId: target.replyTo?.commentId,
            replyToAuthorId: target.replyTo?.authorId,
            replyToAuthorType: target.replyTo?.authorType,
        });

        closeComposer();
        refreshPosts();
        window.dispatchEvent(new CustomEvent("moments-updated"));
        onUserComment(target.postId);
    }, [activeComposer, closeComposer, composerText, refreshPosts]);

    useEffect(() => {
        if (!activeComposer) return;
        const timer = window.setTimeout(() => {
            composerInputRef.current?.focus({ preventScroll: true });
        }, 40);
        return () => window.clearTimeout(timer);
    }, [activeComposer]);

    useEffect(() => {
        if (!activeComposer) return;
        const exists = posts.some(post => post.id === activeComposer.postId);
        if (!exists) closeComposer();
    }, [activeComposer, closeComposer, posts]);

    useLayoutEffect(() => {
        const restore = loadMoreRestoreRef.current;
        if (!restore) return;
        const el = getScrollElement();
        const anchor = loadMoreAnchorRef.current;
        if (el && !restoreScrollAnchor(anchor)) {
            el.scrollTop = restore.scrollTop;
        }
        loadMoreRestoreRef.current = null;
        watchLoadMoreAnchorImages(anchor);
    }, [getScrollElement, restoreScrollAnchor, visiblePostCount, watchLoadMoreAnchorImages]);

    useEffect(() => {
        const bodyEl = getScrollElement();
        if (!bodyEl) return;
        
        const handleScroll = () => {
            setHeaderScrolled(bodyEl.scrollTop > 160);
        };
        bodyEl.addEventListener('scroll', handleScroll, { passive: true });
        return () => bodyEl.removeEventListener('scroll', handleScroll);
    }, [getScrollElement]);

    // Load posts + start background service + load cover
    useEffect(() => {
        refreshPosts();

        const handler = () => refreshPosts();
        window.addEventListener("moments-updated", handler);

        const photoFailureHandler = (event: Event) => {
            const reason = (event as CustomEvent<{ message?: string }>).detail?.message;
            setPhotoFailureNotice(prev => prev ?? (reason || "生图配置未启用或生成失败"));
        };
        window.addEventListener(MOMENT_PHOTO_GENERATION_FAILED_EVENT, photoFailureHandler);

        // Load saved cover image
        const savedId = kvGet(COVER_ASSET_KEY);
        if (savedId) {
            getChatImageFromIndexedDB(savedId).then(url => {
                if (url) setCoverUrl(url);
            });
        }

        return () => {
            window.removeEventListener("moments-updated", handler);
            window.removeEventListener(MOMENT_PHOTO_GENERATION_FAILED_EVENT, photoFailureHandler);
        };
    }, [refreshPosts]);

    // Hide tab bar only when the full compose page is open.
    useEffect(() => {
        window.dispatchEvent(new CustomEvent("chat-hide-tabbar", { detail: showCompose }));
        return () => {
            window.dispatchEvent(new CustomEvent("chat-hide-tabbar", { detail: false }));
        };
    }, [showCompose]);


    const handleDeleteConfirm = () => {
        if (confirmDeleteId) {
            deleteMomentPost(confirmDeleteId);
            setConfirmDeleteId(null);
            refreshPosts();
            window.dispatchEvent(new CustomEvent("moments-updated"));
        }
    };

    const handlePublished = () => {
        setShowCompose(false);
        refreshPosts();
        window.dispatchEvent(new CustomEvent("moments-updated"));
    };

    const handleCoverUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const img = new Image();
        const objectUrl = URL.createObjectURL(file);
        img.onload = () => {
            const maxSize = 800;
            let w = img.width, h = img.height;
            if (w > maxSize || h > maxSize) {
                if (w > h) { h = Math.round(h * maxSize / w); w = maxSize; }
                else { w = Math.round(w * maxSize / h); h = maxSize; }
            }
            const canvas = document.createElement("canvas");
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext("2d")!;
            ctx.drawImage(img, 0, 0, w, h);
            canvas.toBlob(blob => {
                URL.revokeObjectURL(objectUrl);
                if (!blob) return;
                saveChatImageToIndexedDB(blob).then(assetId => {
                    kvSet(COVER_ASSET_KEY, assetId);
                    getChatImageFromIndexedDB(assetId).then(url => {
                        if (url) setCoverUrl(url);
                    });
                });
            }, "image/jpeg", 0.8);
        };
        img.src = objectUrl;
        // Reset so same file can be re-selected
        e.target.value = "";
    };

    return (
        <>
        {photoFailureNotice && (
            <GeneratedImageErrorDialog
                message={photoFailureNotice}
                onClose={() => setPhotoFailureNotice(null)}
            />
        )}
        <PageShell
            title="动态"
            onBack={onCloseApp}
            rightAction={<div className="moments-header-actions">
                <button type="button" className="moments-header-edit" onClick={() => { setDraftName(screenName); setDraftSignature(signature); setEditProfile(true); }} aria-label="编辑朋友圈资料">编辑</button>
                <button type="button" className="moments-header-compose" onClick={openMyLife} aria-label="My Life，发朋友圈" title="My Life，发朋友圈"><Camera size={18} strokeWidth={1.8}/></button>
            </div>}
            className={`moments-feed-page ${headerScrolled ? "is-scrolled" : ""} ${activeComposer ? "has-comment-modal" : ""}`}
            bodyRef={scrollRef}
            footer={showCompose ? (
                <MomentsCompose
                    onClose={() => setShowCompose(false)}
                    onPublished={handlePublished}
                />
            ) : activeComposer ? (
                <div className="feed-comment-modal-layer" data-ui="modal">
                    <button
                        type="button"
                        className="feed-comment-modal-backdrop"
                        aria-label="关闭评论输入"
                        onClick={closeComposer}
                    />
                    <div
                        className="feed-comment-modal-dialog"
                        data-ui="modal-dialog"
                        role="dialog"
                        aria-modal="true"
                        aria-label={activeComposer.replyTo ? `回复 ${activeComposer.replyTo.name}` : "发表评论"}
                    >
                        <div className="feed-comment-modal-title">
                            {activeComposer.replyTo ? `回复 ${activeComposer.replyTo.name}` : "发表评论"}
                        </div>
                        <textarea
                            ref={composerInputRef}
                            value={composerText}
                            onChange={e => setComposerText(e.target.value)}
                            onKeyDown={e => {
                                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                                    e.preventDefault();
                                    submitComposer();
                                } else if (e.key === "Escape") {
                                    closeComposer();
                                }
                            }}
                            placeholder={activeComposer.replyTo ? `回复 ${activeComposer.replyTo.name}` : "说点什么吧"}
                            className="feed-comment-modal-input"
                        />
                        <div className="feed-comment-modal-actions">
                            <button
                                type="button"
                                className="feed-comment-modal-cancel"
                                onClick={closeComposer}
                            >
                                取消
                            </button>
                            <button
                                type="button"
                                className="feed-comment-modal-send"
                                disabled={!composerText.trim()}
                                onClick={submitComposer}
                            >
                                发送
                            </button>
                        </div>
                    </div>
                </div>
            ) : undefined}
        >
                <section className="moments-profile-hero">
                    <button type="button" className="moments-hero-cover" onClick={() => coverInputRef.current?.click()} aria-label="更换朋友圈背景">
                        {coverUrl ? <img src={coverUrl} alt="朋友圈背景" /> : <span>点击设置背景</span>}
                    </button>
                    <input ref={coverInputRef} type="file" accept="image/*" onChange={handleCoverUpload} className="hidden" />
                    <div className="moments-profile-info">
                        <div className="moments-profile-heading">
                            <div className="moments-squircle-avatar">
                                {userIdentity?.avatarUrl ? <img src={userIdentity.avatarUrl} alt="我的头像" /> : <span>{(screenName || "我")[0]}</span>}
                            </div>
                            <div className="moments-profile-identity"><strong>{screenName}</strong><span>{signature}</span></div>
                        </div>
                        <div className="moments-music-strip">
                            <button type="button" className="moments-music-play" disabled={!selectedTrack || !music} onClick={() => { if (!selectedTrack || !music) return; music.currentTrack?.id === selectedTrack.id ? music.togglePlay() : music.playTrack(selectedTrack); }} aria-label="播放或暂停主页音乐">
                                {selectedTrack?.coverUrl ? <img src={selectedTrack.coverUrl} alt="" /> : <Music2 size={19}/>}
                                {music?.currentTrack?.id === selectedTrack?.id && music?.isPlaying ? <Pause className="moments-music-indicator" size={12}/> : <Play className="moments-music-indicator" size={12}/>}
                            </button>
                            <button type="button" className="moments-music-select" onClick={() => { loadAllTracks().then(setMusicTracks); setMusicPicker(true); }}><strong>{selectedTrack?.title || "选择一首主页音乐"}</strong><small>{selectedTrack?.artist || "从音乐收藏或播放列表选歌"}</small><ChevronRight size={16}/></button>
                        </div>
                        <div className="moments-profile-actions">
                            <button type="button" onClick={openMyLife} aria-label="My Life，发朋友圈"><SquarePen size={17} strokeWidth={1.8}/><span>My Life</span></button>
                            <button type="button" onClick={() => setShowGallery(true)} aria-label="Photo Album，查看相册"><Images size={17} strokeWidth={1.8}/><span>Photo Album</span></button>
                        </div>
                    </div>
                </section>
                <section className="moments-featured-section" aria-label="主页照片">
                    <div className="moments-featured-scroll">
                        {featured.map(photo => <div className="moments-featured-tile" key={photo.url}>
                            <button type="button" className="moments-featured-image" onClick={() => { setShowGallery(true); const index = galleryPhotos.findIndex(p => p.url === photo.url); if (index >= 0) setLightboxIndex(index); }}><MomentsPhotoImage url={photo.url} /></button>
                        </div>)}
                        {featured.length < 3 && <button type="button" className="moments-featured-add" disabled={uploadingPhoto} onClick={() => manualInputRef.current?.click()}><Camera size={23}/><span>{uploadingPhoto ? "上传中…" : "添加照片"}</span></button>}
                    </div>
                    <input ref={manualInputRef} type="file" accept="image/*" className="hidden" onChange={uploadStandalonePhoto}/>
                </section>

                {/* Unread notifications banner */}
                {unreadNotifs.length > 0 && (
                    <button
                        className="feed-notif-banner"
                        onClick={() => setShowNotifModal(true)}
                    >
                        {unreadNotifs.length}条新评论/回复/点赞
                    </button>
                )}

                {/* Posts list */}
                {posts.length === 0 ? (
                    <div className="feed-empty-state py-10 text-center text-[var(--c-icon)] ts-14">
                        还没有动态，发一条吧
                    </div>
                ) : (
                    visiblePosts.map(post => (
                        <MomentPostCard
                            key={post.id}
                            post={post}
                            onUpdate={refreshPosts}
                            onRequestDelete={setConfirmDeleteId}
                            onOpenCommentComposer={openCommentComposer}
                            onOpenReplyComposer={openReplyComposer}
                            onFeaturePhoto={(postId, url) => addFeaturedPhoto({ postId, url, addedAt: new Date().toISOString() })}
                        />
                    ))
                )}
                {hasMorePosts && (
                    <div className="feed-load-more-row flex justify-center px-4 pt-3 pb-8">
                        <button
                            type="button"
                            className="chat-sys-msg chat-load-more-button"
                            onClick={handleLoadMorePosts}
                        >
                            <span>查看更多动态</span>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="18 15 12 9 6 15" />
                            </svg>
                        </button>
                    </div>
                )}


            {editProfile && <div className="moments-dialog-backdrop" role="presentation" onClick={() => setEditProfile(false)}><div className="moments-dialog" role="dialog" aria-modal="true" aria-label="编辑朋友圈资料" onClick={e => e.stopPropagation()}><h3>编辑朋友圈资料</h3><label>网名<input maxLength={24} value={draftName} onChange={e => setDraftName(e.target.value)} /></label><label>签名<input maxLength={80} value={draftSignature} onChange={e => setDraftSignature(e.target.value)} /></label><div className="moments-dialog-actions"><button type="button" onClick={() => setEditProfile(false)}>取消</button><button type="button" className="moments-save-btn" onClick={() => { saveMomentsProfile(draftName, draftSignature); setEditProfile(false); }}>保存</button></div></div></div>}
            {musicPicker && <div className="moments-dialog-backdrop" role="presentation" onClick={() => setMusicPicker(false)}><div className="moments-dialog" role="dialog" aria-modal="true" aria-label="选择主页音乐" onClick={e => e.stopPropagation()}><h3>主页音乐</h3><div className="moments-song-list">{Array.from(new Map<string, MusicTrack>([...musicTracks, ...(music?.queue || []), ...(music?.currentTrack ? [music.currentTrack] : [])].map(t => [t.id, t] as const)).values()).map(track => <button type="button" key={track.id} onClick={() => { setMomentsMusicId(track.id); setMusicPicker(false); }}><Music2 size={18}/><span>{track.title}<small>{track.artist}</small></span>{track.id === musicId ? "✓" : ""}</button>)}{musicTracks.length === 0 && !music?.queue.length && !music?.currentTrack && <p>先到音乐 App 添加歌曲，再回来选。</p>}</div><div className="moments-dialog-actions"><button onClick={() => { setMomentsMusicId(""); setMusicPicker(false); }}>移除音乐</button><button onClick={() => setMusicPicker(false)}>完成</button></div></div></div>}
            {showGallery && <div className="moments-gallery" role="dialog" aria-modal="true" aria-label="我的照片"><div className="moments-gallery-header"><button type="button" onClick={() => { setShowGallery(false); setLightboxIndex(null); }}>‹ 返回</button><strong>我的照片</strong><div className="moments-gallery-header-actions"><span>{galleryPhotos.length} 张</span><button type="button" disabled={uploadingPhoto} onClick={() => manualInputRef.current?.click()} aria-label="上传照片到相册"><Camera size={18}/></button></div></div><div className="moments-gallery-grid">{galleryPhotos.map((photo, index) => <button type="button" key={photo.url} onClick={() => setLightboxIndex(index)}><MomentsPhotoImage url={photo.url} alt={`照片 ${index + 1}`}/></button>)}</div>{galleryPhotos.length === 0 && <p className="moments-gallery-empty">发动态或上传照片后，会出现在这里。</p>}</div>}
            {showGallery && lightboxIndex !== null && lightboxPhoto && <div className="moments-lightbox" role="dialog" aria-modal="true" onTouchStart={e => { touchX.current = e.touches[0].clientX; }} onTouchEnd={e => { if (touchX.current === null) return; const diff = e.changedTouches[0].clientX - touchX.current; if (Math.abs(diff) > 40) setLightboxIndex(i => i === null ? null : Math.max(0, Math.min(galleryPhotos.length - 1, i + (diff < 0 ? 1 : -1)))); touchX.current = null; }}><button type="button" className="moments-lightbox-close" onClick={() => setLightboxIndex(null)}>关闭</button><button type="button" className="moments-lightbox-prev" disabled={lightboxIndex === 0} onClick={() => setLightboxIndex(lightboxIndex - 1)}>‹</button>{lightboxSrc && <img src={lightboxSrc} alt="照片原图"/>}<button type="button" className="moments-lightbox-next" disabled={lightboxIndex === galleryPhotos.length - 1} onClick={() => setLightboxIndex(lightboxIndex + 1)}>›</button><div className="moments-lightbox-bottom"><span>{lightboxIndex + 1} / {galleryPhotos.length}</span><button type="button" onClick={() => featured.some(p => p.url === lightboxPhoto.url) ? removeFeaturedPhoto(lightboxPhoto.url) : addFeaturedPhoto({ ...lightboxPhoto, addedAt: new Date().toISOString() })}>{featured.some(p => p.url === lightboxPhoto.url) ? "从主页移除" : "展示到主页"}</button>{lightboxPhoto.postId && posts.some(p => p.id === lightboxPhoto.postId) && <button type="button" onClick={() => jumpToPost(lightboxPhoto.postId!)}>查看原动态与评论</button>}</div></div>}

            {/* Delete confirm dialog */}
            {confirmDeleteId && (
                <ConfirmDialog
                    title="确定删除这条朋友圈吗？"
                    message="删除后无法恢复，评论也会一并删除。"
                    icon={AlertCircle}
                    variant="danger"
                    confirmLabel="删除"
                    cancelLabel="取消"
                    onConfirm={handleDeleteConfirm}
                    onCancel={() => setConfirmDeleteId(null)}
                />
            )}

            {/* Notification detail modal */}
            {showNotifModal && (
                <div className="modal-overlay" onClick={() => { setShowNotifModal(false); saveMomentsLastSeen(); setUnreadNotifs([]); }}>
                    <div className="modal-dialog" onClick={e => e.stopPropagation()} style={{ maxHeight: "60vh", overflow: "auto" }}>
                        <div className="ts-16 font-semibold text-center text-[var(--c-text)] mb-3">新消息</div>
                        {unreadNotifs.length === 0 ? (
                            <div className="ts-14 text-[var(--c-icon)] text-center py-4">暂无新消息</div>
                        ) : (
                            <div className="flex flex-col gap-3">
                                {unreadNotifs.map((n, i) => (
                                    <div key={i} className="flex flex-col gap-1 px-1">
                                        <span className="ts-13 text-[var(--c-text)]">
                                            <span className="font-semibold">{n.authorName}</span>
                                            {n.type === "comment" ? " 评论了你：" : n.type === "reply" ? " 回复了你：" : " 赞了你的朋友圈"}
                                        </span>
                                        {n.content && <span className="ts-13 text-[var(--c-icon)] leading-relaxed">{n.content.slice(0, 100)}{n.content.length > 100 ? "..." : ""}</span>}
                                    </div>
                                ))}
                            </div>
                        )}
                        <button
                            className="ui-btn ui-btn-ghost ui-btn-bordered-ghost w-full mt-3"
                            onClick={() => { setShowNotifModal(false); saveMomentsLastSeen(); setUnreadNotifs([]); }}
                        >知道了</button>
                    </div>
                </div>
            )}

        </PageShell>
        </>
    );
}
