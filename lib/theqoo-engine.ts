import { sendLLMRequest } from "./chat-engine";
import { loadApiConfigs, loadBindingConfig, loadPresets, loadWorldBooks, resolveBinding } from "./settings-storage";
import type { TheqooPost } from "./theqoo-storage";

const pickText = (v: unknown, max: number) => typeof v === "string" ? v.trim().slice(0, max) : "";

function selectedWorldBookText(ids: string[]) {
  const chosen = new Set(ids);
  return loadWorldBooks()
    .filter(book => chosen.has(book.id))
    .map(book => `${book.name}：${book.entries.filter(entry => !entry.disable).map(entry => entry.content).join("；")}`)
    .join("\n")
    .slice(0, 4200);
}

export async function generateTheqooPosts(worldBookIds: string[], category = "전체"): Promise<TheqooPost[]> {
  const configs = loadApiConfigs();
  const selectedId = resolveBinding(loadBindingConfig(), undefined, "twitter").apiConfigId;
  const config = selectedId ? configs.find(row => row.id === selectedId) : configs.find(row => row.apiKey?.trim()) || configs[0];
  if (!config) throw new Error("请先在小手机设置里配置文字 API。 ");
  if (!config.apiKey?.trim()) throw new Error(`当前文字 API「${config.name || config.provider}」没有填写 Key。`);
  const presets = loadPresets();
  const preset = presets.find(p => p.builtIn) ?? presets[0] ?? null;
  const world = selectedWorldBookText(worldBookIds);
  const prompt = `你正在生成一个仿韩国匿名论坛 theqoo 氛围的纯虚构论坛内容。论坛用户全部匿名，署名固定为“무명의 더쿠”，内容应像真实韩网网友自然发帖与评论，不要像新闻稿。当前分类：${category}。只允许依据以下用户明确选中的论坛专属世界书；如果为空，就生成普通现代韩国网络日常。\n论坛专属世界书：${world || "无"}\n生成 4 条彼此不同的帖子，每条 3-7 条匿名评论。可以有娱乐、生活、吐槽、信息、轻松讨论，但不要捏造现实人物的实时新闻或违法隐私。original 必须是自然韩语；translated 是准确自然的简体中文搬运译文。标题也同时给韩文和中文。只输出 JSON：{"posts":[{"category":"일상토크/이슈/정보/유머/뷰티/드영배 中之一","titleOriginal":"韩文标题","titleTranslated":"中文标题","bodyOriginal":"韩文正文","bodyTranslated":"中文正文","views":1234,"comments":[{"original":"韩文评论","translated":"中文评论"}]}]}。`;
  const raw = await sendLLMRequest(config, preset, [
    { role: "system", content: prompt },
    { role: "user", content: "现在生成，只输出 JSON。" },
  ], [], undefined, { appId: "theqoo", appTags: ["theqoo", "forum", "anonymous"], skipOutputRegex: true });
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("这次没有生成有效论坛内容，请重试。");
  const parsed = JSON.parse(raw.slice(start, end + 1)) as { posts?: unknown[] };
  if (!Array.isArray(parsed.posts)) throw new Error("这次没有生成有效论坛内容，请重试。");
  const now = Date.now();
  return parsed.posts.slice(0, 6).flatMap((item, index) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const titleOriginal = pickText(row.titleOriginal, 180);
    const bodyOriginal = pickText(row.bodyOriginal, 1600);
    if (!titleOriginal || !bodyOriginal) return [];
    const comments = Array.isArray(row.comments) ? row.comments.slice(0, 8).flatMap((comment, cIndex) => {
      if (!comment || typeof comment !== "object") return [];
      const c = comment as Record<string, unknown>;
      const original = pickText(c.original, 450);
      if (!original) return [];
      return [{ id: `tqc_${now}_${index}_${cIndex}`, original, translated: pickText(c.translated, 500) || original, createdAt: now - cIndex * 1000 * 60 }];
    }) : [];
    return [{
      id: `tq_${now}_${index}`,
      category: pickText(row.category, 30) || "일상토크",
      titleOriginal,
      titleTranslated: pickText(row.titleTranslated, 220) || titleOriginal,
      bodyOriginal,
      bodyTranslated: pickText(row.bodyTranslated, 1800) || bodyOriginal,
      createdAt: now - index * 1000 * 60 * 5,
      views: Math.max(20, Number(row.views) || Math.floor(1000 + Math.random() * 30000)),
      comments,
      favorite: false,
    } satisfies TheqooPost];
  });
}
