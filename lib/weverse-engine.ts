import { loadCharacters } from "./character-storage";
import type { Character } from "./character-types";
import { sendLLMRequest, ChatEngineError } from "./chat-engine";
import { assemblePromptPayload, type LLMMessage } from "./llm-prompt-assembler";
import {
  loadApiConfigs,
  loadBindingConfig,
  loadPresets,
  loadRegexes,
  loadWorldBooks,
  resolveBinding,
  resolveUserIdentity,
} from "./settings-storage";
import type { ApiConfig, PresetConfig, RegexConfig, WorldBookConfig } from "./settings-types";
import { loadMemoryConfig } from "./memory-storage";
import { retrieveCoreMemoriesForPrompt, retrieveMemoriesForPrompt } from "./memory-service";
import { formatCoreMemories, formatLongTermMemories } from "./memory-injector";
import { prepareShortTermContext } from "./short-term-assembler";
import { buildCalendarScheduleMarker } from "./calendar-storage";
import { getWeekStartIso } from "./calendar-utils";
import type { WeverseCommunity, WeversePost } from "./weverse-storage";

export type GeneratedWeverseArtistPost = {
  original: string;
  translated: string;
  photoDescription?: string;
};

export type GeneratedWeverseFanPost = {
  displayName: string;
  body: string;
};

export type GeneratedWeverseFanComment = {
  displayName: string;
  body: string;
};

type ResolvedGeneration = {
  character: Character;
  apiConfig: ApiConfig;
  preset: PresetConfig | null;
  regexes: RegexConfig[];
  messages: LLMMessage[];
  userName: string;
};

function extractJsonObject(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(trimmed.slice(start, end + 1));
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

async function resolveGeneration(characterId: string, community: WeverseCommunity): Promise<ResolvedGeneration> {
  const character = loadCharacters().find((item) => item.id === characterId);
  if (!character) throw new ChatEngineError("找不到要生成 WVS 内容的角色。");

  const bindings = loadBindingConfig();
  const slot = resolveBinding(bindings, character.id, "weverse");
  const apiConfig = loadApiConfigs().find((item) => item.id === slot.apiConfigId) ?? loadApiConfigs()[0];
  if (!apiConfig) throw new ChatEngineError(`未给 ${character.name} 配置可用 API。`);

  const presets = loadPresets();
  let preset = slot.presetId ? presets.find((item) => item.id === slot.presetId) ?? null : null;
  if (!preset) preset = presets.find((item) => item.builtIn) ?? null;

  const allWorldBooks = loadWorldBooks();
  const worldBooks = (slot.worldBookIds || []).map((id) => allWorldBooks.find((item) => item.id === id)).filter(Boolean) as WorldBookConfig[];
  const allRegexes = loadRegexes();
  const regexes = (slot.regexIds || []).map((id) => allRegexes.find((item) => item.id === id)).filter(Boolean) as RegexConfig[];

  const userIdentity = resolveUserIdentity(character.id, "weverse");
  const userName = userIdentity?.name || "用户";
  const prepared = prepareShortTermContext(character.id, "weverse", { history: [] });
  const memConfig = loadMemoryConfig();
  const [memories, coreMemories] = await Promise.all([
    retrieveMemoriesForPrompt(character.id, prepared.wbActivationContext, memConfig).catch(() => []),
    retrieveCoreMemoriesForPrompt(character.id, memConfig).catch(() => []),
  ]);

  const scheduleSummary = buildCalendarScheduleMarker("character", character.id, getWeekStartIso(new Date()));
  const messages = assemblePromptPayload({
    character,
    history: [],
    preset,
    worldBooks,
    regexes,
    userIdentity,
    appId: "weverse",
    appTags: ["weverse", "post"],
    longTermMemories: formatLongTermMemories(memories),
    coreMemories: formatCoreMemories(coreMemories),
    scheduleSummary,
    worldBookActivationContext: prepared.wbActivationContext,
    recentBlocks: prepared.recentBlocks,
    unifiedRecentItems: prepared.unifiedRecentItems,
  });

  messages.push({
    role: "system",
    content: [
      `你现在正在使用 Weverse 的「${community.name}」Community。`,
      "这是艺人本人面向整个粉丝社区公开发布的 Artist Post，不是给某个用户的私聊。",
      "内容必须符合人物设定、近期状态、已知公开事件和日程；不要把私人秘密、地下关系、只有私聊对象知道的内容公开说出来。",
      "允许非常日常、短、碎碎念，也允许偶尔写长文。不要每次都像营业文案。",
      "如果自然适合配一张照片，请给 photoDescription；不适合就留空。",
      "必须使用角色本人最自然的语言作为 original；若 original 不是简体中文，同时给出忠实自然的简体中文 translated。若 original 本身就是简体中文，translated 与 original 相同。",
      "只输出 JSON，不要 Markdown。格式：{\"original\":\"...\",\"translated\":\"...\",\"photoDescription\":\"...或空字符串\"}",
    ].join("\n"),
  });
  return { character, apiConfig, preset, regexes, messages, userName };
}

export async function generateWeverseArtistPost(characterId: string, community: WeverseCommunity): Promise<GeneratedWeverseArtistPost> {
  const resolved = await resolveGeneration(characterId, community);
  const raw = await sendLLMRequest(
    resolved.apiConfig,
    resolved.preset,
    [...resolved.messages, { role: "user", content: "现在发一条新的 Weverse Artist Post。" }],
    resolved.regexes,
    { characterName: `Weverse:${resolved.character.name}`, userName: resolved.userName },
    { appId: "weverse", appTags: ["weverse", "post"], skipOutputRegex: true },
  );
  const parsed = extractJsonObject(raw);
  const original = String(parsed?.original ?? "").trim();
  const translated = String(parsed?.translated ?? original).trim() || original;
  const photoDescription = String(parsed?.photoDescription ?? "").trim();
  if (!original && !translated) throw new ChatEngineError("这次没有生成有效 WVS 内容，请重试。");
  return { original: original || translated, translated: translated || original, photoDescription: photoDescription || undefined };
}

function recentCommunityContext(posts: WeversePost[], community: WeverseCommunity): string {
  const recent = posts.filter((post) => post.communityId === community.id).sort((a, b) => b.createdAt - a.createdAt).slice(0, 10);
  if (!recent.length) return "暂无近期帖子。";
  return recent.map((post) => `${post.authorType}: ${post.originalBody || post.body}`).join("\n");
}

async function resolveCommunityApi(community: WeverseCommunity): Promise<{ apiConfig: ApiConfig; preset: PresetConfig | null; regexes: RegexConfig[] }> {
  const firstMemberId = community.memberCharacterIds[0];
  const bindings = loadBindingConfig();
  const slot = resolveBinding(bindings, firstMemberId, "weverse");
  const apiConfig = loadApiConfigs().find((item) => item.id === slot.apiConfigId) ?? loadApiConfigs()[0];
  if (!apiConfig) throw new ChatEngineError("没有可用 API，无法生成社区粉丝内容。");
  const presets = loadPresets();
  let preset = slot.presetId ? presets.find((item) => item.id === slot.presetId) ?? null : null;
  if (!preset) preset = presets.find((item) => item.builtIn) ?? null;
  const allRegexes = loadRegexes();
  const regexes = (slot.regexIds || []).map((id) => allRegexes.find((item) => item.id === id)).filter(Boolean) as RegexConfig[];
  return { apiConfig, preset, regexes };
}

export async function generateWeverseFanBatch(community: WeverseCommunity, posts: WeversePost[]): Promise<{ posts: GeneratedWeverseFanPost[]; comments: GeneratedWeverseFanComment[] }> {
  const resolved = await resolveCommunityApi(community);
  const memberNames = community.memberCharacterIds.map((id) => loadCharacters().find((item) => item.id === id)?.name).filter(Boolean).join("、");
  const messages: LLMMessage[] = [
    {
      role: "system",
      content: [
        "你在模拟一个真实的 Weverse 粉丝社区。",
        `Community：${community.name}`,
        `成员：${memberNames || "未提供"}`,
        "生成少量普通粉丝内容，让社区像有人在使用，但不要每条都极端激动，不要模板化复制。",
        "粉丝昵称要像普通网络昵称；正文用简体中文为主，可自然夹少量韩语/日语饭圈表达。",
        "不要替艺人本人说话，不要编造严重绯闻、违法事件或重大官方消息。",
        `近期社区内容：\n${recentCommunityContext(posts, community)}`,
        "只输出 JSON，不要 Markdown。格式：{\"posts\":[{\"displayName\":\"...\",\"body\":\"...\"},{...}],\"comments\":[{\"displayName\":\"...\",\"body\":\"...\"},{...}]}。posts 生成 2 条，comments 生成 2 条。",
      ].join("\n"),
    },
    { role: "user", content: "生成这一轮粉丝内容。" },
  ];
  const raw = await sendLLMRequest(resolved.apiConfig, resolved.preset, messages, resolved.regexes, { characterName: `Weverse:${community.name}` }, { appId: "weverse", appTags: ["weverse", "fan"], skipOutputRegex: true });
  const parsed = extractJsonObject(raw);
  const normalizeItems = (value: unknown): Array<{ displayName: string; body: string }> => Array.isArray(value)
    ? value.map((item) => ({
        displayName: String((item as Record<string, unknown>)?.displayName ?? "匿名粉丝").trim() || "匿名粉丝",
        body: String((item as Record<string, unknown>)?.body ?? "").trim(),
      })).filter((item) => item.body)
    : [];
  return { posts: normalizeItems(parsed?.posts).slice(0, 2), comments: normalizeItems(parsed?.comments).slice(0, 2) };
}
