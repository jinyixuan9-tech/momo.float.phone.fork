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

function recentPrivateExchange(characterId: string) {
  const contacts = loadChatContacts().filter(c => c.characterId === characterId);
  const sessions = loadChatSessions().filter(s => !s.isGroup && contacts.some(c => c.id === s.contactId));
  return sessions.flatMap(s => loadChatMessages(s.id, 15).filter(m => m.role === "user" || m.role === "assistant"))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(-20);
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
  const exchange = recentPrivateExchange(characterId);
  const mentioned = recent.slice(-18).some(m => reveal.test(m.content) && aboutBubble.test(m.content));
  if (mentioned && !room.identityDisclosed) {
    state.rooms[characterId] = { ...room, identityDisclosed: true, identitySuspicion: Math.max(48, room.identitySuspicion || 0) };
    saveLysn(state);
  }
  const explicitMatch = recent.slice(-5).some(m => /(?:我就是|是我发的|那条是我|我发的那条).{0,40}(?:泡泡|bubble|lysn|留言)|(?:泡泡|bubble|lysn).{0,30}(?:那条|那个|留言).{0,16}(?:是我|我发的)/i.test(m.content));
  const answer = exchange.at(-1);
  const guess = exchange.at(-2);
  const confirmedGuess = answer?.role === "user" && /^(?:对|是|没错|猜对了|你猜对了)[啊呀哦呐！!。,.\s]*$/i.test(answer.content.trim())
    && guess?.role === "assistant" && /(?:泡泡|bubble|lysn)/i.test(guess.content) && /(?:是不是你|是你|你发的|是你说的|就是你)/i.test(guess.content);
  if ((explicitMatch || confirmedGuess) && !state.rooms[characterId]?.identityMatchedAt) {
    const latest = loadLysn();
    latest.rooms[characterId] = { ...latest.rooms[characterId], identityDisclosed: true, identityMatchedAt: Date.now(), identitySuspicion: Math.max(70, latest.rooms[characterId]?.identitySuspicion || 0) };
    saveLysn(latest);
    state.rooms[characterId] = latest.rooms[characterId];
  }
  const current = state.rooms[characterId] || room;
  const suspicion = current.identitySuspicion || 0;
  const history = state.messages.filter(m => m.characterId === characterId && !m.celebration);
  const publicMessages = history.filter(m => m.sender === "artist" && !m.opener && m.kind === "text").slice(-3);
  const observedFan = history.filter(m => m.sender === "fan" && m.kind === "text" && (m.seenAt || history.some(next => next.sender === "artist" && !next.opener && next.createdAt > m.createdAt))).slice(-2);
  const simulatedFans = history.filter(m => m.sender === "artist" && m.quote?.original).slice(-2).map(m => m.quote!.original);
  if (!current.identityDisclosed && suspicion < 18 && !publicMessages.length && !observedFan.length && !simulatedFans.length) return null;
  const parts = ["【私聊可知的 Bubble 近况】你有一个面向所有订阅者的 Bubble 频道。可以偶尔在 Chat 自然提到自己在公开频道发过的东西、看到的匿名粉丝留言，或者其他普通粉丝的公开留言；不要每次私聊都提。匿名留言没有可靠的发言者身份，不能因为恰好与私聊相似就当作是面前这个人。"];
  if (publicMessages.length) parts.push(`你最近在 Bubble 公开发过：${publicMessages.map(m => m.original.slice(0, 110)).join(" / ")}`);
  if (simulatedFans.length) parts.push(`频道里模拟的其他匿名粉丝留言：${simulatedFans.map(text => text.slice(0, 90)).join(" / ")}`);
  if (observedFan.length) parts.push(`频道里你确实看过的匿名留言（身份未知）：${observedFan.map(m => m.original.slice(0, 90)).join(" / ")}`);
  parts.push("频道还有很多没有逐条记录的普通粉丝；如果想泛泛讲粉丝说了什么，可以自然概括，不要默认你看到的每条留言都是这位私聊对象发的，也不要捏造一条具体的私人发言。");
  if (current.identityMatchedAt) parts.push("你们后来在私聊里确认过一条 Bubble 留言的身份，可以在这间 Chat 继续聊对应的公开话题。仅此一条确认不能推出对方写了所有留言；在 Bubble 公开频道仍绝不透露她的身份或私聊细节。");
  else if (current.identityDisclosed) parts.push("对方曾在私聊中说订阅了你的 Bubble。这只证明对方订阅，不证明哪条粉丝留言来自对方；如果对方邀你猜，可以按性格猜，也可以猜错。若这轮对方刚提起，先自然回应。");
  else if (suspicion >= 18) parts.push("你偶尔觉得某些匿名留言的口气熟悉，但只是怀疑，可以继续观察，未必猜得准。");
  if (suspicion >= 42 && Date.now() - (current.identityHintedInChatAt || 0) > 36 * 3600000 && Math.random() < (current.identityDisclosed ? .32 : .12)) {
    const latest = loadLysn(); latest.rooms[characterId] = { ...latest.rooms[characterId], identityHintedInChatAt: Date.now() }; saveLysn(latest);
    parts.push("这轮若话题自然，你可以在这间私聊随口试探一句，比如最近 Bubble 有个人说话挺像你；也完全可以先不提。不要把猜测写进 Bubble 公开频道。");
  }
  return parts.join("\n");
}

export function lysnPublicBoundary(characterId: string): string {
  const room = loadLysn().rooms[characterId];
  return ["公开频道只谈适合粉丝看到的近况、工作、队友、日常、可以公开的宿舍趣事。未公开的工作可保留悬念，不泄露时间地点等保密细节。私人亲密关系、订阅者身份、私聊内容不能因为某条粉丝留言熟悉就暗示给所有人。", "你可以按人物自身的想法和长期剧情决定是否公开重大私人事情，但必须是角色明确且有后果的决定，不能在普通闲聊中偶然泄露。", room?.identityMatchedAt ? "私聊中曾确认过某条匿名留言的身份，但在公开频道绝不能提这件事，也不要让粉丝看出你和此人有私下联系。" : room?.identityDisclosed ? "你在私聊知道用户订阅了这个频道，但不知道其匿名留言是哪一条；在此公开频道仍不认出、不点名、不夹带私聊暗号。" : "匿名粉丝不等于私聊对象；即使心里怀疑也不在此公开确认。", (room?.identitySuspicion || 0) >= 24 ? "你心里可能觉得最近某位匿名粉丝语气熟悉，这只是内部直觉；不要在公开频道确认身份或使用私聊信息。" : ""].filter(Boolean).join("\n");
}
