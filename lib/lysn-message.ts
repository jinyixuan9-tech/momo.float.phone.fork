import { resolveMediaForUse } from "./media-resolver";
import { loadLysn, type LysnMessage } from "./lysn-storage";
import type { GeneratedLysn } from "./lysn-engine";
import { getChatImageFromIndexedDB } from "./chat-asset-storage";
import { appendPhotoUsage, loadPhotoLibrary } from "./photo-library-storage";
import { getPhotoSourceStrategy } from "./photo-library-resolver";

export async function prepareLysnMessages(id: string, generated: GeneratedLysn[], onMediaFailure?: (reason: string) => void): Promise<Omit<LysnMessage, "id" | "characterId" | "createdAt">[]> {
  const room = loadLysn().rooms[id];
  const stickers = (room?.stickerPacks || []).flatMap(pack => pack.stickers);
  const rows: Omit<LysnMessage, "id" | "characterId" | "createdAt">[] = [];
  const photoCaptions: Omit<LysnMessage, "id" | "characterId" | "createdAt">[] = [];
  const flushPhotoCaptions = () => { rows.push(...photoCaptions); photoCaptions.length = 0; };
  for (const item of generated) {
    let kind: LysnMessage["kind"] = item.kind;
    let imageUrl: string | undefined;
    let photoId: string | undefined;
    let placeholderDescription: string | undefined;
    if (kind === "photo") {
      const album = loadPhotoLibrary();
      const requested = item.photoId && getPhotoSourceStrategy("bubble") !== "generated_only"
        ? album.photos.find(p => p.id === item.photoId && p.linkedCharacterIds.includes(id) && p.aiUsable && p.visionStatus === "done") : undefined;
      if (requested && await getChatImageFromIndexedDB(requested.assetId).catch(() => null)) {
        imageUrl = `asset://${requested.assetId}`;
        photoId = requested.id;
        appendPhotoUsage(requested.id, { channel: "bubble", characterId: id, targetId: id, usedAt: Date.now() });
      }
      try {
        if (!imageUrl) {
          const media = await resolveMediaForUse({ actor: { type: "character", characterId: id }, description: item.photoDescription || item.original, intentKind: item.mediaIntent, channel: "bubble", targetId: id, appId: "lysn" });
          if (media?.imageUrl) { imageUrl = media.imageUrl; photoId = media.photoLibraryId; }
          if (media?.placeholderDescription) placeholderDescription = media.placeholderDescription;
        }
      } catch { /* Explain the missing image below instead of silently pretending it was sent. */ }
      if (!imageUrl && !placeholderDescription) {
        const linked = album.photos.filter(p => p.linkedCharacterIds.includes(id));
        const usable = linked.filter(p => p.aiUsable && p.visionStatus === "done");
        onMediaFailure?.(!linked.length ? "这位艺人没有关联任何相册照片" : !usable.length ? "已关联照片，但没有同时开启 AI 可使用并完成识图的照片" : item.photoId ? "艺人选中的相册照片不可读取或已失效" : "相册有可用照片，但照片描述没匹配上；可补充照片标签后重试");
        // A failed photo must not turn into text falsely claiming the photo was sent.
        continue;
      }
      const caption = item.original.trim();
      const hasCaption = caption && !/^(?:照片|图片|photo|picture|사진)[!！.。]?$/.test(caption);
      rows.push({ sender: "artist", kind: "photo", original: item.photoDescription || "照片", translated: item.photoDescription || "照片", photoDescription: placeholderDescription || item.photoDescription || item.original, imageUrl, photoId, quote: item.quote && !hasCaption ? item.quote : undefined, photoCaptionDetached: true });
      if (hasCaption) {
        photoCaptions.push({ sender: "artist", kind: "text", original: caption, translated: item.translated || caption, quote: item.quote });
      }
      continue;
    }
    flushPhotoCaptions();
    if (kind === "sticker") {
      const sticker = stickers.find(s => s.name === item.stickerName || s.name === item.original);
      if (sticker?.imageUrl) imageUrl = sticker.imageUrl;
      else kind = "text";
    }
    rows.push({ sender: "artist", kind, original: item.original, translated: item.translated, imageUrl, photoId, quote: item.quote });
  }
  flushPhotoCaptions();
  return rows;
}
