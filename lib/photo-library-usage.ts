import type { PhotoRecord, PhotoUsageChannel } from "./photo-library-types";

const PRIVATE_CHANNELS = new Set<PhotoUsageChannel>(["dm_user", "moments", "bubble", "dm_char", "sms", "twitter_alt"]);
const PUBLIC_CHANNELS = new Set<PhotoUsageChannel>(["wvs_artist", "twitter_main", "wvs_official", "wvs", "other"]);

export function photoUsageLabel(channel: PhotoUsageChannel): string {
  return ({ dm_user: "Chat", moments: "朋友圈", bubble: "Lysn", dm_char: "私聊", sms: "SMS", twitter_alt: "X 副号", twitter_main: "X 主号", wvs_artist: "WVS 艺人号", wvs_official: "WVS 官号", wvs: "WVS", other: "X" } as Record<PhotoUsageChannel, string>)[channel];
}

/** One image may appear in several albums, but all references share this usage history. */
export function canAutoUsePhoto(photo: PhotoRecord, _characterId: string, channel: PhotoUsageChannel, _accountId?: string): boolean {
  const used = photo.usageHistory.filter(item => item.usedAt > (photo.releasedAt || 0));
  if (used.some(item => item.channel === channel)) return false;
  if (used.some(item => item.channel === "wvs_official") || (channel === "wvs_official" && used.length > 0)) return false;
  if (PRIVATE_CHANNELS.has(channel) && used.some(item => PUBLIC_CHANNELS.has(item.channel))) return false;
  if (PUBLIC_CHANNELS.has(channel) && used.some(item => PRIVATE_CHANNELS.has(item.channel))) return false;
  return true;
}

export function photoUseCount(photo: PhotoRecord, _characterId: string, channels: PhotoUsageChannel[]): number {
  const used = photo.usageHistory.filter(item => item.usedAt > (photo.releasedAt || 0));
  return channels.filter(channel => used.some(item => item.channel === channel)).length;
}
