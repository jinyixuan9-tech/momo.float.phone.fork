import { getMusicControlBridge } from "./music-control-bridge";

type TimedLyric = { time: number; text: string };

function parseTimedLyrics(lrc: string): TimedLyric[] {
    const lines: TimedLyric[] = [];
    for (const rawLine of lrc.split(/\r?\n/)) {
        const stamps = [...rawLine.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
        const text = rawLine.replace(/\[\d+:\d+(?:\.\d+)?\]/g, "").trim();
        if (!text) continue;
        for (const stamp of stamps) {
            const time = Number(stamp[1]) * 60 + Number(stamp[2]);
            if (Number.isFinite(time)) lines.push({ time, text: text.slice(0, 160) });
        }
    }
    return lines.sort((a, b) => a.time - b.time);
}

function timeLabel(seconds: number): string {
    const safe = Math.max(0, Math.floor(seconds));
    return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}

/** A fresh snapshot for this Chat reply, never persisted as conversation history. */
export function buildListeningLyricContext(): string {
    const state = getMusicControlBridge()?.getState();
    if (!state) return "播放器暂不可读；不要推测当前歌曲或歌词。";
    const track = state.currentTrack;
    if (!track) return "一起听已连接，播放器暂未选歌；不要推测当前歌词。";
    const header = `当前歌曲：《${track.title}》— ${track.artist || "未知歌手"}；${state.isPlaying ? "正在播放" : "已暂停"}；播放到 ${timeLabel(state.currentTime)}。`;
    const lyrics = parseTimedLyrics(track.lyrics || "");
    if (!lyrics.length) return `${header}\n当前没有可按时间定位的歌词，不要编造正在唱的句子。`;
    let active = -1;
    for (let i = lyrics.length - 1; i >= 0; i--) {
        if (lyrics[i].time <= state.currentTime) { active = i; break; }
    }
    const start = Math.max(0, active - 2);
    const end = Math.min(lyrics.length, (active < 0 ? 0 : active) + 3);
    const excerpt = lyrics.slice(start, end).map((line, index) => {
        const position = start + index;
        const relation = position === active ? "当前" : position < active ? "前面" : "接下来";
        return `${relation} ${timeLabel(line.time)}：${line.text}`;
    });
    return `${header}\n${active < 0 ? "尚未唱到首句；" : ""}播放位置附近歌词：\n${excerpt.join("\n")}`;
}
