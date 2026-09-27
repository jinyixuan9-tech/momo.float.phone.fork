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
import { createOrGetSession, pushChatMessage } from "@/lib/chat-storage";
import {
  DEFAULT_SHOPPING_REFRESH_PROMPT,
  DEFAULT_SHOPPING_SEARCH_PROMPT,
  generateShoppingCatalog,
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
import { announceShoppingGift, shoppingAddressLabel, shoppingDeliveryEstimate, shippingTimelineForOrder, syncShoppingDeliveries } from "@/lib/shopping-delivery";
import { loadDeliveredShoppingGifts, type ShoppingGiftCandidate } from "@/lib/shopping-gift-utils";
import {
  formatWalletAmount,
  getWalletBalance,
  loadWalletState,
  payWithWalletAccount,
  WALLET_BALANCE_ACCOUNT_ID,
  WALLET_UPDATED_EVENT,
  formatCurrencyAmount,
  recordWalletPayment,
  getWalletCurrencyBalance,
  exchangeWalletAmount,
} from "@/lib/wallet-storage";
import type { WalletCurrency, WalletState } from "@/lib/wallet-types";

type ShoppingAppProps = {
  onClose: (isBusy?: boolean) => void;
  visible?: boolean;
  onIdle?: () => void;
  onBusyChange?: (isBusy: boolean) => void;
};

type ShoppingTabId = "home" | "orders" | "cart" | "account" | "items";
type ShoppingSectionSearchTabId = Exclude<ShoppingTabId, "home">;

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
  { id: "home", label: "Home", icon: Home },
  { id: "orders", label: "Orders", icon: Truck },
  { id: "cart", label: "Cart", icon: ShoppingCart },
  { id: "account", label: "Favorites", icon: Heart },
  { id: "items", label: "我的物品", icon: Home },
];

const SHOPPING_SECTION_SEARCH_PLACEHOLDERS: Record<ShoppingSectionSearchTabId, string> = {
  orders: "搜索订单",
  cart: "搜索购物车",
  account: "搜索收藏",
  items: "搜索我的物品",
};

const REGION_OPTIONS: Record<ShoppingRegion, { label: string; country: string; currency: WalletCurrency; prompt: string }> = {
  CN: { label: "中国 · Shopping", country: "中国", currency: "CNY", prompt: "中国购物平台风格；商品文案以中文为主，价格必须以人民币 ¥ 表示。" },
  KR: { label: "韩国 · Shopping", country: "韩国", currency: "KRW", prompt: "韩国购物平台风格；商家与商品文案优先韩文，价格必须是合理的韩元 ₩ 整数，可附中文译文。" },
  JP: { label: "日本 · Shopping", country: "日本", currency: "JPY", prompt: "日本购物平台风格；商家与商品文案优先日文，价格必须是合理的日元 ¥ 整数，可附中文译文。" },
  US: { label: "美国 · Shopping", country: "美国", currency: "USD", prompt: "美国购物平台风格；商家与商品文案优先英文，价格必须以美元 $ 表示，可附中文译文。" },
};

function isShoppingSectionSearchTab(tab: ShoppingTabId): tab is ShoppingSectionSearchTabId {
  return tab !== "home";
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
    const key = product.id || `${product.title}|${product.merchantLabel}|${product.priceLabel}`;
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
  const [loaded, setLoaded] = useState(false);
  const [loadingTask, setLoadingTask] = useState<"refresh" | "search" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [debugRawOutput, setDebugRawOutput] = useState<string | null>(null);
  const [selectedTab, setSelectedTab] = useState<ShoppingTabId>("home");
  const [selectedProduct, setSelectedProduct] = useState<ShoppingProductDetail | null>(null);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [translationPreview, setTranslationPreview] = useState<ShoppingTranslationPreview | null>(null);
  const [promptOpen, setPromptOpen] = useState(false);
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
  const [sectionSearchInputs, setSectionSearchInputs] = useState<Record<ShoppingSectionSearchTabId, string>>({
    orders: "",
    cart: "",
    account: "",
    items: "",
  });
  const [selectedCategoryId, setSelectedCategoryId] = useState("all");
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
      setSelectedPaymentSourceId(current => current === WALLET_BALANCE_ACCOUNT_ID || next.cards.some(card => card.id === current)
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

  const cartTotals = useMemo(() => {
    const orderAmount = state.cartItems.reduce(
      (sum, item) => sum + parseShoppingAmount(item.priceLabel) * parseShoppingQuantity(item.quantityLabel),
      0,
    );
    return { orderAmount, totalPayment: orderAmount };
  }, [state.cartItems]);
  const cartCurrency = state.cartItems[0]?.currency || REGION_OPTIONS[state.region].currency;
  const shopperAddresses = state.addresses.filter(address => !address.ownerId);
  const recipientAddresses = state.addresses.filter(address => address.ownerId === recipientId);
  const currentRecipientAddress = recipientAddresses.find(address => address.id === recipientAddressId) || recipientAddresses[0];
  const ownerName = loadCharacters().find(person => person.id === recipientId)?.name;
  const deliveryFrom = shopperAddresses.find(address => address.id === senderAddressId) || shopperAddresses[0];
  const storeAddress: ShoppingAddress = { country: REGION_OPTIONS[state.region].country, city: "", street: "", name: "商家", phone: "", id: "store" };
  const checkoutAddress = recipientId ? currentRecipientAddress : deliveryFrom;
  const deliveryEstimate = checkoutAddress ? shoppingDeliveryEstimate(storeAddress, checkoutAddress) : null;
  const shippingFee = deliveryEstimate ? exchangeWalletAmount(deliveryEstimate.fee, "CNY", cartCurrency) : 0;
  const checkoutTotal = cartTotals.totalPayment + shippingFee;
  const warehouseGifts = selectedTab === "items" ? loadDeliveredShoppingGifts() : [];
  const selectedPaymentSource = useMemo(
    () => selectedPaymentSourceId === WALLET_BALANCE_ACCOUNT_ID
      ? {
          id: WALLET_BALANCE_ACCOUNT_ID,
          title: "余额支付",
          balance: getWalletBalance(walletState),
          description: "红包、转账也默认使用余额",
        }
      : (() => {
          const card = walletState.cards.find(item => item.id === selectedPaymentSourceId) ?? walletState.cards[0];
          return card
            ? {
                id: card.id,
                title: card.title,
                balance: card.balance,
                description: `${getWalletCardDisplayNumber(card.maskedNumber)} · 银行卡`,
              }
            : null;
        })(),
    [selectedPaymentSourceId, walletState],
  );
  const selectedPaymentSourceCanPay = Boolean(selectedPaymentSource && (selectedPaymentSource.id === WALLET_BALANCE_ACCOUNT_ID
    ? (cartCurrency === "CNY" ? walletState.balance : getWalletCurrencyBalance(walletState, cartCurrency)) >= checkoutTotal || (walletState.primaryCurrency === "CNY" ? walletState.balance : getWalletCurrencyBalance(walletState, walletState.primaryCurrency)) >= exchangeWalletAmount(checkoutTotal, cartCurrency, walletState.primaryCurrency)
    : selectedPaymentSource.balance >= exchangeWalletAmount(checkoutTotal, cartCurrency, "CNY")));

  const savedIds = useMemo(() => new Set(state.savedItems.map(item => item.id)), [state.savedItems]);
  const cartIds = useMemo(() => new Set(state.cartItems.map(item => item.id)), [state.cartItems]);
  const loading = loadingTask !== null;
  const loadingLabel = loadingTask === "search" ? "正在搜索新物品" : "正在刷新商品";
  const catalogCategories: ShoppingCategory[] = state.catalog.categories.length > 0
    ? state.catalog.categories
    : state.catalog.recommendations.length > 0
      ? [{ id: "featured", title: "精选推荐", subtitle: "为你推荐", items: state.catalog.recommendations }]
      : [];
  const visibleCatalogCategories = selectedCategoryId === "all"
    ? catalogCategories
    : catalogCategories.filter(category => category.id === selectedCategoryId || category.title === selectedCategoryId);
  const searchResultProducts = state.searchResult?.items ?? [];
  const allCatalogProducts = mergeShoppingProducts(searchResultProducts, catalogCategories.flatMap(category => category.items));
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

  async function handleRefresh() {
    if (loading) return;
    setLoadingTask("refresh");
    setError(null);
    setDebugRawOutput(null);
    const region = state.region;
    const result = await generateShoppingCatalog(`${state.settings.refreshPrompt}\n\n地区模式：${REGION_OPTIONS[region].prompt}`);
    if (result.catalog) {
      const catalog = { ...result.catalog, categories: result.catalog.categories.map(category => ({ ...category, items: category.items.map(item => ({ ...item, currency: REGION_OPTIONS[region].currency })) })), recommendations: result.catalog.recommendations.map(item => ({ ...item, currency: REGION_OPTIONS[region].currency })) };
      persist(current => ({
        ...current,
        catalog,
        catalogsByRegion: { ...current.catalogsByRegion, [region]: catalog },
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
    const query = searchInput.trim();
    if (!query || loading || blackMarketTransition) return;
    if (isBlackMarketSearchTrigger(query)) {
      enterBlackMarketFromSearch();
      return;
    }
    setLoadingTask("search");
    setError(null);
    setDebugRawOutput(null);
    const region = state.region;
    const result = await generateShoppingSearchResults(query, `${state.settings.searchPrompt}\n\n地区模式：${REGION_OPTIONS[region].prompt}`);
    if (result.result) {
      persist(current => ({
        ...current,
        searchResult: { ...result.result!, items: result.result!.items.map(item => ({ ...item, currency: REGION_OPTIONS[region].currency })) },
      }));
      setSelectedCategoryId("search");
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
        refreshPrompt: promptDrafts.refreshPrompt.trim() || DEFAULT_SHOPPING_REFRESH_PROMPT,
        searchPrompt: promptDrafts.searchPrompt.trim() || DEFAULT_SHOPPING_SEARCH_PROMPT,
        ...deliverySettings,
      },
    }));
    setPromptOpen(false);
  }

  function clearAllShoppingTraces() {
    // 保留设置（提示词/配送时间），其余全部重置：商城目录、搜索结果、收藏与喜欢、购物车、订单
    persist(current => ({ ...createDefaultShoppingState(), settings: current.settings, region: current.region, addresses: current.addresses,
      shipments: current.shipments, orders: current.orders.filter(order => Boolean(order.recipientCharacterId && !order.deliveryNoticeSentAt)) }));
    setSelectedProduct(null);
    setSelectedOrderId(null);
    setSelectedTab("home");
    setSelectedCategoryId("all");
    setSectionSearchInputs({ orders: "", cart: "", account: "", items: "" });
    setClearConfirmOpen(false);
  }

  function openPromptSettings() {
    setSettingsTab("prompts");
    setExpandedPrompts(new Set());
    setPromptDrafts({
      refreshPrompt: state.settings.refreshPrompt,
      searchPrompt: state.settings.searchPrompt,
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
      refreshPrompt: DEFAULT_SHOPPING_REFRESH_PROMPT,
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
    const item = { ...baseProduct(product), currency: product.currency || REGION_OPTIONS[state.region].currency };
    if (state.cartItems.length > 0 && (state.cartItems[0].currency || "CNY") !== item.currency) {
      setError("购物车已有其他币种商品，请先结算或清空购物车。");
      return;
    }
    persist(current => {
      const exists = current.cartItems.find(cartItem => cartItem.id === item.id);
      return {
        ...current,
        cartItems: exists
          ? current.cartItems.map(cartItem => cartItem.id === item.id
            ? { ...cartItem, quantityLabel: cartQuantityLabel(parseShoppingQuantity(cartItem.quantityLabel) + 1) }
            : cartItem)
          : [productAsCartItem(item), ...current.cartItems],
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
    if (state.cartItems.length === 0) return;
    const nextWalletState = loadWalletState();
    setWalletState(nextWalletState);
    setSelectedPaymentSourceId(WALLET_BALANCE_ACCOUNT_ID);
    setPaymentError(null);
    setRecipientId("");
    setRecipientAddressId("");
    setConfirmCheckoutOpen(true);
  }

  function switchRegion(region: ShoppingRegion) {
    if (region === state.region) return;
    persist(current => ({ ...current, region, catalog: current.catalogsByRegion[region] || { categories: [], recommendations: [] },
      catalogsByRegion: { ...current.catalogsByRegion, [current.region]: current.catalog }, searchResult: undefined }));
    setSelectedCategoryId("all");
    setSelectedProduct(null);
    setSearchInput("");
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
      previewIcon: shipGift.previewIcon, tone: shipGift.tone, quantityLabel: "× 1" };
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
    if (state.cartItems.length === 0) return;
    const targets = loadCharacters();
    setPaymentRequestTargets(targets);
    setSelectedPaymentRequestTargetId(targets[0]?.id ?? "");
    setPaymentRequestError(null);
    setPaymentRequestOpen(true);
  }

  function sendPaymentRequest() {
    if (state.cartItems.length === 0) return;
    const target = paymentRequestTargets.find(item => item.id === selectedPaymentRequestTargetId);
    if (!target) {
      setPaymentRequestError("请选择代付对象。");
      return;
    }
    const paymentRequestedAt = new Date().toISOString();
    const paymentRequestId = createShoppingPaymentRequestId();
    const order = buildOrderFromCart(
      state.cartItems,
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
      cartItems: [],
    }));
    setSelectedTab("orders");
    setSelectedOrderId(order.id);
    setPaymentRequestOpen(false);
    setPaymentRequestError(null);
  }

  function handleCheckout() {
    if (state.cartItems.length === 0) return;
    if (recipientId && !currentRecipientAddress) { setPaymentError("请先添加并选择收件地址。"); return; }
    if (!recipientId && !deliveryFrom) { setPaymentError("请先添加我的收件地址。"); return; }
    const order = buildOrderFromCart(state.cartItems, formatShoppingAmount(checkoutTotal, cartCurrency), state.settings);
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
      sourceCurrency: paymentSource.id === WALLET_BALANCE_ACCOUNT_ID ? undefined : "CNY",
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
      paymentCardLabel: paymentSource.id === WALLET_BALANCE_ACCOUNT_ID ? "余额支付" : `${paymentSource.title}（${paymentSource.description.replace(" · 银行卡", "")}）`,
      paymentTransactionId: paymentResult.transaction.id,
      paidAt: paymentResult.transaction.createdAt,
    };
    persist(current => ({
      ...current,
      orders: [paidOrder, ...current.orders],
      cartItems: [],
    }));
    if (recipientId && notifyRecipient) {
      for (const item of paidOrder.items) announceShoppingGift(recipientId, item, `${paidOrder.id}::${item.id}::notice`, paidOrder.recipientName || "收件人");
    }
    setSelectedTab("orders");
    setSelectedOrderId(paidOrder.id);
    setPaymentError(null);
    setConfirmCheckoutOpen(false);
  }

  function openProduct(product: ShoppingProduct | ShoppingCartItem | ShoppingOrder["items"][number], defaults?: { tagLabel?: string; detailLabel?: string }) {
    setTranslationPreview(null);
    setSelectedProduct(toProductDetail(product, defaults));
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
      : () => onClose(loading);

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
            right: "12px",
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
              addToCart(item);
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
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: "var(--page-header-content-height, 42px)", marginTop: "var(--page-header-safe-top, 48px)", padding: "1px 24px" }}>
        {!selectedProduct && !activeOrder && selectedTab === "home" ? (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <button type="button" aria-label="返回" onClick={backAction} style={{ width: "40px", height: "40px", borderRadius: "50%", border: "1px solid #eaeaea", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", color: "#333" }}>
                <ChevronLeft size={22} strokeWidth={2.5} />
              </button>
              <div style={{ display: "flex", flexDirection: "column" }}>
                <span style={{ fontSize: "calc(12px*var(--app-text-scale,1))", color: "#888" }}>Welcome Back</span>
                <strong style={{ fontSize: "calc(18px*var(--app-text-scale,1))", color: "#222", lineHeight: 1.15 }}>Shopping</strong>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <select aria-label="购物地区" value={state.region} onChange={event => switchRegion(event.target.value as ShoppingRegion)} style={{ maxWidth: 105, border: "1px solid #eee", borderRadius: 14, padding: "9px 5px", background: "#fff", fontSize: 11 }}>
                {(Object.keys(REGION_OPTIONS) as ShoppingRegion[]).map(region => <option key={region} value={region}>{REGION_OPTIONS[region].label}</option>)}
              </select>
              <button type="button" aria-label="清空购物痕迹" onClick={() => setClearConfirmOpen(true)} style={{ width: "40px", height: "40px", borderRadius: "50%", border: "1px solid #eaeaea", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", color: "#333" }}>
                <Trash2 size={18} strokeWidth={2.2} />
              </button>
              <button type="button" aria-label="提示词设置" onClick={() => openPromptSettings()} style={{ width: "40px", height: "40px", borderRadius: "50%", border: "1px solid #eaeaea", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", color: "#333" }}>
                <MoreHorizontal size={21} strokeWidth={2.35} />
              </button>
            </div>
          </>
        ) : (
          <>
            <button type="button" aria-label="返回" onClick={backAction} style={{ width: "40px", height: "40px", borderRadius: "50%", border: "1px solid #eaeaea", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", color: "#333" }}>
              <ChevronLeft size={22} strokeWidth={2.5} />
            </button>
            <div style={{ flex: 1, minWidth: 0, marginLeft: "12px", display: "flex", alignItems: "center", background: "#fff", borderRadius: "20px", padding: "0 14px", height: "40px", color: "#999", fontSize: "calc(13px*var(--app-text-scale,1))", gap: "10px", boxShadow: "0 3px 12px rgba(0,0,0,0.018)" }}>
              <Search size={17} />
              {!selectedProduct && !activeOrder && isShoppingSectionSearchTab(selectedTab) ? (
                <input
                  aria-label={SHOPPING_SECTION_SEARCH_PLACEHOLDERS[selectedTab]}
                  value={sectionSearchInputs[selectedTab]}
                  onChange={event => setSectionSearchInputs(current => ({
                    ...current,
                    [selectedTab]: event.target.value,
                  }))}
                  placeholder={SHOPPING_SECTION_SEARCH_PLACEHOLDERS[selectedTab]}
                  style={{ flex: 1, minWidth: 0, border: "none", outline: "none", background: "transparent", color: "#222", fontSize: "calc(13px*var(--app-text-scale,1))", height: "38px" }}
                />
              ) : (
                <span style={{ flex: 1 }}>{topSubtitle}</span>
              )}
            </div>
          </>
        )}
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
            {selectedTab === "home" ? (
              <div style={{ padding: "0 24px", marginTop: "-4px", marginBottom: "16px" }}>
                <form onSubmit={handleSearch} style={{ display: "flex", alignItems: "center", background: "#fff", borderRadius: "22px", padding: "0 8px 0 14px", minHeight: "40px", color: "#999", fontSize: "calc(13px*var(--app-text-scale,1))", gap: "8px", boxShadow: "0 3px 12px rgba(0,0,0,0.018)" }}>
                  <Search size={17} />
                  <input
                    aria-label="搜索商品"
                    value={searchInput}
                    onChange={event => {
                      const nextValue = event.target.value;
                      setSearchInput(nextValue);
                      if (selectedCategoryId !== "all") {
                        setSelectedCategoryId("all");
                      }
                    }}
                    placeholder="搜索商品"
                    disabled={loading || blackMarketTransition}
                    style={{ flex: 1, minWidth: 0, border: "none", outline: "none", background: "transparent", color: "#222", fontSize: "calc(13px*var(--app-text-scale,1))", height: "38px" }}
                  />
                  <button type="submit" disabled={!searchInput.trim() || loading || blackMarketTransition} style={{ border: "none", background: searchInput.trim() && !loading && !blackMarketTransition ? "#ff6b00" : "#eee", color: searchInput.trim() && !loading && !blackMarketTransition ? "#fff" : "#aaa", borderRadius: "16px", height: "30px", padding: "0 12px", minWidth: "88px", fontSize: "calc(12px*var(--app-text-scale,1))", fontWeight: 700, whiteSpace: "nowrap" }}>
                    搜索新物品
                  </button>
                </form>
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
                    ...(state.searchResult?.items.length ? [{ id: "search", title: `搜索：${state.searchResult.query}` }] : []),
                    ...SHOPPING_RECOMMENDATION_CATEGORIES,
                  ].map(category => {
                    const active = selectedCategoryId === category.id;
                    return (
                      <button
                        key={category.id}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        onClick={() => setSelectedCategoryId(category.id)}
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

              {selectedTab === "cart" && (
                <section style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                  <h2 style={{ fontSize: "calc(19px*var(--app-text-scale,1))", fontWeight: "bold", color: "#222", margin: "0 0 8px 4px" }}>Cart</h2>
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
                  {filteredCartItems.map(item => (
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
                        <span style={{ color: "#222", fontWeight: 500 }}>{formatShoppingAmount(cartTotals.orderAmount)}</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "calc(14px*var(--app-text-scale,1))", color: "#222", fontWeight: "bold", borderTop: "1px dashed #eee", paddingTop: "16px", marginBottom: "24px" }}>
                        <span>Total Payment</span>
                        <span>{formatShoppingAmount(cartTotals.totalPayment)}</span>
                      </div>
                      <div style={{ display: "grid", gap: "10px" }}>
                        <button type="button" onClick={openCheckoutSheet} style={{ width: "100%", background: "#ff6b00", color: "#fff", borderRadius: "24px", padding: "14px 0", fontSize: "calc(14px*var(--app-text-scale,1))", fontWeight: "bold", border: "none" }}>Checkout</button>
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

              {selectedTab === "orders" && (
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
                  {filteredOrders.map(order => {
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
                {warehouseGifts.map(gift => <div key={gift.id} style={{ padding: 15, background: "#fff", borderRadius: 15, display: "flex", gap: 10, alignItems: "center" }}><span style={{ fontSize: 25 }}>{gift.previewIcon}</span><div style={{ flex: 1, minWidth: 0 }}><strong>{gift.productName}</strong><p style={{ margin: "3px 0", color: "#888", fontSize: 11 }}>{gift.source === "character" ? "角色送来" : gift.merchantLabel} · {gift.priceLabel}</p></div><button type="button" onClick={() => { setShipGift(gift); setRecipientId(""); setRecipientAddressId(""); setPaymentError(null); }} style={{ border: 0, borderRadius: 12, padding: "9px 10px", background: "#111", color: "#fff" }}>转送</button></div>)}
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

            {selectedTab === "home" ? (
              <button
                type="button"
                aria-label="刷新首页推荐"
                onClick={() => setConfirmRefreshOpen(true)}
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

              <div style={{ borderTop: "1px solid #f0f0f0", paddingTop: "16px", marginBottom: "20px" }}>
                <h3 style={{ fontSize: "calc(14px*var(--app-text-scale,1))", fontWeight: "bold", color: "#222", marginBottom: "8px" }}>{selectedProduct.detailLabel || "Description"}</h3>
                <p style={{ fontSize: "calc(13px*var(--app-text-scale,1))", color: "#666", lineHeight: 1.5, margin: 0 }}>
                  <CheckPhoneBilingualText text={selectedProduct.detail || selectedProduct.subtitle} tone="shopping" />
                </p>
              </div>

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
              <span>购物设置</span>
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

            {selectedPaymentSource && cartCurrency !== "CNY" && <p style={{ fontSize: 11, color: "#777", margin: "-4px 2px 12px" }}>
              {selectedPaymentSource.id !== WALLET_BALANCE_ACCOUNT_ID
                ? `银行卡实际扣款约 ${formatCurrencyAmount(exchangeWalletAmount(checkoutTotal, cartCurrency, "CNY"), "CNY")}`
                : getWalletCurrencyBalance(walletState, cartCurrency) >= checkoutTotal
                  ? `优先使用 ${cartCurrency} 余额付款`
                  : `余额不足，按参考汇率从主币种 ${walletState.primaryCurrency} 扣约 ${formatCurrencyAmount(exchangeWalletAmount(checkoutTotal, cartCurrency, walletState.primaryCurrency), walletState.primaryCurrency)}`}
            </p>}

            <div style={{ display: "grid", gap: 9, marginBottom: 14, fontSize: 12 }}>
              <label>购买给谁<select className="ui-input" value={recipientId} onChange={event => { setRecipientId(event.target.value); setRecipientAddressId(""); }}><option value="">买给自己（到货后进入我的物品）</option>{loadCharacters().map(person => <option key={person.id} value={person.id}>直接寄给 {person.name}</option>)}</select></label>
              <label>收件地址<select className="ui-input" value={recipientId ? currentRecipientAddress?.id || "" : deliveryFrom?.id || ""} onChange={event => recipientId ? setRecipientAddressId(event.target.value) : setSenderAddressId(event.target.value)}><option value="">请选择地址</option>{(recipientId ? recipientAddresses : shopperAddresses).map(address => <option value={address.id} key={address.id}>{shoppingAddressLabel(address)}</option>)}</select></label>
              <button type="button" onClick={() => { setAddressOwnerId(recipientId); setAddressDraft({ name: recipientId ? ownerName || "" : "", phone: "", country: REGION_OPTIONS[state.region].country, city: "", street: "" }); setAddressOpen(true); }} style={{ border: "1px solid #ddd", background: "#fff", borderRadius: 12, padding: 9 }}>＋ 新建{recipientId ? "角色" : "我的"}地址</button>
              {recipientId && <><label style={{ display: "flex", justifyContent: "space-between" }}>寄出时通知对方（Chat 礼物卡）<input type="checkbox" checked={notifyRecipient} onChange={event => setNotifyRecipient(event.target.checked)} /></label>{deliveryEstimate && <span style={{ color: "#777" }}>预计 {deliveryEstimate.days} 天到达 · 运费约 {formatCurrencyAmount(shippingFee, cartCurrency)}（参考估算）</span>}</>}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "10px", maxHeight: "42vh", overflowY: "auto", paddingRight: "2px" }}>
              {[
                {
                  id: WALLET_BALANCE_ACCOUNT_ID,
                  title: "余额支付",
                  description: "红包、转账默认使用余额",
                  balance: cartCurrency === "CNY" ? walletState.balance : getWalletCurrencyBalance(walletState, cartCurrency),
                  icon: <CreditCard size={20} />,
                },
                ...walletState.cards.map(card => ({
                  id: card.id,
                  title: card.title,
                  description: `${getWalletCardDisplayNumber(card.maskedNumber)} · 银行卡`,
                  balance: card.balance,
                  icon: <WalletCards size={20} />,
                })),
              ].map(source => {
                const active = selectedPaymentSource?.id === source.id;
                const required = source.id === WALLET_BALANCE_ACCOUNT_ID ? checkoutTotal : exchangeWalletAmount(checkoutTotal, cartCurrency, "CNY");
                const insufficient = source.balance < required && !(source.id === WALLET_BALANCE_ACCOUNT_ID && (walletState.primaryCurrency === "CNY" ? walletState.balance : getWalletCurrencyBalance(walletState, walletState.primaryCurrency)) >= exchangeWalletAmount(checkoutTotal, cartCurrency, walletState.primaryCurrency));
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
                      <span style={{ fontSize: "calc(11px*var(--app-text-scale,1))", color: "#888" }}>{source.description} · 可用 {formatCurrencyAmount(source.balance, source.id === WALLET_BALANCE_ACCOUNT_ID ? cartCurrency : "CNY")}</span>
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
                <strong style={{ fontSize: "calc(22px*var(--app-text-scale,1))", color: "#222", lineHeight: 1 }}>{formatShoppingAmount(cartTotals.totalPayment)}</strong>
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

      {confirmRefreshOpen && (
        <ConfirmDialog
          title="刷新首页推荐？"
          message="将重新生成首页分类推荐。收藏、购物车和订单不会受影响。"
          variant="action"
          confirmLabel="刷新"
          cancelLabel="取消"
          onConfirm={() => {
            setConfirmRefreshOpen(false);
            void handleRefresh();
          }}
          onCancel={() => setConfirmRefreshOpen(false)}
        />
      )}
    </div>
  );
}
