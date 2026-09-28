import { jsonrepair } from "jsonrepair";
import { splitBilingualText } from "./bilingual-text";

import { loadCharacters } from "./character-storage";
import type { Character } from "./character-types";
import type { UserIdentity } from "@/components/settings/user-identity";
import { previewMessagesForApi, sendLLMRequest, ChatEngineError } from "./chat-engine";
import { assemblePromptPayload, type LLMMessage } from "./llm-prompt-assembler";
import { MacroEngine } from "./macro-engine";
import { normalizeUserNameToMacro } from "./user-macro";
import {
  loadApiConfigs,
  loadBindingConfig,
  loadPresets,
  loadRegexes,
  loadUserIdentities,
  loadWorldBooks,
  resolveBinding,
  resolveUserIdentity,
} from "./settings-storage";
import type { ApiConfig, PresetConfig, RegexConfig, WorldBookConfig } from "./settings-types";
import { loadInterviewMemoryPrompt } from "./interview-magazine-storage";
import {
  INTERVIEW_MAGAZINE_APP_ID,
  INTERVIEW_MAGAZINE_HOST_NAME,
  BUILTIN_INTERVIEW_HOSTS,
  type InterviewHost,
  type InterviewProgramme,
  type InterviewArticle,
  type InterviewCharacterSnapshot,
  type InterviewGuestSnapshot,
  type InterviewMessage,
  type InterviewUserSnapshot,
  type InterviewWorldBookSnapshot,
} from "./interview-magazine-types";

type InterviewGuestContext = {
  character: Character;
  characterSnapshot: InterviewCharacterSnapshot;
  worldBooks: WorldBookConfig[];
  worldBookSnapshot: InterviewWorldBookSnapshot[];
  apiConfig: ApiConfig;
  preset: PresetConfig | null;
  regexes: RegexConfig[];
};

type InterviewContext = {
  programme?: InterviewProgramme;
  includeUser: boolean;
  hostCharacterId?: string;
  hostName: string;
  hostPreset?: InterviewHost;
  hostPresent: boolean;
  hostCharacterIds: string[];
  guests: InterviewGuestContext[];
  primaryGuest: InterviewGuestContext;
  character: Character;
  characterSnapshot: InterviewCharacterSnapshot;
  userIdentity: UserIdentity | null;
  userSnapshot: InterviewUserSnapshot | null;
  userName: string;
  guestNames: string[];
  guestListText: string;
  worldBooks: WorldBookConfig[];
  worldBookSnapshot: InterviewWorldBookSnapshot[];
  guestSnapshots: InterviewGuestSnapshot[];
  apiConfig: ApiConfig;
  preset: PresetConfig | null;
  regexes: RegexConfig[];
};

type HostQuestionResult = {
  intro?: string;
  question: string;
  targetGuest?: string;
  targetCharacterId?: string;
  reactions?: string[];
};

export type InterviewRunOptions = { programme?: InterviewProgramme; hostCharacterId?: string; hostCharacterIds?: string[]; hostPresetId?: string; hostOverrides?: InterviewHost[]; hostPresent?: boolean; includeUser?: boolean; audienceEnabled?: boolean };

function createId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function cleanText(value: unknown, maxLength: number): string {
  return String(value ?? "")
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .trim()
    .slice(0, maxLength);
}

function cleanArray(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => cleanText(item, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

function parseJsonLike<T>(raw: string): T | null {
  const source = raw
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/```(?:json)?\s*([\s\S]*?)```/i, "$1")
    .trim();
  const first = source.indexOf("{");
  const last = source.lastIndexOf("}");
  const candidate = first >= 0 && last > first ? source.slice(first, last + 1) : source;

  try {
    return JSON.parse(candidate) as T;
  } catch {
    try {
      return JSON.parse(jsonrepair(candidate)) as T;
    } catch {
      return null;
    }
  }
}

export function makeInterviewMessage(
  role: InterviewMessage["role"],
  content: string,
  options?: Pick<InterviewMessage, "kind" | "target" | "targetCharacterId" | "targetCharacterName" | "speakerCharacterId" | "speakerName" | "audienceSource">,
): InterviewMessage {
  return {
    id: createId("imsg"),
    role,
    content,
    kind: options?.kind,
    target: options?.target,
    targetCharacterId: options?.targetCharacterId,
    targetCharacterName: options?.targetCharacterName,
    speakerCharacterId: options?.speakerCharacterId,
    speakerName: options?.speakerName,
    audienceSource: options?.audienceSource,
    createdAt: new Date().toISOString(),
  };
}

function joinChineseNames(names: string[]): string {
  const cleaned = names.map((name) => name.trim()).filter(Boolean);
  if (cleaned.length === 0) return "嘉宾";
  if (cleaned.length === 1) return cleaned[0];
  if (cleaned.length === 2) return `${cleaned[0]}和${cleaned[1]}`;
  return `${cleaned.slice(0, -1).join("、")}和${cleaned[cleaned.length - 1]}`;
}

function normalizeCharacterIds(characterIds: string | string[]): string[] {
  const source = Array.isArray(characterIds) ? characterIds : [characterIds];
  return [...new Set(source.map((id) => id.trim()).filter(Boolean))];
}

export function formatInterviewTranscript(
  messages: InterviewMessage[],
  characterName: string,
  userName: string,
  characterNameById?: Record<string, string>,
): string {
  if (messages.length === 0) return "（暂无采访实录）";
  return messages
    .map((message) => {
      if (message.role === "host") return `主持人 ${message.speakerName || INTERVIEW_MAGAZINE_HOST_NAME}：${message.content}`;
      if (message.role === "audience") return `匿名听众：${message.content}`;
      if (message.role === "direction") return `幕后导播提示（不公开，不代表用户在场）：${message.content}`;
      if (message.role === "character") {
        const speakerName = message.speakerName
          || (message.speakerCharacterId ? characterNameById?.[message.speakerCharacterId] : undefined)
          || characterName;
        const bilingual = splitBilingualText(message.content);
        return `${speakerName}：${bilingual ? `${bilingual.original}\n中文：${bilingual.translated}` : message.content}`;
      }
      return `${userName}：${message.content}`;
    })
    .join("\n");
}

function snapshotCharacter(character: Character): InterviewCharacterSnapshot {
  return {
    id: character.id,
    name: character.name,
    avatar: character.avatar,
    persona: character.persona ?? "",
    personality: character.personality,
    tags: character.tags ?? [],
  };
}

function snapshotUserIdentity(identity: UserIdentity | null): InterviewUserSnapshot | null {
  if (!identity) return null;
  return {
    name: identity.name,
    gender: identity.gender,
    age: identity.age,
    occupation: identity.occupation,
    bio: identity.bio,
    customSettings: identity.customSettings,
  };
}

function resolveInterviewUserIdentity(characterIds: string[], userIdentityId?: string): UserIdentity | null {
  const identities = loadUserIdentities();
  if (identities.length === 0) return null;
  if (userIdentityId) {
    return identities.find((identity) => identity.id === userIdentityId) || identities[0];
  }
  const resolved = characterIds
    .map((characterId) => resolveUserIdentity(characterId, INTERVIEW_MAGAZINE_APP_ID))
    .filter(Boolean) as UserIdentity[];
  const uniqueIds = new Set(resolved.map((identity) => identity.id));
  if (resolved.length > 0 && uniqueIds.size === 1) return resolved[0];
  return identities[0];
}

function formatCharacterCard(snapshot: InterviewCharacterSnapshot): string {
  return [
    `姓名：${snapshot.name}`,
    `人设：${snapshot.persona || "（未填写）"}`,
    `性格：${snapshot.personality || "（未填写）"}`,
    `标签：${snapshot.tags.length > 0 ? snapshot.tags.join("、") : "（无）"}`,
  ].join("\n");
}

function formatUserSnapshot(snapshot: InterviewUserSnapshot | null): string {
  if (!snapshot) return "（未提供共同受访者资料）";
  return [
    `姓名：${snapshot.name || "用户"}`,
    snapshot.gender ? `性别：${snapshot.gender}` : "",
    snapshot.age ? `年龄：${snapshot.age}` : "",
    snapshot.occupation ? `职业：${snapshot.occupation}` : "",
    snapshot.bio ? `简介：${snapshot.bio}` : "",
    snapshot.customSettings ? `补充设定：${snapshot.customSettings}` : "",
  ].filter(Boolean).join("\n") || "（未提供共同受访者资料）";
}

function snapshotWorldBooks(worldBooks: WorldBookConfig[]): InterviewWorldBookSnapshot[] {
  return worldBooks.map((book) => ({
    id: book.id,
    name: book.name,
    entries: (book.entries || [])
      .filter((entry) => !entry.disable)
      .map((entry) => ({
        key: entry.key,
        comment: entry.comment,
        content: entry.content,
      })),
  }));
}

function formatWorldBooks(snapshot: InterviewWorldBookSnapshot[]): string {
  if (snapshot.length === 0) return "（未提供补充资料）";
  const lines: string[] = [];
  for (const book of snapshot) {
    lines.push(`【${book.name}】`);
    if (book.entries.length === 0) {
      lines.push("（无启用词条）");
      continue;
    }
    book.entries.forEach((entry, index) => {
      lines.push(`${index + 1}. 关键词：${entry.key || "（无）"}`);
      if (entry.comment) lines.push(`说明：${entry.comment}`);
      lines.push(`内容：${entry.content}`);
    });
  }
  return lines.join("\n");
}

export function loadInterviewContext(characterId: string): InterviewContext {
  return loadInterviewContextForGuests([characterId]);
}

export function loadInterviewContextForGuests(characterIds: string[], userIdentityId?: string, options: InterviewRunOptions = {}): InterviewContext {
  const ids = normalizeCharacterIds(characterIds);
  const allCharacters = loadCharacters();
  if (ids.length === 0 && !options.includeUser) throw new ChatEngineError("请至少邀请一位角色或用户。");
  // An existing character binding supplies the programme API when the user is the only guest.
  // This character never enters the cast or transcript.
  const fallbackCharacter = allCharacters.find(character => Boolean(resolveBinding(loadBindingConfig(), character.id, INTERVIEW_MAGAZINE_APP_ID).apiConfigId)) || allCharacters[0];
  const apiIds = ids.length ? ids : fallbackCharacter ? [fallbackCharacter.id] : [];
  if (!apiIds.length) throw new ChatEngineError("请先创建至少一位角色，为节目绑定 API。");
  const bindings = loadBindingConfig();
  const presets = loadPresets();
  const apiConfigs = loadApiConfigs();
  const allWorldBooks = loadWorldBooks();
  const allRegexes = loadRegexes();
  const apiGuests = apiIds.map((id) => {
    const character = allCharacters.find((item) => item.id === id);
    if (!character) throw new ChatEngineError(`找不到受访角色：${id}`);

    const slot = resolveBinding(bindings, id, INTERVIEW_MAGAZINE_APP_ID);
    if (!slot.apiConfigId) {
      throw new ChatEngineError(`未给「在场」绑定 ${character.name} 的 API 配置。`);
    }

    const apiConfig = apiConfigs.find((config) => config.id === slot.apiConfigId);
    if (!apiConfig) throw new ChatEngineError(`找不到 ${character.name} 的「在场」API 配置。`);

    let preset = slot.presetId ? presets.find((entry) => entry.id === slot.presetId) ?? null : null;
    if (!preset) preset = presets.find((entry) => entry.builtIn) ?? null;

    const worldBooks = (slot.worldBookIds || [])
      .map((bookId) => allWorldBooks.find((book) => book.id === bookId))
      .filter(Boolean) as WorldBookConfig[];

    const regexes = (slot.regexIds || [])
      .map((regexId) => allRegexes.find((group) => group.id === regexId))
      .filter(Boolean) as RegexConfig[];

    return {
      character,
      characterSnapshot: snapshotCharacter(character),
      worldBooks,
      worldBookSnapshot: snapshotWorldBooks(worldBooks),
      apiConfig,
      preset,
      regexes,
    };
  });

  const guests = ids.length ? apiGuests : [];
  const primaryGuest = apiGuests[0];
  const hostGuest = guests.find((guest) => guest.character.id === options.hostCharacterId);
  const hostPreset = options.hostOverrides?.find((host) => host.id === options.hostPresetId) || BUILTIN_INTERVIEW_HOSTS.find((host) => host.id === options.hostPresetId);
  const userIdentity = resolveInterviewUserIdentity(ids, userIdentityId);
  const userSnapshot = snapshotUserIdentity(userIdentity);
  const guestNames = guests.map((guest) => guest.character.name);
  const guestSnapshots = guests.map((guest) => ({
    characterId: guest.character.id,
    characterName: guest.character.name,
    characterSnapshot: guest.characterSnapshot,
    worldBookSnapshot: guest.worldBookSnapshot,
  }));

  return {
    programme: options.programme,
    includeUser: options.includeUser !== false,
    hostPresent: options.hostPresent !== false,
    hostPreset,
    hostCharacterIds: options.hostCharacterIds || (options.hostCharacterId ? [options.hostCharacterId] : []),
    hostCharacterId: hostGuest?.character.id,
    hostName: options.hostPresent === false ? "无主持人" : hostGuest?.character.name || hostPreset?.name || INTERVIEW_MAGAZINE_HOST_NAME,
    guests,
    primaryGuest,
    character: primaryGuest.character,
    characterSnapshot: primaryGuest.characterSnapshot,
    userIdentity,
    userSnapshot,
    userName: userSnapshot?.name || "用户",
    guestNames,
    guestListText: guestNames.length ? joinChineseNames(guestNames) : userSnapshot?.name || "用户",
    worldBooks: primaryGuest.worldBooks,
    worldBookSnapshot: primaryGuest.worldBookSnapshot,
    guestSnapshots,
    apiConfig: primaryGuest.apiConfig,
    preset: primaryGuest.preset,
    regexes: primaryGuest.regexes,
  };
}

function getCharacterNameMap(context: InterviewContext): Record<string, string> {
  return Object.fromEntries(context.guests.map((guest) => [guest.character.id, guest.character.name]));
}

function findGuestContext(context: InterviewContext, characterId: string): InterviewGuestContext {
  return context.guests.find((guest) => guest.character.id === characterId) || context.primaryGuest;
}

function resolveTargetGuest(context: InterviewContext, rawTarget?: string, fallbackCharacterId?: string): InterviewGuestContext {
  const invitees = context.guests.filter(guest => guest.character.id !== context.hostCharacterId);
  const candidates = invitees.length > 0 ? invitees : context.guests;
  const target = rawTarget?.trim();
  if (target) {
    const exact = candidates.find((guest) => guest.character.id === target || guest.character.name === target);
    if (exact) return exact;
    const fuzzy = candidates.find((guest) => target.includes(guest.character.name) || guest.character.name.includes(target));
    if (fuzzy) return fuzzy;
  }
  if (fallbackCharacterId) {
    const fallback = candidates.find((guest) => guest.character.id === fallbackCharacterId);
    if (fallback) return fallback;
  }
  return candidates[0];
}

function getOtherGuestNames(context: InterviewContext, currentCharacterId: string): string {
  const names = context.guests
    .filter((guest) => guest.character.id !== currentCharacterId)
    .map((guest) => guest.character.name);
  return names.length > 0 ? joinChineseNames(names) : "无";
}

function formatGuestCards(context: InterviewContext): string {
  return context.guests
    .map((guest, index) => [
      `【嘉宾 ${index + 1}：${guest.character.name}】`,
      formatCharacterCard(guest.characterSnapshot),
    ].join("\n"))
    .join("\n\n");
}

function formatGuestWorldBooks(context: InterviewContext): string {
  if (context.guests.every((guest) => guest.worldBookSnapshot.length === 0)) return "（未提供补充资料）";
  return context.guests
    .map((guest) => [
      `【${guest.character.name} 的补充资料】`,
      formatWorldBooks(guest.worldBookSnapshot),
    ].join("\n"))
    .join("\n\n");
}

function buildHostBriefing(params: {
  context: InterviewContext;
  theme: string;
  phase: string;
  transcript: InterviewMessage[];
}): string {
  const { context, theme, phase, transcript } = params;
  return [
    "<interview_briefing>",
    `本期主题：${theme}`,
    `当前采访阶段：${phase}`,
    `本期嘉宾：${context.guestListText}`,
    `用户参与：${context.includeUser ? context.userName : "本期不以嘉宾身份参与；匿名弹幕不能证明用户在场，不要向用户提问或描述用户在场"}`,
    `栏目：${context.programme?.name || "在场·人物志"}；风格：${context.programme?.direction || "人物对谈"}`,
    `主持：${context.hostPresent ? context.hostCharacterIds.length ? context.hostCharacterIds.map(id => context.guests.find(g => g.character.id === id)?.character.name).filter(Boolean).join("、") : context.hostName : "本期无主持人，由参与者自由对谈"}`,
    "",
    "<guest_reference>",
    formatGuestCards(context),
    "</guest_reference>",
    "",
    "<guest_background>",
    formatGuestWorldBooks(context),
    "</guest_background>",
    "",
    "<user_profile>",
    context.includeUser ? formatUserSnapshot(context.userSnapshot) : "（用户不参与本期节目）",
    "</user_profile>",
    "",
    "<transcript>",
    formatInterviewTranscript(transcript, context.character.name, context.userName, getCharacterNameMap(context)),
    "</transcript>",
    "</interview_briefing>",
  ].join("\n");
}

async function callHostJson<T>(context: InterviewContext, systemPrompt: string, userPrompt: string): Promise<T | null> {
  const hostGuest = context.guests.find((guest) => guest.character.id === context.hostCharacterId);
  const raw = await sendLLMRequest(
    hostGuest?.apiConfig || context.apiConfig,
    hostGuest?.preset || null,
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    hostGuest?.regexes || [],
    { characterName: context.hostName, userName: context.userName },
    { skipOutputRegex: true, appId: INTERVIEW_MAGAZINE_APP_ID },
  );
  return parseJsonLike<T>(raw);
}

function expandInterviewPromptMacros(prompt: string, context: InterviewContext): string {
  const engine = new MacroEngine(context.character.name, context.userName);
  engine.interviewGuests = context.guestListText;
  engine.interviewGuestCount = String(context.guests.length);
  engine.interviewCurrentGuest = context.character.name;
  engine.interviewOtherGuests = getOtherGuestNames(context, context.character.id);
  return engine.expand(prompt);
}

function expandMemoryPromptMacros(prompt: string, context: InterviewContext): string {
  const literalUserMacro = "__INTERVIEW_LITERAL_USER_MACRO__";
  return expandInterviewPromptMacros(
    prompt.replace(/\{\{\s*user\s*\}\}/gi, literalUserMacro),
    context,
  ).replaceAll(literalUserMacro, "{{user}}");
}

function buildHostSystemPrompt(context: InterviewContext, lines: string[]): string {
  return [
    !context.hostPresent ? "本期没有主持人。你仅负责幕后生成必要的节目组织内容或回顾，不能在公开实录中冒充主持人发言。" : context.hostCharacterId
      ? `你是${context.hostName}，正在主持自己开设的「${context.programme?.name || "在场"}」。严格依据本人角色设定、背景和关系说话。${context.guests.find(g => g.character.id === context.hostCharacterId)?.character.persona || ""}。${context.programme?.hostStyle || ""}`
      : `你是「在场」主持人${context.hostName}。${context.hostPreset?.direction || context.programme?.hostStyle || "自然主持"}。你只负责组织节目、串联发言，不能替嘉宾回答。`,
    `栏目风格：${context.programme?.direction || "具体自然的人物对谈"}。${context.includeUser ? "用户参加，可向用户提问。" : "用户不参与本期录制，不得向用户提问或声称用户在场。"}`,
    `栏目主持提示词：${context.programme?.hostPrompt || "根据栏目风格主持，尊重真实对话。"}`,
    `主持人的默认语言：${context.hostCharacterId ? "按角色人设自然使用" : context.hostPreset?.language || "按参与者所用语言自然使用"}。在沟通不通时自然调整，不强制嘉宾改语言。主持人的 intro、question 等台词如非中文，分别输出「原文 | 准确中文译文」；不要朗读译文。`,
    "",
    ...lines,
    "输出必须是 JSON，不要 markdown，不要解释。",
  ].join("\n");
}

function hostFallback(context: InterviewContext, theme: string, subject: string, kind: "intro" | "question"): string {
  const language = context.hostPreset?.language || "";
  if (language.includes("韩")) return kind === "intro"
    ? `안녕하세요. 오늘은 ${theme}에 대해 천천히 이야기해 볼게요. | 大家好，今天我们慢慢聊聊「${theme}」。`
    : `${subject} 씨, ${theme}라고 하면 가장 먼저 떠오르는 장면이 있나요? | ${subject}，说到「${theme}」，你最先想到的是哪个画面？`;
  if (language.includes("日")) return kind === "intro"
    ? `こんばんは。今日は「${theme}」について、気楽に話してみましょう。 | 晚上好，今天轻松聊聊「${theme}」。`
    : `${subject}さん、「${theme}」と聞いて、最初に思い浮かぶのは何ですか？ | ${subject}，听到「${theme}」，你最先想到什么？`;
  return kind === "intro" ? `欢迎来到《在场》。本期聊聊「${theme}」。` : `${subject}，关于「${theme}」，你最先想到什么？`;
}

export async function generateHostOpening(
  theme: string,
  characterIds: string | string[],
  userIdentityId?: string,
  options: InterviewRunOptions = {},
): Promise<{ context: InterviewContext; intro: string; question: string; targetCharacterId: string; targetCharacterName: string }> {
  const context = loadInterviewContextForGuests(normalizeCharacterIds(characterIds), userIdentityId, options);
  const briefing = buildHostBriefing({ context, theme, phase: "开场，主持人需要介绍本期主题并向嘉宾发出第一问", transcript: [] });
  const result = await callHostJson<HostQuestionResult>(
    context,
    buildHostSystemPrompt(context, [
      "当前任务：为本期采访开场，并向嘉宾提出第一问。",
      context.hostCharacterId ? "你以自己的身份主持节目；单人节目可以自然自述，有来宾时把话题抛给来宾。" : "你不扮演嘉宾，也不替用户回答。你只负责做足功课、提出有现场感和人物纵深的问题。",
    ]),
    [
      briefing,
      "",
      "请生成开场：",
      `- intro：30-60 字，符合「${context.programme?.name || "人物对谈"}」的开场白，点出主题和嘉宾${context.includeUser ? "与参与的用户" : ""}。`,
      `- question：第一个问${context.guests.length ? "嘉宾" : "用户"}的问题，35-70 字，符合本栏目的气氛，不套话。`,
      context.guests.length ? `- targetGuest：从本期参与角色中选择一个回应者：${context.guestNames.join("、")}。` : "- 本期只有用户作为受访者；直接向用户提问，targetGuest 留空。",
      "",
      '返回格式：{"intro":"...","question":"...","targetGuest":"..."}',
    ].join("\n"),
  );
  const targetGuest = context.guests.length ? resolveTargetGuest(context, result?.targetCharacterId || result?.targetGuest) : undefined;

  return {
    context,
    intro: cleanText(result?.intro, 220) || hostFallback(context, theme, context.userName, "intro"),
    question: cleanText(result?.question, 220) || hostFallback(context, theme, targetGuest?.character.name || context.userName, "question"),
    targetCharacterId: targetGuest?.character.id || "",
    targetCharacterName: targetGuest?.character.name || "",
  };
}

export async function generateHostQuestion(params: {
  theme: string;
  characterIds: string | string[];
  userIdentityId?: string;
  transcript: InterviewMessage[];
  target: "character" | "user";
  phase: string;
  fallbackTargetCharacterId?: string;
  options?: InterviewRunOptions;
}): Promise<{ question: string; targetCharacterId?: string; targetCharacterName?: string; reactions: string[] }> {
  const context = loadInterviewContextForGuests(normalizeCharacterIds(params.characterIds), params.userIdentityId, params.options);
  const fallbackGuest = params.target === "character" ? resolveTargetGuest(context, undefined, params.fallbackTargetCharacterId) : undefined;
  const targetLabel = params.target === "character" ? fallbackGuest?.character.name || "嘉宾" : context.userName;
  const briefing = buildHostBriefing({
    context,
    theme: params.theme,
    phase: params.phase,
    transcript: params.transcript,
  });
  const result = await callHostJson<HostQuestionResult>(
    context,
    buildHostSystemPrompt(context, [
      "当前任务：根据嘉宾材料和已有实录自然追问。",
      "问题要推动对谈，不要总结，不要代答。",
    ]),
    [
      briefing,
      "",
      params.target === "character"
        ? `请提出下一问，提问对象需要是本期嘉宾之一。默认可问：${targetLabel}。`
        : `请提出下一问，提问对象：${targetLabel}。`,
      "- 问题必须自然承接上一轮回答；若用户未回应，也可自然转向其他参与者，不要机械催答。",
      "- 30-70 字。",
      "- 避免“你怎么看”“有什么感受”这类泛问。",
      params.target === "user" ? "- 向用户提问时，要把嘉宾刚才的话转成用户可回应的个人经验或判断。" : "- 向嘉宾提问时，承接上一位说话者；如果用户不参与，不要提及用户。",
      params.target === "character" ? `- targetGuest：选择下一位回应者，优先邀请其他嘉宾：${(context.guestNames.filter(name => name !== context.hostName).length ? context.guestNames.filter(name => name !== context.hostName) : context.guestNames).join("、")}。` : "",
      params.options?.audienceEnabled ? "- reactions：生成 0–5 条匿名听众实时弹幕，也可以一条不生成。弹幕正文写中文，可偶尔带翻译腔或韩语、日语、英语口癖；口癖不代表听众国籍。只反应已公开发言，不剧透、不泄露隐私。角色可以偶尔猜匿名弹幕是否来自用户，但绝不能确定，也不能把弹幕当成用户作为嘉宾在场。" : "",
      "",
      params.target === "character"
        ? '返回格式：{"question":"...","targetGuest":"...","reactions":["..."]}'
        : '返回格式：{"question":"...","reactions":["..."]}',
    ].join("\n"),
  );
  const targetGuest = params.target === "character"
    ? resolveTargetGuest(context, result?.targetCharacterId || result?.targetGuest, params.fallbackTargetCharacterId)
    : undefined;
  return {
    question: cleanText(result?.question, 240) || hostFallback(context, params.theme, targetLabel, "question"),
    targetCharacterId: targetGuest?.character.id,
    targetCharacterName: targetGuest?.character.name,
    reactions: params.options?.audienceEnabled ? cleanArray(result?.reactions, 5, 100).filter(text => /[\u3400-\u9fff]/u.test(text)) : [],
  };
}

export async function generateInterviewAudienceReactions(params: {
  theme: string; characterIds: string[]; userIdentityId?: string;
  transcript: InterviewMessage[]; options: InterviewRunOptions;
}): Promise<string[]> {
  if (!params.options.audienceEnabled || params.transcript.length === 0) return [];
  const context = loadInterviewContextForGuests(params.characterIds, params.userIdentityId, params.options);
  const result = await callHostJson<{ reactions?: string[] }>(context,
    "你只生成电台匿名听众弹幕。根据节目刚刚公开的发言，可以生成 0–5 条，也可没有。正文全部中文，可偶尔带翻译腔或日韩英语口癖，但不得据此确定发言者的国籍或身份。不能说出未公开的角色隐私。返回 JSON。",
    `${buildHostBriefing({ context, theme: params.theme, phase: "听众实时弹幕", transcript: params.transcript.slice(-9) })}\n返回格式：{"reactions":["..."]}`);
  return cleanArray(result?.reactions, 5, 100).filter(text => /[\u3400-\u9fff]/u.test(text));
}

export async function generateCharacterInterviewAnswer(params: {
  theme: string;
  characterIds: string | string[];
  characterId: string;
  userIdentityId?: string;
  question: string;
  transcript: InterviewMessage[];
  round: number;
  lastUserAnswer?: string;
  options?: InterviewRunOptions;
}): Promise<string> {
  const context = loadInterviewContextForGuests(normalizeCharacterIds(params.characterIds), params.userIdentityId, params.options);
  const guest = findGuestContext(context, params.characterId);
  const transcript = formatInterviewTranscript(params.transcript, guest.character.name, context.userName, getCharacterNameMap(context));
  const characterAnswerHistory = params.transcript
    .filter((message) => message.role === "character" && (!message.speakerCharacterId || message.speakerCharacterId === guest.character.id))
    .map((message) => message.content)
    .join("\n\n");

  const llmMessages = assemblePromptPayload({
    character: guest.character,
    history: [],
    preset: guest.preset,
    worldBooks: guest.worldBooks,
    regexes: guest.regexes,
    userIdentity: context.userIdentity,
    appId: INTERVIEW_MAGAZINE_APP_ID,
    appTags: ["interview_magazine", "answer"],
    worldBookActivationContext: `${params.theme}\n${params.question}\n${transcript}`,
    interviewTheme: params.theme,
    interviewHostName: context.hostName,
    interviewGuests: context.guestListText,
    interviewGuestCount: String(context.guests.length),
    interviewCurrentGuest: guest.character.name,
    interviewOtherGuests: getOtherGuestNames(context, guest.character.id),
    interviewQuestion: params.question,
    interviewTranscript: transcript,
    interviewPhase: context.hostPresent ? "嘉宾参与电台对谈" : "无主持人，角色彼此自然接话，主动抛话题；不要假装有主持人",
    interviewRound: String(params.round),
    interviewUserAnswer: params.lastUserAnswer || "",
    interviewCharacterAnswerHistory: characterAnswerHistory,
  });

  llmMessages.push({ role: "system", content: [
    "在场采访双语要求：请以嘉宾本人自然会使用的语言回答，保留嘉宾原话。",
    "如果原话是韩语、日语、英语等非中文，整段输出必须是“原文 | 准确中文译文”，只使用一个竖线分隔，不要附加标签、动作或主持人的话。",
    "嘉宾自然使用中文时只输出中文原话，不重复翻译。问题、系统说明和记忆摘要不需要双语。",
    `栏目：${context.programme?.name || "在场"}。风格：${context.programme?.direction || "自然对谈"}。${context.programme?.hostPrompt || ""}`,
    `参与者：${context.guestListText}${context.includeUser ? `、${context.userName}` : ""}。${context.includeUser ? "用户可以不回答或连续说多句；不要强制用户每轮发言。" : "用户没有以嘉宾身份参加；匿名弹幕不等于用户在场。"}幕后导播提示只影响话题，不可以当作台上发言。若用户连续几次不说话，可偶尔自然地关心一句，不能每轮催促。`,
  ].join("\n") });

  const raw = await sendLLMRequest(
    guest.apiConfig,
    guest.preset,
    llmMessages,
    guest.regexes,
    { characterName: guest.character.name, userName: context.userName },
    { appId: INTERVIEW_MAGAZINE_APP_ID, appTags: ["interview_magazine", "answer"] },
  );

  return cleanText(raw, 2000) || "（沉默了一会儿）这个问题，我需要从一个很小的地方说起。";
}

export async function previewInterviewMagazinePromptPayload(params: {
  theme: string;
  characterIds: string | string[];
  mode: "opening" | "host" | "answer" | "article";
  transcript?: InterviewMessage[];
  question?: string;
  issueNumber?: number;
  userIdentityId?: string;
}): Promise<{ messages: LLMMessage[]; characterName: string; model: string; presetName: string }> {
  const context = loadInterviewContextForGuests(normalizeCharacterIds(params.characterIds), params.userIdentityId);
  const transcript = params.transcript ?? [];
  if (params.mode === "opening") {
    const briefing = buildHostBriefing({
      context,
      theme: params.theme,
      phase: "开场，主持人需要介绍本期主题并向嘉宾发出第一问",
      transcript: [],
    });
    const messages: LLMMessage[] = [
      {
        role: "system",
        content: buildHostSystemPrompt(context, [
          "当前任务：为本期采访开场，并向嘉宾提出第一问。",
          "你不扮演嘉宾，也不替用户回答。你只负责做足功课、提出有现场感和人物纵深的问题。",
        ]),
      },
      {
        role: "user",
        content: [
          briefing,
          "",
          "请生成开场：",
          "- intro：30-60 字，像杂志视频栏目的开场白，点出本期主题、嘉宾和共同受访者。",
          "- question：第一个问嘉宾的问题，35-70 字，具体、锋利、不套话。",
          `- targetGuest：从本期嘉宾中选择一个被提问者，只能填写这些名字之一：${context.guestNames.join("、")}。`,
          "",
          '返回格式：{"intro":"...","question":"...","targetGuest":"..."}',
        ].join("\n"),
      },
    ];
    return {
      messages: previewMessagesForApi(context.apiConfig, null, messages),
      characterName: "在场主持人·开场",
      model: context.apiConfig.defaultModel,
      presetName: "(无预设)",
    };
  }
  if (params.mode === "host") {
    const fallbackGuest = resolveTargetGuest(context, undefined);
    const briefing = buildHostBriefing({
      context,
      theme: params.theme,
      phase: "预览主持人下一问",
      transcript,
    });
    const messages: LLMMessage[] = [
      {
        role: "system",
        content: buildHostSystemPrompt(context, [
          "当前任务：根据嘉宾材料和已有实录自然追问。",
          "问题要推动对谈，不要总结，不要代答。",
        ]),
      },
      {
        role: "user",
        content: [
          briefing,
          "",
          `请提出下一问，提问对象需要是本期嘉宾之一。默认可问：${fallbackGuest.character.name}。`,
          "- 问题必须自然承接上一轮回答。",
          "- 30-70 字。",
          "- 避免“你怎么看”“有什么感受”这类泛问。",
          "- 向嘉宾提问时，要把用户刚才的话抛回给嘉宾，制造真正的对谈。",
          `- targetGuest：从本期嘉宾中选择一个被提问者，只能填写这些名字之一：${context.guestNames.join("、")}。`,
          "",
          '返回格式：{"question":"...","targetGuest":"..."}',
        ].join("\n"),
      },
    ];
    return {
      messages: previewMessagesForApi(context.apiConfig, null, messages),
      characterName: "在场主持人",
      model: context.apiConfig.defaultModel,
      presetName: "(无预设)",
    };
  }
  if (params.mode === "article") {
    const briefing = buildHostBriefing({
      context,
      theme: params.theme,
      phase: "采访结束，编辑部将实录整理为杂志专栏",
      transcript,
    });
    const memoryPrompt = expandMemoryPromptMacros(context.programme?.memoryPrompt || loadInterviewMemoryPrompt(), context);
    const messages: LLMMessage[] = [
      {
        role: "system",
        content: buildHostSystemPrompt(context, [
          "当前任务：以主编视角将采访实录整理成中文杂志专栏。",
          "你不新增用户事实，不编造参考材料以外的背景。",
        ]),
      },
      {
        role: "user",
        content: [
          briefing,
          "",
          `本期刊号：${params.issueNumber ?? 1}`,
          "请撰写一篇杂志专栏：",
          "- title：4-10 字中文主标题，凝练有记忆点。",
          "- subtitle：18-40 字副标题，像 deck，不要空泛。",
          "- body：3-5 段，每段 90-180 字。允许场景描写、作者观察、自然引用原话。",
          "- pullQuote：从嘉宾回答中抽一句 12-36 字的大字引语；多人时优先选最能代表本期主题的一句。",
          "- qa：精选 3 条 Q&A，问题简短，回答 30-80 字。",
          "- memorySummary：根据下方“访谈记忆摘要提示词”生成短期记忆摘要，只写摘要正文。",
          "- memorySummary 中凡是指代共同受访者或用户本人时，必须写作 {{user}}，不要写具体姓名。",
          "",
          "<memory_summary_instruction>",
          memoryPrompt,
          "</memory_summary_instruction>",
          "",
          '返回格式：{"title":"...","subtitle":"...","body":["..."],"pullQuote":"...","qa":[{"q":"...","a":"..."}],"memorySummary":"..."}',
        ].join("\n"),
      },
    ];
    return {
      messages: previewMessagesForApi(context.apiConfig, null, messages),
      characterName: "在场主编·专栏",
      model: context.apiConfig.defaultModel,
      presetName: "(无预设)",
    };
  }

  const guest = context.primaryGuest;
  const transcriptText = formatInterviewTranscript(transcript, context.character.name, context.userName, getCharacterNameMap(context));
  const llmMessages = assemblePromptPayload({
    character: guest.character,
    history: [],
    preset: guest.preset,
    worldBooks: guest.worldBooks,
    regexes: guest.regexes,
    userIdentity: context.userIdentity,
    appId: INTERVIEW_MAGAZINE_APP_ID,
    appTags: ["interview_magazine", "answer"],
    worldBookActivationContext: `${params.theme}\n${params.question || "请谈谈你此刻最想回应的问题。"}\n${transcriptText}`,
    interviewTheme: params.theme,
    interviewHostName: INTERVIEW_MAGAZINE_HOST_NAME,
    interviewGuests: context.guestListText,
    interviewGuestCount: String(context.guests.length),
    interviewCurrentGuest: guest.character.name,
    interviewOtherGuests: getOtherGuestNames(context, guest.character.id),
    interviewQuestion: params.question || "请谈谈你此刻最想回应的问题。",
    interviewTranscript: transcriptText,
    interviewPhase: "嘉宾回答主持人问题",
    interviewRound: "1",
    interviewUserAnswer: "",
    interviewCharacterAnswerHistory: "",
  });
  return {
    messages: previewMessagesForApi(guest.apiConfig, guest.preset, llmMessages),
    characterName: `在场:${guest.character.name}`,
    model: guest.apiConfig.defaultModel,
    presetName: guest.preset?.name ?? "默认预设",
  };
}

export async function composeInterviewArticle(params: {
  theme: string;
  characterIds: string | string[];
  userIdentityId?: string;
  transcript: InterviewMessage[];
  issueNumber: number;
  options?: InterviewRunOptions;
}): Promise<{ context: InterviewContext; article: InterviewArticle }> {
  const context = loadInterviewContextForGuests(normalizeCharacterIds(params.characterIds), params.userIdentityId, params.options);
  const briefing = buildHostBriefing({
    context,
    theme: params.theme,
    phase: "本期录制结束，整理节目回顾与声音摘录",
    transcript: params.transcript.filter(message => message.role !== "direction"),
  });
  const memoryPrompt = context.includeUser
    ? expandMemoryPromptMacros(context.programme?.memoryPrompt || loadInterviewMemoryPrompt(), context)
    : `${context.programme?.memoryPrompt || ""}只依据本期实际发言者与实录总结主题和观点。不把匿名弹幕猜测写成事实；不将幕后导播提示当作用户在场。`;
  const result = await callHostJson<Partial<InterviewArticle>>(
    context,
    buildHostSystemPrompt(context, [
      `当前任务：将「${context.programme?.name || "在场"}」实录整理为中文节目回顾与 show notes。`,
      "你不新增用户事实，不编造参考材料以外的背景。",
    ]),
    [
      briefing,
      "",
      `本期刊号：${params.issueNumber}`,
      "请撰写本期播客 / 电台节目的回顾：",
      "- title：4-10 字中文主标题，凝练有记忆点。",
      "- subtitle：18-40 字副标题，像 deck，不要空泛。",
      "- body：3-5 段，每段 90-180 字。按实际对话整理节目内容和转折，可引用原话，不虚构录制现场。",
      "- pullQuote：从嘉宾回答中抽一句 12-36 字的大字引语；多人时优先选最能代表本期主题的一句。",
      "- qa：精选 3 条 Q&A，问题简短，回答 30-80 字。",
      "- memorySummary：根据下方“访谈记忆摘要提示词”生成短期记忆摘要，只写摘要正文。",
      context.includeUser ? "- memorySummary 中指代参与的用户时写作 {{user}}，不要写具体姓名。" : "- 本期用户没有参与，不要在正文和摘要里写用户。",
      "",
      "<memory_summary_instruction>",
      memoryPrompt,
      "</memory_summary_instruction>",
      "",
      '返回格式：{"title":"...","subtitle":"...","body":["..."],"pullQuote":"...","qa":[{"q":"...","a":"..."}],"memorySummary":"..."}',
    ].join("\n"),
  );

  const fallbackTitle = params.theme.slice(0, 10) || "未命名访谈";
  const article: InterviewArticle = {
    title: cleanText(result?.title, 40) || fallbackTitle,
    subtitle: cleanText(result?.subtitle, 90) || "一次关于沉默、细节与当下的对谈。",
    body: cleanArray(result?.body, 5, 420),
    pullQuote: cleanText(result?.pullQuote, 80),
    qa: Array.isArray(result?.qa)
      ? result!.qa!.map((item) => ({
        q: cleanText((item as Record<string, unknown>).q, 140),
        a: cleanText((item as Record<string, unknown>).a, 220),
      })).filter((item) => item.q && item.a).slice(0, 3)
      : [],
    memorySummary: context.includeUser ? normalizeUserNameToMacro(cleanText(result?.memorySummary, 360), context.userName) : cleanText(result?.memorySummary, 360),
  };

  if (article.body.length === 0) {
    article.body = [
      "采访结束时，现场有短暂的安静。那些答案没有急着成为结论，而是像被放在桌面上的录音笔，仍然带着一点余温。",
      `围绕「${params.theme}」，${context.guestListText}${context.includeUser ? `和${context.userName}` : ""}把问题推向了更私人、更具体的地方。`,
    ];
  }

  if (!article.memorySummary) {
    article.memorySummary = `围绕「${params.theme}」，${context.guestListText}${context.includeUser ? "与{{user}}" : ""}完成了一期节目；对谈集中在具体选择和态度变化上。`;
  }

  return { context, article };
}
