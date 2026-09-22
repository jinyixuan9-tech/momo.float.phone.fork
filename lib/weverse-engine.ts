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
import type { WeverseComment, WeverseCommunity, WeversePost, WeverseSettings } from "./weverse-storage";

export type WeverseMediaIntent = "selfie" | "portrait" | "group" | "food" | "scenery" | "object" | "pet" | "official" | "other";

export type GeneratedWeverseArtistPost = {
  original: string;
  translated: string;
  photoDescription?: string;
  mediaIntent?: WeverseMediaIntent;
};

export type GeneratedWeverseOfficialPost = {
  original: string;
  translated: string;
  photoDescription?: string;
  mediaIntent?: WeverseMediaIntent;
};

export type GeneratedWeverseFanPost = {
  displayName: string;
  original: string;
  translated: string;
};

export type GeneratedWeverseFanComment = {
  displayName: string;
  original: string;
  translated: string;
  /** 回复既有评论。 */
  replyToId?: string;
  /** 也可回复“本批前面已经生成的评论”，0-based。 */
  replyToIndex?: number;
};

export type GeneratedWeverseArtistReply = {
  original: string;
  translated: string;
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

function parseMediaIntent(value: unknown): WeverseMediaIntent | undefined {
  const text = String(value ?? "").trim().toLowerCase();
  return ["selfie", "portrait", "group", "food", "scenery", "object", "pet", "official", "other"].includes(text)
    ? text as WeverseMediaIntent
    : undefined;
}

async function resolveCharacterGeneration(characterId: string, community: WeverseCommunity): Promise<ResolvedGeneration> {
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
    appTags: ["weverse", "public-community"],
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
      `你现在正在使用韩国粉丝社区 Weverse 的「${community.name}」Community。`,
      "这是公开社区，不是私聊。你可以知道自己的私人经历与关系，但公开发言时必须自然判断什么能对粉丝说、什么不能说。",
      "不要主动公开地下关系、私人秘密、只在私聊里成立的称呼或对单一对象的私密承诺。",
      "说话方式必须保持本人语言习惯；不要因为平台是韩国 App 就把所有非韩国角色强行写成同一种口吻。",
      "公开内容可以很日常、短、碎碎念，也可以偶尔认真写长文；不要每次都像营业文案。",
    ].join("\n"),
  });
  return { character, apiConfig, preset, regexes, messages, userName };
}

export async function generateWeverseArtistPost(characterId: string, community: WeverseCommunity): Promise<GeneratedWeverseArtistPost> {
  const resolved = await resolveCharacterGeneration(characterId, community);
  const prompt: LLMMessage[] = [
    ...resolved.messages,
    {
      role: "system",
      content: [
        "现在生成一条新的 Artist Post。",
        "如果自然适合配图，给出 photoDescription，并用 mediaIntent 标记想发的图是什么：selfie / portrait / group / food / scenery / object / pet / other。若不需要配图，photoDescription 与 mediaIntent 留空。",
        "mediaIntent 只表达内容意图，不决定相册还是生图；图片来源由宿主 Media Resolver 决定。",
        "必须使用角色本人最自然的语言作为 original；若 original 不是简体中文，同时给出忠实自然的简体中文 translated；若 original 本身就是简体中文，两者相同。",
        "只输出 JSON，不要 Markdown。格式：{\"original\":\"...\",\"translated\":\"...\",\"photoDescription\":\"...或空\",\"mediaIntent\":\"selfie等或空\"}",
      ].join("\n"),
    },
    { role: "user", content: "现在发一条新的 Weverse Artist Post。" },
  ];
  const raw = await sendLLMRequest(
    resolved.apiConfig,
    resolved.preset,
    prompt,
    resolved.regexes,
    { characterName: `Weverse:${resolved.character.name}`, userName: resolved.userName },
    { appId: "weverse", appTags: ["weverse", "post"], skipOutputRegex: true },
  );
  const parsed = extractJsonObject(raw);
  const original = String(parsed?.original ?? "").trim();
  const translated = String(parsed?.translated ?? original).trim() || original;
  const photoDescription = String(parsed?.photoDescription ?? "").trim();
  const mediaIntent = parseMediaIntent(parsed?.mediaIntent);
  if (!original && !translated) throw new ChatEngineError("这次没有生成有效 WVS 内容，请重试。");
  return {
    original: original || translated,
    translated: translated || original,
    photoDescription: photoDescription || undefined,
    mediaIntent: photoDescription ? mediaIntent || "other" : undefined,
  };
}

function recentCommunityContext(posts: WeversePost[], community: WeverseCommunity): string {
  const recent = posts.filter((post) => post.communityId === community.id).sort((a, b) => b.createdAt - a.createdAt).slice(0, 12);
  if (!recent.length) return "暂无近期帖子。";
  return recent.map((post) => `${post.id} | ${post.authorType}: ${post.originalBody || post.body}`).join("\n");
}

function commentContext(post: WeversePost): string {
  const comments = post.comments.filter((comment) => !comment.deleted).slice(-30);
  if (!comments.length) return "暂无评论。";
  return comments.map((comment) => `${comment.id} | ${comment.authorType} | ${comment.authorName || comment.authorId}: ${comment.originalBody || comment.body}${comment.parentId ? ` | replyTo=${comment.parentId}` : ""}`).join("\n");
}

async function resolveCommunityApi(community: WeverseCommunity): Promise<{ apiConfig: ApiConfig; preset: PresetConfig | null; regexes: RegexConfig[] }> {
  const firstMemberId = community.memberCharacterIds[0];
  const bindings = loadBindingConfig();
  const slot = firstMemberId ? resolveBinding(bindings, firstMemberId, "weverse") : undefined;
  const apiConfig = loadApiConfigs().find((item) => item.id === slot?.apiConfigId) ?? loadApiConfigs()[0];
  if (!apiConfig) throw new ChatEngineError("没有可用 API，无法生成社区粉丝内容。");
  const presets = loadPresets();
  let preset = slot?.presetId ? presets.find((item) => item.id === slot.presetId) ?? null : null;
  if (!preset) preset = presets.find((item) => item.builtIn) ?? null;
  const allRegexes = loadRegexes();
  const regexes = (slot?.regexIds || []).map((id) => allRegexes.find((item) => item.id === id)).filter(Boolean) as RegexConfig[];
  return { apiConfig, preset, regexes };
}

export async function generateWeverseOfficialPost(
  community: WeverseCommunity,
  posts: WeversePost[],
): Promise<GeneratedWeverseOfficialPost> {
  const resolved = await resolveCommunityApi(community);
  const messages: LLMMessage[] = [
    {
      role: "system",
      content: [
        `你正在运营 Weverse 的「${community.name}」Official Account：${community.official.displayName}。`,
        community.official.bio ? `官号简介：${community.official.bio}` : "",
        "这是公开官方账号，不是某个成员本人。不要读取、暗示或泄露任何成员私聊、私人关系、地下恋或非公开记忆。",
        "本轮生成一条自然的 Official Post。可以是轻量公告、公开问候、幕后/现场图片分享、活动后的感谢等，但不要凭空宣布回归、演唱会、获奖、事故等重大事实。",
        "韩国 Weverse 社区默认以自然韩语作为 original；若社区语境明显更适合其他语言可以调整。始终同时提供简体中文 translated。",
        "如果适合配图，给出 photoDescription，并用 mediaIntent 标记：group / portrait / food / scenery / object / pet / official / other。媒体来源不要由你决定，宿主会先查官号素材池再决定是否生图。",
        `近期公开社区内容：\n${recentCommunityContext(posts, community)}`,
        "只输出 JSON，不要 Markdown。格式：{\"original\":\"...\",\"translated\":\"...\",\"photoDescription\":\"...或空\",\"mediaIntent\":\"official等或空\"}",
      ].filter(Boolean).join("\n"),
    },
    { role: "user", content: "现在发布一条新的 Official Post。" },
  ];
  const raw = await sendLLMRequest(
    resolved.apiConfig,
    resolved.preset,
    messages,
    resolved.regexes,
    { characterName: `Weverse Official:${community.name}` },
    { appId: "weverse", appTags: ["weverse", "official-post"], skipOutputRegex: true },
  );
  const parsed = extractJsonObject(raw);
  const original = String(parsed?.original ?? "").trim();
  const translated = String(parsed?.translated ?? original).trim() || original;
  const photoDescription = String(parsed?.photoDescription ?? "").trim();
  const mediaIntent = parseMediaIntent(parsed?.mediaIntent);
  if (!original && !translated) throw new ChatEngineError("这次没有生成有效 Official 内容，请重试。");
  return {
    original: original || translated,
    translated: translated || original,
    photoDescription: photoDescription || undefined,
    mediaIntent: photoDescription ? mediaIntent || "official" : undefined,
  };
}

function fanLanguageRules(): string[] {
  return [
    "这是韩国艺人粉丝社区：普通粉丝动态与评论必须明显以韩语为主。大约 75%~90% 的内容使用自然韩语。",
    "剩余内容可以少量出现日语、英语、简体中文或混合表达，用来模拟海外粉丝；不要平均分配，也不要每批强行凑齐四种语言。",
    "不要把简体中文当默认粉丝语言。韩语饭圈表达可以自然出现，但不要每条都堆网络梗。",
    "每条内容都输出 original 与简体中文 translated；若 original 本身是简体中文，则 translated 与 original 相同。",
  ];
}

function normalizeBilingualItems(value: unknown): Array<{ displayName: string; original: string; translated: string; replyToId?: string; replyToIndex?: number }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const item = raw as Record<string, unknown>;
    const original = String(item.original ?? item.body ?? "").trim();
    const translated = String(item.translated ?? original).trim() || original;
    if (!original && !translated) return [];
    return [{
      displayName: String(item.displayName ?? "익명팬").trim() || "익명팬",
      original: original || translated,
      translated: translated || original,
      replyToId: String(item.replyToId ?? "").trim() || undefined,
      replyToIndex: Number.isInteger(Number(item.replyToIndex)) && Number(item.replyToIndex) >= 0 ? Number(item.replyToIndex) : undefined,
    }];
  });
}

function activityCounts(activity: WeverseSettings["fanActivity"]): { postRange: string; commentRange: string; maxPosts: number; maxComments: number } {
  if (activity === "quiet") return { postRange: "0~1", commentRange: "0~2", maxPosts: 1, maxComments: 2 };
  if (activity === "lively") return { postRange: "2~4", commentRange: "3~7", maxPosts: 4, maxComments: 7 };
  return { postRange: "1~3", commentRange: "1~5", maxPosts: 3, maxComments: 5 };
}

export async function generateWeverseFanBatch(
  community: WeverseCommunity,
  posts: WeversePost[],
  options?: { activity?: WeverseSettings["fanActivity"]; includePosts?: boolean; targetPost?: WeversePost },
): Promise<{ posts: GeneratedWeverseFanPost[]; comments: GeneratedWeverseFanComment[] }> {
  const resolved = await resolveCommunityApi(community);
  const memberNames = community.memberCharacterIds.map((id) => loadCharacters().find((item) => item.id === id)?.name).filter(Boolean).join("、");
  const counts = activityCounts(options?.activity || "normal");
  const includePosts = options?.includePosts !== false;
  const targetPost = options?.targetPost;
  const messages: LLMMessage[] = [
    {
      role: "system",
      content: [
        "你在模拟一个真实的 Weverse 粉丝社区里的普通粉丝，不扮演艺人本人。",
        `Community：${community.name}`,
        `成员：${memberNames || "未提供"}`,
        ...fanLanguageRules(),
        "粉丝昵称要像真实网络昵称，可用韩文、拉丁字母、少量日文/中文；不要全部叫匿名粉丝。",
        "内容要有轻重差异：有人认真，有人只留一句，有人聊造型/舞台/吃饭/天气，也可以粉丝之间互相接话。不要模板化复制。",
        "不要编造严重绯闻、违法事件或重大官方消息，不要替艺人本人宣布未发生的官方事项。",
        `近期社区内容：\n${recentCommunityContext(posts, community)}`,
        targetPost ? `本轮主要给这条帖子增加互动：\n${targetPost.id} | ${targetPost.authorType}: ${targetPost.originalBody || targetPost.body}` : "",
        targetPost ? `现有评论（replyToId 只能引用这里真实存在的评论 id，或留空）：\n${commentContext(targetPost)}` : "",
        includePosts ? `posts 生成 ${counts.postRange} 条；如果这轮没有自然的新粉丝帖，可以为 0。` : "posts 必须为空数组。",
        targetPost ? `comments 生成 ${counts.commentRange} 条，允许为 0；可以回复现有粉丝/用户/艺人评论，也允许粉丝互相接话。不要假装每次艺人都会回复，艺人回复由另一个角色模型处理。` : `comments 生成 0~${counts.maxComments} 条，围绕近期 Artist Post 即可。`,
        "若某条新评论要回复本批前面已经生成的评论，可填 replyToIndex（从 0 开始，只能指向自己前面的项）；若回复既有评论则填 replyToId；两者都不填就是顶级评论。",
        "只输出 JSON，不要 Markdown。格式：{\"posts\":[{\"displayName\":\"...\",\"original\":\"...\",\"translated\":\"...\"}],\"comments\":[{\"displayName\":\"...\",\"original\":\"...\",\"translated\":\"...\",\"replyToId\":\"现有评论id或空\",\"replyToIndex\":null或前面评论序号}]}。",
      ].filter(Boolean).join("\n"),
    },
    { role: "user", content: targetPost ? "给这条帖子追加一批自然的粉丝评论。" : "生成这一轮自然的粉丝社区内容。" },
  ];
  const raw = await sendLLMRequest(resolved.apiConfig, resolved.preset, messages, resolved.regexes, { characterName: `Weverse:${community.name}` }, { appId: "weverse", appTags: ["weverse", "fan"], skipOutputRegex: true });
  const parsed = extractJsonObject(raw);
  const fanPosts = normalizeBilingualItems(parsed?.posts).slice(0, counts.maxPosts).map(({ displayName, original, translated }) => ({ displayName, original, translated }));
  const allowedReplyIds = new Set(targetPost?.comments.map((comment) => comment.id) || []);
  const comments = normalizeBilingualItems(parsed?.comments).slice(0, counts.maxComments).map((item) => ({
    displayName: item.displayName,
    original: item.original,
    translated: item.translated,
    replyToId: item.replyToId && allowedReplyIds.has(item.replyToId) ? item.replyToId : undefined,
    replyToIndex: item.replyToIndex,
  }));
  return { posts: fanPosts, comments };
}

export async function generateWeverseArtistReply(
  characterId: string,
  community: WeverseCommunity,
  post: WeversePost,
  targetComment: WeverseComment,
): Promise<GeneratedWeverseArtistReply | null> {
  const resolved = await resolveCharacterGeneration(characterId, community);
  const authorLabel = targetComment.authorType === "user" ? "这个用户" : targetComment.authorName || "一位粉丝";
  const raw = await sendLLMRequest(
    resolved.apiConfig,
    resolved.preset,
    [
      ...resolved.messages,
      {
        role: "system",
        content: [
          "现在判断你会不会在公开 Weverse 评论区回复下面这条评论。",
          "回复不是义务。若按你的性格、当前状态、帖子语境并不想回，输出 reply=false；不要为了互动率强行回复。",
          "如果回复，必须像本人真正会打出来的一小段公开评论，可短可玩笑，不要写旁白或动作。",
          "使用你本人自然语言作为 original；若不是简体中文，提供简体中文 translated。",
          "只输出 JSON：{\"reply\":true或false,\"original\":\"...\",\"translated\":\"...\"}",
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          `帖子：${post.originalBody || post.body}`,
          `${authorLabel}的评论：${targetComment.originalBody || targetComment.body}`,
        ].join("\n"),
      },
    ],
    resolved.regexes,
    { characterName: `Weverse:${resolved.character.name}`, userName: resolved.userName },
    { appId: "weverse", appTags: ["weverse", "comment-reply"], skipOutputRegex: true },
  );
  const parsed = extractJsonObject(raw);
  if (parsed?.reply === false || String(parsed?.reply).toLowerCase() === "false") return null;
  const original = String(parsed?.original ?? "").trim();
  const translated = String(parsed?.translated ?? original).trim() || original;
  if (!original && !translated) return null;
  return { original: original || translated, translated: translated || original };
}
