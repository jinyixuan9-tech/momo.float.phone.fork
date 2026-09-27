import type {
  CheckPhoneShoppingCartItem,
  CheckPhoneShoppingOrder,
  CheckPhoneShoppingShippingEvent,
  CheckPhoneShoppingPayload,
  CheckPhoneShoppingProduct,
} from "./checkphone-config";
import type { WalletCurrency } from "./wallet-types";

export type ShoppingRegion = "CN" | "KR" | "JP" | "US";
export type ShoppingMode = "shop" | "food";
export type ShoppingCustomCategory = { id: string; title: string; subtitle: string; mode: ShoppingMode; match: "store" | "brand" | "type" };
export type ShoppingVariantGroup = { name: string; options: Array<{ label: string; extra: number }> };
export type ShoppingAddress = { id: string; ownerId?: string; name: string; phone: string; country: string; city: string; street: string; isDefault?: boolean };
export type ShoppingShipment = {
  id: string; sourceOrderId?: string; giftId?: string; item: ShoppingCartItem;
  senderAddressId?: string; recipientCharacterId: string; recipientAddressId: string;
  recipientName: string; recipientAddressLabel: string; notifyRecipient: boolean;
  sentAt: string; deliverAt: string; noticeSentAt?: string;
};

export type ShoppingProduct = CheckPhoneShoppingProduct & { brandLabel?: string; variantGroups?: ShoppingVariantGroup[]; categoryIds?: string[]; mode?: ShoppingMode };
export type ShoppingCartItem = CheckPhoneShoppingCartItem & ShoppingProduct & { selectedOptions?: string[]; unitPrice?: number };
export type ShoppingOrder = CheckPhoneShoppingOrder & { mode?: ShoppingMode; canceledAt?: string; recipientCharacterId?: string; recipientAddressId?: string; recipientName?: string; recipientAddressLabel?: string; notifyRecipient?: boolean; currency?: import("./wallet-types").WalletCurrency };
export type ShoppingShippingEvent = CheckPhoneShoppingShippingEvent;

export type ShoppingCategory = {
  id: string;
  title: string;
  subtitle: string;
  items: ShoppingProduct[];
};

export type ShoppingCatalog = {
  categories: ShoppingCategory[];
  recommendations: ShoppingProduct[];
};

export type ShoppingSettings = {
  refreshPrompt: string;
  searchPrompt: string;
  deliveryMinMinutes: number;
  deliveryMaxMinutes: number;
};

export type ShoppingSearchResult = {
  query: string;
  items: ShoppingProduct[];
  generatedAt: string;
};

export type ShoppingState = {
  catalog: ShoppingCatalog;
  searchResult?: ShoppingSearchResult;
  savedItems: ShoppingProduct[];
  cartItems: ShoppingCartItem[];
  orders: ShoppingOrder[];
  settings: ShoppingSettings;
  generatedAt?: string;
  updatedAt: string;
  region: ShoppingRegion;
  catalogsByRegion: Partial<Record<ShoppingRegion, ShoppingCatalog>>;
  foodCatalogsByRegion: Partial<Record<ShoppingRegion, ShoppingCatalog>>;
  customCategories: ShoppingCustomCategory[];
  dismissedProductKeys: string[];
  foodCartItems: ShoppingCartItem[];
  claimedCoupons: string[];
  usedCoupons: string[];
  addresses: ShoppingAddress[];
  shipments: ShoppingShipment[];
};

export type ShoppingRefreshResult = {
  catalog: ShoppingCatalog | null;
  rawOutput?: string;
  error?: string;
};

export type ShoppingSearchResponse = {
  result: ShoppingSearchResult | null;
  rawOutput?: string;
  error?: string;
};

export type ShoppingPayloadView = CheckPhoneShoppingPayload;
