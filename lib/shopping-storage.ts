import { kvGet, kvSet, registerKvMigration } from "./kv-db";
import type { ShoppingAddress, ShoppingCategory, ShoppingCustomCategory, ShoppingSearchResult, ShoppingShipment, ShoppingShippingEvent, ShoppingState } from "./shopping-types";
import { walletCurrency } from "./wallet-storage";
import { DEFAULT_SHOPPING_REFRESH_PROMPT, DEFAULT_SHOPPING_SEARCH_PROMPT, SHOPPING_RECOMMENDATION_CATEGORIES } from "./shopping-engine";
import { normalizeShoppingRegions, SHOPPING_REGION_PRESETS } from "./shopping-regions";
import { syncCustomWalletCurrencies } from "./wallet-storage";

const SHOPPING_STATE_KEY = "ai_phone_shopping_state_v1";
export const SHOPPING_STATE_UPDATED_EVENT = "shopping-state-updated";
const DEFAULT_DELIVERY_MIN_MINUTES = 60;
const DEFAULT_DELIVERY_MAX_MINUTES = 180;

registerKvMigration(SHOPPING_STATE_KEY);

function cleanText(value: unknown, maxLength: number): string {
  return String(value ?? "").replace(/\u0000/g, "").trim().slice(0, maxLength);
}

function normalizeArray<T>(value: unknown, guard: (item: unknown) => T | null): T[] {
  return Array.isArray(value) ? value.map(guard).filter((item): item is T => Boolean(item)) : [];
}

function normalizeRefreshPrompt(value: unknown): string {
  const prompt = cleanText(value, 12000);
  if (!prompt) return DEFAULT_SHOPPING_REFRESH_PROMPT;
  if (prompt.includes("#最近浏览1") || prompt.includes("生成 8 到 12 条最近浏览")) {
    return DEFAULT_SHOPPING_REFRESH_PROMPT;
  }
  return prompt;
}

function normalizeSearchPrompt(value: unknown): string {
  return cleanText(value, 12000) || DEFAULT_SHOPPING_SEARCH_PROMPT;
}

function normalizeDeliveryMinutes(value: unknown, fallback: number): number {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return fallback;
  return Math.min(10080, Math.max(1, Math.round(amount)));
}

function normalizeProduct(value: unknown): ShoppingState["catalog"]["recommendations"][number] | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const id = cleanText(record.id, 180);
  const title = cleanText(record.title, 200);
  const merchantLabel = cleanText(record.merchantLabel, 120);
  const priceLabel = cleanText(record.priceLabel, 80);
  const previewIcon = cleanText(record.previewIcon, 8);
  const rawTone = record.tone;
  const tone = rawTone === "mist" || rawTone === "blush" || rawTone === "graphite" ? rawTone : "ivory";
  if (!id || !title || !merchantLabel || !priceLabel || !previewIcon) return null;
  const subtitle = cleanText(record.subtitle, 400);
  const detail = cleanText(record.detail, 1200);
  return {
    id,
    title,
    merchantLabel,
    priceLabel,
    tagLabel: cleanText(record.tagLabel, 80) || "商品",
    subtitle: subtitle || detail || title,
    detail: detail || subtitle || title,
    previewIcon,
    tone,
    currency: record.currency ? walletCurrency(record.currency) : undefined,
    brandLabel: cleanText(record.brandLabel, 100) || undefined,
    mode: record.mode === "food" ? "food" : "shop",
    regionId: cleanText(record.regionId, 5) || undefined,
    shippingCountry: cleanText(record.shippingCountry, 60) || undefined,
    shippingCity: cleanText(record.shippingCity, 80) || undefined,
    categoryIds: Array.isArray(record.categoryIds) ? record.categoryIds.map(item => cleanText(item, 80)).filter(Boolean).slice(0, 12) : undefined,
    variantGroups: Array.isArray(record.variantGroups) ? record.variantGroups.slice(0, 4).map(value => {
      const group = value as { name?: string; options?: Array<{ label?: string; extra?: number }> };
      return { name: cleanText(group.name, 30), options: Array.isArray(group.options) ? group.options.slice(0, 8).map(option => ({ label: cleanText(option.label, 50), extra: Math.max(0, Number(option.extra) || 0) })).filter(option => option.label) : [] };
    }).filter(group => group.name && group.options.length) : undefined,
  };
}

function normalizeCategory(value: unknown): ShoppingCategory | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const title = cleanText(record.title, 80);
  const template = SHOPPING_RECOMMENDATION_CATEGORIES.find(category => category.title === title);
  const items = normalizeArray(record.items, normalizeProduct).slice(0, 240);
  if (!title) return null;
  return {
    id: cleanText(record.id, 80) || template?.id || title,
    title,
    subtitle: cleanText(record.subtitle, 160) || template?.subtitle || "",
    items,
  };
}

function normalizeCartItem(value: unknown): ShoppingState["cartItems"][number] | null {
  const product = normalizeProduct(value);
  if (!product || !value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  return {
    ...product,
    tagLabel: product.tagLabel || "购物车",
    quantityLabel: cleanText(record.quantityLabel, 40) || "x 1",
    selectedOptions: Array.isArray(record.selectedOptions) ? record.selectedOptions.map(item => cleanText(item, 50)).slice(0, 8) : undefined,
    unitPrice: Number.isFinite(Number(record.unitPrice)) ? Number(record.unitPrice) : undefined,
  };
}

function normalizeShippingEvent(value: unknown): ShoppingShippingEvent | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const status = cleanText(record.status, 40);
  if (status !== "ordered" && status !== "shipped" && status !== "delivering" && status !== "delivered") return null;
  const timestamp = cleanText(record.timestamp, 80);
  const time = new Date(timestamp);
  if (!timestamp || Number.isNaN(time.getTime())) return null;
  return {
    status,
    label: cleanText(record.label, 80) || "物流更新",
    timeLabel: cleanText(record.timeLabel, 80) || time.toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }),
    timestamp,
  };
}

function normalizeOrder(value: unknown): ShoppingState["orders"][number] | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const id = cleanText(record.id, 180);
  const statusLabel = cleanText(record.statusLabel, 80);
  const timeLabel = cleanText(record.timeLabel, 80);
  const totalLabel = cleanText(record.totalLabel, 80);
  const merchantLabel = cleanText(record.merchantLabel, 120);
  const summary = cleanText(record.summary, 400);
  const items = normalizeArray(record.items, normalizeCartItem);
  const rawPaymentStatus = cleanText(record.paymentStatus, 80);
  const paymentStatus = rawPaymentStatus === "paid_by_user"
    || rawPaymentStatus === "payment_requested"
    || rawPaymentStatus === "paid_by_character"
    || rawPaymentStatus === "payment_declined"
    || rawPaymentStatus === "payment_canceled"
    ? rawPaymentStatus
    : undefined;
  if (!id || !statusLabel || !timeLabel || !totalLabel || !merchantLabel || !summary || items.length === 0) {
    return null;
  }
  return {
    id,
    statusLabel,
    timeLabel,
    totalLabel,
    merchantLabel,
    summary,
    note: cleanText(record.note, 800) || summary,
    items,
    shippingTimeline: normalizeArray(record.shippingTimeline, normalizeShippingEvent).slice(0, 8),
    paymentCardId: cleanText(record.paymentCardId, 120) || undefined,
    paymentCardLabel: cleanText(record.paymentCardLabel, 120) || undefined,
    paymentTransactionId: cleanText(record.paymentTransactionId, 120) || undefined,
    paidAt: cleanText(record.paidAt, 80) || undefined,
    paymentStatus,
    paymentRequestId: cleanText(record.paymentRequestId, 120) || undefined,
    payerCharacterId: cleanText(record.payerCharacterId, 120) || undefined,
    payerCharacterName: cleanText(record.payerCharacterName, 120) || undefined,
    paymentRequestedAt: cleanText(record.paymentRequestedAt, 80) || undefined,
    paymentDeclinedAt: cleanText(record.paymentDeclinedAt, 80) || undefined,
    characterPaidAt: cleanText(record.characterPaidAt, 80) || undefined,
    currency: record.currency ? walletCurrency(record.currency) : undefined,
    mode: record.mode === "food" ? "food" : "shop",
    canceledAt: cleanText(record.canceledAt, 80) || undefined,
    recipientCharacterId: cleanText(record.recipientCharacterId, 120) || undefined,
    recipientAddressId: cleanText(record.recipientAddressId, 120) || undefined,
    recipientName: cleanText(record.recipientName, 120) || undefined,
    recipientAddressLabel: cleanText(record.recipientAddressLabel, 400) || undefined,
    notifyRecipient: record.notifyRecipient === true,
    deliveryNoticeSentAt: cleanText(record.deliveryNoticeSentAt, 80) || undefined,
  };
}

function normalizeSearchResult(value: unknown): ShoppingSearchResult | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const query = cleanText(record.query, 80);
  const items = normalizeArray(record.items, normalizeProduct).slice(0, 30);
  if (!query || items.length === 0) return undefined;
  return {
    query,
    items,
    generatedAt: typeof record.generatedAt === "string" ? record.generatedAt : new Date().toISOString(),
  };
}

export function createDefaultShoppingState(): ShoppingState {
  return {
    catalog: {
      categories: [],
      recommendations: [],
    },
    savedItems: [],
    cartItems: [],
    orders: [],
    settings: {
      refreshPrompt: DEFAULT_SHOPPING_REFRESH_PROMPT,
      searchPrompt: DEFAULT_SHOPPING_SEARCH_PROMPT,
      foodRefreshPrompt: "请生成符合本地区生活习惯、可以即时配送的真实外卖店铺与餐品。",
      foodSearchPrompt: DEFAULT_SHOPPING_SEARCH_PROMPT,
      deliveryMinMinutes: DEFAULT_DELIVERY_MIN_MINUTES,
      deliveryMaxMinutes: DEFAULT_DELIVERY_MAX_MINUTES,
    },
    updatedAt: new Date().toISOString(),
    region: "CN",
    regions: SHOPPING_REGION_PRESETS.map(item => ({ ...item })),
    catalogsByRegion: {},
    foodCatalogsByRegion: {},
    foodSearchResultsByRegion: {},
    customCategories: [],
    dismissedProductKeys: [],
    foodCartItems: [],
    claimedCoupons: [],
    usedCoupons: [],
    addresses: [],
    shipments: [],
  };
}

export function loadShoppingState(): ShoppingState {
  if (typeof window === "undefined") return createDefaultShoppingState();
  try {
    const raw = kvGet(SHOPPING_STATE_KEY);
    if (!raw) return createDefaultShoppingState();
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const catalogRaw = parsed.catalog && typeof parsed.catalog === "object"
      ? parsed.catalog as Record<string, unknown>
      : {};
    const settingsRaw = parsed.settings && typeof parsed.settings === "object"
      ? parsed.settings as Record<string, unknown>
      : {};
    const categories = normalizeArray(catalogRaw.categories, normalizeCategory);
    const legacyRecommendations = normalizeArray(catalogRaw.recommendations, normalizeProduct).slice(0, 60);
    const recommendations = categories.length > 0
      ? categories.flatMap(category => category.items)
      : legacyRecommendations;
    const deliveryMinMinutes = normalizeDeliveryMinutes(settingsRaw.deliveryMinMinutes, DEFAULT_DELIVERY_MIN_MINUTES);
    const deliveryMaxMinutes = normalizeDeliveryMinutes(settingsRaw.deliveryMaxMinutes, DEFAULT_DELIVERY_MAX_MINUTES);
    syncCustomWalletCurrencies();
    const region = cleanText(parsed.region, 5).toUpperCase() || "CN";
    const regions = normalizeShoppingRegions(parsed.regions, region);
    const activeRegion = regions.some(item => item.id === region && item.enabled) ? region : regions.find(item => item.enabled)?.id || "CN";
    const catalogsByRegion: ShoppingState["catalogsByRegion"] = {};
    const foodCatalogsByRegion: ShoppingState["foodCatalogsByRegion"] = {};
    const cached = parsed.catalogsByRegion && typeof parsed.catalogsByRegion === "object" ? parsed.catalogsByRegion as Record<string, unknown> : {};
    for (const key of new Set([...Object.keys(cached), ...Object.keys(parsed.foodCatalogsByRegion && typeof parsed.foodCatalogsByRegion === "object" ? parsed.foodCatalogsByRegion : {})])) {
      const raw = cached[key] && typeof cached[key] === "object" ? cached[key] as Record<string, unknown> : null;
      if (raw) { const categories = normalizeArray(raw.categories, normalizeCategory); catalogsByRegion[key] = { categories, recommendations: categories.flatMap(category => category.items) }; }
      const foodRaw = parsed.foodCatalogsByRegion && typeof parsed.foodCatalogsByRegion === "object" ? (parsed.foodCatalogsByRegion as Record<string, unknown>)[key] : null;
      if (foodRaw && typeof foodRaw === "object") { const categories = normalizeArray((foodRaw as Record<string, unknown>).categories, normalizeCategory); foodCatalogsByRegion[key] = { categories, recommendations: categories.flatMap(category => category.items) }; }
    }
    const addresses: ShoppingAddress[] = Array.isArray(parsed.addresses) ? parsed.addresses.map(value => {
      const a = value as Partial<ShoppingAddress>;
      return { id: cleanText(a.id, 120), ownerId: cleanText(a.ownerId, 120) || undefined, name: cleanText(a.name, 80), phone: cleanText(a.phone, 40), country: cleanText(a.country, 80), city: cleanText(a.city, 100), street: cleanText(a.street, 240), isDefault: a.isDefault === true };
    }).filter(a => a.id && a.name && a.country && a.city && a.street) : [];
    const shipments: ShoppingShipment[] = Array.isArray(parsed.shipments) ? parsed.shipments.map(value => {
      const s = value as Partial<ShoppingShipment>;
      const item = normalizeCartItem(s.item);
      if (!s.id || !item || !s.recipientCharacterId || !s.recipientAddressId || !s.sentAt || !s.deliverAt) return null;
      return { ...s, id: s.id, item, recipientCharacterId: s.recipientCharacterId, recipientAddressId: s.recipientAddressId, recipientName: s.recipientName || "收件人", recipientAddressLabel: s.recipientAddressLabel || "", notifyRecipient: s.notifyRecipient === true, sentAt: s.sentAt, deliverAt: s.deliverAt } as ShoppingShipment;
    }).filter((s): s is ShoppingShipment => Boolean(s)) : [];
    return {
      catalog: {
        categories: categories.length > 0
          ? categories
          : legacyRecommendations.length > 0
            ? [{
              id: "featured",
              title: "精选推荐",
              subtitle: "历史首页推荐",
              items: legacyRecommendations,
            }]
            : [],
        recommendations,
      },
      searchResult: normalizeSearchResult(parsed.searchResult),
      savedItems: normalizeArray(parsed.savedItems, normalizeProduct).slice(0, 80),
      cartItems: normalizeArray(parsed.cartItems, normalizeCartItem).slice(0, 80),
      orders: normalizeArray(parsed.orders, normalizeOrder),
      settings: {
        refreshPrompt: normalizeRefreshPrompt(settingsRaw.refreshPrompt),
        searchPrompt: normalizeSearchPrompt(settingsRaw.searchPrompt),
        foodRefreshPrompt: cleanText(settingsRaw.foodRefreshPrompt, 12000) || "请生成符合本地区生活习惯、可以即时配送的真实外卖店铺与餐品。",
        foodSearchPrompt: cleanText(settingsRaw.foodSearchPrompt, 12000) || DEFAULT_SHOPPING_SEARCH_PROMPT,
        deliveryMinMinutes: Math.min(deliveryMinMinutes, deliveryMaxMinutes),
        deliveryMaxMinutes: Math.max(deliveryMinMinutes, deliveryMaxMinutes),
      },
      generatedAt: typeof parsed.generatedAt === "string" ? parsed.generatedAt : undefined,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
      region: activeRegion, regions, catalogsByRegion, foodCatalogsByRegion,
      foodSearchResultsByRegion: Object.fromEntries(Object.entries(parsed.foodSearchResultsByRegion && typeof parsed.foodSearchResultsByRegion === "object" ? parsed.foodSearchResultsByRegion : {}).map(([key, value]) => [key, normalizeSearchResult(value)]).filter((entry): entry is [string, ShoppingSearchResult] => Boolean(entry[1]))),
      addresses, shipments,
      foodCartItems: normalizeArray(parsed.foodCartItems, normalizeCartItem).slice(0, 80),
      claimedCoupons: Array.isArray(parsed.claimedCoupons) ? parsed.claimedCoupons.map(item => cleanText(item, 30)).filter(Boolean) : [],
      usedCoupons: Array.isArray(parsed.usedCoupons) ? parsed.usedCoupons.map(item => cleanText(item, 30)).filter(Boolean) : [],
      dismissedProductKeys: Array.isArray(parsed.dismissedProductKeys) ? parsed.dismissedProductKeys.map(item => cleanText(item, 450)).filter(Boolean).slice(-400) : [],
      customCategories: Array.isArray(parsed.customCategories) ? parsed.customCategories.map(value => {
        const item = value as Partial<ShoppingCustomCategory>;
        const id = cleanText(item.id, 80), title = cleanText(item.title, 60);
        if (!id || !title) return null;
        return { id, title, subtitle: cleanText(item.subtitle, 160), mode: item.mode === "food" ? "food" : "shop", match: item.match === "brand" || item.match === "store" ? item.match : "type" } as ShoppingCustomCategory;
      }).filter((item): item is ShoppingCustomCategory => Boolean(item)).slice(0, 50) : [],
    };
  } catch {
    return createDefaultShoppingState();
  }
}

export function saveShoppingState(state: ShoppingState): ShoppingState {
  const next = { ...state, updatedAt: new Date().toISOString() };
  kvSet(SHOPPING_STATE_KEY, JSON.stringify(next));
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(SHOPPING_STATE_UPDATED_EVENT));
  }
  return next;
}
