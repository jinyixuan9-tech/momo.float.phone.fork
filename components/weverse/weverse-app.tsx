"use client";

import { useMemo, useState } from "react";
import {
  Bell,
  Bookmark,
  ChevronLeft,
  ChevronRight,
  CircleUserRound,
  Heart,
  ImagePlus,
  Menu,
  MessageCircle,
  MoreHorizontal,
  Plus,
  Search,
  Send,
  Settings,
  Sparkles,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";

import styles from "./weverse-app.module.css";

type Props = {
  onClose: () => void;
  onNotice?: (message: string) => void;
};

type MainTab = "feed" | "community";
type Route =
  | { type: "root" }
  | { type: "community"; id: "wish" | "riize" }
  | { type: "artist"; communityId: "wish" | "riize"; artistId: string };

type DraftPost = {
  id: string;
  body: string;
  communityId: "wish" | "riize";
  createdAt: number;
};

const MEMBER_NAMES = ["SION", "RIKU", "YUSHI", "JAEHEE", "RYO", "SAKUYA"];

function Avatar({ text, tone = "dark", className = "" }: { text: string; tone?: "dark" | "teal" | "soft"; className?: string }) {
  return <span className={`${styles.avatar} ${styles[tone]} ${className}`}>{text.slice(0, 1)}</span>;
}

function Verified() {
  return <span className={styles.verify}>✓</span>;
}

function PostActions({ likes, comments }: { likes: string; comments: string }) {
  return (
    <div className={styles.actions}>
      <div className={styles.actionLeft}>
        <button type="button" className={styles.actionBtn}><Heart size={18} />{likes}</button>
        <button type="button" className={styles.actionBtn}><MessageCircle size={18} />{comments}</button>
      </div>
      <button type="button" className={styles.actionBtn} aria-label="收藏"><Bookmark size={18} /></button>
    </div>
  );
}

export function WeverseApp({ onClose, onNotice }: Props) {
  const [tab, setTab] = useState<MainTab>("feed");
  const [route, setRoute] = useState<Route>({ type: "root" });
  const [composerOpen, setComposerOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [translationOpen, setTranslationOpen] = useState(false);
  const [draftText, setDraftText] = useState("");
  const [draftCommunity, setDraftCommunity] = useState<"wish" | "riize">("wish");
  const [userPosts, setUserPosts] = useState<DraftPost[]>([]);
  const [communityTab, setCommunityTab] = useState<"home" | "artist" | "fan">("home");

  const title = route.type === "root"
    ? null
    : route.type === "community"
      ? route.id === "wish" ? "NCT WISH" : "RIIZE"
      : route.artistId;

  const currentCommunityId = route.type === "community"
    ? route.id
    : route.type === "artist"
      ? route.communityId
      : null;

  const feedUserPosts = useMemo(() => [...userPosts].sort((a, b) => b.createdAt - a.createdAt), [userPosts]);

  const goHome = (nextTab: MainTab) => {
    setRoute({ type: "root" });
    setTab(nextTab);
  };

  const publish = () => {
    const body = draftText.trim();
    if (!body) {
      onNotice?.("先写点内容再发布吧");
      return;
    }
    setUserPosts((prev) => [{ id: `wvs_user_${Date.now()}`, body, communityId: draftCommunity, createdAt: Date.now() }, ...prev]);
    setDraftText("");
    setComposerOpen(false);
    setTab("feed");
    setRoute({ type: "root" });
    onNotice?.("已发布到 WVS（当前为 UI 测试数据）");
  };

  const renderTopbar = () => (
    <header className={styles.topbar}>
      <div className={styles.toprow}>
        <div className={styles.leftTop}>
          <button type="button" className={styles.iconBtn} onClick={route.type === "root" ? onClose : () => setRoute(route.type === "artist" ? { type: "community", id: route.communityId } : { type: "root" })} aria-label="返回">
            <ChevronLeft size={22} />
          </button>
          {title ? <strong className={styles.pageTitle}>{title}</strong> : <div className={styles.brand}>weverse<span>✦</span></div>}
        </div>
        <div className={styles.topActions}>
          <button type="button" className={styles.iconBtn} onClick={() => onNotice?.("Ask Weverse 后续再接") } aria-label="Ask Weverse"><Sparkles size={20} /></button>
          <button type="button" className={styles.iconBtn} onClick={() => onNotice?.("通知页下一版接入") } aria-label="通知"><Bell size={20} /></button>
          <button type="button" className={styles.iconBtn} onClick={() => setDrawerOpen(true)} aria-label="我的"><CircleUserRound size={21} /></button>
        </div>
      </div>
    </header>
  );

  const renderFeed = () => (
    <div className={styles.scrollArea}>
      <div className={styles.feedTitle}><h2>My Feed</h2><span>全部社区</span></div>
      <div className={styles.storyRow}>
        <button type="button" className={styles.story} onClick={() => setRoute({ type: "community", id: "wish" })}><span className={styles.storyRing}><span>N</span></span><small>NCT WISH</small></button>
        <button type="button" className={styles.story} onClick={() => setRoute({ type: "community", id: "riize" })}><span className={styles.storyRing}><span>R</span></span><small>RIIZE</small></button>
        <button type="button" className={styles.story} onClick={() => onNotice?.("新建 Community 的正式配置下一版接入")}><span className={styles.storyRing}><span>＋</span></span><small>新社区</small></button>
      </div>
      <div className={styles.sectionGap} />

      {feedUserPosts.map((post) => (
        <article className={styles.post} key={post.id}>
          <div className={styles.postHead}>
            <Avatar text="ii" tone="soft" />
            <div className={styles.who}><div className={styles.name}>ii</div><div className={styles.meta}>{post.communityId === "wish" ? "NCT WISH" : "RIIZE"} · 刚刚</div></div>
            <button type="button" className={styles.more}><MoreHorizontal size={20} /></button>
          </div>
          <div className={styles.postBody}>{post.body}</div>
          <PostActions likes="0" comments="0" />
        </article>
      ))}

      <article className={styles.post}>
        <div className={styles.postHead}>
          <button type="button" className={styles.avatarButton} onClick={() => setRoute({ type: "artist", communityId: "wish", artistId: "SION" })}><Avatar text="S" /></button>
          <div className={styles.who}><div className={styles.name}>SION <Verified /></div><div className={styles.meta}>NCT WISH · 8分钟前</div></div>
          <button type="button" className={styles.more}><MoreHorizontal size={20} /></button>
        </div>
        <div className={styles.postBody}>{translationOpen ? "오늘은 진짜 날씨 좋다 ㅋㅋ 촬영 끝나고 조금 걸었어요" : "今天天气真的很好ㅋㅋ 拍摄结束以后稍微走了一会儿"}</div>
        <button type="button" className={styles.translateBtn} onClick={() => setTranslationOpen((prev) => !prev)}>{translationOpen ? "查看翻译" : "查看原文（한국어）"}</button>
        <div className={styles.mediaPlaceholder}><span>PHOTO</span></div>
        <PostActions likes="12.8K" comments="1.2K" />
      </article>

      <article className={`${styles.post} ${styles.officialPost}`}>
        <div className={styles.postHead}>
          <Avatar text="W" tone="teal" />
          <div className={styles.who}><div className={styles.name}>NCT WISH Official <Verified /></div><div className={styles.meta}>官方账号 · 1小时前</div></div>
          <button type="button" className={styles.more}><MoreHorizontal size={20} /></button>
        </div>
        <div className={styles.noticeTag}>NOTICE</div>
        <div className={styles.postBody}>NCT WISH Community 更新<br />本周公开活动与媒体内容将在 Community 内陆续更新。</div>
        <PostActions likes="8.4K" comments="539" />
      </article>

      <article className={styles.post}>
        <div className={styles.postHead}>
          <Avatar text="🍀" tone="soft" />
          <div className={styles.who}><div className={styles.name}>wishluv_0511</div><div className={styles.meta}>Fan · 2小时前</div></div>
          <button type="button" className={styles.more}><MoreHorizontal size={20} /></button>
        </div>
        <div className={styles.postBody}>今天路上看到一只兔子，真的太像某人了ㅋㅋㅋ</div>
        <div className={styles.replyChip}><b>SION <Verified /></b><p>ㅋㅋㅋ 인정 안 할 건데 조금 닮았네<br /><span>ㅋㅋㅋ 我本来不想承认的，但好像是有一点像</span></p></div>
        <PostActions likes="2.6K" comments="318" />
      </article>
      <div className={styles.bottomSpacer} />
    </div>
  );

  const renderCommunityList = () => (
    <div className={styles.scrollArea}>
      <div className={styles.communityHeader}><h2>Community</h2><button type="button" className={styles.iconBtn} onClick={() => onNotice?.("Community 管理下一版接入")}><Menu size={20} /></button></div>
      <div className={styles.search}><Search size={18} /><input placeholder="搜索我的社区" /></div>
      <div className={styles.sectionTitle}>我的社区</div>
      <div className={styles.communityGrid}>
        <button type="button" className={styles.communityCard} onClick={() => setRoute({ type: "community", id: "wish" })}>
          <div className={styles.communityLogo}>NCT<br />WISH</div>
          <div className={styles.communityInfo}><b>NCT WISH</b><p>6 位成员 · Official 已连接</p></div><ChevronRight size={21} />
        </button>
        <button type="button" className={styles.communityCard} onClick={() => setRoute({ type: "community", id: "riize" })}>
          <div className={`${styles.communityLogo} ${styles.riizeLogo}`}>RIIZE</div>
          <div className={styles.communityInfo}><b>RIIZE</b><p>6 位成员 · Official 已连接</p></div><ChevronRight size={21} />
        </button>
        <button type="button" className={`${styles.communityCard} ${styles.newCard}`} onClick={() => onNotice?.("下一版这里会进入：创建 Community → 设置官号 → 勾选角色") }><Plus size={18} /> 新建 Community</button>
      </div>
      <div className={styles.tipCard}>
        <Sparkles size={18} />
        <div><b>WVS UI 骨架</b><p>这一版先把你昨天确认的页面结构写进主项目。Community 数据、AI 运营、记忆、相册 Resolver 和 Schedule 下一步再逐层接入。</p></div>
      </div>
      <div className={styles.bottomSpacer} />
    </div>
  );

  const renderCommunity = (id: "wish" | "riize") => {
    const name = id === "wish" ? "NCT WISH" : "RIIZE";
    return (
      <div className={styles.scrollArea}>
        <div className={`${styles.hero} ${id === "riize" ? styles.heroRiize : ""}`}><strong>{name}</strong></div>
        <div className={styles.communityTop}>
          <div className={styles.communityTitleRow}><div><h1>{name}</h1><p>Official Community</p></div><button type="button" className={styles.joinBtn}>Joined</button></div>
          <div className={styles.memberRow}>
            {(id === "wish" ? MEMBER_NAMES : ["SHOTARO", "EUNSEOK", "SUNGCHAN", "WONBIN", "SOHEE", "ANTON"]).map((member) => (
              <button key={member} type="button" className={styles.member} onClick={() => setRoute({ type: "artist", communityId: id, artistId: member })}>
                <Avatar text={member} tone="soft" className={styles.memberAvatar} /><small>{member}</small>
              </button>
            ))}
          </div>
        </div>
        <div className={styles.subTabs}>
          {(["home", "artist", "fan"] as const).map((item) => <button type="button" key={item} className={communityTab === item ? styles.activeSubTab : ""} onClick={() => setCommunityTab(item)}>{item === "home" ? "Home" : item === "artist" ? "Artist" : "Fan"}</button>)}
        </div>
        <div className={styles.officialCard}>
          <Avatar text="W" tone="teal" />
          <div><b>{name} Official <Verified /></b><small>公开公告 · Schedule · 官方 LIVE</small></div>
          <button type="button" onClick={() => onNotice?.("接管官号 / Schedule 下一版接入")}>管理</button>
        </div>
        <article className={styles.post}>
          <div className={styles.postHead}><Avatar text={id === "wish" ? "S" : "W"} /><div className={styles.who}><div className={styles.name}>{id === "wish" ? "SION" : "WONBIN"} <Verified /></div><div className={styles.meta}>{name} · Artist</div></div><button type="button" className={styles.more}><MoreHorizontal size={20} /></button></div>
          <div className={styles.postBody}>{communityTab === "fan" ? "Community 里的粉丝内容会主要出现在这里，成员可能刷到、点赞、回复，也可能完全不理。" : communityTab === "artist" ? "这里集中显示成员本人发布和回复过的内容。" : "Community 是官号、成员、粉丝真正发生互动的地方。"}</div>
          <PostActions likes="4.9K" comments="286" />
        </article>
        <div className={styles.bottomSpacer} />
      </div>
    );
  };

  const renderArtist = (communityId: "wish" | "riize", artistId: string) => (
    <div className={styles.scrollArea}>
      <div className={`${styles.profileCover} ${communityId === "riize" ? styles.profileCoverRiize : ""}`} />
      <div className={styles.profileInfo}>
        <Avatar text={artistId} className={styles.profileAvatar} />
        <h2>{artistId} <Verified /></h2>
        <p>{communityId === "wish" ? "NCT WISH" : "RIIZE"} · Artist</p>
        <button type="button" className={styles.editProfileBtn} onClick={() => onNotice?.("成员 WVS 头像 / 昵称独立编辑下一版接入")}>编辑 WVS 显示资料</button>
      </div>
      <div className={styles.subTabs}><button type="button" className={styles.activeSubTab}>帖子</button><button type="button">评论</button><button type="button">LIVE</button></div>
      <article className={styles.post}>
        <div className={styles.postHead}><Avatar text={artistId} /><div className={styles.who}><div className={styles.name}>{artistId} <Verified /></div><div className={styles.meta}>最近动态</div></div></div>
        <div className={styles.postBody}>成员主页不是单独 Community，只负责汇总这个成员自己的帖子、回复和以后接入的个人 LIVE 回放。</div>
        <PostActions likes="8.1K" comments="603" />
      </article>
      <div className={styles.bottomSpacer} />
    </div>
  );

  const renderContent = () => {
    if (route.type === "community") return renderCommunity(route.id);
    if (route.type === "artist") return renderArtist(route.communityId, route.artistId);
    return tab === "feed" ? renderFeed() : renderCommunityList();
  };

  return (
    <div className={styles.root}>
      {renderTopbar()}
      <main className={styles.main}>{renderContent()}</main>

      {route.type === "root" ? (
        <nav className={styles.dock} aria-label="Weverse 导航">
          <button type="button" className={tab === "feed" ? styles.activeDock : ""} onClick={() => goHome("feed")}><span className={styles.dockGlyph}>W</span><small>Feed</small></button>
          <button type="button" className={styles.createButton} onClick={() => setComposerOpen(true)} aria-label="发布"><Plus size={25} /></button>
          <button type="button" className={tab === "community" ? styles.activeDock : ""} onClick={() => goHome("community")}><UsersRound size={22} /><small>Community</small></button>
        </nav>
      ) : null}

      {composerOpen ? (
        <div className={styles.sheetMask} onMouseDown={(event) => { if (event.currentTarget === event.target) setComposerOpen(false); }}>
          <section className={styles.sheet}>
            <div className={styles.sheetHandle} />
            <div className={styles.sheetTitle}><h2>发到 Community</h2><button type="button" className={styles.iconBtn} onClick={() => setComposerOpen(false)}><X size={20} /></button></div>
            <label className={styles.fieldLabel}>发布到</label>
            <select className={styles.select} value={draftCommunity} onChange={(event) => setDraftCommunity(event.target.value as "wish" | "riize")}>
              <option value="wish">NCT WISH</option>
              <option value="riize">RIIZE</option>
            </select>
            <textarea className={styles.textarea} value={draftText} onChange={(event) => setDraftText(event.target.value)} placeholder="写点什么吧…" />
            <div className={styles.mediaTools}><button type="button" onClick={() => onNotice?.("user 发图下一版接相册 / 本地上传")}><ImagePlus size={18} /> 图片</button><button type="button" onClick={() => onNotice?.("更多发布形式后续再加")}><Sparkles size={18} /> 更多</button></div>
            <button type="button" className={styles.primaryButton} onClick={publish}><Send size={18} /> 发布</button>
          </section>
        </div>
      ) : null}

      <div className={`${styles.drawerMask} ${drawerOpen ? styles.show : ""}`} onClick={() => setDrawerOpen(false)} />
      <aside className={`${styles.drawer} ${drawerOpen ? styles.show : ""}`}>
        <div className={styles.userCard}><Avatar text="ii" tone="soft" className={styles.userAvatar} /><div><h3>ii</h3><p>Fan account</p></div></div>
        <button type="button" className={styles.drawerItem}><UserRound size={20} /><span>我的资料</span></button>
        <button type="button" className={styles.drawerItem}><MessageCircle size={20} /><span>我的帖子与评论</span></button>
        <button type="button" className={styles.drawerItem}><Bookmark size={20} /><span>收藏</span></button>
        <button type="button" className={styles.drawerItem}><Settings size={20} /><span>WVS 设置</span></button>
        <button type="button" className={styles.drawerItem} onClick={onClose}><ChevronLeft size={20} /><span>返回桌面</span></button>
      </aside>
    </div>
  );
}
