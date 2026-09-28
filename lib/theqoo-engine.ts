import { sendLLMRequest } from "./chat-engine";
import { loadApiConfigs, loadBindingConfig, loadPresets, loadWorldBooks, resolveBinding } from "./settings-storage";
import { loadOwnerCalendarPlans } from "./calendar-storage";
import { loadWeverseState } from "./weverse-storage";
import { loadCharacters } from "./character-storage";
import type { TheqooComment, TheqooPost } from "./theqoo-storage";

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
export type TheqooSourceSettings = { includeCalendar: boolean; includeWeverseSchedule: boolean };

function scheduleContext(settings: TheqooSourceSettings): string {
  const now=Date.now();const start=new Date(now-7*86400000).toISOString().slice(0,10);const end=new Date(now+35*86400000).toISOString().slice(0,10);
  const lines:string[]=[];
  if(settings.includeCalendar){
    const owners:["user"|"character",string,string][]=[["user","self","U"],...loadCharacters().slice(0,12).map(char=>["character" as const,char.id,char.name] as ["character",string,string])];
    for(const [type,id,name] of owners){for(const plan of loadOwnerCalendarPlans(type,id)){for(const item of plan.items){if(item.date>=start&&item.date<=end)lines.push(`日历(${name}) ${item.date}: ${item.title.slice(0,80)}`);}}}
  }
  if(settings.includeWeverseSchedule){const state=loadWeverseState();for(const item of state.schedules){if(item.visibility!=="public"||item.startsAt<now-7*86400000||item.startsAt>now+35*86400000)continue;const community=state.communities.find(c=>c.id===item.communityId);lines.push(`WVS公开日程(${community?.name||"社区"}) ${new Date(item.startsAt).toISOString().slice(0,10)}: ${item.title.slice(0,80)}`);}}
  return lines.slice(0,14).join("；");
}

export async function generateTheqooPosts(worldBookIds: string[], keyword = "", sourceSettings: TheqooSourceSettings={includeCalendar:false,includeWeverseSchedule:false}): Promise<TheqooPost[]> {
  const configs = loadApiConfigs();
  const selectedId = resolveBinding(loadBindingConfig(), undefined, "twitter").apiConfigId;
  const config = selectedId ? configs.find(row => row.id === selectedId) : configs.find(row => row.apiKey?.trim()) || configs[0];
  if (!config) throw new Error("请先在小手机设置里配置文字 API。 ");
  if (!config.apiKey?.trim()) throw new Error(`当前文字 API「${config.name || config.provider}」没有填写 Key。`);
  const presets = loadPresets();
  const preset = presets.find(p => p.builtIn) ?? presets[0] ?? null;
  const world = selectedWorldBookText(worldBookIds);
  const schedules=scheduleContext(sourceSettings);
  const scheduleBatch=schedules?Math.floor(Math.random()*3):-1;
  const headlines: string[] = await fetch("/api/theqoo/trends").then(r => r.ok ? r.json() : null).then(data => Array.isArray(data?.titles) ? data.titles.slice(0, 8).filter((value: unknown): value is string => typeof value === "string") : []).catch(() => []);
  const prompt = `你在生成当代韩国匿名论坛内容。时间背景为 ${new Date().getFullYear()} 年韩国。匿名署名统一为 무명의 더쿠。只引用用户为本论坛勾选的世界书，不读取其他世界书。世界书：\n${world || "无"}\n近期韩国新闻标题（仅作为话题线索，不得据此推测未提供的新闻细节，也不代表论坛热度）：${headlines.length ? headlines.join("；") : "未获取到实时标题，可生成普通日常，但不要虚构真实热点"}\n用户搜索关键词/想看的内容：${keyword.trim().slice(0, 160) || "没有；自由随机生成"}。如果用户有指定主题，围绕此主题从不同角度讨论；否则随机混合板块。分类只能是：뉴스(正式新闻)、정보(普通资讯)、생활(日常与抱怨)、잡담(轻松闲聊)、유머(笑话)、뷰티(妆造穿搭)、영화·방송(影视综艺)、아이돌(艺人本人)。不要设为 전체 或 HOT。韩语需有真实网友语气、观点分歧；中文为自然准确的翻译。每篇恰好 10 条完整且不同的匿名评论。少数帖子可以带一张文字图（例如公告截图或网友自制文字卡），格式 imageTexts:[{"original":"图中文字韩语","translated":"图中文字中文"}]；其余帖子 imageTexts:[]。文字图放正文里，别生成真人照片；偶像板块默认不配图。现实人物和作品的事实不可凭空编造为已发生的新闻；世界书虚构设定可自然融入。只输出 JSON：{"posts":[{"category":"생활","titleOriginal":"韩文","titleTranslated":"中文","bodyOriginal":"韩文","bodyTranslated":"中文","views":1234,"imageTexts":[],"comments":[{"original":"韩文","translated":"中文"}]}]}。`;
  // Three small requests avoid truncating a single response containing sixty bilingual comments.
  const items: unknown[] = [];
  for (let batch = 0; batch < 3; batch++) {
    const raw = await sendLLMRequest(config, preset, [
      { role: "system", content: `${prompt}\n本批只生成 2 篇帖子，每篇 10 条评论；这是整次刷新中第 ${batch + 1} 批，题材和切入角度尽量不同。${batch===scheduleBatch?`\n可选日程素材：${schedules}。日历是私密时间线，只用来避免时间冲突，绝不能把私人安排当作公开事实或爆料；WVS 公开日程可以偶尔用于话题。整批至多 1 篇提及相关人物或日程，也可以完全不提。`:"这批不要围绕日历或 WVS 日程。"}` },
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
    const images=Array.isArray(row.imageTexts) && row.category!=="아이돌" ? row.imageTexts.slice(0,1).flatMap((value, imageIndex)=>{
      if(!value||typeof value!=="object")return [];
      const card=value as Record<string,unknown>;
      const originalText=pickText(card.original,500);
      if(!originalText)return [];
      return [{id:`tqi_${now}_${index}_${imageIndex}`,kind:"text" as const,originalText,translatedText:pickText(card.translated,600)||originalText}];
    }):[];
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
      images,
      favorite: false,
    } satisfies TheqooPost];
  });
  if(posts.length < 5) throw new Error("这次生成的评论不足，请重试。");
  return posts;
}

export async function generateTheqooCommentFollowups(posts: TheqooPost[], worldBookIds: string[]): Promise<Record<string, TheqooComment[]>> {
  const pending=posts.filter(post=>post.comments.some(c=>c.authoredByUser&&c.pendingRefresh)).slice(0,6);
  if(!pending.length)return {};
  const configs=loadApiConfigs();
  const selectedId=resolveBinding(loadBindingConfig(),undefined,"twitter").apiConfigId;
  const config=selectedId?configs.find(row=>row.id===selectedId):configs.find(row=>row.apiKey?.trim())||configs[0];
  if(!config?.apiKey?.trim())throw new Error("后续评论需要先配置论坛文字 API。");
  const world=selectedWorldBookText(worldBookIds);
  const input=pending.map(post=>({postId:post.id,title:post.titleOriginal,body:post.bodyOriginal.slice(0,800),recentComments:post.comments.slice(-12).map(c=>({text:c.original,user:c.authoredByUser===true}))}));
  const raw=await sendLLMRequest(config,null,[
    {role:"system",content:`你在模拟韩国匿名论坛下一次刷新后的自然评论增量。只允许使用用户为论坛选择的世界书：${world||"无"}。每篇帖子新增 0 到 3 条匿名网友评论，是否有人回复用户的评论完全随机；可以无人理会、也可以只是继续聊原帖。不要固定每次回复用户，不要替用户发言。原文自然韩语，译文准确中文。只输出 JSON：{"threads":[{"postId":"输入的原 ID","comments":[{"original":"韩文","translated":"中文"}]}]}。`},
    {role:"user",content:JSON.stringify(input)},
  ],[],undefined,{appId:"theqoo",appTags:["theqoo","comments"],skipOutputRegex:true});
  const start=raw.indexOf("{");const end=raw.lastIndexOf("}");
  if(start<0||end<=start)throw new Error("后续评论生成失败，请下次刷新重试。");
  const parsed=JSON.parse(raw.slice(start,end+1)) as {threads?:unknown[]};
  if(!Array.isArray(parsed.threads))throw new Error("后续评论格式无效，请下次刷新重试。");
  const result:Record<string,TheqooComment[]>={};const allowed=new Set(pending.map(post=>post.id));const now=Date.now();
  for(const item of parsed.threads){if(!item||typeof item!=="object")continue;const thread=item as Record<string,unknown>;const id=String(thread.postId||"");if(!allowed.has(id))continue;
    result[id]=Array.isArray(thread.comments)?thread.comments.slice(0,3).flatMap((value,index)=>{if(!value||typeof value!=="object")return [];const row=value as Record<string,unknown>;const original=pickText(row.original,450);if(!original)return [];return [{id:`tqr_${now}_${id}_${index}`,original,translated:pickText(row.translated,500)||original,createdAt:now+index*1000}];}):[];
  }
  // Explicitly mark every processed thread, including threads with zero new comments.
  for(const post of pending)result[post.id]??=[];
  return result;
}
