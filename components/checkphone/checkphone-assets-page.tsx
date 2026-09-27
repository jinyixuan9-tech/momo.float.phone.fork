"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { WalletPanel } from "@/components/chat/wallet-panel";
import type { Character } from "@/lib/character-types";
import type { CheckPhoneAssetsPayload, CheckPhoneSnapshot } from "@/lib/checkphone-config";
import { generateCheckPhoneAssets } from "@/lib/checkphone-engine";
import { loadPhoneSnapshot, savePhoneSnapshot } from "@/lib/checkphone-storage";
import { loadWalletState, recordWalletCredit, recordWalletPayment } from "@/lib/wallet-storage";
import type { WalletCurrency } from "@/lib/wallet-types";

function parseActivityAmount(label: string, fallback: WalletCurrency): { amount: number; currency: WalletCurrency } | null {
  const currency: WalletCurrency = /₩|KRW|韩元/i.test(label) ? "KRW" : /JPY|日元/i.test(label) ? "JPY"
    : /\$|USD|美元/i.test(label) ? "USD" : /¥|￥|CNY|人民币/i.test(label) ? "CNY" : fallback;
  const normalized = label.replace(/[,，\s]/g, "");
  const match = normalized.match(/[+-]?\d+(?:\.\d+)?/);
  if (!match) return null;
  const amount = Number(match[0]);
  return Number.isFinite(amount) && amount !== 0 ? { amount, currency } : null;
}

export function CheckPhoneAssetsPage({ character, onBack }: { character: Character; onBack: () => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const [snapshot, setSnapshot] = useState<CheckPhoneSnapshot<CheckPhoneAssetsPayload> | null>(null);
  useEffect(() => {
    let active = true;
    loadPhoneSnapshot<CheckPhoneAssetsPayload>(character.id, "assets").then(value => { if (active) setSnapshot(value); });
    return () => { active = false; };
  }, [character.id]);

  async function refresh() {
    if (loading) return;
    if (!loadWalletState(character.id).generateLivingTransactions) {
      setError("请先在 Wallet 的角色账户设置中开启「允许生成生活流水」。");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const result = await generateCheckPhoneAssets(character.id, snapshot?.payload, snapshot?.updatedAt);
      if (!result.payload) { setError(result.error || "刷新失败"); return; }
      const priorIds = new Set(snapshot?.payload.activities.map(activity => activity.id) || []);
      let skipped = 0;
      const failedIds = new Set<string>();
      for (const activity of result.payload.activities.slice().reverse()) {
        if (priorIds.has(activity.id)) continue;
        const parsed = parseActivityAmount(activity.amount, loadWalletState(character.id).primaryCurrency);
        if (!parsed) continue;
        const key = `checkphone-assets:${activity.id}`;
        const base = { ownerId: character.id, currency: parsed.currency, amount: Math.abs(parsed.amount),
          title: activity.title, detail: activity.detail, category: activity.category };
        const operation = parsed.amount < 0
          ? recordWalletPayment({ ...base, relatedOrderId: key })
          : recordWalletCredit({ ...base, relatedMessageId: key });
        if (!operation.ok) { skipped += 1; failedIds.add(activity.id); }
      }
      const now = new Date().toISOString();
      const next: CheckPhoneSnapshot<CheckPhoneAssetsPayload> = {
        id: `${character.id}:assets`, characterId: character.id, appId: "assets",
        generatedAt: snapshot?.generatedAt || now, updatedAt: now, summary: result.summary,
        payload: { ...result.payload, activities: result.payload.activities.filter(activity => !failedIds.has(activity.id)) },
      };
      await savePhoneSnapshot(next);
      setSnapshot(next);
      setVersion(value => value + 1);
      if (skipped) setError(`${skipped} 条支出超过余额，未写入流水。可调整角色初始余额后再刷新。`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "刷新失败");
    } finally {
      setLoading(false);
    }
  }
  return (
    <div style={{ height: "100%", position: "relative" }}>
      <WalletPanel key={`${character.id}:${version}`} ownerId={character.id} ownerName={character.name} readOnly onBack={onBack} />
      <button type="button" onClick={refresh} disabled={loading} aria-label="刷新角色流水" title="基于当前钱包生成新流水"
        style={{ position: "absolute", top: "calc(env(safe-area-inset-top, 0px) + 22px)", right: 76, height: 44, width: 44, borderRadius: 24, background: "#fff", border: "1px solid #eee", display: "grid", placeItems: "center" }}>
        <RefreshCw size={20} className={loading ? "cp-spin" : ""} />
      </button>
      {error && <div role="status" style={{ position: "absolute", bottom: 18, left: 20, right: 20, padding: 12, borderRadius: 12, background: "#fff3f1", color: "#a32", fontSize: 12 }}>{error}</div>}
    </div>
  );
}
