import { getChatImageFromIndexedDB } from "./chat-asset-storage";
import { sendLLMRequest } from "./chat-engine";
import type { LLMContentPart, LLMMessage } from "./llm-prompt-assembler";
import { loadApiConfigs, loadBindingConfig } from "./settings-storage";
import { loadPhotoLibrary, updatePhotoRecord } from "./photo-library-storage";
import type { PhotoAppearance, PhotoPersonSlot, PhotoRecord } from "./photo-library-types";

export const PHOTO_VISION_BATCH_SIZE = 4;

export type PhotoVisionResult = {
  photoId: string;
  summary?: string;
  subject?: string;
  appearance?: PhotoAppearance;
  people?: PhotoPersonSlot[];
  tags?: string[];
};

function resolvePhotoVisionApi() {
  const configs = loadApiConfigs();
  const binding = loadBindingConfig();
  const globalId = binding.globalDefaults.apiConfigId;
  return (globalId ? configs.find((item) => item.id === globalId) : undefined) ?? configs[0] ?? null;
}

function clean(value: unknown, max = 500): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim().slice(0, max);
  return text || undefined;
}

function normalizeAppearance(raw: unknown): PhotoAppearance | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const item = raw as Record<string, unknown>;
  const appearance: PhotoAppearance = {
    hair: clean(item.hair, 140),
    accessories: clean(item.accessories, 180),
    outfit: clean(item.outfit, 220),
    season: clean(item.season, 100),
    scene: clean(item.scene, 220),
  };
  return Object.values(appearance).some(Boolean) ? appearance : undefined;
}

function normalizePeople(raw: unknown): PhotoPersonSlot[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 12).flatMap((item, index) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    return [{
      id: clean(record.id, 80) || `person_${index + 1}`,
      position: clean(record.position, 100),
      appearance: normalizeAppearance(record.appearance) ?? {},
    }];
  });
}

function normalizeTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return Array.from(new Set(raw
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)))
    .slice(0, 24);
}

function parseJsonArray(text: string): unknown[] {
  const stripped = text
    .replace(/^\s*```(?:json)?/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  try {
    const parsed = JSON.parse(stripped);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === "object" && Array.isArray((parsed as { results?: unknown }).results)) {
      return (parsed as { results: unknown[] }).results;
    }
  } catch {
    const start = stripped.indexOf("[");
    const end = stripped.lastIndexOf("]");
    if (start >= 0 && end > start) {
      try {
        const parsed = JSON.parse(stripped.slice(start, end + 1));
        if (Array.isArray(parsed)) return parsed;
      } catch { /* ignore */ }
    }
  }
  throw new Error("识图结果不是有效 JSON");
}

function normalizeResult(raw: unknown, fallbackPhotoId: string): PhotoVisionResult {
  const item = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  return {
    photoId: clean(item.photoId, 180) || fallbackPhotoId,
    summary: clean(item.summary, 800),
    subject: clean(item.subject, 160),
    appearance: normalizeAppearance(item.appearance),
    people: normalizePeople(item.people),
    tags: normalizeTags(item.tags),
  };
}

function buildVisionPrompt(photoIds: string[]): string {
  return [
    "你正在为一个角色照片库做视觉索引。请逐张分析图片，只描述肉眼可见内容，不猜真人身份、姓名、职业、关系或拍摄日期。",
    "这套索引以后用于角色从自己的照片库里寻找合适图片，所以描述要具体、可检索，但不要写文学化废话。",
    "",
    "重点字段尽量精简，只保留：发色、配饰（眼镜/耳钉/项链/帽子等合并）、穿搭、季节倾向、场景。",
    "- 如果画面只有一个主要人物：appearance 写这个人的特征；people 也可以写 person_1。",
    "- 如果画面有多人：people 必须按从左到右/前到后依次拆成 person_1、person_2……，每个人分别写 hair/accessories/outfit/season/scene，并在 position 写清楚位置。不要猜他们是谁。",
    "- 如果没有人物：appearance 可以只写 season/scene；subject 写宠物、食物、风景、物品、建筑等自然类别。",
    "- hair 不限制固定发色枚举，直接自然描述，如‘浅金色短发’‘黑色中长发’‘红棕色挑染’。",
    "- season 只能写可见线索推断，例如‘夏天倾向’‘冬天倾向’‘无法判断’，不要根据当前真实日期猜。",
    "- summary 用一句话概括画面，tags 给 3~10 个检索词。",
    "",
    "严格只返回 JSON 数组，不要 Markdown，不要解释。数组每项格式：",
    '{"photoId":"对应ID","summary":"一句话","subject":"主体类别","appearance":{"hair":"","accessories":"","outfit":"","season":"","scene":""},"people":[{"id":"person_1","position":"左侧","appearance":{"hair":"","accessories":"","outfit":"","season":"","scene":""}}],"tags":["词1","词2"]}',
    "",
    `本批 photoId 顺序：${photoIds.join(" | ")}`,
  ].join("\n");
}

async function analyzeBatch(records: PhotoRecord[], signal?: AbortSignal): Promise<PhotoVisionResult[]> {
  const apiConfig = resolvePhotoVisionApi();
  if (!apiConfig) throw new Error("还没有配置可用的聊天 API");
  if (apiConfig.enableImageRecognition !== true) throw new Error("当前 API 没有开启图像识别");

  const parts: LLMContentPart[] = [{ type: "text", text: buildVisionPrompt(records.map((record) => record.id)) }];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const dataUrl = await getChatImageFromIndexedDB(record.assetId);
    if (!dataUrl) throw new Error(`无法读取第 ${index + 1} 张照片`);
    parts.push({ type: "text", text: `图片 ${index + 1} · photoId=${record.id}` });
    parts.push({ type: "image_url", image_url: { url: dataUrl, detail: "low" } });
  }

  const messages: LLMMessage[] = [{ role: "user", content: parts }];
  const raw = await sendLLMRequest(apiConfig, null, messages, [], undefined, {
    skipOutputRegex: true,
    appId: "photos",
    appTags: ["photos", "vision"],
    signal,
  });
  const parsed = parseJsonArray(raw);
  return records.map((record, index) => normalizeResult(parsed[index], record.id));
}

function mergeAiResult(record: PhotoRecord, result: PhotoVisionResult): Partial<PhotoRecord> {
  const manual = new Set(record.manualFields ?? []);
  const patch: Partial<PhotoRecord> = {
    visionStatus: "done",
    visionError: undefined,
  };
  if (!manual.has("visionSummary")) patch.visionSummary = result.summary;
  if (!manual.has("subject")) patch.subject = result.subject;
  if (!manual.has("appearance")) patch.appearance = result.appearance;
  if (!manual.has("people")) {
    // 保留用户已经做过的人物槽位→角色映射，只刷新视觉内容。
    const mapped = new Map((record.people ?? []).map((person) => [person.id, person.mappedCharacterId]));
    patch.people = (result.people ?? []).map((person) => ({ ...person, mappedCharacterId: mapped.get(person.id) }));
  }
  if (!manual.has("visionTags")) patch.visionTags = result.tags;
  return patch;
}

export async function analyzePhotos(photoIds: string[], options?: { signal?: AbortSignal }): Promise<void> {
  const uniqueIds = Array.from(new Set(photoIds.filter(Boolean)));
  for (let offset = 0; offset < uniqueIds.length; offset += PHOTO_VISION_BATCH_SIZE) {
    const batchIds = uniqueIds.slice(offset, offset + PHOTO_VISION_BATCH_SIZE);
    const state = loadPhotoLibrary();
    const records = batchIds
      .map((id) => state.photos.find((photo) => photo.id === id))
      .filter((photo): photo is PhotoRecord => Boolean(photo));
    if (records.length === 0) continue;
    records.forEach((record) => updatePhotoRecord(record.id, { visionStatus: "pending", visionError: undefined }));
    try {
      const results = await analyzeBatch(records, options?.signal);
      for (const record of records) {
        const latest = loadPhotoLibrary().photos.find((photo) => photo.id === record.id) ?? record;
        const result = results.find((item) => item.photoId === record.id) ?? results[records.indexOf(record)];
        updatePhotoRecord(record.id, result ? mergeAiResult(latest, result) : { visionStatus: "failed", visionError: "模型没有返回这张照片的分析" });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      records.forEach((record) => updatePhotoRecord(record.id, { visionStatus: "failed", visionError: message }));
    }
  }
}

export function analyzePhotosInBackground(photoIds: string[]): void {
  void analyzePhotos(photoIds).catch((error) => console.warn("[PhotosVision] background analysis failed", error));
}

export function appearanceToText(appearance?: PhotoAppearance): string {
  if (!appearance) return "";
  return [
    appearance.hair ? `发色/发型：${appearance.hair}` : "",
    appearance.accessories ? `配饰：${appearance.accessories}` : "",
    appearance.outfit ? `穿搭：${appearance.outfit}` : "",
    appearance.season ? `季节：${appearance.season}` : "",
    appearance.scene ? `场景：${appearance.scene}` : "",
  ].filter(Boolean).join("；");
}

export function photoTraitsTextForCharacter(photo: PhotoRecord, characterId?: string): string {
  const mapped = characterId ? (photo.people ?? []).find((person) => person.mappedCharacterId === characterId) : undefined;
  if (mapped) return appearanceToText(mapped.appearance);
  if ((photo.people ?? []).length === 1) return appearanceToText(photo.people?.[0]?.appearance);
  if ((photo.people ?? []).length > 1) return "";
  return appearanceToText(photo.appearance);
}
