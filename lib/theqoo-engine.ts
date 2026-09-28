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

export const THEQOO_CATEGORIES = ["뉴스", "정보", "생활", "잡담", "유머", "뷰티", "영화·방송", "아이돌"] as const;

export async function generateTheqooPosts(worldBookIds: string[], keyword = ""): Promise<TheqooPost[]> {
  const configs = loadApiConfigs();
  const selectedId = resolveBinding(loadBindingConfig(), undefined, "twitter").apiConfigId;
  const config = selectedId ? configs.find(row => row.id === selectedId) : configs.find(row => row.apiKey?.trim()) || configs[0];
  if (!config) throw new Error("请先在小手机设置里配置文字 API。 ");
  if (!config.apiKey?.trim()) throw new Error(`当前文字 API「${config.name || config.provider}」没有填写 Key。`);
  const presets = loadPresets();
  const preset = presets.find(p => p.builtIn) ?? presets[0] ?? null;
  const world = selectedWorldBookText(worldBookIds);
  const headlines: string[] = await fetch("/api/theqoo/trends").then(r => r.ok ? r.json() : null).then(data => Array.isArray(data?.titles) ? data.titles.slice(0, 8).filter((value: unknown): value is string => typeof value === "string") : []).catch(() => []);
  const prompt = `你在生成当代韩国匿名论坛内容。时间背景为 ${new Date().getFullYear()} 年韩国。匿名署名统一为 무명의 더쿠。只引用用户为本论坛勾选的世界书，不读取其他世界书。世界书：\n${world || "无"}\n近期韩国新闻标题（仅作为话题线索，不得据此推测未提供的新闻细节，也不代表论坛热度）：${headlines.length ? headlines.join("；") : "未获取到实时标题，可生成普通日常，但不要虚构真实热点"}\n用户搜索关键词/想看的内容：${keyword.trim().slice(0, 160) || "没有；自由随机生成"}。如果用户有指定主题，围绕此主题从不同角度讨论；否则随机混合板块。分类只能是：뉴스(正式新闻)、정보(普通资讯)、생활(日常与抱怨)、잡담(轻松闲聊)、유머(笑话)、뷰티(妆造穿搭)、영화·방송(影视综艺)、아이돌(艺人本人)。不要设为 전체 或 HOT。韩语需有真实网友语气、观点分歧；中文为自然准确的翻译。每篇恰好 10 条完整且不同的匿名评论。默认纯文字。现实人物和作品的事实不可凭空编造为已发生的新闻；世界书虚构设定可自然融入。只输出 JSON：{"posts":[{"category":"생활","titleOriginal":"韩文","titleTranslated":"中文","bodyOriginal":"韩文","bodyTranslated":"中文","views":1234,"comments":[{"original":"韩文","translated":"中文"}]}]}。`;
  // Three small requests avoid truncating a single response containing sixty bilingual comments.
  const items: unknown[] = [];
  for (let batch = 0; batch < 3; batch++) {
    const raw = await sendLLMRequest(config, preset, [
      { role: "system", content: `${prompt}\n本批只生成 2 篇帖子，每篇 10 条评论；这是整次刷新中第 ${batch + 1} 批，题材和切入角度尽量不同。` },
      { role: "user", content: "生成这一批，只输出 JSON。" },
    ], [], undefined, { appId: "theqoo", appTags: ["theqoo", "forum", "anonymous"], skipOutputRegex: true });
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("这次没有生成有效论坛内容，请重试。");
    const parsed = JSON.parse(raw.slice(start, end + 1)) as { posts?: unknown[] };
    if (!Array.isArray(parsed.posts) || parsed.posts.length < 2) throw new Error("这次生成的帖子不足，请重试。");
    items.push(...parsed.posts.slice(0, 2));
  }
  const now = Date.now();
  const posts = items.flatMap((item, index) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const titleOriginal = pickText(row.titleOriginal, 180);
    const bodyOriginal = pickText(row.bodyOriginal, 1600);
    if (!titleOriginal || !bodyOriginal) return [];
    const comments = Array.isArray(row.comments) ? row.comments.slice(0, 10).flatMap((comment, cIndex) => {
      if (!comment || typeof comment !== "object") return [];
      const c = comment as Record<string, unknown>;
      const original = pickText(c.original, 450);
      if (!original) return [];
      return [{ id: `tqc_${now}_${index}_${cIndex}`, original, translated: pickText(c.translated, 500) || original, createdAt: now - cIndex * 1000 * 60 }];
    }) : [];
    if (comments.length !== 10) return [];
    return [{
      id: `tq_${now}_${index}`,
      category: (THEQOO_CATEGORIES as readonly string[]).includes(String(row.category)) ? String(row.category) : "잡담",
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
  if(posts.length < 5) throw new Error("这次生成的评论不足，请重试。");
  return posts;
}
