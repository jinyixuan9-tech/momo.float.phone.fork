import { loadChatSessions, saveChatSessions, type ChatSession } from "./chat-storage";
import type { Character } from "./character-types";
import { resolveChatCharacterAvatar, resolveChatCharacterDisplayName } from "./chat-profile-storage";
import { getSavedMomentsScreenName } from "./moments-profile";
import { getGroupRole, isGroupMemberKey, GROUP_SELF_KEY } from "./group-admin";

export function groupMemberName(session: ChatSession, key: string, character?: Character | null, userName = "我"): string {
    const nickname = session.groupNicknames?.[key]?.trim();
    if (nickname) return nickname;
    if (key === GROUP_SELF_KEY) return getSavedMomentsScreenName() || userName;
    return character ? resolveChatCharacterDisplayName(character) || character.name : userName || "未知成员";
}

export function groupMemberAvatar(character?: Character | null): string | null {
    return character ? resolveChatCharacterAvatar(character) : null;
}

/** Members may rename themselves; owners/admins may rename lower-ranked members. */
export function canSetGroupNickname(session: ChatSession, actor: string, target: string): boolean {
    if (!isGroupMemberKey(session, actor) || !isGroupMemberKey(session, target)) return false;
    if (actor === target) return true;
    const role = getGroupRole(session, actor);
    if (role === "member") return false;
    return role === "owner" || getGroupRole(session, target) === "member";
}

/** Consume a member's explicit self-rename tag before ordinary message parsing. */
export function applyGroupSelfNicknameTag(session: ChatSession, actorId: string, content: string): string {
    if (!canSetGroupNickname(session, actorId, actorId)) return content;
    let updatedName: string | undefined;
    const clean = content.replace(/\[我的群昵称[:：]([^\]\r\n]{1,24})\]/g, (_match, raw: string) => {
        updatedName = raw.trim();
        return "";
    }).trim();
    if (updatedName) {
        const next = { ...session.groupNicknames, [actorId]: updatedName };
        const sessions = loadChatSessions();
        const index = sessions.findIndex(s => s.id === session.id);
        if (index >= 0) { sessions[index] = { ...sessions[index], groupNicknames: next }; saveChatSessions(sessions); }
        session.groupNicknames = next;
    }
    return clean;
}
