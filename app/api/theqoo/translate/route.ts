import { NextResponse } from "next/server";
import { proxyFetch } from "@/lib/proxy-fetch";

export const runtime = "nodejs";
export const maxDuration = 60;
const TRANSLATION_URL = "https://api.siliconflow.cn/v1/chat/completions";
const TRANSLATION_MODEL = "deepseek-ai/DeepSeek-V4-Flash";
// Server only: never return this value to the browser or place it in NEXT_PUBLIC_*.
const BUILTIN_TRANSLATION_KEY = "sk-ojkbnarenjnvpsdsxaztzsoqmusnztcnahssjzoxrtzkrbyh";

function normalizeEndpoint(baseUrl: string) {
  const raw = baseUrl.trim();
  if (!raw) return TRANSLATION_URL;
  const parsed = new URL(raw);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("invalid_url");
  let endpoint = raw.replace(/\/$/, "");
  if (!/\/chat\/completions$/i.test(endpoint)) {
    if (!/\/v1$/i.test(endpoint)) endpoint += "/v1";
    endpoint += "/chat/completions";
  }
  return endpoint;
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  const publicHost = request.headers.get("x-forwarded-host") || request.headers.get("host") || new URL(request.url).host;
  if (origin && new URL(origin).host !== publicHost && origin !== new URL(request.url).origin) {
    return NextResponse.json({ message: "跨站请求已拒绝。" }, { status: 403 });
  }

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ message: "翻译输入无效。" }, { status: 400 }); }
  const objectBody = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : null;
  const input = objectBody?.texts;
  if (!input || typeof input !== "object" || Array.isArray(input)) return NextResponse.json({ message: "翻译输入无效。" }, { status: 400 });
  const pairs = Object.entries(input);
  if (!pairs.length || pairs.length > 20 || pairs.some(([key, value]) => !/^\w{1,40}$/.test(key) || typeof value !== "string" || !value.trim() || value.length > 4000)) {
    return NextResponse.json({ message: "翻译输入过长或无效。" }, { status: 400 });
  }

  const custom = objectBody?.translator && typeof objectBody.translator === "object" && !Array.isArray(objectBody.translator)
    ? objectBody.translator as Record<string, unknown>
    : null;
  const customBaseUrl = typeof custom?.baseUrl === "string" ? custom.baseUrl.trim().slice(0, 1000) : "";
  const customApiKey = typeof custom?.apiKey === "string" ? custom.apiKey.trim().slice(0, 4000) : "";
  const customModel = typeof custom?.model === "string" ? custom.model.trim().slice(0, 300) : "";

  try {
    const endpoint = customBaseUrl && customApiKey && customModel ? normalizeEndpoint(customBaseUrl) : TRANSLATION_URL;
    const apiKey = customBaseUrl && customApiKey && customModel ? customApiKey : (process.env.THEQOO_TRANSLATION_API_KEY || BUILTIN_TRANSLATION_KEY);
    const model = customBaseUrl && customApiKey && customModel ? customModel : TRANSLATION_MODEL;
    const upstream = await proxyFetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        messages: [
          { role: "system", content: "你只负责用户本人在韩国匿名论坛里发布的文字的中韩双向翻译。输入字段可能是中文、韩文或含英文、人名、颜文字。逐字段输出自然韩语 ko 和自然简体中文 zh，保留原文事实、人名、语气、网络用语、标点与换行，绝不续写、编造、删减。输入已是目标语言时保留原文。只输出严格 JSON 对象，字段名与输入相同，值为 {ko:string,zh:string}，无 Markdown。" },
          { role: "user", content: JSON.stringify(Object.fromEntries(pairs)) },
        ],
      }),
      signal: AbortSignal.timeout(45000),
    });
    if (!upstream.ok) return NextResponse.json({ message: `翻译 API 请求失败（${upstream.status}）。` }, { status: 502 });
    const data = await upstream.json() as { choices?: Array<{ message?: { content?: string } }> };
    const raw = data.choices?.[0]?.message?.content || "";
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("invalid_response");
    const parsed = JSON.parse(raw.slice(start, end + 1)) as Record<string, { ko?: unknown; zh?: unknown }>;
    const result: Record<string, { ko: string; zh: string }> = {};
    for (const [key] of pairs) {
      const entry = parsed[key];
      if (typeof entry?.ko !== "string" || !entry.ko.trim() || typeof entry?.zh !== "string" || !entry.zh.trim()) throw new Error("incomplete_translation");
      result[key] = { ko: entry.ko.trim(), zh: entry.zh.trim() };
    }
    return NextResponse.json({ result }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ message: "翻译 API 没有返回完整双语内容，请重试。" }, { status: 502 });
  }
}
