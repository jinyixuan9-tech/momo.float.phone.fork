import { loadCharacters } from "./character-storage";
import { sendLLMRequest } from "./chat-engine";
import { assemblePromptPayload, type LLMMessage } from "./llm-prompt-assembler";
import { prepareShortTermContext } from "./short-term-assembler";
import { loadMemoryConfig } from "./memory-storage";
import { retrieveCoreMemoriesForPrompt, retrieveMemoriesForPrompt } from "./memory-service";
import { formatCoreMemories, formatLongTermMemories } from "./memory-injector";
import { buildCharacterTimeContext } from "./character-time";
import { loadApiConfigs, loadBindingConfig, loadPresets, loadRegexes, resolveBinding, resolveUserIdentity } from "./settings-storage";
import type { RegexConfig } from "./settings-types";
import { selectedTwitterWorldBooks } from "./twitter-worldbooks";
import { roleSocialContext } from "./role-social-sources";
import { isPublicTwitterPost, twitterClueGuidance, twitterPublicAddress, type TwitterMessage, type TwitterPost, type TwitterState } from "./twitter-storage";

export type TwitterGeneratedLine = { original: string; translated: string; photoDescription?: string };
export type TwitterCommentDraft = { name: string; handle: string; original: string; translated?: string };

function parseLines(text: string): TwitterGeneratedLine[] {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
  try {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    const row = JSON.parse(start >= 0 && end > start ? trimmed.slice(start, end + 1) : trimmed) as { lines?: Array<{ original?: string; translated?: string; photoDescription?: string }>; original?: string; translated?: string; photoDescription?: string };
    const lines = Array.isArray(row.lines) ? row.lines : [row];
    return lines.map(line => ({ original: String(line.original || "").trim(), translated: String(line.translated || line.original || "").trim(), photoDescription: String(line.photoDescription || "").trim().slice(0, 350) || undefined }))
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
  accountProfile?: { name: string; identity?: string; visibility?: "public" | "protected"; disclosure?: "independent" | "full" | "clues"; disclosureClues?: string; allowClueProgression?: boolean };
  accountKind?: "alternate" | "group";
  communityName?: string;
  withComments?: boolean;
}): Promise<TwitterGeneratedLine[] & { comments?: TwitterCommentDraft[] }> {
  const character = loadCharacters().find(row => row.id === input.characterId);
  if (!character) throw new Error("角色已不存在。");
  const slot = resolveBinding(loadBindingConfig(), character.id, "twitter");
  const configs = loadApiConfigs();
  const apiConfig = slot.apiConfigId ? configs.find(row => row.id === slot.apiConfigId) : configs.find(row => row.apiKey?.trim()) || configs[0];
  if (!apiConfig) throw new Error(slot.apiConfigId ? "当前角色／X 绑定的文字 API 已不存在，请检查绑定。" : "先在设置中配置文字 API，才能生成角色内容。");
  if (!apiConfig.apiKey?.trim()) throw new Error(`当前角色／X 绑定的文字 API「${apiConfig.name || apiConfig.provider}」没有填写 Key，请在小手机设置中检查。`);
  const presets = loadPresets();
  const preset = presets.find(row => row.id === slot.presetId) ?? presets.find(row => row.builtIn) ?? null;
  const worldBooks = selectedTwitterWorldBooks(input.state);
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
  const publicRule = `X 的帖子和回复是公开的。你可以有私下记忆，但不得随意公开地下关系、私人聊天内容或未公开身份。用户主账号在 X 上的昵称是“${input.state.profile.name}”，网友对用户的称呼是“${twitterPublicAddress(input.state)}”；公开发言和生成的路人评论不得仅凭私下人设或记忆知道其本名就公开使用。`;
  const linkedSources = anonymous ? "" : roleSocialContext(character.id, input.state.socialSourcesByCharacter[character.id]);
  const sourceRule = linkedSources ? `本人可参考关联来源：${linkedSources}。日历不是公开信息；发公开帖子或回复时只可提已公开的活动，不得泄漏私人安排。` : "";
  const stateRule = input.state.worldRules.trim() ? `补充世界观：${input.state.worldRules.slice(0, 2500)}` : "";
  const shared = "以角色平常使用的语言写 original；如果不是中文，translated 给准确自然的简体中文译文，中文原文则两字段相同。原文中的 #话题标签保留原文，不翻译、不改写标签。只输出 JSON，不要解释。";
  let instruction: string;
  if (input.kind === "post") {
    const recent = input.state.posts.filter(p => !p.replyToId && isPublicTwitterPost(input.state, p)).slice(-10).map(p => `${p.authorId === "user" ? twitterPublicAddress(input.state) : p.authorId === character.id ? character.name : "其他账号"}：${p.original}`).join("\n");
    const altId = `${character.id}:alt`;
    const priorClueDiscussion = input.accountKind === "alternate" && input.state.accounts[altId]?.allowClueProgression
      ? input.state.posts.filter(p => p.replyToId && input.state.posts.some(parent => parent.id === p.replyToId && parent.authorId === altId)).slice(-8).map(p => p.original.slice(0, 130)).join("；").slice(0, 800)
      : "";
    const accountRule = input.accountKind === "alternate" ? `你以副账号“${input.accountProfile?.name || "副账号"}”发帖；对外身份是“${input.accountProfile?.identity || "未设定"}”。${twitterClueGuidance(input.state, altId)}${priorClueDiscussion ? `此前网友公开讨论过：“${priorClueDiscussion}”。只依据之后实际公开的新线索变化，不要突然升级为实锤。` : ""}发帖时尊重本账号设定，不得仅凭幕后身份主动泄漏私密记忆。` : "";
    const communityRule = input.communityName ? `这条发在“${input.communityName.slice(0, 60)}”社区，内容要贴合社区主题，不能因关联角色而公开其未公开的小号。` : "";
    instruction = `${publicRule}\n${stateRule}\n${sourceRule}\n${accountRule}\n${communityRule}\n近期公开帖子：\n${recent || "暂无"}\n根据本人设定、记忆与时间，自然发布一条适合当前情境的新帖子，可以回应近期公开话题，但不要机械模仿。可偶尔发照片；只有这次确实想配图时才填写 photoDescription，描述照片的主体、人物或场景，便于从该账号可用相册匹配；不发图时留空。${shared}\nJSON 格式：{"original":"帖子原文","translated":"中文译文","photoDescription":"配图描述，若不发图则留空"${input.withComments ? ',"comments":[{"name":"路人昵称","handle":"路人账号","original":"短评论原文","translated":"中文译文"}]' : ""}}。${input.withComments ? "同时给 5 至 10 条自然的路人评论；路人只能依据公开内容，若有副账号线索，按上面的线索规则决定是否出现少量未经证实的猜测，不能因后台归属直接宣布身份。" : ""}`;
  } else if (input.kind === "reply") {
    if (!input.targetPost) throw new Error("找不到要回复的帖子。");
    instruction = `${publicRule}\n${stateRule}\n${sourceRule}\n你正在回复一条 X 帖子，内容：“${input.targetPost.original.slice(0, 900)}”。直接回应具体内容，自然简短，不要离题。${shared}\nJSON 格式：{"original":"回复原文","translated":"中文译文"}`;
  } else {
    const history = (input.conversation || []).slice(-20).map(m => `${m.role === "user" ? anonymous ? "匿名用户" : input.senderName || input.state.profile.name : input.accountKind === "alternate" ? input.accountProfile?.name || "小号" : character.name}：${m.original}`).join("\n");
    const quoted = input.replyToMessage ? `\n本次特别引用回复${input.replyToMessage.role === "user" ? "对方" : "你自己"}的这条私信：“${input.replyToMessage.original.slice(0, 500)}”。` : "";
    const dmIdentity = input.accountKind === "alternate" ? `你正使用自己的小号“${input.accountProfile?.name || "小号"}”回复私信；对外身份是“${input.accountProfile?.identity || "未设定"}”。不要凭空向陌生人揭穿与大号的关系。` : "";
    instruction = `${stateRule}\n你正在 X 私信中回复。${dmIdentity}${anonymous ? "发送者是陌生的匿名用户；不可根据其他 App 的用户身份或共同历史揭穿身份，除非本次匿名对话明确提供证据。保持角色本人的边界与性格。" : "与公开发帖不同，这里是一对一私信，可以参考真实关系。"}\n本次会话：\n${history || "暂无消息"}${quoted}\n自然回应最近的消息；可拆成 1 至 3 条独立短信。${shared}\nJSON 格式：{"lines":[{"original":"第一条原文","translated":"第一条中文译文"}]}`;
  }
  const messages: LLMMessage[] = [...prompt, { role: "system", content: instruction }, { role: "user", content: "现在自然地回复。" }];
  const raw = await sendLLMRequest(apiConfig, preset, messages, regexes, { characterName: character.name, userName: anonymous ? "匿名用户" : input.kind === "dm" ? identity?.name || input.state.profile.name : twitterPublicAddress(input.state) }, { appId: "twitter", appTags: ["twitter", input.kind], skipOutputRegex: true });
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
