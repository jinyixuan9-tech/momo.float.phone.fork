export type TheqooTranslationMode = "original" | "chinese" | "folded" | "repost";
export type TheqooUiLanguage = "ko" | "zh";

export type TheqooTranslatorConfig = {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  model: string;
};

export type TheqooComment = {
  id: string;
  original: string;
  translated: string;
  createdAt: number;
  authoredByUser?: boolean;
  authoredByOP?: boolean;
  pendingRefresh?: boolean;
};

export type TheqooImage = {
  id: string;
  kind: "text" | "generated";
  /** 文字图始终保存中文。旧字段名为兼容既有数据继续保留。 */
  originalText?: string;
  translatedText?: string;
  mediaRef?: string;
  /** 生图描述始终保存中文。 */
  prompt?: string;
};

export type TheqooPost = {
  id: string;
  category: string;
  /** 同一事件的稳定主题标识，用于避免重复生成。旧帖可缺省。 */
  topicKey?: string;
  titleOriginal: string;
  titleTranslated: string;
  bodyOriginal: string;
  bodyTranslated: string;
  createdAt: number;
  views: number;
  comments: TheqooComment[];
  favorite: boolean;
  authoredByUser?: boolean;
  imageRef?: string;
  imagePrompt?: string;
  images?: TheqooImage[];
};

export type TheqooState = {
  uiLanguage: TheqooUiLanguage;
  /** false 时论坛内容只生成/显示中文，且不调用翻译 API。 */
  translationEnabled: boolean;
  translationMode: TheqooTranslationMode;
  translator: TheqooTranslatorConfig;
  worldBookIds: string[];
  includeCalendar: boolean;
  includeWeverseSchedule: boolean;
  posts: TheqooPost[];
};

const KEY = "ai_phone_theqoo_state_v1";

const now = Date.now();
const demoPosts: TheqooPost[] = [
  {
    id: "theqoo_demo_1",
    category: "일상토크",
    titleOriginal: "오늘 카페 갔는데 어떤 남돌이 있었음 ㅋㅋㅋ",
    titleTranslated: "今天去咖啡店结果遇到了某个男爱豆哈哈哈",
    bodyOriginal: "친구랑 카페에서 수다 떨고 있는데 갑자기 익숙한 목소리가 들려서 봤더니 진짜로 내가 좋아하는 사람이 앉아있더라 ㅠㅠ 너무 놀라서 심장 떨어지는 줄 알았어. 근데 실물 진짜 말도 안 되게 잘생겼고 엄청 친절했음. 짧게나마 말도 했는데 평소랑 똑같이 다정해서 더 좋았어 ㅠㅠ",
    bodyTranslated: "和朋友在咖啡店聊天时，突然听到一个很熟悉的声音，一看居然真的是我喜欢的人坐在那里ㅠㅠ 太惊讶了，感觉心脏都要掉出来了……但本人真的帅得不像话，而且超级亲切。虽然只说了很短的话，但还是像平时一样温柔，更喜欢他了ㅠㅠ",
    createdAt: now - 1000 * 60 * 18,
    views: 12348,
    favorite: false,
    comments: [
      { id: "c1", original: "헐 카페에서도 빛이 나나... 진짜 대단하다", translated: "哇 在咖啡店也会发光吗……真的太厉害了", createdAt: now - 1000 * 60 * 17 },
      { id: "c2", original: "실물은 진짜 다르다던데 역시구나 ㅠㅠㅠ", translated: "都说本人和照片真的不一样 果然是这样啊ㅠㅠㅠ", createdAt: now - 1000 * 60 * 16 },
      { id: "c3", original: "카페 어디야? 나도 가보고 싶다 ㅋㅋㅋㅋ", translated: "是哪个咖啡店啊？我也好想去看看ㅋㅋㅋㅋ", createdAt: now - 1000 * 60 * 15, authoredByOP: true },
    ],
  },
  {
    id: "theqoo_demo_2",
    category: "이슈",
    titleOriginal: "회사에서 이 정도 실수면 잘린다 vs 안 잘린다",
    titleTranslated: "公司里犯这种程度的错 会被开除 vs 不会被开除",
    bodyOriginal: "내 친구 회사 얘기인데 의견이 완전 갈려서 궁금함. 본인은 실수 인정했고 바로 수습했다고 함.",
    bodyTranslated: "是我朋友公司的事，大家意见完全分裂所以有点好奇。当事人承认了错误，也马上进行了补救。",
    createdAt: now - 1000 * 60 * 49,
    views: 32118,
    favorite: false,
    comments: [
      { id: "c4", original: "수습했으면 한 번은 넘어갈 듯", translated: "如果已经补救了 感觉第一次会放过", createdAt: now - 1000 * 60 * 45 },
      { id: "c5", original: "업종 따라 너무 다를 것 같은데", translated: "感觉会根据行业差很多吧", createdAt: now - 1000 * 60 * 42 },
    ],
  },
  {
    id: "theqoo_demo_3",
    category: "정보",
    titleOriginal: "요즘 다시 유행한다는 이 가방 실물.jpg",
    titleTranslated: "最近又重新流行起来的这款包 实物图.jpg",
    bodyOriginal: "사진보다 실물이 훨씬 괜찮더라. 수납도 생각보다 많이 됨.",
    bodyTranslated: "实物比照片好看很多，容量也比想象中大。",
    createdAt: now - 1000 * 60 * 76,
    views: 25673,
    favorite: false,
    comments: [
      { id: "c6", original: "이거 색 뭐가 제일 예쁨?", translated: "这个哪个颜色最好看？", createdAt: now - 1000 * 60 * 71 },
    ],
  },
];

export const defaultTheqooState = (): TheqooState => ({
  uiLanguage: "ko",
  translationEnabled: true,
  translationMode: "repost",
  translator: {
    enabled: false,
    baseUrl: "https://api.siliconflow.cn/v1",
    apiKey: "",
    model: "deepseek-ai/DeepSeek-V4-Flash",
  },
  worldBookIds: [],
  includeCalendar: false,
  includeWeverseSchedule: false,
  posts: demoPosts,
});

export function loadTheqooState(): TheqooState {
  if (typeof window === "undefined") return defaultTheqooState();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultTheqooState();
    const parsed = JSON.parse(raw) as Partial<TheqooState> & { includeWeverseSchedule?: boolean };
    const defaults = defaultTheqooState();
    const translator = parsed.translator && typeof parsed.translator === "object"
      ? { ...defaults.translator, ...parsed.translator }
      : defaults.translator;
    const mode = parsed.translationMode === "chinese" ? "repost" : parsed.translationMode;
    return {
      uiLanguage: parsed.uiLanguage === "zh" ? "zh" : "ko",
      translationEnabled: parsed.translationEnabled !== false,
      translationMode: mode || defaults.translationMode,
      translator,
      worldBookIds: Array.isArray(parsed.worldBookIds) ? parsed.worldBookIds : [],
      includeCalendar: parsed.includeCalendar === true,
      includeWeverseSchedule: parsed.includeWeverseSchedule === true,
      posts: Array.isArray(parsed.posts) ? parsed.posts : demoPosts,
    };
  } catch {
    return defaultTheqooState();
  }
}

export function saveTheqooState(state: TheqooState) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(state));
}
