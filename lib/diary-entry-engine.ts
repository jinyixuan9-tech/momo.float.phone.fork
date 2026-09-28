import { loadCharacters } from "./character-storage";
import type { Character } from "./character-types";
import { previewMessagesForApi, sendLLMRequest, ChatEngineError } from "./chat-engine";
import { assemblePromptPayload, type LLMMessage } from "./llm-prompt-assembler";
import { loadBindingConfig, loadApiConfigs, loadPresets, loadWorldBooks, loadRegexes, resolveBinding, resolveUserIdentity } from "./settings-storage";
import type { ApiConfig, PresetConfig, RegexConfig, WorldBookConfig } from "./settings-types";
import { loadMemoryConfig } from "./memory-storage";
import { retrieveCoreMemoriesForPrompt, retrieveMemoriesForPrompt } from "./memory-service";
import { formatCoreMemories, formatLongTermMemories } from "./memory-injector";
import { prepareShortTermContext } from "./short-term-assembler";
import { formatDiaryEntryContext, parseDiaryEntryContent, type ParsedDiaryEntry } from "./diary-entry-utils";
import type { DiaryEntry, DiaryEntryTrigger } from "./diary-entry-types";
import { beginDiaryGeneration, endDiaryGeneration } from "./diary-generating-tracker";

type ResolvedDiaryEntryGeneration = {
  character: Character;
  apiConfig: ApiConfig;
  preset: PresetConfig | null;
  regexes: RegexConfig[];
  messages: LLMMessage[];
  userName: string;
};

function addDiaryLanguageRule(messages: LLMMessage[]): LLMMessage[] {
  return [...messages, { role: "system", content: [
    "日记语言规则：根据角色设定中的国籍、母语和长期使用语言，让角色以自己的日常母语写日记；不要默认写中文，也不要把国籍当作唯一语言依据。",
    "原文的 title、mood、weather、tags、body 和 blocks 必须使用角色的日记语言。",
    "同时在 JSON 的 translation 字段输出对应的准确简体中文翻译，结构为 {title,mood,weather,tags,body,blocks}，blocks 与原文逐项对应且类型一致。",
    "中文原文无需重复翻译，可省略 translation；不要把译文写进原文段落。",
  ].join("\n") }];
}

async function resolveDiaryEntryGeneration(
  characterId: string,
  entries: DiaryEntry[],
): Promise<ResolvedDiaryEntryGeneration> {
  const character = loadCharacters().find(entry => entry.id === characterId);
  if (!character) throw new ChatEngineError("找不到要写日记的角色。");

  const bindings = loadBindingConfig();
  const slot = resolveBinding(bindings, character.id, "diary");
  if (!slot.apiConfigId) {
    throw new ChatEngineError(`未给「日记」绑定 ${character.name} 的 API 配置。`);
  }

  const apiConfig = loadApiConfigs().find(entry => entry.id === slot.apiConfigId);
  if (!apiConfig) throw new ChatEngineError(`找不到 ${character.name} 的 API 配置。`);

  const presets = loadPresets();
  let preset = slot.presetId ? presets.find(entry => entry.id === slot.presetId) ?? null : null;
  if (!preset) preset = presets.find(entry => entry.builtIn) ?? null;

  const allWorldBooks = loadWorldBooks();
  const worldBooks = (slot.worldBookIds || [])
    .map(id => allWorldBooks.find(entry => entry.id === id))
    .filter(Boolean) as WorldBookConfig[];

  const allRegexes = loadRegexes();
  const regexes = (slot.regexIds || [])
    .map(id => allRegexes.find(entry => entry.id === id))
    .filter(Boolean) as RegexConfig[];

  const userIdentity = resolveUserIdentity(character.id, "diary");
  const userName = userIdentity?.name ?? "用户";
  const memConfig = loadMemoryConfig();
  const prepared = prepareShortTermContext(character.id, "diary", { history: [] });

  const [memories, coreMemories] = await Promise.all([
    retrieveMemoriesForPrompt(character.id, prepared.wbActivationContext, memConfig).catch(() => []),
    retrieveCoreMemoriesForPrompt(character.id, memConfig).catch(() => []),
  ]);

  const messages = assemblePromptPayload({
    character,
    history: [],
    preset,
    worldBooks,
    regexes,
    userIdentity,
    appId: "diary",
    appTags: ["diary", "entries"],
    longTermMemories: formatLongTermMemories(memories),
    coreMemories: formatCoreMemories(coreMemories),
    worldBookActivationContext: prepared.wbActivationContext,
    recentBlocks: prepared.recentBlocks,
    unifiedRecentItems: prepared.unifiedRecentItems,
    diaryEntryContext: formatDiaryEntryContext(entries),
  });

  return { character, apiConfig, preset, regexes, messages, userName };
}

export async function generateDiaryEntryForCharacter(
  characterId: string,
  entries: DiaryEntry[],
  _trigger: DiaryEntryTrigger = "manual",
): Promise<ParsedDiaryEntry> {
  // Tracked at the engine so every caller (manual + background timer) shows up
  // in the diary app's "generating" indicator, even across app re-entry.
  beginDiaryGeneration(characterId);
  try {
    const resolved = await resolveDiaryEntryGeneration(characterId, entries);
    const messages = addDiaryLanguageRule(resolved.messages);
    const raw = await sendLLMRequest(
      resolved.apiConfig,
      resolved.preset,
      messages,
      resolved.regexes,
      { characterName: `日记:${resolved.character.name}`, userName: resolved.userName },
      { appId: "diary", appTags: ["diary", "entries"] },
    );
    return parseDiaryEntryContent(raw);
  } finally {
    endDiaryGeneration(characterId);
  }
}

export async function previewDiaryEntryPromptPayload(
  characterId: string,
  entries: DiaryEntry[],
): Promise<{ messages: LLMMessage[]; characterName: string; model: string; presetName: string }> {
  const resolved = await resolveDiaryEntryGeneration(characterId, entries);
  return {
    messages: previewMessagesForApi(resolved.apiConfig, resolved.preset, addDiaryLanguageRule(resolved.messages)),
    characterName: `日记:${resolved.character.name}`,
    model: resolved.apiConfig.defaultModel,
    presetName: resolved.preset?.name ?? "默认预设",
  };
}

export async function translateDiaryEntry(entry: DiaryEntry): Promise<NonNullable<DiaryEntry["translation"]>> {
  const resolved = await resolveDiaryEntryGeneration(entry.characterId, []);
  const raw = await sendLLMRequest(
    resolved.apiConfig, resolved.preset,
    [
      { role: "system", content: "你是翻译员。将角色日记准确翻译成简体中文，保留原文的段落和区块类型。只返回 JSON：{title,mood,weather,tags,body,blocks}；blocks 与输入逐项对应。不要续写或加入评论。" },
      { role: "user", content: JSON.stringify({ title: entry.title, mood: entry.mood, weather: entry.weather, tags: entry.tags, body: entry.body, blocks: entry.blocks }) },
    ],
    resolved.regexes,
    { characterName: `日记翻译:${resolved.character.name}`, userName: resolved.userName },
    { skipOutputRegex: true, appId: "diary", appTags: ["diary", "translation"] },
  );
  const parsed = parseDiaryEntryContent(raw);
  if (!parsed.body.trim()) throw new Error("翻译没有返回内容");
  return { title: parsed.title, mood: parsed.mood, weather: parsed.weather, tags: parsed.tags, body: parsed.body, blocks: parsed.blocks };
}
