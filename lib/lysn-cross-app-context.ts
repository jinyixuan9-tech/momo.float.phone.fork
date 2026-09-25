import { loadChatContacts, loadChatMessages, loadChatSessions } from "./chat-storage";
import { loadWeverseProjectionEntries } from "./weverse-memory";
import { loadWeverseState } from "./weverse-storage";
import { loadLysn } from "./lysn-storage";

const RECENT_MS = 14 * 86400000;
const everyday = /(?:吃|喝|零食|食物|餐厅|奶茶|咖啡|饮料|甜品|电影|综艺|游戏|音乐|歌曲|天气|拍照|照片|旅行|散步|snack|food|coffee|song|movie|맛있|과자|커피)/i;
const privateDetail = /(?:身份证|手机号|电话|住址|地址|酒店房间|房号|密码|银行卡|私密|保密|秘密|恋爱|约会|男朋友|女朋友|前任|亲密|病历|诊断|公司机密|退圈)/i;
const short = (value: string, limit = 135) => value.replace(/<[^>]*>|\[[^\]]*\]/g, " ").replace(/\s+/g, " ").trim().slice(0, limit);

/** Use public Weverse events and harmless everyday Chat subjects as possible inspiration.
 * Private conversation content must never be copied into a fan-facing Bubble post. */
export function lysnPublicContinuityPrompt(characterId: string): string | null {
  const cutoff = Date.now() - RECENT_MS;
  const bubbleState = loadLysn();
  const privateNames = [bubbleState.userProfile.name, bubbleState.rooms[characterId]?.nickname].filter((name): name is string => Boolean(name && name.trim().length > 1));
  const anonymize = (text: string) => privateNames.reduce((value, name) => value.replaceAll(name, "[称呼省略]"), text);
  const publicPosts = loadWeverseProjectionEntries(characterId)
    .filter(item => Date.parse(item.timestamp) >= cutoff && /Weverse.*(?:Post|LIVE|回复)/.test(item.content))
    .slice(-3).map(item => short(item.content, 190));
  const weverse = loadWeverseState();
  const communities = new Set(weverse.communities.filter(item => item.memberCharacterIds.includes(characterId)).map(item => item.id));
  const official = weverse.notices.filter(item => communities.has(item.communityId) && !item.historical && item.createdAt >= cutoff)
    .sort((a, b) => b.createdAt - a.createdAt).slice(0, 2).map(item => `Weverse 官方公开内容：${short(item.title)}；${short(item.originalBody || item.body, 100)}`);
  const officialPosts = weverse.posts.filter(item => item.authorType === "official" && communities.has(item.communityId) && !item.historical && item.createdAt >= cutoff)
    .sort((a, b) => b.createdAt - a.createdAt).slice(0, 2)
    .map(item => `Weverse 官方动态：${short(item.originalBody || item.body, 100)}${item.imageUrl || item.photoDescription ? "，附带公开照片" : ""}`);
  const contacts = loadChatContacts().filter(item => item.characterId === characterId);
  const sessions = loadChatSessions().filter(item => !item.isGroup && contacts.some(contact => contact.id === item.contactId));
  const everydaySubjects = sessions.flatMap(session => loadChatMessages(session.id, 35))
    .filter(message => message.role === "user" && !message.mediaType && !message.isRetracted && Date.parse(message.createdAt) >= cutoff)
    .map(message => anonymize(short(message.content, 110)))
    .filter(text => everyday.test(text) && !privateDetail.test(text) && !/[\n\r@]|\d{5,}/.test(text))
    .slice(-2);
  const teammateSubjects = loadChatSessions().filter(session => session.isGroup && session.participantIds?.includes(characterId))
    .flatMap(session => loadChatMessages(session.id, 30))
    .filter(message => message.role === "assistant" && message.senderCharacterId && message.senderCharacterId !== characterId && !message.mediaType && !message.isRetracted && Date.parse(message.createdAt) >= cutoff)
    .filter(message => everyday.test(message.content) && !privateDetail.test(message.content) && !/[\n\r@]|\d{5,}/.test(message.content))
    .slice(-2).map(message => `${short(message.senderName || "队友", 25)}聊过：${short(message.content, 95)}`);
  if (!publicPosts.length && !official.length && !officialPosts.length && !everydaySubjects.length && !teammateSubjects.length) return null;
  return [
    "【近期跨应用衔接，可忽略】以下是你自己的公开经历，以及私下聊过的普通生活话题。可以凭心情延续公开的 Weverse 内容：例如问粉丝看没看动态，或官方公开照片后选择在 Bubble 另外发自己可公开的照片。也可以先真的尝试某种食物、之后在 Bubble 分享自己的体验。没有做过的事不要说成已经做了；若说发了照片，必须实际输出 photo 消息。",
    ...publicPosts.map(text => `你在 Weverse 的公开经历：${text}`),
    ...official,
    ...officialPosts,
    ...(everydaySubjects.length ? [`私下聊过的日常话题，仅作灵感：${everydaySubjects.join("；")}`] : []),
    ...(teammateSubjects.length ? [`队友在群聊提过的普通生活话题：${teammateSubjects.join("；")}`] : []),
    "Bubble 面向所有粉丝。绝不能引用与用户私聊的原句、称呼私聊推荐者、暗示关系或透露其身份、行踪及只有私聊才知道的细节。若队友谈的是可以公开的零食或普通日常，可以按人设提到队友；保密或私人话题不能提。若想分享零食等，先真正尝试，再以自己的公开口吻讲，不必每次都接到别的应用。",
  ].join("\n");
}
