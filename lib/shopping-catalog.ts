import type { ShoppingCatalog, ShoppingCategory, ShoppingCustomCategory, ShoppingMode, ShoppingProduct, ShoppingRegion } from "./shopping-types";

export const SHOP_BASE_CATEGORIES: Omit<ShoppingCustomCategory, "mode" | "match">[] = [
  { id: "digital", title: "数码好物", subtitle: "手机、电脑、平板和配件" },
  { id: "home", title: "生活家居", subtitle: "收纳、香氛、餐厨和家居" },
  { id: "style", title: "穿搭配饰", subtitle: "服饰、鞋包与首饰" },
  { id: "beauty", title: "美妆个护", subtitle: "护肤、彩妆与个护" },
  { id: "food", title: "食品饮品", subtitle: "可寄送的零食、咖啡和饮品" },
  { id: "hobby", title: "文具兴趣", subtitle: "文具、阅读、运动与兴趣" },
  { id: "gifts", title: "鲜花礼品", subtitle: "花束、礼盒和心意" },
  { id: "luxury", title: "奢侈品", subtitle: "包袋、珠宝、腕表和成衣" },
  { id: "outdoor", title: "运动户外", subtitle: "健身、露营和旅行装备" },
];

const LOCAL_FOOD: Record<ShoppingRegion, string> = { CN: "中餐", KR: "韩餐", JP: "日料", US: "美式料理" };
export function baseCategories(mode: ShoppingMode, region: ShoppingRegion): ShoppingCategory[] {
  const source = mode === "shop" ? SHOP_BASE_CATEGORIES : [
    { id: "local", title: LOCAL_FOOD[region], subtitle: "当地料理和便餐" },
    { id: "international", title: "异国料理", subtitle: "来自其他国家的菜式" },
    { id: "drinks", title: "饮品", subtitle: "咖啡、茶和其他饮品" },
    { id: "dessert", title: "甜品烘焙", subtitle: "蛋糕、面包和甜点" },
    { id: "fruit", title: "水果生鲜", subtitle: "水果、果切和鲜食" },
    { id: "convenience", title: "便利店超市", subtitle: "便利餐食和日用品" },
    { id: "flowers", title: "鲜花", subtitle: "花束和小型花礼" },
    { id: "pharmacy", title: "药店", subtitle: "药店常见用品与应急物品" },
    { id: "fine_dining", title: "高级料理", subtitle: "当地高价位的精致餐食" },
  ];
  return source.map(category => ({ ...category, items: [] }));
}

export function catalogCategoryDefinitions(mode: ShoppingMode, region: ShoppingRegion, custom: ShoppingCustomCategory[]): ShoppingCategory[] {
  return [...baseCategories(mode, region), ...custom.filter(item => item.mode === mode).map(item => ({ ...item, items: [] }))];
}

const normalized = (s: string) => s.normalize("NFKC").toLocaleLowerCase().replace(/[\s\-_·•.（）()]/g, "");
const ALIAS_GROUPS = [["星巴克", "starbucks", "스타벅스", "スターバックス"], ["megacoffee", "메가커피", "메가mgg커피"], ["丝芙兰", "sephora", "세포라", "セフォラ"], ["apple", "苹果", "애플", "アップル"], ["oliveyoung", "올리브영", "欧利芙洋"]];
function aliasMatches(needle: string, haystack: string): boolean {
  if (haystack.includes(needle)) return true;
  const aliases = ALIAS_GROUPS.find(group => group.some(name => normalized(name) === needle));
  return Boolean(aliases?.some(name => haystack.includes(normalized(name))));
}
export function productIdentity(product: ShoppingProduct): string {
  return `${normalized(product.merchantLabel)}|${normalized(product.brandLabel || "")}|${normalized(product.title)}`;
}

export function customCategoryMatches(category: ShoppingCustomCategory, item: ShoppingProduct): boolean {
  const needle = normalized(category.title);
  if (needle.length < 2) return false;
  const merchant = normalized(item.merchantLabel);
  const brand = normalized(item.brandLabel || "");
  const title = normalized(item.title);
  if (category.match === "store") return aliasMatches(needle, merchant) || needle.includes(merchant) && merchant.length > 2;
  if (category.match === "brand") return aliasMatches(needle, brand) || aliasMatches(needle, title);
  return [title, normalized(item.tagLabel), normalized(item.subtitle)].some(text => text.includes(needle));
}

function inferredBaseCategories(product: ShoppingProduct): string[] {
  const text = normalized(`${product.title} ${product.brandLabel || ""} ${product.merchantLabel} ${product.subtitle}`);
  const matches: string[] = [];
  if (product.mode === "food") {
    if (/(星巴克|starbucks|스타벅스|スターバックス|megacoffee|메가커피|咖啡|coffee|커피|饮品|奶茶|果汁|ジュース)/i.test(text)) matches.push("drinks");
    if (/(蛋糕|面包|甜品|케이크|케익|cake|bakery|ベーカリー)/i.test(text)) matches.push("dessert");
    if (/(水果|果切|fruit|フルーツ|과일)/i.test(text)) matches.push("fruit");
    return matches;
  }
  if (/(apple|苹果|iphone|ipad|macbook|手机|电脑|平板|耳机|갤럭시|samsung)/i.test(text)) matches.push("digital");
  if (/(丝芙兰|sephora|口红|护肤|香水|面膜|彩妆|化妆|립스틱|cosmetic)/i.test(text)) matches.push("beauty");
  if (/(宝格丽|bvlgari|路易威登|louisvuitton|gucci|圣罗兰|ysl|cartier|奢侈|珠宝|腕表)/i.test(text)) matches.push("luxury");
  if (/(花束|鲜花|礼盒|flower|bouquet)/i.test(text)) matches.push("gifts");
  return matches;
}

export function mergeGeneratedCatalog(previous: ShoppingCatalog, incoming: ShoppingCatalog, definitions: ShoppingCategory[], custom: ShoppingCustomCategory[], dismissed: string[]): ShoppingCatalog {
  const hidden = new Set(dismissed);
  const groups = new Map<string, ShoppingCategory>();
  for (const definition of definitions) groups.set(definition.id, { ...definition, items: [] });
  for (const category of previous.categories) {
    const group = groups.get(category.id);
    if (group) group.items = category.items.filter(item => !hidden.has(productIdentity(item)));
  }
  const known = new Map<string, ShoppingProduct>();
  for (const category of groups.values()) for (const item of category.items) known.set(productIdentity(item), item);
  for (const item of previous.recommendations) if (!hidden.has(productIdentity(item)) && !known.has(productIdentity(item))) known.set(productIdentity(item), item);
  for (const category of incoming.categories) {
    const target = groups.get(category.id);
    if (!target) continue;
    for (const item of category.items) {
      const key = productIdentity(item);
      if (hidden.has(key)) continue;
      const canonical = known.get(key) || item;
      if (!known.has(key)) known.set(key, item);
      if (!target.items.some(existing => productIdentity(existing) === key)) target.items.unshift(canonical);
    }
  }
  for (const category of custom) {
    const target = groups.get(category.id);
    if (!target) continue;
    for (const item of known.values()) if (customCategoryMatches(category, item) && !target.items.some(existing => productIdentity(existing) === productIdentity(item))) target.items.unshift(item);
  }
  for (const item of known.values()) for (const id of inferredBaseCategories(item)) {
    const group = groups.get(id);
    if (group && !group.items.some(existing => productIdentity(existing) === productIdentity(item))) group.items.unshift(item);
  }
  const categories = [...groups.values()];
  return { categories, recommendations: [...known.values()] };
}

export function removeCatalogProduct(catalog: ShoppingCatalog, product: ShoppingProduct): ShoppingCatalog {
  const key = productIdentity(product);
  return { categories: catalog.categories.map(category => ({ ...category, items: category.items.filter(item => productIdentity(item) !== key) })), recommendations: catalog.recommendations.filter(item => productIdentity(item) !== key) };
}
