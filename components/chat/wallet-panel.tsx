"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, ChevronLeft, CreditCard, Plus, RefreshCw, Settings2 } from "lucide-react";
import { refreshWalletLiving, suggestWalletBase } from "@/lib/wallet-life-generation";
import { WALLET_CURRENCIES, WALLET_UPDATED_EVENT, formatCurrencyAmount, getWalletAssetEstimate, getWalletCurrencyBalance, getWalletVisibleCurrencies, loadWalletState, recordWalletManual, repayWalletCredit, saveWalletState, setWalletCurrencyBalance } from "@/lib/wallet-storage";
import type { WalletCurrency, WalletState, WalletTransaction } from "@/lib/wallet-types";

type Props = { onBack: () => void; ownerId?: string; ownerName?: string; readOnly?: boolean; onRefresh?: () => Promise<void> | void; refreshLoading?: boolean };
const names: Record<WalletCurrency, string> = { CNY: "人民币", KRW: "韩元", JPY: "日元", USD: "美元", EUR: "欧元", HKD: "港币", TWD: "新台币", AUD: "澳元" };
const symbols: Record<WalletCurrency, string> = { CNY: "¥", KRW: "₩", JPY: "¥", USD: "$", EUR: "€", HKD: "HK$", TWD: "NT$", AUD: "A$" };
const banks: Record<WalletCurrency, string> = { CNY: "中国银行", KRW: "新韩银行", JPY: "三菱UFJ银行", USD: "Chase", EUR: "BNP Paribas", HKD: "汇丰银行", TWD: "中国信托", AUD: "Commonwealth Bank" };
const circle: React.CSSProperties = { height: 38, width: 38, borderRadius: 20, border: "1px solid #ededed", background: "white", display: "grid", placeItems: "center" };
const button: React.CSSProperties = { background: "#111", color: "#fff", border: 0, borderRadius: 14, padding: "12px 16px", fontWeight: 700 };
const field: React.CSSProperties = { display: "grid", gap: 6, marginBottom: 15, fontSize: 13, color: "#555" };
const inputClass = "ui-input";
const newCreditNumber = () => `**** **** **** ${String(Math.floor(Math.random() * 10000)).padStart(4, "0")}`;

export function WalletPanel({ onBack, ownerId, ownerName, readOnly = false, onRefresh, refreshLoading = false }: Props) {
  const [wallet, setWallet] = useState<WalletState>(() => loadWalletState(ownerId));
  const cardStripRef = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = useState<"all" | "income" | "expense">("all");
  const [showAll, setShowAll] = useState(false);
  const [activeCard, setActiveCard] = useState<"debit" | "credit">("debit");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [entryOpen, setEntryOpen] = useState(false);
  const [selected, setSelected] = useState<WalletTransaction | null>(null);
  const [direction, setDirection] = useState<"in" | "out">("in");
  const [creditAction, setCreditAction] = useState<"repay" | "spend">("repay");
  const [entryTitle, setEntryTitle] = useState("");
  const [entryAmount, setEntryAmount] = useState("");
  const [entryCurrency, setEntryCurrency] = useState<WalletCurrency>("CNY");
  const [editCurrency, setEditCurrency] = useState<WalletCurrency | null>(null);
  const [editAmount, setEditAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [suggestion, setSuggestion] = useState<{currency: WalletCurrency; amount: number; explanation: string} | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    setWallet(loadWalletState(ownerId)); setActiveCard("debit");
    const sync = () => setWallet(loadWalletState(ownerId));
    window.addEventListener(WALLET_UPDATED_EVENT, sync);
    return () => window.removeEventListener(WALLET_UPDATED_EVENT, sync);
  }, [ownerId]);
  const visible = getWalletVisibleCurrencies(wallet);
  const all = useMemo(() => wallet.transactions.filter(tx => filter === "all" || (filter === "income" ? (tx.credit ? tx.amount < 0 : tx.amount >= 0) : (tx.credit ? tx.amount > 0 : tx.amount < 0))), [wallet.transactions, filter]);
  const recent = all.slice(0, showAll ? undefined : 10);
  function update(partial: Partial<WalletState>) { setWallet(saveWalletState({ ...wallet, ...partial }, ownerId)); }
  async function suggestBase() { setBusy(true); setError(""); try { setSuggestion(await suggestWalletBase(ownerId)); } catch (cause) { setError(cause instanceof Error ? cause.message : "建议失败"); } finally { setBusy(false); } }
  function acceptBase() { if (!suggestion) return; const result = setWalletCurrencyBalance(suggestion.currency, suggestion.amount, ownerId); if (!result.ok) { setError(result.error || "设置失败"); return; } setWallet(result.state); setSuggestion(null); setError(""); }
  function toggleCommon(currency: WalletCurrency) { update({ commonCurrencies: wallet.commonCurrencies?.includes(currency) ? wallet.commonCurrencies.filter(item => item !== currency) : [...(wallet.commonCurrencies || []), currency] }); }
  async function refresh() {
    if (busy || refreshLoading) return;
    setBusy(true); setError("");
    try {
      if (onRefresh) await onRefresh(); else { const result = await refreshWalletLiving(ownerId); if (result.skipped) setError(`${result.skipped} 条超过可用余额，未记入流水。`); }
      setWallet(loadWalletState(ownerId)); setShowAll(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "刷新失败，请重试。"); }
    finally { setBusy(false); }
  }
  function saveEntry() {
    const amount = Number(entryAmount);
    const result = recordWalletManual({ ownerId, direction, currency: entryCurrency, amount, title: entryTitle.trim() || (direction === "in" ? "手动入账" : "手动支出"), detail: entryTitle.trim(), category: "手动记账" });
    if (!result.ok) { setError(result.error || "记账失败"); return; }
    setWallet(result.state); setEntryOpen(false); setEntryAmount(""); setEntryTitle(""); setError("");
  }
  function saveBase() {
    if (!editCurrency) return;
    const result = setWalletCurrencyBalance(editCurrency, Number(editAmount), ownerId);
    if (!result.ok) { setError(result.error || "调整失败"); return; }
    setWallet(result.state); setEditCurrency(null); setError("");
  }
  function creditSubmit() {
    if (creditAction === "spend") {
      const result = recordWalletManual({ ownerId, direction: "out", currency: entryCurrency, amount: Number(entryAmount), title: entryTitle.trim() || "信用卡消费", detail: entryTitle.trim(), category: "信用卡消费", credit: true });
      if (!result.ok) { setError(result.error || "记账失败"); return; }
      setWallet(result.state); setEntryAmount(""); setEntryTitle(""); setEntryOpen(false); setError(""); return;
    }
    repay();
  }
  function repay() {
    const result = repayWalletCredit(ownerId, entryCurrency, Number(entryAmount));
    if (!result.ok) { setError(result.error || "还款失败"); return; }
    setWallet(result.state); setEntryAmount(""); setEntryOpen(false); setError("");
  }
  const isCredit = activeCard === "credit" && wallet.creditEnabled;
  const card = wallet.cards[0];
  return <div style={{ background: "#fbfaf9", color: "#151515", height: "100%", position: "relative", display: "flex", flexDirection: "column", fontFamily: "system-ui, sans-serif" }}>
    <header style={{ flexShrink: 0, zIndex: 10, display: "flex", justifyContent: "space-between", alignItems: "center", padding: "calc(env(safe-area-inset-top, 0px) + 34px) 22px 10px", background: "#fbfaf9" }}>
      <button type="button" onClick={onBack} aria-label="返回" style={circle}><ChevronLeft size={19}/></button>
      <div style={{ display: "flex", gap: 9 }}>
        {onRefresh && <button type="button" onClick={refresh} disabled={busy || refreshLoading} aria-label="刷新角色流水" style={circle}><RefreshCw size={18} className={busy || refreshLoading ? "cp-spin" : ""}/></button>}
        <button type="button" onClick={() => setSettingsOpen(true)} aria-label="钱包设置" style={circle}><Settings2 size={18}/></button>
      </div>
    </header>
    <main style={{ overflowY: "auto", flex: 1, padding: "14px 22px calc(env(safe-area-inset-bottom, 0px) + 34px)" }}>
      <div style={{ margin: "18px 0 28px" }}><span style={{ color: "#999", letterSpacing: 3, fontSize: 11, fontWeight: 700 }}>PAY · WALLET</span><h1 style={{ fontSize: 28, margin: "8px 0 5px" }}>{ownerName || "我的"}资产</h1><div style={{ color: "#777", fontSize: 12 }}>总资产 · {wallet.displayCurrency} · 参考汇率</div><strong style={{ display: "block", fontSize: 42, letterSpacing: -2, lineHeight: 1.25, marginTop: 4 }}>{formatCurrencyAmount(getWalletAssetEstimate(wallet), wallet.displayCurrency)}</strong></div>
      <section><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 13 }}><h2 style={{ fontSize: 21, margin: 0 }}>我的卡片</h2>{!wallet.creditEnabled && !readOnly && <button onClick={() => { update({ creditEnabled: true, creditMaskedNumber: wallet.creditMaskedNumber || newCreditNumber() }); setActiveCard("credit"); requestAnimationFrame(() => cardStripRef.current?.scrollTo({ left: cardStripRef.current.scrollWidth, behavior: "smooth" })); }} type="button" aria-label="开通信用卡" style={{ ...circle, height: 32, width: 32 }}><Plus size={18}/></button>}</div>
        <div ref={cardStripRef} style={{ display: "flex", overflowX: wallet.creditEnabled ? "auto" : "hidden", scrollSnapType: "x mandatory", gap: 12, marginRight: -22, paddingRight: 22 }} onScroll={event => { if (wallet.creditEnabled) setActiveCard(event.currentTarget.scrollLeft > event.currentTarget.clientWidth / 2 ? "credit" : "debit"); }}>
          {(["debit", ...(wallet.creditEnabled ? ["credit"] : [])] as ("debit" | "credit")[]).map(kind => <div key={kind} style={{ flex: "0 0 100%", boxSizing: "border-box", scrollSnapAlign: "start", minHeight: 226, borderRadius: 28, background: kind === "credit" ? "linear-gradient(135deg,#3d434f,#15171d)" : "linear-gradient(135deg,#20232a,#111112)", color: "white", padding: 23, display: "flex", flexDirection: "column", boxShadow: "0 15px 30px #0002" }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#ccc" }}><span>{kind === "credit" ? "信用卡" : "储蓄卡"}</span><CreditCard size={20}/></div>
            <strong style={{ fontSize: 22, marginTop: 19 }}>{card?.bankLabel || banks[wallet.primaryCurrency]}</strong><span style={{ color: "#aaa", fontSize: 12, marginTop: 7 }}>{kind === "credit" ? "跨币种消费 · 按币种还款" : `默认结算 ${names[wallet.primaryCurrency]}`}</span><div style={{ flex: 1 }}/><span style={{ color: "#bbb", fontSize: 12, letterSpacing: 2 }}>{kind === "credit" ? wallet.creditMaskedNumber || "**** **** **** 0000" : card?.maskedNumber || "**** **** **** 0000"}</span>
          </div>)}
        </div>
        {wallet.creditEnabled && <div style={{ textAlign: "center", marginTop: 9, color: "#999", fontSize: 12 }}>● {isCredit ? "信用卡" : "储蓄卡"} · 左右滑动切卡</div>}
      </section>
      <section style={{ marginTop: 30 }}><div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}><h2 style={{ margin: 0, fontSize: 21 }}>{isCredit ? "各币种欠款" : "币种余额"}</h2>{isCredit && !readOnly && <div style={{ display: "flex", gap: 6 }}><button type="button" onClick={() => { setCreditAction("spend"); setEntryCurrency(wallet.primaryCurrency); setEntryOpen(true); setError(""); }} style={{ ...button, padding: "8px 10px", fontSize: 12, background: "#eee", color: "#222" }}>记支出</button><button type="button" onClick={() => { setCreditAction("repay"); setEntryCurrency(wallet.primaryCurrency); setEntryOpen(true); setError(""); }} style={{ ...button, padding: "8px 14px", fontSize: 12 }}>还款</button></div>}</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 10, marginTop: 14 }}>
          {visible.map(currency => <button type="button" key={currency} onClick={() => { if (!readOnly && !isCredit) { setEditCurrency(currency); setEditAmount(String(getWalletCurrencyBalance(wallet,currency))); setError(""); } }} style={{ background: "#fff", border: "1px solid #eee", borderRadius: 16, padding: 15, textAlign: "left", minWidth: 0, color: "#111" }}><span style={{ color: "#888", fontSize: 11 }}>{names[currency]} · {currency}</span><strong style={{ display: "block", fontSize: 17, marginTop: 6, overflow: "hidden", textOverflow: "ellipsis" }}>{formatCurrencyAmount(isCredit ? wallet.creditDebts?.[currency] || 0 : getWalletCurrencyBalance(wallet,currency),currency)}</strong></button>)}
        </div>
        {!readOnly && !isCredit && <div style={{ display: "flex", gap: 10, marginTop: 14 }}>{(["in","out"] as const).map(value => <button key={value} type="button" onClick={() => { setDirection(value); setEntryCurrency(wallet.primaryCurrency); setEntryOpen(true); setError(""); }} style={{ ...button, flex: 1, background: "white", color: "#111", border: "1px solid #eee" }}>银行卡{value === "in" ? "入账" : "支出"}</button>)}</div>}
      </section>
      <section style={{ marginTop: 34 }}><div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}><h2 style={{ margin: 0, fontSize: 23 }}>最近账单</h2>{!ownerId && <button type="button" disabled={busy} aria-label="刷新我的生活流水" onClick={refresh} style={{ ...circle, height: 34, width: 34 }}><RefreshCw size={17} className={busy ? "cp-spin" : ""}/></button>}</div>
        <div style={{ display: "flex", gap: 4, background: "#fff", border: "1px solid #eee", borderRadius: 25, padding: 4, width: "fit-content", margin: "17px 0" }}>{(["all","expense","income"] as const).map((value,i) => <button type="button" key={value} onClick={() => { setFilter(value); setShowAll(false); }} style={{ background: filter === value ? "#111" : "transparent", color: filter === value ? "white" : "#555", border: 0, borderRadius: 20, padding: "8px 16px", fontWeight: 700 }}>{["全部","支出","收入"][i]}</button>)}</div>
        <div style={{ background: "#fff", border: "1px solid #eee", borderRadius: 22, overflow: "hidden" }}>{recent.length ? recent.map(tx => { const income = tx.credit ? tx.amount < 0 : tx.amount >= 0; const value = formatCurrencyAmount(Math.abs(tx.amount), tx.currency || "CNY"); return <button key={tx.id} type="button" onClick={() => setSelected(tx)} style={{ display: "flex", width: "100%", alignItems: "center", gap: 12, padding: 14, background: "#fff", border: 0, borderBottom: "1px solid #f5f5f5", textAlign: "left" }}><span style={{ background: "#f6f6f6", padding: 8, borderRadius: 12 }}>{income ? <ArrowDownLeft size={17}/> : <ArrowUpRight size={17}/>}</span><span style={{ flex: 1, minWidth: 0 }}><strong style={{ fontSize: 13 }}>{tx.title}</strong><small style={{ display: "block", color: "#999", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 3 }}>{new Date(tx.createdAt).toLocaleString("zh-CN")} · {tx.detail}</small></span><strong style={{ color: income ? "#218b64" : "#d45150", fontSize: 14, whiteSpace: "nowrap" }}>{income ? tx.credit ? "-" : "+" : tx.credit ? "+" : "-"}{value}</strong></button>; }) : <div style={{ color: "#999", textAlign: "center", padding: 36 }}>暂无流水</div>}</div>
        {!showAll && all.length > 10 && <button type="button" onClick={() => setShowAll(true)} style={{ border: 0, background: "transparent", color: "#777", display: "block", margin: "16px auto" }}>查看更多（剩余 {all.length - 10} 条）</button>}{showAll && all.length > 10 && <button type="button" onClick={() => setShowAll(false)} style={{ border: 0, background: "transparent", color: "#777", display: "block", margin: "16px auto" }}>收起</button>}
      </section>{error && <p role="status" style={{ color: "#b34a35", fontSize: 12 }}>{error}</p>}
    </main>
    {settingsOpen && <div onClick={() => setSettingsOpen(false)} style={{ position: "absolute", inset: 0, zIndex: 50, background: "#0008", display: "flex", alignItems: "flex-end" }}><div onClick={event => event.stopPropagation()} role="dialog" aria-label="钱包设置" style={{ background: "#fff", borderRadius: "26px 26px 0 0", padding: 23, width: "100%", maxHeight: "80%", overflowY: "auto" }}><h2>钱包设置</h2><label style={field}>默认结算币种<select className={inputClass} value={wallet.primaryCurrency} onChange={e => update({ primaryCurrency: e.target.value as WalletCurrency, commonCurrencies: wallet.commonCurrencies?.filter(c => c !== e.target.value), cards: wallet.cards.map(card => Object.values(banks).includes(card.bankLabel) ? { ...card, bankLabel: banks[e.target.value as WalletCurrency] } : card) })}>{WALLET_CURRENCIES.map(c => <option key={c} value={c}>{names[c]} · {c}</option>)}</select></label><label style={field}>总资产显示币种<select className={inputClass} value={wallet.displayCurrency} onChange={e => update({ displayCurrency: e.target.value as WalletCurrency })}>{WALLET_CURRENCIES.map(c => <option key={c} value={c}>{names[c]} · {c}</option>)}</select></label><div style={{ ...field }}>其他常用币种<div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>{WALLET_CURRENCIES.filter(c => c !== wallet.primaryCurrency).map(c => <button type="button" key={c} onClick={() => toggleCommon(c)} style={{ border: "1px solid #ddd", background: wallet.commonCurrencies?.includes(c) ? "#111" : "#fff", color: wallet.commonCurrencies?.includes(c) ? "#fff" : "#444", borderRadius: 18, padding: "7px 11px" }}>{c}</button>)}</div></div><label style={{ ...field, display: "flex", justifyContent: "space-between" }}>收到外币自动换成默认币种<input type="checkbox" checked={wallet.autoConvertReceived} onChange={e => update({ autoConvertReceived: e.target.checked })}/></label><label style={field}>经济情况（可模糊填写）<input className={inputClass} value={wallet.wealthLevel || ""} onChange={e => update({ wealthLevel: e.target.value })} placeholder="例如：收入稳定，花钱谨慎"/></label><label style={field}>收入来源（可模糊填写）<input className={inputClass} value={wallet.incomeSources || ""} onChange={e => update({ incomeSources: e.target.value })} placeholder="例如：自由职业和家里偶尔补贴"/></label>{<label style={{ ...field, display: "flex", justifyContent: "space-between" }}>开通信用卡<input type="checkbox" checked={wallet.creditEnabled} onChange={e => { if (Object.values(wallet.creditDebts || {}).every(value => !value)) { update({ creditEnabled: e.target.checked, creditMaskedNumber: wallet.creditMaskedNumber || newCreditNumber() }); setActiveCard("debit"); } else setError("请先还清信用卡欠款。"); }}/></label>}<div style={{ marginBottom: 18 }}><button type="button" onClick={suggestBase} disabled={busy} style={{ ...button, background: "#f5f5f5", color: "#333", width: "100%" }}>{busy ? "正在参考人设…" : "AI 建议基础金额"}</button>{suggestion && <div style={{ padding: 12, marginTop: 8, background: "#fafafa", borderRadius: 12, fontSize: 13 }}>建议 {formatCurrencyAmount(suggestion.amount, suggestion.currency)}<p>{suggestion.explanation}</p><button type="button" onClick={acceptBase} style={button}>确认采用</button></div>}</div>{ownerId && <div style={{ marginBottom: 18 }}><b>角色储蓄卡基础金额</b><div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginTop: 8 }}>{WALLET_CURRENCIES.map(c => <button key={c} type="button" onClick={() => { setEditCurrency(c); setEditAmount(String(getWalletCurrencyBalance(wallet,c))); setSettingsOpen(false); }} style={{ ...button, background: "#f5f5f5", color: "#333", padding: "7px 10px" }}>{c}</button>)}</div></div>}{ownerId && <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}><button type="button" style={{ ...button, flex: 1, background: "#f5f5f5", color: "#333" }} onClick={() => { setActiveCard("debit"); setDirection("in"); setEntryCurrency(wallet.primaryCurrency); setEntryOpen(true); setSettingsOpen(false); }}>角色入账</button><button type="button" style={{ ...button, flex: 1, background: "#f5f5f5", color: "#333" }} onClick={() => { setActiveCard("debit"); setDirection("out"); setEntryCurrency(wallet.primaryCurrency); setEntryOpen(true); setSettingsOpen(false); }}>角色支出</button>{wallet.creditEnabled && <button type="button" style={{ ...button, flex: 1, background: "#f5f5f5", color: "#333" }} onClick={() => { setActiveCard("credit"); setCreditAction("spend"); setEntryCurrency(wallet.primaryCurrency); setEntryOpen(true); setSettingsOpen(false); }}>角色刷卡</button>}{wallet.creditEnabled && <button type="button" style={{ ...button, flex: 1, background: "#f5f5f5", color: "#333" }} onClick={() => { setActiveCard("credit"); setCreditAction("repay"); setEntryCurrency(wallet.primaryCurrency); setEntryOpen(true); setSettingsOpen(false); }}>角色还款</button>}</div>}<p style={{ color: "#999", fontSize: 11 }}>参考汇率为固定估算值，非实时市场报价。外币原价会记录在账单里。仅在有现实依据时生成收入和生活消费。</p><button type="button" style={{ ...button, width: "100%" }} onClick={() => setSettingsOpen(false)}>完成</button></div></div>}
    {entryOpen && <div onClick={() => setEntryOpen(false)} style={{ position: "absolute", inset: 0, zIndex: 51, background: "#0008", display: "flex", alignItems: "flex-end" }}><div onClick={e => e.stopPropagation()} role="dialog" aria-label={creditAction === "repay" && activeCard === "credit" ? "信用卡还款" : isCredit ? "信用卡支出" : "手动记账"} style={{ background: "#fff", padding: 23, borderRadius: "25px 25px 0 0", width: "100%" }}><h2>{isCredit ? creditAction === "repay" ? "从储蓄卡还款" : "信用卡支出" : direction === "in" ? "银行卡入账" : "银行卡支出"}</h2>{(!isCredit || creditAction === "spend") && <label style={field}>来源或用途<input className={inputClass} value={entryTitle} onChange={e => setEntryTitle(e.target.value)} placeholder="例如：工资、CU 午餐"/></label>}<div style={{ display: "flex", gap: 10 }}><label style={{ ...field, flex: 1 }}>金额<input className={inputClass} type="number" min="0.01" value={entryAmount} onChange={e => setEntryAmount(e.target.value)}/></label><label style={{ ...field, width: 106 }}>币种<select className={inputClass} value={entryCurrency} onChange={e => setEntryCurrency(e.target.value as WalletCurrency)}>{WALLET_CURRENCIES.map(c => <option key={c} value={c}>{symbols[c]} {c}</option>)}</select></label></div>{isCredit && creditAction === "repay" && <p style={{ fontSize: 12, color: "#777" }}>该币种欠款 {formatCurrencyAmount(wallet.creditDebts?.[entryCurrency] || 0, entryCurrency)}</p>}{error && <p style={{ color: "#b33" }}>{error}</p>}<button type="button" onClick={isCredit ? creditSubmit : saveEntry} style={{ ...button, width: "100%" }}>确认</button></div></div>}
    {editCurrency && <div onClick={() => setEditCurrency(null)} style={{ position: "absolute", inset: 0, zIndex: 51, background: "#0008", display: "flex", alignItems: "flex-end" }}><div onClick={e => e.stopPropagation()} role="dialog" aria-label="设置基础余额" style={{ background: "#fff", padding: 23, borderRadius: "25px 25px 0 0", width: "100%" }}><h2>{names[editCurrency]} · 基础余额</h2><p style={{ color: "#888", fontSize: 12 }}>调整储蓄卡基础余额，会在流水里保留一条调整记录。</p><input className={inputClass} type="number" min="0" value={editAmount} onChange={e => setEditAmount(e.target.value)}/>{error && <p style={{ color: "#b33" }}>{error}</p>}<button type="button" onClick={saveBase} style={{ ...button, width: "100%", marginTop: 15 }}>保存</button></div></div>}
    {selected && <div onClick={() => setSelected(null)} style={{ position: "absolute", inset: 0, zIndex: 55, background: "#0009", display: "grid", placeItems: "center", padding: 24 }}><div onClick={e => e.stopPropagation()} role="dialog" aria-label="流水详情" style={{ background: "#fff", borderRadius: 24, padding: 24, width: "100%", maxWidth: 380, boxShadow: "0 24px 55px #0003" }}><div style={{ color: "#888", fontSize: 12 }}>{selected.credit ? "信用卡" : "储蓄卡"} · {selected.source === "generated" ? "生活流水" : selected.source === "manual" ? "手动记账" : "实际交易"}</div><h2 style={{ margin: "12px 0" }}>{selected.title}</h2><strong style={{ color: selected.credit ? selected.amount > 0 ? "#d45150" : "#218b64" : selected.amount >= 0 ? "#218b64" : "#d45150", fontSize: 28 }}>{selected.amount > 0 ? "+" : ""}{formatCurrencyAmount(selected.amount,selected.currency || "CNY")}</strong><p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", lineHeight: 1.7, fontSize: 14 }}>{selected.detail}</p><p style={{ color: "#777", fontSize: 12 }}>时间：{new Date(selected.createdAt).toLocaleString("zh-CN")}<br/>分类：{selected.category}{selected.originalCurrency && <><br/>原价：{formatCurrencyAmount(selected.originalAmount || 0, selected.originalCurrency)}<br/>参考换算：{selected.exchangeRate?.toFixed(4) || "—"}</>}</p><button type="button" onClick={() => setSelected(null)} style={{ ...button, width: "100%" }}>关闭</button></div></div>}
  </div>;
}
