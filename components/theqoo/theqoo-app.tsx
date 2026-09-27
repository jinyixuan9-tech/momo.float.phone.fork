"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Bookmark, Menu, RefreshCw, Share2, Star } from "lucide-react";
import { loadWorldBooks } from "@/lib/settings-storage";
import { generateTheqooPosts } from "@/lib/theqoo-engine";
import { loadTheqooState, saveTheqooState, type TheqooPost, type TheqooState, type TheqooTranslationMode } from "@/lib/theqoo-storage";
import styles from "./theqoo-app.module.css";

const CATEGORIES = ["전체","이슈","유머","정보","기사·뉴스","뷰티","드영배","일상토크"];
const CAT_ZH: Record<string,string> = { "전체":"全部","이슈":"热议","유머":"幽默","정보":"资讯","기사·뉴스":"新闻","뷰티":"美妆","드영배":"影视","일상토크":"日常闲聊" };
const MODE_LABEL: Record<TheqooTranslationMode,string> = { original:"原文", folded:"折叠翻译", repost:"搬运风" };

function ago(ts:number){ const m=Math.max(1,Math.floor((Date.now()-ts)/60000)); return m<60?`${m}분 전`:`${Math.floor(m/60)}시간 전`; }

export function TheqooApp({ onClose, onNotice }: { onClose:()=>void; onNotice?:(message:string)=>void }) {
  const [state,setState] = useState<TheqooState>(()=>loadTheqooState());
  const [category,setCategory] = useState("전체");
  const [selected,setSelected] = useState<TheqooPost|null>(null);
  const [menu,setMenu] = useState(false);
  const [busy,setBusy] = useState(false);
  const [openTranslations,setOpenTranslations] = useState<Record<string,boolean>>({});
  const worldBooks = useMemo(()=>loadWorldBooks(),[]);
  useEffect(()=>saveTheqooState(state),[state]);

  const visiblePosts = state.posts.filter(p=>category==="전체" || p.category===category);
  const label = (ko:string, zh:string)=>state.uiLanguage==="zh"?zh:ko;
  const displayTitle=(p:TheqooPost)=>state.uiLanguage==="zh"?p.titleTranslated:p.titleOriginal;

  const toggleFavorite=(id:string)=>setState(s=>({...s,posts:s.posts.map(p=>p.id===id?{...p,favorite:!p.favorite}:p)}));
  const refresh=async()=>{ setBusy(true); try{ const rows=await generateTheqooPosts(state.worldBookIds,category); setState(s=>({...s,posts:[...rows,...s.posts].slice(0,60)})); onNotice?.("Theqoo 已刷新一批匿名帖子。"); }catch(e){ onNotice?.(e instanceof Error?e.message:"刷新失败，请重试。"); }finally{setBusy(false);} };
  const share=async(p:TheqooPost)=>{ const text=`${p.titleOriginal}\n${p.bodyOriginal.slice(0,300)}`; try{ if(navigator.share) await navigator.share({title:p.titleOriginal,text}); else { await navigator.clipboard.writeText(text); onNotice?.("帖子内容已复制，可以贴到 Chat / SMS。 "); } }catch{} };

  const translation=(key:string,text:string)=>{
    if(state.translationMode==="original") return null;
    if(state.translationMode==="repost") return <div className={styles.repost}>{text}</div>;
    const opened=openTranslations[key]!==false;
    return <button className={styles.translationFold} type="button" onClick={()=>setOpenTranslations(v=>({...v,[key]:!opened}))}>{opened?text:"展开中文翻译 ▾"}</button>;
  };

  return <div className={styles.app}>
    <header className={styles.top}>
      <div className={styles.bar}>
        <button className={styles.back} onClick={selected?()=>setSelected(null):onClose} aria-label="返回"><ArrowLeft size={28}/></button>
        <span className={styles.logoMark}>the<br/>qoo</span><span className={styles.brand}>theqoo</span>
        <span className={styles.spacer}/>
        {selected && <button className={styles.icon} onClick={()=>share(selected)} aria-label="分享"><Share2 size={22}/></button>}
        {selected && <button className={`${styles.icon} ${selected.favorite?styles.favOn:""}`} onClick={()=>{toggleFavorite(selected.id);setSelected(p=>p?{...p,favorite:!p.favorite}:p)}} aria-label="收藏"><Star size={23} fill={selected.favorite?"currentColor":"none"}/></button>}
        <button className={styles.icon} onClick={()=>setMenu(v=>!v)} aria-label="菜单"><Menu size={25}/></button>
      </div>
      <div className={styles.subbar}>
        <span className={styles.sectionName}>{selected?selected.category:label("HOT 게시판","HOT 热门帖子")}</span>
        <div className={styles.modeGroup}>{(["original","folded","repost"] as TheqooTranslationMode[]).map(mode=><button key={mode} className={`${styles.modeBtn} ${state.translationMode===mode?styles.active:""}`} onClick={()=>setState(s=>({...s,translationMode:mode}))}>{MODE_LABEL[mode]}</button>)}</div>
      </div>
    </header>

    {menu && <aside className={styles.menu}>
      <h3>界面语言</h3>
      <div className={styles.menuActions}><button className={state.uiLanguage==="ko"?styles.primary:styles.secondary} onClick={()=>setState(s=>({...s,uiLanguage:"ko"}))}>한국어</button><button className={state.uiLanguage==="zh"?styles.primary:styles.secondary} onClick={()=>setState(s=>({...s,uiLanguage:"zh"}))}>中文</button></div>
      <h3>Theqoo 专属世界书</h3><p>只读取这里手动选中的世界书，不默认继承小手机当前全部世界书。</p>
      {worldBooks.length?worldBooks.map(book=><label className={styles.check} key={book.id}><input type="checkbox" checked={state.worldBookIds.includes(book.id)} onChange={e=>setState(s=>({...s,worldBookIds:e.target.checked?[...s.worldBookIds,book.id]:s.worldBookIds.filter(id=>id!==book.id)}))}/><span>{book.name}</span></label>):<p>还没有世界书，可以先去设置里创建。</p>}
      <div className={styles.menuActions}><button className={styles.secondary} onClick={()=>setMenu(false)}>完成</button><button className={styles.primary} disabled={busy} onClick={refresh}><RefreshCw size={14}/> {busy?"生成中…":"刷新帖子"}</button></div>
    </aside>}

    {!selected ? <main className={styles.content}>
      <nav className={styles.categories}>{CATEGORIES.map(c=><button key={c} className={category===c?styles.active:""} onClick={()=>setCategory(c)}>{state.uiLanguage==="zh"?(CAT_ZH[c]||c):c}</button>)}</nav>
      {visiblePosts.length?visiblePosts.map(p=><button key={p.id} className={styles.postRow} onClick={()=>setSelected(p)}>
        <span className={styles.postTitle}>{displayTitle(p)}</span>
        {state.translationMode==="repost" && state.uiLanguage==="ko" ? <span className={styles.repost}>{p.titleTranslated}</span>:null}
        <span className={styles.postMeta}><span className={styles.cat}>{state.uiLanguage==="zh"?(CAT_ZH[p.category]||p.category):p.category}</span><span>│</span><span>{label("무명의 더쿠","匿名用户")}</span><span>│</span><span>{ago(p.createdAt)}</span><span>│</span><span>{label(`조회 수 ${p.views.toLocaleString()}`,`浏览量 ${p.views.toLocaleString()}`)}</span><span>💬 {p.comments.length}</span></span>
      </button>):<div className={styles.empty}>这个分类暂时还没有帖子。</div>}
    </main> : <main className={styles.content}>
      <section className={styles.detailHead}><div className={styles.detailTitle}>{selected.titleOriginal}</div>{translation(`title_${selected.id}`,selected.titleTranslated)}<div className={styles.postMeta}><span>{label("무명의 더쿠","匿名用户")}</span><span>│</span><span>{ago(selected.createdAt)}</span><span>│</span><span>{label(`조회 수 ${selected.views.toLocaleString()}`,`浏览量 ${selected.views.toLocaleString()}`)}</span></div></section>
      <section className={styles.body}><div className={styles.original}>{selected.bodyOriginal}</div>{translation(`body_${selected.id}`,selected.bodyTranslated)}</section>
      <div className={styles.commentsTitle}><span>{label(`댓글 ${selected.comments.length}`,`评论 ${selected.comments.length}`)}</span><span className={styles.tools}><Bookmark size={17}/></span></div>
      {selected.comments.map((c,i)=><article className={styles.comment} key={c.id}><div className={styles.commentHead}>{i+1}. {label("무명의 더쿠","匿名用户")}<span className={styles.commentTime}>{ago(c.createdAt)}</span></div><div className={styles.commentText}>{c.original}</div>{translation(`c_${c.id}`,c.translated)}</article>)}
    </main>}
  </div>;
}
