import type {
  CheckPhoneShoppingCartItem,
  CheckPhoneShoppingOrder,
  CheckPhoneShoppingShippingEvent,
  CheckPhoneShoppingPayload,
  CheckPhoneShoppingProduct,
} from "./checkphone-config";
import type { WalletCurrency } from "./wallet-types";

export type ShoppingRegion = "CN" | "KR" | "JP" | "US";
export type ShoppingAddress = { id: string; ownerId?: string; name: string; phone: string; country: string; city: string; street: string; isDefault?: boolean };
export type ShoppingShipment = {
  id: string; sourceOrderId?: string; giftId?: string; item: ShoppingCartItem;
  senderAddressId?: string; recipientCharacterId: string; recipientAddressId: string;
  recipientName: string; recipientAddressLabel: string; notifyRecipient: boolean;
  sentAt: string; deliverAt: string; noticeSentAt?: string;
};

export type ShoppingProduct = CheckPhoneShoppingProduct;
export type ShoppingCartItem = CheckPhoneShoppingCartItem;
export type ShoppingOrder = CheckPhoneShoppingOrder;
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
