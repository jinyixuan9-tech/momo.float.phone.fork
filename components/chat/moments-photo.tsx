"use client";

import { useEffect, useState } from "react";
import { getChatImageFromIndexedDB } from "@/lib/chat-asset-storage";

export function useMomentsPhotoUrl(url?: string) {
    const [resolved, setResolved] = useState<string | null>(null);
    useEffect(() => {
        let active = true;
        if (!url) { setResolved(null); return; }
        if (!url.startsWith("asset://")) { setResolved(url); return; }
        setResolved(null);
        getChatImageFromIndexedDB(url.slice(8)).then(src => { if (active) setResolved(src || null); }).catch(() => { if (active) setResolved(null); });
        return () => { active = false; };
    }, [url]);
    return resolved;
}

export function MomentsPhotoImage({ url, alt = "", className = "" }: { url: string; alt?: string; className?: string }) {
    const src = useMomentsPhotoUrl(url);
    return src ? <img src={src} alt={alt} className={className} /> : <div className={`${className} moments-photo-loading`} aria-label="照片加载中" />;
}
