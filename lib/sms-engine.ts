import { loadCharacters } from "./character-storage";
import { loadApiConfigs, loadBindingConfig, loadPresets, loadRegexes, loadWorldBooks, resolveBinding, resolveUserIdentity } from "./settings-storage";
import type { RegexConfig, WorldBookConfig } from "./settings-types";
import { assemblePromptPayload, type LLMMessage } from "./llm-prompt-assembler";
import { sendLLMRequest } from "./chat-engine";
import { prepareShortTermContext } from "./short-term-assembler";
import { loadMemoryConfig } from "./memory-storage";
import { retrieveCoreMemoriesForPrompt, retrieveMemoriesForPrompt } from "./memory-service";
import { formatCoreMemories, formatLongTermMemories } from "./memory-injector";
import { buildCharacterTimeContext } from "./character-time";
import { loadChatSessions, type ChatMessage } from "./chat-storage";
import { getLatestRequestForCharacter } from "./friend-request-storage";
import {
  getCharacterSmsPhone,
  getSmsMessages,
  getSmsSenderPhone,
  getSmsThread,
  loadSmsState,
  type SmsMessage,
  type SmsRecognitionState,
  type SmsThread,
} from "./sms-storage";

export type GeneratedSmsReply = {
  messages: Array<{ original: string; translated: string }>;
  recognition?: SmsRecognitionState;
  recognitionNote?: string;
  blockSender?: boolean;
};

export type GeneratedProactiveSms = GeneratedSmsReply & { send: boolean };

const SHORT_TERM_BUDGET = 3200;
const LONG_TERM_BUDGET = 1400;
const CORE_MEMORY_BUDGET = 900;

function parseJsonObject(raw: string): Record<string, unknown> {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("短信回复格式无效，请重试。");
  return JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
}

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function toHistoryMessage(row: SmsMessage, threadId: string): ChatMessage {
  return {
    id: row.id,
    sessionId: threadId,
    role: row.sender === "character" ? "assistant" : row.sender === "system" ? "system" : "user",
    content: row.original,
    status: row.status === "failed" ? "failed" : row.status === "blocked" ? "rejected" : "sent",
    createdAt: new Date(row.createdAt).toISOString(),
  };
}

function normalizeRecognition(current: SmsRecognitionState, requested: unknown): SmsRecognitionState {
  if (current === "confirmed") return "confirmed";
  if (requested === "confirmed") return "confirmed";
  if (requested === "suspected" || current === "suspected") return "suspected";
  return "unknown";
}

function parseGenerated(raw: string, currentRecognition: SmsRecognitionState): GeneratedSmsReply {
  const data = parseJsonObject(raw);
  const rows = Array.isArray(data.messages) ? data.messages as unknown[] : [];
  const messages = rows.slice(0, 4).map(item => {
    const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const original = asText(row.original);
    return { original, translated: asText(row.translated) || original };
  }).filter(row => row.original);
  return {
    messages,
    recognition: normalizeRecognition(currentRecognition, data.recognition),
    recognitionNote: asText(data.recognitionNote).slice(0, 300) || undefined,
    blockSender: data.blockSender === true,
  };
}

function buildRelationshipState(characterId: string): string {
  const direct = loadChatSessions().find(row => !row.isGroup && row.contactId === characterId);
  const latestRequest = getLatestRequestForCharacter(characterId);
  const parts: string[] = [];
  if (direct?.isBlacklisted) parts.push("Chat 当前状态：用户已经把你在 Chat 私聊中拉黑；你知道 Chat 发出的新消息会被拒收。短信是另一条独立通信线路。不要把“被 Chat 拉黑”误解为短信号码也被拉黑。");
  if (latestRequest) parts.push(`最近一次 Chat 好友申请：第 ${latestRequest.round} 次，状态 ${latestRequest.status}${latestRequest.message ? `，申请附言“${latestRequest.message.slice(0, 160)}”` : ""}。`);
  return parts.join("\n");
}

async function buildBasePrompt(thread: SmsThread, historyRows: SmsMessage[]): Promise<{
  prompt: LLMMessage[];
  api: ReturnType<typeof loadApiConfigs>[number];
  preset: ReturnType<typeof loadPresets>[number] | null;
  regexes: RegexConfig[];
  characterName: string;
  userName: string;
  senderPhone: string;
}> {
  const character = loadCharacters().find(row => row.id === thread.characterId);
  if (!character) throw new Error("角色已不存在。");

  const slot = resolveBinding(loadBindingConfig(), character.id, "sms");
  const apis = loadApiConfigs();
  const api = apis.find(row => row.id === slot.apiConfigId) || apis[0];
  if (!api) throw new Error("请先为信息/SMS 配置可用的文字 API。");
  const presets = loadPresets();
  const preset = presets.find(row => row.id === slot.presetId) || presets.find(row => row.builtIn) || null;
  const allWorldBooks = loadWorldBooks();
  const worldBooks = (slot.worldBookIds || []).map(id => allWorldBooks.find(row => row.id === id)).filter(Boolean) as WorldBookConfig[];
  const allRegexes = loadRegexes();
  const regexes = (slot.regexIds || []).map(id => allRegexes.find(row => row.id === id)).filter(Boolean) as RegexConfig[];
  const smsState = loadSmsState();
  const senderPhone = getSmsSenderPhone(thread, smsState);
  const knownIdentity = thread.senderIdentityId === "real" || thread.recognition === "confirmed";
  const userIdentity = knownIdentity ? resolveUserIdentity(character.id, "sms") : null;
  const userName = userIdentity?.name || (thread.recognition === "suspected" ? "这个陌生号码" : "陌生号码");
  const rawHistory = historyRows.slice(-24).map(row => toHistoryMessage(row, thread.id));
  const timeContext = buildCharacterTimeContext(character.timeZone);
  const { recentBlocks, truncatedHistory, wbActivationContext, unifiedRecentItems } = prepareShortTermContext(character.id, "sms", {
    history: rawHistory,
    userName: knownIdentity ? userIdentity?.name : undefined,
    excludeSmsThreadId: thread.id,
    tokenBudgetOverride: SHORT_TERM_BUDGET,
  });
  const memConfig = loadMemoryConfig();
  const leanMemoryConfig = {
    ...memConfig,
    longTermTokenBudget: Math.min(memConfig.longTermTokenBudget, LONG_TERM_BUDGET),
    coreMemoryTokenBudget: Math.min(memConfig.coreMemoryTokenBudget, CORE_MEMORY_BUDGET),
  };
  const [longRows, coreRows] = await Promise.all([
    retrieveMemoriesForPrompt(character.id, wbActivationContext, leanMemoryConfig).catch(() => []),
    retrieveCoreMemoriesForPrompt(character.id, leanMemoryConfig).catch(() => []),
  ]);
  const prompt = assemblePromptPayload({
    character,
    history: truncatedHistory,
    preset,
    worldBooks,
    regexes,
    userIdentity,
    userName,
    appId: "sms",
    appTags: ["sms", "message"],
    longTermMemories: formatLongTermMemories(longRows),
    coreMemories: formatCoreMemories(coreRows),
    worldBookActivationContext: wbActivationContext,
    recentBlocks,
    unifiedRecentItems,
    timeContext,
  });
  return { prompt, api, preset, regexes, characterName: character.name, userName, senderPhone };
}

function buildIdentityRule(thread: SmsThread, senderPhone: string): string {
  if (thread.senderIdentityId === "real") {
    return `来信号码是用户已公开/已知的真实短信号码 ${senderPhone}。你知道这条短信来自用户本人。`;
  }
  if (thread.recognition === "confirmed") {
    return `来信号码 ${senderPhone} 是一个虚拟号码，但你已经在此前剧情中确认它属于用户。可以自然地以“已经知道是对方”的状态继续。`;
  }
  if (thread.recognition === "suspected") {
    return [
      `来信号码 ${senderPhone} 是陌生号码。你目前只“怀疑”它可能与用户有关，但尚未确认。`,
      `系统知道号码真正归属，但绝不能把这个后台真相告诉你；只能依据短信内容、说话习惯、共同经历和你的人设继续推断。`,
      `你可以装作不知道、试探、去 Chat 吐槽/钓对方，也可以逐渐确认；不要因为消息在 user role 就自动认定是用户。`,
    ].join("\n");
  }
  return [
    `来信号码 ${senderPhone} 对你而言是陌生号码。系统绝不向你提供它真正属于谁。`,
    `只能依据短信本身、已有关系与人设判断。可以不理、回“谁”、聊几句、警惕、屏蔽、产生怀疑；也可能在非常有辨识度的线索下认出来。`,
    `不要默认“陌生短信=用户的小号”，也不要为了配合玩法固定永远认不出来。`,
  ].join("\n");
}

export async function generateSmsReply(threadId: string): Promise<GeneratedSmsReply> {
  const thread = getSmsThread(threadId);
  if (!thread) throw new Error("短信会话不存在。");
  if (thread.blockedByUser || thread.blockedByCharacter) return { messages: [] };
  const historyRows = getSmsMessages(threadId);
  const base = await buildBasePrompt(thread, historyRows);
  const relationshipState = buildRelationshipState(thread.characterId);
  const contactPhone = getCharacterSmsPhone(thread.characterId).phone || "未设置";
  const instruction: LLMMessage = {
    role: "system",
    content: [
      "你正在手机系统的 SMS/iMessage「信息」App 中与对方发短信。这不是 Chat，也不是公开平台。",
      `你的短信号码：${contactPhone}。当前对方发件号码：${base.senderPhone}。`,
      buildIdentityRule(thread, base.senderPhone),
      relationshipState,
      "短信和 Chat 属于同一段关系：你可以记得 Chat/其他 App 里真正发生过的事，也可以自然提议‘去 Chat 说’；但不同通信渠道的拉黑状态彼此独立。",
      "回复要像真实手机短信：简短、自然，可以一次连发 1～4 条；不要为了展示功能写长篇说明。",
      "original 必须使用角色本人最自然的语言；translated 是忠实的简体中文翻译。若 original 本来就是中文，translated 与 original 相同。",
      "陌生号码身份判断必须依据你实际能知道的线索。recognition 只能填 unknown / suspected / confirmed；confirmed 代表你真的已经确认，不能仅凭系统知道后台归属就填写。",
      "如果按你的人设现在会直接屏蔽这个发件号码，blockSender=true。屏蔽的是当前号码，不代表屏蔽这个人在其他号码或 Chat 的所有渠道。",
      "只输出 JSON：{\"messages\":[{\"original\":\"...\",\"translated\":\"...\"}],\"recognition\":\"unknown/suspected/confirmed\",\"recognitionNote\":\"你目前为什么这样判断，简短内部事实\",\"blockSender\":false}。",
      "如果你此刻完全不想回复，可以 messages=[]。不要输出 JSON 之外的文字。",
    ].filter(Boolean).join("\n"),
  };
  const userTurn: LLMMessage = { role: "user", content: "根据最新收到的短信和当前关系，决定是否回复。" };
  const raw = await sendLLMRequest(
    base.api,
    base.preset,
    [...base.prompt, instruction, userTurn],
    base.regexes,
    { characterName: `SMS:${base.characterName}`, userName: base.userName },
    { appId: "sms", appTags: ["sms", "message", "reply"], skipOutputRegex: true },
  );
  return parseGenerated(raw, thread.recognition);
}

export async function generateProactiveSms(characterId: string, force = false): Promise<GeneratedProactiveSms> {
  const state = loadSmsState();
  const frequency = state.settings.proactiveFrequency;
  if (frequency === "off" && !force) return { send: false, messages: [] };
  const thread = state.threads.find(row => row.characterId === characterId && row.senderIdentityId === "real") || null;
  if (!thread) return { send: false, messages: [] };
  if (thread.blockedByUser || thread.blockedByCharacter) return { send: false, messages: [] };
  const now = Date.now();
  const minHours = { off: 99999, rare: 36, normal: 12, often: 4 }[frequency];
  const latestChar = state.messages.filter(row => row.threadId === thread.id && row.sender === "character").at(-1)?.createdAt || 0;
  const lastAttempt = thread.lastProactiveAt || 0;
  if (!force && now - Math.max(latestChar, lastAttempt) < minHours * 3600000) return { send: false, messages: [] };

  const historyRows = state.messages.filter(row => row.threadId === thread.id).sort((a, b) => a.createdAt - b.createdAt);
  const base = await buildBasePrompt(thread, historyRows);
  const relationshipState = buildRelationshipState(characterId);
  const instruction: LLMMessage = {
    role: "system",
    content: [
      "你正在决定要不要主动给用户发一条手机短信。SMS 只是你和用户关系中的一种通信方式，不要求每次都发。",
      `用户设置的主动短信频率：${frequency}。这只影响机会多少，不代表你必须发。`,
      relationshipState,
      "如果 Chat 被拉黑、好友申请没有被处理、刚刚发生重要关系事件，这些都可以成为你改走短信联系的原因；也可以因为自尊、忙碌、没必要而暂时不找。",
      "如果只是平常想起对方，也可以发很普通的短短信，不需要制造大事。",
      "original 使用角色最自然的语言，translated 为简体中文忠实翻译。最多连发 3 条。",
      "只输出 JSON：{\"send\":true/false,\"messages\":[{\"original\":\"...\",\"translated\":\"...\"}]}。不要输出其他文字。",
    ].filter(Boolean).join("\n"),
  };
  const raw = await sendLLMRequest(
    base.api,
    base.preset,
    [...base.prompt, instruction, { role: "user", content: "判断现在是否想主动发短信。" }],
    base.regexes,
    { characterName: `SMS:${base.characterName}`, userName: base.userName },
    { appId: "sms", appTags: ["sms", "message", "proactive"], skipOutputRegex: true },
  );
  const data = parseJsonObject(raw);
  const parsed = parseGenerated(raw, "confirmed");
  return { ...parsed, send: data.send === true && parsed.messages.length > 0 };
}
