import { loadCharacters } from "./character-storage";
import { sendLLMRequest } from "./chat-engine";
import { assemblePromptPayload, type LLMMessage } from "./llm-prompt-assembler";
import { prepareShortTermContext } from "./short-term-assembler";
import { loadMemoryConfig } from "./memory-storage";
import { retrieveCoreMemoriesForPrompt, retrieveMemoriesForPrompt } from "./memory-service";
import { formatCoreMemories, formatLongTermMemories } from "./memory-injector";
import { buildCharacterTimeContext } from "./character-time";
import { loadApiConfigs, loadBindingConfig, loadPresets, loadRegexes, loadWorldBooks, resolveBinding, resolveUserIdentity } from "./settings-storage";
import type { RegexConfig, WorldBookConfig } from "./settings-types";
import { isPublicTwitterPost, type TwitterMessage, type TwitterPost, type TwitterState } from "./twitter-storage";

export type TwitterGeneratedLine = { original: string; translated: string };
export type TwitterCommentDraft = { name: string; handle: string; original: string; translated?: string };

function parseLines(text: string): TwitterGeneratedLine[] {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
  try {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    const row = JSON.parse(start >= 0 && end > start ? trimmed.slice(start, end + 1) : trimmed) as { lines?: Array<{ original?: string; translated?: string }>; original?: string; translated?: string };
    const lines = Array.isArray(row.lines) ? row.lines : [row];
    return lines.map(line => ({ original: String(line.original || "").trim(), translated: String(line.translated || line.original || "").trim() }))
      .filter(line => line.original).slice(0, 3);
  } catch {
    return trimmed ? [{ original: trimmed.slice(0, 650), translated: trimmed.slice(0, 650) }] : [];
  }
}

export async function generateTwitterText(input: {
  characterId: string;
  state: TwitterState;
  kind: "post" | "reply" | "dm";
  targetPost?: TwitterPost;
  conversation?: TwitterMessage[];
  replyToMessage?: TwitterMessage;
  anonymous?: boolean;
  senderName?: string;
  accountProfile?: { name: string; identity?: string; visibility?: "public" | "protected"; disclosure?: "independent" | "full" | "clues"; disclosureClues?: string };
  accountKind?: "alternate" | "group";
  communityName?: string;
  withComments?: boolean;
}): Promise<TwitterGeneratedLine[] & { comments?: TwitterCommentDraft[] }> {
  const character = loadCharacters().find(row => row.id === input.characterId);
  if (!character) throw new Error("角色已不存在。");
  const slot = resolveBinding(loadBindingConfig(), character.id, "twitter");
  const apiConfig = loadApiConfigs().find(row => row.id === slot.apiConfigId) ?? loadApiConfigs()[0];
  if (!apiConfig) throw new Error("先在设置中配置文字 API，才能生成角色内容。");
  const presets = loadPresets();
  const preset = presets.find(row => row.id === slot.presetId) ?? presets.find(row => row.builtIn) ?? null;
  const worldBooks = (slot.worldBookIds || []).map(id => loadWorldBooks().find(row => row.id === id)).filter(Boolean) as WorldBookConfig[];
  const regexes = (slot.regexIds || []).map(id => loadRegexes().find(row => row.id === id)).filter(Boolean) as RegexConfig[];
  const anonymous = input.anonymous === true;
  const context = anonymous ? null : prepareShortTermContext(character.id, "twitter", { history: [], tokenBudgetOverride: 2800 });
  const memConfig = loadMemoryConfig();
  const [longMemories, coreMemories] = anonymous ? [[], []] : await Promise.all([
    retrieveMemoriesForPrompt(character.id, context!.wbActivationContext, memConfig).catch(() => []),
    retrieveCoreMemoriesForPrompt(character.id, memConfig).catch(() => []),
  ]);
  const identity = anonymous ? null : resolveUserIdentity(character.id, "twitter");
  const prompt = assemblePromptPayload({
    character, history: [], preset, worldBooks, regexes,
    userIdentity: identity, appId: "twitter", appTags: ["twitter", input.kind],
    longTermMemories: formatLongTermMemories(longMemories),
    coreMemories: formatCoreMemories(coreMemories),
    worldBookActivationContext: context?.wbActivationContext ?? "",
    recentBlocks: context?.recentBlocks ?? [],
    unifiedRecentItems: context?.unifiedRecentItems ?? [],
    timeContext: buildCharacterTimeContext(character.timeZone),
  });
  const publicRule = "推特的帖子和回复是公开的。你可以有私下记忆，但不得随意公开地下关系、私人聊天内容、昵称或未公开身份。";
  const stateRule = input.state.worldRules.trim() ? `补充世界观：${input.state.worldRules.slice(0, 2500)}` : "";
  const shared = "以角色平常使用的语言写 original；如果不是中文，translated 给准确自然的简体中文译文，中文原文则两字段相同。原文中的 #话题标签保留原文，不翻译、不改写标签。只输出 JSON，不要解释。";
  let instruction: string;
  if (input.kind === "post") {
    const recent = input.state.posts.filter(p => !p.replyToId && isPublicTwitterPost(input.state, p)).slice(-10).map(p => `${p.authorId === "user" ? input.state.profile.name : p.authorId === character.id ? character.name : "其他账号"}：${p.original}`).join("\n");
    const accountRule = input.accountKind === "alternate" ? `你以副账号“${input.accountProfile?.name || "副账号"}”发帖；对外身份是“${input.accountProfile?.identity || "未设定"}”。账号关联方式：${input.accountProfile?.disclosure === "full" ? "已经完全公开与主账号的关系，可以自然谈及。" : input.accountProfile?.disclosure === "clues" ? `只存在以下可见线索“${input.accountProfile.disclosureClues || "无"}”，不能直接证实或曝光身份。` : "独立身份，不要主动泄漏与主账号的联系或私密记忆。"}` : "";
    const communityRule = input.communityName ? `这条发在“${input.communityName.slice(0, 60)}”社区，内容要贴合社区主题，不能因关联角色而公开其未公开的小号。` : "";
    instruction = `${publicRule}\n${stateRule}\n${accountRule}\n${communityRule}\n近期公开帖子：\n${recent || "暂无"}\n根据本人设定、记忆与时间，自然发布一条适合当前情境的新帖子，可以回应近期公开话题，但不要机械模仿。${shared}\nJSON 格式：{"original":"帖子原文","translated":"中文译文"${input.withComments ? ',"comments":[{"name":"路人昵称","handle":"路人账号","original":"短评论原文","translated":"中文译文"}]' : ""}}。${input.withComments ? "同时给 5 至 10 条自然的路人评论，避免暴露副账号与主账号的隐藏关联。" : ""}`;
  } else if (input.kind === "reply") {
    if (!input.targetPost) throw new Error("找不到要回复的帖子。");
    instruction = `${publicRule}\n${stateRule}\n你正在回复一条推特帖子，内容：“${input.targetPost.original.slice(0, 900)}”。直接回应具体内容，自然简短，不要离题。${shared}\nJSON 格式：{"original":"回复原文","translated":"中文译文"}`;
  } else {
    const history = (input.conversation || []).slice(-20).map(m => `${m.role === "user" ? anonymous ? "匿名用户" : input.senderName || input.state.profile.name : input.accountKind === "alternate" ? input.accountProfile?.name || "小号" : character.name}：${m.original}`).join("\n");
    const quoted = input.replyToMessage ? `\n本次特别引用回复${input.replyToMessage.role === "user" ? "对方" : "你自己"}的这条私信：“${input.replyToMessage.original.slice(0, 500)}”。` : "";
    const dmIdentity = input.accountKind === "alternate" ? `你正使用自己的小号“${input.accountProfile?.name || "小号"}”回复私信；对外身份是“${input.accountProfile?.identity || "未设定"}”。不要凭空向陌生人揭穿与大号的关系。` : "";
    instruction = `${stateRule}\n你正在推特私信中回复。${dmIdentity}${anonymous ? "发送者是陌生的匿名用户；不可根据其他 App 的用户身份或共同历史揭穿身份，除非本次匿名对话明确提供证据。保持角色本人的边界与性格。" : "与公开发帖不同，这里是一对一私信，可以参考真实关系。"}\n本次会话：\n${history || "暂无消息"}${quoted}\n自然回应最近的消息；可拆成 1 至 3 条独立短信。${shared}\nJSON 格式：{"lines":[{"original":"第一条原文","translated":"第一条中文译文"}]}`;
  }
  const messages: LLMMessage[] = [...prompt, { role: "system", content: instruction }, { role: "user", content: "现在自然地回复。" }];
  const raw = await sendLLMRequest(apiConfig, preset, messages, regexes, { characterName: character.name, userName: anonymous ? "匿名用户" : identity?.name || input.state.profile.name }, { appId: "twitter", appTags: ["twitter", input.kind], skipOutputRegex: true });
  const lines = parseLines(raw);
  if (!lines.length) throw new Error("这次没有生成有效内容，请重试。");
  const result = (input.kind === "dm" ? lines : lines.slice(0, 1)) as TwitterGeneratedLine[] & { comments?: TwitterCommentDraft[] };
  if (input.kind === "post" && input.withComments) {
    try {
      const object = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as { comments?: TwitterCommentDraft[] };
      result.comments = Array.isArray(object.comments) ? object.comments.filter(c => typeof c?.original === "string" && !!c.original.trim()).slice(0, 10) : [];
    } catch { result.comments = []; }
  }
  return result;
}
