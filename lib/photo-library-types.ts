export type PhotoVisionStatus = "unprocessed" | "pending" | "done" | "failed";

export type PhotoShotType = "selfie" | "taken_by_character" | "other";

export type PhotoUsageChannel = "dm_user" | "moments" | "dm_char";

export type PhotoUsageRecord = {
  channel: PhotoUsageChannel;
  characterId: string;
  targetId?: string;
  usedAt: number;
};

export type PhotoRecord = {
  id: string;
  assetId: string;
  originalName?: string;

  /** 哪些角色可以把这张照片当作自己的照片库素材使用。 */
  linkedCharacterIds: string[];

  /** 真正的角色×角色共享关系。user 不参与 shared pair。 */
  sharedPairIds: string[];

  /** 后续 Photo Resolver 是否允许自动选中这张图。 */
  aiUsable: boolean;

  /** v0.2.1 自动识图预留字段。 */
  visionStatus: PhotoVisionStatus;
  visionSummary?: string;
  visionTags?: string[];
  sceneTags?: string[];
  shotType?: PhotoShotType;

  /** 后续 DM / 朋友圈复用规则使用；MVP 只预留，不主动写入。 */
  usageHistory: PhotoUsageRecord[];

  createdAt: number;
  updatedAt: number;
};

export type PhotoLibraryState = {
  version: 1;
  photos: PhotoRecord[];
};
