"use client";

import { useState } from "react";
import { WalletPanel } from "@/components/chat/wallet-panel";
import { refreshWalletLiving } from "@/lib/wallet-life-generation";
import type { Character } from "@/lib/character-types";

export function CheckPhoneAssetsPage({ character, onBack }: { character: Character; onBack: () => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  async function refresh() {
    if (loading) return;
    setLoading(true); setError("");
    try {
      const result = await refreshWalletLiving(character.id);
      if (result.skipped) setError(`${result.skipped} 条消费超过储蓄卡余额，未记入流水。可在设置中调整基础余额。`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "刷新失败"); }
    finally { setLoading(false); }
  }
  return <div style={{ height: "100%", position: "relative" }}><WalletPanel ownerId={character.id} ownerName={character.name} readOnly onBack={onBack} onRefresh={refresh} refreshLoading={loading}/>{error && <div role="status" style={{ position: "absolute", bottom: 18, left: 20, right: 20, padding: 12, borderRadius: 12, background: "#fff3f1", color: "#a32", fontSize: 12 }}>{error}</div>}</div>;
}
