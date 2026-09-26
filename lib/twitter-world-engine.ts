import { sendLLMRequest } from "./chat-engine";
import { loadApiConfigs, loadBindingConfig, loadPresets, resolveBinding } from "./settings-storage";
import type { TwitterState, TwitterPost, TwitterCommunityCharacter } from "./twitter-storage";

export type TwitterWorldComment = { name: string; handle: string; original: string; translated?: string };
export type TwitterWorldPost = { name: string; handle: string; original: string; translated?: string; trend?: string; imageDescription?: string; comments: TwitterWorldComment[] };
export type TwitterWorldBatch = { trends: Array<{ label: string; scope: "world" | "region" }>; posts: TwitterWorldPost[] };
export type TwitterStranger = { name: string; handle: string; original: string; translated?: string };

const jsonObject = (raw: string): Record<string, unknown> => {
  const begin = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (begin < 0 || end <= begin) throw new Error("没有收到有效的帖子，请重试。");
  return JSON.parse(raw.slice(begin, end + 1)) as Record<string, unknown>;
};
const asText = (value: unknown, max = 700) => typeof value === "string" ? value.trim().slice(0, max) : "";
const commentsFrom = (value: unknown): TwitterWorldComment[] => Array.isArray(value) ? value.slice(0, 10).flatMap(entry => {
  if (!entry || typeof entry !== "object") return [];
  const row = entry as Record<string, unknown>;
  const original = asText(row.original, 300);
  return original ? [{ name: asText(row.name, 40) || "路人", handle: asText(row.handle, 35), original, translated: asText(row.translated, 300) }] : [];
}) : [];

async function ask(instruction: string): Promise<Record<string, unknown>> {
  const configs = loadApiConfigs();
  const selectedId = resolveBinding(loadBindingConfig(), undefined, "twitter").apiConfigId;
  const config = selectedId ? configs.find(row => row.id === selectedId) : configs.find(row => row.apiKey?.trim()) || configs[0];
  if (!config) throw new Error(selectedId ? "当前绑定的文字 API 已不存在，请检查推特或全局绑定。" : "请先在小手机的全局绑定或推特绑定里设置文字 API，才能刷新内容。");
  if (!config.apiKey?.trim()) throw new Error(`推特当前使用的文字 API「${config.name || config.provider}」没有填写 Key，请在小手机的全局绑定中选择可用配置。`);
  const presets = loadPresets();
  const preset = presets.find(p => p.builtIn) ?? presets[0] ?? null;
  const raw = await sendLLMRequest(config, preset, [
    { role: "system", content: instruction },
    { role: "user", content: "现在生成。只输出 JSON。" },
  ], [], undefined, { appId: "twitter", appTags: ["twitter", "world"], skipOutputRegex: true });
  return jsonObject(raw);
}

export async function generateTwitterWorldBatch(state: TwitterState, hint: string, desiredPosts = 5): Promise<TwitterWorldBatch> {
  const context = state.publicWorldContext.trim().slice(0, 1600);
  const region = state.regionName.trim().slice(0, 70);
  const existing = state.trends.slice(-8).map(t => t.label).join("、");
  const locales = state.audienceLocales?.length ? state.audienceLocales.join("、") : "中文";
  const request = `你为一个纯虚构的推特世界生成生活化动态和虚构趋势。只采用以下明确公开的背景：${context || "普通现代城市的虚构日常"}。用户偏好或搜索目标：${hint.slice(0, 450) || "生活、校园、情感、游戏、都市传闻、艺人日常，内容混合"}。账号语言地区从${locales}中尽量均衡选用，如果六个地区全选则均匀分配。现有趋势：${existing || "无"}。趋势名称必须用中文；不要虚构实时现实新闻、外链或联系方式；除用户明确关联的角色外，不写现实艺人的实际行程；不要凭空确立影响世界观的大事件，不要透露私下关系、角色小号身份。输出 2 至 3 个趋势以及恰好 ${desiredPosts} 条不同虚构路人账号的帖子，每条附 5 至 10 条短评论；搜索或指定话题时每条必须相关。original 是作者使用的语言；外语需准确附简体中文译文；#标签始终沿用原文不翻译。如路人想发照片，用 imageDescription 写出照片画面供文字图片卡片显示；不发图则留空，禁止直接请求生图。JSON: {"trends":[{"label":"中文趋势","scope":"world"}],"posts":[{"name":"昵称","handle":"英文账号","original":"帖子","translated":"中文译文","trend":"趋势名称或空字符串","imageDescription":"可留空的图片描述","comments":[{"name":"昵称","handle":"英文账号","original":"评论","translated":"中文译文"}]}]}。`;
  const row = await ask(request);
  const proposedTrends = Array.isArray(row.trends) ? row.trends.slice(0, 4).flatMap(item => {
    const trend = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const label = asText(trend.label, 64);
    return label ? [{ label, scope: trend.scope === "region" && region ? "region" as const : "world" as const }] : [];
  }) : [];
  const posts = Array.isArray(row.posts) ? row.posts.slice(0, Math.max(1, desiredPosts)).flatMap(item => {
    if (!item || typeof item !== "object") return [];
    const post = item as Record<string, unknown>;
    const original = asText(post.original, 850);
    return original ? [{ name: asText(post.name, 40) || "路人", handle: asText(post.handle, 35), original, translated: asText(post.translated, 850), trend: asText(post.trend, 64), imageDescription: asText(post.imageDescription, 350), comments: commentsFrom(post.comments) }] : [];
  }) : [];
  if (!posts.length) throw new Error("这次没有生成有效帖子，请重试。");
  const trends = proposedTrends.filter(t => posts.some(p => p.trend === t.label));
  return { trends, posts };
}

export async function generateTwitterTrends(state: TwitterState): Promise<string[]> {
  const row = await ask(`按纯虚构世界的公开背景生成恰好五条中文热门话题标题。背景：${state.publicWorldContext.slice(0, 1300) || "现代虚构世界的日常"}。不区分世界或地区。可涉及生活、娱乐、校园、游戏、情感、都市传闻；标题用中文，不必翻译贴文中的标签。禁止假称掌握现实实时新闻、私密关系、人物副账号身份。只输出 JSON：{"trends":["话题一","话题二","话题三","话题四","话题五"]}。`);
  const labels = Array.isArray(row.trends) ? row.trends.map(item => asText(typeof item === "object" && item !== null ? (item as Record<string, unknown>).label : item, 64)).filter(Boolean).slice(0, 5) : [];
  if (new Set(labels).size !== 5 || labels.some(label => !/[\u3400-\u9fff]/.test(label))) throw new Error("这次没有生成五条不同的中文热门话题，请重试。");
  return labels;
}

export async function generateTwitterStrangerDms(state: TwitterState, userAccountId = "user"): Promise<TwitterStranger[]> {
  const profile = userAccountId === "user" ? state.profile : state.accounts[userAccountId] || state.profile;
  const visible = state.posts.filter(p => p.authorId === userAccountId && profile.visibility !== "protected" && (!p.replyToId || state.posts.some(parent => parent.id === p.replyToId))).slice(-12).map(p => p.original.slice(0, 170)).join("；");
  const row = await ask(`生成 2 至 4 位互不相同的虚构陌生人在推特上给用户发来的第一条私信。只能根据以下公开信息，不得引用私信、隐私设定、未公开感情关系或大小号归属。公开主页：${profile.name.slice(0, 60)}；${profile.bio.slice(0, 350)}。公开动态或互动：${visible.slice(0, 1000) || "暂无"}。世界公开背景：${state.publicWorldContext.slice(0, 550)}。内容要各不相同，自然简短，不含真实新闻、外链、联系方式。外语需附准确中文译文，原文中文时译文相同。只输出 JSON：{"messages":[{"name":"虚构昵称","handle":"账号名","original":"原文","translated":"中文译文"}]}。`);
  const messages = Array.isArray(row.messages) ? row.messages.slice(0, 4).flatMap(item => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const original = asText(row.original, 300);
    return original ? [{ name: asText(row.name, 45) || "陌生人", handle: asText(row.handle, 40), original, translated: asText(row.translated, 300) }] : [];
  }) : [];
  if (!messages.length) throw new Error("这次没有生成有效私信，请重试。");
  return messages;
}

export async function generateTwitterStrangerReply(state: TwitterState, accountName: string, messages: Array<{ role: "user" | "character"; original: string }>, userAccountId = "user"): Promise<{ original: string; translated?: string }> {
  const history = messages.slice(-14).map(message => `${message.role === "user" ? (userAccountId === "user" ? state.profile.name : state.accounts[userAccountId]?.name || "用户") : accountName}：${message.original.slice(0, 350)}`).join("\n");
  const row = await ask(`你是虚构社交平台上的普通账号“${accountName.slice(0, 60)}”，正与用户私信。公开世界背景：${state.publicWorldContext.slice(0, 650)}。只依据本对话，不知道用户的隐私、小号身份或私人关系。自然回复最近一条消息。原文非中文时给准确中文译文。对话：\n${history}\n只输出 JSON：{"original":"回复原文","translated":"中文译文"}。`);
  const original = asText(row.original, 500);
  if (!original) throw new Error("这次没有收到有效回复，请重试。");
  return { original, translated: asText(row.translated, 500) };
}

export async function translateTwitterLegacy(entries: Array<{ id: string; original: string }>): Promise<Map<string, string>> {
  const row = await ask(`仅将下面这些社交帖子或私信原文翻译成自然的简体中文。保留表情、段落和专有名词，#话题标签不翻译。严格对应 id，不能编写新内容。数据：${JSON.stringify(entries.map(entry => ({ id: entry.id, original: entry.original.slice(0, 950) })))}。只输出 JSON：{"items":[{"id":"原 id","translated":"准确中文译文"}]}。`);
  const allowed = new Set(entries.map(entry => entry.id));
  const items = new Map<string, string>();
  if (Array.isArray(row.items)) for (const item of row.items) {
    if (!item || typeof item !== "object") continue;
    const entry = item as Record<string, unknown>;
    if (typeof entry.id === "string" && allowed.has(entry.id)) {
      const translation = asText(entry.translated, 1200);
      if (translation) items.set(entry.id, translation);
    }
  }
  if (!items.size) throw new Error("旧内容没有收到有效译文，请重试。");
  return items;
}

export async function generateTwitterComments(state: TwitterState, post: TwitterPost, author: string, previous: string[]): Promise<TwitterWorldComment[]> {
  const request = `请给以下虚构社交平台帖子生成 5 至 10 条新的自然路人评论。帖子作者：${author}。帖子内容：“${post.original.slice(0, 800)}”。既有评论：“${previous.slice(-15).join("；").slice(0, 1300)}”。世界公开背景：${state.publicWorldContext.slice(0, 1000)}。禁止真实时事与现实新闻、外链、曝光私密关系或角色主副账号之间的幕后联系。角色为副账号时，仅按该账号公开表现理解其身份。不要复述既有评论或已被删除的评论。原文可用自然的交流语言，外语另给中文译文。只输出 JSON：{"comments":[{"name":"虚构昵称","handle":"英文账号","original":"评论原文","translated":"中文译文"}]}。`;
  const row = await ask(request);
  const comments = commentsFrom(row.comments);
  if (!comments.length) throw new Error("本次没有生成评论，请重试。");
  return comments;
}

/** 社群内专属角色只读取本平台人设，不拥有小手机的私密跨 APP 记忆。 */
export async function generateTwitterCommunityText(state: TwitterState, character: TwitterCommunityCharacter, kind: "post" | "reply" | "dm", context: string): Promise<{ original: string; translated?: string }> {
  const row = await ask(`你是虚构社交平台中的账号 @${character.handle}，昵称「${character.name}」。公开简介：${character.bio}。你的独立人设：${character.persona}。世界公开背景：${state.publicWorldContext.slice(0, 650)}。这次要${kind === "post" ? "发一条日常帖子" : kind === "reply" ? "回复一条公开贴文" : "回复一条私信"}。上下文：${context.slice(0, 1200)}。不要知道账号未公开的归属关系，不要冒用其他角色人设。原文非中文时附准确中文译文。只输出 JSON：{"original":"内容原文","translated":"中文译文"}。`);
  const original = asText(row.original, 700);
  if (!original) throw new Error("社群角色没有生成有效内容，请重试。");
  return { original, translated: asText(row.translated, 700) };
}

export async function generateTwitterDelayedReply(state: TwitterState, target: TwitterPost, comment: TwitterPost, author: string): Promise<{ original: string; translated?: string } | null> {
  const row = await ask(`在虚构社交平台里，账号「${author}」发了帖子「${target.original.slice(0, 500)}」，用户留言「${comment.original.slice(0, 400)}」。根据内容与时机决定：作者或该帖下路人是否自然回复这条用户评论；不是每条留言都应收到回应。只使用公开信息，不知道用户或角色副账号的隐藏身份。如果无人回复输出 {"reply":false}；如有回复输出 {"reply":true,"name":"回复者昵称","handle":"账号名","original":"回复原文","translated":"中文译文"}。`);
  if (row.reply !== true) return null;
  const original = asText(row.original, 320);
  return original ? { original, translated: asText(row.translated, 320) } : null;
}
