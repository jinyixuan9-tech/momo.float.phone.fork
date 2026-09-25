import { splitBilingualText } from "./bilingual-text";

export type CallLine = { kind: "speech" | "action"; text: string };

export const VOICE_CALL_FORMAT = [
    "当前是语音通话。只写角色实际说出口的话，不写动作、旁白或画面描述。",
    "每段台词以【台词】开头；如果原文不是中文，按 原文 | 中文译文 输出。可以输出多段台词，每段另起一行。",
].join("\n");

export const VIDEO_CALL_FORMAT = [
    "当前是视频通话。请把动作和说出口的话分开，每段独立输出。",
    "台词以【台词】开头，非中文原文按 原文 | 中文译文 输出。",
    "动作以【动作】开头，只用中文写可见的动作或神态，不附译文；台词里不要混入动作。",
    "按真实通话自然回复，不要求每轮都写动作。不要把这两个标签解释给用户。",
].join("\n");

/** Split tagged call output without mistaking ordinary dialogue for an action. */
export function splitCallTranscript(content: string, allowActions: boolean): CallLine[] {
    const source = content.trim();
    if (!source) return [];
    const marker = /【(台词|语音|动作)】/g;
    const tags = [...source.matchAll(marker)];
    if (!tags.length) return [{ kind: "speech", text: source }];
    const lines: CallLine[] = [];
    const leading = source.slice(0, tags[0].index).trim();
    if (leading) lines.push({ kind: "speech", text: leading });
    tags.forEach((tag, index) => {
        const end = index + 1 < tags.length ? tags[index + 1].index : source.length;
        const text = source.slice(tag.index! + tag[0].length, end).trim();
        if (text && (tag[1] !== "动作" || allowActions)) {
            lines.push({ kind: tag[1] === "动作" ? "action" : "speech", text });
        }
    });
    return lines;
}

/** Only the original utterance is sent to speech synthesis. */
export function originalCallSpeech(text: string): string {
    const content = splitCallTranscript(text, false).map(line => line.text).join("\n");
    const bilingual = splitBilingualText(content);
    if (bilingual) return bilingual.original;
    return content.split("\n").map(line => splitBilingualText(line)?.original || line).join("\n");
}

/** A bilingual action belongs in the centered Chinese narration, never in TTS. */
export function displayCallAction(text: string): string {
    return splitBilingualText(text)?.translated || text;
}
