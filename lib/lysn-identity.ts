import { loadChatContacts, loadChatMessages, loadChatSessions } from "./chat-storage";
import { loadLysn, saveLysn } from "./lysn-storage";

const reveal = /(?:我|是我|是咱们).{0,18}(?:定|订|订阅|买|开通|看|发).{0,18}(?:你的|你).{0,8}(?:bubble|泡泡|lysn)|(?:bubble|泡泡|lysn).{0,16}(?:有一个|有个|那个).{0,8}(?:是我|就是我)/i;
const aboutBubble = /(?:bubble|泡泡|lysn)/i;
const phrases = (value: string) => value.replace(/[\s\p{P}\p{S}]/gu, "").slice(0, 150);

function privateUserMessages(characterId: string) {
  const contacts = loadChatContacts().filter(c => c.characterId === characterId);
  const sessions = loadChatSessions().filter(s => !s.isGroup && contacts.some(c => c.id === s.contactId));
  return sessions.flatMap(s => loadChatMessages(s.id, 50).filter(m => m.role === "user"))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(-50);
}

/** Local clues are a gameplay heuristic, never proof of who sent a public fan message. */
export function noteLysnFanMessage(characterId: string, fanText: string): void {
  const state = loadLysn(); const room = state.rooms[characterId];
  if (!room) return;
  const recent = privateUserMessages(characterId);
  const text = phrases(fanText);
  const strong = text.length >= 8 && recent.some(m => phrases(m.content) === text);
  const overlap = text.length >= 14 && recent.some(m => { const old = phrases(m.content); return old.length >= 14 && (old.includes(text.slice(0, 14)) || text.includes(old.slice(0, 14))); });
  const nickname = room.nickname?.trim();
  const personal = nickname && nickname.length >= 2 && fanText.includes(nickname);
  // The artist can suspect a familiar fan but a common phrase is never sufficient proof.
  const change = 1 + (strong ? 24 : overlap ? 10 : 0) + (personal ? 5 : 0);
  state.rooms[characterId] = { ...room, identitySuspicion: Math.min(85, (room.identitySuspicion || 0) + change), identityClueCount: (room.identityClueCount || 0) + 1 };
  saveLysn(state);
}

export function lysnPrivateChatPrompt(characterId: string): string | null {
  const state = loadLysn();
  if (!state.subscribedIds.includes(characterId)) return null;
  const room = state.rooms[characterId] || {};
  const recent = privateUserMessages(characterId);
  const mentioned = recent.slice(-18).some(m => reveal.test(m.content) && aboutBubble.test(m.content));
  if (mentioned && !room.identityDisclosed) {
    state.rooms[characterId] = { ...room, identityDisclosed: true, identitySuspicion: Math.max(48, room.identitySuspicion || 0) };
    saveLysn(state);
  }
  const current = state.rooms[characterId] || room;
  const suspicion = current.identitySuspicion || 0;
  if (!current.identityDisclosed && suspicion < 18) return null;
  const parts = ["【私聊可知的 Bubble 线索】你有一个面向所有订阅者的 Bubble 频道。订阅者的留言混在粉丝中，你看不到可验证的发言者身份；不能因为两段话相似就断定是私聊对象，也不能把粉丝内容当作私聊记录。"];
  const recentFan = state.messages.filter(m => m.characterId === characterId && m.sender === "fan" && m.kind === "text").slice(-3);
  if (recentFan.length) parts.push(`频道里最近几条匿名粉丝留言（未确认是谁）：${recentFan.map(m => m.original.slice(0, 90)).join(" / ")}`);
  if (current.identityDisclosed) parts.push("对方曾在私聊中说订阅了你的 Bubble。这只证明对方订阅，不证明哪条粉丝留言来自对方；如果对方邀你猜，可以按性格猜，也可以猜错。若这轮对方刚提起，先自然回应。 ");
  else parts.push("你偶尔觉得某些匿名留言的口气熟悉，但只是怀疑，可以继续观察，未必猜得准。");
  if (suspicion >= 42 && Date.now() - (current.identityHintedInChatAt || 0) > 36 * 3600000 && Math.random() < (current.identityDisclosed ? .32 : .12)) {
    const latest = loadLysn(); latest.rooms[characterId] = { ...latest.rooms[characterId], identityHintedInChatAt: Date.now() }; saveLysn(latest);
    parts.push("这轮若话题自然，你可以在这间私聊随口试探一句，比如最近 Bubble 有个人说话挺像你；也完全可以先不提。不要把猜测写进 Bubble 公开频道。");
  }
  return parts.join("\n");
}

export function lysnPublicBoundary(characterId: string): string {
  const room = loadLysn().rooms[characterId];
  return ["公开频道只谈适合粉丝看到的近况、工作、队友、日常、可以公开的宿舍趣事。未公开的工作可保留悬念，不泄露时间地点等保密细节。私人亲密关系、订阅者身份、私聊内容不能因为某条粉丝留言熟悉就暗示给所有人。", "你可以按人物自身的想法和长期剧情决定是否公开重大私人事情，但必须是角色明确且有后果的决定，不能在普通闲聊中偶然泄露。", room?.identityDisclosed ? "你在私聊知道用户订阅了这个频道，但不知道其匿名留言是哪一条；在此公开频道仍不认出、不点名、不夹带私聊暗号。" : "匿名粉丝不等于私聊对象；即使心里怀疑也不在此公开确认。", (room?.identitySuspicion || 0) >= 24 ? "你心里可能觉得最近某位匿名粉丝语气熟悉，这只是内部直觉；不要在公开频道确认身份或使用私聊信息。" : ""].filter(Boolean).join("\n");
}
