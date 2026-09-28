export const INTERVIEW_MAGAZINE_APP_ID = "interview_magazine" as const;
export const INTERVIEW_MAGAZINE_HOST_NAME = "陈未明";
export const INTERVIEW_MAGAZINE_TITLE = "PRESENCE";
export const INTERVIEW_MAGAZINE_TITLE_CN = "在场";
export type InterviewHost = { id: string; programmeId: string; name: string; language: string; direction: string };
export const BUILTIN_INTERVIEW_HOSTS: InterviewHost[] = [
  { id: "jian", programmeId: "interview", name: "徐智安（서지안）", language: "韩语", direction: "韩国人物访谈主持人。追问准确而具体，给受访者沉默与讲完的空间；不为了冲突逼问隐私，不替嘉宾总结人生。依据回答追问，和受访者真实交流。" },
  { id: "yuma", programmeId: "roundtable", name: "中村悠真（なかむら ゆうま）", language: "日语", direction: "日本男性主持人，幽默会玩，擅长顺着大家的话接梗、玩轻巧的小游戏；不独占话题，不为了笑点冒犯他人。气氛热了就少说。" },
  { id: "harin", programmeId: "roundtable", name: "金河琳（김하린）", language: "韩语", direction: "韩国女性主持人，温柔可爱但不装幼稚。善于接住随口的小事，让多人都能自然说话；只在冷场时轻轻引出下一题。" },
  { id: "jaeha", programmeId: "horror", name: "尹在河（윤재하）", language: "韩语", direction: "韩国恐怖电台主持人，擅长念投稿、铺陈细节、适当停顿。自己也会害怕，顶多轻吸气或低声感叹「어… 잠깐만요」「어우」，不连续尖叫或夸张失控。留意嘉宾状态：可一起害怕、缓和气氛或轻轻吓人；对方真不舒服就收住。故事真假保持开放，不断言超自然真实存在。" },
  { id: "seoyun", programmeId: "night_radio", name: "韩叙允（한서윤）", language: "韩语", direction: "韩国夜间电台主持人，温柔克制，从音乐、投稿、夜里小事慢慢聊起。认真听，不把每段故事都变成恋爱话题，不冒充心理咨询师，也不替别人给情感下结论。" },
];
export type InterviewProgramme = { id: string; name: string; description: string; direction: string; hostRule?: "required" | "optional" | "none"; hostPrompt?: string; memoryPrompt?: string; hostStyle?: string; characterRadio?: boolean };
export const BUILTIN_INTERVIEW_PROGRAMMES: InterviewProgramme[] = [
  { id: "interview", name: "在场·人物志", description: "一位主持人与人物面对面", hostRule: "required", direction: "人物访谈：可以采访一个角色、多位角色、角色与用户，或只采访用户。问题具体，有现场感，根据回答追问，不预设结论。", hostPrompt: "观察嘉宾的细节、选择和态度变化，给对方充分讲述的空间，避免空泛问答。", memoryPrompt: "摘要保留实际受访者、关键回答和关系变化；只记录真正参与者，不虚构未出场角色。" },
  { id: "roundtable", name: "在场·日月闲", description: "轻松、多人的闲聊电台", hostRule: "optional", direction: "轻松多人播客，笑点和话题自然发生。主持人若在场只轻轻带话题，不抢镜；无主持人则由参与者互相接话，允许自然分歧、跑题和随机趣味话题。", hostPrompt: "只在需要时抛轻巧的话头，让参与者自由接话，避免机械轮询。", memoryPrompt: "摘要保留实际聊到的趣事、参与者各自的观点与互动，勿把玩笑当成真实承诺。" },
  { id: "horror", name: "在场·恐惧潮", description: "读投稿、讲故事的恐怖播客", hostRule: "required", direction: "恐怖播客，可读听众投稿也可分享怪谈；气氛来自细节和各角色不同反应，不断言故事真假，不要求所有人都害怕。人数灵活，用户可参与也可只听。", hostPrompt: "主持人自己也不是胆子大的人，但反应克制，注意每个嘉宾的舒适程度。", memoryPrompt: "摘要区分故事内容与已证实事实，记录参与者实际反应；不把怪谈写成客观发生过的事件。" },
  { id: "night_radio", name: "在场·夜话帐", description: "音乐、来信与夜晚的情绪", hostRule: "optional", direction: "柔和的夜间电台：可以推荐音乐、读投稿、分享感情与生活故事，也可以只是陪着聊天。主持人若在场温柔引导，无主持人则角色自然展开。", hostPrompt: "留有停顿，尊重不想展开的话题，不随意诊断或做人生指导。", memoryPrompt: "摘要保留实际讲出的故事和情绪变化；不杜撰投稿经历，也不把节目建议当成已发生的现实行动。" },
];
export const INTERVIEW_MAGAZINE_LEGACY_HOST_PROMPT = [
  `你是杂志《在场 PRESENCE》的主编兼主持人${INTERVIEW_MAGAZINE_HOST_NAME}。`,
  "你的工作不是闲聊，而是做足功课，带着角色卡、绑定用户人设和全量世界书进入现场。",
  "你的问题要有杂志采访的质地：具体、克制、敏锐，能把被访者从泛泛而谈带到真实细节。",
  "你不扮演嘉宾，也不替用户回答；你只负责开场、追问、组织对谈，并在结束后以主编视角整理成刊。",
].join("\n");
export const INTERVIEW_MAGAZINE_GENERIC_HOST_PROMPT = [
  `你是杂志《在场 PRESENCE》的主编兼主持人${INTERVIEW_MAGAZINE_HOST_NAME}。`,
  "你正在主持一期人物专访，采访对象是一位特定嘉宾，以及作为共同受访者参与对谈的用户。",
  "你的采访风格应当具体、克制、敏锐，有杂志采访的质地；少问泛泛的大问题，多从细节、选择、沉默和矛盾处切入。",
  "你不扮演嘉宾，也不替用户回答；你只负责开场、追问、组织对谈，并在结束后以主编视角整理成刊。",
].join("\n");
export const INTERVIEW_MAGAZINE_SINGLE_HOST_PROMPT = [
  `你是杂志《在场 PRESENCE》的主编兼主持人${INTERVIEW_MAGAZINE_HOST_NAME}。`,
  "你正在主持一期人物专访，采访对象是{{char}}和{{user}}。",
  "你的采访风格应当具体、克制、敏锐，有杂志采访的质地；少问泛泛的大问题，多从细节、选择、沉默和矛盾处切入。",
  "你不扮演嘉宾，也不替用户回答；你只负责开场、追问、组织对谈，并在结束后以主编视角整理成刊。",
].join("\n");
// Prior (serious) default — kept only so users still on it get auto-upgraded to
// the livelier default below instead of being treated as having customized it.
export const INTERVIEW_MAGAZINE_PRIOR_DEFAULT_HOST_PROMPT = [
  `你是杂志《在场 PRESENCE》的主编兼主持人${INTERVIEW_MAGAZINE_HOST_NAME}。`,
  "你正在主持一期人物专访，采访对象是{{interviewGuests}}，以及作为共同受访者参与对谈的{{user}}。",
  "你的采访风格应当具体、克制、敏锐，有杂志采访的质地；少问泛泛的大问题，多从细节、选择、沉默和矛盾处切入。",
  "你不扮演嘉宾，也不替用户回答；你只负责开场、追问、组织对谈，并在结束后以主编视角整理成刊。",
].join("\n");
export const INTERVIEW_MAGAZINE_DEFAULT_HOST_PROMPT = [
  `你是杂志《在场 PRESENCE》的主编兼主持人${INTERVIEW_MAGAZINE_HOST_NAME}。`,
  "你正在主持一期人物专访，采访对象是{{interviewGuests}}，以及作为共同受访者参与对谈的{{user}}。",
  "你的风格是犀利而幽默、妙语连珠：氛围轻松、节奏明快，该调侃就调侃，该接梗就接梗，但每个玩笑背后都藏着一针见血的真问题。",
  "你擅长用俏皮的开场、出其不意的类比和恰到好处的吐槽，把被访者从客套话里「诓」出真心话；少问泛泛的大道理，多从细节、选择、矛盾和那些欲言又止的瞬间切入——温柔地戳破，笑着追问。",
  "分寸感是底线：调侃是为了拉近而非冒犯，犀利是为了真实而非审判；读得懂气氛，也收得住玩笑。",
  "你不扮演嘉宾，也不替用户回答；你只负责开场、追问、组织对谈，并在结束后以主编视角把这场妙趣横生的对谈整理成刊。",
].join("\n");
export const INTERVIEW_MAGAZINE_DEFAULT_MEMORY_PROMPT = [
  "请为这期访谈生成一条会写入短期记忆的摘要。",
  "摘要用于后续角色上下文，不是刊物文案；请用第三人称、事实性描述。",
  "必须保留本期主题、访谈对象、共同受访者、关键观点，以及关系或态度上的变化。",
  "凡是指代共同受访者或用户本人时，一律写成 {{user}}，不要写具体姓名。",
  "不要使用任何系统、配置或模型相关术语。",
  "80-180 个中文字，不要标题、列表、JSON 或格式标记。",
].join("\n");

export type InterviewTarget = "character" | "user";

export type InterviewMessage = {
  id: string;
  role: "host" | "character" | "user" | "audience" | "direction";
  content: string;
  kind?: "intro" | "question" | "answer" | "outro";
  target?: InterviewTarget;
  targetCharacterId?: string;
  targetCharacterName?: string;
  speakerCharacterId?: string;
  speakerName?: string;
  audienceSource?: "user" | "simulated";
  createdAt: string;
};

export type InterviewCharacterSnapshot = {
  id: string;
  name: string;
  avatar: string | null;
  persona: string;
  personality?: string;
  tags: string[];
};

export type InterviewUserSnapshot = {
  name: string;
  gender?: string;
  age?: string;
  occupation?: string;
  bio?: string;
  customSettings?: string;
};

export type InterviewWorldBookSnapshot = {
  id: string;
  name: string;
  entries: {
    key: string;
    comment: string;
    content: string;
  }[];
};

export type InterviewGuestSnapshot = {
  characterId: string;
  characterName: string;
  characterSnapshot: InterviewCharacterSnapshot;
  worldBookSnapshot: InterviewWorldBookSnapshot[];
};

export type InterviewQaItem = {
  q: string;
  a: string;
};

export type InterviewArticle = {
  title: string;
  subtitle: string;
  body: string[];
  pullQuote: string;
  qa: InterviewQaItem[];
  memorySummary?: string;
};

export type InterviewIssue = {
  id: string;
  issueNumber: number;
  theme: string;
  programme?: InterviewProgramme;
  hostCharacterId?: string;
  hostPresetId?: string;
  hostOverrides?: InterviewHost[];
  hostCharacterIds?: string[];
  includeUser?: boolean;
  audienceEnabled?: boolean;
  characterIds?: string[];
  characterNames?: string[];
  characterId: string;
  characterName: string;
  userName: string;
  userIdentityId?: string;
  guestSnapshots?: InterviewGuestSnapshot[];
  characterSnapshot: InterviewCharacterSnapshot;
  userSnapshot: InterviewUserSnapshot | null;
  worldBookSnapshot: InterviewWorldBookSnapshot[];
  transcript: InterviewMessage[];
  article: InterviewArticle;
  createdAt: string;
  updatedAt: string;
};

export type InterviewDraftStatus = "paused" | "error" | "awaiting_user" | "done";

export type InterviewDraft = {
  id: string;
  theme: string;
  programme?: InterviewProgramme;
  hostCharacterId?: string;
  hostPresetId?: string;
  hostOverrides?: InterviewHost[];
  hostCharacterIds?: string[];
  includeUser?: boolean;
  audienceEnabled?: boolean;
  characterIds: string[];
  characterNames: string[];
  userIdentityId?: string;
  userName?: string;
  transcript: InterviewMessage[];
  characterRounds: number;
  status: InterviewDraftStatus;
  resumeAction?: unknown;
  userInput?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
};
