import type { ShoppingRegion, ShoppingRegionConfig, ShoppingState } from "./shopping-types";
import type { WalletCurrency } from "./wallet-types";
import { formatCurrencyAmount, walletCurrency, WALLET_CURRENCIES } from "./wallet-storage";

export const SHOPPING_REGION_PRESETS: ShoppingRegionConfig[] = [
  { id: "CN", country: "中国", currency: "CNY", enabled: true },
  { id: "KR", country: "韩国", currency: "KRW", enabled: false },
  { id: "JP", country: "日本", currency: "JPY", enabled: false },
  { id: "US", country: "美国", currency: "USD", enabled: false },
  { id: "HK", country: "中国香港", currency: "HKD", enabled: false },
  { id: "TW", country: "中国台湾", currency: "TWD", enabled: false },
];

export function shoppingRegionConfig(state: ShoppingState, id: ShoppingRegion): ShoppingRegionConfig {
  return state.regions.find(item => item.id === id) || SHOPPING_REGION_PRESETS.find(item => item.id === id) || SHOPPING_REGION_PRESETS[0];
}

export function shoppingRegionPrompt(region: ShoppingRegionConfig): string {
  return `${region.country}的${region.id}地区；商品和店铺应符合当地实际经营环境。品牌名可用当地语言或英文，品类、说明、详情和所有规格都用中文；价格必须使用 ${region.currency}，例如 ${formatCurrencyAmount(100, region.currency)}。`;
}

export function fallbackShippingCity(country: string, id: string, seed?: string): string {
  const cities: Record<string, string[]> = { CN: ["上海", "杭州", "深圳", "广州", "北京", "成都"], KR: ["首尔", "釜山", "仁川"], JP: ["东京", "大阪", "名古屋"], US: ["纽约", "洛杉矶", "芝加哥"], HK: ["香港"], TW: ["台北", "台中"], MO: ["澳门"] };
  const choices = cities[id] || [country];
  const hash = seed ? [...seed].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 0) : Math.floor(Math.random() * 100000);
  return choices[hash % choices.length];
}

export function normalizeShoppingRegions(input: unknown, activeRegion: string): ShoppingRegionConfig[] {
  const saved = Array.isArray(input) ? input : [];
  const normalized = saved.map(value => {
    const raw = value as Partial<ShoppingRegionConfig>;
    const id = String(raw.id || "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 5);
    const country = String(raw.country || "").trim().slice(0, 60);
    const currency = walletCurrency(raw.currency);
    return id.length >= 2 && country && WALLET_CURRENCIES.includes(currency) ? { id, country, currency, enabled: raw.enabled === true } : null;
  }).filter((value): value is ShoppingRegionConfig => Boolean(value));
  const regions = SHOPPING_REGION_PRESETS.map(preset => normalized.find(item => item.id === preset.id) || { ...preset, enabled: preset.enabled || (!saved.length && activeRegion === preset.id) });
  for (const custom of normalized) if (!regions.some(item => item.id === custom.id)) regions.push(custom);
  if (!regions.some(item => item.enabled)) regions[0] = { ...regions[0], enabled: true };
  return regions;
}

export function currencyForRegion(state: ShoppingState, region: ShoppingRegion): WalletCurrency {
  return shoppingRegionConfig(state, region).currency;
}
