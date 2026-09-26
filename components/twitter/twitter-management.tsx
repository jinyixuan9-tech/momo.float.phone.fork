"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { ArrowLeft, ImagePlus, Plus } from "lucide-react";
import type { Character } from "@/lib/character-types";
import { getChatImageFromIndexedDB, saveChatImageToIndexedDB } from "@/lib/chat-asset-storage";
import { createTwitterId, type TwitterCommunity, type TwitterProfile, type TwitterState } from "@/lib/twitter-storage";
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
};
const defaultHandle = (text: string) => text.trim().replace(/[^a-zA-Z0-9_]/g, "_").replace(/_+/g, "_").slice(0, 22).toLowerCase() || "account";
const blankProfile = (name: string, handle: string): TwitterProfile => ({ name, handle: defaultHandle(handle), bio: "", visibility: "public", followers: 0, followingCount: 0, createdAt: Date.now() });
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

export function TwitterManagement({ state, characters, onChange, onClose, onUserAccount, onCommunity, onNotice }: Props) {
  const [tab, setTab] = useState<Tab>("accounts");
  const [editAccount, setEditAccount] = useState<string | null>(null);
  const [draft, setDraft] = useState<TwitterProfile>(blankProfile("", ""));
  const [editCommunity, setEditCommunity] = useState<string | null>(null);
  const [community, setCommunity] = useState<TwitterCommunity>({ id: "", name: "", fans: 0, characterIds: [], includeUserPersona: false, createdAt: 0 });
  const [world, setWorld] = useState(state.publicWorldContext);
  const [region, setRegion] = useState(state.regionName);
  const [privateRules, setPrivateRules] = useState(state.worldRules);
  const inputRef = useRef<HTMLInputElement>(null);
  const [imageTarget, setImageTarget] = useState<"avatarUrl" | "bannerUrl">("avatarUrl");
  const imported = characters.filter(c => state.importedCharacterIds.includes(c.id));
  const getProfile = (id: string) => id === "user" ? state.profile : state.characterProfiles[id] || state.accounts[id];
  const startProfile = (id: string) => {
    const char = characters.find(c => c.id === id.replace(/:alt$/, ""));
    const old = getProfile(id);
    const isAlt = id.endsWith(":alt");
    const fallback = isAlt ? "小号" : char?.name || (id.startsWith("group:") ? "团体号" : "我的账号");
    setDraft(old || { ...blankProfile(fallback, id === "user:alt" ? "my_alt" : char?.name || id), avatarUrl: isAlt ? "" : char?.avatar || "" });
    setEditAccount(id);
  };
  const saveProfile = () => {
    if (!editAccount) return;
    const next = { ...draft, name: draft.name.trim() || "未命名账号", handle: defaultHandle(draft.handle), followers: numberValue(String(draft.followers ?? 0)), followingCount: numberValue(String(draft.followingCount ?? 0)), createdAt: draft.createdAt || Date.now() };
    onChange(current => editAccount === "user" ? { ...current, profile: next } : characters.some(c => c.id === editAccount) ? { ...current, characterProfiles: { ...current.characterProfiles, [editAccount]: next } } : { ...current, accounts: { ...current.accounts, [editAccount]: next } });
    setEditAccount(null);
  };
  const startCommunity = (id?: string) => {
    const existing = state.communities.find(c => c.id === id);
    setCommunity(existing ? { ...existing, characterIds: [...existing.characterIds] } : { id: createTwitterId(), name: "", fans: 0, characterIds: [], includeUserPersona: false, createdAt: Date.now() });
    setEditCommunity(id || "new");
  };
  const saveCommunity = () => {
    if (!community.name.trim()) { onNotice("请先填写社区名称。"); return; }
    const next = { ...community, name: community.name.trim(), fans: numberValue(String(community.fans)) };
    onChange(current => ({ ...current, communities: current.communities.some(c => c.id === next.id) ? current.communities.map(c => c.id === next.id ? next : c) : [...current.communities, next] }));
    setEditCommunity(null);
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
  const groups = Object.keys(state.accounts).filter(id => id.startsWith("group:"));
  return <div className={`${styles.page} ${styles.managementPage}`}>
    <div className={styles.pageHeader}><button onClick={() => { if (editAccount) setEditAccount(null); else if (editCommunity) setEditCommunity(null); else onClose(); }} aria-label="返回"><ArrowLeft size={21} /></button><b>{editAccount ? "编辑账号" : editCommunity ? "社区资料" : "推特设置"}</b>{(editAccount || editCommunity) && <button className={styles.publish} onClick={editAccount ? saveProfile : saveCommunity}>保存</button>}</div>
    <input ref={inputRef} hidden type="file" accept="image/*" onChange={event => { void upload(event); }} />
    {editAccount ? <div className={styles.manageScroll}>
      <div className={styles.manageCover}><ManagedImage imageRef={draft.bannerUrl} />{imageButton("bannerUrl")}</div>
      <div className={styles.manageAvatar}><ManagedImage imageRef={draft.avatarUrl} />{imageButton("avatarUrl")}</div>
      <label>昵称<input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></label>
      <label>账号名 @<input value={draft.handle} onChange={e => setDraft({ ...draft, handle: e.target.value })} /></label>
      <label>简介<textarea value={draft.bio} onChange={e => setDraft({ ...draft, bio: e.target.value })} /></label>
      {editAccount.endsWith(":alt") && <label>对外身份与活动方式<textarea value={draft.identity || ""} onChange={e => setDraft({ ...draft, identity: e.target.value })} placeholder="例：不露脸的游戏博主，直播时说话很慢；别人不知道与大号的关系。" /></label>}
      <label>账号可见范围<select value={draft.visibility || "public"} onChange={e => setDraft({ ...draft, visibility: e.target.value === "protected" ? "protected" : "public" })}><option value="public">公开</option><option value="protected">私密</option></select></label>
      <div className={styles.manageCounts}><label>粉丝数<input type="number" min="0" value={draft.followers ?? 0} onChange={e => setDraft({ ...draft, followers: numberValue(e.target.value) })} /></label><label>关注数<input type="number" min="0" value={draft.followingCount ?? 0} onChange={e => setDraft({ ...draft, followingCount: numberValue(e.target.value) })} /></label></div>
      {editAccount.startsWith("group:") && <><h3>团体号关联角色</h3>{imported.map(char => <label key={char.id} className={styles.manageCheck}><input type="checkbox" checked={draft.characterIds?.includes(char.id) || false} onChange={e => setDraft({ ...draft, characterIds: e.target.checked ? [...(draft.characterIds || []), char.id] : (draft.characterIds || []).filter(id => id !== char.id) })} />{char.name}</label>)}<label className={styles.manageCheck}><input type="checkbox" checked={!!draft.includeUserPersona} onChange={e => setDraft({ ...draft, includeUserPersona: e.target.checked })} />关联我的人设</label></>}
      <p>大小号的粉丝数各自保存；小号与大号的真实归属只在角色内部使用。</p>
    </div> : editCommunity ? <div className={styles.manageScroll}>
      <div className={styles.manageCover}><ManagedImage imageRef={community.bannerUrl} />{imageButton("bannerUrl")}</div>
      <div className={styles.manageAvatar}><ManagedImage imageRef={community.avatarUrl} />{imageButton("avatarUrl")}</div>
      <label>社区名称<input value={community.name} onChange={e => setCommunity({ ...community, name: e.target.value })} placeholder="输入社区名称" /></label>
      <label>粉丝数<input type="number" min="0" value={community.fans} onChange={e => setCommunity({ ...community, fans: numberValue(e.target.value) })} /></label>
      <h3>关联角色（可多选）</h3>{imported.map(char => <label key={char.id} className={styles.manageCheck}><input type="checkbox" checked={community.characterIds.includes(char.id)} onChange={e => setCommunity({ ...community, characterIds: e.target.checked ? [...community.characterIds, char.id] : community.characterIds.filter(id => id !== char.id) })} />{char.name}</label>)}
      <label>关联团体号<select value={community.groupAccountId || ""} onChange={e => setCommunity({ ...community, groupAccountId: e.target.value || undefined })}><option value="">不关联</option>{groups.map(id => <option key={id} value={id}>{state.accounts[id].name}</option>)}</select></label>
      <label className={styles.manageCheck}><input type="checkbox" checked={community.includeUserPersona} onChange={e => setCommunity({ ...community, includeUserPersona: e.target.checked })} />关联我的人设</label>
      <p>创建社区不会自动将你显示为主持人，也不会公开关联角色的小号。</p>
    </div> : <><div className={styles.manageTabs}>{([['accounts','账号'],['characters','引入角色'],['communities','社区'],['world','世界']] as const).map(([key,label]) => <button key={key} className={tab === key ? styles.selected : ""} onClick={() => setTab(key)}>{label}</button>)}</div><div className={styles.manageScroll}>
      {tab === "accounts" && <>
        <h3>我的账号</h3>{(["user", ...(state.accounts["user:alt"] ? ["user:alt"] : [])]).map(id => <div key={id} className={styles.manageRow}><span>{getProfile(id)?.name || "我的账号"}<small>@{getProfile(id)?.handle || "my_twitter"} · {id.endsWith(":alt") ? "小号" : "大号"}</small></span><button onClick={() => onUserAccount(id)}>使用</button><button onClick={() => startProfile(id)}>设置</button></div>)}
        {!state.accounts["user:alt"] && <button className={styles.manageCreate} onClick={() => startProfile("user:alt")}><Plus size={18} />创建我的小号</button>}
        <h3>角色账号</h3>{imported.map(char => <div key={char.id}><div className={styles.manageRow}><span>{getProfile(char.id)?.name || char.name}<small>大号 · 跟随角色人设</small></span><button onClick={() => startProfile(char.id)}>设置</button></div><div className={styles.manageRow}><span>{getProfile(`${char.id}:alt`)?.name || "未创建小号"}<small>小号 · 独立对外身份</small></span><button onClick={() => startProfile(`${char.id}:alt`)}>{state.accounts[`${char.id}:alt`] ? "设置" : "创建"}</button></div></div>)}
        <h3>团体号</h3>{groups.map(id => <div key={id} className={styles.manageRow}><span>{state.accounts[id].name}<small>@{state.accounts[id].handle}</small></span><button onClick={() => onUserAccount(id)}>使用</button><button onClick={() => startProfile(id)}>设置</button></div>)}<button className={styles.manageCreate} onClick={() => { const id = `group:${createTwitterId()}`; setDraft(blankProfile("团体号", "group")); setEditAccount(id); }}><Plus size={18} />创建团体号</button>
      </>}
      {tab === "characters" && <><h3>从小手机已有角色引入</h3><p>引入后可以设置大小号并让角色发帖。这里不创建陌生人的关注关系。</p>{characters.map(char => <div key={char.id} className={styles.manageRow}><span>{char.name}</span><button onClick={() => onChange(current => ({ ...current, importedCharacterIds: current.importedCharacterIds.includes(char.id) ? current.importedCharacterIds.filter(id => id !== char.id) : [...current.importedCharacterIds, char.id] }))}>{state.importedCharacterIds.includes(char.id) ? "已引入 · 移除" : "引入"}</button></div>)}</>}
      {tab === "communities" && <><h3>我的社区</h3>{state.communities.map(item => <div key={item.id} className={styles.manageRow}><span>{item.name}<small>{item.fans.toLocaleString()} 位粉丝 · {item.characterIds.length} 位关联角色</small></span><button onClick={() => onCommunity(item.id)}>进入</button><button onClick={() => startCommunity(item.id)}>设置</button></div>)}<button className={styles.manageCreate} onClick={() => startCommunity()}><Plus size={18} />添加社区</button></>}
      {tab === "world" && <><h3>世界与趋势</h3><label>公开世界背景<textarea value={world} onChange={e => setWorld(e.target.value)} placeholder="例：架空的赛博朋克城市，人们常谈论街区、演出和日常生活。不要填私密关系。" /></label><label>虚构地区名称<input value={region} onChange={e => setRegion(e.target.value)} placeholder="例：霓湾区" /></label><label>角色补充规则（不用于路人和趋势）<textarea value={privateRules} onChange={e => setPrivateRules(e.target.value)} placeholder="可以填写角色在推特发言时要遵守的私密边界。" /></label><button className={styles.manageCreate} onClick={() => { onChange(current => ({ ...current, publicWorldContext: world.trim(), regionName: region.trim(), worldRules: privateRules.trim() })); onNotice("世界与地区设置已保存。"); }}>保存设置</button><p>刷新趋势只使用公开背景，不读取角色的私密规则或小号身份。</p></>}
    </div></>}
  </div>;
}
