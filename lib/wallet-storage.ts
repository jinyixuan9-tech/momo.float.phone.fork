import { kvGet, kvSet, registerDynamicPrefix, registerKvMigration } from "./kv-db";
import type { WalletAccountType, WalletCard, WalletCurrency, WalletPaymentInput, WalletPaymentResult, WalletState, WalletTransaction } from "./wallet-types";

const WALLET_STATE_KEY = "ai_phone_wallet_state_v1";
const LEGACY_DEFAULT_WALLET_CARD_ID = "wallet_default_balance_card";
const DEFAULT_WALLET_BANK_CARD_ID = "wallet_default_bank_card";
const DEFAULT_WALLET_BALANCE = 10000;
const CHARACTER_WALLET_PREFIX = "ai_phone_character_wallet_v1_";
export const WALLET_CURRENCIES: WalletCurrency[] = ["CNY", "KRW", "JPY", "USD", "EUR", "HKD", "TWD", "AUD"];
// Reference rates in CNY, deliberately fixed and shown as estimates in the UI.
export const WALLET_REFERENCE_RATES: Record<WalletCurrency, number> = { CNY: 1, KRW: 0.0052, JPY: 0.047, USD: 7.1, EUR: 8.25, HKD: 0.91, TWD: 0.22, AUD: 4.8 };
export function walletCurrency(value: unknown): WalletCurrency {
  return WALLET_CURRENCIES.includes(value as WalletCurrency) ? value as WalletCurrency : "CNY";
}
export function roundWalletMoney(value: number, currency: WalletCurrency): number {
  return Math.round(value * (currency === "KRW" || currency === "JPY" ? 1 : 100)) / (currency === "KRW" || currency === "JPY" ? 1 : 100);
}
export function exchangeWalletAmount(amount: number, from: WalletCurrency, to: WalletCurrency): number {
  return roundWalletMoney(amount * WALLET_REFERENCE_RATES[from] / WALLET_REFERENCE_RATES[to], to);
}
export function formatCurrencyAmount(amount: number, currency: WalletCurrency): string {
  const symbol: Record<WalletCurrency, string> = { CNY: "¥", KRW: "₩", JPY: "¥", USD: "$", EUR: "€", HKD: "HK$", TWD: "NT$", AUD: "A$" };
  const formatted = Math.abs(amount).toLocaleString("zh-CN", { minimumFractionDigits: currency === "KRW" || currency === "JPY" ? 0 : 2, maximumFractionDigits: currency === "KRW" || currency === "JPY" ? 0 : 2 });
  return `${amount < 0 ? "-" : ""}${symbol[currency]}${formatted}${currency === "JPY" ? " JPY" : ""}`;
}

export const WALLET_BALANCE_ACCOUNT_ID = "wallet_balance_account";
export const WALLET_UPDATED_EVENT = "wallet-state-updated";

registerKvMigration(WALLET_STATE_KEY);
registerDynamicPrefix(CHARACTER_WALLET_PREFIX);

function cleanText(value: unknown, maxLength: number): string {
  return String(value ?? "").replace(/\u0000/g, "").trim().slice(0, maxLength);
}

function normalizeMoney(value: unknown): number {
  const amount = typeof value === "number" ? value : Number(String(value ?? "").replace(/[¥￥元,\s]/g, ""));
  if (!Number.isFinite(amount)) return 0;
  return Math.max(0, Math.round(amount * 100) / 100);
}

function normalizeSignedMoney(value: unknown): number {
  const amount = typeof value === "number" ? value : Number(String(value ?? "").replace(/[¥￥元,\s]/g, ""));
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount * 100) / 100;
}

function generateWalletId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
function validWalletDate(value?: string): string {
  return value && Number.isFinite(Date.parse(value)) && Date.parse(value) <= Date.now() ? new Date(value).toISOString() : new Date().toISOString();
}

function isBalanceAccountId(accountId: string | undefined): boolean {
  return !accountId || accountId === WALLET_BALANCE_ACCOUNT_ID || accountId === LEGACY_DEFAULT_WALLET_CARD_ID;
}

function getAccountType(accountId: string): WalletAccountType {
  return isBalanceAccountId(accountId) ? "balance" : "card";
}

function createDefaultWalletCard(now = new Date().toISOString()): WalletCard {
  return {
    id: DEFAULT_WALLET_BANK_CARD_ID,
    title: "储蓄卡",
    bankLabel: "中国银行",
    maskedNumber: `**** **** **** ${String(Math.floor(Math.random() * 10000)).padStart(4, "0")}`,
    cardStyle: "graphite",
    balance: 0,
    note: "系统自动创建的默认银行卡",
    accentLabel: "储蓄",
    isDefault: true,
    createdAt: now,
    updatedAt: now,
  };
}

function normalizeCard(value: unknown): WalletCard | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const id = cleanText(record.id, 120);
  const title = cleanText(record.title, 80);
  if (!id || !title) return null;
  const normalizedTitle = title === "备用余额卡" ? "储蓄卡" : title;
  const rawStyle = cleanText(record.cardStyle, 40);
  const cardStyle = rawStyle === "graphite" || rawStyle === "silver" ? rawStyle : "obsidian";
  const now = new Date().toISOString();
  return {
    id,
    title: normalizedTitle,
    bankLabel: cleanText(record.bankLabel, 80) || "CHAT WALLET",
    maskedNumber: cleanText(record.maskedNumber, 40) || "**** **** **** 0000",
    cardStyle,
    balance: normalizeMoney(record.balance),
    note: cleanText(record.note, 240),
    accentLabel: cleanText(record.accentLabel, 24) || "储蓄",
    isDefault: record.isDefault === true,
    createdAt: cleanText(record.createdAt, 80) || now,
    updatedAt: cleanText(record.updatedAt, 80) || now,
  };
}

function normalizeTransaction(value: unknown): WalletTransaction | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const id = cleanText(record.id, 120);
  const rawCardId = cleanText(record.cardId, 120);
  const cardId = rawCardId === LEGACY_DEFAULT_WALLET_CARD_ID ? WALLET_BALANCE_ACCOUNT_ID : rawCardId;
  const title = cleanText(record.title, 120);
  const rawKind = cleanText(record.kind, 40);
  const kind = rawKind === "payment" || rawKind === "adjustment" || rawKind === "transfer_out" || rawKind === "refund"
    ? rawKind
    : "transfer_in";
  if (!id || !cardId || !title) return null;
  const rawAccountType = cleanText(record.accountType, 40);
  return {
    id,
    cardId,
    accountType: rawAccountType === "card" || rawAccountType === "balance" ? rawAccountType : getAccountType(cardId),
    title,
    amount: normalizeSignedMoney(record.amount),
    kind,
    category: cleanText(record.category, 80) || "余额",
    createdAt: cleanText(record.createdAt, 80) || new Date().toISOString(),
    detail: cleanText(record.detail, 400),
    balanceAfter: normalizeMoney(record.balanceAfter),
    relatedOrderId: cleanText(record.relatedOrderId, 120) || undefined,
    currency: walletCurrency(record.currency),
    originalCurrency: record.originalCurrency ? walletCurrency(record.originalCurrency) : undefined,
    originalAmount: record.originalAmount == null ? undefined : normalizeMoney(record.originalAmount),
    exchangeRate: typeof record.exchangeRate === "number" && Number.isFinite(record.exchangeRate) ? record.exchangeRate : undefined,
    relatedMessageId: cleanText(record.relatedMessageId, 120) || undefined,
    source: record.source === "generated" || record.source === "manual" ? record.source : "app",
    credit: record.credit === true,
  };
}

function normalizeWalletState(state: WalletState): WalletState {
  const now = new Date().toISOString();
  const cards = state.cards.length > 0 ? state.cards : [createDefaultWalletCard(now)];
  const debitCard = cards.find(card => card.id === state.defaultCardId) || cards[0];
  const defaultCardId = debitCard.id;
  const cnyTotal = normalizeMoney(state.balance) + cards.reduce((sum, card) => sum + normalizeMoney(card.balance), 0);
  return {
    balance: cnyTotal,
    cards: [{ ...debitCard, bankLabel: debitCard.bankLabel === "CHAT WALLET" ? ({ CNY: "中国银行", KRW: "新韩银行", JPY: "三菱UFJ银行", USD: "Chase", EUR: "BNP Paribas", HKD: "汇丰银行", TWD: "中国信托", AUD: "Commonwealth Bank" }[state.primaryCurrency] || "中国银行") : debitCard.bankLabel, isDefault: true, balance: 0, title: "储蓄卡" }],
    transactions: state.transactions.slice().sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
    defaultCardId,
    updatedAt: state.updatedAt || now,
    currencyBalances: Object.fromEntries(WALLET_CURRENCIES.filter(currency => currency !== "CNY").map(currency => [currency, roundWalletMoney(Math.max(0, Number(state.currencyBalances?.[currency]) || 0), currency)])),
    primaryCurrency: walletCurrency(state.primaryCurrency),
    displayCurrency: walletCurrency(state.displayCurrency),
    autoConvertReceived: state.autoConvertReceived === true,
    wealthLevel: cleanText(state.wealthLevel, 120),
    incomeSources: cleanText(state.incomeSources, 500),
    generateLivingTransactions: state.generateLivingTransactions === true,
    commonCurrencies: (state.commonCurrencies || []).filter((currency, index, all) => WALLET_CURRENCIES.includes(currency) && currency !== state.primaryCurrency && all.indexOf(currency) === index),
    creditEnabled: state.creditEnabled === true,
    creditMaskedNumber: state.creditMaskedNumber || undefined,
    creditDebts: Object.fromEntries(WALLET_CURRENCIES.map(currency => [currency, roundWalletMoney(Math.max(0, Number(state.creditDebts?.[currency]) || 0), currency)])),
    lastLivingRefreshAt: state.lastLivingRefreshAt,
    roleAssetsInitialized: state.roleAssetsInitialized === true,
  };
}

export function createDefaultWalletState(): WalletState {
  const now = new Date().toISOString();
  const card = createDefaultWalletCard(now);
  return {
    balance: DEFAULT_WALLET_BALANCE,
    cards: [card],
    transactions: [{
      id: "wallet_initial_balance",
      cardId: WALLET_BALANCE_ACCOUNT_ID,
      accountType: "balance",
      title: "初始余额",
      amount: DEFAULT_WALLET_BALANCE,
      kind: "transfer_in",
      category: "初始化",
      createdAt: now,
      detail: "系统自动创建余额账户",
      balanceAfter: DEFAULT_WALLET_BALANCE,
    }],
    defaultCardId: card.id,
    updatedAt: now,
    currencyBalances: {},
    primaryCurrency: "CNY",
    displayCurrency: "CNY",
    autoConvertReceived: false,
  };
}

function migrateLegacyParsedState(parsed: Record<string, unknown>): WalletState {
  const now = new Date().toISOString();
  const rawCards = Array.isArray(parsed.cards)
    ? parsed.cards.map(normalizeCard).filter((card): card is WalletCard => Boolean(card))
    : [];
  const legacyBalanceCard = rawCards.find(card => card.id === LEGACY_DEFAULT_WALLET_CARD_ID || card.title === "默认余额卡");
  const explicitBalance = normalizeMoney(parsed.balance);
  const balance = typeof parsed.balance === "number" || typeof parsed.balance === "string"
    ? explicitBalance
    : normalizeMoney(legacyBalanceCard?.balance ?? 0);
  const cards = rawCards.filter(card => card.id !== LEGACY_DEFAULT_WALLET_CARD_ID && card.title !== "默认余额卡");
  const normalizedCards = cards.length > 0 ? cards : [createDefaultWalletCard(now)];
  const transactions = Array.isArray(parsed.transactions)
    ? parsed.transactions.map(normalizeTransaction).filter((transaction): transaction is WalletTransaction => Boolean(transaction))
    : [];
  const defaultCardId = cleanText(parsed.defaultCardId, 120);
  return normalizeWalletState({
    balance,
    cards: normalizedCards,
    transactions,
    defaultCardId: normalizedCards.some(card => card.id === defaultCardId) ? defaultCardId : normalizedCards[0].id,
    updatedAt: cleanText(parsed.updatedAt, 80) || now,
    currencyBalances: parsed.currencyBalances && typeof parsed.currencyBalances === "object" ? parsed.currencyBalances as WalletState["currencyBalances"] : {},
    primaryCurrency: walletCurrency(parsed.primaryCurrency),
    displayCurrency: walletCurrency(parsed.displayCurrency),
    autoConvertReceived: parsed.autoConvertReceived === true,
    wealthLevel: cleanText(parsed.wealthLevel, 120),
    incomeSources: cleanText(parsed.incomeSources, 500),
    generateLivingTransactions: parsed.generateLivingTransactions === true,
    commonCurrencies: Array.isArray(parsed.commonCurrencies) ? parsed.commonCurrencies as WalletCurrency[] : [],
    creditEnabled: parsed.creditEnabled === true,
    creditMaskedNumber: cleanText(parsed.creditMaskedNumber, 40) || undefined,
    creditDebts: parsed.creditDebts && typeof parsed.creditDebts === "object" ? parsed.creditDebts as WalletState["creditDebts"] : {},
    lastLivingRefreshAt: cleanText(parsed.lastLivingRefreshAt, 80) || undefined,
    roleAssetsInitialized: parsed.roleAssetsInitialized === true,
  });
}

export function loadWalletState(ownerId?: string): WalletState {
  if (typeof window === "undefined") return createDefaultWalletState();
  try {
    const raw = kvGet(ownerId ? `${CHARACTER_WALLET_PREFIX}${ownerId}` : WALLET_STATE_KEY);
    if (!raw) {
      const next = createDefaultWalletState();
      if (ownerId) { next.balance = 0; next.transactions = []; next.primaryCurrency = "KRW"; next.displayCurrency = "KRW"; next.cards[0].bankLabel = "新韩银行"; }
      saveWalletState(next, ownerId);
      return next;
    }
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const next = migrateLegacyParsedState(parsed);
    if (!("balance" in parsed) || (parsed.cards as unknown[])?.length !== 1 || (parsed.cards as WalletCard[])?.[0]?.balance !== 0) saveWalletState(next, ownerId);
    return next;
  } catch {
    const next = createDefaultWalletState();
    if (ownerId) { next.balance = 0; next.transactions = []; next.primaryCurrency = "KRW"; next.displayCurrency = "KRW"; next.cards[0].bankLabel = "新韩银行"; }
    saveWalletState(next, ownerId);
    return next;
  }
}

export function saveWalletState(state: WalletState, ownerId?: string): WalletState {
  const next = normalizeWalletState({ ...state, updatedAt: new Date().toISOString() });
  kvSet(ownerId ? `${CHARACTER_WALLET_PREFIX}${ownerId}` : WALLET_STATE_KEY, JSON.stringify(next));
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(WALLET_UPDATED_EVENT, { detail: { ownerId, state: next } }));
  }
  return next;
}

export function formatWalletAmount(amount: number): string {
  const safeAmount = normalizeMoney(amount);
  return `¥${safeAmount.toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function getWalletBalance(state: WalletState): number {
  return normalizeMoney(state.balance);
}

export function getWalletTotalBalance(state: WalletState): number {
  return normalizeMoney(state.balance);
}

export function createWalletCard(input?: Partial<Pick<WalletCard, "title" | "bankLabel" | "maskedNumber" | "cardStyle" | "balance" | "note" | "accentLabel">>): WalletState {
  const current = loadWalletState();
  const now = new Date().toISOString();
  const card: WalletCard = {
    id: generateWalletId("wallet_card"),
    title: cleanText(input?.title, 80) || "储蓄卡",
    bankLabel: cleanText(input?.bankLabel, 80) || "CHAT WALLET",
    maskedNumber: cleanText(input?.maskedNumber, 40) || `**** **** **** ${String(Math.floor(Math.random() * 10000)).padStart(4, "0")}`,
    cardStyle: input?.cardStyle === "graphite" || input?.cardStyle === "silver" ? input.cardStyle : "obsidian",
    balance: normalizeMoney(input?.balance),
    note: cleanText(input?.note, 240),
    accentLabel: cleanText(input?.accentLabel, 24) || "储蓄",
    isDefault: current.cards.length === 0,
    createdAt: now,
    updatedAt: now,
  };
  return saveWalletState({
    ...current,
    cards: [card, ...current.cards],
    defaultCardId: current.cards.length === 0 ? card.id : current.defaultCardId,
  });
}

export function deleteWalletCard(cardId: string): { ok: boolean; state: WalletState; error?: string } {
  const current = loadWalletState();
  if (current.cards.length <= 1) {
    return { ok: false, state: current, error: "至少需要保留一张银行卡。" };
  }
  if ((current.cards.find(card => card.id === cardId)?.balance ?? 0) > 0) {
    return { ok: false, state: current, error: "请先转出该卡余额，再删除银行卡。" };
  }
  const nextCards = current.cards.filter(card => card.id !== cardId);
  if (nextCards.length === current.cards.length) return { ok: false, state: current, error: "未找到这张卡。" };
  const defaultCardId = current.defaultCardId === cardId ? nextCards[0].id : current.defaultCardId;
  const next = saveWalletState({
    ...current,
    cards: nextCards,
    defaultCardId,
    transactions: current.transactions,
  });
  return { ok: true, state: next };
}

export function setDefaultWalletCard(cardId: string): WalletState {
  const current = loadWalletState();
  if (!current.cards.some(card => card.id === cardId)) return current;
  return saveWalletState({ ...current, defaultCardId: cardId });
}

function createTransaction(input: {
  accountId: string;
  accountType: WalletAccountType;
  title: string;
  amount: number;
  kind: WalletTransaction["kind"];
  category: string;
  detail: string;
  balanceAfter: number;
  relatedOrderId?: string;
}): WalletTransaction {
  return {
    id: generateWalletId("wallet_tx"),
    cardId: input.accountId,
    accountType: input.accountType,
    title: cleanText(input.title, 120),
    amount: normalizeSignedMoney(input.amount),
    kind: input.kind,
    category: cleanText(input.category, 80),
    createdAt: new Date().toISOString(),
    detail: cleanText(input.detail, 400),
    balanceAfter: normalizeMoney(input.balanceAfter),
    relatedOrderId: cleanText(input.relatedOrderId, 120) || undefined,
  };
}

export function transferCardToWalletBalance(cardId: string, amount: number): { ok: boolean; state: WalletState; transactions?: WalletTransaction[]; error?: string } {
  const current = loadWalletState();
  const transferAmount = normalizeMoney(amount);
  if (transferAmount <= 0) return { ok: false, state: current, error: "转入金额需要大于 0。" };
  const card = current.cards.find(item => item.id === cardId);
  if (!card) return { ok: false, state: current, error: "未找到这张银行卡。" };
  if (normalizeMoney(card.balance) < transferAmount) {
    return { ok: false, state: current, error: "该银行卡余额不足，无法转入余额。" };
  }
  const now = new Date().toISOString();
  const balanceAfter = normalizeMoney(current.balance + transferAmount);
  const cardBalanceAfter = normalizeMoney(card.balance - transferAmount);
  const balanceTransaction = createTransaction({
    accountId: WALLET_BALANCE_ACCOUNT_ID,
    accountType: "balance",
    title: "银行卡转入余额",
    amount: transferAmount,
    kind: "transfer_in",
    category: "转入",
    detail: `${card.title} 转入余额 ${formatWalletAmount(transferAmount)}`,
    balanceAfter,
  });
  const cardTransaction = createTransaction({
    accountId: card.id,
    accountType: "card",
    title: "转入余额",
    amount: -transferAmount,
    kind: "transfer_out",
    category: "转入余额",
    detail: `转入余额 ${formatWalletAmount(transferAmount)}`,
    balanceAfter: cardBalanceAfter,
  });
  const next = saveWalletState({
    ...current,
    balance: balanceAfter,
    cards: current.cards.map(item => item.id === card.id ? { ...item, balance: cardBalanceAfter, updatedAt: now } : item),
    transactions: [balanceTransaction, cardTransaction, ...current.transactions],
  });
  return { ok: true, state: next, transactions: [balanceTransaction, cardTransaction] };
}

export function transferWalletBalanceToCard(cardId: string, amount: number): { ok: boolean; state: WalletState; transactions?: WalletTransaction[]; error?: string } {
  const current = loadWalletState();
  const transferAmount = normalizeMoney(amount);
  if (transferAmount <= 0) return { ok: false, state: current, error: "提现金额需要大于 0。" };
  const card = current.cards.find(item => item.id === cardId);
  if (!card) return { ok: false, state: current, error: "未找到这张银行卡。" };
  if (normalizeMoney(current.balance) < transferAmount) {
    return { ok: false, state: current, error: "余额不足，无法提现。" };
  }
  const now = new Date().toISOString();
  const balanceAfter = normalizeMoney(current.balance - transferAmount);
  const cardBalanceAfter = normalizeMoney(card.balance + transferAmount);
  const balanceTransaction = createTransaction({
    accountId: WALLET_BALANCE_ACCOUNT_ID,
    accountType: "balance",
    title: "提现到银行卡",
    amount: -transferAmount,
    kind: "transfer_out",
    category: "提现",
    detail: `提现到 ${card.title} ${formatWalletAmount(transferAmount)}`,
    balanceAfter,
  });
  const cardTransaction = createTransaction({
    accountId: card.id,
    accountType: "card",
    title: "余额提现到账",
    amount: transferAmount,
    kind: "transfer_in",
    category: "提现",
    detail: `余额提现到账 ${formatWalletAmount(transferAmount)}`,
    balanceAfter: cardBalanceAfter,
  });
  const next = saveWalletState({
    ...current,
    balance: balanceAfter,
    cards: current.cards.map(item => item.id === card.id ? { ...item, balance: cardBalanceAfter, updatedAt: now } : item),
    transactions: [balanceTransaction, cardTransaction, ...current.transactions],
  });
  return { ok: true, state: next, transactions: [balanceTransaction, cardTransaction] };
}

export function adjustWalletCardAccount(
  cardId: string,
  amount: number,
  direction: "in" | "out",
): { ok: boolean; state: WalletState; transaction?: WalletTransaction; error?: string } {
  const current = loadWalletState();
  const transferAmount = normalizeMoney(amount);
  if (transferAmount <= 0) return { ok: false, state: current, error: "金额需要大于 0。" };
  const card = current.cards.find(item => item.id === cardId);
  if (!card) return { ok: false, state: current, error: "未找到这张银行卡。" };
  const signedAmount = direction === "in" ? transferAmount : -transferAmount;
  const balanceAfter = normalizeMoney(card.balance + signedAmount);
  if (direction === "out" && normalizeMoney(card.balance) < transferAmount) {
    return { ok: false, state: current, error: "该银行卡余额不足，无法转出账户。" };
  }
  const now = new Date().toISOString();
  const transaction = createTransaction({
    accountId: card.id,
    accountType: "card",
    title: direction === "in" ? "转入账户" : "转出账户",
    amount: signedAmount,
    kind: direction === "in" ? "transfer_in" : "transfer_out",
    category: "银行卡账户",
    detail: `${card.title} ${direction === "in" ? "转入账户" : "转出账户"} ${formatWalletAmount(transferAmount)}`,
    balanceAfter,
  });
  const next = saveWalletState({
    ...current,
    cards: current.cards.map(item => item.id === card.id ? { ...item, balance: balanceAfter, updatedAt: now } : item),
    transactions: [transaction, ...current.transactions],
  });
  return { ok: true, state: next, transaction };
}

export function creditWalletBalance(amount: number, title: string, detail: string, category = "余额"): WalletPaymentResult {
  return recordWalletCredit({ currency: "CNY", amount, title, detail, category });
}

export function payWithWalletAccount(input: WalletPaymentInput): WalletPaymentResult {
  return recordWalletPayment({ currency: "CNY", amount: input.amount, title: input.title, detail: input.detail, category: input.category, relatedOrderId: input.relatedOrderId });
}

export function payWithWalletBalance(input: Omit<WalletPaymentInput, "accountId" | "cardId">): WalletPaymentResult {
  return payWithWalletAccount({ ...input, accountId: WALLET_BALANCE_ACCOUNT_ID });
}

export function payWithWalletCard(input: WalletPaymentInput): WalletPaymentResult {
  return payWithWalletAccount({ ...input, accountId: input.cardId || input.accountId });
}

export function getWalletCurrencyBalance(state: WalletState, currency: WalletCurrency): number {
  return currency === "CNY" ? normalizeMoney(state.balance) : state.currencyBalances?.[currency] ?? 0;
}

export function getWalletAssetEstimate(state: WalletState, currency: WalletCurrency = state.displayCurrency): number {
  return roundWalletMoney(WALLET_CURRENCIES.reduce((sum, item) => sum + (getWalletCurrencyBalance(state, item) - (state.creditDebts?.[item] || 0)) * WALLET_REFERENCE_RATES[item] / WALLET_REFERENCE_RATES[currency], 0), currency);
}

export type WalletLedgerInput = {
  ownerId?: string;
  currency: WalletCurrency;
  amount: number;
  title: string;
  detail?: string;
  category?: string;
  relatedOrderId?: string;
  relatedMessageId?: string;
  sourceCurrency?: WalletCurrency;
  accountId?: string;
  kind?: WalletTransaction["kind"];
  createdAt?: string;
  source?: WalletTransaction["source"];
  credit?: boolean;
};

export function recordWalletPayment(input: WalletLedgerInput): WalletPaymentResult {
  const state = loadWalletState(input.ownerId);
  const originalAmount = roundWalletMoney(input.amount, input.currency);
  if (!Number.isFinite(originalAmount) || originalAmount <= 0) return { ok: false, state, error: "付款金额无效。" };
  if (input.relatedOrderId) {
    const existing = state.transactions.find(tx => tx.relatedOrderId === input.relatedOrderId && tx.kind === "payment");
    if (existing) return { ok: true, state, transaction: existing };
  }
  if (input.relatedMessageId) {
    const existing = state.transactions.find(tx => tx.relatedMessageId === input.relatedMessageId && tx.kind === "payment");
    if (existing) return { ok: true, state, transaction: existing };
  }
  const originalAvailable = getWalletCurrencyBalance(state, input.currency);
  const candidates = [state.primaryCurrency, ...WALLET_CURRENCIES.filter(currency => currency !== state.primaryCurrency && currency !== input.currency)];
  const source = input.sourceCurrency ?? (originalAvailable >= originalAmount ? input.currency : candidates.find(currency => getWalletCurrencyBalance(state, currency) >= exchangeWalletAmount(originalAmount, input.currency, currency)) || state.primaryCurrency);
  const charged = source === input.currency ? originalAmount : exchangeWalletAmount(originalAmount, input.currency, source);
  if (charged <= 0) return { ok: false, state, error: "换算后金额过小，无法扣款。" };
  const card = state.cards[0];
  if (input.accountId && input.accountId !== WALLET_BALANCE_ACCOUNT_ID && input.accountId !== card.id) return { ok: false, state, error: "未找到付款银行卡。" };
  const available = getWalletCurrencyBalance(state, source);
  if (input.credit && !state.creditEnabled) return { ok: false, state, error: "尚未开通信用卡。" };
  if (input.credit && state.creditEnabled) {
    const debt = roundWalletMoney((state.creditDebts?.[input.currency] || 0) + originalAmount, input.currency);
    const transaction: WalletTransaction = { id: generateWalletId("wallet_tx"), cardId: "wallet_credit_card", accountType: "card", title: input.title, amount: originalAmount, currency: input.currency, credit: true, source: input.source || "app", kind: "payment", category: input.category || "信用卡消费", createdAt: validWalletDate(input.createdAt), detail: input.detail || "", balanceAfter: debt, relatedOrderId: input.relatedOrderId, relatedMessageId: input.relatedMessageId };
    return { ok: true, ...{ state: saveWalletState({ ...state, creditDebts: { ...state.creditDebts, [input.currency]: debt }, transactions: [transaction, ...state.transactions] }, input.ownerId), transaction } };
  }
  if (available < charged) return { ok: false, state, error: `${source} 余额不足。` };
  const balanceAfter = roundWalletMoney(available - charged, source);
  const transaction: WalletTransaction = {
    id: generateWalletId("wallet_tx"), cardId: card.id, accountType: "card",
    title: input.title, amount: -charged, currency: source, kind: "payment", category: input.category || "付款",
    createdAt: validWalletDate(input.createdAt), detail: input.detail || "", balanceAfter, source: input.source || "app",
    relatedOrderId: input.relatedOrderId, relatedMessageId: input.relatedMessageId,
    ...(source !== input.currency ? { originalCurrency: input.currency, originalAmount, exchangeRate: charged / originalAmount } : {}),
  };
  const next = saveWalletState({
    ...state,
    balance: source === "CNY" ? balanceAfter : state.balance,
    currencyBalances: source !== "CNY" ? { ...state.currencyBalances, [source]: balanceAfter } : state.currencyBalances,
    transactions: [transaction, ...state.transactions],
  }, input.ownerId);
  return { ok: true, state: next, transaction };
}

export function recordWalletCredit(input: WalletLedgerInput): WalletPaymentResult {
  const state = loadWalletState(input.ownerId);
  const originalAmount = roundWalletMoney(input.amount, input.currency);
  if (!Number.isFinite(originalAmount) || originalAmount <= 0) return { ok: false, state, error: "入账金额无效。" };
  if (input.relatedMessageId) {
    const existing = state.transactions.find(tx => tx.relatedMessageId === input.relatedMessageId && tx.amount > 0);
    if (existing) return { ok: true, state, transaction: existing };
  }
  const target = input.sourceCurrency ?? (state.autoConvertReceived ? state.primaryCurrency : input.currency);
  const credited = target === input.currency ? originalAmount : exchangeWalletAmount(originalAmount, input.currency, target);
  if (credited <= 0) return { ok: false, state, error: "换算后金额过小，无法入账。" };
  const card = state.cards[0];
  const balanceAfter = roundWalletMoney(getWalletCurrencyBalance(state, target) + credited, target);
  const transaction: WalletTransaction = {
    id: generateWalletId("wallet_tx"), cardId: card.id, accountType: "card",
    title: input.title, amount: credited, currency: target, kind: input.kind || "transfer_in", category: input.category || "收入",
    createdAt: validWalletDate(input.createdAt), detail: input.detail || "", balanceAfter, source: input.source || "app",
    relatedOrderId: input.relatedOrderId, relatedMessageId: input.relatedMessageId,
    ...(target !== input.currency ? { originalCurrency: input.currency, originalAmount, exchangeRate: credited / originalAmount } : {}),
  };
  const next = saveWalletState({
    ...state,
    balance: target === "CNY" ? balanceAfter : state.balance,
    currencyBalances: target !== "CNY" ? { ...state.currencyBalances, [target]: balanceAfter } : state.currencyBalances,
    transactions: [transaction, ...state.transactions],
  }, input.ownerId);
  return { ok: true, state: next, transaction };
}

export function setWalletCurrencyBalance(currency: WalletCurrency, amount: number, ownerId?: string): WalletPaymentResult {
  const current = loadWalletState(ownerId);
  const desired = roundWalletMoney(amount, currency);
  if (!Number.isFinite(desired) || desired < 0) return { ok: false, state: current, error: "余额不能为负。" };
  // The CNY balance account is edited separately from legacy bank cards.
  const before = currency === "CNY" ? current.balance : getWalletCurrencyBalance(current, currency);
  const delta = roundWalletMoney(desired - before, currency);
  if (delta === 0) return { ok: true, state: current };
  const transaction: WalletTransaction = {
    id: generateWalletId("wallet_tx"), cardId: current.defaultCardId, accountType: "card", source: "manual",
    title: "手动调整余额", amount: delta, currency, kind: "adjustment", category: "账户设置",
    createdAt: new Date().toISOString(), detail: `${currency} 余额调整`, balanceAfter: desired,
  };
  const next = saveWalletState({ ...current, balance: currency === "CNY" ? desired : current.balance,
    currencyBalances: currency !== "CNY" ? { ...current.currencyBalances, [currency]: desired } : current.currencyBalances,
    transactions: [transaction, ...current.transactions] }, ownerId);
  return { ok: true, state: next, transaction };
}

export function recordWalletManual(input: WalletLedgerInput & { direction: "in" | "out" }): WalletPaymentResult {
  const base = { ...input, source: "manual" as const };
  if (input.direction === "in") return recordWalletCredit({ ...base, sourceCurrency: input.currency });
  return recordWalletPayment(base);
}

export function repayWalletCredit(ownerId: string | undefined, currency: WalletCurrency, amount: number): WalletPaymentResult {
  const state = loadWalletState(ownerId);
  const debt = state.creditDebts?.[currency] || 0;
  const paid = roundWalletMoney(amount, currency);
  if (!state.creditEnabled || paid <= 0 || paid > debt) return { ok: false, state, error: "还款金额无效或超过欠款。" };
  const debit = recordWalletPayment({ ownerId, currency, amount: paid, title: "信用卡还款", detail: `从储蓄卡偿还 ${currency} 信用卡`, category: "信用卡还款", source: "manual" });
  if (!debit.ok) return debit;
  const remaining = roundWalletMoney(debt - paid, currency);
  const tx: WalletTransaction = { id: generateWalletId("wallet_tx"), cardId: "wallet_credit_card", accountType: "card", title: "信用卡还款", amount: -paid, currency, credit: true, source: "manual", kind: "transfer_out", category: "信用卡还款", createdAt: new Date().toISOString(), detail: `由储蓄卡还款 ${formatCurrencyAmount(paid, currency)}`, balanceAfter: remaining };
  const next = saveWalletState({ ...debit.state, creditDebts: { ...debit.state.creditDebts, [currency]: remaining }, transactions: [tx, ...debit.state.transactions] }, ownerId);
  return { ok: true, state: next, transaction: tx };
}

export function getWalletVisibleCurrencies(state: WalletState): WalletCurrency[] {
  const used = state.transactions.map(tx => tx.currency).filter((currency): currency is WalletCurrency => Boolean(currency));
  return WALLET_CURRENCIES.filter(currency => currency === state.primaryCurrency || state.commonCurrencies?.includes(currency) || getWalletCurrencyBalance(state, currency) !== 0 || (state.creditDebts?.[currency] || 0) !== 0 || used.includes(currency));
}
