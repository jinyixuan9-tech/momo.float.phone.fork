"use client";

import React, { useState, useEffect, useSyncExternalStore } from "react";
import { Search, MessageCirclePlus, UsersRound, Settings, ListPlus } from "lucide-react";
import { CHAT_MESSAGE_PUSHED_EVENT, loadChatSessions, loadChatContacts, ChatSession, createOrGetSession, createGroupSession, pushChatMessage, getLastVisibleSessionMessage, getChatMessagePreview } from "@/lib/chat-storage";
import { loadCharacters } from "@/lib/character-storage";
import { Character } from "@/lib/character-types";
import { resolveUserIdentity } from "@/lib/settings-storage";
import { PageShell } from "@/components/ui/page-shell";
import { GroupCreateModal } from "./group-create-modal";
import { Toggle } from "@/components/ui/form";
import { formatChatUiTime } from "@/lib/chat-time";
import { getChatOfflineTurnPreview, getLastChatOfflineTurn } from "@/lib/chat-offline-storage";
import {
    dismissMergeSignatures,
    findPromptableDuplicateSessionGroups,
    mergeDuplicateSessionGroup,
    type DuplicateSessionGroup,
} from "@/lib/chat-session-merge";
import { ChatFallbackAvatar } from "./chat-fallback-avatar";
import {
    CHAT_CHARACTER_PROFILES_UPDATED_EVENT,
    resolveChatCharacterAvatar,
    resolveChatCharacterDisplayName,
} from "@/lib/chat-profile-storage";
import {
    getMascotLastPreview,
    getMascotChatSnapshot,
    hydrateMascotChat,
    subscribeMascotChat,
} from "@/lib/mascot-chat-store";
import {
    DEFAULT_MASCOT_AVATAR,
    getMascotSettingsSnapshot,
    resolveMascotImageRef,
    subscribeMascotSettings,
} from "@/lib/mascot-settings";

function parseTime(value?: string | null): number {
    if (!value) return 0;
    const time = new Date(value).getTime();
    return Number.isNaN(time) ? 0 : time;
}

/** 取两个时间里更晚的那个（空值视为最早） */
function pickLaterTime(a?: string | null, b?: string | null): string {
    if (!a) return b || "";
    if (!b) return a;
    return parseTime(a) >= parseTime(b) ? a : b;
}

/**
 * 会话在列表里是否有内容：线上可见消息、线下模式记录都算。
 * 只在线下聊过的会话（或线上记录被清空的会话）不该从列表里消失。
 */
function hasSessionListContent(sessionId: string): boolean {
    return Boolean(getLastVisibleSessionMessage(sessionId)) || Boolean(getLastChatOfflineTurn(sessionId));
}

/** 列表排序用的活跃时间：线上最后一条与线下最后一条里更晚的那个 */
function getSessionListTime(session: ChatSession): string {
    const onlineTime = getLastVisibleSessionMessage(session.id)?.createdAt;
    const offlineTime = getLastChatOfflineTurn(session.id)?.createdAt;
    return pickLaterTime(onlineTime, offlineTime) || session.updatedAt;
}

/** Fallback: find last non-empty, non-system message preview when session preview is empty */
function getLastNonEmptyPreview(sessionId: string): string {
    try {
        const lastVisible = getLastVisibleSessionMessage(sessionId);
        if (lastVisible) {
            const preview = getChatMessagePreview(lastVisible) || lastVisible.content;
            if (preview.trim()) return preview;
        }
        const offlinePreview = getChatOfflineTurnPreview(getLastChatOfflineTurn(sessionId));
        if (offlinePreview.trim()) return offlinePreview;
    } catch { /* ignore */ }
    return "暂无消息...";
}

type ChatMessageListProps = {
    onCloseApp: () => void;
    activeSession: ChatSession | null;
    onSelectSession: (session: ChatSession | null) => void;
    onSelectMascot: () => void;
};

export function ChatMessageList({ onCloseApp, activeSession, onSelectSession, onSelectMascot }: ChatMessageListProps) {
    const [sessions, setSessions] = useState<ChatSession[]>([]);
    const [listFilter, setListFilter] = useState("");
    const [showChatSearch, setShowChatSearch] = useState(false);
    const chatSearchRef = React.useRef<HTMLInputElement>(null);
    const [listTab, setListTab] = useState<"all" | "private" | "group">("all");
    const [showContactPicker, setShowContactPicker] = useState(false);
    const [showGroupCreate, setShowGroupCreate] = useState(false);
    // 重复会话合并弹窗：进列表时检测一次，用户按组勾选
    const [mergePrompt, setMergePrompt] = useState<DuplicateSessionGroup[] | null>(null);
    const [mergeSelected, setMergeSelected] = useState<Set<string>>(new Set());
    const mascotSettings = useSyncExternalStore(subscribeMascotSettings, getMascotSettingsSnapshot, getMascotSettingsSnapshot);
    const mascotChat = useSyncExternalStore(subscribeMascotChat, getMascotChatSnapshot, getMascotChatSnapshot);
    const [mascotAvatarUrl, setMascotAvatarUrl] = useState(mascotSettings.avatarImage || DEFAULT_MASCOT_AVATAR);

    useEffect(() => {
        if (showChatSearch) chatSearchRef.current?.focus();
    }, [showChatSearch]);

    useEffect(() => {
        void hydrateMascotChat();
    }, []);

    useEffect(() => {
        let cancelled = false;
        resolveMascotImageRef(mascotSettings.avatarImage).then((url) => {
            if (!cancelled) setMascotAvatarUrl(url);
        });
        return () => { cancelled = true; };
    }, [mascotSettings.avatarImage]);

    useEffect(() => {
        if (!activeSession) {
            setSessions(loadChatSessions());
        }
    }, [activeSession]);

    useEffect(() => {
        const refreshSessions = () => setSessions([...loadChatSessions()]);
        window.addEventListener("weixin-messages-updated", refreshSessions);
        window.addEventListener("chat-messages-updated", refreshSessions);
        window.addEventListener(CHAT_MESSAGE_PUSHED_EVENT, refreshSessions);
        window.addEventListener("characters-updated", refreshSessions);
        window.addEventListener(CHAT_CHARACTER_PROFILES_UPDATED_EVENT, refreshSessions);
        return () => {
            window.removeEventListener("weixin-messages-updated", refreshSessions);
            window.removeEventListener("chat-messages-updated", refreshSessions);
            window.removeEventListener(CHAT_MESSAGE_PUSHED_EVENT, refreshSessions);
            window.removeEventListener("characters-updated", refreshSessions);
            window.removeEventListener(CHAT_CHARACTER_PROFILES_UPDATED_EVENT, refreshSessions);
        };
    }, []);

    // 进列表时检测重复会话（同一角色的单聊 / 同一批成员的群聊），默认全选
    useEffect(() => {
        const groups = findPromptableDuplicateSessionGroups();
        if (groups.length === 0) return;
        setMergePrompt(groups);
        setMergeSelected(new Set(groups.map(g => g.signature)));
    }, []);

    const handleMergeConfirm = () => {
        if (!mergePrompt) return;
        for (const group of mergePrompt) {
            if (mergeSelected.has(group.signature)) mergeDuplicateSessionGroup(group);
        }
        // 没勾的按签名记账：这批会话不再提醒，新出现的重复照常提示
        dismissMergeSignatures(mergePrompt.filter(g => !mergeSelected.has(g.signature)).map(g => g.signature));
        setMergePrompt(null);
        setSessions(loadChatSessions());
    };

    const handleMergeDismiss = () => {
        if (!mergePrompt) return;
        dismissMergeSignatures(mergePrompt.map(g => g.signature));
        setMergePrompt(null);
    };

    return (
        <div className="relative flex-1 h-full">
            <PageShell
                className="kkt-list-page kkt-chats-page"
                leftAction={<button type="button" className="kkt-list-title kkt-title-exit" onClick={onCloseApp} aria-label="退出 Chat">Chats</button>}
                rightAction={
                    <div className="kkt-header-actions">
                        <button type="button" onClick={() => { if (showChatSearch) setListFilter(""); setShowChatSearch(open => !open); }} aria-label="搜索聊天"><Search size={22} strokeWidth={1.9}/></button>
                        <button type="button" onClick={() => setShowContactPicker(true)} aria-label="发起聊天"><MessageCirclePlus size={22} strokeWidth={1.8}/></button>
                        <button type="button" onClick={() => setShowGroupCreate(true)} aria-label="创建群聊"><UsersRound size={22} strokeWidth={1.8}/></button>
                        <span className="kkt-header-decor" aria-hidden="true"><Settings size={21} strokeWidth={1.8}/></span>
                    </div>
                }
            >
                {showChatSearch && <div className="chat-search-bar kkt-search-bar">
                    <Search size={18} strokeWidth={2} aria-hidden="true"/>
                    <input
                        ref={chatSearchRef}
                        className="chat-search-input ts-15 w-full bg-transparent outline-none text-[var(--c-text-title)] placeholder:text-[var(--c-icon)]"
                        placeholder="Search chats..."
                        value={listFilter}
                        onChange={(e) => setListFilter(e.target.value)}
                    />
                </div>}
                <div className="chat-list-tabs kkt-chat-filters">
                    {(["all", "private", "group"] as const).map(tab => (
                        <button
                            key={tab}
                            type="button"
                            className={`chat-list-tab${listTab === tab ? " active" : ""}`}
                            onClick={() => setListTab(tab)}
                        >
                            {{ all: "All", private: "Private", group: "Group" }[tab]}
                        </button>
                    ))}
                    <span className="kkt-group-decor" aria-hidden="true"><ListPlus size={18} strokeWidth={1.8}/></span>
                </div>
                <div className="kkt-session-list">
                    {(() => {
                            const contactIds = new Set(loadChatContacts().map(c => c.characterId));
                            const allChars = loadCharacters();
                            const keyword = listFilter.trim().toLowerCase();
                            const showMascot = mascotSettings.chatEnabled
                                && listTab !== "group"
                                && (!keyword || (mascotSettings.nickname || "AI助手").toLowerCase().includes(keyword));
                            const regularItems = [...sessions]
                            .filter(s => {
                                if (!(s.isGroup || contactIds.has(s.contactId))) return false;
                                if (!hasSessionListContent(s.id)) return false;
                                if (listTab === "private" && s.isGroup) return false;
                                if (listTab === "group" && !s.isGroup) return false;
                                if (!keyword) return true;
                                if (s.isGroup) return (s.groupName || "群聊").toLowerCase().includes(keyword);
                                const matchedCharacter = allChars.find(c => c.id === s.contactId);
                                const name = s.alias || (matchedCharacter ? resolveChatCharacterDisplayName(matchedCharacter) : "");
                                return name.toLowerCase().includes(keyword);
                            })
                            .sort((a, b) => {
                                if (a.isPinned && !b.isPinned) return -1;
                                if (!a.isPinned && b.isPinned) return 1;
                                const aTime = getSessionListTime(a);
                                const bTime = getSessionListTime(b);
                                return parseTime(bTime) - parseTime(aTime);
                            })
                            .map(s => (
                                <div key={s.id}>
                                    <SessionItem session={s} onSelect={() => onSelectSession(s)} isPinned={!!s.isPinned} />
                                </div>
                            ));
                            if (!showMascot && regularItems.length === 0) {
                                return (
                                    <div className="px-5 py-10 text-center text-[var(--c-icon)] ts-14">
                                        暂无聊天记录，点击右上角的发起聊天图标
                                    </div>
                                );
                            }
                            return (
                                <>
                                    {showMascot && (
                                        <MascotSessionItem
                                            name={mascotSettings.nickname || "AI助手"}
                                            avatarUrl={mascotAvatarUrl}
                                            preview={getMascotLastPreview()}
                                            isThinking={mascotChat.isThinking}
                                            onSelect={onSelectMascot}
                                        />
                                    )}
                                    {regularItems}
                                </>
                            );
                        })()}
                </div>
            </PageShell>

            {/* Contact Picker */}
            {showContactPicker && (
                <ContactPicker
                    onClose={() => setShowContactPicker(false)}
                    onSelect={(charId) => {
                        const session = createOrGetSession(charId);
                        setSessions(loadChatSessions());
                        onSelectSession(session);
                        setShowContactPicker(false);
                    }}
                />
            )}

            {/* Merge Duplicate Sessions Modal */}
            {mergePrompt && (
                <div className="modal-overlay" onClick={() => setMergePrompt(null)}>
                    <div className="modal-dialog" onClick={e => e.stopPropagation()}>
                        <span className="modal-header-title">检测到相同角色的重复会话</span>
                        <p className="ts-13 text-[var(--c-text)] opacity-80 mb-3">
                            勾选要合并的组：聊天记录（含线下）将并入最近活跃的会话，其余重复会话被删除；不勾选的组之后不再提醒。
                        </p>
                        <div className="flex flex-col gap-2 w-full max-h-[40vh] overflow-y-auto mb-3">
                            {mergePrompt.map(group => (
                                <div key={group.signature} className="flex items-center gap-3 p-2 rounded-lg bg-[var(--c-input)]">
                                    <div className="flex-1 overflow-hidden">
                                        <div className="ts-14 font-medium text-[var(--c-text-title)] truncate">
                                            {group.isGroup ? "群聊 " : "单聊 "}{group.label}
                                        </div>
                                        <div className="ts-12 text-[var(--c-icon)] truncate">
                                            {group.sessions.length} 个会话
                                            {group.isGroup ? ` · 成员：${group.memberNames.join("、")}` : ""}
                                        </div>
                                    </div>
                                    <Toggle
                                        checked={mergeSelected.has(group.signature)}
                                        onChange={(next) => {
                                            setMergeSelected(prev => {
                                                const nextSet = new Set(prev);
                                                if (next) nextSet.add(group.signature);
                                                else nextSet.delete(group.signature);
                                                return nextSet;
                                            });
                                        }}
                                    />
                                </div>
                            ))}
                        </div>
                        <div className="flex gap-2 w-full">
                            <button className="ui-btn ui-btn-ghost flex-1" onClick={handleMergeDismiss}>
                                暂不合并
                            </button>
                            <button
                                className="ui-btn ui-btn-primary flex-1"
                                disabled={mergeSelected.size === 0}
                                onClick={handleMergeConfirm}
                            >
                                合并所选
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Group Create Modal */}
            {showGroupCreate && (
                <GroupCreateModal
                    onClose={() => setShowGroupCreate(false)}
                    onCreate={(groupName, participantIds, isSpectator) => {
                        const newSession = createGroupSession(groupName, participantIds, { isSpectator });
                        const userName = resolveUserIdentity()?.name ?? "用户";
                        const allChars = loadCharacters();
                        const memberNames = participantIds
                            .map(id => allChars.find(c => c.id === id)?.name ?? "未知")
                            .join("、");
                        pushChatMessage({
                            sessionId: newSession.id,
                            role: "system",
                            // 围观群：用户不在群里，开群消息不能提到用户
                            content: isSpectator
                                ? `${memberNames}加入了群聊`
                                : `${userName}邀请${memberNames}加入群聊`,
                            status: "sent",
                        });
                        setSessions(loadChatSessions());
                        onSelectSession(newSession);
                        setShowGroupCreate(false);
                    }}
                />
            )}

        </div>
    );
}

function MascotSessionItem({
    name,
    avatarUrl,
    preview,
    isThinking,
    onSelect,
}: {
    name: string;
    avatarUrl: string;
    preview: string;
    isThinking: boolean;
    onSelect: () => void;
}) {
    return (
        <div className="minimal-list-item" onClick={onSelect}>
            <div className="minimal-avatar-wrapper bg-white">
                <img src={avatarUrl} className="w-full h-full object-contain pointer-events-none rounded-full p-[2px]" alt="" />
                <span className="minimal-online-dot" />
            </div>
            <div className="flex-1 overflow-hidden h-[48px] flex flex-col justify-center gap-1">
                <div className="flex justify-between items-center">
                    <span className="ts-16 font-medium text-[var(--c-text-title)] truncate">{name}</span>
                    <span className="ts-12 text-[var(--c-icon)] font-medium">AI</span>
                </div>
                <div className="flex justify-between items-center gap-2">
                    <span className="ts-13 text-[var(--c-text)] opacity-80 truncate font-normal">
                        {isThinking ? "正在思考..." : preview}
                    </span>
                </div>
            </div>
        </div>
    );
}

function ContactPicker({ onClose, onSelect }: { onClose: () => void; onSelect: (charId: string) => void }) {
    const contacts = loadChatContacts();
    const chars = loadCharacters();

    const enrichedContacts = contacts
        .map(c => ({ ...c, char: chars.find(ch => ch.id === c.characterId) }))
        .filter(c => c.char) as (typeof contacts[number] & { char: Character })[];

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-dialog" onClick={e => e.stopPropagation()}>
                <span className="modal-header-title">选择联系人</span>
                {enrichedContacts.length === 0 ? (
                    <span className="menu-desc">暂无联系人，请先添加好友</span>
                ) : (
                    <div className="chat-contact-list">
                        {enrichedContacts.map(c => (
                            <div
                                key={c.characterId}
                                className="chat-contact-item"
                                onClick={() => onSelect(c.characterId)}
                            >
                                <div className="chat-contact-avatar">
                                    {c.char.avatar ? (
                                        <img src={c.char.avatar} alt="" />
                                    ) : (
                                        <ChatFallbackAvatar />
                                    )}
                                </div>
                                <span className="chat-contact-name">{c.char.name}</span>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

function SessionItem({ session, onSelect, isPinned }: { session: ChatSession, onSelect: () => void, isPinned?: boolean }) {
    const chars = loadCharacters();
    const character = chars.find(c => c.id === session.contactId);
    const chatDisplayName = character ? resolveChatCharacterDisplayName(character) : `User_${session.contactId.slice(-4)}`;
    const chatAvatar = character ? resolveChatCharacterAvatar(character) : null;
    const lastVisibleMessage = getLastVisibleSessionMessage(session.id);
    const lastOfflineTurn = getLastChatOfflineTurn(session.id);
    // 线下记录比线上消息新时（含只在线下聊过的会话），列表展示线下摘要
    const offlineIsNewer = Boolean(lastOfflineTurn)
        && parseTime(lastOfflineTurn?.createdAt) > parseTime(lastVisibleMessage?.createdAt);
    const onlinePreview = lastVisibleMessage ? (getChatMessagePreview(lastVisibleMessage) || lastVisibleMessage.content) : "";
    const preview = offlineIsNewer ? getChatOfflineTurnPreview(lastOfflineTurn) : onlinePreview;
    const displayTime = pickLaterTime(lastVisibleMessage?.createdAt, lastOfflineTurn?.createdAt) || session.updatedAt;

    // Group chat: build grid of participant avatars (2×2)
    const isGroup = session.isGroup;
    const userIdentity = isGroup ? resolveUserIdentity(undefined, "group_chat") : null;
    const groupAvatarItems = isGroup
        ? [
            ...(userIdentity ? [{ id: "self", name: userIdentity.name || "我", avatar: userIdentity.avatarUrl || "" }] : []),
            ...((session.participantIds || [])
                .map(id => chars.find(c => c.id === id))
                .filter(Boolean) as Character[])
                .map(c => ({ id: c.id, name: c.name, avatar: c.avatar || "" })),
        ].slice(0, 4)
        : [];

    return (
        <div
            className={`minimal-list-item${isPinned ? ' chat-pinned' : ''}`}
            onClick={onSelect}
        >
            {isGroup ? (
                <div className="minimal-avatar-wrapper grid grid-cols-2 grid-rows-2 gap-[1px] p-[2px] bg-[var(--c-card-border)] rounded-full overflow-hidden">
                    {groupAvatarItems.map((c) => (
                        <div key={c.id} className="overflow-hidden rounded-[3px] bg-[var(--c-page-body-bg)]">
                            {c.avatar ? (
                                <img src={c.avatar} className="w-full h-full object-cover pointer-events-none" alt="" />
                            ) : (
                                <ChatFallbackAvatar className="pointer-events-none" />
                            )}
                        </div>
                    ))}
                    {Array.from({ length: Math.max(0, 4 - groupAvatarItems.length) }).map((_, i) => (
                        <div key={`empty-${i}`} className="overflow-hidden rounded-[3px] bg-[var(--c-page-body-bg)]" />
                    ))}
                </div>
            ) : (
                <div className="minimal-avatar-wrapper">
                    {chatAvatar ? (
                        <img src={chatAvatar} className="w-full h-full object-cover pointer-events-none rounded-full" alt="" />
                    ) : (
                        <ChatFallbackAvatar className="pointer-events-none rounded-full" />
                    )}
                    <span className="minimal-online-dot" />
                </div>
            )}
            <div className="flex-1 overflow-hidden h-[48px] flex flex-col justify-center gap-1">
                <div className="flex justify-between items-center">
                    <span className="ts-16 font-medium text-[var(--c-text-title)] truncate">
                        {isGroup ? (session.groupName || "群聊") : (session.alias || chatDisplayName || `User_${session.contactId.slice(-4)}`)}
                    </span>
                    <span className="ts-12 text-[var(--c-icon)] font-medium">
                        {formatChatUiTime(displayTime)}
                    </span>
                </div>
                <div className="flex justify-between items-center gap-2">
                    <span className="ts-13 text-[var(--c-text)] opacity-80 truncate font-normal">
                        {preview || getLastNonEmptyPreview(session.id)}
                    </span>
                    {session.unreadCount > 0 && (
                        <span
                            className="min-w-[18px] h-[18px] px-1 rounded-full bg-[#ff3b30] text-white text-[10px] leading-[18px] text-center font-semibold shrink-0"
                            aria-label={`${session.unreadCount} 条未读消息`}
                        >
                            {session.unreadCount > 99 ? "99+" : session.unreadCount}
                        </span>
                    )}
                </div>
            </div>
        </div>
    );
}
