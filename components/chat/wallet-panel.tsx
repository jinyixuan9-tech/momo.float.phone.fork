"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, ChevronLeft, CreditCard, Landmark, Settings2, WalletCards } from "lucide-react";
import { loadCharacters } from "@/lib/character-storage";
import {
  WALLET_CURRENCIES, WALLET_REFERENCE_RATES, WALLET_UPDATED_EVENT,
  formatCurrencyAmount, getWalletAssetEstimate, getWalletCurrencyBalance,
  loadWalletState, saveWalletState, setWalletCurrencyBalance,
  createWalletCard, deleteWalletCard, transferCardToWalletBalance, transferWalletBalanceToCard, adjustWalletCardAccount, setDefaultWalletCard,
} from "@/lib/wallet-storage";
import type { WalletCurrency, WalletState } from "@/lib/wallet-types";

type Props = { onBack: () => void; ownerId?: string; ownerName?: string; readOnly?: boolean };
const surface: React.CSSProperties = { background: "#fbfaf9", color: "#151515", height: "100%", position: "relative", display: "flex", flexDirection: "column", fontFamily: "system-ui, sans-serif" };
const currencyName: Record<WalletCurrency, string> = { CNY: "人民币", KRW: "韩元", JPY: "日元", USD: "美元" };
const circle: React.CSSProperties = { height: 44, width: 44, borderRadius: 24, border: "1px solid #ededed", background: "white", display: "grid", placeItems: "center", boxShadow: "0 6px 22px #00000008" };

export function WalletPanel({ onBack, ownerId, ownerName, readOnly = false }: Props) {
  const [selectedOwnerId, setSelectedOwnerId] = useState(ownerId || "");
  const [wallet, setWallet] = useState<WalletState>(() => loadWalletState(ownerId));
  const [filter, setFilter] = useState<"all" | "income" | "expense">("all");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [cardOpen, setCardOpen] = useState(false);
  const [editCurrency, setEditCurrency] = useState<WalletCurrency | null>(null);
  const [editAmount, setEditAmount] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [error, setError] = useState("");
  const [newCardTitle, setNewCardTitle] = useState("");
  const [newCardBalance, setNewCardBalance] = useState("0");
  const [cardAmount, setCardAmount] = useState("");
  const [cardAction, setCardAction] = useState<"deposit" | "withdraw" | "credit" | "debit">("deposit");
  const [selectedCardId, setSelectedCardId] = useState("");
  const actualOwnerId = ownerId || selectedOwnerId || undefined;
  const characters = useMemo(() => loadCharacters(), []);
  const displayName = ownerName || characters.find(item => item.id === actualOwnerId)?.name || "我的";
  useEffect(() => {
    setWallet(loadWalletState(actualOwnerId));
    const sync = () => setWallet(loadWalletState(actualOwnerId));
    window.addEventListener(WALLET_UPDATED_EVENT, sync);
    return () => window.removeEventListener(WALLET_UPDATED_EVENT, sync);
  }, [actualOwnerId]);
  const currentCurrency = wallet.primaryCurrency;
  const recent = wallet.transactions
    .filter(tx => filter === "all" || (filter === "income" ? tx.amount >= 0 : tx.amount < 0))
    .slice(0, showAll ? undefined : 8);
  function update(settings: Partial<WalletState>) {
    setWallet(saveWalletState({ ...wallet, ...settings }, actualOwnerId));
  }
  function saveAmount() {
    if (!editCurrency) return;
    const result = setWalletCurrencyBalance(editCurrency, Number(editAmount), actualOwnerId);
    if (!result.ok) { setError(result.error || "调整失败"); return; }
    setWallet(result.state);
    setError("");
    setEditCurrency(null);
  }
  function createCard() {
    if (actualOwnerId) return;
    const next = createWalletCard({ title: newCardTitle || "储蓄卡", bankLabel: newCardTitle || "我的银行卡", balance: Number(newCardBalance) });
    setWallet(next); setNewCardTitle(""); setNewCardBalance("0");
  }
  function moveCardMoney() {
    if (actualOwnerId || !selectedCardId) return;
    const amount = Number(cardAmount);
    const result = cardAction === "deposit" ? transferCardToWalletBalance(selectedCardId, amount)
      : cardAction === "withdraw" ? transferWalletBalanceToCard(selectedCardId, amount)
      : adjustWalletCardAccount(selectedCardId, amount, cardAction === "credit" ? "in" : "out");
    if (!result.ok) { setError(result.error || "操作失败"); return; }
    setWallet(result.state); setError(""); setCardAmount("");
  }
  const panelButton: React.CSSProperties = { background: "#fff", color: "#151515", border: "1px solid #eaeaea", borderRadius: 12, padding: "10px 13px", fontSize: 12, fontWeight: 600 };
  return (
    <div className="wallet-page-root" style={surface}>
      <div style={{ overflowY: "auto", flex: 1, padding: "calc(env(safe-area-inset-top, 0px) + 22px) 22px calc(env(safe-area-inset-bottom, 0px) + 32px)" }}>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <button type="button" onClick={onBack} aria-label="返回" style={circle}><ChevronLeft size={22} /></button>
          <button type="button" onClick={() => setSettingsOpen(true)} aria-label="钱包设置" style={circle}><Settings2 size={21} /></button>
        </div>
        <div style={{ marginTop: 35, marginBottom: 33 }}>
          <div style={{ color: "#999", fontSize: 11, letterSpacing: 4, fontWeight: 750 }}>PAY · WALLET</div>
          <h1 style={{ fontSize: 38, lineHeight: 1.15, letterSpacing: -2, margin: "10px 0 0", fontWeight: 850 }}>{displayName}资产</h1>
          {!ownerId && <p style={{ fontSize: 12, color: "#999", marginTop: 9 }}>总资产 ≈ {formatCurrencyAmount(getWalletAssetEstimate(wallet), wallet.displayCurrency)} · 参考汇率</p>}
        </div>
        <div style={{ background: "#1c1c1e", color: "#fff", borderRadius: 32, padding: "25px 27px", minHeight: 245, display: "flex", flexDirection: "column", boxShadow: "0 22px 38px #00000016", position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", width: 180, height: 180, borderRadius: "50%", border: "34px solid #ffffff08", right: -80, bottom: -100 }} />
          <div style={{ display: "flex", justifyContent: "space-between", color: "#a6a6aa", letterSpacing: 2, fontSize: 11, fontWeight: 700 }}>
            <span>当前账户 · CURRENT</span><span>{currencyName[currentCurrency]}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 20 }}>
            <Landmark size={22} color="#bbb" /><strong style={{ fontSize: 19 }}>{wallet.cards.find(card => card.id === wallet.defaultCardId)?.bankLabel || "我的钱包"}</strong>
          </div>
          <span style={{ fontSize: 12, color: "#999", marginTop: 2 }}>储蓄卡 · {currentCurrency}</span>
          <div style={{ flex: 1 }} />
          <div style={{ color: "#aaa", fontSize: 12, fontWeight: 700 }}>可用余额</div>
          <strong style={{ fontSize: 37, letterSpacing: -1.5, marginTop: 7 }}>{formatCurrencyAmount(getWalletCurrencyBalance(wallet, currentCurrency), currentCurrency)}</strong>
          <div style={{ color: "#aaa", letterSpacing: 4, fontSize: 14, marginTop: 21 }}>{wallet.cards.find(card => card.id === wallet.defaultCardId)?.maskedNumber || "**** **** **** 8888"}</div>
        </div>
        <section style={{ marginTop: 30 }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}><h2 style={{ fontSize: 22, margin: 0 }}>币种余额</h2><span style={{ fontSize: 11, color: "#999" }}>ACCOUNTS</span></div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10, marginTop: 14 }}>
            {WALLET_CURRENCIES.map(currency => <button type="button" key={currency} onClick={() => { if (readOnly) return; setEditCurrency(currency); setEditAmount(String(currency === "CNY" ? wallet.balance : getWalletCurrencyBalance(wallet, currency))); }} style={{ ...panelButton, padding: "14px", textAlign: "left", minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 11, color: "#999" }}>{currencyName[currency]} · {currency}</span>
              <strong style={{ display: "block", marginTop: 7, fontSize: 16, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{formatCurrencyAmount(getWalletCurrencyBalance(wallet, currency), currency)}</strong>
            </button>)}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12, fontSize: 12, color: "#888" }}>
            <span>总资产折算 · 仅供展示</span><b style={{ color: "#333" }}>≈ {formatCurrencyAmount(getWalletAssetEstimate(wallet), wallet.displayCurrency)}</b>
          </div>
          {!readOnly && <button type="button" onClick={() => setCardOpen(!cardOpen)} style={{ ...panelButton, width: "100%", textAlign: "left", marginTop: 16, display: "flex", justifyContent: "space-between" }}><span><WalletCards size={15} style={{ display: "inline", verticalAlign: "middle", marginRight: 8 }} />银行卡 · {wallet.cards.length} 张</span><span>{cardOpen ? "收起" : "查看"}</span></button>}
          {cardOpen && wallet.cards.map(card => <div key={card.id} style={{ ...panelButton, marginTop: 7, display: "flex", justifyContent: "space-between" }}><span>{card.bankLabel} · {card.title}</span><span>{formatCurrencyAmount(card.balance, "CNY")}</span></div>)}
        </section>
        <section style={{ marginTop: 34 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "end" }}><div><span style={{ fontSize: 10, color: "#999", letterSpacing: 3, fontWeight: 750 }}>RECENT</span><h2 style={{ fontSize: 23, margin: "4px 0 0" }}>最近账单</h2></div><button type="button" onClick={() => setShowAll(!showAll)} style={{ border: 0, color: "#888", background: "transparent", fontSize: 12 }}>{showAll ? "收起" : "交易明细"}</button></div>
          <div style={{ display: "flex", border: "1px solid #e8e8e8", background: "#fff", borderRadius: 30, padding: 4, width: "fit-content", margin: "18px 0" }}>
            {(["all", "income", "expense"] as const).map((value, i) => <button type="button" key={value} onClick={() => setFilter(value)} style={{ border: 0, background: filter === value ? "#111" : "transparent", color: filter === value ? "#fff" : "#222", borderRadius: 22, padding: "9px 19px", fontWeight: 700 }}>{["全部", "收入", "支出"][i]}</button>)}
          </div>
          <div style={{ background: "#fff", border: "1px solid #e9e9e9", borderRadius: 25, minHeight: 110, overflow: "hidden" }}>
            {recent.length === 0 ? <div style={{ textAlign: "center", color: "#999", padding: "48px 0", fontSize: 13 }}>暂无交易记录</div> : recent.map(tx => <div key={tx.id} style={{ display: "flex", gap: 12, alignItems: "center", padding: "14px", borderBottom: "1px solid #f5f5f5" }}>
              <div style={{ background: "#f6f6f6", borderRadius: 12, padding: 8 }}>{tx.amount < 0 ? <ArrowUpRight size={17} /> : <ArrowDownLeft size={17} />}</div>
              <div style={{ flex: 1, minWidth: 0 }}><strong style={{ fontSize: 13 }}>{tx.title}</strong><div style={{ fontSize: 11, color: "#999", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{new Date(tx.createdAt).toLocaleString("zh-CN")} · {tx.detail}</div></div>
              <div style={{ textAlign: "right", whiteSpace: "nowrap" }}><strong style={{ fontSize: 13 }}>{tx.amount > 0 ? "+" : ""}{formatCurrencyAmount(tx.amount, tx.currency || "CNY")}</strong>{tx.originalCurrency && <div style={{ fontSize: 10, color: "#999" }}>原价 {formatCurrencyAmount(tx.originalAmount || 0, tx.originalCurrency)}</div>}</div>
            </div>)}
          </div>
        </section>
      </div>
      {settingsOpen && <div style={{ position: "absolute", inset: 0, background: "#0007", display: "flex", alignItems: "flex-end", zIndex: 50 }} onClick={() => setSettingsOpen(false)}><div role="dialog" aria-label="钱包设置" onClick={event => event.stopPropagation()} style={{ width: "100%", maxHeight: "82%", overflowY: "auto", padding: "23px", borderRadius: "25px 25px 0 0", background: "#fff" }}>
        <h2 style={{ margin: "0 0 20px" }}>钱包设置</h2>
        {!ownerId && !readOnly && <label style={{ display: "block", marginBottom: 17 }}>查看账户<select className="ui-input" value={selectedOwnerId} onChange={event => setSelectedOwnerId(event.target.value)}><option value="">我自己</option>{characters.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
        <label style={{ display: "block", marginBottom: 17 }}>主使用币种<select className="ui-input" value={wallet.primaryCurrency} onChange={event => update({ primaryCurrency: event.target.value as WalletCurrency })} disabled={readOnly}>{WALLET_CURRENCIES.map(c => <option key={c} value={c}>{currencyName[c]} · {c}</option>)}</select></label>
        <label style={{ display: "block", marginBottom: 17 }}>总资产显示币种<select className="ui-input" value={wallet.displayCurrency} onChange={event => update({ displayCurrency: event.target.value as WalletCurrency })} disabled={readOnly}>{WALLET_CURRENCIES.map(c => <option key={c} value={c}>{currencyName[c]} · {c}</option>)}</select></label>
        <label style={{ display: "flex", justifyContent: "space-between", marginBottom: 17 }}>收到外币时自动换成主币种<input type="checkbox" checked={wallet.autoConvertReceived} onChange={event => update({ autoConvertReceived: event.target.checked })} disabled={readOnly} /></label>
        {actualOwnerId && !readOnly && <><label style={{ display: "block", marginBottom: 14 }}>财富水平<input className="ui-input" value={wallet.wealthLevel || ""} onChange={event => update({ wealthLevel: event.target.value })} /></label><label style={{ display: "block", marginBottom: 14 }}>收入来源<input className="ui-input" value={wallet.incomeSources || ""} onChange={event => update({ incomeSources: event.target.value })} /></label><label style={{ display: "flex", justifyContent: "space-between", marginBottom: 17 }}>允许生成生活流水<input type="checkbox" checked={wallet.generateLivingTransactions || false} onChange={event => update({ generateLivingTransactions: event.target.checked })} /></label></>}
        {!actualOwnerId && !readOnly && <div style={{ borderTop: "1px solid #eee", paddingTop: 15, marginBottom: 18, display: "grid", gap: 9 }}>
          <strong>银行卡管理 · 人民币</strong>
          {wallet.cards.map(card => <div key={card.id} style={{ display: "flex", gap: 7, alignItems: "center", fontSize: 12 }}><span style={{ flex: 1 }}>{card.title} · {formatCurrencyAmount(card.balance, "CNY")}</span><button type="button" onClick={() => setWallet(setDefaultWalletCard(card.id))} style={panelButton}>{wallet.defaultCardId === card.id ? "默认" : "设默认"}</button><button type="button" onClick={() => { const result = deleteWalletCard(card.id); if (result.ok) setWallet(result.state); else setError(result.error || "删除失败"); }} style={panelButton}>删除</button></div>)}
          <input className="ui-input" placeholder="新卡名称" value={newCardTitle} onChange={event => setNewCardTitle(event.target.value)} /><input className="ui-input" type="number" min="0" placeholder="初始余额" value={newCardBalance} onChange={event => setNewCardBalance(event.target.value)} /><button type="button" onClick={createCard} style={panelButton}>添加银行卡</button>
          <select className="ui-input" value={selectedCardId} onChange={event => setSelectedCardId(event.target.value)}><option value="">选择银行卡</option>{wallet.cards.map(card => <option value={card.id} key={card.id}>{card.title}</option>)}</select>
          <select className="ui-input" value={cardAction} onChange={event => setCardAction(event.target.value as typeof cardAction)}><option value="deposit">卡 → 钱包余额</option><option value="withdraw">钱包余额 → 卡</option><option value="credit">银行卡入账</option><option value="debit">银行卡转出</option></select>
          <input className="ui-input" type="number" min="0.01" step="0.01" placeholder="金额" value={cardAmount} onChange={event => setCardAmount(event.target.value)} /><button type="button" onClick={moveCardMoney} style={panelButton}>确认操作</button>
          {error && <span style={{ color: "#c22", fontSize: 12 }}>{error}</span>}
        </div>}
        <p style={{ color: "#888", fontSize: 11 }}>参考汇率（非实时）：1 KRW ≈ ¥{WALLET_REFERENCE_RATES.KRW}，1 JPY ≈ ¥{WALLET_REFERENCE_RATES.JPY}，1 USD ≈ ¥{WALLET_REFERENCE_RATES.USD}。换汇流水保留原币金额。</p>
        <button type="button" onClick={() => setSettingsOpen(false)} style={{ ...panelButton, width: "100%", background: "#111", color: "#fff" }}>完成</button>
      </div></div>}
      {editCurrency && <div style={{ position: "absolute", inset: 0, background: "#0007", display: "flex", alignItems: "flex-end", zIndex: 55 }} onClick={() => setEditCurrency(null)}><div role="dialog" aria-label="调整余额" onClick={event => event.stopPropagation()} style={{ background: "#fff", borderRadius: "25px 25px 0 0", width: "100%", padding: 23 }}>
        <h2>{currencyName[editCurrency]}余额</h2><p style={{ color: "#888", fontSize: 12 }}>{editCurrency === "CNY" ? "这里调整钱包余额；已有银行卡余额单独保留。" : "修改会记入账户调整流水。"}</p>
        <input className="ui-input" type="number" min="0" step={editCurrency === "CNY" || editCurrency === "USD" ? "0.01" : "1"} value={editAmount} onChange={event => setEditAmount(event.target.value)} />
        {error && <p style={{ color: "#c22" }}>{error}</p>}<button type="button" onClick={saveAmount} style={{ ...panelButton, background: "#111", color: "#fff", width: "100%", marginTop: 16 }}>保存</button>
      </div></div>}
    </div>
  );
}
