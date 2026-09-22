export type PhotoVisionStatus = "unprocessed" | "pending" | "done" | "failed";

export type PhotoUsageChannel = "dm_user" | "moments" | "dm_char" | "bubble" | "sms" | "wvs" | "other";

export type PhotoUsageRecord = {
  channel: PhotoUsageChannel;
  characterId: string;
  targetId?: string;
  usedAt: number;
};

export type PhotoAppearance = {
  hair?: string;
  accessories?: string;
  outfit?: string;
  season?: string;
  scene?: string;
};

export type PhotoPersonSlot = {
  id: string;
  position?: string;
  mappedCharacterId?: string;
  appearance: PhotoAppearance;
};

export type PhotoSourceStrategy = "album_only" | "generated_only" | "album_then_generated";

export type CharacterCurrentTraits = {
  text: string;
  sourcePhotoId?: string;
  updatedAt: number;
};

export type PhotoRecord = {
  id: string;
  assetId: string;
  originalName?: string;

  /** 哪些角色可以把这张照片当作自己的照片库素材使用。 */
  linkedCharacterIds: string[];

  /** 真正的角色×角色共享关系。user 不参与 shared pair。 */
  sharedPairIds: string[];

  /** Photo Resolver 是否允许自动选中这张图。 */
  aiUsable: boolean;

  /** 自动识图。AI 结果只是初始建议，全部允许用户后续手改。 */
  visionStatus: PhotoVisionStatus;
  visionSummary?: string;
  subject?: string;
  appearance?: PhotoAppearance;
  people?: PhotoPersonSlot[];
  visionTags?: string[];
  visionError?: string;

  /** 用户人工修改过的字段名；重新识图默认不覆盖这些字段。 */
  manualFields?: string[];

  /** DM / 朋友圈等复用规则。 */
  usageHistory: PhotoUsageRecord[];

  createdAt: number;
  updatedAt: number;
};

export type PhotoLibraryPreferences = {
  /** v0.3.4 起统一给 Chat / Moments / WVS / 后续 Bubble、SMS 使用。 */
  mediaStrategy: PhotoSourceStrategy;
  /** 旧字段保留用于迁移兼容，不再作为新 App 的独立策略入口。 */
  chatStrategy: PhotoSourceStrategy;
  momentsStrategy: PhotoSourceStrategy;
  resolverDebug: boolean;
};

export type PhotoLibraryState = {
  version: 2;
  photos: PhotoRecord[];
  currentTraitsByCharacter: Record<string, CharacterCurrentTraits>;
  preferences: PhotoLibraryPreferences;
};
