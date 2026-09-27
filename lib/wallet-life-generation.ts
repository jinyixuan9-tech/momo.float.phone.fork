import { sendLLMRequest } from "./chat-engine";
import { loadCharacters } from "./character-storage";
import { loadChatMessages, loadChatSessions, getChatMessagePreview } from "./chat-storage";
import { buildCalendarScheduleMarker } from "./calendar-storage";
import { getWeekStartIso } from "./calendar-utils";
import { loadApiConfigs, loadBindingConfig, loadPresets, resolveBinding, resolveUserIdentity } from "./settings-storage";
import { WALLET_CURRENCIES, formatCurrencyAmount, getWalletCurrencyBalance, loadWalletState, recordWalletCredit, recordWalletPayment, saveWalletState } from "./wallet-storage";
import type { WalletCurrency } from "./wallet-types";

type Entry = { direction: "income" | "expense"; currency: WalletCurrency; amount: number; title: string; detail: string; category: string; createdAt: string; credit?: boolean };
function parseEntries(raw: string, start: number, end: number): Entry[] {
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) throw new Error("生成结果没有可读取的流水，请重试。");
  let rows: unknown;
  try { rows = JSON.parse(match[0]); } catch { throw new Error("生成的流水格式有误，请重试。"); }
  if (!Array.isArray(rows)) throw new Error("生成的流水格式有误，请重试。");
  return (rows as unknown[]).slice(0, 10).flatMap((row): Entry[] => {
    if (!row || typeof row !== "object") return [];
    const r = row as Record<string, unknown>;
    const direction = r.direction === "income" || r.direction === "expense" ? r.direction : null;
    const currency = r.currency as WalletCurrency;
    const amount = Number(r.amount);
    const timestamp = Date.parse(String(r.createdAt || ""));
    if (!direction || !WALLET_CURRENCIES.includes(currency) || !Number.isFinite(amount) || amount <= 0 || amount > 100000000 || !Number.isFinite(timestamp) || timestamp <= start || timestamp > end) return [];
    const title = String(r.title || "").trim().slice(0, 100);
    if (!title) return [];
    return [{ direction, currency, amount, title, detail: String(r.detail || title).trim().slice(0, 350), category: String(r.category || (direction === "income" ? "收入" : "生活消费")).slice(0, 50), createdAt: new Date(timestamp).toISOString(), credit: r.account === "credit" && direction === "expense" }];
  }).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}

/** Each refresh advances its own cursor. Real payments never enter the prompt as generated history. */
export async function refreshWalletLiving(ownerId?: string): Promise<{ count: number; skipped: number }> {
  let wallet = loadWalletState(ownerId);
  // Seed a new role once, without exposing its amount in the user's setup UI or
  // recording fictitious income. Existing balances and historical ledgers win.
  if (ownerId && !wallet.roleAssetsInitialized) {
    if (!loadCharacters().some(character => character.id === ownerId)) throw new Error("找不到角色。");
    const hasHistory = wallet.transactions.length > 0 || WALLET_CURRENCIES.some(currency => getWalletCurrencyBalance(wallet, currency) > 0 || (wallet.creditDebts?.[currency] || 0) > 0);
    if (hasHistory) {
      wallet = saveWalletState({ ...wallet, roleAssetsInitialized: true }, ownerId);
    } else {
      const proposal = await suggestWalletBase(ownerId, true);
      wallet = saveWalletState({
        ...wallet,
        balance: proposal.currency === "CNY" ? proposal.amount : wallet.balance,
        currencyBalances: proposal.currency === "CNY" ? wallet.currencyBalances : { ...wallet.currencyBalances, [proposal.currency]: proposal.amount },
        roleAssetsInitialized: true,
      }, ownerId);
    }
  }
  const now = Date.now();
  const last = wallet.lastLivingRefreshAt ? Date.parse(wallet.lastLivingRefreshAt) : NaN;
  const start = Number.isFinite(last) && last <= now ? last : now - 7 * 86400000;
  if (now - start < 60000) return { count: 0, skipped: 0 };
  const character = ownerId ? loadCharacters().find(c => c.id === ownerId) : null;
  if (ownerId && !character) throw new Error("找不到角色。");
  const binding = resolveBinding(loadBindingConfig(), ownerId, ownerId ? "checkphone" : "chat");
  const apiConfigs = loadApiConfigs();
  const api = apiConfigs.find(c => c.id === binding.apiConfigId) || apiConfigs[0];
  if (!api) throw new Error("请先设置 AI 接口。");
  const presets = loadPresets();
  const preset = presets.find(p => p.id === binding.presetId) || presets[0] || null;
  const identity = resolveUserIdentity(ownerId, ownerId ? "checkphone" : "chat");
  const persona = character ? `${character.name}：${character.persona}\n性格：${character.personality || ""}` : `${identity?.name || "用户"}：${identity?.bio || ""}\n职业：${identity?.occupation || ""}\n${identity?.customSettings || ""}`;
  const schedules: string[] = [];
  const week = new Date(start);
  for (let n = 0; n < 3 && week.getTime() <= now; n++) {
    schedules.push(buildCalendarScheduleMarker(ownerId ? "character" : "user", ownerId || "self", getWeekStartIso(week)));
    week.setDate(week.getDate() + 7);
  }
  const chats = loadChatSessions().filter(session => !ownerId || session.contactId === ownerId).slice(0, 3)
    .flatMap(session => loadChatMessages(session.id, 12).map(message => getChatMessagePreview(message))).filter(Boolean).slice(-24);
  const maxByTime = Math.min(10, Math.max(1, Math.ceil((now - start) / 86400000) * 2));
  const prompt = `为虚构手机角色生成自然生活流水。只返回 JSON 数组，0 到 ${maxByTime} 条，允许空数组。每项必须有 direction("income"或"expense"), currency(ISO), amount(正数), title(中文), detail(中文), category(中文), createdAt(ISO 日期时间), account("debit"或"credit")。\n人设：${persona}\n财富水平：${wallet.wealthLevel || "按人设推断"}；收入来源：${wallet.incomeSources || "按人设推断，不要凭空给工资"}。\n时间范围：( ${new Date(start).toISOString()} , ${new Date(now).toISOString()} ]，严格只生成这个区间；时间分散且符合生活作息，可同日多笔也可几天没有。首次至多一周，后续仅补未生成的日子，消费谨慎的人可仅零至两笔，不要凑数；每次最多十条。\n默认结算币种 ${wallet.primaryCurrency}；常用币种 ${(wallet.commonCurrencies || []).join("、") || "无"}，只在真实地点/情境合适时使用。储蓄卡可用：${WALLET_CURRENCIES.map(c => `${c} ${formatCurrencyAmount(getWalletCurrencyBalance(wallet,c),c)}`).join("；")}。不得生成付不起的支出，收入须有可靠人设依据。\n日程：${schedules.join("\n")}\n相关近期聊天语境：${chats.join("；") || "无"}。聊天中红包、转账、购物订单已有单独真实流水；不要引用、复刻或统计它们，也不要为它们补单。\n把日程中的地点、出差、工作与合理消费相连：如明确在釜山拍摄，可写当天在当地便利店午餐；没有行程不要编造跨城旅行。人设提及车型（如捷尼塞斯 G80）才可产生对应的刹车维修。商家品牌与当地真实生活吻合，适度具体：例如 CU、GS25、7-Eleven、全家、路易威登、宝格丽，但只在所在地与经济状况合理时用；写买了饭、包或项链即可，不编精确型号价格。${wallet.creditEnabled ? "已开通信用卡：部分合理消费可以标为 credit，收入一律进入储蓄卡。" : "未开通信用卡：所有交易 account 都是 debit。"}每笔的方向由 direction 明确决定，amount 一律正数，文案自然简洁，均用中文。`;
  const raw = await sendLLMRequest(api, preset, [{ role: "system", content: prompt }, { role: "user", content: "按人设和实际时间范围给出新增流水 JSON 数组。" }], [], { characterName: character?.name, userName: identity?.name }, { skipOutputRegex: true, appId: "wallet_living" });
  const entries = parseEntries(raw, start, now);
  let count = 0, skipped = 0;
  const batch = `${now}_${Math.random().toString(36).slice(2, 8)}`;
  for (const [index, entry] of entries.entries()) {
    const input = { ownerId, amount: entry.amount, currency: entry.currency, title: entry.title, detail: entry.detail, category: entry.category, createdAt: entry.createdAt, source: "generated" as const, relatedOrderId: `wallet-living:${batch}:${index}` };
    const result = entry.direction === "income" ? recordWalletCredit(input) : recordWalletPayment({ ...input, credit: entry.credit });
    if (result.ok) count++; else skipped++;
  }
  saveWalletState({ ...loadWalletState(ownerId), lastLivingRefreshAt: new Date(now).toISOString() }, ownerId);
  return { count, skipped };
}

/** Suggests a starting amount for review; does not write to the ledger. */
export async function suggestWalletBase(ownerId?: string, blind = false): Promise<{ currency: WalletCurrency; amount: number; explanation: string }> {
  const wallet = loadWalletState(ownerId);
  const character = ownerId ? loadCharacters().find(c => c.id === ownerId) : null;
  const identity = resolveUserIdentity(ownerId, ownerId ? "checkphone" : "chat");
  const binding = resolveBinding(loadBindingConfig(), ownerId, ownerId ? "checkphone" : "chat");
  const configs = loadApiConfigs();
  const api = configs.find(item => item.id === binding.apiConfigId) || configs[0];
  if (!api) throw new Error("请先设置 AI 接口。");
  const persona = character ? `${character.name}：${character.persona} ${character.personality || ""}` : `${identity?.name || "用户"}：${identity?.bio || ""} ${identity?.occupation || ""} ${identity?.customSettings || ""}`;
  const raw = await sendLLMRequest(api, null, [{ role: "system", content: `根据人物设定建议一张储蓄卡的初始基础余额。${blind ? "这是角色的隐蔽初始化，金额只写入角色资产，不在用户的钱包设置中显示。" : "供用户审核后决定是否采用。"}不要把它当作已经入账的流水。只输出 JSON 对象 {"currency":"${wallet.primaryCurrency}","amount":数字,"explanation":"简短中文理由"}。初始金额须与人物经济条件、所在地及收入合理匹配，若信息模糊就保守估计。人物：${persona}。补充财务情况：${wallet.wealthLevel || "未设置"}；收入来源：${wallet.incomeSources || "未设置"}。` }, { role: "user", content: "给出建议基础金额。" }], [], { characterName: character?.name, userName: identity?.name }, { skipOutputRegex: true, appId: "wallet_base" });
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("无法解析建议金额，请重试。");
  let proposal: Record<string, unknown>;
  try { proposal = JSON.parse(match[0]); } catch { throw new Error("无法解析建议金额，请重试。"); }
  const amount = Number(proposal.amount);
  if (!Number.isFinite(amount) || amount < 0 || amount > 1000000000) throw new Error("建议金额无效，请重试。");
  return { currency: wallet.primaryCurrency, amount, explanation: String(proposal.explanation || "根据人设建议的基础金额。").slice(0, 180) };
}
