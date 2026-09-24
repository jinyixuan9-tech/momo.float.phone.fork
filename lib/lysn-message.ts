import { resolveMediaForUse } from "./media-resolver";
import { loadLysn, type LysnMessage } from "./lysn-storage";
import type { GeneratedLysn } from "./lysn-engine";

export async function prepareLysnMessages(id: string, generated: GeneratedLysn[]): Promise<Omit<LysnMessage, "id" | "characterId" | "createdAt">[]> {
  const room = loadLysn().rooms[id];
  const stickers = (room?.stickerPacks || []).flatMap(pack => pack.stickers);
  const rows: Omit<LysnMessage, "id" | "characterId" | "createdAt">[] = [];
  for (const item of generated) {
    let kind: LysnMessage["kind"] = item.kind;
    let imageUrl: string | undefined;
    let photoId: string | undefined;
    if (kind === "photo") {
      try {
        const media = await resolveMediaForUse({ actor: { type: "character", characterId: id }, description: item.photoDescription || item.original, intentKind: item.mediaIntent, channel: "bubble", targetId: id, appId: "lysn" });
        if (media?.imageUrl) { imageUrl = media.imageUrl; photoId = media.photoLibraryId; }
        else kind = "text";
      } catch { kind = "text"; }
    }
    if (kind === "sticker") {
      const sticker = stickers.find(s => s.name === item.stickerName || s.name === item.original);
      if (sticker?.imageUrl) imageUrl = sticker.imageUrl;
      else kind = "text";
    }
    rows.push({ sender: "artist", kind, original: item.original, translated: item.translated, imageUrl, photoId, quote: item.quote });
  }
  return rows;
}
