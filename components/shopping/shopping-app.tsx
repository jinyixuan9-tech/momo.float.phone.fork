"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronLeft,
  CreditCard,
  Heart,
  HeartHandshake,
  Home,
  UtensilsCrossed,
  Minus,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  ShoppingCart,
  Star,
  Trash2,
  Truck,
  WalletCards,
  type LucideIcon,
} from "lucide-react";

import { CheckPhoneBilingualText, normalizeCheckPhoneText } from "@/components/checkphone/checkphone-bilingual-text";
import { CheckPhoneDebugErrorCard } from "@/components/checkphone/checkphone-debug-error-card";
import { BlackMarketApp } from "@/components/shopping/black-market-app";
import { ConfirmDialog } from "@/components/ui";
import { splitBilingualText } from "@/lib/bilingual-text";
import { loadCharacters } from "@/lib/character-storage";
import type { Character } from "@/lib/character-types";
import { createOrGetSession, pushChatMessage, loadChatMessages, deleteChatMessagesByIds } from "@/lib/chat-storage";
import {
  DEFAULT_SHOPPING_REFRESH_PROMPT,
  DEFAULT_SHOPPING_SEARCH_PROMPT,
  generateShoppingCatalog,
  buildSelectiveShoppingPrompt,
  generateShoppingSearchResults,
  SHOPPING_RECOMMENDATION_CATEGORIES,
} from "@/lib/shopping-engine";
import {
  buildShoppingPaymentRequestItems,
  createShoppingPaymentRequestId,
  formatShoppingPaymentAmountForHistory,
  formatShoppingPaymentRequestItems,
  type ShoppingPaymentStatus,
} from "@/lib/shopping-payment-request";
import { createDefaultShoppingState, loadShoppingState, saveShoppingState, SHOPPING_STATE_UPDATED_EVENT } from "@/lib/shopping-storage";
import type { ShoppingAddress, ShoppingCartItem, ShoppingCategory, ShoppingOrder, ShoppingProduct, ShoppingRegion, ShoppingShippingEvent, ShoppingState } from "@/lib/shopping-types";
import type { ShoppingCustomCategory, ShoppingMode } from "@/lib/shopping-types";
import { catalogCategoryDefinitions, customCategoryMatches, mergeGeneratedCatalog, productIdentity, removeCatalogProduct } from "@/lib/shopping-catalog";
import { fallbackShippingCity, shoppingRegionConfig, shoppingRegionPrompt } from "@/lib/shopping-regions";
import { announceShoppingGift, shoppingAddressLabel, shoppingDeliveryEstimate, shippingTimelineForOrder, syncShoppingDeliveries } from "@/lib/shopping-delivery";
import { loadDeliveredShoppingGifts, type ShoppingGiftCandidate } from "@/lib/shopping-gift-utils";
import {
  formatWalletAmount,
  getWalletBalance,
  loadWalletState,
  WALLET_CURRENCIES,
  payWithWalletAccount,
  WALLET_BALANCE_ACCOUNT_ID,
  WALLET_UPDATED_EVENT,
  formatCurrencyAmount,
  recordWalletPayment,
  recordWalletCredit,
  saveWalletState,
  getWalletCurrencyBalance,
  exchangeWalletAmount,
  getCustomWalletCurrencies,
  registerCustomWalletCurrency,
} from "@/lib/wallet-storage";
import type { WalletCurrency, WalletState } from "@/lib/wallet-types";

type ShoppingAppProps = {
  onClose: (isBusy?: boolean) => void;
  visible?: boolean;
  onIdle?: () => void;
  onBusyChange?: (isBusy: boolean) => void;
};

type ShoppingTabId = "home" | "food" | "orders" | "cart" | "account" | "items";
type ShoppingSectionSearchTabId = "orders" | "cart" | "account" | "items";

type ShoppingProductDetail = ShoppingProduct & {
  quantityLabel?: string;
  detailLabel?: string;
};

type ShoppingTranslationPreview = {
  original: string;
  translated: string;
};

type ShoppingPromptTab = "refresh" | "search";
type ShoppingSettingsTab = "prompts" | "shipping";

type ShoppingPromptDrafts = {
  refreshPrompt: string;
  searchPrompt: string;
  deliveryMinMinutes: number;
  deliveryMaxMinutes: number;
};

type ShoppingCartFeedback = {
  id: number;
};

type ResolvedShoppingShipping = {
  statusLabel: string;
  currentStage?: ShoppingShippingEvent["status"];
  timeline: ShoppingShippingEvent[];
};

const DEFAULT_DELIVERY_MIN_MINUTES = 60;
const DEFAULT_DELIVERY_MAX_MINUTES = 180;

const SHOPPING_TABS: Array<{ id: ShoppingTabId; label: string; icon: LucideIcon }> = [
  { id: "home", label: "商城", icon: Home },
  { id: "food", label: "外卖", icon: UtensilsCrossed },
  { id: "cart", label: "购物车", icon: ShoppingCart },
  { id: "orders", label: "订单", icon: Truck },
];

const SHOPPING_SECTION_SEARCH_PLACEHOLDERS: Record<ShoppingSectionSearchTabId, string> = {
  orders: "搜索订单",
  cart: "搜索购物车",
  account: "搜索收藏",
  items: "搜索我的物品",
};

function isShoppingSectionSearchTab(tab: ShoppingTabId): tab is ShoppingSectionSearchTabId {
  return tab !== "home" && tab !== "food";
}

function parseShoppingAmount(label: string): number {
  const match = label.replace(/[¥￥元,\s]/g, "").match(/-?\d+(?:\.\d+)?/);
  const amount = match ? Number(match[0]) : 0;
  return Number.isFinite(amount) ? amount : 0;
}

function parseShoppingQuantity(label?: string): number {
  const match = label?.match(/\d+/);
  if (!match) return 1;
  const quantity = Number(match[0]);
  return Number.isFinite(quantity) && quantity >= 0 ? Math.round(quantity) : 1;
}

function formatShoppingAmount(amount: number, currency: WalletCurrency = "CNY"): string {
  if (currency !== "CNY") return formatCurrencyAmount(amount, currency);
  const safeAmount = Number.isFinite(amount) ? Math.max(0, amount) : 0;
  return `¥${Number.isInteger(safeAmount) ? safeAmount : safeAmount.toFixed(2).replace(/\.00$/, "")}`;
}

function formatShoppingDateTime(date: Date): string {
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getWalletCardDisplayNumber(value: string): string {
  const tail = value.replace(/\D/g, "").slice(-4);
  return tail ? `尾号 ${tail}` : value;
}

function getStableShoppingHash(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function normalizeDeliveryMinutes(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(10080, Math.max(1, Math.round(value)));
}

function normalizeShoppingSearchValue(value: string): string {
  return normalizeCheckPhoneText(value).trim().toLowerCase();
}

function isBlackMarketSearchTrigger(value: string): boolean {
  return normalizeShoppingSearchValue(value).replace(/\s+/g, " ") === "black market";
}

function shoppingFieldsMatchSearch(fields: Array<string | undefined>, normalizedQuery: string): boolean {
  if (!normalizedQuery) return true;
  return fields
    .map(field => normalizeShoppingSearchValue(field ?? ""))
    .join(" ")
    .includes(normalizedQuery);
}

function productMatchesSearch(
  item: ShoppingProduct | ShoppingCartItem | ShoppingOrder["items"][number],
  normalizedQuery: string,
): boolean {
  return shoppingFieldsMatchSearch([
    item.title,
    item.merchantLabel,
    item.priceLabel,
    item.subtitle,
    item.detail,
    item.previewIcon,
    "tagLabel" in item ? item.tagLabel : undefined,
    "quantityLabel" in item ? item.quantityLabel : undefined,
  ], normalizedQuery);
}

function orderMatchesSearch(order: ShoppingOrder, normalizedQuery: string, nowMs: number): boolean {
  const shipping = resolveOrderShipping(order, nowMs);
  return shoppingFieldsMatchSearch([
    order.id,
    order.statusLabel,
    shipping.statusLabel,
    order.timeLabel,
    order.totalLabel,
    order.merchantLabel,
    order.summary,
    order.note,
    order.paymentCardLabel,
    order.paidAt,
    ...shipping.timeline.flatMap(event => [event.label, event.timeLabel]),
    ...order.items.flatMap(item => [
      item.title,
      item.merchantLabel,
      item.priceLabel,
      item.quantityLabel,
      item.subtitle,
      item.detail,
      item.previewIcon,
    ]),
  ], normalizedQuery);
}

function normalizeDeliverySettings(settings: Pick<ShoppingState["settings"], "deliveryMinMinutes" | "deliveryMaxMinutes">) {
  const min = normalizeDeliveryMinutes(settings.deliveryMinMinutes, DEFAULT_DELIVERY_MIN_MINUTES);
  const max = normalizeDeliveryMinutes(settings.deliveryMaxMinutes, DEFAULT_DELIVERY_MAX_MINUTES);
  return {
    deliveryMinMinutes: Math.min(min, max),
    deliveryMaxMinutes: Math.max(min, max),
  };
}

function pickShoppingDurationMinutes(orderId: string, minMinutes: number, maxMinutes: number): number {
  const range = Math.max(0, maxMinutes - minMinutes);
  if (range === 0) return minMinutes;
  return minMinutes + (getStableShoppingHash(`${orderId}:delivery`) % (range + 1));
}

function addShoppingMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function buildShippingTimeline(orderId: string, orderedAt: Date, settings: ShoppingState["settings"]): ShoppingShippingEvent[] {
  const deliverySettings = normalizeDeliverySettings(settings);
  const totalMinutes = pickShoppingDurationMinutes(
    orderId,
    deliverySettings.deliveryMinMinutes,
    deliverySettings.deliveryMaxMinutes,
  );
  const shippedOffset = Math.max(1, Math.floor(totalMinutes * 0.18));
  const deliveringOffset = Math.max(shippedOffset, Math.floor(totalMinutes * 0.55));
  const timeline = [
    { status: "ordered" as const, label: "已下单", date: orderedAt },
    { status: "shipped" as const, label: "已发货", date: addShoppingMinutes(orderedAt, Math.min(shippedOffset, totalMinutes)) },
    { status: "delivering" as const, label: "配送中", date: addShoppingMinutes(orderedAt, Math.min(deliveringOffset, totalMinutes)) },
    { status: "delivered" as const, label: "已到货", date: addShoppingMinutes(orderedAt, totalMinutes) },
  ];
  return timeline.map(event => ({
    status: event.status,
    label: event.label,
    timeLabel: formatShoppingDateTime(event.date),
    timestamp: event.date.toISOString(),
  }));
}

function resolveOrderShipping(order: ShoppingOrder, nowMs: number): ResolvedShoppingShipping {
  const timeline = Array.isArray(order.shippingTimeline) ? order.shippingTimeline : [];
  if (timeline.length === 0) {
    return { statusLabel: order.statusLabel, timeline: [] };
  }
  const reached = timeline
    .filter(event => !Number.isNaN(new Date(event.timestamp).getTime()) && new Date(event.timestamp).getTime() <= nowMs)
    .slice(-1)[0];
  if (!reached || reached.status === "ordered") {
    return { statusLabel: "待发货", currentStage: "ordered", timeline };
  }
  return {
    statusLabel: reached.label,
    currentStage: reached.status,
    timeline,
  };
}

function getShoppingRating(product: ShoppingProductDetail): string {
  const seed = `${product.title}:${product.merchantLabel}:${product.priceLabel}`;
  return (4.5 + (getStableShoppingHash(seed) % 6) / 10).toFixed(1);
}

function cartQuantityLabel(quantity: number): string {
  return `× ${Math.max(0, Math.round(quantity))}`;
}

function toProductDetail(
  item: ShoppingProduct | ShoppingCartItem | ShoppingOrder["items"][number],
  defaults?: { tagLabel?: string; quantityLabel?: string; detailLabel?: string },
): ShoppingProductDetail {
  return {
    ...item,
    id: item.id,
    title: item.title,
    merchantLabel: item.merchantLabel,
    priceLabel: item.priceLabel,
    tagLabel: "tagLabel" in item ? item.tagLabel : defaults?.tagLabel ?? "商品",
    subtitle: item.subtitle,
    detail: item.detail,
    previewIcon: item.previewIcon,
    tone: item.tone,
    quantityLabel: "quantityLabel" in item ? item.quantityLabel : defaults?.quantityLabel,
    detailLabel: defaults?.detailLabel ?? "Description",
  };
}

function baseProduct(product: ShoppingProductDetail | ShoppingProduct): ShoppingProduct {
  return {
    ...product,
    id: product.id,
    title: product.title,
    merchantLabel: product.merchantLabel,
    priceLabel: product.priceLabel,
    tagLabel: product.tagLabel,
    subtitle: product.subtitle,
    detail: product.detail,
    previewIcon: product.previewIcon,
    tone: product.tone,
    currency: product.currency,
  };
}

function mergeShoppingProducts(...groups: ShoppingProduct[][]): ShoppingProduct[] {
  const seen = new Set<string>();
  const merged: ShoppingProduct[] = [];

  for (const product of groups.flat()) {
    const key = productIdentity(product);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(product);
  }

  return merged;
}

function productAsCartItem(product: ShoppingProductDetail | ShoppingProduct, quantity = 1): ShoppingCartItem {
  return {
    ...baseProduct(product),
    tagLabel: "购物车",
    quantityLabel: cartQuantityLabel(quantity),
  };
}

function buildOrderFromCart(
  cartItems: ShoppingCartItem[],
  totalLabel: string,
  settings: ShoppingState["settings"],
  options: {
    statusLabel?: string;
    note?: string;
    skipShipping?: boolean;
    paymentStatus?: ShoppingPaymentStatus;
    paymentRequestId?: string;
    payerCharacterId?: string;
    payerCharacterName?: string;
    paymentRequestedAt?: string;
  } = {},
): ShoppingOrder {
  const now = new Date();
  const id = `shop_order_${now.getTime()}_${Math.random().toString(36).slice(2, 7)}`;
  const summaryTitles = cartItems.slice(0, 3).map(item => normalizeCheckPhoneText(item.title));
  const summary = summaryTitles.join("、") + (cartItems.length > 3 ? ` 等 ${cartItems.length} 件商品` : "");
  const merchantLabel = cartItems.length === 1 ? cartItems[0]?.merchantLabel ?? "SHOP" : `${cartItems.length} 件商品`;
  return {
    id,
    statusLabel: options.statusLabel ?? "待发货",
    timeLabel: formatShoppingDateTime(now),
    totalLabel,
    merchantLabel,
    summary,
    note: options.note ?? `已结算购物车中的 ${cartItems.length} 件商品。`,
    shippingTimeline: options.skipShipping ? [] : buildShippingTimeline(id, now, settings),
    paymentStatus: options.paymentStatus,
    paymentRequestId: options.paymentRequestId,
    payerCharacterId: options.payerCharacterId,
    payerCharacterName: options.payerCharacterName,
    paymentRequestedAt: options.paymentRequestedAt,
    items: cartItems.map((item, index) => ({
      ...item,
      id: `${id}_item_${index + 1}`,
      title: item.title,
      merchantLabel: item.merchantLabel,
      priceLabel: item.priceLabel,
      quantityLabel: item.quantityLabel,
      subtitle: item.subtitle,
      detail: item.detail,
      previewIcon: item.previewIcon,
      tone: item.tone,
    })),
  };
}

export function ShoppingApp({ onClose, visible = true, onIdle, onBusyChange }: ShoppingAppProps) {
  const [state, setState] = useState<ShoppingState>(() => createDefaultShoppingState());
  const currentRegion = shoppingRegionConfig(state, state.region);
  const regionConfig = (id: ShoppingRegion) => shoppingRegionConfig(state, id);
  const [loaded, setLoaded] = useState(false);
  const [loadingTask, setLoadingTask] = useState<"refresh" | "search" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [debugRawOutput, setDebugRawOutput] = useState<string | null>(null);
  const [selectedTab, setSelectedTab] = useState<ShoppingTabId>("home");
  const [selectedProduct, setSelectedProduct] = useState<ShoppingProductDetail | null>(null);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [translationPreview, setTranslationPreview] = useState<ShoppingTranslationPreview | null>(null);
  const [promptOpen, setPromptOpen] = useState(false);
  const [promptMode, setPromptMode] = useState<ShoppingMode>("shop");
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<ShoppingSettingsTab>("prompts");
  const [expandedPrompts, setExpandedPrompts] = useState<Set<ShoppingPromptTab>>(new Set());
  const [promptDrafts, setPromptDrafts] = useState<ShoppingPromptDrafts>({
    refreshPrompt: DEFAULT_SHOPPING_REFRESH_PROMPT,
    searchPrompt: DEFAULT_SHOPPING_SEARCH_PROMPT,
    deliveryMinMinutes: DEFAULT_DELIVERY_MIN_MINUTES,
    deliveryMaxMinutes: DEFAULT_DELIVERY_MAX_MINUTES,
  });
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [searchInput, setSearchInput] = useState("");
  const [foodSearchInput, setFoodSearchInput] = useState("");
  const [sectionSearchInputs, setSectionSearchInputs] = useState<Record<ShoppingSectionSearchTabId, string>>({
    orders: "",
    cart: "",
    account: "",
    items: "",
  });
  const [selectedCategoryId, setSelectedCategoryId] = useState("all");
  const [foodCategoryId, setFoodCategoryId] = useState("all");
  const [cartMode, setCartMode] = useState<ShoppingMode>("shop");
  const [selectedShopCurrency, setSelectedShopCurrency] = useState<WalletCurrency | null>(null);
  const [selectedFoodCurrency, setSelectedFoodCurrency] = useState<WalletCurrency | null>(null);
  const [ordersMode, setOrdersMode] = useState<ShoppingMode>("shop");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [regionEditorOpen, setRegionEditorOpen] = useState(false);
  const [newRegionCode, setNewRegionCode] = useState("");
  const [newRegionCountry, setNewRegionCountry] = useState("");
  const [newRegionCurrency, setNewRegionCurrency] = useState("CNY");
  const [newCurrencyRate, setNewCurrencyRate] = useState("");
  const [newCurrencySymbol, setNewCurrencySymbol] = useState("");
  const [currencyRateDrafts, setCurrencyRateDrafts] = useState<Record<string, string>>({});
  const [regionError, setRegionError] = useState("");
  const [refreshPickerOpen, setRefreshPickerOpen] = useState(false);
  const [selectedRefreshIds, setSelectedRefreshIds] = useState<string[]>([]);
  const [categoryEditorOpen, setCategoryEditorOpen] = useState(false);
  const [categoryName, setCategoryName] = useState("");
  const [categoryMatch, setCategoryMatch] = useState<ShoppingCustomCategory["match"]>("store");
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [confirmCatalogDelete, setConfirmCatalogDelete] = useState<ShoppingProduct | null>(null);
  const [selectedVariantOptions, setSelectedVariantOptions] = useState<string[]>([]);
  const [foodCheckoutOpen, setFoodCheckoutOpen] = useState(false);
  const [shippingMethod, setShippingMethod] = useState<"express" | "standard" | "air" | "sea">("express");
  const [cancelOrderCandidate, setCancelOrderCandidate] = useState<ShoppingOrder | null>(null);
  const [recentlyAddedProductId, setRecentlyAddedProductId] = useState<string | null>(null);
  const [cartFeedback, setCartFeedback] = useState<ShoppingCartFeedback | null>(null);
  const [confirmRefreshOpen, setConfirmRefreshOpen] = useState(false);
  const [confirmCheckoutOpen, setConfirmCheckoutOpen] = useState(false);
  const [paymentRequestOpen, setPaymentRequestOpen] = useState(false);
  const [paymentRequestTargets, setPaymentRequestTargets] = useState<Character[]>([]);
  const [selectedPaymentRequestTargetId, setSelectedPaymentRequestTargetId] = useState("");
  const [paymentRequestError, setPaymentRequestError] = useState<string | null>(null);
  const [confirmCartDeleteItemId, setConfirmCartDeleteItemId] = useState<string | null>(null);
  const [walletState, setWalletState] = useState<WalletState>(() => loadWalletState());
  const [selectedPaymentSourceId, setSelectedPaymentSourceId] = useState<string>(WALLET_BALANCE_ACCOUNT_ID);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [recipientId, setRecipientId] = useState("");
  const [recipientAddressId, setRecipientAddressId] = useState("");
  const [senderAddressId, setSenderAddressId] = useState("");
  const [notifyRecipient, setNotifyRecipient] = useState(true);
  const [addressOpen, setAddressOpen] = useState(false);
  const [addressOwnerId, setAddressOwnerId] = useState("");
  const [addressDraft, setAddressDraft] = useState({ name: "", phone: "", country: "", city: "", street: "" });
  const [shipGift, setShipGift] = useState<ShoppingGiftCandidate | null>(null);
  const [blackMarketOpen, setBlackMarketOpen] = useState(false);
  const [blackMarketTransition, setBlackMarketTransition] = useState(false);
  const cartFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cartPulseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blackMarketTransitionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shoppingScrollRef = useRef<HTMLDivElement | null>(null);
  const scrollRestoreFrameRef = useRef<number | null>(null);
  const wasVisibleRef = useRef(visible);

  useEffect(() => {
    const loadedState = loadShoppingState();
    setState(loadedState);
    setPromptDrafts({
      refreshPrompt: loadedState.settings.refreshPrompt,
      searchPrompt: loadedState.settings.searchPrompt,
      deliveryMinMinutes: loadedState.settings.deliveryMinMinutes,
      deliveryMaxMinutes: loadedState.settings.deliveryMaxMinutes,
    });
    setSearchInput("");
    setLoaded(true);
    syncShoppingDeliveries();
  }, []);

  useEffect(() => {
    if (!state.orders.length && !state.shipments.length) return;
    const timer = window.setInterval(syncShoppingDeliveries, 30000);
    return () => window.clearInterval(timer);
  }, [state.orders.length, state.shipments.length]);

  useEffect(() => {
    if (visible && !wasVisibleRef.current) {
      setSearchInput("");
    }
    wasVisibleRef.current = visible;
  }, [visible]);

  useEffect(() => {
    const handleShoppingStateUpdated = () => {
      setState(loadShoppingState());
    };
    window.addEventListener(SHOPPING_STATE_UPDATED_EVENT, handleShoppingStateUpdated);
    return () => window.removeEventListener(SHOPPING_STATE_UPDATED_EVENT, handleShoppingStateUpdated);
  }, []);

  useEffect(() => () => {
    if (cartFeedbackTimerRef.current) {
      clearTimeout(cartFeedbackTimerRef.current);
    }
    if (cartPulseTimerRef.current) {
      clearTimeout(cartPulseTimerRef.current);
    }
    if (blackMarketTransitionTimerRef.current) {
      clearTimeout(blackMarketTransitionTimerRef.current);
    }
    if (scrollRestoreFrameRef.current !== null) {
      window.cancelAnimationFrame(scrollRestoreFrameRef.current);
    }
  }, []);

  useEffect(() => {
    const syncWallet = () => {
      const next = loadWalletState();
      setWalletState(next);
      setSelectedPaymentSourceId(current => current === WALLET_BALANCE_ACCOUNT_ID || (current === "wallet_credit_card" && next.creditEnabled)
        ? current
        : WALLET_BALANCE_ACCOUNT_ID);
    };
    syncWallet();
    window.addEventListener(WALLET_UPDATED_EVENT, syncWallet);
    return () => window.removeEventListener(WALLET_UPDATED_EVENT, syncWallet);
  }, []);

  useEffect(() => {
    if (state.orders.length === 0 && state.shipments.length === 0) return;
    setNowTick(Date.now());
    const timer = window.setInterval(() => setNowTick(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, [state.orders.length, state.shipments.length]);

  function persist(updater: (current: ShoppingState) => ShoppingState) {
    setState(current => saveShoppingState(updater(current)));
  }

  const activeOrder = useMemo(
    () => state.orders.find(order => order.id === selectedOrderId) ?? null,
    [selectedOrderId, state.orders],
  );

  const cartCurrency = selectedShopCurrency && state.cartItems.some(item => (item.currency || "CNY") === selectedShopCurrency) ? selectedShopCurrency : state.cartItems[0]?.currency || currentRegion.currency;
  const foodCurrency = selectedFoodCurrency && state.foodCartItems.some(item => (item.currency || "CNY") === selectedFoodCurrency) ? selectedFoodCurrency : state.foodCartItems[0]?.currency || currentRegion.currency;
  const checkoutCartItems = state.cartItems.filter(item => (item.currency || "CNY") === cartCurrency);
  const checkoutFoodItems = state.foodCartItems.filter(item => (item.currency || "CNY") === foodCurrency);
  const cartTotals = useMemo(() => {
    const orderAmount = checkoutCartItems.reduce(
      (sum, item) => sum + parseShoppingAmount(item.priceLabel) * parseShoppingQuantity(item.quantityLabel),
      0,
    );
    return { orderAmount, totalPayment: orderAmount };
  }, [state.cartItems, cartCurrency]);
  const foodTotal = checkoutFoodItems.reduce((sum, item) => sum + (item.unitPrice ?? parseShoppingAmount(item.priceLabel)) * parseShoppingQuantity(item.quantityLabel), 0);
  const foodPayable = foodTotal;
  const shopperAddresses = state.addresses.filter(address => !address.ownerId);
  const recipientAddresses = state.addresses.filter(address => address.ownerId === recipientId);
  const currentRecipientAddress = recipientAddresses.find(address => address.id === recipientAddressId) || recipientAddresses[0];
  const ownerName = loadCharacters().find(person => person.id === recipientId)?.name;
  const deliveryFrom = shopperAddresses.find(address => address.id === senderAddressId) || shopperAddresses[0];
  const firstCartProduct = checkoutCartItems[0];
  const storeCountry = firstCartProduct?.shippingCountry || state.regions.find(item => item.currency === cartCurrency)?.country || currentRegion.country;
  const storeAddress: ShoppingAddress = { country: storeCountry, city: firstCartProduct?.shippingCity || fallbackShippingCity(storeCountry, state.regions.find(item => item.currency === cartCurrency)?.id || state.region, firstCartProduct?.id), street: "", name: "商家", phone: "", id: "store" };
  const checkoutAddress = recipientId ? currentRecipientAddress : deliveryFrom;
  const internationalShipping = Boolean(checkoutAddress && checkoutCartItems.some(item => checkoutAddress.country !== (item.shippingCountry || storeCountry)));
  const effectiveShippingMethod = internationalShipping ? (shippingMethod === "sea" ? "sea" : "air") : (shippingMethod === "standard" ? "standard" : "express");
  const deliveryEstimate = checkoutAddress ? (() => {
    const parcels = new Map<string, ShoppingAddress>();
    for (const item of checkoutCartItems) {
      const country = item.shippingCountry || storeCountry;
      const city = item.shippingCity || fallbackShippingCity(country, state.regions.find(region => region.country === country)?.id || state.region, item.id);
      parcels.set(`${item.merchantLabel}:${country}:${city}`, { ...storeAddress, country, city });
    }
    const estimates = [...parcels.values()].map(origin => shoppingDeliveryEstimate(origin, checkoutAddress, effectiveShippingMethod));
    return { days: Math.max(0, ...estimates.map(item => item.days)), fee: estimates.reduce((sum, item) => sum + item.fee, 0) };
  })() : null;
  const shippingFee = deliveryEstimate ? exchangeWalletAmount(deliveryEstimate.fee, "CNY", cartCurrency) : 0;
  const checkoutTotal = Math.max(0, cartTotals.totalPayment + shippingFee);
  const warehouseGifts = selectedTab === "items" ? loadDeliveredShoppingGifts() : [];
  const selectedPaymentSource = useMemo(() => selectedPaymentSourceId === "wallet_credit_card" && walletState.creditEnabled
    ? { id: "wallet_credit_card", title: "信用卡", balance: 0, description: "跨币种消费，之后从储蓄卡还款" }
    : { id: WALLET_BALANCE_ACCOUNT_ID, title: "储蓄卡", balance: getWalletCurrencyBalance(walletState, cartCurrency), description: `${walletState.cards[0]?.bankLabel || "储蓄卡"} · ${walletState.cards[0]?.maskedNumber || ""}` },
  [selectedPaymentSourceId, walletState, cartCurrency]);
  const selectedPaymentSourceCanPay = selectedPaymentSource.id === "wallet_credit_card" ||
    getWalletCurrencyBalance(walletState, cartCurrency) >= checkoutTotal ||
    WALLET_CURRENCIES.some(currency => getWalletCurrencyBalance(walletState, currency) >= exchangeWalletAmount(checkoutTotal, cartCurrency, currency));

  const savedIds = useMemo(() => new Set(state.savedItems.map(item => item.id)), [state.savedItems]);
  const cartIds = useMemo(() => new Set(state.cartItems.map(item => item.id)), [state.cartItems]);
  const loading = loadingTask !== null;
  const loadingLabel = loadingTask === "search" ? "正在搜索新物品" : "正在刷新商品";
  const catalogCategories: ShoppingCategory[] = state.catalog.categories.length > 0
    ? state.catalog.categories
    : state.catalog.recommendations.length > 0
      ? [{ id: "featured", title: "精选推荐", subtitle: "为你推荐", items: state.catalog.recommendations }]
      : [];
  const currentMode: ShoppingMode = selectedTab === "food" ? "food" : "shop";
  const currentDefinitions = catalogCategoryDefinitions(currentMode, state.region, state.customCategories);
  const foodCategories = state.foodCatalogsByRegion[state.region]?.categories || [];
  const visibleFoodCategories = foodCategoryId === "all" ? foodCategories : foodCategories.filter(category => category.id === foodCategoryId);
  const foodSearchResult = state.foodSearchResultsByRegion[state.region];
  const foodProducts = foodCategoryId === "food_search" ? foodSearchResult?.items || [] : foodCategoryId === "all" ? mergeShoppingProducts(foodSearchResult?.items || [], state.foodCatalogsByRegion[state.region]?.recommendations || [], ...visibleFoodCategories.map(category => category.items)) : mergeShoppingProducts(...visibleFoodCategories.map(category => category.items));
  const visibleCatalogCategories = selectedCategoryId === "all"
    ? catalogCategories
    : catalogCategories.filter(category => category.id === selectedCategoryId || category.title === selectedCategoryId);
  const searchResultProducts = state.searchResult?.items ?? [];
  const allCatalogProducts = mergeShoppingProducts(searchResultProducts, state.catalog.recommendations, catalogCategories.flatMap(category => category.items));
  const normalizedHomeSearchQuery = normalizeShoppingSearchValue(searchInput);
  const filteredAllCatalogProducts = normalizedHomeSearchQuery
    ? allCatalogProducts.filter(item => productMatchesSearch(item, normalizedHomeSearchQuery))
    : allCatalogProducts;
  const hasSearchResults = Boolean(state.searchResult?.items.length);
  const hasVisibleSearchResults = selectedCategoryId === "search" && hasSearchResults;
  const hasVisibleHomeProducts = selectedCategoryId === "all"
    ? filteredAllCatalogProducts.length > 0
    : visibleCatalogCategories.some(category => category.items.length > 0);
  const hasVisibleHomeContent = hasVisibleSearchResults || hasVisibleHomeProducts;
  const selectedCategoryLabel = selectedCategoryId === "all"
    ? "全部"
    : selectedCategoryId === "search"
      ? `搜索：${state.searchResult?.query ?? ""}`
      : SHOPPING_RECOMMENDATION_CATEGORIES.find(category => category.id === selectedCategoryId)?.title ?? "该分类";
  const emptyHomeTitle = selectedCategoryId === "all"
    ? normalizedHomeSearchQuery
      ? `暂无“${searchInput.trim()}”相关已有商品`
      : "暂无商品内容"
    : selectedCategoryId === "search"
      ? `暂无“${state.searchResult?.query ?? searchInput.trim()}”相关商品`
      : `暂无${selectedCategoryLabel}商品`;
  const emptyHomeHint = selectedCategoryId === "search"
    ? "可换个关键词搜索，或点刷新生成分类推荐"
    : selectedCategoryId === "all"
      ? normalizedHomeSearchQuery
        ? "可点击搜索新物品生成相关商品，或换个关键词"
        : "可搜索商品，或点刷新生成分类推荐"
      : "可切回全部，或点刷新生成分类推荐";
  const activeOrderShipping = activeOrder ? resolveOrderShipping(activeOrder, nowTick) : null;
  const normalizedCartSearchQuery = normalizeShoppingSearchValue(sectionSearchInputs.cart);
  const normalizedOrderSearchQuery = normalizeShoppingSearchValue(sectionSearchInputs.orders);
  const normalizedSavedSearchQuery = normalizeShoppingSearchValue(sectionSearchInputs.account);
  const filteredCartItems = useMemo(
    () => state.cartItems.filter(item => productMatchesSearch(item, normalizedCartSearchQuery)),
    [normalizedCartSearchQuery, state.cartItems],
  );
  const filteredOrders = useMemo(
    () => state.orders.filter(order => orderMatchesSearch(order, normalizedOrderSearchQuery, nowTick)),
    [normalizedOrderSearchQuery, nowTick, state.orders],
  );
  const filteredSavedItems = useMemo(
    () => state.savedItems.filter(item => productMatchesSearch(item, normalizedSavedSearchQuery)),
    [normalizedSavedSearchQuery, state.savedItems],
  );

  useEffect(() => {
    onBusyChange?.(loading);
    if (!visible && !loading) {
      onIdle?.();
    }
  }, [loading, visible, onBusyChange, onIdle]);

  function resetShoppingScroll() {
    const scrollEl = shoppingScrollRef.current;
    if (!scrollEl) return;
    if (scrollRestoreFrameRef.current !== null) {
      window.cancelAnimationFrame(scrollRestoreFrameRef.current);
      scrollRestoreFrameRef.current = null;
    }
    scrollEl.style.overflowY = "hidden";
    scrollEl.scrollTop = 0;
    scrollRestoreFrameRef.current = window.requestAnimationFrame(() => {
      scrollRestoreFrameRef.current = null;
      scrollEl.style.removeProperty("overflow-y");
    });
  }

  useLayoutEffect(() => {
    resetShoppingScroll();
  }, [selectedTab]);

  function selectShoppingTab(tabId: ShoppingTabId) {
    resetShoppingScroll();
    setTranslationPreview(null);
    setSelectedTab(tabId);
  }

  function openRefreshPicker() {
    const mode: ShoppingMode = selectedTab === "food" ? "food" : "shop";
    const activeId = mode === "food" ? foodCategoryId : selectedCategoryId;
    setSelectedRefreshIds(activeId !== "all" && activeId !== "search" ? [activeId] : []);
    setRefreshPickerOpen(true);
  }

  async function handleRefresh(ids: string[], mode: ShoppingMode) {
    if (loading || !ids.length) return;
    const region = state.region;
    const allDefinitions = catalogCategoryDefinitions(mode, region, state.customCategories);
    const chosen = allDefinitions.filter(category => ids.includes(category.id)).slice(0, 36);
    if (!chosen.length) return;
    setRefreshPickerOpen(false);
    setLoadingTask("refresh");
    setError(null);
    setDebugRawOutput(null);
    const currentCatalog = mode === "food" ? state.foodCatalogsByRegion[region] : state.catalog;
    const existing = [...(currentCatalog?.recommendations || []).map(item => `${item.merchantLabel} ${item.title}`), ...state.dismissedProductKeys];
    const prompt = buildSelectiveShoppingPrompt(mode === "food" ? state.settings.foodRefreshPrompt : state.settings.refreshPrompt, chosen, mode, state.customCategories, shoppingRegionPrompt(regionConfig(region)), existing);
    const result = await generateShoppingCatalog(prompt, chosen);
    if (result.catalog) {
      const generatedCategories = result.catalog.categories.map(category => ({ ...category, items: category.items.filter(item => { const rule = state.customCategories.find(custom => custom.id === category.id); return !rule || customCategoryMatches(rule, item); }).slice(0, Math.min(6, Math.floor(36 / chosen.length))).map(item => ({ ...item, currency: regionConfig(region).currency, regionId: region, mode, ...(mode === "shop" ? { shippingCountry: regionConfig(region).country, shippingCity: item.shippingCity || fallbackShippingCity(regionConfig(region).country, region, item.id) } : {}) })) }));
      const generated = { categories: generatedCategories, recommendations: generatedCategories.flatMap(category => category.items) };
      persist(current => ({
        ...current,
        ...(mode === "shop" ? (() => {
          const catalog = mergeGeneratedCatalog(current.catalogsByRegion[region] || current.catalog, generated, catalogCategoryDefinitions(mode, region, current.customCategories), current.customCategories.filter(item => item.mode === mode), current.dismissedProductKeys);
          return { catalog: current.region === region ? catalog : current.catalog, catalogsByRegion: { ...current.catalogsByRegion, [region]: catalog } };
        })() : (() => {
          const catalog = mergeGeneratedCatalog(current.foodCatalogsByRegion[region] || { categories: [], recommendations: [] }, generated, catalogCategoryDefinitions(mode, region, current.customCategories), current.customCategories.filter(item => item.mode === mode), current.dismissedProductKeys);
          return { foodCatalogsByRegion: { ...current.foodCatalogsByRegion, [region]: catalog } };
        })()),
        generatedAt: new Date().toISOString(),
      }));
      setSelectedProduct(null);
      setSelectedOrderId(null);
      setTranslationPreview(null);
    }
    setError(result.error ?? null);
    setDebugRawOutput(result.rawOutput ?? null);
    setLoadingTask(null);
    setLoaded(true);
  }

  function saveCustomCategory() {
    const title = categoryName.trim().slice(0, 32);
    if (!title) return;
    const mode = currentMode;
    const existing = catalogCategoryDefinitions(mode, state.region, state.customCategories).find(item => item.title.toLocaleLowerCase() === title.toLocaleLowerCase() && item.id !== editingCategoryId);
    if (existing) { setError("这个分类已经存在。"); return; }
    const id = editingCategoryId || `custom_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const custom: ShoppingCustomCategory = { id, title, subtitle: categoryMatch === "store" ? "店铺专门入口" : categoryMatch === "brand" ? "品牌专门入口" : "自定义品类", match: categoryMatch, mode };
    persist(current => {
      const customCategories = [...current.customCategories.filter(item => item.id !== id), custom];
      const definitions = catalogCategoryDefinitions(mode, current.region, customCategories);
      const source = mode === "food" ? current.foodCatalogsByRegion[current.region] || { categories: [], recommendations: [] } : current.catalog;
      const previous = editingCategoryId ? { ...source, categories: source.categories.map(item => item.id === editingCategoryId ? { ...item, items: [] } : item) } : source;
      const catalog = mergeGeneratedCatalog(previous, { categories: [], recommendations: [] }, definitions, customCategories.filter(item => item.mode === mode), current.dismissedProductKeys);
      return mode === "shop" ? { ...current, customCategories, catalog, catalogsByRegion: { ...current.catalogsByRegion, [current.region]: catalog } } : { ...current, customCategories, foodCatalogsByRegion: { ...current.foodCatalogsByRegion, [current.region]: catalog } };
    });
    if (mode === "food") setFoodCategoryId(id); else setSelectedCategoryId(id);
    setEditingCategoryId(null);
    setCategoryEditorOpen(false);
    setCategoryName("");
  }

  function deleteCustomCategory(id: string) {
    persist(current => ({ ...current, customCategories: current.customCategories.filter(item => item.id !== id), catalog: { ...current.catalog, categories: current.catalog.categories.filter(item => item.id !== id) }, catalogsByRegion: Object.fromEntries(Object.entries(current.catalogsByRegion).filter((entry): entry is [string, NonNullable<typeof entry[1]>] => Boolean(entry[1])).map(([region, catalog]) => [region, { ...catalog, categories: catalog.categories.filter(item => item.id !== id) }])), foodCatalogsByRegion: Object.fromEntries(Object.entries(current.foodCatalogsByRegion).filter((entry): entry is [string, NonNullable<typeof entry[1]>] => Boolean(entry[1])).map(([region, catalog]) => [region, { ...catalog, categories: catalog.categories.filter(item => item.id !== id) }])) }));
    setSelectedCategoryId("all"); setFoodCategoryId("all"); setCategoryEditorOpen(false);
  }

  function deleteCatalogProduct(item: ShoppingProduct) {
    const key = productIdentity(item);
    persist(current => ({ ...current,
      dismissedProductKeys: [...new Set([...current.dismissedProductKeys, key])].slice(-400),
      catalog: removeCatalogProduct(current.catalog, item),
      catalogsByRegion: Object.fromEntries(Object.entries(current.catalogsByRegion).filter((entry): entry is [string, NonNullable<typeof entry[1]>] => Boolean(entry[1])).map(([region, catalog]) => [region, removeCatalogProduct(catalog, item)])),
      foodCatalogsByRegion: Object.fromEntries(Object.entries(current.foodCatalogsByRegion).filter((entry): entry is [string, NonNullable<typeof entry[1]>] => Boolean(entry[1])).map(([region, catalog]) => [region, removeCatalogProduct(catalog, item)])),
      foodSearchResultsByRegion: Object.fromEntries(Object.entries(current.foodSearchResultsByRegion).filter((entry): entry is [string, NonNullable<typeof entry[1]>] => Boolean(entry[1])).map(([region, result]) => [region, { ...result, items: result.items.filter(found => productIdentity(found) !== key) }])),
      searchResult: current.searchResult ? { ...current.searchResult, items: current.searchResult.items.filter(found => productIdentity(found) !== key) } : undefined,
    }));
    setConfirmCatalogDelete(null);
    setSelectedProduct(null);
  }

  function enterBlackMarketFromSearch() {
    if (blackMarketTransition) return;
    if (blackMarketTransitionTimerRef.current) {
      clearTimeout(blackMarketTransitionTimerRef.current);
    }
    setBlackMarketTransition(true);
    setSelectedCategoryId("all");
    setSelectedProduct(null);
    setSelectedOrderId(null);
    setTranslationPreview(null);
    setError(null);
    setDebugRawOutput(null);
    blackMarketTransitionTimerRef.current = setTimeout(() => {
      setSearchInput("");
      setBlackMarketTransition(false);
      setBlackMarketOpen(true);
      blackMarketTransitionTimerRef.current = null;
    }, 920);
  }

  async function handleSearch(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const mode = selectedTab === "food" ? "food" : "shop";
    const query = (mode === "food" ? foodSearchInput : searchInput).trim();
    if (!query || loading || blackMarketTransition) return;
    if (mode === "shop" && isBlackMarketSearchTrigger(query)) {
      enterBlackMarketFromSearch();
      return;
    }
    setLoadingTask("search");
    setError(null);
    setDebugRawOutput(null);
    const region = state.region;
    const result = await generateShoppingSearchResults(query, `${mode === "food" ? `${state.settings.foodSearchPrompt}\n你正在为外卖应用搜索可即时配送的食物或商品。只生成符合搜索词的真实当地店铺和餐品，品类、说明、规格均用中文。` : state.settings.searchPrompt}\n\n地区模式：${shoppingRegionPrompt(regionConfig(region))}\n店铺和品牌用真实存在的名称；款式和系列可合理虚构，但不编造著名产品的错误代际。[名称]保留品牌原文并用中文写商品品类和型号；[分类][说明][详情][规格]及选项名用中文。可附 [品牌] 和 [规格] 字段，规格格式：容量:小+0|大+5；价格和加价使用本地币种。${mode === "shop" ? `每件商品增加 [发货国家]${regionConfig(region).country} 和 [发货城市]该地区真实存在的城市。` : "外卖不用发货地。"}`);
    if (result.result) {
      persist(current => {
        const items = result.result!.items.map(item => ({ ...item, currency: regionConfig(region).currency, regionId: region, mode: mode as ShoppingMode, ...(mode === "shop" ? { shippingCountry: regionConfig(region).country, shippingCity: item.shippingCity || fallbackShippingCity(regionConfig(region).country, region, item.id) } : {}) })).filter(item => !current.dismissedProductKeys.includes(productIdentity(item)));
        if (mode === "food") return { ...current, foodSearchResultsByRegion: { ...current.foodSearchResultsByRegion, [region]: { ...result.result!, items } } };
        const previous = current.catalogsByRegion[region] || current.catalog;
        const catalog = mergeGeneratedCatalog({ ...previous, recommendations: mergeShoppingProducts(previous.recommendations, items) }, { categories: [], recommendations: [] }, catalogCategoryDefinitions("shop", region, current.customCategories), current.customCategories.filter(item => item.mode === "shop"), current.dismissedProductKeys);
        return { ...current, searchResult: { ...result.result!, items }, catalog: current.region === region ? catalog : current.catalog, catalogsByRegion: { ...current.catalogsByRegion, [region]: catalog } };
      });
      if (mode === "food") setFoodCategoryId("food_search"); else setSelectedCategoryId("search");
      setSelectedProduct(null);
      setSelectedOrderId(null);
      setTranslationPreview(null);
    }
    setError(result.error ?? null);
    setDebugRawOutput(result.rawOutput ?? null);
    setLoadingTask(null);
    setLoaded(true);
  }

  function handleSavePrompt() {
    const deliverySettings = normalizeDeliverySettings(promptDrafts);
    persist(current => ({
      ...current,
      settings: {
        ...current.settings,
        ...(promptMode === "shop" ? { refreshPrompt: promptDrafts.refreshPrompt.trim() || DEFAULT_SHOPPING_REFRESH_PROMPT, searchPrompt: promptDrafts.searchPrompt.trim() || DEFAULT_SHOPPING_SEARCH_PROMPT } : { foodRefreshPrompt: promptDrafts.refreshPrompt.trim() || "请生成真实外卖商品。", foodSearchPrompt: promptDrafts.searchPrompt.trim() || DEFAULT_SHOPPING_SEARCH_PROMPT }),
        ...deliverySettings,
      },
    }));
    setPromptOpen(false);
  }

  function clearAllShoppingTraces() {
    // 保留设置（提示词/配送时间），其余全部重置：商城目录、搜索结果、收藏与喜欢、购物车、订单
    persist(current => ({ ...createDefaultShoppingState(), settings: current.settings, regions: current.regions, region: current.region, addresses: current.addresses,
      shipments: current.shipments, orders: current.orders.filter(order => Boolean(order.recipientCharacterId && !order.deliveryNoticeSentAt)) }));
    setSelectedProduct(null);
    setSelectedOrderId(null);
    setSelectedTab("home");
    setSelectedCategoryId("all");
    setSectionSearchInputs({ orders: "", cart: "", account: "", items: "" });
    setClearConfirmOpen(false);
  }

  function openPromptSettings(mode: ShoppingMode = "shop") {
    setPromptMode(mode);
    setSettingsTab("prompts");
    setExpandedPrompts(new Set());
    setPromptDrafts({
      refreshPrompt: mode === "food" ? state.settings.foodRefreshPrompt : state.settings.refreshPrompt,
      searchPrompt: mode === "food" ? state.settings.foodSearchPrompt : state.settings.searchPrompt,
      deliveryMinMinutes: state.settings.deliveryMinMinutes,
      deliveryMaxMinutes: state.settings.deliveryMaxMinutes,
    });
    setPromptOpen(true);
  }

  function updatePromptDraft(tab: ShoppingPromptTab, value: string) {
    const key = tab === "refresh" ? "refreshPrompt" : "searchPrompt";
    setPromptDrafts(current => ({ ...current, [key]: value }));
  }

  function resetPromptDraft() {
    setPromptDrafts(current => ({
      ...current,
      refreshPrompt: promptMode === "food" ? "请生成符合本地区生活习惯、可以即时配送的真实外卖店铺与餐品。" : DEFAULT_SHOPPING_REFRESH_PROMPT,
      searchPrompt: DEFAULT_SHOPPING_SEARCH_PROMPT,
    }));
  }

  function updateDeliveryDraft(key: "deliveryMinMinutes" | "deliveryMaxMinutes", value: string) {
    const amount = Number(value);
    setPromptDrafts(current => ({
      ...current,
      [key]: normalizeDeliveryMinutes(amount, key === "deliveryMinMinutes" ? DEFAULT_DELIVERY_MIN_MINUTES : DEFAULT_DELIVERY_MAX_MINUTES),
    }));
  }

  function resetDeliveryDraft() {
    setPromptDrafts(current => ({
      ...current,
      deliveryMinMinutes: DEFAULT_DELIVERY_MIN_MINUTES,
      deliveryMaxMinutes: DEFAULT_DELIVERY_MAX_MINUTES,
    }));
  }

  function toggleSave(product: ShoppingProductDetail | ShoppingProduct) {
    const item = baseProduct(product);
    persist(current => {
      const exists = current.savedItems.some(saved => saved.id === item.id);
      return {
        ...current,
        savedItems: exists
          ? current.savedItems.filter(saved => saved.id !== item.id)
          : [{ ...item, tagLabel: "收藏" }, ...current.savedItems],
      };
    });
  }

  function addToCart(product: ShoppingProductDetail | ShoppingProduct) {
    const mode: ShoppingMode = product.mode === "food" ? "food" : "shop";
    const options = product.variantGroups?.map((group, index) => group.options.find(option => option.label === selectedVariantOptions[index]) || group.options[0]);
    const surcharge = options?.reduce((sum, option) => sum + (option?.extra || 0), 0) || 0;
    const item = { ...baseProduct(product), currency: product.currency || currentRegion.currency, mode, selectedOptions: options?.map(option => option?.label || "") || [], unitPrice: parseShoppingAmount(product.priceLabel) + surcharge };
    const cart = mode === "food" ? state.foodCartItems : state.cartItems;
    if (mode === "food" && cart.some(entry => (entry.currency || "CNY") === item.currency && entry.merchantLabel !== item.merchantLabel)) { setError("同一币种的外卖购物车一次只能结算同一家店。"); return; }
    persist(current => {
      const key = `${item.currency}:${item.id}:${item.selectedOptions.join("|")}`;
      const existingCart = mode === "food" ? current.foodCartItems : current.cartItems;
      const exists = existingCart.find(cartItem => cartItem.id === key);
      const nextCart = exists
        ? existingCart.map(cartItem => cartItem.id === key ? { ...cartItem, quantityLabel: cartQuantityLabel(parseShoppingQuantity(cartItem.quantityLabel) + 1) } : cartItem)
        : [{ ...productAsCartItem(item), id: key, priceLabel: formatCurrencyAmount(item.unitPrice, item.currency), selectedOptions: item.selectedOptions, unitPrice: item.unitPrice }, ...existingCart];
      return {
        ...current,
        ...(mode === "food" ? { foodCartItems: nextCart } : { cartItems: nextCart }),
      };
    });
    if (cartFeedbackTimerRef.current) {
      clearTimeout(cartFeedbackTimerRef.current);
    }
    if (cartPulseTimerRef.current) {
      clearTimeout(cartPulseTimerRef.current);
    }
    setRecentlyAddedProductId(item.id);
    setCartFeedback({
      id: Date.now(),
    });
    cartPulseTimerRef.current = setTimeout(() => {
      setRecentlyAddedProductId(current => current === item.id ? null : current);
    }, 650);
    cartFeedbackTimerRef.current = setTimeout(() => {
      setCartFeedback(null);
    }, 1700);
  }

  function changeCartQuantity(itemId: string, delta: number) {
    persist(current => ({
      ...current,
      cartItems: current.cartItems
        .map(item => {
          if (item.id !== itemId) return item;
          const quantity = parseShoppingQuantity(item.quantityLabel) + delta;
          return { ...item, quantityLabel: cartQuantityLabel(quantity) };
        })
        .filter(item => parseShoppingQuantity(item.quantityLabel) > 0),
    }));
  }

  function removeCartItem(itemId: string) {
    persist(current => ({
      ...current,
      cartItems: current.cartItems.filter(item => item.id !== itemId),
    }));
  }

  function confirmRemoveCartItem() {
    if (!confirmCartDeleteItemId) return;
    removeCartItem(confirmCartDeleteItemId);
    setConfirmCartDeleteItemId(null);
  }

  function openCheckoutSheet() {
    if (checkoutCartItems.length === 0) return;
    const nextWalletState = loadWalletState();
    setWalletState(nextWalletState);
    setSelectedPaymentSourceId(WALLET_BALANCE_ACCOUNT_ID);
    setPaymentError(null);
    setRecipientId("");
    setRecipientAddressId("");
    setConfirmCheckoutOpen(true);
  }

  function switchRegion(region: ShoppingRegion) {
    if (!state.regions.some(item => item.id === region && item.enabled)) return;
    if (region === state.region) return;
    persist(current => ({ ...current, region, catalog: current.catalogsByRegion[region] || { categories: [], recommendations: [] },
      catalogsByRegion: { ...current.catalogsByRegion, [current.region]: current.catalog }, searchResult: undefined }));
    setSelectedCategoryId("all");
    setFoodCategoryId("all");
    setSelectedProduct(null);
    setSearchInput("");
    setFoodSearchInput("");
  }

  function toggleShoppingRegion(id: string) {
    if (state.region === id && state.regions.find(item => item.id === id)?.enabled) { setSelectedCategoryId("all"); setFoodCategoryId("all"); setSearchInput(""); setFoodSearchInput(""); }
    persist(current => {
      const regions = current.regions.map(item => item.id === id ? { ...item, enabled: !item.enabled } : item);
      if (!regions.some(item => item.enabled)) return current;
      const nextRegion = regions.some(item => item.id === current.region && item.enabled) ? current.region : regions.find(item => item.enabled)!.id;
      return { ...current, regions, region: nextRegion, catalog: nextRegion === current.region ? current.catalog : current.catalogsByRegion[nextRegion] || { categories: [], recommendations: [] }, catalogsByRegion: nextRegion === current.region ? current.catalogsByRegion : { ...current.catalogsByRegion, [current.region]: current.catalog }, searchResult: nextRegion === current.region ? current.searchResult : undefined };
    });
  }

  function addShoppingRegion() {
    const id = newRegionCode.trim().toUpperCase();
    const country = newRegionCountry.trim();
    const currency = newRegionCurrency.trim().toUpperCase();
    if (!/^[A-Z]{2,5}$/.test(id) || !country || !/^[A-Z]{3}$/.test(currency)) { setRegionError("请填写地区缩写（2–5 个字母）、地区名称和三位币种代码。"); return; }
    if (state.regions.some(item => item.id === id)) { setRegionError("该地区已存在，直接在上方勾选即可。"); return; }
    if (!WALLET_CURRENCIES.includes(currency)) {
      const rate = Number(newCurrencyRate);
      if (!Number.isFinite(rate) || rate <= 0 || !registerCustomWalletCurrency(currency, rate, newCurrencySymbol)) { setRegionError("新币种需要填写大于 0 的参考汇率：1 单位新币约等于多少人民币。"); return; }
    }
    persist(current => ({ ...current, regions: [...current.regions, { id, country, currency, enabled: true }] }));
    setNewRegionCode(""); setNewRegionCountry(""); setNewRegionCurrency("CNY"); setNewCurrencyRate(""); setNewCurrencySymbol(""); setRegionError("");
  }

  function saveAddress() {
    const a = addressDraft;
    if (!a.name.trim() || !a.country.trim() || !a.city.trim() || !a.street.trim()) { setPaymentError("请填写收件人、国家、城市和详细地址。"); return; }
    const address: ShoppingAddress = { id: `shop_address_${Date.now()}`, ownerId: addressOwnerId || undefined,
      name: a.name.trim(), phone: a.phone.trim(), country: a.country.trim(), city: a.city.trim(), street: a.street.trim() };
    persist(current => ({ ...current, addresses: [...current.addresses, address] }));
    if (addressOwnerId) { setRecipientId(addressOwnerId); setRecipientAddressId(address.id); }
    else setSenderAddressId(address.id);
    setPaymentError(null);
    setAddressOpen(false);
    setAddressDraft({ name: "", phone: "", country: "", city: "", street: "" });
  }

  function sendWarehouseGift() {
    if (!shipGift || !recipientId || !currentRecipientAddress) { setPaymentError("请选择角色并设置收件地址。"); return; }
    if (!deliveryFrom) { setPaymentError("请先设置我的发件地址。"); return; }
    const estimate = shoppingDeliveryEstimate(deliveryFrom, currentRecipientAddress);
    const item: ShoppingCartItem = { id: shipGift.itemId, title: shipGift.productName, merchantLabel: shipGift.merchantLabel,
      priceLabel: shipGift.priceLabel, tagLabel: "礼物", subtitle: shipGift.subtitle, detail: shipGift.detail,
      previewIcon: shipGift.previewIcon, tone: shipGift.tone, quantityLabel: "× 1", selectedOptions: shipGift.selectedOptions };
    const shipment = { id: `shop_ship_${Date.now()}`, giftId: shipGift.id, sourceOrderId: shipGift.source === "order" ? shipGift.orderId : undefined,
      item, senderAddressId: deliveryFrom.id, recipientCharacterId: recipientId, recipientAddressId: currentRecipientAddress.id,
      recipientName: ownerName || currentRecipientAddress.name, recipientAddressLabel: shoppingAddressLabel(currentRecipientAddress),
      notifyRecipient, sentAt: new Date().toISOString(), deliverAt: new Date(Date.now() + estimate.days * 86400000).toISOString() };
    if (estimate.fee > 0) {
      const paid = recordWalletPayment({ amount: estimate.fee, currency: "CNY", title: "礼物寄送运费", detail: `寄给 ${shipment.recipientName}：${item.title}`, category: "运费", relatedOrderId: shipment.id });
      if (!paid.ok) { setPaymentError(paid.error || "运费支付失败"); return; }
    }
    persist(current => ({ ...current, shipments: [shipment, ...current.shipments] }));
    if (notifyRecipient) announceShoppingGift(recipientId, item, shipment.id, shipment.recipientName);
    setShipGift(null);
    setPaymentError(null);
  }

  function openPaymentRequestSheet() {
    if (checkoutCartItems.length === 0) return;
    const targets = loadCharacters();
    setPaymentRequestTargets(targets);
    setSelectedPaymentRequestTargetId(targets[0]?.id ?? "");
    setPaymentRequestError(null);
    setPaymentRequestOpen(true);
  }

  function sendPaymentRequest() {
    if (checkoutCartItems.length === 0) return;
    const target = paymentRequestTargets.find(item => item.id === selectedPaymentRequestTargetId);
    if (!target) {
      setPaymentRequestError("请选择代付对象。");
      return;
    }
    const paymentRequestedAt = new Date().toISOString();
    const paymentRequestId = createShoppingPaymentRequestId();
    const order = buildOrderFromCart(
      checkoutCartItems,
      formatShoppingAmount(cartTotals.totalPayment, cartCurrency),
      state.settings,
      {
        statusLabel: "待代付",
        note: `已向 ${target.name} 发起代付请求。`,
        skipShipping: true,
        paymentStatus: "payment_requested",
        paymentRequestId,
        payerCharacterId: target.id,
        payerCharacterName: target.name,
        paymentRequestedAt,
      },
    );
    order.currency = cartCurrency;
    const requestItems = buildShoppingPaymentRequestItems(order.items);
    const requestItemsText = formatShoppingPaymentRequestItems(requestItems);
    const amountLabel = formatShoppingPaymentAmountForHistory(cartTotals.totalPayment);
    const chatSession = createOrGetSession(target.id);
    pushChatMessage({
      sessionId: chatSession.id,
      role: "user",
      content: "",
      mediaType: "payment_request",
      mediaData: {
        amount: cartTotals.totalPayment,
        currency: cartCurrency,
        paymentRequestAmountLabel: amountLabel,
        paymentRequestId,
        shoppingOrderId: order.id,
        paymentRequestItems: requestItems,
        paymentRequestItemsText: requestItemsText,
        paymentRequestSummary: order.summary,
        paymentPayerId: target.id,
        paymentPayerName: target.name,
        paymentRequestedAt,
        label: "代付请求",
        status: "pending",
      },
    });
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("chat-messages-updated", { detail: { sessionId: chatSession.id } }));
    }
    persist(current => ({
      ...current,
      orders: [order, ...current.orders],
      cartItems: current.cartItems.filter(item => (item.currency || "CNY") !== cartCurrency),
    }));
    setSelectedTab("orders");
    setSelectedOrderId(order.id);
    setPaymentRequestOpen(false);
    setPaymentRequestError(null);
  }

  function handleCheckout() {
    if (checkoutCartItems.length === 0) return;
    if (recipientId && !currentRecipientAddress) { setPaymentError("请先添加并选择收件地址。"); return; }
    if (!recipientId && !deliveryFrom) { setPaymentError("请先添加我的收件地址。"); return; }
    const order = buildOrderFromCart(checkoutCartItems, formatShoppingAmount(checkoutTotal, cartCurrency), state.settings);
    order.note = `${order.note} · 配送方式：${effectiveShippingMethod === "sea" ? "国际海运" : effectiveShippingMethod === "air" ? "国际空运" : effectiveShippingMethod === "standard" ? "普通配送" : "快递"}`;
    order.currency = cartCurrency;
    if (recipientId && currentRecipientAddress) {
      order.recipientCharacterId = recipientId;
      order.recipientAddressId = currentRecipientAddress.id;
      order.recipientName = ownerName || currentRecipientAddress.name;
      order.recipientAddressLabel = shoppingAddressLabel(currentRecipientAddress);
      order.notifyRecipient = notifyRecipient;
      order.shippingTimeline = shippingTimelineForOrder(order, deliveryEstimate?.days || 3);
    } else if (deliveryFrom) {
      order.recipientAddressId = deliveryFrom.id;
      order.recipientAddressLabel = shoppingAddressLabel(deliveryFrom);
      order.shippingTimeline = shippingTimelineForOrder(order, deliveryEstimate?.days || 3);
    }
    const paymentSource = selectedPaymentSource;
    if (!paymentSource) {
      setPaymentError("请选择付款方式。");
      return;
    }
    const paymentResult = recordWalletPayment({
      accountId: paymentSource.id,
      amount: checkoutTotal,
      currency: cartCurrency,
      credit: paymentSource.id === "wallet_credit_card",
      title: "购物付款",
      detail: `购物订单：${order.summary}`,
      category: "购物",
      relatedOrderId: order.id,
    });
    if (!paymentResult.ok || !paymentResult.transaction) {
      setWalletState(paymentResult.state);
      setPaymentError(paymentResult.error ?? "付款失败。");
      return;
    }
    setWalletState(paymentResult.state);
    const paidOrder: ShoppingOrder = {
      ...order,
      paymentCardId: paymentSource.id,
      paymentCardLabel: paymentSource.title,
      paymentTransactionId: paymentResult.transaction.id,
      paidAt: paymentResult.transaction.createdAt,
    };
    persist(current => ({
      ...current,
      orders: [paidOrder, ...current.orders],
      cartItems: current.cartItems.filter(item => (item.currency || "CNY") !== cartCurrency),
    }));
    if (recipientId && notifyRecipient) {
      for (const item of paidOrder.items) announceShoppingGift(recipientId, item, `${paidOrder.id}::${item.id}::notice`, paidOrder.recipientName || "收件人");
    }
    setSelectedTab("orders");
    setOrdersMode("shop");
    setSelectedOrderId(paidOrder.id);
    setPaymentError(null);
    setConfirmCheckoutOpen(false);
  }

  function checkoutFood() {
    const items = checkoutFoodItems;
    if (!items.length) return;
    const address = recipientId ? currentRecipientAddress : deliveryFrom;
    if (!address || !address.phone) { setPaymentError("请先填写收餐人的地址和电话。"); return; }
    const foodRegion = state.regions.find(region => region.id === items[0]?.regionId) || state.regions.find(region => region.currency === foodCurrency && region.enabled) || currentRegion;
    if (address.country !== foodRegion.country) { setPaymentError("外卖需选择与收餐地址相同的地区。"); return; }
    const order = buildOrderFromCart(items, formatShoppingAmount(foodPayable, foodCurrency), state.settings);
    order.mode = "food";
    order.currency = foodCurrency;
    order.recipientCharacterId = recipientId || undefined;
    order.recipientAddressId = address.id;
    order.recipientName = recipientId ? ownerName || address.name : address.name;
    order.recipientAddressLabel = shoppingAddressLabel(address);
    order.notifyRecipient = Boolean(recipientId && notifyRecipient);
    order.shippingTimeline = shippingTimelineForOrder(order, 45 / (24 * 60));
    const payment = recordWalletPayment({ accountId: selectedPaymentSourceId, credit: selectedPaymentSourceId === "wallet_credit_card", amount: foodPayable, currency: foodCurrency, title: "外卖付款", detail: `${items[0].merchantLabel}：${order.summary}`, category: "外卖", relatedOrderId: order.id });
    setWalletState(payment.state);
    if (!payment.ok || !payment.transaction) { setPaymentError(payment.error || "付款失败"); return; }
    order.paymentCardId = selectedPaymentSourceId;
    order.paymentTransactionId = payment.transaction.id;
    order.paidAt = payment.transaction.createdAt;
    persist(current => ({ ...current, orders: [order, ...current.orders], foodCartItems: current.foodCartItems.filter(item => (item.currency || "CNY") !== foodCurrency) }));
    if (recipientId && notifyRecipient) {
      const session = createOrGetSession(recipientId);
      pushChatMessage({ sessionId: session.id, role: "user", content: "", mediaType: "gift", mediaData: { giftName: `外卖 · ${order.summary}`, label: "外卖卡", giftMerchantLabel: order.merchantLabel, giftPriceLabel: order.totalLabel, giftPreviewIcon: order.items[0]?.previewIcon || "🥡", recipientId, recipientName: order.recipientName, shoppingOrderId: order.id } });
      window.dispatchEvent(new CustomEvent("chat-messages-updated", { detail: { sessionId: session.id } }));
    }
    setFoodCheckoutOpen(false); setPaymentError(null); setOrdersMode("food"); setSelectedTab("orders"); setSelectedOrderId(order.id);
  }

  function cancelPendingOrder(order: ShoppingOrder) {
    const deliveryAt = order.shippingTimeline?.find(event => event.status === "delivered")?.timestamp;
    if (deliveryAt && Date.parse(deliveryAt) <= Date.now()) { setPaymentError("订单已送达，无法取消。"); setCancelOrderCandidate(null); return; }
    const wallet = loadWalletState();
    const paidTransaction = wallet.transactions.find(tx => tx.id === order.paymentTransactionId);
    const paidCurrency = paidTransaction?.currency || order.currency || "CNY";
    if (paidTransaction?.credit) {
      const debt = Math.max(0, (wallet.creditDebts?.[paidCurrency] || 0) - Math.abs(paidTransaction.amount));
      const refund = { ...paidTransaction, id: `refund_${order.id}`, amount: -Math.abs(paidTransaction.amount), kind: "refund" as const, createdAt: new Date().toISOString(), balanceAfter: debt, detail: `取消订单 ${order.summary}` };
      saveWalletState({ ...wallet, creditDebts: { ...wallet.creditDebts, [paidCurrency]: debt }, transactions: [refund, ...wallet.transactions] });
    } else if (paidTransaction) {
      recordWalletCredit({ currency: paidCurrency, sourceCurrency: paidCurrency, amount: Math.abs(paidTransaction.amount), title: "订单退款", detail: `取消订单 ${order.summary}`, kind: "refund", category: order.mode === "food" ? "外卖退款" : "购物退款", relatedOrderId: order.id, relatedMessageId: `refund_${order.id}` });
    }
    if (order.recipientCharacterId) {
      const session = createOrGetSession(order.recipientCharacterId);
      const associated = loadChatMessages(session.id).filter(message => message.mediaData?.shoppingOrderId === order.id || String(message.mediaData?.shoppingGiftId || "").startsWith(`${order.id}::`));
      deleteChatMessagesByIds(session.id, associated.map(message => message.id));
    }
    persist(current => ({ ...current, orders: current.orders.filter(item => item.id !== order.id), usedCoupons: order.note?.includes("优惠券抵扣") ? current.usedCoupons.filter(item => item !== (order.mode === "food" ? "food" : "shop")) : current.usedCoupons }));
    setCancelOrderCandidate(null); setSelectedOrderId(null); setWalletState(loadWalletState());
  }

  function openProduct(product: ShoppingProduct | ShoppingCartItem | ShoppingOrder["items"][number], defaults?: { tagLabel?: string; detailLabel?: string }) {
    setTranslationPreview(null);
    setSelectedProduct(toProductDetail(product, defaults));
    setSelectedVariantOptions(("variantGroups" in product ? product.variantGroups : undefined)?.map(group => group.options[0]?.label || "") || []);
  }

  function renderShoppingCardText(text: string) {
    const normalized = normalizeCheckPhoneText(text);
    const bilingual = splitBilingualText(normalized);
    if (!bilingual) return <span className="cp-shopping-card-title-original">{normalized}</span>;
    const openTranslation = () => setTranslationPreview(bilingual);
    return (
      <span className="cp-shopping-card-title-line">
        <span className="cp-shopping-card-title-original">{bilingual.original}</span>
        <span
          className="cp-shopping-card-title-translate"
          role="button"
          tabIndex={0}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            openTranslation();
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            event.stopPropagation();
            openTranslation();
          }}
        >
          中文
        </span>
      </span>
    );
  }

  const topSubtitle = selectedProduct
    ? selectedProduct.tagLabel
    : activeOrder
      ? activeOrderShipping?.statusLabel ?? activeOrder.statusLabel
      : "分类推荐与心动清单";

  const backAction = selectedProduct
    ? () => {
      setTranslationPreview(null);
      setSelectedProduct(null);
    }
    : activeOrder
      ? () => {
        setTranslationPreview(null);
        setSelectedOrderId(null);
      }
      : selectedTab === "account" || selectedTab === "items" ? () => setSelectedTab("home") : () => onClose(loading);

  const selectedProductRecentlyAdded = Boolean(selectedProduct && recentlyAddedProductId === selectedProduct.id);

  function ProductCard({ item, compact = false }: { item: ShoppingProduct; compact?: boolean }) {
    const isSaved = savedIds.has(item.id);
    const inCart = cartIds.has(item.id);
    const recentlyAdded = recentlyAddedProductId === item.id;
    const handleOpen = () => openProduct(item);
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={handleOpen}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          handleOpen();
        }}
        style={{
          minWidth: 0,
          maxWidth: "100%",
          boxSizing: "border-box",
          background: "#fff",
          borderRadius: "16px",
          padding: "12px",
          display: "flex",
          flexDirection: "column",
          textAlign: "left",
          border: "none",
          boxShadow: "0 4px 20px rgba(0,0,0,0.03)",
          position: "relative",
          cursor: "pointer",
        }}
      >
        <button
          type="button"
          aria-label={isSaved ? "取消收藏" : "收藏"}
          onClick={(event) => {
            event.stopPropagation();
            toggleSave(item);
          }}
          style={{
            position: "absolute",
            top: "12px",
            right: "48px",
            zIndex: 2,
            background: isSaved ? "#ff6b00" : "#fff",
            border: "1px solid #eee",
            borderRadius: "50%",
            width: "30px",
            height: "30px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: isSaved ? "#fff" : "#777",
            boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
          }}
        >
          <Heart size={15} fill={isSaved ? "white" : "none"} />
        </button>
        <button type="button" aria-label="删除这件商品" onClick={event => { event.stopPropagation(); setConfirmCatalogDelete(item); }} style={{ position: "absolute", top: 12, right: 12, width: 30, height: 30, borderRadius: "50%", border: "1px solid #eee", color: "#777", background: "#fff", zIndex: 2, padding: 0, display: "flex", alignItems: "center", justifyContent: "center" }}><Trash2 size={14} /></button>
        <div style={{ width: "100%", height: compact ? "92px" : "120px", background: "#f5f5f5", borderRadius: "12px", marginBottom: "12px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: compact ? "30px" : "34px" }}>
          {item.previewIcon}
        </div>
        <strong style={{ fontSize: "calc(13px*var(--app-text-scale,1))", color: "#222", fontWeight: 600, marginBottom: "4px", display: "block", width: "100%", minWidth: 0 }}>
          {renderShoppingCardText(item.title)}
        </strong>
        <div style={{ fontSize: "calc(11px*var(--app-text-scale,1))", color: "#888", marginBottom: "8px" }}>{item.merchantLabel}</div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "auto" }}>
          <span style={{ fontSize: "calc(14px*var(--app-text-scale,1))", color: "#222", fontWeight: "bold" }}>{item.priceLabel}</span>
          <button
            type="button"
            aria-label={recentlyAdded ? "已加入购物车" : inCart ? "再次加入购物车" : "加入购物车"}
            onClick={(event) => {
              event.stopPropagation();
              if (item.variantGroups?.length) openProduct(item); else addToCart(item);
            }}
            style={{
              background: recentlyAdded ? "#16a34a" : inCart ? "#222" : "#f46200",
              color: "#fff",
              width: "26px",
              height: "26px",
              borderRadius: "50%",
              border: "none",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transform: recentlyAdded ? "scale(1.14)" : "scale(1)",
              transition: "background 160ms ease, transform 180ms ease",
            }}
          >
            {recentlyAdded ? <Check size={16} strokeWidth={3} /> : <Plus size={16} />}
          </button>
        </div>
      </div>
    );
  }

  if (blackMarketOpen) {
    return <BlackMarketApp onClose={() => setBlackMarketOpen(false)} />;
  }

  return (
    <div className="cp-shopping-module" style={{ background: "#f8f9fa", fontFamily: "sans-serif" }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: "var(--page-header-content-height, 42px)", marginTop: "var(--page-header-safe-top, 48px)", padding: "1px 24px", background: "#f8f9fa", zIndex: 4 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
          <button type="button" aria-label="返回" onClick={backAction} style={{ width: 40, height: 40, borderRadius: "50%", border: "1px solid #eaeaea", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", color: "#333" }}><ChevronLeft size={22} strokeWidth={2.5} /></button>
          <strong style={{ fontSize: "calc(18px*var(--app-text-scale,1))", color: "#222", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{selectedProduct ? "商品详情" : activeOrder ? "订单详情" : selectedTab === "home" ? "Shopping" : selectedTab === "food" ? "Delivery" : selectedTab === "cart" ? "Cart" : selectedTab === "orders" ? "Orders" : selectedTab === "items" ? "我的物品" : "我的收藏"}</strong>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {!selectedProduct && !activeOrder && (selectedTab === "home" || selectedTab === "food") && <select aria-label="购物地区" value={state.region} onChange={event => switchRegion(event.target.value)} style={{ maxWidth: 70, border: "1px solid #eee", borderRadius: 14, padding: "9px 5px", background: "#fff", fontSize: 11 }}>
            {state.regions.filter(item => item.enabled).map(region => <option key={region.id} value={region.id}>{region.id}</option>)}
          </select>}
          <button type="button" aria-label="购物设置" onClick={() => setDrawerOpen(true)} style={{ width: 40, height: 40, borderRadius: "50%", border: "1px solid #eaeaea", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", color: "#333" }}><MoreHorizontal size={21} strokeWidth={2.35} /></button>
        </div>
      </header>

      {loading && (
        <div className="cp-refresh-indicator cp-refresh-indicator--floating" aria-live="polite">
          <span className="cp-refresh-indicator-text">{loadingLabel}</span>
          <span className="cp-refresh-indicator-dots" aria-hidden="true"><i></i><i></i><i></i></span>
        </div>
      )}

      {cartFeedback ? (
        <div key={cartFeedback.id} className="cp-shopping-cart-toast" role="status" aria-live="polite">
          <ShoppingCart size={16} />
          <span>已加入购物车</span>
        </div>
      ) : null}

      {blackMarketTransition ? (
        <div className="cp-shopping-black-market-gate" role="status" aria-live="polite">
          <div className="cp-shopping-black-market-gate-noise" />
          <div className="cp-shopping-black-market-gate-panel">
            <span>SEARCH QUERY ACCEPTED</span>
            <strong data-text="BLACK MARKET">BLACK MARKET</strong>
            <em>&gt; routing through night channel...</em>
          </div>
        </div>
      ) : null}

      <div className="cp-shopping-body">
        {!loaded && <div className="cp-shopping-status">Syncing storefront...</div>}

        {error ? <CheckPhoneDebugErrorCard error={error} debugRawOutput={debugRawOutput} /> : null}

        {!selectedProduct && !activeOrder && (
          <>
            {(selectedTab === "home" || selectedTab === "food") ? (
              <div style={{ padding: "0 24px", marginTop: "-4px", marginBottom: "16px" }}>
                {<form onSubmit={handleSearch} style={{ display: "flex", alignItems: "center", background: "#fff", borderRadius: "22px", padding: "0 8px 0 14px", minHeight: "40px", color: "#999", fontSize: "calc(13px*var(--app-text-scale,1))", gap: "8px", boxShadow: "0 3px 12px rgba(0,0,0,0.018)" }}>
                  <Search size={17} />
                  <input
                    aria-label="搜索商品"
                    value={selectedTab === "food" ? foodSearchInput : searchInput}
                    onChange={event => {
                      const nextValue = event.target.value;
                      if (selectedTab === "food") { setFoodSearchInput(nextValue); setFoodCategoryId("all"); }
                      else { setSearchInput(nextValue);
                      if (selectedCategoryId !== "all") {
                        setSelectedCategoryId("all");
                      } }
                    }}
                    placeholder={selectedTab === "food" ? "搜索外卖" : "搜索商品"}
                    disabled={loading || blackMarketTransition}
                    style={{ flex: 1, minWidth: 0, border: "none", outline: "none", background: "transparent", color: "#222", fontSize: "calc(13px*var(--app-text-scale,1))", height: "38px" }}
                  />
                  <button type="submit" disabled={!(selectedTab === "food" ? foodSearchInput : searchInput).trim() || loading || blackMarketTransition} style={{ border: "none", background: (selectedTab === "food" ? foodSearchInput : searchInput).trim() && !loading && !blackMarketTransition ? "#ff6b00" : "#eee", color: (selectedTab === "food" ? foodSearchInput : searchInput).trim() && !loading && !blackMarketTransition ? "#fff" : "#aaa", borderRadius: "16px", height: "30px", padding: "0 12px", minWidth: "88px", fontSize: "calc(12px*var(--app-text-scale,1))", fontWeight: 700, whiteSpace: "nowrap" }}>
                    搜索新物品
                  </button>
                </form>}
                <div
                  role="tablist"
                  aria-label="商品分类"
                  style={{
                    display: "flex",
                    gap: "8px",
                    overflowX: "auto",
                    margin: "12px -24px 0",
                    padding: "0 24px 2px",
                    scrollbarWidth: "none",
                  }}
                >
                  {[
                    { id: "all", title: "全部" },
                    ...(selectedTab === "home" && state.searchResult?.items.length ? [{ id: "search", title: `搜索：${state.searchResult.query}` }] : []),
                    ...(selectedTab === "food" && foodSearchResult?.items.length ? [{ id: "food_search", title: `搜索：${foodSearchResult.query}` }] : []),
                    ...currentDefinitions,
                  ].map(category => {
                    const active = (selectedTab === "food" ? foodCategoryId : selectedCategoryId) === category.id;
                    return (
                      <button
                        key={category.id}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        onClick={() => selectedTab === "food" ? setFoodCategoryId(category.id) : setSelectedCategoryId(category.id)}
                        style={{
                          flex: "0 0 auto",
                          minHeight: "36px",
                          border: active ? "none" : "1px solid #eee",
                          borderRadius: "18px",
                          background: active ? "#ff6b00" : "#fff",
                          color: active ? "#fff" : "#555",
                          padding: "0 14px",
                          fontSize: "calc(12px*var(--app-text-scale,1))",
                          fontWeight: active ? 700 : 600,
                          whiteSpace: "nowrap",
                          maxWidth: category.id === "search" ? "136px" : undefined,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          boxShadow: active ? "0 8px 18px rgba(255,107,0,0.22)" : "0 3px 10px rgba(0,0,0,0.018)",
                          cursor: "pointer",
                        }}
                      >
                        {category.title}
                      </button>
                    );
                  })}
                  <button type="button" onClick={() => { setEditingCategoryId(null); setCategoryName(""); setCategoryMatch("store"); setCategoryEditorOpen(true); }} style={{ flex: "0 0 auto", border: "1px dashed #ff6b00", background: "#fff", color: "#ff6b00", borderRadius: 18, padding: "0 13px", fontSize: 12 }}>＋ 自定义</button>
                  {state.customCategories.find(category => category.mode === currentMode && category.id === (selectedTab === "food" ? foodCategoryId : selectedCategoryId)) && <button type="button" onClick={() => { const category = state.customCategories.find(item => item.id === (selectedTab === "food" ? foodCategoryId : selectedCategoryId)); if (!category) return; setEditingCategoryId(category.id); setCategoryName(category.title); setCategoryMatch(category.match); setCategoryEditorOpen(true); }} style={{ flex: "0 0 auto", border: "1px solid #eee", background: "#fff", color: "#666", borderRadius: 18, padding: "0 12px", fontSize: 12 }}>编辑此分类</button>}
                </div>
              </div>
            ) : null}

            {loaded && selectedTab === "home" && !hasVisibleHomeContent && !loading && !error ? (
              <div className="cp-shopping-status cp-empty-copy">
                <p>{emptyHomeTitle}</p>
                <span className="cp-shopping-hint">{emptyHomeHint}</span>
              </div>
            ) : null}

            <div
              key={selectedTab}
              ref={shoppingScrollRef}
              className="cp-shopping-scroll"
              style={{ padding: "0 24px 120px", display: "flex", flexDirection: "column", gap: "32px", marginTop: selectedTab === "home" ? 0 : "8px" }}
            >
              {selectedTab === "food" ? <section>
                {foodProducts.length ? <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 14 }}>{foodProducts.map(item => <ProductCard key={item.id} item={item} />)}</div> : <div className="cp-shopping-status cp-empty-copy"><p>暂无外卖商品</p><span>选一个分类，然后点刷新生成</span></div>}
              </section> : null}
              {selectedTab === "home" && hasVisibleHomeContent ? (
                <>
                  {hasVisibleSearchResults && state.searchResult?.items.length ? (
                    <section>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "16px" }}>
                        {state.searchResult.items.map(item => <ProductCard key={item.id} item={item} />)}
                      </div>
                    </section>
                  ) : null}

                  {selectedCategoryId === "all" && filteredAllCatalogProducts.length > 0 ? (
                    <section>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "16px" }}>
                        {filteredAllCatalogProducts.map(item => <ProductCard key={item.id} item={item} />)}
                      </div>
                    </section>
                  ) : null}

                  {selectedCategoryId !== "all" && selectedCategoryId !== "search" ? visibleCatalogCategories.filter(category => category.items.length > 0).map(category => (
                    <section key={category.id}>
                      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "16px", gap: "12px" }}>
                        <div style={{ minWidth: 0 }}>
                          <h2 style={{ fontSize: "calc(19px*var(--app-text-scale,1))", fontWeight: "bold", color: "#222", margin: "0 0 4px 4px" }}>{category.title}</h2>
                          <p style={{ fontSize: "calc(12px*var(--app-text-scale,1))", color: "#999", margin: "0 0 0 4px", lineHeight: 1.35 }}>{category.subtitle}</p>
                        </div>
                        <span style={{ fontSize: "calc(12px*var(--app-text-scale,1))", color: "#f46200", fontWeight: 500, whiteSpace: "nowrap", paddingTop: "3px" }}>{category.items.length}</span>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "16px" }}>
                        {category.items.map(item => <ProductCard key={item.id} item={item} />)}
                      </div>
                    </section>
                  )) : null}
                </>
              ) : null}

              {(selectedTab === "cart" || selectedTab === "orders") && <div style={{ display: "flex", background: "#fff", borderRadius: 16, padding: 4, gap: 5 }}>
                {(["shop", "food"] as ShoppingMode[]).map(mode => <button key={mode} type="button" onClick={() => selectedTab === "cart" ? setCartMode(mode) : setOrdersMode(mode)} style={{ flex: 1, padding: 9, border: 0, borderRadius: 13, fontSize: 12, background: (selectedTab === "cart" ? cartMode : ordersMode) === mode ? "#ff6b00" : "#fff", color: (selectedTab === "cart" ? cartMode : ordersMode) === mode ? "#fff" : "#555" }}>{mode === "shop" ? "商城" : "外卖"}</button>)}
              </div>}

              {selectedTab === "cart" && cartMode === "food" && <section style={{ display: "grid", gap: 12 }}>
                <h2 style={{ fontSize: 17, margin: 0 }}>外卖购物车</h2>
                {Array.from(new Set(state.foodCartItems.map(item => item.currency || "CNY"))).length > 1 && <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{Array.from(new Set(state.foodCartItems.map(item => item.currency || "CNY"))).map(currency => <button key={currency} type="button" onClick={() => setSelectedFoodCurrency(currency)} style={{ padding: "7px 12px", borderRadius: 14, border: currency === foodCurrency ? "1px solid #ff6b00" : "1px solid #ddd", background: currency === foodCurrency ? "#fff4ea" : "white" }}>{currency}</button>)}</div>}
                {!state.foodCartItems.length ? <div className="cp-shopping-status">暂时没有外卖商品</div> : checkoutFoodItems.map(item => <div key={item.id} style={{ background: "#fff", padding: 14, borderRadius: 16, display: "flex", alignItems: "center", gap: 10 }}><span style={{ fontSize: 25 }}>{item.previewIcon}</span><div style={{ flex: 1, minWidth: 0 }}><strong style={{ fontSize: 12 }}>{item.title}</strong><p style={{ fontSize: 11, color: "#888", margin: "3px 0" }}>{item.selectedOptions?.join(" / ") || item.merchantLabel} · {item.priceLabel}</p></div><button type="button" onClick={() => persist(current => ({ ...current, foodCartItems: current.foodCartItems.filter(entry => entry.id !== item.id) }))} aria-label="从外卖购物车删除" style={{ border: 0, background: "#fff", color: "#777" }}><Trash2 size={15} /></button></div>)}
                {state.foodCartItems.length > 0 && <><strong style={{ textAlign: "right", fontSize: 14 }}>{formatCurrencyAmount(foodTotal, foodCurrency)}</strong><button type="button" onClick={() => { setRecipientId(""); setRecipientAddressId(""); setPaymentError(null); setFoodCheckoutOpen(true); }} style={{ padding: 13, border: 0, borderRadius: 16, background: "#ff6b00", color: "#fff" }}>去结算</button></>}
              </section>}

              {selectedTab === "cart" && cartMode === "shop" && (
                <section style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                  <h2 style={{ fontSize: "calc(19px*var(--app-text-scale,1))", fontWeight: "bold", color: "#222", margin: "0 0 8px 4px" }}>Cart</h2>
                  {Array.from(new Set(state.cartItems.map(item => item.currency || "CNY"))).length > 1 && <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{Array.from(new Set(state.cartItems.map(item => item.currency || "CNY"))).map(currency => <button key={currency} type="button" onClick={() => setSelectedShopCurrency(currency)} style={{ padding: "7px 12px", borderRadius: 14, border: currency === cartCurrency ? "1px solid #ff6b00" : "1px solid #ddd", background: currency === cartCurrency ? "#fff4ea" : "white" }}>{currency}</button>)}</div>}
                  {state.cartItems.length === 0 ? (
                    <div className="cp-shopping-status cp-empty-copy" style={{ minHeight: "220px" }}>
                      <p>购物车是空的</p>
                    </div>
                  ) : null}
                  {state.cartItems.length > 0 && filteredCartItems.length === 0 ? (
                    <div className="cp-shopping-status cp-empty-copy" style={{ minHeight: "220px" }}>
                      <p>没有找到相关购物车商品</p>
                    </div>
                  ) : null}
                  {filteredCartItems.filter(item => (item.currency || "CNY") === cartCurrency).map(item => (
                    (() => {
                      const quantity = parseShoppingQuantity(item.quantityLabel);
                      return (
                        <div
                          key={item.id}
                          onClick={() => openProduct(item, { detailLabel: "Description" })}
                          onKeyDown={(event) => {
                            if (event.key !== "Enter" && event.key !== " ") return;
                            event.preventDefault();
                            openProduct(item, { detailLabel: "Description" });
                          }}
                          role="button"
                          tabIndex={0}
                          style={{ width: "100%", minWidth: 0, maxWidth: "100%", boxSizing: "border-box", background: "#fff", borderRadius: "16px", padding: "16px", display: "flex", alignItems: "center", border: "none", boxShadow: "0 4px 20px rgba(0,0,0,0.03)", gap: "16px", textAlign: "left", cursor: "pointer" }}
                        >
                          <div style={{ width: "80px", height: "80px", background: "#f5f5f5", borderRadius: "12px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "calc(36px*var(--app-text-scale,1))", flexShrink: 0 }}>
                            {item.previewIcon}
                          </div>
                          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "center" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", minWidth: 0, gap: "8px" }}>
                              <strong style={{ flex: "1 1 0", fontSize: "calc(13px*var(--app-text-scale,1))", color: "#222", fontWeight: 600, display: "block", minWidth: 0 }}>{renderShoppingCardText(item.title)}</strong>
                              <button type="button" aria-label="移出购物车" onClick={(event) => {
                                event.stopPropagation();
                                setConfirmCartDeleteItemId(item.id);
                              }} style={{ border: "none", background: "transparent", color: "#ff6b00", padding: 0 }}>
                                <Trash2 size={16} />
                              </button>
                            </div>
                            <span style={{ fontSize: "calc(11px*var(--app-text-scale,1))", color: "#888", marginTop: "4px" }}>{item.merchantLabel}</span>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "12px" }}>
                              <span style={{ fontSize: "calc(14px*var(--app-text-scale,1))", color: "#222", fontWeight: "bold" }}>{item.priceLabel}</span>
                              <div style={{ display: "flex", alignItems: "center", gap: "8px", background: "#f9f9f9", borderRadius: "14px", padding: "4px 8px" }}>
                                <button type="button" aria-label={quantity > 1 ? "减少数量" : "删除商品"} onClick={(event) => {
                                  event.stopPropagation();
                                  if (quantity > 1) {
                                    changeCartQuantity(item.id, -1);
                                  } else {
                                    setConfirmCartDeleteItemId(item.id);
                                  }
                                }} style={{ border: "none", background: "transparent", color: "#666", padding: 0, display: "flex" }}>
                                  <Minus size={12} />
                                </button>
                                <span style={{ fontSize: "calc(12px*var(--app-text-scale,1))", fontWeight: 500 }}>{quantity}</span>
                                <button type="button" aria-label="增加数量" onClick={(event) => {
                                  event.stopPropagation();
                                  changeCartQuantity(item.id, 1);
                                }} style={{ border: "none", background: "transparent", color: "#333", padding: 0, display: "flex" }}>
                                  <Plus size={12} />
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })()
                  ))}
                  {state.cartItems.length > 0 && !normalizedCartSearchQuery ? (
                    <div style={{ marginTop: "16px", background: "#fff", borderRadius: "16px", padding: "20px", boxShadow: "0 4px 20px rgba(0,0,0,0.03)" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "calc(12px*var(--app-text-scale,1))", color: "#666", marginBottom: "12px" }}>
                        <span>Order Amount</span>
                        <span style={{ color: "#222", fontWeight: 500 }}>{formatShoppingAmount(cartTotals.orderAmount, cartCurrency)}</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "calc(14px*var(--app-text-scale,1))", color: "#222", fontWeight: "bold", borderTop: "1px dashed #eee", paddingTop: "16px", marginBottom: "24px" }}>
                        <span>Total Payment</span>
                        <span>{formatShoppingAmount(cartTotals.totalPayment, cartCurrency)}</span>
                      </div>
                      <div style={{ display: "grid", gap: "10px" }}>
                        <button type="button" onClick={openCheckoutSheet} style={{ width: "100%", background: "#ff6b00", color: "#fff", borderRadius: "24px", padding: "14px 0", fontSize: "calc(14px*var(--app-text-scale,1))", fontWeight: "bold", border: "none" }}>结算 {cartCurrency} 商品</button>
                        <button
                          type="button"
                          onClick={openPaymentRequestSheet}
                          style={{ width: "100%", background: "#fff7ed", color: "#b45309", borderRadius: "24px", padding: "13px 0", fontSize: "calc(13px*var(--app-text-scale,1))", fontWeight: 800, border: "1px solid rgba(255,107,0,0.18)", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "8px" }}
                        >
                          <HeartHandshake size={16} strokeWidth={2.4} />
                          请TA代付
                        </button>
                      </div>
                    </div>
                  ) : null}
                </section>
              )}

              {selectedTab === "orders" && ordersMode === "food" && <section style={{ display: "grid", gap: 12 }}><h2 style={{ margin: 0, fontSize: 17 }}>外卖订单</h2>{state.orders.filter(order => order.mode === "food" && !order.canceledAt).length === 0 ? <div className="cp-shopping-status">暂无外卖订单</div> : state.orders.filter(order => order.mode === "food" && !order.canceledAt).map(order => <button type="button" key={order.id} onClick={() => setSelectedOrderId(order.id)} style={{ border: 0, background: "#fff", borderRadius: 16, padding: 15, textAlign: "left", display: "grid", gap: 6 }}><strong>{order.merchantLabel} · {order.totalLabel}</strong><span style={{ fontSize: 12, color: "#777" }}>{order.summary}</span><span style={{ fontSize: 11, color: "#999" }}>{resolveOrderShipping(order, nowTick).statusLabel} · {order.timeLabel}</span></button>)}</section>}

              {selectedTab === "orders" && ordersMode === "shop" && (
                <section style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                  <h2 style={{ fontSize: "calc(19px*var(--app-text-scale,1))", fontWeight: "bold", color: "#222", margin: "0 0 8px 4px" }}>Orders</h2>
                  {state.orders.length === 0 ? (
                    <div className="cp-shopping-status cp-empty-copy" style={{ minHeight: "220px" }}>
                      <p>暂无订单</p>
                    </div>
                  ) : null}
                  {state.orders.length > 0 && filteredOrders.length === 0 ? (
                    <div className="cp-shopping-status cp-empty-copy" style={{ minHeight: "220px" }}>
                      <p>没有找到相关订单</p>
                    </div>
                  ) : null}
                  {filteredOrders.filter(order => order.mode !== "food" && !order.canceledAt).map(order => {
                    const shipping = resolveOrderShipping(order, nowTick);
                    return (
                      <button
                        key={order.id}
                        type="button"
                        onClick={() => {
                          setTranslationPreview(null);
                          setSelectedOrderId(order.id);
                        }}
                        style={{ width: "100%", minWidth: 0, maxWidth: "100%", boxSizing: "border-box", background: "#fff", borderRadius: "16px", padding: "16px 20px", display: "flex", flexDirection: "column", border: "none", boxShadow: "0 4px 20px rgba(0,0,0,0.03)", textAlign: "left", gap: "8px", lineHeight: 1.25 }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
                          <strong style={{ fontSize: "calc(13px*var(--app-text-scale,1))", color: "#222" }}>{order.merchantLabel}</strong>
                          <span style={{ fontSize: "calc(12px*var(--app-text-scale,1))", color: shipping.statusLabel === "已到货" ? "#16a34a" : "#ff6b00", fontWeight: 500 }}>{shipping.statusLabel}</span>
                        </div>
                        <div style={{ display: "flex", gap: "10px", width: "100%", alignItems: "stretch" }}>
                          <div style={{ width: "56px", height: "56px", background: "#f5f5f5", borderRadius: "12px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "calc(24px*var(--app-text-scale,1))", flexShrink: 0 }}>
                            {order.items[0]?.previewIcon || "□"}
                          </div>
                          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "space-between", minHeight: "56px" }}>
                            <div style={{ display: "flex", flexDirection: "column", transform: "translateY(10px)" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                                <span style={{ flex: 1, minWidth: 0, fontSize: "calc(13px*var(--app-text-scale,1))", color: "#333" }}>{renderShoppingCardText(order.summary)}</span>
                                <span style={{ fontSize: "calc(11px*var(--app-text-scale,1))", color: "#999", whiteSpace: "nowrap" }}>{order.items.length} items</span>
                              </div>
                              <span style={{ fontSize: "calc(11px*var(--app-text-scale,1))", color: "#888", marginTop: "4px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{order.timeLabel}</span>
                            </div>
                            <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "baseline", lineHeight: 1 }}>
                              <strong style={{ fontSize: "calc(14px*var(--app-text-scale,1))", color: "#222", lineHeight: 1 }}>{order.totalLabel}</strong>
                            </div>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </section>
              )}

              {selectedTab === "account" && (
                <section style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                  <h2 style={{ fontSize: "calc(19px*var(--app-text-scale,1))", fontWeight: "bold", color: "#222", margin: "0 0 8px 4px" }}>Favorites</h2>
                  {state.savedItems.length === 0 ? (
                    <div className="cp-shopping-status cp-empty-copy" style={{ minHeight: "220px" }}>
                      <p>暂无收藏</p>
                    </div>
                  ) : null}
                  {state.savedItems.length > 0 && filteredSavedItems.length === 0 ? (
                    <div className="cp-shopping-status cp-empty-copy" style={{ minHeight: "220px" }}>
                      <p>没有找到相关收藏</p>
                    </div>
                  ) : null}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "16px" }}>
                    {filteredSavedItems.map(item => <ProductCard key={item.id} item={item} />)}
                  </div>
                </section>
              )}

              {selectedTab === "items" && <section style={{ display: "grid", gap: 12 }}>
                <h2 style={{ fontSize: 20, margin: 0 }}>我的物品</h2>
                <p style={{ color: "#888", fontSize: 12, margin: 0 }}>已到货的自购物品和收到的角色礼物。寄出后会从可送物品中移除。</p>
                <button type="button" onClick={() => { setAddressOwnerId(""); setAddressOpen(true); }} style={{ border: "1px solid #eee", background: "#fff", padding: 12, borderRadius: 14, textAlign: "left" }}>管理我的发件地址 · {shopperAddresses.length} 个</button>
                {state.shipments.map(shipment => <div key={shipment.id} style={{ padding: 15, borderRadius: 15, background: "#fff", fontSize: 12 }}>寄给 {shipment.recipientName} · {shipment.item.title}<br /><span style={{ color: "#888" }}>{new Date(shipment.deliverAt).getTime() <= nowTick ? "已签收" : `预计 ${new Date(shipment.deliverAt).toLocaleDateString("zh-CN")} 到达`}</span></div>)}
                {warehouseGifts.length === 0 && <div className="cp-shopping-status cp-empty-copy"><p>暂无可送出的物品</p></div>}
                {warehouseGifts.map(gift => <div key={gift.id} style={{ padding: 15, background: "#fff", borderRadius: 15, display: "flex", gap: 10, alignItems: "center" }}><span style={{ fontSize: 25 }}>{gift.previewIcon}</span><div style={{ flex: 1, minWidth: 0 }}><strong>{gift.productName}</strong><p style={{ margin: "3px 0", color: "#888", fontSize: 11 }}>{gift.source === "character" ? "角色送来" : gift.merchantLabel} · {gift.selectedOptions?.join(" / ") || ""} · {gift.priceLabel}</p></div><button type="button" onClick={() => { setShipGift(gift); setRecipientId(""); setRecipientAddressId(""); setPaymentError(null); }} style={{ border: 0, borderRadius: 12, padding: "9px 10px", background: "#111", color: "#fff" }}>转送</button></div>)}
              </section>}
            </div>

            <nav style={{ position: "absolute", bottom: 0, left: 0, right: 0, background: "#fff", display: "flex", justifyContent: "space-around", padding: "12px 0 calc(12px + env(safe-area-inset-bottom, 0px))", borderTop: "1px solid #eaeaea", zIndex: 10 }}>
              {SHOPPING_TABS.map(tab => {
                const Icon = tab.icon;
                const active = selectedTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onPointerDown={resetShoppingScroll}
                    onClick={() => {
                      selectShoppingTab(tab.id);
                    }}
                    style={{ background: "transparent", border: "none", display: "flex", flexDirection: "column", alignItems: "center", gap: "6px", color: active ? "#ff6b00" : "#999" }}
                  >
                    <div style={{ background: active ? "#ff6b00" : "transparent", color: active ? "#fff" : "inherit", padding: "8px", borderRadius: "12px" }}>
                      <Icon size={active ? 20 : 22} strokeWidth={active ? 2.5 : 2} />
                    </div>
                    <span style={{ fontSize: "calc(11px*var(--app-text-scale,1))", fontWeight: active ? 600 : 500 }}>{tab.label}</span>
                  </button>
                );
              })}
            </nav>

            {(selectedTab === "home" || selectedTab === "food") ? (
              <button
                type="button"
                aria-label="刷新首页推荐"
                onClick={openRefreshPicker}
                disabled={loading}
                style={{
                  position: "absolute",
                  right: "24px",
                  bottom: "calc(86px + env(safe-area-inset-bottom, 0px))",
                  zIndex: 12,
                  width: "54px",
                  height: "54px",
                  borderRadius: "50%",
                  border: "none",
                  background: loading ? "#ffb27a" : "#ff6b00",
                  color: "#fff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  boxShadow: "0 14px 30px rgba(255,107,0,0.34)",
                  cursor: loading ? "default" : "pointer",
                }}
              >
                <RefreshCw size={22} strokeWidth={2.6} className={loadingTask === "refresh" ? "cp-spin" : ""} />
              </button>
            ) : null}
          </>
        )}

        {selectedProduct && (
          <div style={{ position: "absolute", inset: 0, zIndex: 20, background: "#fff", display: "flex", flexDirection: "column", overflowY: "auto" }}>
            <header style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "space-between", height: "var(--page-header-content-height, 42px)", marginTop: "var(--page-header-safe-top, 48px)", padding: "1px 24px", background: "#fff" }}>
              <button type="button" aria-label="返回" onClick={backAction} style={{ background: "#fff", width: "34px", height: "34px", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", color: "#333", border: "1px solid #eee", boxShadow: "0 2px 10px rgba(0,0,0,0.05)" }}>
                <ChevronLeft size={20} />
              </button>
              <strong style={{ position: "absolute", left: "50%", bottom: "20px", transform: "translateX(-50%)", fontSize: "calc(16px*var(--app-text-scale,1))", color: "#222", fontWeight: 600 }}>Product Details</strong>
              <button type="button" aria-label={savedIds.has(selectedProduct.id) ? "取消收藏" : "收藏"} onClick={() => toggleSave(selectedProduct)} style={{ background: savedIds.has(selectedProduct.id) ? "#ff6b00" : "#fff", width: "34px", height: "34px", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", color: savedIds.has(selectedProduct.id) ? "#fff" : "#333", border: "1px solid #eee", boxShadow: "0 2px 10px rgba(0,0,0,0.05)" }}>
                <Heart size={17} fill={savedIds.has(selectedProduct.id) ? "white" : "none"} />
              </button>
            </header>
            <div style={{ position: "relative", width: "100%", height: "220px", background: "#f8f9fa", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "calc(72px*var(--app-text-scale,1))" }}>
              {selectedProduct.previewIcon}
            </div>

            <div style={{ padding: "22px 24px 34px", flex: 1, display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "6px" }}>
                <span style={{ fontSize: "calc(12px*var(--app-text-scale,1))", color: "#ff6b00", fontWeight: 600 }}>{selectedProduct.tagLabel}</span>
                <div style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "calc(12px*var(--app-text-scale,1))", color: "#222", fontWeight: 500 }}>
                  <Star size={12} fill="#ffb800" color="#ffb800" />
                  <span>{getShoppingRating(selectedProduct)}</span>
                </div>
              </div>

              <h1 style={{ fontSize: "calc(20px*var(--app-text-scale,1))", fontWeight: "bold", color: "#222", margin: "0 0 8px 0", lineHeight: 1.22 }}><CheckPhoneBilingualText text={selectedProduct.title} tone="shopping" /></h1>
              <div style={{ fontSize: "calc(13px*var(--app-text-scale,1))", color: "#666", marginBottom: "16px" }}>{selectedProduct.merchantLabel}</div>
              {selectedProduct.mode !== "food" && selectedProduct.shippingCity && <div style={{ fontSize: 12, color: "#777", marginBottom: 14 }}>从 {selectedProduct.shippingCountry || currentRegion.country} · {selectedProduct.shippingCity} 发货</div>}

              <div style={{ borderTop: "1px solid #f0f0f0", paddingTop: "16px", marginBottom: "20px" }}>
                <h3 style={{ fontSize: "calc(14px*var(--app-text-scale,1))", fontWeight: "bold", color: "#222", marginBottom: "8px" }}>{selectedProduct.detailLabel || "Description"}</h3>
                <p style={{ fontSize: "calc(13px*var(--app-text-scale,1))", color: "#666", lineHeight: 1.5, margin: 0 }}>
                  <CheckPhoneBilingualText text={selectedProduct.detail || selectedProduct.subtitle} tone="shopping" />
                </p>
              </div>

              {selectedProduct.variantGroups?.map((group, groupIndex) => <div key={group.name} style={{ marginBottom: 13 }}>
                <strong style={{ fontSize: 12 }}>{group.name}</strong>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>{group.options.map(option => <button type="button" key={option.label} onClick={() => setSelectedVariantOptions(current => { const next = [...current]; next[groupIndex] = option.label; return next; })} style={{ border: selectedVariantOptions[groupIndex] === option.label ? "1px solid #ff6b00" : "1px solid #eee", borderRadius: 12, padding: "7px 10px", background: "#fff", color: selectedVariantOptions[groupIndex] === option.label ? "#ff6b00" : "#444", fontSize: 12 }}>{option.label}{option.extra ? ` +${formatCurrencyAmount(option.extra, selectedProduct.currency || currentRegion.currency)}` : ""}</button>)}</div>
              </div>)}

              <div style={{ marginTop: "auto", display: "flex", alignItems: "center", justifyContent: "space-between", paddingTop: "14px" }}>
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <span style={{ fontSize: "calc(11px*var(--app-text-scale,1))", color: "#999" }}>Price</span>
                  <strong style={{ fontSize: "calc(18px*var(--app-text-scale,1))", color: "#222" }}>{selectedProduct.priceLabel}</strong>
                </div>
                <button
                  type="button"
                  onClick={() => addToCart(selectedProduct)}
                  style={{
                    background: selectedProductRecentlyAdded ? "#16a34a" : "#222",
                    color: "#fff",
                    border: "none",
                    borderRadius: "24px",
                    padding: "12px 24px",
                    fontSize: "calc(13px*var(--app-text-scale,1))",
                    fontWeight: "bold",
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    minWidth: "128px",
                    justifyContent: "center",
                    transform: selectedProductRecentlyAdded ? "scale(1.03)" : "scale(1)",
                    transition: "background 160ms ease, transform 180ms ease",
                  }}
                >
                  {selectedProductRecentlyAdded ? <Check size={16} strokeWidth={3} /> : <ShoppingCart size={16} />}
                  {selectedProductRecentlyAdded ? "Added" : cartIds.has(selectedProduct.id) ? "Add Again" : "Add to Cart"}
                </button>
              </div>
            </div>
          </div>
        )}

        {activeOrder && (
          <div style={{ position: "absolute", inset: 0, zIndex: 20, background: "#f8f9fa", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <header style={{ flex: "0 0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "var(--page-header-safe-top, 48px) 24px 16px", background: "#fff", borderBottom: "1px solid #f0f0f0", zIndex: 1 }}>
              <button type="button" aria-label="返回" onClick={backAction} style={{ width: "40px", height: "40px", borderRadius: "50%", border: "1px solid #eaeaea", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", color: "#333" }}>
                <ChevronLeft size={20} strokeWidth={2.5} />
              </button>
              <strong style={{ fontSize: "calc(16px*var(--app-text-scale,1))", color: "#222" }}>Order Details</strong>
              <div style={{ width: "40px" }} />
            </header>

            <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "24px", display: "flex", flexDirection: "column", gap: "16px" }}>
              <div style={{ background: "#fff", borderRadius: "20px", padding: "20px", boxShadow: "0 4px 20px rgba(0,0,0,0.02)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "16px" }}>
                  <span style={{ fontSize: "calc(12px*var(--app-text-scale,1))", color: "#999" }}>Order Status</span>
                  <span style={{ fontSize: "calc(12px*var(--app-text-scale,1))", color: activeOrderShipping?.statusLabel === "已到货" ? "#16a34a" : "#ff6b00", fontWeight: 600 }}>{activeOrderShipping?.statusLabel ?? activeOrder.statusLabel}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
                  <span style={{ fontSize: "calc(12px*var(--app-text-scale,1))", color: "#999" }}>Merchant</span>
                  <span style={{ fontSize: "calc(12px*var(--app-text-scale,1))", color: "#222", fontWeight: 500 }}>{activeOrder.merchantLabel}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontSize: "calc(12px*var(--app-text-scale,1))", color: "#999" }}>Order Date</span>
                  <span style={{ fontSize: "calc(12px*var(--app-text-scale,1))", color: "#222", fontWeight: 500 }}>{activeOrder.timeLabel}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: "8px" }}>
                  <span style={{ fontSize: "calc(12px*var(--app-text-scale,1))", color: "#999" }}>Payment</span>
                  <span style={{ fontSize: "calc(12px*var(--app-text-scale,1))", color: "#222", fontWeight: 500, textAlign: "right" }}>
                    {activeOrder.paymentStatus === "payment_requested"
                      ? `等待${activeOrder.payerCharacterName || "TA"}代付`
                      : activeOrder.paymentStatus === "payment_declined"
                        ? `${activeOrder.payerCharacterName || "TA"}已拒绝代付`
                        : activeOrder.paymentCardLabel ?? "未记录付款方式"}
                  </span>
                </div>
              </div>

              {activeOrderShipping?.timeline.length ? (
                <div style={{ background: "#fff", borderRadius: "20px", padding: "20px", boxShadow: "0 4px 20px rgba(0,0,0,0.02)" }}>
                  <h4 style={{ fontSize: "calc(13px*var(--app-text-scale,1))", fontWeight: "bold", color: "#222", margin: "0 0 16px 0" }}>物流进度</h4>
                  <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                    {activeOrderShipping.timeline.map((event, index) => {
                      const eventTime = new Date(event.timestamp).getTime();
                      const completed = !Number.isNaN(eventTime) && eventTime <= nowTick;
                      const current = event.status === activeOrderShipping.currentStage;
                      return (
                        <div key={`${event.status}-${event.timestamp}`} style={{ display: "grid", gridTemplateColumns: "18px 1fr", gap: "10px", position: "relative" }}>
                          <div style={{ position: "relative", display: "flex", justifyContent: "center" }}>
                            {index < activeOrderShipping.timeline.length - 1 ? (
                              <span style={{ position: "absolute", top: "18px", width: "2px", height: "28px", background: completed ? "rgba(255,107,0,0.26)" : "#ececec" }} />
                            ) : null}
                            <span style={{ width: "10px", height: "10px", marginTop: "3px", borderRadius: "50%", background: completed ? current ? "#ff6b00" : "#16a34a" : "#d8d8d8", boxShadow: current ? "0 0 0 5px rgba(255,107,0,0.12)" : "none", zIndex: 1 }} />
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", minWidth: 0 }}>
                            <span style={{ fontSize: "calc(12px*var(--app-text-scale,1))", color: completed ? "#222" : "#999", fontWeight: current ? 700 : 500 }}>{event.label}</span>
                            <span style={{ fontSize: "calc(11px*var(--app-text-scale,1))", color: completed ? "#666" : "#aaa", whiteSpace: "nowrap" }}>{completed ? event.timeLabel : `预计 ${event.timeLabel}`}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              <h3 style={{ fontSize: "calc(14px*var(--app-text-scale,1))", fontWeight: "bold", color: "#222", margin: "8px 0 0 0" }}>Items</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                {activeOrder.items.map(item => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => openProduct(item, { tagLabel: activeOrderShipping?.statusLabel ?? activeOrder.statusLabel })}
                    style={{ background: "#fff", borderRadius: "16px", padding: "12px", display: "flex", alignItems: "flex-start", border: "none", boxShadow: "0 2px 10px rgba(0,0,0,0.02)", gap: "12px", textAlign: "left" }}
                  >
                    <div style={{ width: "60px", height: "60px", background: "#f5f5f5", borderRadius: "10px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "calc(28px*var(--app-text-scale,1))", flexShrink: 0 }}>
                      {item.previewIcon}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <strong style={{ fontSize: "calc(13px*var(--app-text-scale,1))", color: "#222", fontWeight: 600, display: "block", lineHeight: 1.32, overflow: "visible", whiteSpace: "normal" }}><CheckPhoneBilingualText text={item.title} tone="shopping" /></strong>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "4px" }}>
                        <span style={{ fontSize: "calc(13px*var(--app-text-scale,1))", color: "#222", fontWeight: "bold" }}>{item.priceLabel}</span>
                        <span style={{ fontSize: "calc(11px*var(--app-text-scale,1))", color: "#999" }}>x {parseShoppingQuantity(item.quantityLabel)}</span>
                      </div>
                    </div>
                  </button>
                ))}
              </div>

              <div style={{ background: "#fff", borderRadius: "20px", padding: "20px", boxShadow: "0 4px 20px rgba(0,0,0,0.02)" }}>
                <h4 style={{ fontSize: "calc(13px*var(--app-text-scale,1))", fontWeight: "bold", color: "#222", marginBottom: "8px" }}>Order Note</h4>
                <p style={{ fontSize: "calc(12px*var(--app-text-scale,1))", color: "#666", margin: 0 }}><CheckPhoneBilingualText text={activeOrder.note} tone="shopping" /></p>
              </div>

              <div style={{ background: "#fff", borderRadius: "20px", padding: "20px", boxShadow: "0 4px 20px rgba(0,0,0,0.02)", marginTop: "auto" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "calc(12px*var(--app-text-scale,1))", color: "#666", marginBottom: "12px" }}>
                  <span>Total Items</span>
                  <span style={{ color: "#222", fontWeight: 500 }}>{activeOrder.items.length}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "calc(16px*var(--app-text-scale,1))", color: "#222", fontWeight: "bold", borderTop: "1px dashed #eee", paddingTop: "16px" }}>
                  <span>Amount Paid</span>
                  <span style={{ color: "#ff6b00" }}>{activeOrder.totalLabel}</span>
                </div>
              </div>
              {(!activeOrder.shippingTimeline?.some(event => event.status === "delivered" && Date.parse(event.timestamp) <= nowTick)) && <button type="button" onClick={() => setCancelOrderCandidate(activeOrder)} style={{ border: "1px solid #f5d0d0", borderRadius: 14, color: "#dc2626", background: "#fff", padding: 12 }}>取消订单并退款</button>}
            </div>
          </div>
        )}
      </div>

      {translationPreview && (
        <div className="cp-shopping-translation-overlay" role="presentation" onClick={() => setTranslationPreview(null)}>
          <div className="cp-shopping-translation-sheet" role="dialog" aria-modal="true" aria-label="中文翻译" onClick={event => event.stopPropagation()}>
            <div className="cp-shopping-translation-head">
              <span>中文翻译</span>
              <button type="button" onClick={() => setTranslationPreview(null)}>Close</button>
            </div>
            <p className="cp-shopping-translation-original">{translationPreview.original}</p>
            <div className="cp-shopping-translation-divider" />
            <p className="cp-shopping-translation-text">{translationPreview.translated}</p>
          </div>
        </div>
      )}

      {clearConfirmOpen && (
        <div className="cp-shopping-translation-overlay" role="presentation" onClick={() => setClearConfirmOpen(false)}>
          <div className="cp-shopping-translation-sheet" role="dialog" aria-modal="true" aria-label="清空购物痕迹" onClick={event => event.stopPropagation()} style={{ maxWidth: "320px" }}>
            <div className="cp-shopping-translation-head">
              <span>清空购物痕迹</span>
            </div>
            <p style={{ margin: "4px 0 16px", fontSize: "calc(13.5px*var(--app-text-scale,1))", lineHeight: 1.8, color: "#555" }}>
              是否确定清除所有购物页面痕迹？将清空商城、订单、收藏与喜欢，且无法恢复。
            </p>
            <div style={{ display: "flex", gap: "10px" }}>
              <button type="button" onClick={() => setClearConfirmOpen(false)} style={{ flex: 1, height: "40px", borderRadius: "12px", border: "1px solid #e5e5e5", background: "#fff", color: "#555", fontSize: "calc(14px*var(--app-text-scale,1))" }}>
                取消
              </button>
              <button type="button" onClick={clearAllShoppingTraces} style={{ flex: 1, height: "40px", borderRadius: "12px", border: "none", background: "#e5484d", color: "#fff", fontWeight: 600, fontSize: "calc(14px*var(--app-text-scale,1))" }}>
                确认清空
              </button>
            </div>
          </div>
        </div>
      )}

      {promptOpen && (
        <div className="cp-shopping-translation-overlay" role="presentation" onClick={() => setPromptOpen(false)}>
          <div className="cp-shopping-translation-sheet" role="dialog" aria-modal="true" aria-label="购物提示词" onClick={event => event.stopPropagation()} style={{ maxHeight: "74vh" }}>
            <div className="cp-shopping-translation-head">
              <span>{promptMode === "food" ? "外卖购物指令" : "Shopping 购物指令"}</span>
              <button type="button" onClick={() => setPromptOpen(false)}>Close</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "12px" }}>
              {([
                { id: "prompts" as const, label: "提示词" },
                { id: "shipping" as const, label: "物流时间" },
              ]).map(tab => {
                const active = settingsTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => {
                      setSettingsTab(tab.id);
                      if (tab.id !== "prompts") {
                        setExpandedPrompts(new Set());
                      }
                    }}
                    style={{ border: active ? "none" : "1px solid #eee", background: active ? "#ff6b00" : "#fff", color: active ? "#fff" : "#555", borderRadius: "16px", padding: "9px 12px", fontSize: "calc(12px*var(--app-text-scale,1))", fontWeight: 700 }}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>

            {settingsTab === "prompts" ? (
              <>
                <div style={{ border: "1px solid #eee", borderRadius: "16px", padding: "12px", background: "#fff" }}>
                  <div style={{ marginBottom: "10px" }}>
                    <strong style={{ display: "block", fontSize: "calc(12px*var(--app-text-scale,1))", color: "#222", lineHeight: 1.25 }}>提示词</strong>
                    <span style={{ display: "block", fontSize: "calc(11px*var(--app-text-scale,1))", color: "#999", marginTop: "3px", lineHeight: 1.35 }}>点击条目展开编辑</span>
                  </div>
                  {([
                    { id: "refresh" as const, label: "首页刷新", value: promptDrafts.refreshPrompt },
                    { id: "search" as const, label: "搜索结果", value: promptDrafts.searchPrompt },
                  ]).map(promptItem => {
                    const isOpen = expandedPrompts.has(promptItem.id);
                    return (
                      <div key={promptItem.id} className={`cp-shopping-settings-prompt${isOpen ? " is-open" : ""}`}>
                        <button
                          type="button"
                          className="cp-shopping-settings-prompt-head"
                          aria-expanded={isOpen}
                          onClick={() => setExpandedPrompts(current => {
                            const next = new Set(current);
                            if (next.has(promptItem.id)) next.delete(promptItem.id);
                            else next.add(promptItem.id);
                            return next;
                          })}
                        >
                          <span>{promptItem.label}</span>
                          <ChevronDown size={15} strokeWidth={2} />
                        </button>
                        {isOpen ? (
                          <textarea
                            className="cp-shopping-settings-prompt-textarea"
                            value={promptItem.value}
                            onChange={event => updatePromptDraft(promptItem.id, event.target.value)}
                          />
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <div style={{ border: "1px solid #eee", borderRadius: "16px", padding: "12px", background: "#fff" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", marginBottom: "10px" }}>
                <div style={{ minWidth: 0 }}>
                  <strong style={{ display: "block", fontSize: "calc(12px*var(--app-text-scale,1))", color: "#222", lineHeight: 1.25 }}>物流时间模拟</strong>
                  <span style={{ display: "block", fontSize: "calc(11px*var(--app-text-scale,1))", color: "#999", marginTop: "3px", lineHeight: 1.35 }}>新订单会在该范围内自动到货</span>
                </div>
                <button type="button" onClick={resetDeliveryDraft} style={{ flex: "0 0 auto", border: "1px solid #eee", background: "#fafafa", color: "#666", borderRadius: "14px", padding: "7px 10px", fontSize: "calc(11px*var(--app-text-scale,1))" }}>默认</button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                <label style={{ display: "flex", flexDirection: "column", gap: "6px", minWidth: 0 }}>
                  <span style={{ fontSize: "calc(11px*var(--app-text-scale,1))", color: "#777" }}>最短到货（分钟）</span>
                  <input
                    type="number"
                    min={1}
                    max={10080}
                    value={promptDrafts.deliveryMinMinutes}
                    onChange={event => updateDeliveryDraft("deliveryMinMinutes", event.target.value)}
                    style={{ width: "100%", minWidth: 0, height: "34px", border: "1px solid #eee", borderRadius: "12px", padding: "0 10px", fontSize: "calc(12px*var(--app-text-scale,1))", color: "#222", outline: "none" }}
                  />
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: "6px", minWidth: 0 }}>
                  <span style={{ fontSize: "calc(11px*var(--app-text-scale,1))", color: "#777" }}>最长到货（分钟）</span>
                  <input
                    type="number"
                    min={1}
                    max={10080}
                    value={promptDrafts.deliveryMaxMinutes}
                    onChange={event => updateDeliveryDraft("deliveryMaxMinutes", event.target.value)}
                    style={{ width: "100%", minWidth: 0, height: "34px", border: "1px solid #eee", borderRadius: "12px", padding: "0 10px", fontSize: "calc(12px*var(--app-text-scale,1))", color: "#222", outline: "none" }}
                  />
                </label>
              </div>
              </div>
            )}
            <div style={{ display: "flex", gap: "10px", justifyContent: "space-between", marginTop: "14px" }}>
              <button type="button" onClick={settingsTab === "prompts" ? resetPromptDraft : resetDeliveryDraft} style={{ border: "1px solid #eee", background: "#fff", color: "#555", borderRadius: "16px", padding: "9px 14px", fontSize: "calc(12px*var(--app-text-scale,1))" }}>
                {settingsTab === "prompts" ? "恢复默认提示词" : "恢复默认时间"}
              </button>
              <button type="button" onClick={handleSavePrompt} style={{ border: "none", background: "#ff6b00", color: "#fff", borderRadius: "16px", padding: "9px 18px", fontSize: "calc(12px*var(--app-text-scale,1))", fontWeight: 700 }}>保存</button>
            </div>
          </div>
        </div>
      )}

      {confirmCheckoutOpen && (
        <div className="cp-shopping-translation-overlay" role="presentation" onClick={() => {
          setConfirmCheckoutOpen(false);
          setPaymentError(null);
        }}>
          <div className="cp-shopping-translation-sheet" role="dialog" aria-modal="true" aria-label="选择付款方式" style={{ maxHeight: "82vh" }} onClick={event => event.stopPropagation()}>
            <div className="cp-shopping-translation-head">
              <span>选择付款方式</span>
              <button type="button" onClick={() => {
                setConfirmCheckoutOpen(false);
                setPaymentError(null);
              }}>Close</button>
            </div>

            <div style={{ background: "#fff7ed", border: "1px solid rgba(255,107,0,0.14)", borderRadius: "18px", padding: "14px 16px", marginBottom: "14px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                <span style={{ fontSize: "calc(11px*var(--app-text-scale,1))", color: "#9a5a18", fontWeight: 700 }}>应付金额</span>
                <strong style={{ fontSize: "calc(22px*var(--app-text-scale,1))", color: "#222", lineHeight: 1 }}>{formatShoppingAmount(checkoutTotal, cartCurrency)}</strong>
              </div>
              <CreditCard size={24} color="#ff6b00" />
            </div>

            {selectedPaymentSource.id !== "wallet_credit_card" && cartCurrency !== walletState.primaryCurrency && <p style={{ fontSize: 11, color: "#777", margin: "-4px 2px 12px" }}>优先扣除 {cartCurrency}，不足时按参考汇率由默认币种 {walletState.primaryCurrency} 支付。</p>}

            <div style={{ display: "grid", gap: 9, marginBottom: 14, fontSize: 12 }}>
              <label>购买给谁<select className="ui-input" value={recipientId} onChange={event => { setRecipientId(event.target.value); setRecipientAddressId(""); }}><option value="">买给自己（到货后进入我的物品）</option>{loadCharacters().map(person => <option key={person.id} value={person.id}>直接寄给 {person.name}</option>)}</select></label>
              <label>收件地址<select className="ui-input" value={recipientId ? currentRecipientAddress?.id || "" : deliveryFrom?.id || ""} onChange={event => recipientId ? setRecipientAddressId(event.target.value) : setSenderAddressId(event.target.value)}><option value="">请选择地址</option>{(recipientId ? recipientAddresses : shopperAddresses).map(address => <option value={address.id} key={address.id}>{shoppingAddressLabel(address)}</option>)}</select></label>
              <button type="button" onClick={() => { setAddressOwnerId(recipientId); setAddressDraft({ name: recipientId ? ownerName || "" : "", phone: "", country: currentRegion.country, city: "", street: "" }); setAddressOpen(true); }} style={{ border: "1px solid #ddd", background: "#fff", borderRadius: 12, padding: 9 }}>＋ 新建{recipientId ? "角色" : "我的"}地址</button>
              {recipientId && <><label style={{ display: "flex", justifyContent: "space-between" }}>寄出时通知对方（Chat 礼物卡）<input type="checkbox" checked={notifyRecipient} onChange={event => setNotifyRecipient(event.target.checked)} /></label>{deliveryEstimate && <span style={{ color: "#777" }}>预计 {deliveryEstimate.days} 天到达 · 运费约 {formatCurrencyAmount(shippingFee, cartCurrency)}（参考估算）</span>}</>}
              {checkoutAddress && <label>配送方式<select className="ui-input" value={effectiveShippingMethod} onChange={event => setShippingMethod(event.target.value as typeof shippingMethod)}>{!internationalShipping ? <><option value="express">{state.region === "CN" ? "顺丰快递" : state.region === "KR" ? "CJ대한통운" : state.region === "JP" ? "ヤマト運輸" : "UPS Express"} · 快速</option><option value="standard">{state.region === "CN" ? "菜鸟普通" : "普通配送"} · 经济</option></> : <><option value="air">顺丰国际 · 空运</option><option value="sea">顺丰国际 · 海运</option></>}</select></label>}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "10px", maxHeight: "42vh", overflowY: "auto", paddingRight: "2px" }}>
              {[
                { id: WALLET_BALANCE_ACCOUNT_ID, title: "储蓄卡", description: `${walletState.cards[0]?.bankLabel || "储蓄卡"} · ${walletState.cards[0]?.maskedNumber || ""}`, balance: getWalletCurrencyBalance(walletState, cartCurrency), icon: <WalletCards size={20} /> },
                ...(walletState.creditEnabled ? [{ id: "wallet_credit_card", title: "信用卡", description: "跨币种消费，之后还款", balance: 0, icon: <CreditCard size={20} /> }] : []),
              ].map(source => {
                const active = selectedPaymentSource?.id === source.id;
                const insufficient = source.id !== "wallet_credit_card" && !selectedPaymentSourceCanPay;
                return (
                  <button
                    key={source.id}
                    type="button"
                    onClick={() => {
                      setSelectedPaymentSourceId(source.id);
                      setPaymentError(null);
                    }}
                    style={{
                      width: "100%",
                      border: active ? "2px solid #ff6b00" : "1px solid #eee",
                      background: "#fff",
                      borderRadius: "18px",
                      padding: "14px",
                      display: "flex",
                      alignItems: "center",
                      gap: "12px",
                      textAlign: "left",
                      boxShadow: active ? "0 10px 24px rgba(255,107,0,0.12)" : "0 4px 14px rgba(0,0,0,0.025)",
                    }}
                  >
                    <div style={{ width: "42px", height: "42px", borderRadius: "16px", background: active ? "#ff6b00" : "#f4f4f5", color: active ? "#fff" : "#555", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      {source.icon}
                    </div>
                    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "3px" }}>
                      <strong style={{ fontSize: "calc(13px*var(--app-text-scale,1))", color: "#222" }}>{source.title}</strong>
                      <span style={{ fontSize: "calc(11px*var(--app-text-scale,1))", color: "#888" }}>{source.description} · 可用 {source.id === "wallet_credit_card" ? "按币种记欠款" : formatCurrencyAmount(source.balance, cartCurrency)}</span>
                    </div>
                    {insufficient ? (
                      <span style={{ fontSize: "calc(11px*var(--app-text-scale,1))", color: "#ef4444", fontWeight: 700, whiteSpace: "nowrap" }}>余额不足</span>
                    ) : active ? (
                      <Check size={18} color="#ff6b00" strokeWidth={3} />
                    ) : null}
                  </button>
                );
              })}
            </div>

            {paymentError || (selectedPaymentSource && !selectedPaymentSourceCanPay) ? (
              <div style={{ marginTop: "12px", borderRadius: "14px", background: "#fef2f2", color: "#b91c1c", padding: "10px 12px", display: "flex", gap: "8px", alignItems: "flex-start", fontSize: "calc(12px*var(--app-text-scale,1))", lineHeight: 1.4 }}>
                <AlertCircle size={15} style={{ flexShrink: 0, marginTop: "1px" }} />
                <span>{paymentError ?? "该付款方式余额不足，无法完成付款。"}</span>
              </div>
            ) : null}

            <div style={{ display: "flex", gap: "10px", justifyContent: "space-between", marginTop: "14px" }}>
              <button type="button" onClick={() => {
                setConfirmCheckoutOpen(false);
                setPaymentError(null);
              }} style={{ flex: 1, border: "1px solid #eee", background: "#fff", color: "#555", borderRadius: "18px", padding: "12px 0", fontSize: "calc(13px*var(--app-text-scale,1))", fontWeight: 700 }}>取消</button>
              <button type="button" disabled={!selectedPaymentSource || !selectedPaymentSourceCanPay} onClick={handleCheckout} style={{ flex: 1.4, border: "none", background: selectedPaymentSource && selectedPaymentSourceCanPay ? "#ff6b00" : "#eee", color: selectedPaymentSource && selectedPaymentSourceCanPay ? "#fff" : "#aaa", borderRadius: "18px", padding: "12px 0", fontSize: "calc(13px*var(--app-text-scale,1))", fontWeight: 800 }}>确认付款</button>
            </div>
          </div>
        </div>
      )}

      {shipGift && <div className="cp-shopping-translation-overlay" role="presentation" onClick={() => setShipGift(null)}><div className="cp-shopping-translation-sheet" role="dialog" aria-label="寄送我的物品" style={{ maxHeight: "82vh" }} onClick={event => event.stopPropagation()}>
        <div className="cp-shopping-translation-head"><span>转送 · {shipGift.productName}</span><button type="button" onClick={() => setShipGift(null)}>关闭</button></div>
        <div style={{ display: "grid", gap: 12, fontSize: 12 }}>
          <label>收礼人<select className="ui-input" value={recipientId} onChange={event => { setRecipientId(event.target.value); setRecipientAddressId(""); }}><option value="">请选择角色</option>{loadCharacters().map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
          <label>我的发件地址<select className="ui-input" value={deliveryFrom?.id || ""} onChange={event => setSenderAddressId(event.target.value)}><option value="">请选择</option>{shopperAddresses.map(a => <option key={a.id} value={a.id}>{shoppingAddressLabel(a)}</option>)}</select></label>
          <button type="button" onClick={() => { setAddressOwnerId(""); setAddressDraft({ name: "", phone: "", country: "", city: "", street: "" }); setAddressOpen(true); }} style={{ padding: 8 }}>＋ 添加我的发件地址</button>
          <label>角色收件地址<select className="ui-input" value={currentRecipientAddress?.id || ""} onChange={event => setRecipientAddressId(event.target.value)}><option value="">请选择</option>{recipientAddresses.map(a => <option key={a.id} value={a.id}>{shoppingAddressLabel(a)}</option>)}</select></label>
          {recipientId && <button type="button" onClick={() => { setAddressOwnerId(recipientId); setAddressDraft({ name: ownerName || "", phone: "", country: "", city: "", street: "" }); setAddressOpen(true); }} style={{ padding: 8 }}>＋ 添加角色收件地址</button>}
          <label style={{ display: "flex", justifyContent: "space-between" }}>寄出时通知对方<input type="checkbox" checked={notifyRecipient} onChange={event => setNotifyRecipient(event.target.checked)} /></label>
          {currentRecipientAddress && deliveryFrom && <span>预计 {shoppingDeliveryEstimate(deliveryFrom, currentRecipientAddress).days} 天 · 运费约 {formatCurrencyAmount(shoppingDeliveryEstimate(deliveryFrom, currentRecipientAddress).fee, "CNY")}，从 Wallet 扣除</span>}
          {paymentError && <span style={{ color: "#c22" }}>{paymentError}</span>}
          <button type="button" onClick={sendWarehouseGift} style={{ border: 0, background: "#111", color: "#fff", padding: 13, borderRadius: 14 }}>确认寄送</button>
        </div>
      </div></div>}

      {addressOpen && <div className="cp-shopping-translation-overlay" role="presentation" onClick={() => setAddressOpen(false)} style={{ zIndex: 110 }}><div className="cp-shopping-translation-sheet" role="dialog" aria-label="新增地址" style={{ maxHeight: "82vh" }} onClick={event => event.stopPropagation()}>
        <div className="cp-shopping-translation-head"><span>新增{addressOwnerId ? "角色" : "我的"}地址</span><button type="button" onClick={() => setAddressOpen(false)}>关闭</button></div>
        <div style={{ display: "grid", gap: 9 }}>{(["name", "phone", "country", "city", "street"] as const).map((key, i) => <label key={key} style={{ fontSize: 12 }}>{["收件人", "电话", "国家或地区", "城市", "详细地址"][i]}<input className="ui-input" value={addressDraft[key]} onChange={event => setAddressDraft(current => ({ ...current, [key]: event.target.value }))} /></label>)}
        {paymentError && <span style={{ color: "#c22", fontSize: 12 }}>{paymentError}</span>}
        <button type="button" onClick={saveAddress} style={{ border: 0, background: "#111", color: "#fff", padding: 13, borderRadius: 14 }}>保存地址</button></div>
      </div></div>}

      {paymentRequestOpen && (
        <div className="cp-shopping-translation-overlay" role="presentation" onClick={() => {
          setPaymentRequestOpen(false);
          setPaymentRequestError(null);
        }}>
          <div
            className="cp-shopping-translation-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="选择代付对象"
            onClick={event => event.stopPropagation()}
            style={{ maxHeight: "min(78vh, 560px)", overflow: "hidden", display: "flex", flexDirection: "column" }}
          >
            <div className="cp-shopping-translation-head" style={{ flexShrink: 0 }}>
              <span>请TA代付</span>
              <button type="button" onClick={() => {
                setPaymentRequestOpen(false);
                setPaymentRequestError(null);
              }}>Close</button>
            </div>

            <div style={{ background: "#fff7ed", border: "1px solid rgba(255,107,0,0.14)", borderRadius: "18px", padding: "14px 16px", marginBottom: "14px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexShrink: 0 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "3px", minWidth: 0 }}>
                <span style={{ fontSize: "calc(11px*var(--app-text-scale,1))", color: "#9a5a18", fontWeight: 700 }}>代付金额</span>
                <strong style={{ fontSize: "calc(22px*var(--app-text-scale,1))", color: "#222", lineHeight: 1 }}>{formatShoppingAmount(cartTotals.totalPayment, cartCurrency)}</strong>
              </div>
              <HeartHandshake size={24} color="#ff6b00" />
            </div>

            {paymentRequestTargets.length === 0 ? (
              <div className="cp-shopping-status cp-empty-copy" style={{ minHeight: "120px" }}>
                <p>暂无可选择的角色</p>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "10px", overflowY: "auto", paddingRight: "2px", flex: "1 1 auto", minHeight: 0 }}>
                {paymentRequestTargets.map(target => {
                  const active = selectedPaymentRequestTargetId === target.id;
                  return (
                    <button
                      key={target.id}
                      type="button"
                      onClick={() => {
                        setSelectedPaymentRequestTargetId(target.id);
                        setPaymentRequestError(null);
                      }}
                      style={{
                        width: "100%",
                        border: active ? "2px solid #ff6b00" : "1px solid #eee",
                        background: "#fff",
                        borderRadius: "18px",
                        padding: "14px",
                        display: "flex",
                        alignItems: "center",
                        gap: "12px",
                        textAlign: "left",
                        boxShadow: active ? "0 10px 24px rgba(255,107,0,0.12)" : "0 4px 14px rgba(0,0,0,0.025)",
                      }}
                    >
                      <div style={{ width: "42px", height: "42px", borderRadius: "16px", background: active ? "#ff6b00" : "#f4f4f5", color: active ? "#fff" : "#555", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, overflow: "hidden" }}>
                        {target.avatar ? (
                          <img src={target.avatar} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                        ) : (
                          <span style={{ fontSize: "calc(15px*var(--app-text-scale,1))", fontWeight: 800 }}>{target.name.slice(0, 1)}</span>
                        )}
                      </div>
                      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "3px" }}>
                        <strong style={{ fontSize: "calc(13px*var(--app-text-scale,1))", color: "#222" }}>{target.name}</strong>
                        <span style={{ fontSize: "calc(11px*var(--app-text-scale,1))", color: "#888" }}>发送代付请求到聊天</span>
                      </div>
                      {active ? <Check size={18} color="#ff6b00" strokeWidth={3} /> : null}
                    </button>
                  );
                })}
              </div>
            )}

            {paymentRequestError ? (
              <div style={{ marginTop: "12px", borderRadius: "14px", background: "#fef2f2", color: "#b91c1c", padding: "10px 12px", display: "flex", gap: "8px", alignItems: "flex-start", fontSize: "calc(12px*var(--app-text-scale,1))", lineHeight: 1.4, flexShrink: 0 }}>
                <AlertCircle size={15} style={{ flexShrink: 0, marginTop: "1px" }} />
                <span>{paymentRequestError}</span>
              </div>
            ) : null}

            <div style={{ display: "flex", gap: "10px", justifyContent: "space-between", marginTop: "14px", flexShrink: 0 }}>
              <button type="button" onClick={() => {
                setPaymentRequestOpen(false);
                setPaymentRequestError(null);
              }} style={{ flex: 1, border: "1px solid #eee", background: "#fff", color: "#555", borderRadius: "18px", padding: "12px 0", fontSize: "calc(13px*var(--app-text-scale,1))", fontWeight: 700 }}>取消</button>
              <button type="button" disabled={!selectedPaymentRequestTargetId} onClick={sendPaymentRequest} style={{ flex: 1.4, border: "none", background: selectedPaymentRequestTargetId ? "#ff6b00" : "#eee", color: selectedPaymentRequestTargetId ? "#fff" : "#aaa", borderRadius: "18px", padding: "12px 0", fontSize: "calc(13px*var(--app-text-scale,1))", fontWeight: 800 }}>发送请求</button>
            </div>
          </div>
        </div>
      )}

      {confirmCartDeleteItemId && (
        <ConfirmDialog
          title="确认删除商品？"
          message="该商品会从购物车中删除。"
          variant="danger"
          confirmLabel="删除"
          cancelLabel="取消"
          onConfirm={confirmRemoveCartItem}
          onCancel={() => setConfirmCartDeleteItemId(null)}
        />
      )}

      {confirmCatalogDelete && <ConfirmDialog title="删除这件商品？" message="会从商品目录移除；购物车和已有订单保留。以后刷新也会避开这件商品。" variant="danger" confirmLabel="删除" cancelLabel="取消" onConfirm={() => deleteCatalogProduct(confirmCatalogDelete)} onCancel={() => setConfirmCatalogDelete(null)} />}
      {cancelOrderCandidate && <ConfirmDialog title="取消订单并退款？" message="送达前可取消；本订单关联的通知卡片会一并移除。" variant="danger" confirmLabel="确认取消" cancelLabel="返回" onConfirm={() => cancelPendingOrder(cancelOrderCandidate)} onCancel={() => setCancelOrderCandidate(null)} />}

      {refreshPickerOpen && <div className="cp-shopping-translation-overlay" role="presentation" onClick={() => setRefreshPickerOpen(false)} style={{ zIndex: 100 }}><div className="cp-shopping-translation-sheet" role="dialog" aria-modal="true" aria-label="选择刷新分类" onClick={event => event.stopPropagation()} style={{ maxHeight: "74vh", overflowY: "auto" }}>
        <div className="cp-shopping-translation-head"><span>选择刷新分类</span><button type="button" onClick={() => setRefreshPickerOpen(false)}>关闭</button></div>
        <p style={{ fontSize: 12, color: "#777" }}>可以选一类或多类；每类生成约 4～6 件，已有商品会保留并去重。</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>{currentDefinitions.map(category => <button type="button" key={category.id} onClick={() => setSelectedRefreshIds(current => current.includes(category.id) ? current.filter(id => id !== category.id) : [...current, category.id])} style={{ border: selectedRefreshIds.includes(category.id) ? "1px solid #ff6b00" : "1px solid #eee", background: selectedRefreshIds.includes(category.id) ? "#fff3e9" : "#fff", borderRadius: 14, padding: "9px 11px", fontSize: 12 }}>{selectedRefreshIds.includes(category.id) ? "✓ " : ""}{category.title}</button>)}</div>
        <button type="button" disabled={!selectedRefreshIds.length || loading} onClick={() => void handleRefresh(selectedRefreshIds, currentMode)} style={{ width: "100%", border: 0, borderRadius: 14, background: "#ff6b00", color: "white", padding: 12, marginTop: 18, opacity: selectedRefreshIds.length ? 1 : .5 }}>刷新选中的 {selectedRefreshIds.length} 类</button>
      </div></div>}

      {categoryEditorOpen && <div className="cp-shopping-translation-overlay" role="presentation" onClick={() => setCategoryEditorOpen(false)} style={{ zIndex: 101 }}><div className="cp-shopping-translation-sheet" role="dialog" aria-modal="true" aria-label="自定义分类" onClick={event => event.stopPropagation()}>
        <div className="cp-shopping-translation-head"><span>{editingCategoryId ? "编辑分类" : "添加分类"}</span><button type="button" onClick={() => setCategoryEditorOpen(false)}>关闭</button></div>
        <input className="ui-input" aria-label="分类名称" placeholder="例如 APPLE、星巴克、丝芙兰" value={categoryName} onChange={event => setCategoryName(event.target.value)} maxLength={32} />
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>{(["store", "brand", "type"] as const).map(match => <button type="button" key={match} onClick={() => setCategoryMatch(match)} style={{ flex: 1, padding: 10, borderRadius: 12, background: categoryMatch === match ? "#fff3e9" : "#fff", border: categoryMatch === match ? "1px solid #ff6b00" : "1px solid #ddd", fontSize: 12 }}>{match === "store" ? "店铺" : match === "brand" ? "品牌" : "品类"}</button>)}</div>
        <p style={{ fontSize: 11, color: "#777" }}>已有商品和以后新生成的商品，符合此店铺／品牌／品类的会自动出现在入口里。</p>
        <button type="button" onClick={saveCustomCategory} disabled={!categoryName.trim()} style={{ width: "100%", padding: 11, border: 0, borderRadius: 13, color: "#fff", background: "#ff6b00" }}>保存分类</button>
        {editingCategoryId && <button type="button" onClick={() => deleteCustomCategory(editingCategoryId)} style={{ width: "100%", padding: 9, border: 0, background: "transparent", color: "#dc2626", marginTop: 9 }}>删除这个分类（保留商品）</button>}
      </div></div>}

      {regionEditorOpen && <div className="cp-shopping-translation-overlay" role="presentation" onClick={() => setRegionEditorOpen(false)} style={{ zIndex: 110 }}><div className="cp-shopping-translation-sheet" role="dialog" aria-modal="true" aria-label="管理购物地区与币种" onClick={event => event.stopPropagation()} style={{ maxHeight: "78vh", overflowY: "auto" }}>
        <div className="cp-shopping-translation-head"><span>管理购物地区</span><button type="button" onClick={() => setRegionEditorOpen(false)}>关闭</button></div>
        <p style={{ fontSize: 12, color: "#777" }}>勾选后可在商城、外卖顶栏切换；保留各地区已生成的商品。</p>
        <div style={{ display: "grid", gap: 8 }}>{state.regions.map(item => <label key={item.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: 10, border: "1px solid #eee", borderRadius: 12, fontSize: 12 }}><input type="checkbox" checked={item.enabled} disabled={item.enabled && state.regions.filter(entry => entry.enabled).length === 1} onChange={() => toggleShoppingRegion(item.id)} /><strong>{item.id}</strong><span style={{ flex: 1 }}>{item.country}</span><span style={{ color: "#777" }}>{item.currency}</span></label>)}</div>
        {getCustomWalletCurrencies().length > 0 && <div style={{ marginTop: 14, display: "grid", gap: 8 }}><strong style={{ fontSize: 12 }}>自定义币种参考汇率</strong>{getCustomWalletCurrencies().map(item => <div key={item.code} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11 }}><span>{item.code} · 1 单位折合人民币</span><input aria-label={`${item.code} 参考汇率`} type="number" min="0.000001" step="any" style={{ width: 75, padding: 6, border: "1px solid #eee", borderRadius: 8 }} value={currencyRateDrafts[item.code] ?? String(item.rate)} onChange={event => setCurrencyRateDrafts(current => ({ ...current, [item.code]: event.target.value }))} /><button type="button" onClick={() => { const rate = Number(currencyRateDrafts[item.code] ?? item.rate); if (!registerCustomWalletCurrency(item.code, rate, item.symbol)) { setRegionError("参考汇率必须大于 0。"); return; } setRegionError("已更新参考汇率。"); setState(current => ({ ...current })); }} style={{ padding: 6, border: 0, borderRadius: 7, background: "#f3f3f3" }}>保存</button></div>)}</div>}
        <strong style={{ display: "block", marginTop: 18, fontSize: 13 }}>添加地区</strong>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 8, marginTop: 10 }}><input aria-label="地区缩写" className="ui-input" placeholder="如 MO" value={newRegionCode} onChange={event => setNewRegionCode(event.target.value.toUpperCase())} maxLength={5} /><input aria-label="地区名称" className="ui-input" placeholder="如 中国澳门" value={newRegionCountry} onChange={event => setNewRegionCountry(event.target.value)} maxLength={60} /></div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}><label style={{ fontSize: 11 }}>币种代码<input aria-label="币种代码" className="ui-input" placeholder="如 MOP" value={newRegionCurrency} onChange={event => setNewRegionCurrency(event.target.value.toUpperCase())} maxLength={3} /></label><label style={{ fontSize: 11 }}>或选钱包已有币种<select aria-label="选择已有币种" className="ui-input" value={WALLET_CURRENCIES.includes(newRegionCurrency) ? newRegionCurrency : ""} onChange={event => setNewRegionCurrency(event.target.value)}><option value="">自己输入</option>{WALLET_CURRENCIES.map(currency => <option key={currency} value={currency}>{currency}</option>)}</select></label></div>
        {!WALLET_CURRENCIES.includes(newRegionCurrency) && <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 8, marginTop: 8 }}><label style={{ fontSize: 11 }}>参考汇率：1 新币折合多少人民币<input aria-label="参考汇率" className="ui-input" type="number" step="any" min="0.000001" placeholder="自行填写" value={newCurrencyRate} onChange={event => setNewCurrencyRate(event.target.value)} /></label><label style={{ fontSize: 11 }}>显示符号<input aria-label="币种符号" className="ui-input" placeholder="如 MOP$" value={newCurrencySymbol} onChange={event => setNewCurrencySymbol(event.target.value)} maxLength={12} /></label></div>}
        {regionError && <p style={{ fontSize: 11, color: "#dc2626" }}>{regionError}</p>}
        <button type="button" onClick={addShoppingRegion} style={{ width: "100%", padding: 12, border: 0, background: "#ff6b00", color: "white", borderRadius: 12, marginTop: 12 }}>添加并启用</button>
      </div></div>}

      {drawerOpen && <div className="cp-shopping-translation-overlay" role="presentation" onClick={() => setDrawerOpen(false)} style={{ zIndex: 102, justifyContent: "flex-end" }}><div role="dialog" aria-modal="true" aria-label="我的与购物设置" onClick={event => event.stopPropagation()} style={{ background: "#fff", width: "min(82vw, 330px)", height: "100%", padding: "65px 20px 24px", boxSizing: "border-box", display: "grid", alignContent: "start", gap: 10, overflowY: "auto" }}>
        <strong style={{ fontSize: 18 }}>我的与购物设置</strong>
        <span style={{ fontSize: 12, color: "#777" }}>本月购物支出 · {formatCurrencyAmount(state.orders.filter(order => order.paidAt && !order.canceledAt && new Date(order.paidAt).getMonth() === new Date().getMonth() && new Date(order.paidAt).getFullYear() === new Date().getFullYear()).reduce((sum, order) => sum + exchangeWalletAmount(parseShoppingAmount(order.totalLabel), order.currency || "CNY", currentRegion.currency), 0), currentRegion.currency)}（参考换算）</span>
        <button type="button" onClick={() => { setDrawerOpen(false); setSelectedTab("account"); }} style={{ padding: 13, border: "1px solid #eee", borderRadius: 12, background: "#fff", textAlign: "left" }}>♡ 我的收藏</button>
        <button type="button" onClick={() => { setDrawerOpen(false); setSelectedTab("items"); }} style={{ padding: 13, border: "1px solid #eee", borderRadius: 12, background: "#fff", textAlign: "left" }}>▣ 我的物品与仓库</button>
        <button type="button" onClick={() => { setDrawerOpen(false); setAddressOwnerId(""); setAddressDraft({ name: "", phone: "", country: currentRegion.country, city: "", street: "" }); setAddressOpen(true); }} style={{ padding: 13, border: "1px solid #eee", borderRadius: 12, background: "#fff", textAlign: "left" }}>⌂ 地址管理 · {state.addresses.length} 个</button>
        {state.addresses.length > 0 && <div style={{ fontSize: 11, color: "#777" }}>{state.addresses.map(address => <div key={address.id} style={{ marginBottom: 8 }}>{shoppingAddressLabel(address)} <button type="button" onClick={() => persist(current => ({ ...current, addresses: current.addresses.filter(item => item.id !== address.id) }))} style={{ border: 0, color: "#dc2626", background: "transparent" }}>删除</button></div>)}</div>}
        <button type="button" onClick={() => { setDrawerOpen(false); setRegionEditorOpen(true); }} style={{ padding: 13, border: "1px solid #eee", borderRadius: 12, background: "#fff", textAlign: "left" }}>◎ 切换地区与币种</button>
        <button type="button" onClick={() => { setDrawerOpen(false); openPromptSettings("shop"); }} style={{ padding: 13, border: "1px solid #eee", borderRadius: 12, background: "#fff", textAlign: "left" }}>Shopping 购物指令</button>
        <button type="button" onClick={() => { setDrawerOpen(false); openPromptSettings("food"); }} style={{ padding: 13, border: "1px solid #eee", borderRadius: 12, background: "#fff", textAlign: "left" }}>外卖购物指令</button>
        <button type="button" onClick={() => { setDrawerOpen(false); setClearConfirmOpen(true); }} style={{ padding: 12, border: 0, background: "#fff", color: "#dc2626", textAlign: "left" }}>清空购物痕迹</button>
        <button type="button" onClick={() => setDrawerOpen(false)} style={{ marginTop: 8, padding: 12, border: 0, borderRadius: 12, background: "#f4f4f4" }}>关闭</button>
      </div></div>}

      {foodCheckoutOpen && <div className="cp-shopping-translation-overlay" role="presentation" onClick={() => setFoodCheckoutOpen(false)} style={{ zIndex: 102 }}><div className="cp-shopping-translation-sheet" role="dialog" aria-modal="true" aria-label="外卖结算" onClick={event => event.stopPropagation()} style={{ maxHeight: "80vh", overflowY: "auto" }}>
        <div className="cp-shopping-translation-head"><span>外卖结算 · {formatCurrencyAmount(foodPayable, foodCurrency)}</span><button type="button" onClick={() => setFoodCheckoutOpen(false)}>关闭</button></div>
        <label style={{ display: "grid", gap: 5, fontSize: 12 }}>送给谁<select className="ui-input" value={recipientId} onChange={event => { setRecipientId(event.target.value); setRecipientAddressId(""); }}><option value="">送给自己</option>{loadCharacters().map(character => <option key={character.id} value={character.id}>{character.name}</option>)}</select></label>
        <label style={{ display: "grid", gap: 5, fontSize: 12, marginTop: 12 }}>收餐地址<select className="ui-input" value={recipientId ? currentRecipientAddress?.id || "" : deliveryFrom?.id || ""} onChange={event => recipientId ? setRecipientAddressId(event.target.value) : setSenderAddressId(event.target.value)}><option value="">请选择地址</option>{(recipientId ? recipientAddresses : shopperAddresses).map(address => <option value={address.id} key={address.id}>{shoppingAddressLabel(address)}</option>)}</select></label>
        <button type="button" onClick={() => { setAddressOwnerId(recipientId); setAddressDraft({ name: ownerName || "", phone: "", country: currentRegion.country, city: "", street: "" }); setAddressOpen(true); }} style={{ border: 0, padding: 10, marginTop: 9, background: "#fff3e9", borderRadius: 10, color: "#b45309" }}>＋ 添加收餐地址</button>
        {recipientId && <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, marginTop: 12 }}><input type="checkbox" checked={notifyRecipient} onChange={event => setNotifyRecipient(event.target.checked)} />通知对方（Chat 外卖卡）</label>}
        <div style={{ display: "flex", gap: 8, marginTop: 14 }}><button type="button" onClick={() => setSelectedPaymentSourceId(WALLET_BALANCE_ACCOUNT_ID)} style={{ flex: 1, border: selectedPaymentSourceId === WALLET_BALANCE_ACCOUNT_ID ? "1px solid #ff6b00" : "1px solid #ddd", borderRadius: 12, padding: 10, background: "#fff" }}>储蓄卡</button>{walletState.creditEnabled && <button type="button" onClick={() => setSelectedPaymentSourceId("wallet_credit_card")} style={{ flex: 1, border: selectedPaymentSourceId === "wallet_credit_card" ? "1px solid #ff6b00" : "1px solid #ddd", borderRadius: 12, padding: 10, background: "#fff" }}>信用卡</button>}</div>
        {paymentError && <p style={{ fontSize: 12, color: "#dc2626" }}>{paymentError}</p>}
        <button type="button" onClick={checkoutFood} style={{ width: "100%", border: 0, padding: 13, marginTop: 14, borderRadius: 14, color: "#fff", background: "#ff6b00" }}>确认付款并下单</button>
      </div></div>}
    </div>
  );
}
