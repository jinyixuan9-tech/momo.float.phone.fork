import { loadCharacters } from "./character-storage";
import { sendLLMRequest } from "./chat-engine";
import { assemblePromptPayload, type LLMMessage } from "./llm-prompt-assembler";
import { loadApiConfigs, loadBindingConfig, loadPresets, loadRegexes, loadWorldBooks, resolveBinding, resolveUserIdentity } from "./settings-storage";
import { loadMemoryConfig } from "./memory-storage";
import { retrieveMemoriesForPrompt } from "./memory-service";
import { buildCharacterTimeContext } from "./character-time";
import type { RegexConfig, WorldBookConfig } from "./settings-types";
import type { SmsState, SmsThread } from "./sms-storage";
import { chatStatus } from "./sms-continuity";

const compact = (text: string, n = 130) => text.replace(/\s+/g, " ").trim().slice(0, n);

export async function generateSmsReply(thread: SmsThread, state: SmsState, mode: "reply" | "proactive" | "summon" | "regenerate" = "reply", single = false): Promise<{ messages: { original: string; translated: string }[]; awareness?: SmsThread["awareness"]; suspicion?: string; block?: boolean; summary?: string; channel?: "sms" | "request" | "wait"; requestMessage?: string; reactions?: { messageId: string; emoji: string }[] }> {
  const character = loadCharacters().find(c => c.id === thread.characterId);
  if (!character) throw new Error("角色已不存在");
  const slot = resolveBinding(loadBindingConfig(), character.id, "sms");
  const api = loadApiConfigs().find(x => x.id === slot.apiConfigId) ?? loadApiConfigs()[0];
  if (!api) throw new Error("请先配置文字 API");
  const presets = loadPresets();
  const preset = presets.find(x => x.id === slot.presetId) ?? presets.find(x => x.builtIn) ?? null;
  const worldBooks = (slot.worldBookIds ?? []).map(id => loadWorldBooks().find(x => x.id === id)).filter(Boolean) as WorldBookConfig[];
  const regexes = (slot.regexIds ?? []).map(id => loadRegexes().find(x => x.id === id)).filter(Boolean) as RegexConfig[];
  const recent = state.messages.filter(m => m.threadId === thread.id && m.delivered).slice(-16);
  const history = recent.map(m => `${m.direction === "outgoing" ? `来信[${m.id}]` : "我"}: ${compact(m.original, 180)}`).join("\n");
  const real = thread.identityId === "real";
  const chat = real ? chatStatus(character.id) : null;
  const lastText = state.messages.filter(m => m.threadId === thread.id && m.delivered).at(-1)?.original ?? "";
  const memories = real ? await retrieveMemoriesForPrompt(character.id, lastText || character.name, loadMemoryConfig()).catch(() => []) : [];
  const prompt = assemblePromptPayload({ character, history: [], preset, worldBooks, regexes, appId: "sms", appTags: ["sms"], timeContext: buildCharacterTimeContext(character.timeZone) });
  const knowledge = real ? `这是用户已知的真实号码。用户称呼：${resolveUserIdentity(character.id, "chat")?.name ?? "用户"}。Chat 当前${chat?.blocked ? "被用户拉黑，Chat 发信会被拒收" : "可以联系"}。近期 Chat（只作必要衔接）：${chat?.recent.join("；") || "无"}。好友申请：${chat?.requests.join("；") || "无"}。相关长期记忆：${memories.slice(0, 3).map(m => compact(m.content, 150)).join("；") || "无"}。` : `这是陌生来信号码 ${thread.number}。系统可能知道实际操作者，但你不知道；不要从系统的人设、用户身份、共享记忆或数据库推断它必然属于用户。你目前的判断：${thread.awareness === "suspected" ? `怀疑是用户，但未确认；依据：${compact(thread.suspicion || "近期措辞", 80)}` : thread.awareness === "confirmed" ? "你已有充分依据确认是用户" : "身份未知"}。只有短信内容与已知的事实可作为身份线索。可以怀疑、要求验证、误判或拒绝回答。`;
  const instruction: LLMMessage = { role: "system", content: [
    "你正在封闭的虚构手机世界里收发普通 SMS，不接触现实电话网络。请按人设自由决定回应、沉默、继续试探或屏蔽这个具体来信号码。",
    knowledge,
    `你的短信号码：${thread.characterNumber || "未填写"}。当前来信号码：${thread.number || "未填写"}。`,
    `本号码角色已知的简要关系摘要：${compact(thread.summary || "暂无", 350)}。本号码最近短信（限量）：\n${history || "暂无"}`,
    mode === "proactive" ? "这是一次可选的主动联系机会。若 Chat 被拉黑，可在短信、重新发 Chat 好友申请、等待之间选择一个；已有待处理申请时不要重复申请。不要同一轮跨两处同时联系。" : mode === "summon" ? "用户点击了召唤回复。请发至少一条 SMS：可以依据刚连发的来信回应；如果没有新来信，就按人设、记忆和最近 Chat 自己开启一个话题。不必等用户再发一句。角色被拉黑时遵守拉黑状态。" : mode === "regenerate" ? `你正在重写此前${single ? "单条" : "这一轮"}自己的回复，仅依据截断到当时的会话上下文。${single ? "只输出一条短信。" : "可输出一至三条短信。"}` : "仅回应当前来信；可以分成 1 到 3 条短信。",
    "只输出 JSON：{\"send\":true/false,\"channel\":\"sms/request/wait\",\"requestMessage\":\"申请附言，选择 request 时填写\",\"messages\":[{\"original\":\"角色语言原文\",\"translated\":\"忠实简体中文译文\"}],\"reactions\":[{\"messageId\":\"刚刚收到的来信ID\",\"emoji\":\"单个表情\"}],\"awareness\":\"unknown/suspected/confirmed\",\"suspicion\":\"角色可解释的线索\",\"block\":false,\"summary\":\"仅基于自己已知事实的短信关系摘要，200字以内\"}。reactions 可省略，偶尔只对真实收到的用户短信贴一个合适表情，不要次次贴。identity 的确认必须有真实可见的充分证据；不可仅因发送者实际是用户而确认。不要在短信里写动作或系统事实。",
  ].join("\n") };
  const task = mode === "reply" ? "收到短信后决定是否回应。" : mode === "proactive" ? "现在是否想主动给用户真实号码发短信？" : mode === "regenerate" ? "重写刚才这次短信回复。" : "用户按下召唤键，请考虑现在回复或者主动开启一个话题。";
  const raw = await sendLLMRequest(api, preset, [...prompt, instruction, { role: "user", content: task }], regexes, { characterName: character.name, userName: real ? resolveUserIdentity(character.id, "chat")?.name : "陌生号码" }, { appId: "sms", appTags: ["sms"], skipOutputRegex: true });
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("短信回复格式无效，可重试");
  const data = JSON.parse(match[0]) as Record<string, unknown>;
  const messages = data.send === false ? [] : (Array.isArray(data.messages) ? data.messages : []).slice(0, single ? 1 : 3).map((x: unknown) => { const row = x as Record<string, unknown>; return { original: String(row?.original ?? "").trim().slice(0, 800), translated: String(row?.translated ?? "").trim().slice(0, 800) }; }).filter(x => x.original);
  const validTargets = new Set(recent.filter(m => m.direction === "outgoing").map(m => m.id));
  const reactions = (Array.isArray(data.reactions) ? data.reactions : []).slice(0, 2).map((value: unknown) => value as Record<string, unknown>).filter(row => validTargets.has(String(row?.messageId)) && typeof row?.emoji === "string" && row.emoji.length < 16).map(row => ({ messageId: String(row.messageId), emoji: String(row.emoji) }));
  const awareness = ["unknown", "suspected", "confirmed"].includes(String(data.awareness)) ? data.awareness as SmsThread["awareness"] : undefined;
  return { messages, reactions, awareness, suspicion: typeof data.suspicion === "string" ? data.suspicion.slice(0, 120) : undefined, block: data.block === true, summary: typeof data.summary === "string" ? data.summary.slice(0, 400) : undefined, channel: ["sms", "request", "wait"].includes(String(data.channel)) ? data.channel as "sms" | "request" | "wait" : undefined, requestMessage: typeof data.requestMessage === "string" ? data.requestMessage.trim().slice(0, 160) : undefined };
}
