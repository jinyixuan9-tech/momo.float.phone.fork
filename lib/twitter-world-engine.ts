import { sendLLMRequest } from "./chat-engine";
import { loadApiConfigs, loadPresets } from "./settings-storage";
import type { TwitterState, TwitterPost } from "./twitter-storage";

export type TwitterWorldComment = { name: string; handle: string; original: string; translated?: string };
export type TwitterWorldPost = { name: string; handle: string; original: string; translated?: string; trend?: string; comments: TwitterWorldComment[] };
export type TwitterWorldBatch = { trends: Array<{ label: string; scope: "world" | "region" }>; posts: TwitterWorldPost[] };
export type TwitterStranger = { name: string; handle: string; original: string; translated?: string };

const jsonObject = (raw: string): Record<string, unknown> => {
  const begin = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (begin < 0 || end <= begin) throw new Error("没有收到有效的帖子，请重试。");
  return JSON.parse(raw.slice(begin, end + 1)) as Record<string, unknown>;
};
const asText = (value: unknown, max = 700) => typeof value === "string" ? value.trim().slice(0, max) : "";
const commentsFrom = (value: unknown): TwitterWorldComment[] => Array.isArray(value) ? value.slice(0, 6).flatMap(entry => {
  if (!entry || typeof entry !== "object") return [];
  const row = entry as Record<string, unknown>;
  const original = asText(row.original, 300);
  return original ? [{ name: asText(row.name, 40) || "路人", handle: asText(row.handle, 35), original, translated: asText(row.translated, 300) }] : [];
}) : [];

async function ask(instruction: string): Promise<Record<string, unknown>> {
  const config = loadApiConfigs()[0];
  if (!config) throw new Error("请先设置文字 API，才能刷新推特内容。");
  const presets = loadPresets();
  const preset = presets.find(p => p.builtIn) ?? presets[0] ?? null;
  const raw = await sendLLMRequest(config, preset, [
    { role: "system", content: instruction },
    { role: "user", content: "现在生成。只输出 JSON。" },
  ], [], undefined, { appId: "twitter", appTags: ["twitter", "world"], skipOutputRegex: true });
  return jsonObject(raw);
}

export async function generateTwitterWorldBatch(state: TwitterState, hint: string): Promise<TwitterWorldBatch> {
  const context = state.publicWorldContext.trim().slice(0, 1600);
  const region = state.regionName.trim().slice(0, 70);
  const existing = state.trends.slice(-8).map(t => t.label).join("、");
  const request = `你为一个纯虚构的推特世界生成生活化动态和虚构趋势。只采用以下明确公开的背景：${context || "普通现代城市的虚构日常"}。地区：${region || "没有指定地区"}。用户偏好：${hint.slice(0, 250) || "生活、校园、情感、游戏、都市传闻、艺人日常，内容混合"}。现有趋势：${existing || "无"}。趋势应是该世界内此刻有人讨论的具体话题，地区趋势依赖设定的地区；不要用真实世界的时事、真实新闻、外链或联系方式；除用户明确关联的角色外，不写现实艺人的实际行程；不要凭空确立影响世界观的大事件，不要透露私下关系、角色小号身份。输出 2 至 3 个趋势以及 3 至 5 条不同虚构路人账号的帖子，每条帖子附 2 至 3 条短评论。可围绕趋势讨论，也可以写普通日常。original 是作者使用的语言；外语需准确附中文译文；#标签始终沿用原文不翻译。JSON: {"trends":[{"label":"具体趋势","scope":"world或region"}],"posts":[{"name":"昵称","handle":"英文账号","original":"帖子","translated":"中文译文","trend":"趋势名称或空字符串","comments":[{"name":"昵称","handle":"英文账号","original":"评论","translated":"中文译文"}]}]}。`;
  const row = await ask(request);
  const proposedTrends = Array.isArray(row.trends) ? row.trends.slice(0, 4).flatMap(item => {
    const trend = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const label = asText(trend.label, 64);
    return label ? [{ label, scope: trend.scope === "region" && region ? "region" as const : "world" as const }] : [];
  }) : [];
  const posts = Array.isArray(row.posts) ? row.posts.slice(0, 6).flatMap(item => {
    if (!item || typeof item !== "object") return [];
    const post = item as Record<string, unknown>;
    const original = asText(post.original, 850);
    return original ? [{ name: asText(post.name, 40) || "路人", handle: asText(post.handle, 35), original, translated: asText(post.translated, 850), trend: asText(post.trend, 64), comments: commentsFrom(post.comments) }] : [];
  }) : [];
  if (!posts.length) throw new Error("这次没有生成有效帖子，请重试。");
  const trends = proposedTrends.filter(t => posts.some(p => p.trend === t.label));
  return { trends, posts };
}

export async function generateTwitterTrends(state: TwitterState): Promise<string[]> {
  const row = await ask(`按纯虚构世界的公开背景生成恰好五条此刻被讨论的话题。背景：${state.publicWorldContext.slice(0, 1300) || "现代虚构世界的日常"}；地区设定：${state.regionName.slice(0, 100) || "未指定"}。这些是同一个“当前热门”列表，不区分世界或地区。可涉及生活、娱乐、校园、游戏、情感、都市传闻。禁止真实新闻、真实时事、私密关系、人物小号身份。只输出 JSON：{"trends":["话题一","话题二","话题三","话题四","话题五"]}。`);
  const labels = Array.isArray(row.trends) ? row.trends.map(item => asText(typeof item === "object" && item !== null ? (item as Record<string, unknown>).label : item, 64)).filter(Boolean).slice(0, 5) : [];
  if (new Set(labels).size !== 5) throw new Error("这次没有生成五条不同的热门话题，请重试。");
  return labels;
}

export async function generateTwitterStrangerDms(state: TwitterState): Promise<TwitterStranger[]> {
  const profile = state.profile;
  const visible = state.posts.filter(p => p.authorId === "user" && profile.visibility !== "protected" && (!p.replyToId || state.posts.some(parent => parent.id === p.replyToId && parent.authorId !== "user:alt"))).slice(-12).map(p => p.original.slice(0, 170)).join("；");
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

export async function generateTwitterStrangerReply(state: TwitterState, accountName: string, messages: Array<{ role: "user" | "character"; original: string }>): Promise<{ original: string; translated?: string }> {
  const history = messages.slice(-14).map(message => `${message.role === "user" ? state.profile.name : accountName}：${message.original.slice(0, 350)}`).join("\n");
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
  const request = `请给以下虚构社交平台帖子生成 3 至 5 条新的自然路人评论。帖子作者：${author}。帖子内容：“${post.original.slice(0, 800)}”。既有评论：“${previous.slice(-7).join("；").slice(0, 900)}”。世界公开背景：${state.publicWorldContext.slice(0, 1000)}。禁止真实时事与现实新闻、外链、曝光私密关系或角色大小号之间的幕后联系。角色为小号时，仅按该账号公开表现理解其身份。原文可用自然的交流语言，外语另给中文译文。只输出 JSON：{"comments":[{"name":"虚构昵称","handle":"英文账号","original":"评论原文","translated":"中文译文"}]}。`;
  const row = await ask(request);
  const comments = commentsFrom(row.comments);
  if (!comments.length) throw new Error("本次没有生成评论，请重试。");
  return comments;
}
