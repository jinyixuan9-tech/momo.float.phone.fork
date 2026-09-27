"use client";

import { useEffect, useState } from "react";
import { refreshWalletLiving } from "@/lib/wallet-life-generation";
import { WALLET_CURRENCIES, WALLET_UPDATED_EVENT, loadWalletState, saveWalletState } from "@/lib/wallet-storage";
import type { WalletCurrency, WalletState } from "@/lib/wallet-types";

const names: Record<WalletCurrency, string> = { CNY: "人民币", KRW: "韩元", JPY: "日元", USD: "美元", EUR: "欧元", HKD: "港币", TWD: "新台币", AUD: "澳元" };
const banks: Record<WalletCurrency, string> = { CNY: "中国银行", KRW: "新韩银行", JPY: "三菱UFJ银行", USD: "Chase", EUR: "BNP Paribas", HKD: "汇丰银行", TWD: "中国信托", AUD: "Commonwealth Bank" };
const size = (value: number) => `calc(${value}px * var(--app-text-scale, 1))`;
const labelStyle: React.CSSProperties = { display: "grid", gap: 5, marginBottom: 13, fontSize: size(11.5), color: "#555" };
const actionStyle: React.CSSProperties = { width: "100%", border: 0, borderRadius: 12, padding: "10px 14px", background: "#111", color: "#fff", fontSize: size(12), fontWeight: 600 };

/** This setup intentionally never renders a role's balances, debts or transactions. */
export function WalletRoleSetup({ ownerId, ownerName }: { ownerId: string; ownerName: string }) {
  const [wallet, setWallet] = useState<WalletState>(() => loadWalletState(ownerId));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    setWallet(loadWalletState(ownerId)); setNotice("");
    const sync = (event: Event) => {
      if ((event as CustomEvent<{ ownerId?: string }>).detail?.ownerId === ownerId) setWallet(loadWalletState(ownerId));
    };
    window.addEventListener(WALLET_UPDATED_EVENT, sync);
    return () => window.removeEventListener(WALLET_UPDATED_EVENT, sync);
  }, [ownerId]);
  function update(partial: Partial<WalletState>) {
    setWallet(saveWalletState({ ...wallet, ...partial }, ownerId));
    setNotice("");
  }
  function toggleCommon(currency: WalletCurrency) {
    update({ commonCurrencies: wallet.commonCurrencies?.includes(currency) ? wallet.commonCurrencies.filter(item => item !== currency) : [...(wallet.commonCurrencies || []), currency] });
  }
  async function refreshBlind() {
    if (busy) return;
    setBusy(true); setNotice("");
    try {
      await refreshWalletLiving(ownerId);
      setNotice("已刷新。具体余额与流水请到角色手机的资产页查看。");
    } catch { setNotice("刷新未完成，请检查 AI 接口后重试。"); }
    finally { setBusy(false); }
  }
  return <section style={{ fontSize: size(12), lineHeight: 1.45 }}>
    <p style={{ margin: "0 0 15px", color: "#888", fontSize: size(11.5) }}>设置 {ownerName} 的用币习惯，然后盲刷资产。这里不会展示金额和流水。</p>
    <label style={labelStyle}>默认结算币种
      <select className="ui-input" value={wallet.primaryCurrency} onChange={event => { const currency = event.target.value as WalletCurrency; update({ primaryCurrency: currency, commonCurrencies: wallet.commonCurrencies?.filter(item => item !== currency), cards: wallet.cards.map(card => Object.values(banks).includes(card.bankLabel) ? { ...card, bankLabel: banks[currency] } : card) }); }}>
        {WALLET_CURRENCIES.map(currency => <option key={currency} value={currency}>{names[currency]} · {currency}</option>)}
      </select>
    </label>
    <label style={labelStyle}>总资产显示币种
      <select className="ui-input" value={wallet.displayCurrency} onChange={event => update({ displayCurrency: event.target.value as WalletCurrency })}>
        {WALLET_CURRENCIES.map(currency => <option key={currency} value={currency}>{names[currency]} · {currency}</option>)}
      </select>
    </label>
    <div style={labelStyle}>其他常用币种
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {WALLET_CURRENCIES.filter(currency => currency !== wallet.primaryCurrency).map(currency => <button type="button" key={currency} onClick={() => toggleCommon(currency)} style={{ border: "1px solid #ddd", background: wallet.commonCurrencies?.includes(currency) ? "#111" : "#fff", color: wallet.commonCurrencies?.includes(currency) ? "#fff" : "#444", borderRadius: 18, padding: "6px 9px", fontSize: size(11) }}>{currency}</button>)}
      </div>
    </div>
    <label style={{ ...labelStyle, display: "flex", justifyContent: "space-between", alignItems: "center" }}>收到外币自动换成默认币种<input type="checkbox" checked={wallet.autoConvertReceived} onChange={event => update({ autoConvertReceived: event.target.checked })}/></label>
    <label style={labelStyle}>经济情况（可以模糊填写）<input className="ui-input" value={wallet.wealthLevel || ""} onChange={event => update({ wealthLevel: event.target.value })} placeholder="例如：收入稳定，花钱谨慎"/></label>
    <label style={labelStyle}>收入来源（可以模糊填写）<input className="ui-input" value={wallet.incomeSources || ""} onChange={event => update({ incomeSources: event.target.value })} placeholder="例如：工作收入、家人偶尔补贴"/></label>
    <label style={{ ...labelStyle, display: "flex", justifyContent: "space-between", alignItems: "center" }}>开通信用卡<input type="checkbox" checked={wallet.creditEnabled} onChange={event => {
      if (!event.target.checked && Object.values(wallet.creditDebts || {}).some(amount => (amount || 0) > 0)) { setNotice("当前无法关闭信用卡，请到角色手机查看原因。"); return; }
      update({ creditEnabled: event.target.checked, creditMaskedNumber: wallet.creditMaskedNumber || `**** **** **** ${String(Math.floor(Math.random() * 10000)).padStart(4, "0")}` });
    }}/></label>
    <p style={{ color: "#999", fontSize: size(10.5), margin: "3px 0 15px" }}>发卡行随默认结算币种确定；信用卡与储蓄卡使用同一家银行、不同尾号。切换总资产显示币种不改变发卡行。</p>
    <button type="button" disabled={busy} onClick={refreshBlind} style={actionStyle}>{busy ? "正在刷新角色资产…" : "刷新角色资产"}</button>
    {notice && <p role="status" style={{ color: notice.startsWith("已") ? "#40816a" : "#b34a35", fontSize: size(11), margin: "10px 0 0" }}>{notice}</p>}
  </section>;
}
