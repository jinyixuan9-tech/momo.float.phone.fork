"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { ArrowLeft, ImagePlus, Plus } from "lucide-react";
import type { Character } from "@/lib/character-types";
import { getChatImageFromIndexedDB, saveChatImageToIndexedDB } from "@/lib/chat-asset-storage";
import { createTwitterId, type TwitterCommunity, type TwitterCommunityCharacter, type TwitterProfile, type TwitterState } from "@/lib/twitter-storage";
import styles from "./twitter-app.module.css";

type Tab = "accounts" | "characters" | "communities" | "world";
type Props = {
  state: TwitterState;
  characters: Character[];
  onChange: (change: (current: TwitterState) => TwitterState) => void;
  onClose: () => void;
  onUserAccount: (id: string) => void;
  onCommunity: (id: string) => void;
  onNotice: (text: string) => void;
  initialTab?: Tab;
  initialAccountId?: string;
  createCommunity?: boolean;
  closeOnSave?: boolean;
  onlyCharacters?: boolean;
};
const defaultHandle = (text: string) => text.trim().replace(/[^a-zA-Z0-9_]/g, "_").replace(/_+/g, "_").slice(0, 22).toLowerCase() || "account";
const blankProfile = (name: string, handle: string): TwitterProfile => ({ name, handle: defaultHandle(handle), bio: "", visibility: "public", followers: 0, followingCount: 0 });
const numberValue = (value: string) => Math.max(0, Math.min(1_000_000_000, Number(value) || 0));

function ManagedImage({ imageRef }: { imageRef?: string }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!imageRef) { setUrl(""); return; }
    if (/^(https?:|data:)/.test(imageRef)) { setUrl(imageRef); return; }
    let mounted = true;
    void getChatImageFromIndexedDB(imageRef).then(image => { if (mounted) setUrl(image || ""); });
    return () => { mounted = false; };
  }, [imageRef]);
  return url ? <img src={url} alt="" /> : null;
}

export function TwitterManagement({ state, characters, onChange, onClose, onUserAccount, onCommunity, onNotice, initialTab = "accounts", initialAccountId, createCommunity, closeOnSave, onlyCharacters }: Props) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [editAccount, setEditAccount] = useState<string | null>(null);
  const [draft, setDraft] = useState<TwitterProfile>(blankProfile("", ""));
  const [editCommunity, setEditCommunity] = useState<string | null>(null);
  const [community, setCommunity] = useState<TwitterCommunity>({ id: "", name: "", fans: 0, characterIds: [], manualCharacters: [], includeUserPersona: false, createdAt: 0 });
  const [manualName, setManualName] = useState("");
  const [manualHandle, setManualHandle] = useState("");
  const [manualBio, setManualBio] = useState("");
  const [manualPersona, setManualPersona] = useState("");
  const [communityCharDrafts, setCommunityCharDrafts] = useState<Record<string, TwitterCommunityCharacter>>({});
  const [world, setWorld] = useState(state.publicWorldContext);
  const [region, setRegion] = useState(state.regionName);
  const [privateRules, setPrivateRules] = useState(state.worldRules);
  const inputRef = useRef<HTMLInputElement>(null);
  const [imageTarget, setImageTarget] = useState<"avatarUrl" | "bannerUrl">("avatarUrl");
  const imported = characters;
  const getProfile = (id: string) => id === "user" ? state.profile : state.characterProfiles[id] || state.accounts[id];
  const startProfile = (id: string) => {
    const char = characters.find(c => c.id === id.replace(/:alt$/, ""));
    const old = getProfile(id);
    const isAlt = id.endsWith(":alt");
    const fallback = isAlt ? "副账号" : char?.name || state.communityCharacters[id]?.name || "我的账号";
    setDraft(old || { ...blankProfile(fallback, id === "user:alt" ? "my_alt" : char?.name || id), avatarUrl: isAlt ? "" : char?.avatar || "" });
    setEditAccount(id);
  };
  const saveProfile = () => {
    if (!editAccount) return;
    const next = { ...draft, name: draft.name.trim() || "未命名账号", handle: defaultHandle(draft.handle), followers: numberValue(String(draft.followers ?? 0)), followingCount: numberValue(String(draft.followingCount ?? 0)) };
    onChange(current => editAccount === "user" ? { ...current, profile: next } : characters.some(c => c.id === editAccount) ? { ...current, characterProfiles: { ...current.characterProfiles, [editAccount]: next } } : { ...current, accounts: { ...current.accounts, [editAccount]: next } });
    setEditAccount(null);
    if (closeOnSave) onClose();
  };
  const startCommunity = (id?: string) => {
    const existing = state.communities.find(c => c.id === id);
    setCommunityCharDrafts({});
    setCommunity(existing ? { ...existing, characterIds: [...existing.characterIds], manualCharacters: [...(existing.manualCharacters || [])] } : { id: createTwitterId(), name: "", fans: 0, characterIds: [], manualCharacters: [], includeUserPersona: false, createdAt: Date.now() });
    setEditCommunity(id || "new");
  };
  useEffect(() => {
    if (initialAccountId) startProfile(initialAccountId);
    else if (createCommunity) startCommunity();
    // The destination is selected once when this page opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const saveCommunity = () => {
    if (!community.name.trim()) { onNotice("请先填写社区名称。"); return; }
    const next = { ...community, name: community.name.trim(), fans: numberValue(String(community.fans)) };
    onChange(current => ({ ...current, communityCharacters: { ...current.communityCharacters, ...Object.fromEntries(Object.entries(communityCharDrafts).filter(([id]) => next.communityCharacterIds?.includes(id))) }, communities: current.communities.some(c => c.id === next.id) ? current.communities.map(c => c.id === next.id ? next : c) : [...current.communities, next] }));
    setEditCommunity(null);
    if (closeOnSave) onClose();
  };
  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) { onNotice("请选择图片。"); return; }
    try {
      const ref = await saveChatImageToIndexedDB(file);
      if (editAccount) setDraft(current => ({ ...current, [imageTarget]: ref }));
      else if (editCommunity) setCommunity(current => ({ ...current, [imageTarget]: ref }));
    } catch { onNotice("图片保存失败，请重试。"); }
  };
  const imageButton = (field: "avatarUrl" | "bannerUrl") => <button type="button" className={styles.imagePick} onClick={() => { setImageTarget(field); inputRef.current?.click(); }}><ImagePlus size={17} />{field === "avatarUrl" ? "更换头像" : "更换封面"}</button>;
  return <>{editCommunity && <div className={styles.communitySheetScrim} onClick={() => { setEditCommunity(null); if (createCommunity) onClose(); }} />}<div className={`${styles.page} ${styles.managementPage} ${editCommunity ? styles.communitySheetPage : ""}`}>
    <div className={styles.pageHeader}><button onClick={() => { if (editAccount) { if (initialAccountId) onClose(); else setEditAccount(null); } else if (editCommunity) { if (createCommunity) onClose(); else setEditCommunity(null); } else onClose(); }} aria-label="返回"><ArrowLeft size={21} /></button><b>{editAccount ? "编辑主页" : editCommunity ? "添加社群" : onlyCharacters ? "角色资料" : initialTab === "world" ? "世界观" : initialTab === "communities" ? "社群" : "账号"}</b>{(editAccount || editCommunity) && <button className={styles.publish} onClick={editAccount ? saveProfile : saveCommunity}>保存</button>}{!editAccount && !editCommunity && tab === "communities" && <button onClick={() => startCommunity()} aria-label="添加社群"><Plus size={22} /></button>}</div>
    <input ref={inputRef} hidden type="file" accept="image/*" onChange={event => { void upload(event); }} />
    {editAccount ? <div className={styles.manageScroll}>
      <div className={styles.manageCover}><ManagedImage imageRef={draft.bannerUrl} /></div>
      <div className={styles.manageAvatar}><span className={styles.manageAvatarPreview}>{draft.avatarUrl ? <ManagedImage imageRef={draft.avatarUrl} /> : draft.name.slice(0, 1) || "我"}</span><div className={styles.manageImageActions}>{imageButton("avatarUrl")}{imageButton("bannerUrl")}</div></div>
      <label>昵称<input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></label>
      <label>账号名 @<input value={draft.handle} onChange={e => setDraft({ ...draft, handle: e.target.value })} /></label>
      <label>简介<textarea value={draft.bio} onChange={e => setDraft({ ...draft, bio: e.target.value })} /></label>
      <label>生日（可选）<input type="date" value={draft.birthday || ""} onChange={e => setDraft({ ...draft, birthday: e.target.value || undefined })} /></label>
      <label>加入时间（可选）<input type="month" value={draft.createdAt ? new Date(draft.createdAt).toISOString().slice(0, 7) : ""} onChange={e => setDraft({ ...draft, createdAt: e.target.value ? new Date(`${e.target.value}-01T00:00:00`).getTime() : undefined })} /></label>
      <label>认证标识<select value={draft.verification || "none"} onChange={e => setDraft({ ...draft, verification: e.target.value as TwitterProfile["verification"] })}><option value="none">无</option><option value="blue">蓝标 · 已认证账号</option><option value="gold">金标 · 组织账号</option><option value="grey">灰标 · 官方或多边组织</option></select></label>
      {editAccount.endsWith(":alt") && <><label>对外身份与活动方式<textarea value={draft.identity || ""} onChange={e => setDraft({ ...draft, identity: e.target.value })} placeholder="例：不露脸的游戏博主，直播风格、日常行为等" /></label><label>与主账号关联<select value={draft.disclosure || "independent"} onChange={e => setDraft({ ...draft, disclosure: e.target.value as TwitterProfile["disclosure"] })}><option value="independent">独立身份 · 默认不披露</option><option value="full">完全披露</option><option value="clues">有线索披露</option></select></label>{draft.disclosure === "clues" && <label>可被发现的线索<textarea value={draft.disclosureClues || ""} onChange={e => setDraft({ ...draft, disclosureClues: e.target.value })} placeholder="只有网友从公开内容看到的线索" /></label>}</>}
      <label>账号可见范围<select value={draft.visibility || "public"} onChange={e => setDraft({ ...draft, visibility: e.target.value === "protected" ? "protected" : "public" })}><option value="public">公开</option><option value="protected">私密</option></select></label>
      <div className={styles.manageCounts}><label>粉丝数<input type="number" min="0" value={draft.followers ?? 0} onChange={e => setDraft({ ...draft, followers: numberValue(e.target.value) })} /></label><label>关注数<input type="number" min="0" value={draft.followingCount ?? 0} onChange={e => setDraft({ ...draft, followingCount: numberValue(e.target.value) })} /></label></div>
      <p>主账号与副账号的粉丝数、身份、互动分别保存。</p>
    </div> : editCommunity ? <div className={styles.manageScroll}>
      <div className={styles.manageCover}><ManagedImage imageRef={community.bannerUrl} /></div>
      <div className={styles.manageAvatar}><span className={styles.manageAvatarPreview}>{community.avatarUrl ? <ManagedImage imageRef={community.avatarUrl} /> : community.name.slice(0, 1) || "社"}</span><div className={styles.manageImageActions}>{imageButton("avatarUrl")}{imageButton("bannerUrl")}</div></div>
      <label>社区名称<input value={community.name} onChange={e => setCommunity({ ...community, name: e.target.value })} placeholder="输入社区名称" /></label>
      <label>粉丝数<input type="number" min="0" value={community.fans} onChange={e => setCommunity({ ...community, fans: numberValue(e.target.value) })} /></label>
      <label>社群内容 · 主要讨论什么<textarea value={community.description || ""} onChange={e => setCommunity({ ...community, description: e.target.value })} placeholder="例如：某个组合的日常、成员互动、粉丝分享……" /></label>
      <h3>关联角色（可多选）</h3>{imported.map(char => <label key={char.id} className={styles.manageCheck}><input type="checkbox" checked={community.characterIds.includes(char.id)} onChange={e => setCommunity({ ...community, characterIds: e.target.checked ? [...community.characterIds, char.id] : community.characterIds.filter(id => id !== char.id) })} />{char.name}</label>)}
      <h3>手动添加社群角色</h3><div className={styles.manualCharacterInput}><input value={manualName} onChange={e => setManualName(e.target.value)} placeholder="角色名称" /><input value={manualHandle} onChange={e => setManualHandle(e.target.value)} placeholder="账号 @" /><input value={manualBio} onChange={e => setManualBio(e.target.value)} placeholder="简介" /><textarea value={manualPersona} onChange={e => setManualPersona(e.target.value)} placeholder="人设与发言习惯" /><button type="button" onClick={() => { const name = manualName.trim(); if (!name || !manualHandle.trim() || !manualPersona.trim()) { onNotice("请填写角色名称、账号和人设。"); return; } const id = `community:${createTwitterId()}`; setCommunityCharDrafts(current => ({ ...current, [id]: { id, name, handle: defaultHandle(manualHandle), bio: manualBio.trim(), persona: manualPersona.trim(), communityId: community.id } })); setCommunity(current => ({ ...current, communityCharacterIds: [...(current.communityCharacterIds || []), id] })); setManualName(""); setManualHandle(""); setManualBio(""); setManualPersona(""); }}>添加角色</button></div>
      {(community.communityCharacterIds || []).map(id => <div key={id} className={styles.manualCharacterRow}><span>{(communityCharDrafts[id] || state.communityCharacters[id])?.name || "社群角色"} · @{(communityCharDrafts[id] || state.communityCharacters[id])?.handle || "community"}</span><button type="button" onClick={() => setCommunity(current => ({ ...current, communityCharacterIds: (current.communityCharacterIds || []).filter(item => item !== id) }))}>移除</button></div>)}
      <label className={styles.manageCheck}><input type="checkbox" checked={community.includeUserPersona} onChange={e => setCommunity({ ...community, includeUserPersona: e.target.checked })} />关联我的人设</label>
      <p>创建社区不会自动将你显示为主持人，也不会公开关联角色的小号。</p>
    </div> : <><div className={styles.manageScroll}>
      {tab === "accounts" && <>
        {!onlyCharacters && <><h3>我的账号</h3>{(["user", ...(state.accounts["user:alt"] ? ["user:alt"] : [])]).map(id => <div key={id} className={styles.manageRow}><span>{getProfile(id)?.name || "我的账号"}<small>@{getProfile(id)?.handle || "my_twitter"} · {id.endsWith(":alt") ? "副账号" : "主账号"}</small></span><button onClick={() => onUserAccount(id)}>使用</button><button onClick={() => startProfile(id)}>设置</button></div>)}
        {!state.accounts["user:alt"] && <button className={styles.manageCreate} onClick={() => startProfile("user:alt")}><Plus size={18} />创建我的副账号</button>}</>}
        <h3>角色资料</h3>{imported.map(char => <div key={char.id} className={styles.accountGroup}><div className={styles.manageRow}><span>{getProfile(char.id)?.name || char.name}<small>主账号 · 跟随人设</small></span><button onClick={() => startProfile(char.id)}>设置</button></div><div className={styles.manageRow}><span>{getProfile(`${char.id}:alt`)?.name || "未创建副账号"}<small>副账号 · 独立身份</small></span><button onClick={() => startProfile(`${char.id}:alt`)}>{state.accounts[`${char.id}:alt`] ? "设置" : "创建"}</button></div></div>)}
      </>}
      {tab === "characters" && <><h3>已有角色</h3>{characters.map(char => <div key={char.id} className={styles.accountGroup}><div className={styles.manageRow}><span>{char.name}<small>主账号</small></span><button onClick={() => startProfile(char.id)}>编辑</button></div><div className={styles.manageRow}><span>{state.accounts[`${char.id}:alt`]?.name || "未创建副账号"}<small>副账号</small></span><button onClick={() => startProfile(`${char.id}:alt`)}>设置</button></div></div>)}{Object.values(state.communityCharacters).map(char => <div key={char.id} className={styles.manageRow}><span>{char.name}<small>社群角色 · @{char.handle}</small></span><button onClick={() => startProfile(char.id)}>编辑主页</button></div>)}</>}
      {tab === "communities" && <><h3>关注的社群</h3>{state.communities.length ? state.communities.map(item => <div key={item.id} className={styles.manageRow}><span>{item.name}<small>{item.description || `${item.fans.toLocaleString()} 位粉丝`}</small></span><button onClick={() => onCommunity(item.id)}>进入</button><button onClick={() => startCommunity(item.id)}>编辑</button></div>) : <p className={styles.communityEmpty}>暂无关注</p>}</>}
      {tab === "world" && <><h3>世界与趋势</h3><label>公开世界背景<textarea value={world} onChange={e => setWorld(e.target.value)} placeholder="例：架空的赛博朋克城市，人们常谈论街区、演出和日常生活。不要填私密关系。" /></label><label>虚构地区名称<input value={region} onChange={e => setRegion(e.target.value)} placeholder="例：霓湾区" /></label><label>角色补充规则（不用于路人和趋势）<textarea value={privateRules} onChange={e => setPrivateRules(e.target.value)} placeholder="可以填写角色在推特发言时要遵守的私密边界。" /></label><button className={styles.manageCreate} onClick={() => { onChange(current => ({ ...current, publicWorldContext: world.trim(), regionName: region.trim(), worldRules: privateRules.trim() })); onNotice("世界与地区设置已保存。"); }}>保存设置</button><p>刷新趋势只使用公开背景，不读取角色的私密规则或小号身份。</p></>}
    </div></>}
  </div></>;
}
