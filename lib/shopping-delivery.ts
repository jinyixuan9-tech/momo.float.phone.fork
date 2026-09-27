import { createOrGetSession, pushChatMessage } from "./chat-storage";
import { loadShoppingState, saveShoppingState } from "./shopping-storage";
import type { ShoppingAddress, ShoppingOrder, ShoppingShipment, ShoppingState } from "./shopping-types";

export function shoppingAddressLabel(address: ShoppingAddress): string {
  return `${address.country} ${address.city} ${address.street} · ${address.name} ${address.phone}`.trim();
}

// A stable estimate, not a claim of actual carrier timing or customs fees.
export function shoppingDeliveryEstimate(from: ShoppingAddress | undefined, to: ShoppingAddress, method: "express" | "standard" | "air" | "sea" = "express"): { days: number; fee: number } {
  if (!from) return { days: 3, fee: 0 };
  if (from.country !== to.country) return method === "sea" ? { days: 5, fee: 38 } : { days: 3, fee: 80 };
  if (from.city !== to.city) return method === "standard" ? { days: 2, fee: 8 } : { days: 1, fee: 15 };
  return method === "standard" ? { days: 1, fee: 5 } : { days: .5, fee: 10 };
}

export function shippingTimelineForOrder(order: ShoppingOrder, days: number): ShoppingOrder["shippingTimeline"] {
  const start = new Date();
  const at = (fraction: number) => new Date(start.getTime() + days * fraction * 86400000);
  return ([
    ["ordered", "已下单", 0], ["shipped", "已发货", .2],
    ["delivering", "配送中", .65], ["delivered", "已签收", 1],
  ] as const).map(([status, label, fraction]) => ({ status, label, timestamp: at(fraction).toISOString(), timeLabel: at(fraction).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) }));
}

export function announceShoppingGift(characterId: string, item: { id: string; title: string; merchantLabel: string; priceLabel: string; previewIcon: string; tone: "ivory" | "mist" | "blush" | "graphite" }, id: string, recipientName: string, deliveredAt?: string): void {
  const session = createOrGetSession(characterId);
  pushChatMessage({ sessionId: session.id, role: "user", content: "", mediaType: "gift", mediaData: {
    shoppingGiftId: id, giftName: item.title, label: item.title, giftMerchantLabel: item.merchantLabel,
    giftPriceLabel: item.priceLabel, giftPreviewIcon: item.previewIcon, giftTone: item.tone,
    giftSentAt: new Date().toISOString(), giftDeliveredAt: deliveredAt,
    recipientId: characterId, recipientName,
  } });
  window.dispatchEvent(new CustomEvent("chat-messages-updated", { detail: { sessionId: session.id } }));
}

export function syncShoppingDeliveries(): void {
  if (typeof window === "undefined") return;
  const state = loadShoppingState();
  const now = Date.now();
  let changed = false;
  const shipments: ShoppingShipment[] = state.shipments.map(s => {
    if (s.noticeSentAt || new Date(s.deliverAt).getTime() > now) return s;
    const session = createOrGetSession(s.recipientCharacterId);
    pushChatMessage({ sessionId: session.id, role: "system", content: `物流已签收：${s.recipientName}收到了${s.item.title}。${s.notifyRecipient ? "此前已收到寄送通知。" : "这是此前未通知对方的惊喜礼物。"}`, mediaData: { label: "__shopping_delivery__" } });
    window.dispatchEvent(new CustomEvent("chat-messages-updated", { detail: { sessionId: session.id } }));
    changed = true;
    return { ...s, noticeSentAt: new Date().toISOString() };
  });
  const orders = state.orders.map(o => {
    if (o.canceledAt) return o;
    if (!o.recipientCharacterId || o.deliveryNoticeSentAt) return o;
    const delivered = o.shippingTimeline?.find(e => e.status === "delivered");
    if (!delivered || new Date(delivered.timestamp).getTime() > now) return o;
    const session = createOrGetSession(o.recipientCharacterId);
    pushChatMessage({ sessionId: session.id, role: "system", content: `物流已签收：${o.recipientName || "收件人"}收到了${o.summary}。${o.notifyRecipient ? "此前已收到寄送通知。" : "这是此前未通知对方的惊喜礼物。"}`, mediaData: { label: "__shopping_delivery__" } });
    window.dispatchEvent(new CustomEvent("chat-messages-updated", { detail: { sessionId: session.id } }));
    changed = true;
    return { ...o, deliveryNoticeSentAt: new Date().toISOString() };
  });
  if (changed) saveShoppingState({ ...state, shipments, orders });
}
