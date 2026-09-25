"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Camera, Plus, Smile, X } from "lucide-react";
import { getChatImageFromIndexedDB, saveChatImageToIndexedDB } from "@/lib/chat-asset-storage";
import { lysnId, type LysnStickerPack } from "@/lib/lysn-storage";
import styles from "./lysn-sticker-manager.module.css";

type Dialog = "create" | "single" | "batch" | null;
type BatchRow = { id: string; name: string; url: string; file?: File };
const urlPattern = /https?:\/\/[^\s，。；;]+/i;

function nameFromUrl(value: string, index: number): string {
  try { return decodeURIComponent(new URL(value).pathname.split("/").pop() || "").replace(/\.[^.]+$/, "").slice(0, 32) || `表情${index + 1}`; }
  catch { return `表情${index + 1}`; }
}

export function parseLysnStickerUrls(value: string): { name: string; url: string }[] {
  return value.split(/\r?\n/).map((line, index) => {
    const match = line.match(urlPattern);
    if (!match) return null;
    const url = match[0].replace(/[)\]}]+$/, "");
    try { const parsed = new URL(url); if (!/^https?:$/.test(parsed.protocol)) return null; }
    catch { return null; }
    const name = line.slice(0, match.index).replace(/[：:\s-]+$/, "").trim() || nameFromUrl(url, index);
    return { name, url };
  }).filter((row): row is { name: string; url: string } => row !== null);
}

function Preview({ url }: { url: string }) {
  const [src, setSrc] = useState(url.startsWith("asset://") ? "" : url);
  useEffect(() => {
    let live = true;
    if (!url.startsWith("asset://")) { setSrc(url); return; }
    getChatImageFromIndexedDB(url.slice(8)).then(value => { if (live) setSrc(value || ""); }).catch(() => { if (live) setSrc(""); });
    return () => { live = false; };
  }, [url]);
  return src ? <img src={src} alt="" /> : <Smile size={22}/>;
}

export function LysnStickerManager({ title, packs, onChange, onNotice }: {
  title: string; packs: LysnStickerPack[]; onChange: (packs: LysnStickerPack[]) => void; onNotice?: (text: string) => void;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [packName, setPackName] = useState("");
  const [packNote, setPackNote] = useState("");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [singleFile, setSingleFile] = useState<File | null>(null);
  const [urlText, setUrlText] = useState("");
  const [rows, setRows] = useState<BatchRow[]>([]);
  const [saving, setSaving] = useState(false);
  const singleRef = useRef<HTMLInputElement>(null);
  const batchRef = useRef<HTMLInputElement>(null);
  const objectUrls = useRef<string[]>([]);
  useEffect(() => () => { objectUrls.current.forEach(item => URL.revokeObjectURL(item)); }, []);
  const active = packs.find(pack => pack.id === activeId);

  const addStickers = (items: { name: string; imageUrl: string }[]) => {
    onChange(packs.map(pack => pack.id === activeId ? { ...pack, stickers: [...pack.stickers, ...items.map(item => ({ id: lysnId(), ...item }))] } : pack));
    setDialog(null); setName(""); setUrl(""); setSingleFile(null); setRows([]); setUrlText("");
  };

  const saveSingle = async () => {
    if (!name.trim() || (!singleFile && !/^https?:\/\//i.test(url.trim()))) { onNotice?.("填写表情名称，并选择图片或输入图片 URL"); return; }
    setSaving(true);
    try {
      const imageUrl = singleFile ? `asset://${await saveChatImageToIndexedDB(singleFile)}` : url.trim();
      addStickers([{ name: name.trim(), imageUrl }]);
    } catch { onNotice?.("图片保存失败，请重试"); }
    finally { setSaving(false); }
  };

  const addFiles = (files: FileList | null) => {
    if (!files) return;
    const images = Array.from(files).filter(file => file.type.startsWith("image/"));
    setRows(current => [...current, ...images.map(file => {
      const preview = URL.createObjectURL(file); objectUrls.current.push(preview);
      return { id: lysnId(), name: file.name.replace(/\.[^.]+$/, "").slice(0, 32), url: preview, file };
    })]);
  };

  const addUrls = () => {
    const parsed = parseLysnStickerUrls(urlText);
    if (!parsed.length) { onNotice?.("没有识别到可用的图片 URL"); return; }
    setRows(current => [...current, ...parsed.map(item => ({ id: lysnId(), ...item }))]);
    setUrlText("");
  };

  const saveBatch = async () => {
    if (!rows.length || rows.some(row => !row.name.trim())) { onNotice?.("请给每张表情填写名称"); return; }
    if (new Set(rows.map(row => row.name.trim().toLowerCase())).size !== rows.length || rows.some(row => active?.stickers.some(item => item.name.toLowerCase() === row.name.trim().toLowerCase()))) { onNotice?.("表情名称重复，请修改后再导入"); return; }
    setSaving(true);
    try {
      const items: { name: string; imageUrl: string }[] = [];
      for (const row of rows) items.push({ name: row.name.trim(), imageUrl: row.file ? `asset://${await saveChatImageToIndexedDB(row.file)}` : row.url });
      addStickers(items);
    } catch { onNotice?.("部分图片未能保存，请重试"); }
    finally { setSaving(false); }
  };

  return <div className={styles.manager}>
    {!active ? <><p className={styles.intro}>{title === "我的表情包" ? "所有 Bubble 聊天室都可以使用" : "仅当前聊天室的艺人使用"}</p><div className={styles.packGrid}>{packs.map(pack => <button type="button" key={pack.id} className={styles.packCard} onClick={() => setActiveId(pack.id)}><Smile size={23}/><b>{pack.name}</b><small>{pack.stickers.length} 个表情{pack.note ? ` · ${pack.note}` : ""}</small></button>)}<button type="button" className={styles.newPack} onClick={() => setDialog("create")}><Plus size={27}/>新建图集</button></div></> : <><button type="button" className={styles.packBack} onClick={() => setActiveId(null)}>‹　{active.name}</button>{active.note && <p className={styles.intro}>{active.note}</p>}<div className={styles.toolbar}><b>表情库 <span>{active.stickers.length}</span></b><button type="button" onClick={() => setDialog("batch")}>批量导入</button></div><div className={styles.stickerGrid}>{active.stickers.map(sticker => <div className={styles.stickerCard} key={sticker.id}><div><Preview url={sticker.imageUrl}/></div><input aria-label="表情名称或描述" value={sticker.name} onChange={e => onChange(packs.map(pack => pack.id === activeId ? { ...pack, stickers: pack.stickers.map(item => item.id === sticker.id ? { ...item, name: e.target.value } : item) } : pack))}/><button type="button" aria-label={`删除${sticker.name}`} onClick={() => onChange(packs.map(pack => pack.id === activeId ? { ...pack, stickers: pack.stickers.filter(item => item.id !== sticker.id) } : pack))}><X size={15}/></button></div>)}<button type="button" className={styles.addTile} onClick={() => setDialog("single")}><Plus size={26}/>添加表情</button></div><button type="button" className={styles.deletePack} onClick={() => { if (!window.confirm(`删除「${active.name}」和里面的表情？`)) return; onChange(packs.filter(pack => pack.id !== activeId)); setActiveId(null); }}>删除图集</button></>}
    {dialog && typeof document !== "undefined" && document.querySelector("[data-lysn-app-root]") && createPortal(<div className={styles.overlay} onMouseDown={e => { if (e.target === e.currentTarget && !saving) setDialog(null); }}><section className={styles.dialog} role="dialog" aria-modal="true" aria-label={dialog === "create" ? "创建表情包组" : dialog === "single" ? "添加表情" : "批量添加表情"}><header><b>{dialog === "create" ? "创建表情包组" : dialog === "single" ? "添加表情" : `批量添加表情${rows.length ? ` · ${rows.length}` : ""}`}</b><button type="button" aria-label="关闭" onClick={() => !saving && setDialog(null)}><X size={20}/></button></header>
      {dialog === "create" && <><label>名称<input value={packName} onChange={e => setPackName(e.target.value)} placeholder="例如：小猫"/></label><label>备注（可选）<textarea rows={3} value={packNote} onChange={e => setPackNote(e.target.value)} placeholder="这组表情是什么"/></label><button className={styles.confirm} type="button" onClick={() => { if (!packName.trim()) { onNotice?.("填写图集名称"); return; } const id = lysnId(); onChange([...packs, { id, name: packName.trim(), note: packNote.trim(), stickers: [] }]); setActiveId(id); setPackName(""); setPackNote(""); setDialog(null); }}>创建图集</button></>}
      {dialog === "single" && <><label>表情名称或描述<input value={name} onChange={e => setName(e.target.value)} placeholder="例如：小猫打招呼"/></label><label>图片 URL<input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://…" onInput={() => setSingleFile(null)}/></label><input ref={singleRef} type="file" accept="image/*" hidden onChange={e => { const file = e.target.files?.[0]; if (file) { setSingleFile(file); setUrl(""); if (!name.trim()) setName(file.name.replace(/\.[^.]+$/, "")); } e.target.value = ""; }}/><button className={styles.chooseFile} type="button" onClick={() => singleRef.current?.click()}><Camera size={17}/>{singleFile ? singleFile.name : "选择图片"}</button><button className={styles.confirm} type="button" disabled={saving} onClick={() => void saveSingle()}>保存表情</button></>}
      {dialog === "batch" && <><input ref={batchRef} type="file" accept="image/*" multiple hidden onChange={e => { addFiles(e.target.files); e.target.value = ""; }}/><button className={styles.chooseFile} type="button" onClick={() => batchRef.current?.click()}><Camera size={17}/>选择多张图片</button><label>批量 URL<textarea rows={4} value={urlText} onChange={e => setUrlText(e.target.value)} placeholder={"贴贴：https://example.com/a.jpg\n可爱 https://example.com/b.gif"}/><small>每行一个，支持“名称：URL”或“名称 URL”</small></label><button className={styles.chooseFile} type="button" onClick={addUrls} disabled={!urlText.trim()}>添加 URL</button><div className={styles.batchRows}>{rows.map(row => <div key={row.id}><span><Preview url={row.url}/></span><input aria-label="表情名称" value={row.name} onChange={e => setRows(current => current.map(item => item.id === row.id ? { ...item, name: e.target.value } : item))}/><button type="button" aria-label="移除" onClick={() => setRows(current => current.filter(item => item.id !== row.id))}><X size={16}/></button></div>)}</div><button className={styles.confirm} type="button" disabled={saving || !rows.length} onClick={() => void saveBatch()}>导入 {rows.length} 个表情</button></>}
    </section></div>, document.querySelector("[data-lysn-app-root]")!)}
  </div>;
}
