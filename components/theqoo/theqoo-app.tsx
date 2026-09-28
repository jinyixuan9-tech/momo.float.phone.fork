"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Bookmark, Check, ChevronRight, ImagePlus, Languages, Menu, Pencil, Search, Send, Star, Trash2, X } from "lucide-react";
import { loadWorldBooks } from "@/lib/settings-storage";
import { loadCharacters } from "@/lib/character-storage";
import { createOrGetSession, pushChatMessage } from "@/lib/chat-storage";
import { generateImageFromConfiguredApi } from "@/lib/image-generation-service";
import { isMediaStoreRef, loadMediaObjectUrl } from "@/lib/media-cache-storage";
import { getChatImageFromIndexedDB } from "@/lib/chat-asset-storage";
import { generateTheqooPosts } from "@/lib/theqoo-engine";
import { loadTheqooState, saveTheqooState, type TheqooPost, type TheqooState, type TheqooTranslationMode } from "@/lib/theqoo-storage";
import styles from "./theqoo-app.module.css";

type Page = "home" | "detail" | "settings" | "my" | "favorites" | "published" | "world" | "translation" | "editor";
const CATEGORIES = ["전체", "HOT", "뉴스", "정보", "생활", "잡담", "유머", "뷰티", "영화·방송", "아이돌"];
const CAT_ZH: Record<string,string> = { "전체":"全部", "HOT":"HOT", "뉴스":"新闻", "정보":"资讯", "생활":"生活", "잡담":"闲谈", "유머":"幽默", "뷰티":"美妆", "영화·방송":"影视", "아이돌":"偶像", "이슈":"资讯", "기사·뉴스":"新闻", "드영배":"影视", "일상토크":"生活" };
const LEGACY_CAT: Record<string,string> = {"이슈":"정보","기사·뉴스":"뉴스","드영배":"영화·방송","일상토크":"생활"};
const MODES: TheqooTranslationMode[] = ["original","chinese","folded","repost"];
const MODE_ZH: Record<TheqooTranslationMode,string> = {original:"原文",chinese:"中文",folded:"折叠翻译",repost:"搬运风"};
const MODE_KO: Record<TheqooTranslationMode,string> = {original:"원문",chinese:"중국어",folded:"접기 번역",repost:"번역본 스타일"};
const newId = () => `tq_${Date.now()}_${Math.random().toString(36).slice(2,9)}`;

function ForumImage({ assetId }: { assetId: string }) {
  const [url,setUrl] = useState("");
  useEffect(()=>{ let alive=true; let result=""; (async()=>{
    result=(isMediaStoreRef(assetId)?await loadMediaObjectUrl(assetId):await getChatImageFromIndexedDB(assetId)) || "";
    if(alive)setUrl(result);
  })(); return ()=>{alive=false;if(result.startsWith("blob:"))URL.revokeObjectURL(result);}; },[assetId]);
  return url?<img className={styles.postImage} src={url} alt="帖子配图"/>:null;
}

export function TheqooApp({ onClose, onNotice }: { onClose:()=>void; onNotice?:(message:string)=>void }) {
  const [state,setState] = useState<TheqooState>(()=>loadTheqooState());
  const [category,setCategory] = useState("전체");
  const [page,setPage] = useState<Page>("home");
  const [postId,setPostId] = useState<string|null>(null);
  const [previousPage,setPreviousPage] = useState<Page>("home");
  const [keyword,setKeyword] = useState("");
  const [busy,setBusy] = useState(false);
  const [imageBusy,setImageBusy] = useState(false);
  const [imagePrompt,setImagePrompt] = useState("");
  const [imageEditor,setImageEditor] = useState(false);
  const [shareOpen,setShareOpen] = useState(false);
  const [openTranslations,setOpenTranslations] = useState<Record<string,boolean>>({});
  const [draft,setDraft] = useState({category:"잡담",titleOriginal:"",titleTranslated:"",bodyOriginal:"",bodyTranslated:""});
  const worldBooks = useMemo(()=>loadWorldBooks(),[]);
  const characters = useMemo(()=>loadCharacters(),[]);
  useEffect(()=>{const id=sessionStorage.getItem("theqoo-open-post");if(!id)return;sessionStorage.removeItem("theqoo-open-post");if(state.posts.some(p=>p.id===id)){setPostId(id);setPreviousPage("home");setPage("detail");}},[]);
  const selected=state.posts.find(p=>p.id===postId) || null;
  const zh=state.uiLanguage==="zh";
  const t=(ko:string,cn:string)=>zh?cn:ko;
  useEffect(()=>saveTheqooState(state),[state]);

  const visiblePosts=state.posts.filter(p=> {
    if(page==="favorites" && !p.favorite)return false;
    if(page==="published" && !p.authoredByUser)return false;
    if(page==="home" && category!=="전체" && (category==="HOT" ? p.views<10000 : (LEGACY_CAT[p.category]||p.category)!==category))return false;
    return true;
  });
  const goBack=()=>{ if(shareOpen){setShareOpen(false);return;} if(imageEditor){setImageEditor(false);return;} if(page==="detail"){setPage(previousPage);return;} if(page==="editor"){setPage(selected?"detail":"home");return;} if(["favorites","published","world","translation"].includes(page)){setPage(page==="world"||page==="translation"?"settings":"my");return;} if(page==="my"){setPage("settings");return;} if(page==="settings"){setPage("home");return;} onClose(); };
  const openPost=(p:TheqooPost)=>{setPostId(p.id);setPreviousPage(page);setPage("detail");};
  const updatePost=(id:string, patch:Partial<TheqooPost>)=>setState(s=>({...s,posts:s.posts.map(p=>p.id===id?{...p,...patch}:p)}));
  const refresh=async()=>{if(busy)return;setBusy(true);try{const rows=await generateTheqooPosts(state.worldBookIds,keyword);if(!rows.length)throw new Error("这次没有生成帖子，请重试。");setState(s=>({...s,posts:[...rows,...s.posts]}));setCategory("전체");onNotice?.(`已生成 ${rows.length} 条帖子。`);}catch(error){onNotice?.(error instanceof Error?error.message:"刷新失败，请重试。");}finally{setBusy(false);}};
  const openEditor=(p?:TheqooPost)=>{setPostId(p?.id||null);setDraft({category:LEGACY_CAT[p?.category||""]||p?.category||"잡담",titleOriginal:p?.titleOriginal||"",titleTranslated:p?.titleTranslated||"",bodyOriginal:p?.bodyOriginal||"",bodyTranslated:p?.bodyTranslated||""});setPage("editor");};
  const saveDraft=()=>{if(!draft.titleOriginal.trim()||!draft.bodyOriginal.trim()){onNotice?.("请填写韩文标题和正文。");return;}if(selected){updatePost(selected.id,{...draft,category:draft.category,titleTranslated:draft.titleTranslated.trim()||draft.titleOriginal.trim(),bodyTranslated:draft.bodyTranslated.trim()||draft.bodyOriginal.trim()});setPage("detail");}else{const post:TheqooPost={id:newId(),...draft,titleTranslated:draft.titleTranslated.trim()||draft.titleOriginal.trim(),bodyTranslated:draft.bodyTranslated.trim()||draft.bodyOriginal.trim(),views:0,createdAt:Date.now(),comments:[],favorite:false,authoredByUser:true};setState(s=>({...s,posts:[post,...s.posts]}));setPostId(post.id);setPreviousPage("home");setPage("detail");}};
  const deletePost=()=>{if(!selected||!window.confirm(t("이 게시글을 삭제할까요?","确定删除这篇帖子吗？")))return;setState(s=>({...s,posts:s.posts.filter(p=>p.id!==selected.id)}));setPostId(null);setPage(previousPage);};
  const generateImage=async()=>{if(!selected||imageBusy)return;setImageBusy(true);try{const result=await generateImageFromConfiguredApi({description:`韩国匿名论坛帖子配图，仅呈现文字图、海报排版或非人物主题的示意图。不要绘制任何真实艺人肖像。主题：${imagePrompt.trim()||selected.titleOriginal}`,appId:"theqoo"});if(!result)throw new Error("生图没有返回图片，请检查生图设置。");updatePost(selected.id,{imageRef:result.mediaRef,imagePrompt:imagePrompt.trim()||selected.titleOriginal});setImageEditor(false);}catch(error){onNotice?.(error instanceof Error?error.message:"生图失败，请重试。");}finally{setImageBusy(false);}};
  const shareTo=(characterId:string)=>{if(!selected)return;const session=createOrGetSession(characterId);const snapshot={...selected,comments:selected.comments.map(c=>({...c})),translationMode:state.translationMode};const comments=[...snapshot.comments].sort((a,b)=>b.original.length-a.original.length).slice(0,5);const context=`[Theqoo 匿名论坛帖子分享快照]\n板块：${CAT_ZH[selected.category]||selected.category}\n标题：${selected.titleOriginal}\n中文标题：${selected.titleTranslated}\n正文：${selected.bodyOriginal}\n中文正文：${selected.bodyTranslated}\n评论摘录：${comments.map((c,i)=>`\n${i+1}. ${c.original} / ${c.translated}`).join("")}\n（以上是用户发给你看的论坛帖子，评论为发送时选取的代表性留言。）`;
    pushChatMessage({sessionId:session.id,role:"user",content:context,mediaType:"app_card",mediaData:{appId:"theqoo",appName:"theqoo",appCardTitle:selected.titleOriginal,appCardBody:selected.bodyOriginal.slice(0,110),appCardSummary:selected.titleTranslated,appHistoryText:context,theqooSnapshot:snapshot,appCardLayout:{appLabel:"theqoo",subtitle:CAT_ZH[selected.category]||selected.category,body:selected.bodyOriginal.slice(0,110),accentColor:"#315777"}}});
    window.dispatchEvent(new CustomEvent("chat-messages-updated",{detail:{sessionId:session.id}}));setShareOpen(false);onNotice?.("已分享到 Chat。");window.dispatchEvent(new CustomEvent("open-app",{detail:{appId:"chat",sessionId:session.id}}));};
  const translation=(key:string,original:string,translated:string)=>{
    if(state.translationMode==="chinese")return <div className={styles.chineseText}>{translated||original}</div>;
    if(state.translationMode==="original")return <div className={styles.original}>{original}</div>;
    const open=openTranslations[key]!==false;
    return <><div className={styles.original}>{original}</div>{state.translationMode==="repost"?<div className={styles.repost}>{translated||original}</div>:<button className={styles.translationFold} onClick={()=>setOpenTranslations(s=>({...s,[key]:!open}))}>{open?(translated||original):t("중국어 번역 보기 ▾","展开中文翻译 ▾")}</button>}</>;
  };
  const title=page==="detail"?(CAT_ZH[selected?.category||""]||selected?.category||"theqoo"):{home:"theqoo",settings:t("설정","设置"),my:t("마이","我的"),favorites:t("스크랩","我的收藏"),published:t("내 글","我的发布"),world:t("세계관","世界书"),translation:t("번역 설정","翻译设置"),editor:t("글쓰기","发帖")}[page];
  return <div className={styles.app}>
    <header className={styles.top}><div className={styles.bar}>
      <button className={styles.back} onClick={goBack} aria-label="返回"><ArrowLeft size={24}/></button>
      {page==="home"&&<img className={styles.logoMark} src="/images/theqoo-logo.png" alt="theqoo"/>}<span className={styles.brand}>{title}</span><span className={styles.spacer}/>
      {page==="home"&&<><button className={styles.icon} onClick={()=>openEditor()} aria-label="发帖"><Pencil size={21}/></button><button className={styles.icon} onClick={()=>setState(s=>({...s,uiLanguage:zh?"ko":"zh"}))} aria-label="切换界面语言"><Languages size={22}/></button><button className={styles.icon} onClick={()=>setPage("settings")} aria-label="设置"><Menu size={23}/></button></>}
      {page==="detail"&&selected&&<><button className={styles.icon} onClick={()=>updatePost(selected.id,{favorite:!selected.favorite})} aria-label="收藏"><Star size={21} fill={selected.favorite?"currentColor":"none"}/></button><button className={styles.icon} onClick={()=>setShareOpen(true)} aria-label="分享给 Chat"><Send size={21}/></button></>}
    </div>{page==="home"&&<div className={styles.searchBand}><div className={styles.searchBox}><Search size={18}/><input value={keyword} onChange={e=>setKeyword(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")void refresh();}} placeholder={t("검색어 또는 보고 싶은 이야기","输入关键词或想看的内容")}/><button disabled={busy} onClick={()=>void refresh()}>{busy?t("생성 중","生成中"):t("검색","搜索")}</button></div></div>}</header>
    {page==="home"&&<main className={styles.content}><nav className={styles.categories}>{CATEGORIES.map(c=><button key={c} className={category===c?styles.active:""} onClick={()=>setCategory(c)}>{zh?CAT_ZH[c]:c}</button>)}</nav><PostList posts={visiblePosts} zh={zh} onOpen={openPost} empty={t("아직 게시글이 없습니다.","这里还没有帖子。")}/></main>}
    {page==="detail"&&selected&&<main className={styles.content} key={selected.id}><section className={styles.detailHead}>{translation(`title_${selected.id}`,selected.titleOriginal,selected.titleTranslated)}<div className={styles.postMeta}><span>{t("무명의 더쿠","匿名用户")}</span><span>·</span><span>{new Date(selected.createdAt).toLocaleString(zh?"zh-CN":"ko-KR")}</span><span>·</span><span>{t("조회", "浏览量")} {selected.views.toLocaleString()}</span><span className={styles.metaActions}><button onClick={()=>openEditor(selected)} aria-label="编辑"><Pencil size={15}/></button><button onClick={deletePost} aria-label="删除"><Trash2 size={15}/></button></span></div></section><section className={styles.body}>{translation(`body_${selected.id}`,selected.bodyOriginal,selected.bodyTranslated)}{selected.imageRef&&<ForumImage assetId={selected.imageRef}/>}<button className={styles.imageAction} onClick={()=>{setImagePrompt(selected.imagePrompt||selected.titleOriginal);setImageEditor(true);}}><ImagePlus size={16}/>{selected.imageRef?t("이미지 다시 생성","重新生图"):t("이미지 생성","手动生图")}</button></section><div className={styles.commentsTitle}>{t("댓글","评论")} {selected.comments.length}</div>{selected.comments.map((c,i)=><article className={styles.comment} key={c.id}><div className={styles.commentHead}>{i+1}. {t("무명의 더쿠","匿名用户")}<span className={styles.commentTime}>{new Date(c.createdAt).toLocaleTimeString(zh?"zh-CN":"ko-KR",{hour:"2-digit",minute:"2-digit"})}</span></div>{translation(`comment_${c.id}`,c.original,c.translated)}</article>)}</main>}
    {page==="settings"&&<main className={styles.content}><div className={styles.settingsList}><button onClick={()=>setPage("my")}><Bookmark size={19}/>{t("마이","我的")}<ChevronRight size={17}/></button><button onClick={()=>setPage("world")}><Bookmark size={19}/>{t("세계관","世界书")}<ChevronRight size={17}/></button><button onClick={()=>setPage("translation")}><Languages size={19}/>{t("번역 설정","翻译设置")}<ChevronRight size={17}/></button></div></main>}
    {page==="my"&&<main className={styles.content}><div className={styles.settingsList}><button onClick={()=>setPage("favorites")}><Star size={19}/>{t("스크랩","我的收藏")}<ChevronRight size={17}/></button><button onClick={()=>setPage("published")}><Pencil size={19}/>{t("내 글","我的发布")}<ChevronRight size={17}/></button></div></main>}
    {(page==="favorites"||page==="published")&&<main className={styles.content}><PostList posts={visiblePosts} zh={zh} onOpen={openPost} empty={t("아직 게시글이 없습니다.","这里还没有帖子。")}/></main>}
    {page==="world"&&<main className={styles.content}><p className={styles.hint}>{t("선택한 세계관만 이 포럼의 글 생성에 사용됩니다.","只使用在这里勾选的世界书，不默认继承其他绑定。")}</p>{worldBooks.map(book=><label className={styles.check} key={book.id}><input type="checkbox" checked={state.worldBookIds.includes(book.id)} onChange={e=>setState(s=>({...s,worldBookIds:e.target.checked?[...s.worldBookIds,book.id]:s.worldBookIds.filter(id=>id!==book.id)}))}/>{book.name}</label>)}{!worldBooks.length&&<p className={styles.hint}>{t("등록된 세계관이 없습니다.","尚无世界书。")}</p>}</main>}
    {page==="translation"&&<main className={styles.content}><p className={styles.hint}>{t("글 제목, 본문, 댓글의 표시 방식","控制帖子标题、正文和评论的翻译显示。")}</p>{MODES.map(mode=><button key={mode} className={styles.modeRow} onClick={()=>setState(s=>({...s,translationMode:mode}))}>{zh?MODE_ZH[mode]:MODE_KO[mode]}{state.translationMode===mode&&<Check size={18}/>}</button>)}</main>}
    {page==="editor"&&<main className={styles.content}><div className={styles.editor}><label>{t("게시판","分类")}<select value={draft.category} onChange={e=>setDraft(s=>({...s,category:e.target.value}))}>{CATEGORIES.slice(2).map(c=><option key={c} value={c}>{zh?CAT_ZH[c]:c}</option>)}</select></label><label>{t("제목 (한국어)","标题（韩文）")}<input value={draft.titleOriginal} onChange={e=>setDraft(s=>({...s,titleOriginal:e.target.value}))}/></label><label>{t("제목 (중국어 번역)","标题（中文翻译）")}<input value={draft.titleTranslated} onChange={e=>setDraft(s=>({...s,titleTranslated:e.target.value}))}/></label><label>{t("본문 (한국어)","正文（韩文）")}<textarea value={draft.bodyOriginal} onChange={e=>setDraft(s=>({...s,bodyOriginal:e.target.value}))}/></label><label>{t("본문 (중국어 번역)","正文（中文翻译）")}<textarea value={draft.bodyTranslated} onChange={e=>setDraft(s=>({...s,bodyTranslated:e.target.value}))}/></label><button className={styles.primary} onClick={saveDraft}>{t("게시하기","保存帖子")}</button></div></main>}
    {shareOpen&&selected&&<div className={styles.overlay} onClick={()=>setShareOpen(false)}><div className={styles.dialog} onClick={e=>e.stopPropagation()}><div className={styles.dialogTitle}>{t("Chat으로 공유","分享到 Chat")}<button onClick={()=>setShareOpen(false)}><X size={20}/></button></div><div className={styles.recipientList}>{characters.map(char=><button key={char.id} onClick={()=>shareTo(char.id)}>{char.name}<ChevronRight size={17}/></button>)}{!characters.length&&<p>{t("연락처가 없습니다.","还没有角色联系人。")}</p>}</div></div></div>}
    {imageEditor&&selected&&<div className={styles.overlay} onClick={()=>setImageEditor(false)}><div className={styles.dialog} onClick={e=>e.stopPropagation()}><div className={styles.dialogTitle}>{selected.imageRef?t("이미지 다시 생성","重新生图"):t("이미지 생성","手动生图")}<button onClick={()=>setImageEditor(false)}><X size={20}/></button></div><textarea value={imagePrompt} onChange={e=>setImagePrompt(e.target.value)} placeholder={t("이미지 설명","描述要生成的文字图")}/><button className={styles.primary} disabled={imageBusy} onClick={()=>void generateImage()}>{imageBusy?t("생성 중…","生成中…"):t("생성","生成")}</button>{selected.imageRef&&<button className={styles.secondary} onClick={()=>{updatePost(selected.id,{imageRef:undefined});setImageEditor(false);}}>{t("이미지 삭제","删除配图")}</button>}</div></div>}
  </div>;
}
function PostList({posts,zh,onOpen,empty}:{posts:TheqooPost[],zh:boolean,onOpen:(p:TheqooPost)=>void,empty:string}){return posts.length?<>{posts.map(p=><button key={p.id} className={styles.postRow} onClick={()=>onOpen(p)}><span className={styles.postTitle}>{zh?p.titleTranslated:p.titleOriginal}</span><span className={styles.postMeta}><span className={styles.cat}>{zh?CAT_ZH[p.category]||p.category:p.category}</span><span>·</span><span>{zh?"匿名用户":"무명의 더쿠"}</span><span>·</span><span>{new Date(p.createdAt).toLocaleDateString(zh?"zh-CN":"ko-KR")}</span><span>·</span><span>{zh?"浏览":"조회"} {p.views.toLocaleString()}</span><span>💬 {p.comments.length}</span></span></button>)}</>:<div className={styles.empty}>{empty}</div>;}
