import { NextResponse } from "next/server";
import { proxyFetch } from "@/lib/proxy-fetch";

export const runtime = "nodejs";
export const maxDuration = 120;

const FISH_TTS_URL = "https://api.fish.audio/v1/tts";

type FishTtsBody = {
    apiKey?: unknown;
    model?: unknown;
    voiceId?: unknown;
    text?: unknown;
};

function cleanString(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: Request) {
    try {
        const body = (await request.json().catch(() => ({}))) as FishTtsBody;
        const apiKey = cleanString(body.apiKey);
        const text = cleanString(body.text);
        const voiceId = cleanString(body.voiceId);
        const model = cleanString(body.model) || "s2.1-pro-free";

        if (!apiKey) {
            return NextResponse.json({ error: "missing_api_key", message: "Fish Audio API Key 未配置" }, { status: 400 });
        }
        if (!text) {
            return NextResponse.json({ error: "missing_text", message: "试听文本不能为空" }, { status: 400 });
        }
        if (!/^[A-Za-z0-9._-]{1,100}$/.test(model)) {
            return NextResponse.json({ error: "invalid_model", message: "Fish Audio 模型名格式无效" }, { status: 400 });
        }

        const upstream = await proxyFetch(FISH_TTS_URL, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
                model,
            },
            body: JSON.stringify({
                text,
                format: "mp3",
                ...(voiceId ? { reference_id: voiceId } : {}),
            }),
        });

        if (!upstream.ok) {
            const message = (await upstream.text().catch(() => "")).slice(0, 1200);
            return NextResponse.json(
                {
                    error: "fish_tts_failed",
                    message: message || `Fish Audio 请求失败（HTTP ${upstream.status}）`,
                    upstreamStatus: upstream.status,
                },
                { status: upstream.status >= 400 && upstream.status < 500 ? upstream.status : 502 },
            );
        }

        const audio = await upstream.arrayBuffer();
        const contentType = upstream.headers.get("content-type") || "audio/mpeg";
        return new Response(audio, {
            status: 200,
            headers: {
                "Content-Type": contentType,
                "Cache-Control": "no-store",
            },
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return NextResponse.json(
            { error: "fish_tts_proxy_failed", message: message.slice(0, 800) || "Fish Audio 代理请求失败" },
            { status: 502 },
        );
    }
}
