import { sendLLMRequest } from "./chat-engine";
import { loadApiConfigs, loadPresets } from "./settings-storage";
import type { TwitterState, TwitterPost } from "./twitter-storage";

export type TwitterWorldComment = { name: string; handle: string; original: string; translated?: string };
export type TwitterWorldPost = { name: string; handle: string; original: string; translated?: string; trend?: string; comments: TwitterWorldComment[] };
export type TwitterWorldBatch = { trends: Array<{ label: string; scope: "world" | "region" }>; posts: TwitterWorldPost[] };

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
  const request = `你为一个纯虚构的推特世界生成生活化动态和虚构趋势。只采用以下明确公开的背景：${context || "普通现代城市的虚构日常"}。地区：${region || "没有指定地区"}。用户偏好：${hint.slice(0, 250) || "生活、校园、情感、游戏、都市传闻、艺人日常，内容混合"}。现有趋势：${existing || "无"}。趋势应是该世界内此刻有人讨论的具体话题，地区趋势依赖设定的地区；不要用真实世界的时事、真实新闻、外链或联系方式；除用户明确关联的角色外，不写现实艺人的实际行程；不要凭空确立影响世界观的大事件，不要透露私下关系、角色小号身份。输出 2 至 3 个趋势以及 3 至 5 条不同虚构路人账号的帖子，每条帖子附 2 至 3 条短评论。可围绕趋势讨论，也可以写普通日常。original 是作者使用的语言；外语需准确附中文译文。JSON: {"trends":[{"label":"具体趋势","scope":"world或region"}],"posts":[{"name":"昵称","handle":"英文账号","original":"帖子","translated":"中文译文","trend":"趋势名称或空字符串","comments":[{"name":"昵称","handle":"英文账号","original":"评论","translated":"中文译文"}]}]}。`;
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

export async function generateTwitterComments(state: TwitterState, post: TwitterPost, author: string, previous: string[]): Promise<TwitterWorldComment[]> {
  const request = `请给以下虚构社交平台帖子生成 3 至 5 条新的自然路人评论。帖子作者：${author}。帖子内容：“${post.original.slice(0, 800)}”。既有评论：“${previous.slice(-7).join("；").slice(0, 900)}”。世界公开背景：${state.publicWorldContext.slice(0, 1000)}。禁止真实时事与现实新闻、外链、曝光私密关系或角色大小号之间的幕后联系。角色为小号时，仅按该账号公开表现理解其身份。原文可用自然的交流语言，外语另给中文译文。只输出 JSON：{"comments":[{"name":"虚构昵称","handle":"英文账号","original":"评论原文","translated":"中文译文"}]}。`;
  const row = await ask(request);
  const comments = commentsFrom(row.comments);
  if (!comments.length) throw new Error("本次没有生成评论，请重试。");
  return comments;
}
