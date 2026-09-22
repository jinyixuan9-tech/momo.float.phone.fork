import type { WeverseAuthorType, WeverseCommunity } from "./weverse-storage";

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/**
 * Weverse 公开互动量只是“世界里存在的大盘快照”。
 * comments[] 只是用户当前展开看到的一小撮样本，因此继续加载评论不会改 commentCount。
 */
export function createWeverseEngagement(
  community: Pick<WeverseCommunity, "fanCount">,
  authorType: WeverseAuthorType,
  options?: { hasImage?: boolean; historicalAgeRatio?: number; visibleCommentCount?: number },
): { likeCount: number; commentCount: number } {
  const fanCount = Math.max(500, Number(community.fanCount) || 100000);
  const imageBoost = options?.hasImage ? randomBetween(1.03, 1.22) : randomBetween(.93, 1.08);
  const historyScale = clamp(1 - (options?.historicalAgeRatio || 0) * randomBetween(.18, .48), .42, 1);
  let likeRatio = .01;
  let commentRatio = .001;
  let likeFloor = 1;
  let commentFloor = 0;

  if (authorType === "artist") {
    likeRatio = randomBetween(.028, .135);
    commentRatio = randomBetween(.0012, .011);
    likeFloor = 80;
    commentFloor = 12;
  } else if (authorType === "official") {
    likeRatio = randomBetween(.014, .078);
    commentRatio = randomBetween(.0005, .0058);
    likeFloor = 35;
    commentFloor = 6;
  } else {
    // Fan Post 更接近社区普通热帖/随手帖，不和 Artist 使用同一量级。
    const reach = Math.max(150, Math.pow(fanCount, .62) * randomBetween(.5, 2.6));
    likeFloor = 2;
    commentFloor = 0;
    const likes = Math.round(reach * randomBetween(.18, 1.7));
    const comments = Math.round(reach * randomBetween(.018, .25));
    return {
      likeCount: Math.max(likeFloor, Math.round(likes * imageBoost * historyScale)),
      commentCount: Math.max(options?.visibleCommentCount || 0, commentFloor, Math.round(comments * historyScale)),
    };
  }

  return {
    likeCount: Math.max(likeFloor, Math.round(fanCount * likeRatio * imageBoost * historyScale)),
    commentCount: Math.max(options?.visibleCommentCount || 0, commentFloor, Math.round(fanCount * commentRatio * historyScale)),
  };
}
