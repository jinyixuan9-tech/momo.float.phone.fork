"use client";

import { useEffect, useState } from "react";
import { Square, Volume2 } from "lucide-react";
import { splitBilingualText } from "@/lib/bilingual-text";

export function CallTranscriptBubble({ text, onPlay, playing = false, disabled = false }: {
    text: string;
    onPlay: () => void;
    playing?: boolean;
    disabled?: boolean;
}) {
    const [expanded, setExpanded] = useState(true);
    useEffect(() => setExpanded(true), [text]);
    const bilingual = splitBilingualText(text);

    return <div className="call-speech-row">
        <button type="button" className="call-speech-audio" onClick={onPlay} disabled={disabled}
            aria-label={playing ? "停止这段语音" : "播放这段话的原文"} title={playing ? "停止播放" : "播放原文"}>
            {playing ? <Square size={10} fill="currentColor" /> : <Volume2 size={13} />}
        </button>
        <div className="call-speech-bubble">
            <div className="call-speech-original">{bilingual?.original || text}
                {bilingual && <button type="button" className="call-speech-translate" onClick={() => setExpanded(value => !value)}
                    aria-label={expanded ? "收起中文翻译" : "展开中文翻译"} aria-expanded={expanded}>译</button>}
            </div>
            {bilingual && expanded && <div className="call-speech-translation">{bilingual.translated}</div>}
        </div>
    </div>;
}
