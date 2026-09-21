"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronLeft,
  Image as ImageIcon,
  Images,
  Link2,
  Plus,
  Trash2,
  Users,
  X,
} from "lucide-react";

import { CHARACTERS_UPDATED_EVENT, loadCharacters } from "@/lib/character-storage";
import type { Character } from "@/lib/character-types";
import { getChatImageFromIndexedDB, saveChatImageToIndexedDB } from "@/lib/chat-asset-storage";
import { deleteThemeAsset, describeAssetSaveError } from "@/lib/theme-storage";
import type { PhotoRecord } from "@/lib/photo-library-types";
import {
  PHOTO_LIBRARY_UPDATED_EVENT,
  appendPhotoRecords,
  createPhotoId,
  createPhotoSharedPairId,
  loadPhotoLibrary,
  parsePhotoSharedPairId,
  removePhotoRecord,
  updatePhotoRecord,
} from "@/lib/photo-library-storage";

type Props = {
  onClose: () => void;
  onNotice?: (message: string) => void;
};

type MainTab = "library" | "people" | "shared";
type AlbumScope =
  | { type: "character"; characterId: string }
  | { type: "shared"; pairId: string }
  | null;

type UploadDraft = {
  files: File[];
  previewUrls: string[];
  linkedCharacterIds: string[];
  aiUsable: boolean;
  shared: boolean;
};

function sortPhotos(photos: PhotoRecord[]): PhotoRecord[] {
  return [...photos].sort((a, b) => b.createdAt - a.createdAt);
}

function formatPhotoDate(timestamp: number): string {
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(timestamp));
  } catch {
    return "";
  }
}

function initials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  return trimmed.slice(0, 1).toUpperCase();
}

function CharacterAvatar({ character, size = 28 }: { character: Character; size?: number }) {
  return (
    <span className="photos-character-avatar" style={{ width: size, height: size }} aria-hidden>
      {character.avatar ? <img src={character.avatar} alt="" /> : <span>{initials(character.name)}</span>}
    </span>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (next: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      className={`photos-switch${checked ? " is-on" : ""}`}
      onClick={() => onChange(!checked)}
      role="switch"
      aria-checked={checked}
      aria-label={label}
    >
      <span />
    </button>
  );
}

export function PhotosApp({ onClose, onNotice }: Props) {
  const [characters, setCharacters] = useState<Character[]>(() => loadCharacters());
  const [photos, setPhotos] = useState<PhotoRecord[]>(() => sortPhotos(loadPhotoLibrary().photos));
  const [imageMap, setImageMap] = useState<Record<string, string>>({});
  const [tab, setTab] = useState<MainTab>("library");
  const [scope, setScope] = useState<AlbumScope>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [uploadDraft, setUploadDraft] = useState<UploadDraft | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0 });
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const uploadDraftRef = useRef<UploadDraft | null>(null);

  const detailPhoto = detailId ? photos.find((photo) => photo.id === detailId) ?? null : null;
  const characterById = useMemo(() => new Map(characters.map((character) => [character.id, character])), [characters]);

  const refreshLibrary = () => setPhotos(sortPhotos(loadPhotoLibrary().photos));

  useEffect(() => {
    const refreshCharacters = () => setCharacters(loadCharacters());
    const refreshPhotos = () => refreshLibrary();
    window.addEventListener(CHARACTERS_UPDATED_EVENT, refreshCharacters);
    window.addEventListener(PHOTO_LIBRARY_UPDATED_EVENT, refreshPhotos);
    return () => {
      window.removeEventListener(CHARACTERS_UPDATED_EVENT, refreshCharacters);
      window.removeEventListener(PHOTO_LIBRARY_UPDATED_EVENT, refreshPhotos);
    };
  }, []);

  useEffect(() => {
    let canceled = false;
    const missing = photos.filter((photo) => !imageMap[photo.assetId]);
    if (missing.length === 0) return;
    void Promise.all(missing.map(async (photo) => {
      const dataUrl = await getChatImageFromIndexedDB(photo.assetId).catch(() => null);
      return [photo.assetId, dataUrl] as const;
    })).then((rows) => {
      if (canceled) return;
      const loaded = rows.filter((row): row is readonly [string, string] => Boolean(row[1]));
      if (loaded.length === 0) return;
      setImageMap((prev) => {
        const next = { ...prev };
        loaded.forEach(([assetId, dataUrl]) => {
          next[assetId] = dataUrl;
        });
        return next;
      });
    });
    return () => { canceled = true; };
  }, [photos, imageMap]);

  useEffect(() => {
    uploadDraftRef.current = uploadDraft;
  }, [uploadDraft]);

  useEffect(() => () => {
    uploadDraftRef.current?.previewUrls.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  const scopedPhotos = useMemo(() => {
    if (!scope) return photos;
    if (scope.type === "character") {
      return photos.filter((photo) => photo.linkedCharacterIds.includes(scope.characterId));
    }
    return photos.filter((photo) => photo.sharedPairIds.includes(scope.pairId));
  }, [photos, scope]);

  const peopleAlbums = useMemo(() => characters
    .map((character) => {
      const items = photos.filter((photo) => photo.linkedCharacterIds.includes(character.id));
      return { character, items, cover: items[0] ?? null };
    })
    .filter((album) => album.items.length > 0)
    .sort((a, b) => b.items.length - a.items.length), [characters, photos]);

  const sharedAlbums = useMemo(() => {
    const pairIds = Array.from(new Set(photos.flatMap((photo) => photo.sharedPairIds)));
    return pairIds.flatMap((pairId) => {
      const pair = parsePhotoSharedPairId(pairId);
      if (!pair) return [];
      const first = characterById.get(pair[0]);
      const second = characterById.get(pair[1]);
      if (!first || !second) return [];
      const items = photos.filter((photo) => photo.sharedPairIds.includes(pairId));
      return [{ pairId, first, second, items, cover: items[0] ?? null }];
    }).sort((a, b) => b.items.length - a.items.length);
  }, [photos, characterById]);

  const openPicker = () => {
    if (characters.length === 0) {
      onNotice?.("还没有角色，先创建角色再导入照片。");
      return;
    }
    fileInputRef.current?.click();
  };

  const handleFiles = (filesLike: FileList | null) => {
    if (!filesLike?.length) return;
    const files = Array.from(filesLike).filter((file) => file.type.startsWith("image/"));
    if (files.length === 0) {
      onNotice?.("请选择图片文件。");
      return;
    }
    uploadDraft?.previewUrls.forEach((url) => URL.revokeObjectURL(url));
    const previewUrls = files.slice(0, 12).map((file) => URL.createObjectURL(file));
    let presetCharacterIds: string[] = [];
    let presetShared = false;
    if (scope?.type === "character") {
      presetCharacterIds = [scope.characterId];
    } else if (scope?.type === "shared") {
      const pair = parsePhotoSharedPairId(scope.pairId);
      if (pair) {
        presetCharacterIds = [...pair];
        presetShared = true;
      }
    }
    setUploadDraft({
      files,
      previewUrls,
      linkedCharacterIds: presetCharacterIds,
      aiUsable: true,
      shared: presetShared,
    });
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const toggleDraftCharacter = (characterId: string) => {
    setUploadDraft((draft) => {
      if (!draft) return draft;
      const has = draft.linkedCharacterIds.includes(characterId);
      const nextIds = has
        ? draft.linkedCharacterIds.filter((id) => id !== characterId)
        : [...draft.linkedCharacterIds, characterId];
      return {
        ...draft,
        linkedCharacterIds: nextIds,
        shared: nextIds.length === 2 ? draft.shared : false,
      };
    });
  };

  const importPhotos = async () => {
    if (!uploadDraft || uploading) return;
    if (uploadDraft.linkedCharacterIds.length === 0) {
      onNotice?.("至少关联一个角色。");
      return;
    }

    setUploading(true);
    setUploadProgress({ current: 0, total: uploadDraft.files.length });
    const records: PhotoRecord[] = [];
    const failed: string[] = [];
    const now = Date.now();
    const sharedPairId = uploadDraft.shared && uploadDraft.linkedCharacterIds.length === 2
      ? createPhotoSharedPairId(uploadDraft.linkedCharacterIds[0], uploadDraft.linkedCharacterIds[1])
      : "";

    for (let index = 0; index < uploadDraft.files.length; index += 1) {
      const file = uploadDraft.files[index];
      try {
        const assetId = await saveChatImageToIndexedDB(file);
        records.push({
          id: createPhotoId(),
          assetId,
          originalName: file.name || undefined,
          linkedCharacterIds: [...uploadDraft.linkedCharacterIds],
          sharedPairIds: sharedPairId ? [sharedPairId] : [],
          aiUsable: uploadDraft.aiUsable,
          visionStatus: "unprocessed",
          usageHistory: [],
          createdAt: now + index,
          updatedAt: now + index,
        });
      } catch (error) {
        failed.push(`${file.name || `第 ${index + 1} 张`}: ${describeAssetSaveError(error)}`);
      }
      setUploadProgress({ current: index + 1, total: uploadDraft.files.length });
    }

    if (records.length > 0) appendPhotoRecords(records);
    uploadDraft.previewUrls.forEach((url) => URL.revokeObjectURL(url));
    setUploadDraft(null);
    setUploading(false);
    setUploadProgress({ current: 0, total: 0 });

    if (failed.length > 0) {
      onNotice?.(`已导入 ${records.length} 张，${failed.length} 张失败。`);
    } else {
      onNotice?.(`已导入 ${records.length} 张照片。`);
    }
  };

  const updateDetail = (patch: Partial<PhotoRecord>) => {
    if (!detailPhoto) return;
    updatePhotoRecord(detailPhoto.id, patch);
  };

  const toggleDetailCharacter = (characterId: string) => {
    if (!detailPhoto) return;
    const has = detailPhoto.linkedCharacterIds.includes(characterId);
    if (has && detailPhoto.linkedCharacterIds.length === 1) {
      onNotice?.("至少保留一个关联角色。");
      return;
    }
    const nextIds = has
      ? detailPhoto.linkedCharacterIds.filter((id) => id !== characterId)
      : [...detailPhoto.linkedCharacterIds, characterId];
    const pairId = nextIds.length === 2 ? createPhotoSharedPairId(nextIds[0], nextIds[1]) : "";
    updateDetail({
      linkedCharacterIds: nextIds,
      sharedPairIds: pairId && detailPhoto.sharedPairIds.includes(pairId) ? [pairId] : [],
    });
  };

  const toggleDetailShared = (next: boolean) => {
    if (!detailPhoto || detailPhoto.linkedCharacterIds.length !== 2) return;
    const pairId = createPhotoSharedPairId(detailPhoto.linkedCharacterIds[0], detailPhoto.linkedCharacterIds[1]);
    updateDetail({ sharedPairIds: next && pairId ? [pairId] : [] });
  };

  const deleteDetailPhoto = async () => {
    if (!detailPhoto) return;
    const confirmed = window.confirm("删除这张照片？这不会删除角色，只会从 Photos 中移除图片。");
    if (!confirmed) return;
    const removed = removePhotoRecord(detailPhoto.id);
    setDetailId(null);
    if (removed) {
      await deleteThemeAsset(removed.assetId).catch(() => {});
      setImageMap((prev) => {
        const next = { ...prev };
        delete next[removed.assetId];
        return next;
      });
      onNotice?.("照片已删除。");
    }
  };

  const scopeTitle = (() => {
    if (!scope) return "";
    if (scope.type === "character") return characterById.get(scope.characterId)?.name || "角色相册";
    const pair = parsePhotoSharedPairId(scope.pairId);
    if (!pair) return "共享相册";
    return `${characterById.get(pair[0])?.name || "角色"} & ${characterById.get(pair[1])?.name || "角色"}`;
  })();

  const detailPairId = detailPhoto?.linkedCharacterIds.length === 2
    ? createPhotoSharedPairId(detailPhoto.linkedCharacterIds[0], detailPhoto.linkedCharacterIds[1])
    : "";
  const detailShared = Boolean(detailPairId && detailPhoto?.sharedPairIds.includes(detailPairId));

  const renderPhotoGrid = (items: PhotoRecord[]) => {
    if (items.length === 0) {
      return (
        <div className="photos-empty">
          <span className="photos-empty-icon"><Images size={30} strokeWidth={1.5} /></span>
          <strong>还没有照片</strong>
          <p>从图库批量导入，再把照片关联给角色。</p>
          <button type="button" onClick={openPicker}>导入照片</button>
        </div>
      );
    }
    return (
      <div className="photos-grid">
        {items.map((photo) => (
          <button type="button" className="photos-grid-item" key={photo.id} onClick={() => setDetailId(photo.id)}>
            {imageMap[photo.assetId]
              ? <img src={imageMap[photo.assetId]} alt="" loading="lazy" />
              : <span className="photos-grid-placeholder"><ImageIcon size={20} /></span>}
            {!photo.aiUsable ? <span className="photos-grid-lock">仅手动</span> : null}
          </button>
        ))}
      </div>
    );
  };

  if (detailPhoto) {
    const imageUrl = imageMap[detailPhoto.assetId];
    return (
      <section className="photos-app photos-detail-view">
        <header className="photos-topbar">
          <button type="button" className="photos-round-btn" onClick={() => setDetailId(null)} aria-label="返回">
            <ChevronLeft size={21} />
          </button>
          <div className="photos-topbar-title">
            <strong>照片</strong>
            <span>{formatPhotoDate(detailPhoto.createdAt)}</span>
          </div>
          <button type="button" className="photos-round-btn photos-danger-btn" onClick={() => void deleteDetailPhoto()} aria-label="删除照片">
            <Trash2 size={18} />
          </button>
        </header>

        <main className="photos-detail-scroll">
          <div className="photos-detail-image-wrap">
            {imageUrl ? <img src={imageUrl} alt="" className="photos-detail-image" /> : <div className="photos-detail-image-loading"><ImageIcon size={30} /></div>}
          </div>

          <section className="photos-inspector-card">
            <div className="photos-inspector-heading">
              <div>
                <strong>关联角色</strong>
                <span>决定哪些角色以后可以调用这张照片</span>
              </div>
            </div>
            <div className="photos-character-chips">
              {characters.map((character) => {
                const selected = detailPhoto.linkedCharacterIds.includes(character.id);
                return (
                  <button
                    type="button"
                    key={character.id}
                    className={`photos-character-chip${selected ? " is-selected" : ""}`}
                    onClick={() => toggleDetailCharacter(character.id)}
                  >
                    <CharacterAvatar character={character} size={27} />
                    <span>{character.name}</span>
                    {selected ? <Check size={14} /> : null}
                  </button>
                );
              })}
            </div>
          </section>

          {detailPhoto.linkedCharacterIds.length === 2 ? (
            <section className="photos-setting-card">
              <div>
                <strong>加入角色共享相册</strong>
                <span>
                  {detailPhoto.linkedCharacterIds.map((id) => characterById.get(id)?.name || "角色").join(" & ")}
                </span>
              </div>
              <Toggle checked={detailShared} onChange={toggleDetailShared} label="共享相册" />
            </section>
          ) : null}

          <section className="photos-setting-card">
            <div>
              <strong>AI 可调用</strong>
              <span>开启后，后续聊天与朋友圈可优先使用这张真实照片</span>
            </div>
            <Toggle checked={detailPhoto.aiUsable} onChange={(next) => updateDetail({ aiUsable: next })} label="AI 可调用" />
          </section>

          <section className="photos-meta-card">
            <span>文件</span><strong>{detailPhoto.originalName || "照片"}</strong>
            <span>识图</span><strong>尚未分析 · 下一阶段接入</strong>
          </section>
        </main>
      </section>
    );
  }

  if (scope) {
    return (
      <section className="photos-app">
        <header className="photos-topbar">
          <button type="button" className="photos-round-btn" onClick={() => setScope(null)} aria-label="返回">
            <ChevronLeft size={21} />
          </button>
          <div className="photos-topbar-title">
            <strong>{scopeTitle}</strong>
            <span>{scopedPhotos.length} 张照片</span>
          </div>
          <button type="button" className="photos-round-btn" onClick={openPicker} aria-label="导入照片"><Plus size={20} /></button>
        </header>
        <main className="photos-library-scroll">{renderPhotoGrid(scopedPhotos)}</main>
        <input ref={fileInputRef} type="file" accept="image/*" multiple hidden onChange={(event) => handleFiles(event.target.files)} />
        {uploadDraft ? renderUploadSheet() : null}
      </section>
    );
  }

  function renderUploadSheet() {
    if (!uploadDraft) return null;
    const selectedCharacters = uploadDraft.linkedCharacterIds.map((id) => characterById.get(id)).filter((item): item is Character => Boolean(item));
    return (
      <div className="photos-sheet-backdrop" role="presentation">
        <section className="photos-sheet" role="dialog" aria-modal="true" aria-label="导入照片">
          <header className="photos-sheet-header">
            <button type="button" onClick={() => {
              if (uploading) return;
              uploadDraft.previewUrls.forEach((url) => URL.revokeObjectURL(url));
              setUploadDraft(null);
            }} aria-label="取消"><X size={19} /></button>
            <div><strong>导入照片</strong><span>{uploadDraft.files.length} 张</span></div>
            <button type="button" className="photos-sheet-done" disabled={uploading} onClick={() => void importPhotos()}>
              {uploading ? `${uploadProgress.current}/${uploadProgress.total}` : "完成"}
            </button>
          </header>

          <div className="photos-sheet-scroll">
            <div className="photos-import-preview">
              {uploadDraft.previewUrls.map((url, index) => <img src={url} alt="" key={`${url}_${index}`} />)}
              {uploadDraft.files.length > uploadDraft.previewUrls.length ? (
                <span className="photos-import-more">+{uploadDraft.files.length - uploadDraft.previewUrls.length}</span>
              ) : null}
            </div>

            <section className="photos-sheet-section">
              <div className="photos-sheet-section-title">
                <strong>关联角色</strong>
                <span>可多选；角色身份由你决定，不交给识图模型猜</span>
              </div>
              <div className="photos-character-list">
                {characters.map((character) => {
                  const selected = uploadDraft.linkedCharacterIds.includes(character.id);
                  return (
                    <button
                      type="button"
                      className={`photos-character-row${selected ? " is-selected" : ""}`}
                      key={character.id}
                      onClick={() => toggleDraftCharacter(character.id)}
                    >
                      <CharacterAvatar character={character} size={38} />
                      <span>{character.name}</span>
                      <i>{selected ? <Check size={16} /> : null}</i>
                    </button>
                  );
                })}
              </div>
            </section>

            {uploadDraft.linkedCharacterIds.length === 2 ? (
              <section className="photos-setting-card photos-sheet-setting">
                <div>
                  <strong>加入角色共享相册</strong>
                  <span>{selectedCharacters.map((character) => character.name).join(" & ")}</span>
                </div>
                <Toggle checked={uploadDraft.shared} onChange={(next) => setUploadDraft((draft) => draft ? { ...draft, shared: next } : draft)} label="共享相册" />
              </section>
            ) : null}

            <section className="photos-setting-card photos-sheet-setting">
              <div>
                <strong>AI 可调用</strong>
                <span>以后角色发图时可以把这些照片作为候选</span>
              </div>
              <Toggle checked={uploadDraft.aiUsable} onChange={(next) => setUploadDraft((draft) => draft ? { ...draft, aiUsable: next } : draft)} label="AI 可调用" />
            </section>
          </div>
        </section>
      </div>
    );
  }

  return (
    <section className="photos-app">
      <header className="photos-home-header">
        <button type="button" className="photos-round-btn" onClick={onClose} aria-label="返回桌面">
          <ChevronLeft size={21} />
        </button>
        <div>
          <span>PHOTOS</span>
          <h1>{tab === "library" ? "图库" : tab === "people" ? "人物" : "共享"}</h1>
        </div>
        <button type="button" className="photos-add-btn" onClick={openPicker} aria-label="导入照片">
          <Plus size={20} />
        </button>
      </header>

      <main className="photos-library-scroll photos-home-scroll">
        {tab === "library" ? (
          <>
            {photos.length > 0 ? (
              <div className="photos-library-summary">
                <strong>全部照片</strong>
                <span>{photos.length}</span>
              </div>
            ) : null}
            {renderPhotoGrid(photos)}
          </>
        ) : null}

        {tab === "people" ? (
          peopleAlbums.length > 0 ? (
            <div className="photos-album-grid">
              {peopleAlbums.map(({ character, items, cover }) => (
                <button type="button" className="photos-album-card" key={character.id} onClick={() => setScope({ type: "character", characterId: character.id })}>
                  <span className="photos-album-cover">
                    {cover && imageMap[cover.assetId] ? <img src={imageMap[cover.assetId]} alt="" /> : <CharacterAvatar character={character} size={70} />}
                    <span className="photos-album-avatar"><CharacterAvatar character={character} size={28} /></span>
                  </span>
                  <strong>{character.name}</strong>
                  <span>{items.length} 张</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="photos-empty">
              <span className="photos-empty-icon"><Users size={30} strokeWidth={1.5} /></span>
              <strong>还没有人物相册</strong>
              <p>导入照片并关联角色后，这里会自动出现。</p>
              <button type="button" onClick={openPicker}>导入照片</button>
            </div>
          )
        ) : null}

        {tab === "shared" ? (
          sharedAlbums.length > 0 ? (
            <div className="photos-album-grid">
              {sharedAlbums.map(({ pairId, first, second, items, cover }) => (
                <button type="button" className="photos-album-card" key={pairId} onClick={() => setScope({ type: "shared", pairId })}>
                  <span className="photos-album-cover photos-shared-cover">
                    {cover && imageMap[cover.assetId] ? <img src={imageMap[cover.assetId]} alt="" /> : <Link2 size={34} />}
                    <span className="photos-shared-avatars">
                      <CharacterAvatar character={first} size={30} />
                      <CharacterAvatar character={second} size={30} />
                    </span>
                  </span>
                  <strong>{first.name} & {second.name}</strong>
                  <span>{items.length} 张</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="photos-empty">
              <span className="photos-empty-icon"><Link2 size={30} strokeWidth={1.5} /></span>
              <strong>还没有角色共享相册</strong>
              <p>导入时关联两位角色，再打开“加入角色共享相册”。</p>
              <button type="button" onClick={openPicker}>导入照片</button>
            </div>
          )
        ) : null}
      </main>

      <nav className="photos-tabbar" aria-label="Photos 导航">
        <button type="button" className={tab === "library" ? "is-active" : ""} onClick={() => setTab("library")}>
          <Images size={20} /><span>图库</span>
        </button>
        <button type="button" className={tab === "people" ? "is-active" : ""} onClick={() => setTab("people")}>
          <Users size={20} /><span>人物</span>
        </button>
        <button type="button" className={tab === "shared" ? "is-active" : ""} onClick={() => setTab("shared")}>
          <Link2 size={20} /><span>共享</span>
        </button>
      </nav>

      <input ref={fileInputRef} type="file" accept="image/*" multiple hidden onChange={(event) => handleFiles(event.target.files)} />
      {uploadDraft ? renderUploadSheet() : null}
    </section>
  );
}
