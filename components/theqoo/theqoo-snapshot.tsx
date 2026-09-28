"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowUpRight, X } from "lucide-react";
import type { TheqooPost, TheqooTranslationMode } from "@/lib/theqoo-storage";
import { isMediaStoreRef, loadMediaObjectUrl } from "@/lib/media-cache-storage";
import { getChatImageFromIndexedDB } from "@/lib/chat-asset-storage";
import styles from "./theqoo-snapshot.module.css";

function SnapshotImage({ assetId }: { assetId: string }) {
  const [url,setUrl]=useState("");
  useEffect(()=>{let alive=true;let result="";(async()=>{result=(isMediaStoreRef(assetId)?await loadMediaObjectUrl(assetId):await getChatImageFromIndexedDB(assetId))||"";if(alive)setUrl(result);})();return ()=>{alive=false;if(result.startsWith("blob:"))URL.revokeObjectURL(result);};},[assetId]);
  return url?<img className={styles.image} src={url} alt="帖子配图"/>:null;
}

export function TheqooSnapshotWindow({ snapshot, onClose }: { snapshot: TheqooPost & {translationMode:TheqooTranslationMode}, onClose:()=>void }) {
  const parent=typeof document!=="undefined" ? document.querySelector(".phone-shell") || document.body : null;
  if(!parent)return null;
  const content=(original:string,translated:string)=><><div className={styles.original}>{snapshot.translationMode==="chinese"?translated:original}</div>{snapshot.translationMode==="repost"&&<div className={styles.repost}>{translated}</div>}{snapshot.translationMode==="folded"&&<details className={styles.fold} open><summary>中文翻译</summary>{translated}</details>}</>;
  return createPortal(<div className={styles.scrim} onClick={event=>{event.stopPropagation();onClose();}}><section role="dialog" aria-modal="true" aria-label="Theqoo 帖子快照" className={styles.window} onClick={e=>e.stopPropagation()}><header className={styles.header}><b>theqoo</b><button onClick={onClose} aria-label="关闭"><X size={20}/></button></header><div className={styles.scroll}><div className={styles.category}>{snapshot.category} · 무명의 더쿠</div><h3>{content(snapshot.titleOriginal,snapshot.titleTranslated)}</h3><div className={styles.body}>{content(snapshot.bodyOriginal,snapshot.bodyTranslated)}{snapshot.imageRef&&<SnapshotImage assetId={snapshot.imageRef}/>}</div><div className={styles.commentsHead}>댓글 {snapshot.comments.length}</div>{snapshot.comments.map((comment,i)=><div className={styles.comment} key={comment.id}><strong>{i+1}. 무명의 더쿠</strong>{content(comment.original,comment.translated)}</div>)}</div><footer className={styles.footer}><span>发送时的帖子快照</span><button onClick={()=>{sessionStorage.setItem("theqoo-open-post",snapshot.id);onClose();window.dispatchEvent(new CustomEvent("open-app",{detail:{appId:"theqoo"}}));}}>查看原帖 <ArrowUpRight size={16}/></button></footer></section></div>,parent);
}
