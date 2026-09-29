import { sendLLMRequest } from "./chat-engine";
import { loadApiConfigs, loadBindingConfig, loadPresets, loadWorldBooks, resolveBinding } from "./settings-storage";
import { loadOwnerCalendarPlans } from "./calendar-storage";
import { loadCharacters } from "./character-storage";
import { loadWeverseState } from "./weverse-storage";
import type { TheqooComment, TheqooPost } from "./theqoo-storage";

const pickText = (value: unknown, max: number) => typeof value === "string" ? value.trim().slice(0, max) : "";

function selectedWorldBookText(ids: string[]) {
  const chosen = new Set(ids);
  return loadWorldBooks()
    .filter(book => chosen.has(book.id))
    .map(book => `${book.name}：${book.entries.filter(entry => !entry.disable).map(entry => entry.content).join("；")}`)
    .join("\n")
    .slice(0, 4200);
}

export const THEQOO_CATEGORIES = ["HOT", "뉴스", "정보", "생활", "잡담", "유머", "뷰티", "영화·방송", "아이돌"] as const;
export type TheqooSourceSettings = { includeCalendar: boolean; includeWeverseSchedule: boolean };

function topicText(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");
}

function topicSimilarity(a: string, b: string): number {
  const left = topicText(a), right = topicText(b);
  if (left === right) return left.length >= 5 ? 1 : 0;
  if (left.length < 8 || right.length < 8) return 0;
  const grams = (value: string) => Array.from({ length: value.length - 1 }, (_, i) => value.slice(i, i + 2));
  const counts = new Map<string, number>();
  for (const gram of grams(left)) counts.set(gram, (counts.get(gram) || 0) + 1);
  let shared = 0;
  for (const gram of grams(right)) {
    const count = counts.get(gram) || 0;
    if (count) { shared++; counts.set(gram, count - 1); }
  }
  return 2 * shared / (left.length + right.length - 2);
}

function sameTopic(a: Pick<TheqooPost, "titleOriginal" | "titleTranslated" | "topicKey">, b: Pick<TheqooPost, "titleOriginal" | "titleTranslated" | "topicKey">): boolean {
  if (a.topicKey && b.topicKey && topicSimilarity(a.topicKey, b.topicKey) >= 0.72) return true;
  return topicSimilarity(a.titleTranslated || a.titleOriginal, b.titleTranslated || b.titleOriginal) >= 0.7
    || topicSimilarity(a.titleOriginal, b.titleOriginal) >= 0.76;
}

export function dedupeTheqooPosts(posts: TheqooPost[]): TheqooPost[] {
  const result: TheqooPost[] = [];
  const priority = (post: TheqooPost) => (post.favorite ? 2 : 0) + (post.comments.some(c => c.authoredByUser) ? 4 : 0);
  for (const post of posts) {
    if (post.authoredByUser) { result.push(post); continue; }
    const index = result.findIndex(previous => !previous.authoredByUser && sameTopic(previous, post));
    if (index < 0) result.push(post);
    else if (priority(post) > priority(result[index])) result[index] = post;
  }
  return result;
}

function scheduleContext(settings: TheqooSourceSettings): string {
  const now = Date.now();
  const start = new Date(now - 7 * 86400000).toISOString().slice(0, 10);
  const end = new Date(now + 35 * 86400000).toISOString().slice(0, 10);
  const lines: string[] = [];
  if (settings.includeCalendar) {
    const owners: ["user" | "character", string, string][] = [
      ["user", "self", "U"],
      ...loadCharacters().slice(0, 12).map(char => ["character" as const, char.id, char.name] as ["character", string, string]),
    ];
    for (const [type, id, name] of owners) {
      for (const plan of loadOwnerCalendarPlans(type, id)) {
        for (const item of plan.items) {
          if (item.date >= start && item.date <= end) {
            lines.push(`手机日历(${name}) ${item.date}: ${item.title.slice(0, 80)}`);
          }
        }
      }
    }
  }
  if (settings.includeWeverseSchedule) {
    const state = loadWeverseState();
    for (const item of state.schedules) {
      if (item.visibility !== "public" || item.startsAt < now - 7 * 86400000 || item.startsAt > now + 35 * 86400000) continue;
      const community = state.communities.find(c => c.id === item.communityId);
      lines.push(`WVS公开日程(${community?.name || "社区"}) ${new Date(item.startsAt).toISOString().slice(0, 10)}: ${item.title.slice(0, 80)}`);
    }
  }
  return lines.slice(0, 18).join("；");
}

function getForumConfig() {
  const configs = loadApiConfigs();
  const selectedId = resolveBinding(loadBindingConfig(), undefined, "twitter").apiConfigId;
  const config = selectedId ? configs.find(row => row.id === selectedId) : configs.find(row => row.apiKey?.trim()) || configs[0];
  if (!config) throw new Error("请先在小手机设置里配置文字 API。");
  if (!config.apiKey?.trim()) throw new Error(`当前文字 API「${config.name || config.provider}」没有填写 Key。`);
  return config;
}

const opPolicy = `评论区规则：所有分类都允许真实的意见分歧、吐槽、反驳、冷嘲、阴阳、吵架和跑题，不要强行一团和气，也不要为了制造冲突而每条都吵。뉴스 和 정보 的“正经”只限标题和正文：뉴스 正文偏正式新闻转述，정보 正文偏实用资讯/整理；它们的评论区依旧可以很自由，但绝对不能出现原楼主回复。HOT 是专属热议帖，话题有讨论度，但不是从普通板块复制的帖子。생활、잡담、유머、뷰티、영화·방송、아이돌 和 HOT 的评论区可以出现原楼主回来补充或回复，使用 isOP:true 标记；其中 생활 类楼主参与可以更积极一些。世界书决定具体人物、圈内梗、事件和关系，未提供的事实不要自行补成现实新闻。`;

export async function generateTheqooPosts(
  worldBookIds: string[],
  keyword = "",
  sourceSettings: TheqooSourceSettings = { includeCalendar: false, includeWeverseSchedule: false },
  translationEnabled = true,
  recentPosts: TheqooPost[] = [],
): Promise<TheqooPost[]> {
  const config = getForumConfig();
  const presets = loadPresets();
  const preset = presets.find(p => p.builtIn) ?? presets[0] ?? null;
  const world = selectedWorldBookText(worldBookIds);
  const schedules = scheduleContext(sourceSettings);
  const scheduleBatch = schedules ? Math.floor(Math.random() * 3) : -1;
  const headlines: string[] = await fetch("/api/theqoo/trends")
    .then(r => r.ok ? r.json() : null)
    .then(data => Array.isArray(data?.titles) ? data.titles.slice(0, 8).filter((value: unknown): value is string => typeof value === "string") : [])
    .catch(() => []);

  const languageRule = translationEnabled
    ? `内容语言：帖子标题、正文、普通评论需要同时给自然韩语和自然简体中文。韩语要像真实韩国匿名论坛网友；中文要准确保留韩网语气。文字图例外：所有文字图只允许简体中文，不要生成韩文，也不要给文字图做翻译。`
    : `内容语言：帖子标题、正文和全部评论只生成简体中文，不要生成任何韩文版本。中文要有“韩网内容翻译成中文后”的语感，可以保留韩国论坛常见的句法、情绪词、ㅋㅋ/ㅠㅠ 等网络感，但正文和回复本体都只写中文。文字图也只允许简体中文。`;

  const searchRule = keyword.trim()
    ? `用户正在搜索：${keyword.trim().slice(0, 160)}。围绕这个关键词从不同角度生成相关帖子，不要把关键词当成真实新闻事实。`
    : `这是随机刷新。随机混合不同板块和生活话题，不围绕固定关键词。`;

  const schema = translationEnabled
    ? `只输出 JSON：{"posts":[{"category":"생활","topicKey":"中文事件或话题短语","titleOriginal":"韩文","titleTranslated":"中文","bodyOriginal":"韩文","bodyTranslated":"中文","views":1234,"imageTexts":["中文文字图，可空"],"comments":[{"original":"韩文","translated":"中文","isOP":false}]}]}。`
    : `只输出 JSON：{"posts":[{"category":"생활","topicKey":"中文事件或话题短语","title":"中文","body":"中文","views":1234,"imageTexts":["中文文字图，可空"],"comments":[{"text":"中文","isOP":false}]}]}。`;

  const prompt = `你在生成当代韩国匿名论坛 theqoo 风格内容。时间背景为 ${new Date().getFullYear()} 年韩国。匿名署名统一为 무명의 더쿠。只引用用户为本论坛勾选的世界书，不读取其他世界书。\n世界书：\n${world || "无"}\n近期韩国新闻标题（只能作为话题线索，不得据此猜测未提供的新闻细节，也不代表论坛热度）：${headlines.length ? headlines.join("；") : "未获取到实时标题，可生成普通日常，但不要虚构真实热点"}\n${searchRule}\n普通板块只能是：뉴스(新闻)、정보(资讯)、생활(生活)、잡담(闲谈)、유머(幽默)、뷰티(美妆)、영화·방송(影视)、아이돌(偶像)。HOT 是独立生成的热议板块，普通板块帖子不能按浏览量复制进 HOT。不要设为 전체。每篇给出具体的中文 topicKey，同一新闻事件、同一个生活故事即使换标题也要用同一个主题，不要拆成多篇。\n${opPolicy}\n${languageRule}\n每篇恰好 10 条完整且不同的匿名评论。少数帖子可以带一张文字图；文字图只写中文，格式 imageTexts:["中文文字内容"]，没有就 []。文字图是公告截图、整理卡或网友自制文字卡，不生成真人照片；偶像板块默认不配图。现实人物和作品的事实不可凭空编造为已发生的新闻；世界书中的虚构设定可自然融入。${schema}`;

  const items: Record<string, unknown>[] = [];
  const recentCount = Math.min(100, recentPosts.length);
  const seenTopics: Pick<TheqooPost, "titleOriginal" | "titleTranslated" | "topicKey">[] = recentPosts.slice(0, recentCount);
  const batches = [{ count: 2, hot: true }, { count: 4, hot: false }, { count: 4, hot: false }];
  for (let batch = 0; batch < batches.length; batch++) {
    const plan = batches[batch];
    const scheduleInstruction = batch === scheduleBatch
      ? `可选关联素材：${schedules}。手机日历只作为时间线参考：只有明显属于公开演出、公开拍摄、公开活动、比赛、直播、正式发布等可公开事件才允许偶尔成为论坛话题；私人约会、就医、家庭安排、住址相关或明显私密事项绝不能当作公开事实或爆料。WVS 公开日程本身属于可公开素材，可以偶尔成为论坛讨论背景，但不要每次都讨论，也不要把未写出的细节自行补成新闻。整批至多 1 篇提及这些关联素材，也可以完全不提。`
      : "这批不要围绕手机日历或 WVS 日程生成。";
    let accepted = 0;
    for (let attempt = 0; accepted < plan.count && attempt < 3; attempt++) {
      const needed = plan.count - accepted;
      const recentTopics = [...seenTopics.slice(0, 35), ...seenTopics.slice(recentCount)]
        .map(item => item.topicKey || item.titleTranslated || item.titleOriginal).filter(Boolean).slice(-45);
      let parsed: { posts?: unknown[] };
      try {
        const raw = await sendLLMRequest(config, preset, [
          { role: "system", content: `${prompt}\n本批只生成 ${needed} 篇帖子，每篇 10 条评论；这是整次刷新中第 ${batch + 1} 批。${plan.hot ? "这一批全部是 HOT 专属帖，category 必须为 HOT。话题要有自然热议感，不能照搬普通新闻帖。" : "这一批只生成普通板块帖子，category 不得为 HOT；尽量混合不同板块。"}${scheduleInstruction}\n以下主题已有帖子，不能换标题重写同一件事：${recentTopics.join("；") || "暂无"}。同一批内也不能重复事件、人物话题或生活故事。` },
          { role: "user", content: "生成这一批，只输出 JSON。" },
        ], [], undefined, { appId: "theqoo", appTags: ["theqoo", "forum", "anonymous"], skipOutputRegex: true });
        const start = raw.indexOf("{"), end = raw.lastIndexOf("}");
        if (start < 0 || end <= start) continue;
        parsed = JSON.parse(raw.slice(start, end + 1)) as { posts?: unknown[] };
      } catch { continue; }
      for (const value of Array.isArray(parsed.posts) ? parsed.posts : []) {
        if (accepted >= plan.count) break;
        if (!value || typeof value !== "object") continue;
        const row = value as Record<string, unknown>;
        const titleOriginal = translationEnabled ? pickText(row.titleOriginal, 180) : (pickText(row.title, 220) || pickText(row.titleTranslated, 220));
        const titleTranslated = translationEnabled ? pickText(row.titleTranslated, 220) : titleOriginal;
        const body = translationEnabled ? pickText(row.bodyOriginal, 1600) : (pickText(row.body, 1800) || pickText(row.bodyTranslated, 1800));
        if (!titleOriginal || !body || !Array.isArray(row.comments) || row.comments.length < 10) continue;
        const candidate = { titleOriginal, titleTranslated: titleTranslated || titleOriginal, topicKey: pickText(row.topicKey, 80) };
        if (seenTopics.some(previous => sameTopic(previous, candidate))) continue;
        const category = plan.hot ? "HOT" : ((THEQOO_CATEGORIES as readonly string[]).includes(String(row.category)) && row.category !== "HOT" ? String(row.category) : "잡담");
        items.push({ ...row, category, topicKey: candidate.topicKey });
        seenTopics.push(candidate);
        accepted++;
      }
    }
  }

  if (items.filter(item => item.category === "HOT").length < 2) throw new Error("HOT 帖子不足 2 篇，请重新刷新。");

  const now = Date.now();
  const posts = items.flatMap((item, index) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const category = (THEQOO_CATEGORIES as readonly string[]).includes(String(row.category)) ? String(row.category) : "잡담";
    const noOP = category === "뉴스" || category === "정보";

    let titleOriginal = "";
    let titleTranslated = "";
    let bodyOriginal = "";
    let bodyTranslated = "";
    if (translationEnabled) {
      titleOriginal = pickText(row.titleOriginal, 180);
      titleTranslated = pickText(row.titleTranslated, 220) || titleOriginal;
      bodyOriginal = pickText(row.bodyOriginal, 1600);
      bodyTranslated = pickText(row.bodyTranslated, 1800) || bodyOriginal;
    } else {
      const title = pickText(row.title, 220) || pickText(row.titleTranslated, 220) || pickText(row.titleOriginal, 220);
      const body = pickText(row.body, 1800) || pickText(row.bodyTranslated, 1800) || pickText(row.bodyOriginal, 1800);
      titleOriginal = titleTranslated = title;
      bodyOriginal = bodyTranslated = body;
    }
    if (!titleOriginal || !bodyOriginal) return [];

    const comments = Array.isArray(row.comments) ? row.comments.slice(0, 10).flatMap((comment, cIndex) => {
      if (!comment || typeof comment !== "object") return [];
      const c = comment as Record<string, unknown>;
      const original = translationEnabled ? pickText(c.original, 450) : (pickText(c.text, 500) || pickText(c.translated, 500) || pickText(c.original, 500));
      if (!original) return [];
      const translated = translationEnabled ? (pickText(c.translated, 500) || original) : original;
      return [{
        id: `tqc_${now}_${index}_${cIndex}`,
        original,
        translated,
        createdAt: now - cIndex * 1000 * 60,
        authoredByOP: !noOP && c.isOP === true,
      }];
    }) : [];
    if (comments.length !== 10) return [];

    const images = Array.isArray(row.imageTexts) && category !== "아이돌"
      ? row.imageTexts.slice(0, 1).flatMap((value, imageIndex) => {
          const text = typeof value === "string"
            ? pickText(value, 600)
            : value && typeof value === "object"
              ? pickText((value as Record<string, unknown>).text, 600) || pickText((value as Record<string, unknown>).translated, 600) || pickText((value as Record<string, unknown>).original, 600)
              : "";
          if (!text) return [];
          return [{ id: `tqi_${now}_${index}_${imageIndex}`, kind: "text" as const, originalText: text, translatedText: text }];
        })
      : [];

    return [{
      id: `tq_${now}_${index}`,
      category,
      topicKey: pickText(row.topicKey, 80) || titleTranslated,
      titleOriginal,
      titleTranslated,
      bodyOriginal,
      bodyTranslated,
      createdAt: now - index * 1000 * 60 * 5,
      views: Math.max(category === "HOT" ? 12000 : 20, Number(row.views) || Math.floor(1000 + Math.random() * 30000)),
      comments,
      images,
      favorite: false,
    } satisfies TheqooPost];
  });

  if (posts.filter(post => post.category === "HOT").length < 2) throw new Error("HOT 帖子或评论不足，请重新刷新。");
  if (posts.length < 5) throw new Error("这次生成的评论不足，请重试。");
  return posts;
}

export async function generateTheqooMoreComments(
  post: TheqooPost,
  worldBookIds: string[],
  translationEnabled = true,
): Promise<TheqooComment[]> {
  const config = getForumConfig();
  const world = selectedWorldBookText(worldBookIds);
  const noOP = post.authoredByUser === true || post.category === "뉴스" || post.category === "정보";
  const languageRule = translationEnabled
    ? `每条评论输出自然韩语 original 和准确中文 translated。`
    : `每条评论只输出中文 text，保留韩网翻译腔，不要韩文副本。`;
  const schema = translationEnabled
    ? `{"comments":[{"original":"韩文","translated":"中文","isOP":false}]}`
    : `{"comments":[{"text":"中文","isOP":false}]}`;
  const raw = await sendLLMRequest(config, null, [
    { role: "system", content: `继续生成韩国匿名论坛帖下方此前尚未显示的评论。只参考选中的世界书：${world || "无"}。帖子分类：${post.category}。${opPolicy}恰好续写 10 条不同的匿名评论，不要复述已有评论，不要替用户发言，也不要把用户尚待下一次首页刷新的评论当成已被网友看到。${noOP ? "不能生成楼主回复，isOP 全部为 false。" : "可以自然出现原楼主补充，但不强制。"}${languageRule}只输出 JSON：${schema}。` },
    { role: "user", content: JSON.stringify({ title: translationEnabled ? post.titleOriginal : post.titleTranslated || post.titleOriginal, body: translationEnabled ? post.bodyOriginal : post.bodyTranslated || post.bodyOriginal, recentComments: post.comments.filter(c => !c.pendingRefresh).slice(-22).map(c => ({ text: translationEnabled ? c.original : c.translated || c.original, isOP: post.authoredByUser ? c.authoredByUser === true : c.authoredByOP === true })) }) },
  ], [], undefined, { appId: "theqoo", appTags: ["theqoo", "comments"], skipOutputRegex: true });
  const start = raw.indexOf("{"), end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("评论生成失败，请重试。");
  const parsed = JSON.parse(raw.slice(start, end + 1)) as { comments?: unknown[] };
  if (!Array.isArray(parsed.comments) || parsed.comments.length < 10) throw new Error("这次评论不足 10 条，请重试。");
  const now = Date.now();
  const comments = parsed.comments.slice(0, 10).flatMap((value, index) => {
    if (!value || typeof value !== "object") return [];
    const row = value as Record<string, unknown>;
    const original = translationEnabled ? pickText(row.original, 450) : (pickText(row.text, 500) || pickText(row.translated, 500) || pickText(row.original, 500));
    if (!original) return [];
    return [{ id: `tqm_${now}_${post.id}_${index}`, original, translated: translationEnabled ? (pickText(row.translated, 500) || original) : original, createdAt: now + index * 1000, authoredByOP: !noOP && row.isOP === true }];
  });
  if (comments.length !== 10) throw new Error("这次评论不足 10 条，请重试。");
  return comments;
}

export async function generateTheqooCommentFollowups(
  posts: TheqooPost[],
  worldBookIds: string[],
  translationEnabled = true,
): Promise<Record<string, TheqooComment[]>> {
  const pending = posts.filter(post => post.comments.some(c => c.authoredByUser && c.pendingRefresh)).slice(0, 6);
  if (!pending.length) return {};
  const config = getForumConfig();
  const world = selectedWorldBookText(worldBookIds);
  const input = pending.map(post => ({
    postId: post.id,
    category: post.category,
    authoredByUser: post.authoredByUser === true,
    title: translationEnabled ? post.titleOriginal : post.titleTranslated || post.titleOriginal,
    body: (translationEnabled ? post.bodyOriginal : post.bodyTranslated || post.bodyOriginal).slice(0, 800),
    recentComments: post.comments.slice(-16).map(c => ({
      text: translationEnabled ? c.original : c.translated || c.original,
      user: c.authoredByUser === true,
      op: post.authoredByUser ? c.authoredByUser === true : c.authoredByOP === true,
      pending: c.pendingRefresh === true,
    })),
  }));

  const languageRule = translationEnabled
    ? `每条新增评论输出自然韩语 original 和准确中文 translated。`
    : `每条新增评论只输出中文 text，不要输出韩文；中文保留韩网翻译腔和论坛语感。`;
  const schema = translationEnabled
    ? `{"threads":[{"postId":"输入原 ID","comments":[{"original":"韩文","translated":"中文","isOP":false}]}]}`
    : `{"threads":[{"postId":"输入原 ID","comments":[{"text":"中文","isOP":false}]}]}`;

  const raw = await sendLLMRequest(config, null, [
    {
      role: "system",
      content: `你在模拟韩国匿名论坛下一次“刷新页面”后自然出现的评论增量。只允许使用用户为论坛选择的世界书：${world || "无"}。每个输入帖子这一次必须新增 5 到 8 条匿名网友评论，数量随机，不要每帖固定相同。新增评论可以回应用户刚刚留下的 pending 评论，也可以继续原帖其他争论，不要让所有人都机械回复用户同一句。用户发表评论后不是即时得到回复，而是到了这次刷新才可能被看到。所有评论区都允许吐槽、反驳、冷嘲、阴阳、跑题和小规模吵架，也允许没人站用户这边。${opPolicy} 如果 authoredByUser:true，原楼主就是用户本人，绝对不能替用户生成任何 isOP:true 的楼主发言；只有 AI 原帖且分类不是 뉴스/정보 时，AI 才可以让原楼主自然回来补充。${languageRule} 只输出 JSON：${schema}`,
    },
    { role: "user", content: JSON.stringify(input) },
  ], [], undefined, { appId: "theqoo", appTags: ["theqoo", "comments"], skipOutputRegex: true });

  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("后续评论生成失败，请下次刷新重试。");
  const parsed = JSON.parse(raw.slice(start, end + 1)) as { threads?: unknown[] };
  if (!Array.isArray(parsed.threads)) throw new Error("后续评论格式无效，请下次刷新重试。");

  const result: Record<string, TheqooComment[]> = {};
  const pendingById = new Map(pending.map(post => [post.id, post]));
  const now = Date.now();
  for (const item of parsed.threads) {
    if (!item || typeof item !== "object") continue;
    const thread = item as Record<string, unknown>;
    const id = String(thread.postId || "");
    const post = pendingById.get(id);
    if (!post) continue;
    const noOP = post.authoredByUser === true || post.category === "뉴스" || post.category === "정보";
    const comments = Array.isArray(thread.comments) ? thread.comments.slice(0, 8).flatMap((value, index) => {
      if (!value || typeof value !== "object") return [];
      const row = value as Record<string, unknown>;
      const original = translationEnabled ? pickText(row.original, 450) : (pickText(row.text, 500) || pickText(row.translated, 500) || pickText(row.original, 500));
      if (!original) return [];
      const translated = translationEnabled ? (pickText(row.translated, 500) || original) : original;
      return [{
        id: `tqr_${now}_${id}_${index}`,
        original,
        translated,
        createdAt: now + index * 1000,
        authoredByOP: !noOP && row.isOP === true,
      }];
    }) : [];
    if (comments.length < 5) continue;
    result[id] = comments;
  }

  // 只有成功生成 5~8 条的帖子才视为本轮已处理；其余 pending 会保留到下次刷新。
  return result;
}
