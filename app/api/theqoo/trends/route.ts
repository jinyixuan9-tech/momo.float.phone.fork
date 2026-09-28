import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function decodeXml(text: string) {
  return text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)));
}

export async function GET() {
  try {
    const response = await fetch("https://news.google.com/rss?hl=ko&gl=KR&ceid=KR:ko", {
      signal: AbortSignal.timeout(4500), cache: "no-store", headers: { "User-Agent": "ii-phone/1.0 (Korean forum context)" },
    });
    if (!response.ok) throw new Error(`RSS ${response.status}`);
    const xml = await response.text();
    const titles = [...xml.matchAll(/<item>[\s\S]*?<title>([\s\S]*?)<\/title>[\s\S]*?<\/item>/g)]
      .slice(0, 12).map(match => decodeXml(match[1]).replace(/<[^>]+>/g, "").trim()).filter(Boolean);
    return NextResponse.json({ titles, fetchedAt: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ titles: [], fetchedAt: null }, { headers: { "Cache-Control": "no-store" } });
  }
}
