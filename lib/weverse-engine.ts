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
import { buildCharacterTimeContext, buildGroupTimeContext, getSystemTimeZone, formatZonedChineseDateTime, getZonedWeekday } from "./character-time";
import { loadPhotoLibrary } from "./photo-library-storage";
import type { WeverseComment, WeverseCommunity, WeversePost, WeverseSettings, WeverseLive, WeverseLiveOrientation } from "./weverse-storage";

export type WeverseMediaIntent = "selfie" | "portrait" | "group" | "food" | "scenery" | "object" | "pet" | "official" | "other";

export type GeneratedWeverseArtistPost = {
  original: string;
  translated: string;
  photoDescription?: string;
  mediaIntent?: WeverseMediaIntent;
};

export type GeneratedWeverseNotice = {
  title: string; original: string; translated: string; photoDescription?: string; mediaIntent?: WeverseMediaIntent; preferredPhotoId?: string;
};

export type GeneratedWeverseOfficialPost = {
  original: string;
  translated: string;
  photoDescription?: string;
  mediaIntent?: WeverseMediaIntent;
  /** 若模型从当前 Official Media Pool 里看中了某张素材，直接返回 photoId。 */
  preferredPhotoId?: string;
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

async function resolveCharacterGeneration(characterId: string, community: WeverseCommunity, options?: { now?: Date; historical?: boolean }): Promise<ResolvedGeneration> {
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
  const historical = options?.historical === true;
  const activationContext = historical ? "" : prepared.wbActivationContext;
  const [memories, coreMemories] = historical ? [[], []] : await Promise.all([
    retrieveMemoriesForPrompt(character.id, activationContext, memConfig).catch(() => []),
    retrieveCoreMemoriesForPrompt(character.id, memConfig).catch(() => []),
  ]);

  const now = options?.now ?? new Date();
  const scheduleSummary = historical ? "" : buildCalendarScheduleMarker("character", character.id, getWeekStartIso(now));
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
    worldBookActivationContext: activationContext,
    recentBlocks: historical ? [] : prepared.recentBlocks,
    unifiedRecentItems: historical ? [] : prepared.unifiedRecentItems,
    timeContext: buildCharacterTimeContext(character.timeZone, now),
  });

  messages.push({
    role: "system",
    content: [
      `你现在正在使用韩国粉丝社区 Weverse 的「${community.name}」Community。`,
      "这是公开社区，不是私聊。你可以知道自己的私人经历与关系，但公开发言时必须自然判断什么能对粉丝说、什么不能说。",
      "不要主动公开地下关系、私人秘密、只在私聊里成立的称呼或对单一对象的私密承诺。",
      "说话方式必须保持本人语言习惯；不要因为平台是韩国 App 就把所有非韩国角色强行写成同一种口吻。",
      "公开内容可以很日常、短、碎碎念，也可以偶尔认真写长文；不要每次都像营业文案。",
      buildCharacterTimeContext(character.timeZone, now).timeContext,
      "时间相关措辞必须符合上面的真实本地时间。除非上下文真的涉及睡觉、深夜、早起，否则不要习惯性写晚安、早点睡、今天结束了、夜宵等强时间段话术。",
      historical ? "这是历史回填：只写目标时间点当时可能公开发生的普通内容，不要引用目标日期之后才发生的近期记忆、行程或关系变化。" : "",
    ].join("\n"),
  });
  return { character, apiConfig, preset, regexes, messages, userName };
}

export async function generateWeverseArtistPost(characterId: string, community: WeverseCommunity, options?: { now?: Date; historical?: boolean }): Promise<GeneratedWeverseArtistPost> {
  const resolved = await resolveCharacterGeneration(characterId, community, options);
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

function communityTimeContext(community: WeverseCommunity, now = new Date()): string {
  const chars = loadCharacters().filter((item) => community.memberCharacterIds.includes(item.id));
  if (chars.length) return buildGroupTimeContext(chars.map((item) => ({ name: item.name, timeZone: item.timeZone })), now).timeContext;
  const zone = getSystemTimeZone();
  return `当前社区参考时间：${formatZonedChineseDateTime(now, zone)} ${zone}，${getZonedWeekday(now, zone)}`;
}

function officialMediaContext(community: WeverseCommunity): string {
  const allowed = new Set(community.officialMediaPhotoIds || []);
  if (!allowed.size) return "当前 Official Media Pool 为空。";
  const rows = loadPhotoLibrary().photos
    .filter((photo) => allowed.has(photo.id))
    .slice(0, 40)
    .map((photo) => {
      const summary = [photo.subject, photo.visionSummary, photo.appearance?.scene, ...(photo.visionTags || [])].filter(Boolean).join(" / ");
      return `${photo.id} | ${summary || "未完成描述的官方素材"}`;
    });
  return rows.length ? `当前 Official Media Pool 可用素材：\n${rows.join("\n")}` : "当前 Official Media Pool 暂无可描述素材。";
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
  options?: { now?: Date; historical?: boolean },
): Promise<GeneratedWeverseOfficialPost> {
  const resolved = await resolveCommunityApi(community);
  const now = options?.now ?? new Date();
  const contextPosts = options?.historical ? posts.filter((post) => post.createdAt <= now.getTime()) : posts;
  const messages: LLMMessage[] = [
    {
      role: "system",
      content: [
        `你正在运营 Weverse 的「${community.name}」Official Account：${community.official.displayName}。`,
        community.official.bio ? `官号简介：${community.official.bio}` : "",
        "这是公开官方账号，不是某个成员本人。不要读取、暗示或泄露任何成员私聊、私人关系、地下恋或非公开记忆。",
        "本轮生成一条自然的 Official Post。它是社交动态，不是正式 Notice：可以是公开问候、幕后/现场图片分享、活动宣传短文、活动后的感谢等。正式规则、参与说明、长篇通知应交给 Notice，不要在这里写成公告格式。不要凭空宣布回归、演唱会、获奖、事故等重大事实。",
        "韩国 Weverse 社区默认以自然韩语作为 original；若社区语境明显更适合其他语言可以调整。始终同时提供简体中文 translated。",
        communityTimeContext(community, now),
        "时间相关措辞必须符合当前参考时间；除非内容真的涉及睡觉/深夜/早起，否则不要无缘无故写晚安、早点睡、夜宵等。",
        options?.historical ? "这是历史回填。内容必须像目标日期当时已经存在的普通公开记录，不要借用未来才发生的事件。" : "",
        officialMediaContext(community),
        options?.historical ? "历史回填时，只有当媒体池素材描述明确适合目标日期/旧内容时才使用 preferredPhotoId；不要把明显属于现在的素材倒灌到过去。" : "",
        "如果适合配图，给出 photoDescription，并用 mediaIntent 标记：group / portrait / food / scenery / object / pet / official / other。若上面的 Official Media Pool 有自然吻合的素材，优先围绕其中一张发带图内容并把 preferredPhotoId 填成真实 photoId。Official Post 可以纯文字，但不要为了用图硬写帖子，也不要长期无视已经存在的媒体池。",
        `近期公开社区内容：\n${recentCommunityContext(contextPosts, community)}`,
        "只输出 JSON，不要 Markdown。格式：{\"original\":\"...\",\"translated\":\"...\",\"photoDescription\":\"...或空\",\"mediaIntent\":\"official等或空\",\"preferredPhotoId\":\"photoId或空\"}",
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
  const preferredPhotoId = String(parsed?.preferredPhotoId ?? "").trim();
  if (!original && !translated) throw new ChatEngineError("这次没有生成有效 Official 内容，请重试。");
  return {
    original: original || translated,
    translated: translated || original,
    photoDescription: photoDescription || undefined,
    mediaIntent: photoDescription ? mediaIntent || "official" : undefined,
    preferredPhotoId: preferredPhotoId && (community.officialMediaPhotoIds || []).includes(preferredPhotoId) ? preferredPhotoId : undefined,
  };
}


export async function generateWeverseOfficialNotice(
  community: WeverseCommunity,
  contextPosts: WeversePost[],
  options?: { now?: Date; historical?: boolean },
): Promise<GeneratedWeverseNotice> {
  const resolved = await resolveCommunityApi(community);
  const now = options?.now ?? new Date();
  const messages: LLMMessage[] = [
    {
      role: "system",
      content: [
        `你正在运营 Weverse 的「${community.name}」官方公告（Notice）系统。`,
        `Official Account：${community.official.displayName}`,
        "Notice 不是普通社交动态。它用于正式说明公开事项，必须有清晰标题和完整信息，语气正式、克制、事实优先。",
        "不要写成社交媒体碎碎念，不要用‘大家今天也辛苦啦’之类互动口吻；不要添加评论区邀请。",
        "可以是公开活动说明、运营通知、公开日程提醒、规则/参与方式、纪念日说明等；不要凭空捏造严重事件或高风险事实。",
        "韩国 Weverse 社区默认以自然韩语作为 original；同时提供简体中文 translated。",
        communityTimeContext(community, now),
        options?.historical ? "这是历史回填：内容必须符合目标日期，不引用未来事件。" : "",
        officialMediaContext(community),
        "如公告天然需要海报/专辑图/活动图，可提供 photoDescription 和 preferredPhotoId；不需要配图则留空。",
        `近期公开社区内容：\n${recentCommunityContext(contextPosts, community)}`,
        "只输出 JSON，不要 Markdown。格式：{\"title\":\"...\",\"original\":\"...\",\"translated\":\"...\",\"photoDescription\":\"...或空\",\"mediaIntent\":\"official等或空\",\"preferredPhotoId\":\"photoId或空\"}",
      ].filter(Boolean).join("\n"),
    },
    { role: "user", content: "现在生成一条正式 Weverse Notice。" },
  ];
  const raw = await sendLLMRequest(resolved.apiConfig, resolved.preset, messages, resolved.regexes, { characterName: `Weverse Notice:${community.name}` }, { appId: "weverse", appTags: ["weverse", "official-notice"], skipOutputRegex: true });
  const parsed = extractJsonObject(raw);
  const title = String(parsed?.title ?? "").trim();
  const original = String(parsed?.original ?? "").trim();
  const translated = String(parsed?.translated ?? original).trim() || original;
  const photoDescription = String(parsed?.photoDescription ?? "").trim();
  const mediaIntent = parseMediaIntent(parsed?.mediaIntent);
  const preferredPhotoId = String(parsed?.preferredPhotoId ?? "").trim();
  if (!title || (!original && !translated)) throw new ChatEngineError("这次没有生成有效 Notice，请重试。");
  return { title, original: original || translated, translated: translated || original, photoDescription: photoDescription || undefined, mediaIntent: photoDescription ? mediaIntent || "official" : undefined, preferredPhotoId: preferredPhotoId && (community.officialMediaPhotoIds || []).includes(preferredPhotoId) ? preferredPhotoId : undefined };
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
  options?: { activity?: WeverseSettings["fanActivity"]; includePosts?: boolean; targetPost?: WeversePost; now?: Date; historical?: boolean },
): Promise<{ posts: GeneratedWeverseFanPost[]; comments: GeneratedWeverseFanComment[] }> {
  const resolved = await resolveCommunityApi(community);
  const memberNames = community.memberCharacterIds.map((id) => loadCharacters().find((item) => item.id === id)?.name).filter(Boolean).join("、");
  const counts = activityCounts(options?.activity || "normal");
  const includePosts = options?.includePosts !== false;
  const targetPost = options?.targetPost;
  const now = options?.now ?? new Date();
  const contextPosts = options?.historical ? posts.filter((post) => post.createdAt <= now.getTime()) : posts;
  const messages: LLMMessage[] = [
    {
      role: "system",
      content: [
        "你在模拟一个真实的 Weverse 粉丝社区里的普通粉丝，不扮演艺人本人。",
        `Community：${community.name}`,
        `成员：${memberNames || "未提供"}`,
        ...fanLanguageRules(),
        communityTimeContext(community, now),
        "不要把整批粉丝都写成同一时间段的口吻。除非目标帖子/评论明确涉及睡觉或深夜，否则不要集体说晚安、早点睡、快去睡等。",
        options?.historical ? "这是历史回填：请写成目标日期当时的公开粉丝内容，不要引用未来事件。" : "",
        "粉丝昵称要像真实网络昵称，可用韩文、拉丁字母、少量日文/中文；不要全部叫匿名粉丝。",
        "内容要有轻重差异：有人认真，有人只留一句，有人聊造型/舞台/吃饭/天气，也可以粉丝之间互相接话。不要模板化复制。",
        "不要编造严重绯闻、违法事件或重大官方消息，不要替艺人本人宣布未发生的官方事项。",
        `近期社区内容：\n${recentCommunityContext(contextPosts, community)}`,
        targetPost ? `本轮主要给这条帖子增加互动：\n${targetPost.id} | ${targetPost.authorType}: ${targetPost.originalBody || targetPost.body}` : "",
        targetPost ? `现有评论（replyToId 只能引用这里真实存在的评论 id，或留空）：\n${commentContext(targetPost)}` : "",
        includePosts ? `posts 生成 ${counts.postRange} 条；如果这轮没有自然的新粉丝帖，可以为 0。` : "posts 必须为空数组。",
        targetPost ? `comments 生成 ${counts.commentRange} 条，允许为 0。默认大多数（至少约 70%）必须是独立顶级评论；只允许少量自然的粉丝互回小楼。不要把本批后续评论全部挂到第一条下面。艺人回复由另一个角色模型处理。` : "comments 必须为空数组；没有指定目标帖子时，本轮只负责生成 Fan Post。",
        "若某条新评论确实需要回复本批前面已经生成的评论，可填 replyToIndex；若回复既有评论则填 replyToId；否则必须留空作为顶级评论。连续多条指向同一个 parent 是不自然的，应避免。",
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
  options?: { now?: Date; historical?: boolean },
): Promise<GeneratedWeverseArtistReply | null> {
  const resolved = await resolveCharacterGeneration(characterId, community, options);
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


export type GeneratedWeverseLiveSegment = {
  kind: "speech" | "action";
  original: string;
  translated?: string;
};

export type GeneratedWeverseLiveComment = {
  displayName: string;
  original: string;
  translated: string;
};

export type GeneratedWeverseLiveRound = {
  title?: string;
  segments: GeneratedWeverseLiveSegment[];
  comments: GeneratedWeverseLiveComment[];
  shouldEnd: boolean;
  endingReason?: string;
};

function normalizeLiveSegments(value: unknown): GeneratedWeverseLiveSegment[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const item = raw as Record<string, unknown>;
    const kind: "speech" | "action" = String(item.kind || "").toLowerCase() === "action" ? "action" : "speech";
    const original = String(item.original ?? item.text ?? "").trim();
    const translated = String(item.translated ?? "").trim();
    if (!original) return [];
    return [{ kind, original, translated: kind === "speech" && translated && translated !== original ? translated : undefined }];
  }).slice(0, 8);
}

function normalizeLiveComments(value: unknown): GeneratedWeverseLiveComment[] {
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
    }];
  }).slice(0, 18);
}

function liveTranscriptContext(live: WeverseLive): string {
  const segments = live.segments.slice(-14).map((segment) => {
    const kind = segment.kind === "action" ? "动作" : segment.kind === "system" ? "系统" : "角色";
    return `${kind}: ${segment.original}${segment.translated ? ` / ${segment.translated}` : ""}`;
  });
  const comments = live.comments.slice(-20).map((comment) => `${comment.authorType === "user" ? "用户" : comment.authorName}: ${comment.originalBody || comment.body}`);
  return [segments.length ? `最近直播内容：\n${segments.join("\n")}` : "", comments.length ? `最近弹幕：\n${comments.join("\n")}` : ""].filter(Boolean).join("\n\n");
}

function liveFormatRules(orientation: WeverseLiveOrientation, opening = false): string[] {
  return [
    "这是 Weverse 的成员私人 LIVE，不是私聊，也不是正式节目主持。角色可以随意聊天、吃饭、推荐歌、等人进来、发呆、准备工作或睡前陪粉丝一会儿。",
    "直播持续多久完全按角色人设与当次情境决定：有人会黏很久，有人活动后台只匆匆播几分钟。不要预设固定轮数。",
    opening
      ? "现在是刚开播阶段。通常先调一下状态、等观众陆续进来、随口说几句；不要一开场就进入高强度问答或大型节目。"
      : "这是直播中途的一小段推进。延续之前的话题与状态，不要像新开一场直播一样重新自我介绍。",
    "角色语言与动作分开输出。speech 使用角色本人最自然的语言；若不是简体中文，同时给出简体中文 translated。action 不是必填：只有角色真的发生了新的动作、姿态变化或环境操作时才输出；若动作没有变化或没有新动作，完全省略 action，禁止为了凑格式硬写。action 使用省略主语的现场描写，不写‘他/她/角色/姓名……’这类第三人称主语，不加括号，只写简体中文、不做双语。例如：伸手碰了碰摄像头把位置架高，拿起冰美式喝了一口。",
    `当前直播画面模板为${orientation === "portrait" ? "竖屏" : "横屏"}。这只影响镜头/动作的自然感，不要描述真实视频文件或画质技术。`,
    "粉丝留言要像真实直播间：在线人数远高于活跃发言人数，观众里可以有核心粉丝、普通关注者和路人。韩语为主，少量日语、英语、中文；不要人人都像资深粉丝。",
    opening
      ? "开场留言以轻松即时反应为主，例如终于开播、爱你、今天好帅/可爱、最近吃什么、是不是瘦了胖了、最近在忙什么等；不要一上来全是深度问题。"
      : "中途留言可以逐渐更具体，但仍要混入很短的感叹、路人式发言、造型/吃饭/近况问题，避免所有评论都像采访提纲。",
    "角色不需要回应每条评论。即使用户发了多条，也可以只看到其中一条、综合回应、完全没看到，或继续自己原本的话题。",
    "不要公开地下关系、私人秘密、只在私聊成立的称呼或单一对象的私密承诺。",
  ];
}

export async function generateWeverseLiveOpening(
  characterId: string,
  community: WeverseCommunity,
  options?: { theme?: string; orientation?: WeverseLiveOrientation; now?: Date },
): Promise<GeneratedWeverseLiveRound> {
  const now = options?.now ?? new Date();
  const orientation = options?.orientation === "portrait" ? "portrait" : "landscape";
  const resolved = await resolveCharacterGeneration(characterId, community, { now });
  const theme = String(options?.theme || "").trim();
  const raw = await sendLLMRequest(
    resolved.apiConfig,
    resolved.preset,
    [
      ...resolved.messages,
      {
        role: "system",
        content: [
          ...liveFormatRules(orientation, true),
          theme ? `用户给了一个软主题：${theme}。这是方向，不是脚本；按人设自然发挥、允许跑题。` : "用户没有指定主题。请结合人设、近期经历、当前时间与状态，自然决定为什么突然开播以及想聊什么。",
          "生成本场直播标题、开场的 3~5 个短 segment（以说话为主；只有确实出现新的动作时才插入 action，不要求动作与说话交错）和 9~14 条初始观众留言。",
          "只输出 JSON，不要 Markdown。格式：{\"title\":\"...\",\"segments\":[{\"kind\":\"action\",\"original\":\"中文动作\"},{\"kind\":\"speech\",\"original\":\"角色原话\",\"translated\":\"中文翻译\"}],\"comments\":[{\"displayName\":\"...\",\"original\":\"...\",\"translated\":\"...\"}],\"shouldEnd\":false}",
        ].join("\n"),
      },
      { role: "user", content: theme ? `现在按这个主题开一场 LIVE：${theme}` : "现在自然地开一场 Weverse LIVE。" },
    ],
    resolved.regexes,
    { characterName: `Weverse LIVE:${resolved.character.name}`, userName: resolved.userName },
    { appId: "weverse", appTags: ["weverse", "live"], skipOutputRegex: true },
  );
  const parsed = extractJsonObject(raw);
  const segments = normalizeLiveSegments(parsed?.segments);
  const comments = normalizeLiveComments(parsed?.comments).slice(0, 14);
  const title = String(parsed?.title ?? "").trim() || `${resolved.character.name} LIVE`;
  if (!segments.length) throw new ChatEngineError("这次没有生成有效 LIVE 开场，请重试。");
  return { title, segments, comments, shouldEnd: false };
}

export async function generateWeverseLiveContinuation(
  characterId: string,
  community: WeverseCommunity,
  live: WeverseLive,
  options?: { userComments?: string[]; now?: Date },
): Promise<GeneratedWeverseLiveRound> {
  const now = options?.now ?? new Date();
  const resolved = await resolveCharacterGeneration(characterId, community, { now });
  const userComments = (options?.userComments || []).map((item) => item.trim()).filter(Boolean).slice(0, 8);
  const raw = await sendLLMRequest(
    resolved.apiConfig,
    resolved.preset,
    [
      ...resolved.messages,
      {
        role: "system",
        content: [
          ...liveFormatRules(live.orientation, false),
          `本场 LIVE 标题：${live.title}`,
          live.theme ? `最初的软主题：${live.theme}` : "本场没有预设主题。",
          `这已经是第 ${Math.max(1, live.roundCount + 1)} 段推进。`,
          liveTranscriptContext(live),
          userComments.length ? `用户刚刚准备发送的多条弹幕如下。它们属于同一个观众，但你不必逐条回应：\n${userComments.map((item, index) => `${index + 1}. ${item}`).join("\n")}` : "用户这一轮没有发弹幕，只是在继续观看。",
          "生成接下来的 2~5 个短 segment 和 7~12 条新观众留言。以说话为主；只有角色确实做了新的动作、改变姿态或操作环境时才生成 action，动作没变就不要写 action。根据角色人设与当前情境判断是否已经自然到收尾时机。若该下播，shouldEnd=true，并让最后的 segment 自然告别；否则 false。",
          "不要因为用户点了继续播放就机械延长；也不要因为已经播了几轮就强制结束。",
          "只输出 JSON，不要 Markdown。格式：{\"segments\":[{\"kind\":\"action\",\"original\":\"中文动作\"},{\"kind\":\"speech\",\"original\":\"角色原话\",\"translated\":\"中文翻译\"}],\"comments\":[{\"displayName\":\"...\",\"original\":\"...\",\"translated\":\"...\"}],\"shouldEnd\":true或false,\"endingReason\":\"可空\"}",
        ].filter(Boolean).join("\n"),
      },
      { role: "user", content: userComments.length ? "把这些弹幕放进直播间并继续这一小段 LIVE。" : "继续播放下一小段 LIVE。" },
    ],
    resolved.regexes,
    { characterName: `Weverse LIVE:${resolved.character.name}`, userName: resolved.userName },
    { appId: "weverse", appTags: ["weverse", "live"], skipOutputRegex: true },
  );
  const parsed = extractJsonObject(raw);
  const segments = normalizeLiveSegments(parsed?.segments);
  const comments = normalizeLiveComments(parsed?.comments).slice(0, 12);
  const shouldEnd = parsed?.shouldEnd === true || String(parsed?.shouldEnd).toLowerCase() === "true";
  const endingReason = String(parsed?.endingReason ?? "").trim() || undefined;
  if (!segments.length && !comments.length) throw new ChatEngineError("这次 LIVE 没有生成新的内容，请重试。");
  return { segments, comments, shouldEnd, endingReason };
}
