export type WalletCardStyle = "obsidian" | "graphite" | "silver";
export type WalletCurrency = "CNY" | "KRW" | "JPY" | "USD";

export type WalletCard = {
  id: string;
  title: string;
  bankLabel: string;
  maskedNumber: string;
  cardStyle: WalletCardStyle;
  balance: number;
  note: string;
  accentLabel: string;
  isDefault?: boolean;
  createdAt: string;
  updatedAt: string;
};

export type WalletAccountType = "balance" | "card";

export type WalletTransactionKind = "transfer_in" | "transfer_out" | "payment" | "refund" | "adjustment";

export type WalletTransaction = {
  id: string;
  cardId: string;
  accountType?: WalletAccountType;
  title: string;
  amount: number;
  kind: WalletTransactionKind;
  category: string;
  createdAt: string;
  detail: string;
  balanceAfter: number;
  relatedOrderId?: string;
  currency?: WalletCurrency;
  originalCurrency?: WalletCurrency;
  originalAmount?: number;
  exchangeRate?: number;
  relatedMessageId?: string;
};

export type WalletState = {
  balance: number;
  cards: WalletCard[];
  transactions: WalletTransaction[];
  defaultCardId: string;
  updatedAt: string;
  currencyBalances: Partial<Record<WalletCurrency, number>>;
  primaryCurrency: WalletCurrency;
  displayCurrency: WalletCurrency;
  autoConvertReceived: boolean;
  wealthLevel?: string;
  incomeSources?: string;
  generateLivingTransactions?: boolean;
};

export type WalletPaymentInput = {
  accountId?: string;
  cardId?: string;
  amount: number;
  title: string;
  detail: string;
  category?: string;
  relatedOrderId?: string;
};

export type WalletPaymentResult = {
  ok: boolean;
  state: WalletState;
  transaction?: WalletTransaction;
  error?: string;
};
