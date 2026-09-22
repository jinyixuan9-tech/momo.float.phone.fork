"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bell,
  Bookmark,
  Camera,
  ChevronLeft,
  ChevronRight,
  CircleUserRound,
  Heart,
  ImagePlus,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Send,
  Settings,
  Sparkles,
  Trash2,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";

import { loadCharacters, CHARACTERS_UPDATED_EVENT } from "@/lib/character-storage";
import type { Character } from "@/lib/character-types";
import { resolveUserIdentity } from "@/lib/settings-storage";
import {
  addWeverseComment,
  addWeversePost,
  createWeverseId,
  deleteWeverseCommunity,
  loadWeverseState,
  updateWeversePost,
  upsertWeverseCommunity,
  WEV_UPDATED_EVENT,
  type WeverseCommunity,
  type WeversePost,
  type WeverseState,
} from "@/lib/weverse-storage";

import styles from "./weverse-app.module.css";

type Props = {
  onClose: () => void;
  onNotice?: (message: string) => void;
};

type MainTab = "feed" | "community";
type CommunitySubTab = "home" | "artist" | "fan";
type Route =
  | { type: "root" }
  | { type: "community"; id: string }
  | { type: "artist"; communityId: string; characterId: string }
  | { type: "post"; postId: string };

type CommunityEditorDraft = {
  id?: string;
  name: string;
  description: string;
  coverUrl: string;
  officialName: string;
  officialAvatarUrl: string;
  officialBio: string;
  selectedCharacterIds: string[];
};

type MemberEditorDraft = {
  communityId: string;
  characterId: string;
  displayName: string;
  avatarUrl: string;
  bio: string;
};

function fileToDataUrl(file: File, maxSize = 900, quality = 0.86): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const scale = Math.min(maxSize / img.width, maxSize / img.height, 1);
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("无法读取图片"));
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/webp", quality));
      };
      img.onerror = reject;
      img.src = String(reader.result || "");
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function relativeTime(ts: number): string {
  const diff = Math.max(0, Date.now() - ts);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return "刚刚";
  if (diff < hour) return `${Math.floor(diff / minute)}分钟前`;
  if (diff < day) return `${Math.floor(diff / hour)}小时前`;
  if (diff < day * 7) return `${Math.floor(diff / day)}天前`;
  return new Date(ts).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

function Avatar({
  text,
  imageUrl,
  tone = "dark",
  className = "",
}: {
  text: string;
  imageUrl?: string | null;
  tone?: "dark" | "teal" | "soft";
  className?: string;
}) {
  if (imageUrl) {
    return <span className={`${styles.avatar} ${styles.avatarImage} ${className}`}><img src={imageUrl} alt="" /></span>;
  }
  return <span className={`${styles.avatar} ${styles[tone]} ${className}`}>{text.trim().slice(0, 1) || "W"}</span>;
}

function Verified() {
  return <span className={styles.verify}>✓</span>;
}

export function WeverseApp({ onClose, onNotice }: Props) {
  const [tab, setTab] = useState<MainTab>("feed");
  const [routeStack, setRouteStack] = useState<Route[]>([{ type: "root" }]);
  const [state, setState] = useState<WeverseState>(() => loadWeverseState());
  const [characters, setCharacters] = useState<Character[]>(() => loadCharacters());
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerMode, setComposerMode] = useState<"user" | "official">("user");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [communityEditor, setCommunityEditor] = useState<CommunityEditorDraft | null>(null);
  const [communityEditorError, setCommunityEditorError] = useState("");
  const [memberEditor, setMemberEditor] = useState<MemberEditorDraft | null>(null);
  const [draftText, setDraftText] = useState("");
  const [draftImageUrl, setDraftImageUrl] = useState("");
  const [draftCommunityId, setDraftCommunityId] = useState("");
  const [commentDraft, setCommentDraft] = useState("");
  const [communityTab, setCommunityTab] = useState<CommunitySubTab>("home");
  const [searchText, setSearchText] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const officialAvatarInputRef = useRef<HTMLInputElement>(null);
  const memberAvatarInputRef = useRef<HTMLInputElement>(null);

  const route = routeStack[routeStack.length - 1] ?? { type: "root" as const };
  const userIdentity = resolveUserIdentity(undefined, "weverse") ?? resolveUserIdentity();
  const userName = userIdentity?.name?.trim() || "我";
  const userAvatar = userIdentity?.avatarUrl || "";

  useEffect(() => {
    const reloadState = () => setState(loadWeverseState());
    const reloadCharacters = () => setCharacters(loadCharacters());
    window.addEventListener(WEV_UPDATED_EVENT, reloadState);
    window.addEventListener(CHARACTERS_UPDATED_EVENT, reloadCharacters);
    return () => {
      window.removeEventListener(WEV_UPDATED_EVENT, reloadState);
      window.removeEventListener(CHARACTERS_UPDATED_EVENT, reloadCharacters);
    };
  }, []);

  useEffect(() => {
    if (!draftCommunityId && state.communities[0]?.id) setDraftCommunityId(state.communities[0].id);
    if (draftCommunityId && !state.communities.some((item) => item.id === draftCommunityId)) {
      setDraftCommunityId(state.communities[0]?.id || "");
    }
  }, [draftCommunityId, state.communities]);

  const characterMap = useMemo(() => new Map(characters.map((item) => [item.id, item])), [characters]);
  const communityMap = useMemo(() => new Map(state.communities.map((item) => [item.id, item])), [state.communities]);
  const postMap = useMemo(() => new Map(state.posts.map((item) => [item.id, item])), [state.posts]);
  const filteredCommunities = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    if (!query) return state.communities;
    return state.communities.filter((item) => item.name.toLowerCase().includes(query));
  }, [searchText, state.communities]);

  const navigate = (next: Route) => setRouteStack((prev) => [...prev, next]);
  const back = () => {
    if (routeStack.length > 1) setRouteStack((prev) => prev.slice(0, -1));
    else onClose();
  };
  const goRoot = (nextTab: MainTab) => {
    setTab(nextTab);
    setRouteStack([{ type: "root" }]);
  };

  const resolveMember = (community: WeverseCommunity, characterId: string) => {
    const char = characterMap.get(characterId);
    const override = community.memberProfiles[characterId];
    return {
      character: char,
      displayName: override?.displayName?.trim() || char?.name?.trim() || "未命名成员",
      avatarUrl: override?.avatarUrl || char?.avatar || "",
      bio: override?.bio || "",
    };
  };

  const resolvePostAuthor = (post: WeversePost) => {
    const community = communityMap.get(post.communityId);
    if (post.authorType === "user") {
      return { name: userName, avatarUrl: userAvatar, verified: false, meta: `${community?.name || "Community"} · Fan` };
    }
    if (post.authorType === "official") {
      return {
        name: community?.official.displayName || `${community?.name || "Community"} Official`,
        avatarUrl: community?.official.avatarUrl || "",
        verified: true,
        meta: `${community?.name || "Community"} · Official`,
      };
    }
    if (community) {
      const member = resolveMember(community, post.authorId);
      return { name: member.displayName, avatarUrl: member.avatarUrl, verified: true, meta: `${community.name} · Artist` };
    }
    return { name: characterMap.get(post.authorId)?.name || "Artist", avatarUrl: characterMap.get(post.authorId)?.avatar || "", verified: true, meta: "Artist" };
  };

  const openCommunityEditor = (community?: WeverseCommunity) => {
    setCommunityEditorError("");
    setCommunityEditor({
      id: community?.id,
      name: community?.name || "",
      description: community?.description || "",
      coverUrl: community?.coverUrl || "",
      officialName: community?.official.displayName || "",
      officialAvatarUrl: community?.official.avatarUrl || "",
      officialBio: community?.official.bio || "",
      selectedCharacterIds: community?.memberCharacterIds || [],
    });
  };

  const saveCommunityEditor = () => {
    if (!communityEditor) return;
    const name = communityEditor.name.trim();
    if (!name) {
      setCommunityEditorError("先填写 Community 名称");
      onNotice?.("先填写 Community 名称");
      return;
    }
    if (communityEditor.selectedCharacterIds.length === 0) {
      setCommunityEditorError("至少选择 1 个成员角色");
      onNotice?.("至少选择 1 个成员角色");
      return;
    }
    setCommunityEditorError("");
    const existing = communityEditor.id ? communityMap.get(communityEditor.id) : undefined;
    const now = Date.now();
    const id = existing?.id || createWeverseId("wvs_community");
    const memberProfiles = { ...(existing?.memberProfiles || {}) };
    Object.keys(memberProfiles).forEach((key) => {
      if (!communityEditor.selectedCharacterIds.includes(key)) delete memberProfiles[key];
    });
    const next: WeverseCommunity = {
      id,
      name,
      description: communityEditor.description.trim(),
      coverUrl: communityEditor.coverUrl || undefined,
      official: {
        displayName: communityEditor.officialName.trim() || `${name} Official`,
        avatarUrl: communityEditor.officialAvatarUrl || undefined,
        bio: communityEditor.officialBio.trim() || "Official Community",
      },
      memberCharacterIds: communityEditor.selectedCharacterIds,
      memberProfiles,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    const nextState = upsertWeverseCommunity(next);
    setState(nextState);
    setCommunityEditor(null);
    setCommunityEditorError("");
    setDraftCommunityId(id);
    onNotice?.(existing ? "Community 已更新" : "Community 已创建");
  };

  const removeCommunity = (community: WeverseCommunity) => {
    if (!window.confirm(`删除「${community.name}」Community？该社区里的 WVS 帖子也会一起删除。`)) return;
    setState(deleteWeverseCommunity(community.id));
    setCommunityEditor(null);
    setRouteStack([{ type: "root" }]);
    setTab("community");
  };

  const openMemberEditor = (community: WeverseCommunity, characterId: string) => {
    const member = resolveMember(community, characterId);
    setMemberEditor({
      communityId: community.id,
      characterId,
      displayName: member.displayName,
      avatarUrl: member.avatarUrl,
      bio: member.bio,
    });
  };

  const saveMemberEditor = () => {
    if (!memberEditor) return;
    const community = communityMap.get(memberEditor.communityId);
    if (!community) return;
    const char = characterMap.get(memberEditor.characterId);
    const next: WeverseCommunity = {
      ...community,
      memberProfiles: {
        ...community.memberProfiles,
        [memberEditor.characterId]: {
          characterId: memberEditor.characterId,
          displayName: memberEditor.displayName.trim() || char?.name || "成员",
          avatarUrl: memberEditor.avatarUrl || undefined,
          bio: memberEditor.bio.trim() || undefined,
        },
      },
      updatedAt: Date.now(),
    };
    setState(upsertWeverseCommunity(next));
    setMemberEditor(null);
    onNotice?.("成员 WVS 资料已保存，不影响角色本体资料");
  };

  const openComposer = (mode: "user" | "official", communityId?: string) => {
    if (state.communities.length === 0) {
      onNotice?.("先创建一个 Community");
      setTab("community");
      return;
    }
    setComposerMode(mode);
    setDraftCommunityId(communityId || draftCommunityId || state.communities[0].id);
    setDraftText("");
    setDraftImageUrl("");
    setComposerOpen(true);
  };

  const publish = () => {
    const body = draftText.trim();
    if (!body && !draftImageUrl) return onNotice?.("先写点内容或加一张图片吧");
    const community = communityMap.get(draftCommunityId);
    if (!community) return onNotice?.("请选择发布到哪个 Community");
    const post: WeversePost = {
      id: createWeverseId("wvs_post"),
      communityId: community.id,
      authorType: composerMode,
      authorId: composerMode === "user" ? (userIdentity?.id || "user") : community.id,
      body,
      imageUrl: draftImageUrl || undefined,
      createdAt: Date.now(),
      comments: [],
    };
    setState(addWeversePost(post));
    setComposerOpen(false);
    setDraftText("");
    setDraftImageUrl("");
    if (composerMode === "user") goRoot("feed");
    onNotice?.(composerMode === "official" ? "已用 Official Account 发布" : "已发布到 WVS");
  };

  const toggleLike = (post: WeversePost) => setState(updateWeversePost(post.id, { likedByUser: !post.likedByUser }));
  const toggleBookmark = (post: WeversePost) => setState(updateWeversePost(post.id, { bookmarkedByUser: !post.bookmarkedByUser }));

  const submitComment = (post: WeversePost) => {
    const body = commentDraft.trim();
    if (!body) return;
    setState(addWeverseComment(post.id, {
      id: createWeverseId("wvs_comment"),
      authorType: "user",
      authorId: userIdentity?.id || "user",
      body,
      createdAt: Date.now(),
    }));
    setCommentDraft("");
  };

  const renderPostActions = (post: WeversePost, detail = false) => (
    <div className={styles.actions}>
      <div className={styles.actionLeft}>
        <button type="button" className={`${styles.actionBtn} ${post.likedByUser ? styles.activeAction : ""}`} onClick={() => toggleLike(post)}><Heart size={18} fill={post.likedByUser ? "currentColor" : "none"} />{post.likedByUser ? "1" : "0"}</button>
        <button type="button" className={styles.actionBtn} onClick={() => detail ? undefined : navigate({ type: "post", postId: post.id })}><MessageCircle size={18} />{post.comments.length}</button>
      </div>
      <button type="button" className={`${styles.actionBtn} ${post.bookmarkedByUser ? styles.activeAction : ""}`} onClick={() => toggleBookmark(post)} aria-label="收藏"><Bookmark size={18} fill={post.bookmarkedByUser ? "currentColor" : "none"} /></button>
    </div>
  );

  const renderPost = (post: WeversePost, detail = false) => {
    const community = communityMap.get(post.communityId);
    if (!community) return null;
    const author = resolvePostAuthor(post);
    const openAuthor = () => {
      if (post.authorType === "artist") navigate({ type: "artist", communityId: post.communityId, characterId: post.authorId });
      else if (post.authorType === "official") navigate({ type: "community", id: post.communityId });
    };
    return (
      <article className={`${styles.post} ${post.authorType === "official" ? styles.officialPost : ""}`} key={post.id}>
        <div className={styles.postHead}>
          <button type="button" className={styles.avatarButton} onClick={openAuthor} disabled={post.authorType === "user"}>
            <Avatar text={author.name} imageUrl={author.avatarUrl} tone={post.authorType === "official" ? "teal" : post.authorType === "user" ? "soft" : "dark"} />
          </button>
          <div className={styles.who} onClick={() => !detail && navigate({ type: "post", postId: post.id })}>
            <div className={styles.name}>{author.name} {author.verified ? <Verified /> : null}</div>
            <div className={styles.meta}>{author.meta} · {relativeTime(post.createdAt)}</div>
          </div>
          <button type="button" className={styles.more}><MoreHorizontal size={20} /></button>
        </div>
        {post.authorType === "official" ? <div className={styles.noticeTag}>OFFICIAL</div> : null}
        {post.body ? <div className={styles.postBody} onClick={() => !detail && navigate({ type: "post", postId: post.id })}>{post.body}</div> : null}
        {post.imageUrl ? <button type="button" className={styles.postImageButton} onClick={() => !detail && navigate({ type: "post", postId: post.id })}><img className={styles.postImage} src={post.imageUrl} alt="WVS post" /></button> : null}
        {renderPostActions(post, detail)}
      </article>
    );
  };

  const currentTitle = () => {
    if (route.type === "community") return communityMap.get(route.id)?.name || "Community";
    if (route.type === "artist") {
      const community = communityMap.get(route.communityId);
      return community ? resolveMember(community, route.characterId).displayName : "Artist";
    }
    if (route.type === "post") return "Post";
    return null;
  };

  const renderTopbar = () => (
    <header className={styles.topbar}>
      <div className={styles.toprow}>
        <div className={styles.leftTop}>
          <button type="button" className={styles.iconBtn} onClick={back} aria-label="返回"><ChevronLeft size={22} /></button>
          {currentTitle() ? <strong className={styles.pageTitle}>{currentTitle()}</strong> : <div className={styles.brand}>weverse<span>✦</span></div>}
        </div>
        <div className={styles.topActions}>
          <button type="button" className={styles.iconBtn} onClick={() => onNotice?.("Ask Weverse 后续再接") } aria-label="Ask Weverse"><Sparkles size={20} /></button>
          <button type="button" className={styles.iconBtn} onClick={() => onNotice?.("通知页后续接入") } aria-label="通知"><Bell size={20} /></button>
          <button type="button" className={styles.iconBtn} onClick={() => setDrawerOpen(true)} aria-label="我的"><CircleUserRound size={21} /></button>
        </div>
      </div>
    </header>
  );

  const renderFeed = () => {
    const posts = [...state.posts].sort((a, b) => b.createdAt - a.createdAt);
    return (
      <div className={styles.scrollArea}>
        <div className={styles.feedTitle}><h2>My Feed</h2><span>{state.communities.length ? `${state.communities.length} 个社区` : "还没有社区"}</span></div>
        <div className={styles.storyRow}>
          {state.communities.map((community) => (
            <button type="button" className={styles.story} key={community.id} onClick={() => navigate({ type: "community", id: community.id })}>
              <span className={styles.storyRing}><Avatar text={community.name} imageUrl={community.official.avatarUrl} tone="soft" className={styles.storyAvatar} /></span>
              <small>{community.name}</small>
            </button>
          ))}
          <button type="button" className={styles.story} onClick={() => openCommunityEditor()}><span className={styles.storyRing}><span>＋</span></span><small>新社区</small></button>
        </div>
        <div className={styles.sectionGap} />
        {posts.length ? posts.map((post) => renderPost(post)) : (
          <div className={styles.emptyState}>
            <UsersRound size={30} />
            <b>Feed 还是空的</b>
            <p>{state.communities.length ? "你可以先发一条 Fan Post，或进入 Community 接管官号发一条官方动态。" : "先创建一个 Community，再把现有角色绑定进来。"}</p>
            <button type="button" onClick={() => state.communities.length ? openComposer("user") : openCommunityEditor()}>{state.communities.length ? "发第一条帖子" : "创建 Community"}</button>
          </div>
        )}
        <div className={styles.bottomSpacer} />
      </div>
    );
  };

  const renderCommunityList = () => (
    <div className={styles.scrollArea}>
      <div className={styles.communityHeader}><h2>Community</h2><button type="button" className={styles.iconBtn} onClick={() => openCommunityEditor()}><Plus size={20} /></button></div>
      <div className={styles.search}><Search size={18} /><input value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="搜索我的社区" /></div>
      <div className={styles.sectionTitle}>我的社区</div>
      <div className={styles.communityGrid}>
        {filteredCommunities.map((community) => (
          <button type="button" className={styles.communityCard} key={community.id} onClick={() => navigate({ type: "community", id: community.id })}>
            <div className={styles.communityLogo}>{community.coverUrl ? <img src={community.coverUrl} alt="" /> : community.name.slice(0, 5)}</div>
            <div className={styles.communityInfo}><b>{community.name}</b><p>{community.memberCharacterIds.length} 位成员 · {community.official.displayName}</p></div><ChevronRight size={21} />
          </button>
        ))}
        <button type="button" className={`${styles.communityCard} ${styles.newCard}`} onClick={() => openCommunityEditor()}><Plus size={18} /> 新建 Community</button>
      </div>
      {!state.communities.length ? <div className={styles.tipCard}><Sparkles size={18} /><div><b>从这里开始</b><p>建立 Community → 设置官号 → 从现有角色里勾选成员。没有勾选的角色不会进入 WVS。</p></div></div> : null}
      <div className={styles.bottomSpacer} />
    </div>
  );

  const renderCommunity = (community: WeverseCommunity) => {
    const memberIds = community.memberCharacterIds;
    const posts = [...state.posts]
      .filter((post) => post.communityId === community.id)
      .filter((post) => communityTab === "home" || (communityTab === "artist" ? post.authorType === "artist" || post.authorType === "official" : post.authorType === "user"))
      .sort((a, b) => b.createdAt - a.createdAt);
    return (
      <div className={styles.scrollArea}>
        <div className={styles.hero} style={community.coverUrl ? { backgroundImage: `linear-gradient(180deg,rgba(0,0,0,.05),rgba(0,0,0,.35)),url(${community.coverUrl})` } : undefined}><strong>{community.name}</strong></div>
        <div className={styles.communityTop}>
          <div className={styles.communityTitleRow}><div><h1>{community.name}</h1><p>{community.description || "Official Community"}</p></div><button type="button" className={styles.joinBtn}>Joined</button></div>
          <div className={styles.memberRow}>
            {memberIds.map((characterId) => {
              const member = resolveMember(community, characterId);
              return (
                <button key={characterId} type="button" className={styles.member} onClick={() => navigate({ type: "artist", communityId: community.id, characterId })}>
                  <Avatar text={member.displayName} imageUrl={member.avatarUrl} tone="soft" className={styles.memberAvatar} /><small>{member.displayName}</small>
                </button>
              );
            })}
          </div>
        </div>
        <div className={styles.subTabs}>
          {(["home", "artist", "fan"] as const).map((item) => <button type="button" key={item} className={communityTab === item ? styles.activeSubTab : ""} onClick={() => setCommunityTab(item)}>{item === "home" ? "Home" : item === "artist" ? "Artist" : "Fan"}</button>)}
        </div>
        <div className={styles.officialCard}>
          <Avatar text={community.official.displayName} imageUrl={community.official.avatarUrl} tone="teal" />
          <div><b>{community.official.displayName} <Verified /></b><small>{community.official.bio || "公告 · Schedule · 官方 LIVE"}</small></div>
          <button type="button" onClick={() => openCommunityEditor(community)}>管理</button>
        </div>
        {posts.length ? posts.map((post) => renderPost(post)) : <div className={styles.emptyMini}>这个 Community 还没有帖子。你可以从底部＋发 Fan Post，或点「管理」接管官号发布。</div>}
        <div className={styles.bottomSpacer} />
      </div>
    );
  };

  const renderArtist = (community: WeverseCommunity, characterId: string) => {
    const member = resolveMember(community, characterId);
    const posts = state.posts.filter((post) => post.communityId === community.id && post.authorType === "artist" && post.authorId === characterId).sort((a, b) => b.createdAt - a.createdAt);
    return (
      <div className={styles.scrollArea}>
        <div className={styles.profileCover} style={community.coverUrl ? { backgroundImage: `linear-gradient(180deg,rgba(0,0,0,.05),rgba(0,0,0,.3)),url(${community.coverUrl})` } : undefined} />
        <div className={styles.profileInfo}>
          <Avatar text={member.displayName} imageUrl={member.avatarUrl} className={styles.profileAvatar} />
          <h2>{member.displayName} <Verified /></h2>
          <p>{community.name} · Artist</p>
          {member.bio ? <p className={styles.profileBio}>{member.bio}</p> : null}
          <button type="button" className={styles.editProfileBtn} onClick={() => openMemberEditor(community, characterId)}><Pencil size={13} /> 编辑 WVS 显示资料</button>
        </div>
        <div className={styles.subTabs}><button type="button" className={styles.activeSubTab}>帖子</button><button type="button" onClick={() => onNotice?.("成员回复汇总下一版接 AI 后开放")}>评论</button><button type="button" onClick={() => onNotice?.("LIVE 后续版本接入")}>LIVE</button></div>
        {posts.length ? posts.map((post) => renderPost(post)) : <div className={styles.emptyMini}>这里以后会汇总这个成员自己的 Artist Post、回复和 LIVE 回放。AI 自动发帖下一版接入。</div>}
        <div className={styles.bottomSpacer} />
      </div>
    );
  };

  const renderPostDetail = (post: WeversePost) => (
    <div className={styles.scrollArea}>
      {renderPost(post, true)}
      <div className={styles.commentsTitle}>Comments <span>{post.comments.length}</span></div>
      <div className={styles.commentsList}>
        {post.comments.map((comment) => (
          <div className={styles.commentCard} key={comment.id}>
            <Avatar text={userName} imageUrl={userAvatar} tone="soft" />
            <div><b>{userName}</b><small>{relativeTime(comment.createdAt)}</small><p>{comment.body}</p></div>
          </div>
        ))}
        {!post.comments.length ? <div className={styles.emptyComment}>还没有评论</div> : null}
      </div>
      <div className={styles.commentComposer}><input value={commentDraft} onChange={(event) => setCommentDraft(event.target.value)} placeholder="发表评论…" onKeyDown={(event) => { if (event.key === "Enter") submitComment(post); }} /><button type="button" onClick={() => submitComment(post)}><Send size={17} /></button></div>
      <div className={styles.bottomSpacer} />
    </div>
  );

  const renderContent = () => {
    if (route.type === "community") {
      const community = communityMap.get(route.id);
      return community ? renderCommunity(community) : renderCommunityList();
    }
    if (route.type === "artist") {
      const community = communityMap.get(route.communityId);
      return community ? renderArtist(community, route.characterId) : renderCommunityList();
    }
    if (route.type === "post") {
      const post = postMap.get(route.postId);
      return post ? renderPostDetail(post) : renderFeed();
    }
    return tab === "feed" ? renderFeed() : renderCommunityList();
  };

  return (
    <div className={styles.root}>
      {renderTopbar()}
      <main className={styles.main}>{renderContent()}</main>

      {route.type === "root" ? (
        <nav className={styles.dock} aria-label="Weverse 导航">
          <button type="button" className={tab === "feed" ? styles.activeDock : ""} onClick={() => goRoot("feed")}><span className={styles.dockGlyph}>W</span><small>Feed</small></button>
          <button type="button" className={styles.createButton} onClick={() => openComposer("user")} aria-label="发布"><Plus size={25} /></button>
          <button type="button" className={tab === "community" ? styles.activeDock : ""} onClick={() => goRoot("community")}><UsersRound size={22} /><small>Community</small></button>
        </nav>
      ) : null}

      {composerOpen ? (
        <div className={styles.sheetMask} onMouseDown={(event) => { if (event.currentTarget === event.target) setComposerOpen(false); }}>
          <section className={styles.sheet}>
            <div className={styles.sheetHandle} />
            <div className={styles.sheetTitle}><h2>{composerMode === "official" ? "Official Post" : "发到 Community"}</h2><button type="button" className={styles.iconBtn} onClick={() => setComposerOpen(false)}><X size={20} /></button></div>
            <label className={styles.fieldLabel}>发布到</label>
            <select className={styles.select} value={draftCommunityId} onChange={(event) => setDraftCommunityId(event.target.value)} disabled={composerMode === "official"}>
              {state.communities.map((community) => <option value={community.id} key={community.id}>{community.name}</option>)}
            </select>
            <textarea className={styles.textarea} value={draftText} onChange={(event) => setDraftText(event.target.value)} placeholder={composerMode === "official" ? "写一条官方公告或动态…" : "写点什么吧…"} />
            {draftImageUrl ? <div className={styles.composePreview}><img src={draftImageUrl} alt="预览" /><button type="button" onClick={() => setDraftImageUrl("")}><X size={16} /></button></div> : null}
            <div className={styles.mediaTools}><button type="button" onClick={() => fileInputRef.current?.click()}><ImagePlus size={18} /> 本地图片</button><button type="button" onClick={() => onNotice?.("下一版这里会接 Photos Resolver") }><Sparkles size={18} /> 照片库</button></div>
            <input ref={fileInputRef} className={styles.hiddenInput} type="file" accept="image/*" onChange={async (event) => { const file = event.target.files?.[0]; if (file) setDraftImageUrl(await fileToDataUrl(file)); event.currentTarget.value = ""; }} />
            <button type="button" className={styles.primaryButton} onClick={publish}><Send size={18} /> 发布</button>
          </section>
        </div>
      ) : null}

      {communityEditor ? (
        <div className={styles.fullModal}>
          <div className={styles.modalHeader}><button type="button" className={styles.modalBackBtn} aria-label="返回" onPointerDown={(e) => e.stopPropagation()} onClick={() => { setCommunityEditorError(""); setCommunityEditor(null); }}><ChevronLeft size={22} /></button><b>{communityEditor.id ? "管理 Community" : "新建 Community"}</b><button type="button" className={styles.saveTextBtn} onPointerDown={(e) => e.stopPropagation()} onClick={saveCommunityEditor}>保存</button></div>
          <div className={styles.modalScroll}>
            {communityEditorError ? <div className={styles.editorError}>{communityEditorError}</div> : null}
            <div className={styles.editorSection}><h3>Community</h3><label>名称<input value={communityEditor.name} onChange={(e) => setCommunityEditor({ ...communityEditor, name: e.target.value })} placeholder="例如 NCT WISH" /></label><label>简介<textarea value={communityEditor.description} onChange={(e) => setCommunityEditor({ ...communityEditor, description: e.target.value })} placeholder="这个 Community 的简介" /></label><div className={styles.imageEditRow}><Avatar text={communityEditor.name || "C"} imageUrl={communityEditor.coverUrl} tone="soft" className={styles.editorAvatar} /><button type="button" onClick={() => coverInputRef.current?.click()}><Camera size={16} /> Community 封面</button>{communityEditor.coverUrl ? <button type="button" onClick={() => setCommunityEditor({ ...communityEditor, coverUrl: "" })}>清除</button> : null}</div><input ref={coverInputRef} className={styles.hiddenInput} type="file" accept="image/*" onChange={async (e) => { const file = e.target.files?.[0]; if (file) setCommunityEditor({ ...communityEditor, coverUrl: await fileToDataUrl(file, 1200) }); e.currentTarget.value = ""; }} /></div>
            <div className={styles.editorSection}><h3>Official Account</h3><label>官号昵称<input value={communityEditor.officialName} onChange={(e) => setCommunityEditor({ ...communityEditor, officialName: e.target.value })} placeholder={communityEditor.name ? `${communityEditor.name} Official` : "Official Account"} /></label><label>官号简介<input value={communityEditor.officialBio} onChange={(e) => setCommunityEditor({ ...communityEditor, officialBio: e.target.value })} placeholder="公告 · Schedule · 官方 LIVE" /></label><div className={styles.imageEditRow}><Avatar text={communityEditor.officialName || communityEditor.name || "O"} imageUrl={communityEditor.officialAvatarUrl} tone="teal" className={styles.editorAvatar} /><button type="button" onClick={() => officialAvatarInputRef.current?.click()}><Camera size={16} /> 官号头像</button>{communityEditor.officialAvatarUrl ? <button type="button" onClick={() => setCommunityEditor({ ...communityEditor, officialAvatarUrl: "" })}>清除</button> : null}</div><input ref={officialAvatarInputRef} className={styles.hiddenInput} type="file" accept="image/*" onChange={async (e) => { const file = e.target.files?.[0]; if (file) setCommunityEditor({ ...communityEditor, officialAvatarUrl: await fileToDataUrl(file, 500) }); e.currentTarget.value = ""; }} /></div>
            <div className={styles.editorSection}><h3>绑定成员</h3><p className={styles.editorHint}>只勾选真正属于这个 Community 的角色。Solo 只选 1 人也可以。</p><div className={styles.memberPicker}>{characters.map((char) => { const checked = communityEditor.selectedCharacterIds.includes(char.id); return <button type="button" key={char.id} className={`${styles.memberPickCard} ${checked ? styles.memberPickActive : ""}`} onClick={() => setCommunityEditor({ ...communityEditor, selectedCharacterIds: checked ? communityEditor.selectedCharacterIds.filter((id) => id !== char.id) : [...communityEditor.selectedCharacterIds, char.id] })}><Avatar text={char.name} imageUrl={char.avatar} tone="soft" className={styles.memberPickAvatar} /><span className={styles.memberPickName}>{char.name}</span><i>{checked ? "✓" : "+"}</i></button>; })}</div>{!characters.length ? <div className={styles.emptyMini}>当前还没有角色，请先在「角色」App 建立角色。</div> : null}</div>
            {communityEditor.id ? <div className={styles.editorSection}><h3>官号操作</h3><button type="button" className={styles.manageAction} onClick={() => { const id = communityEditor.id!; setCommunityEditor(null); openComposer("official", id); }}>用官号发布动态</button><button type="button" className={styles.dangerButton} onClick={() => { const community = communityMap.get(communityEditor.id!); if (community) removeCommunity(community); }}><Trash2 size={16} /> 删除 Community</button></div> : null}
          </div>
        </div>
      ) : null}

      {memberEditor ? (
        <div className={styles.sheetMask} onMouseDown={(event) => { if (event.currentTarget === event.target) setMemberEditor(null); }}>
          <section className={styles.sheet}>
            <div className={styles.sheetHandle} /><div className={styles.sheetTitle}><h2>成员 WVS 资料</h2><button type="button" className={styles.iconBtn} onClick={() => setMemberEditor(null)}><X size={20} /></button></div>
            <div className={styles.memberEditProfile}><Avatar text={memberEditor.displayName} imageUrl={memberEditor.avatarUrl} className={styles.bigAvatar} /><button type="button" onClick={() => memberAvatarInputRef.current?.click()}><Camera size={16} /> 换头像</button></div>
            <input ref={memberAvatarInputRef} className={styles.hiddenInput} type="file" accept="image/*" onChange={async (e) => { const file = e.target.files?.[0]; if (file) setMemberEditor({ ...memberEditor, avatarUrl: await fileToDataUrl(file, 500) }); e.currentTarget.value = ""; }} />
            <label className={styles.fieldLabel}>WVS 显示昵称</label><input className={styles.select} value={memberEditor.displayName} onChange={(e) => setMemberEditor({ ...memberEditor, displayName: e.target.value })} />
            <label className={styles.fieldLabel}>简介</label><textarea className={styles.textareaSmall} value={memberEditor.bio} onChange={(e) => setMemberEditor({ ...memberEditor, bio: e.target.value })} placeholder="可选，只影响 WVS 展示" />
            <button type="button" className={styles.primaryButton} onClick={saveMemberEditor}>保存</button>
          </section>
        </div>
      ) : null}

      <div className={`${styles.drawerMask} ${drawerOpen ? styles.show : ""}`} onClick={() => setDrawerOpen(false)} />
      <aside className={`${styles.drawer} ${drawerOpen ? styles.show : ""}`}>
        <div className={styles.userCard}><Avatar text={userName} imageUrl={userAvatar} tone="soft" className={styles.userAvatar} /><div><h3>{userName}</h3><p>Fan account</p></div></div>
        <button type="button" className={styles.drawerItem} onClick={() => onNotice?.("WVS 用户资料后续可独立设置") }><UserRound size={20} /><span>我的资料</span></button>
        <button type="button" className={styles.drawerItem} onClick={() => { setDrawerOpen(false); goRoot("feed"); }}><MessageCircle size={20} /><span>我的帖子与评论</span></button>
        <button type="button" className={styles.drawerItem} onClick={() => onNotice?.("收藏页后续补") }><Bookmark size={20} /><span>收藏</span></button>
        <button type="button" className={styles.drawerItem} onClick={() => onNotice?.("WVS 设置后续补") }><Settings size={20} /><span>WVS 设置</span></button>
        <button type="button" className={styles.drawerItem} onClick={onClose}><ChevronLeft size={20} /><span>返回桌面</span></button>
      </aside>
    </div>
  );
}
