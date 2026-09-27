import { loadCharacters } from "./character-storage";
import { createOrGetSession, loadChatMessages, pushChatMessage, type ChatMessage } from "./chat-storage";
import { generateChatCompletion, flattenCompletionResult } from "./chat-engine";
import { parseAIResponse } from "./rich-message-parser";
import { splitCallTranscript, VOICE_CALL_FORMAT } from "./call-transcript";

export type PhoneReplyLine = { id: string; original: string; translated?: string };

function splitOriginalTranslated(text: string): { original: string; translated?: string } {
  const idx = text.indexOf("|");
  if (idx < 0) return { original: text.trim() };
  const original = text.slice(0, idx).trim();
  const translated = text.slice(idx + 1).trim();
  return { original, translated: translated && translated !== original ? translated : undefined };
}

export async function decidePhoneAnswer(characterId: string): Promise<"answer" | "decline" | "missed" | "busy"> {
  const character = loadCharacters().find(c => c.id === characterId);
  if (!character) return "missed";
  const session = createOrGetSession(characterId);
  const history = loadChatMessages(session.id);
  try {
    const result = flattenCompletionResult(await generateChatCompletion(session, history, {
      appTags: ["chat", "voice"],
      callFormatInstruction: [
        "用户现在通过手机 Phone App 主动打电话给你。请只判断你此刻是否接听，不要写对白。",
        "结合人设、最近聊天、其他应用上下文、时间和当前关系自然决定。不要为了配合用户而固定接听。",
        "只输出 answer / decline / missed / busy 其中一个英文词。",
      ].join("\n"),
    }));
    const token = result.trim().toLowerCase().match(/\b(answer|decline|missed|busy)\b/)?.[1];
    return (token as "answer" | "decline" | "missed" | "busy") || "answer";
  } catch {
    return "answer";
  }
}

export function queuePhoneUserLine(characterId: string, text: string): { sessionId: string; message: ChatMessage } {
  const session = createOrGetSession(characterId);
  const message = pushChatMessage({ sessionId: session.id, role: "user", content: text.trim() });
  return { sessionId: session.id, message };
}

export async function generatePhoneReply(characterId: string): Promise<{ sessionId: string; lines: PhoneReplyLine[]; hangup: boolean }> {
  const session = createOrGetSession(characterId);
  const history = loadChatMessages(session.id);
  const raw = flattenCompletionResult(await generateChatCompletion(session, history, {
    appTags: ["chat", "voice"],
    callFormatInstruction: `${VOICE_CALL_FORMAT}\n如果你根据人设和当前情境想主动结束这通电话，可以在最后一段台词之后单独输出 [PHONE_HANGUP]。不要每次都挂断。`,
  }));
  const previousState: any[] = [];
  const hangup = raw.includes("[PHONE_HANGUP]");
  const cleanedRaw = raw.replace(/\[PHONE_HANGUP\]/g, "").trim();
  const parsed = parseAIResponse(cleanedRaw, previousState);
  const textParts = parsed.parts.filter(p => !p.mediaType).flatMap(p => splitCallTranscript(p.content, false));
  const lines: PhoneReplyLine[] = [];
  for (const line of textParts) {
    if (line.kind !== "speech" || !line.text.trim()) continue;
    const split = splitOriginalTranslated(line.text);
    const saved = pushChatMessage({ sessionId: session.id, role: "assistant", content: line.text.trim() });
    lines.push({ id: saved.id, ...split });
  }
  return { sessionId: session.id, lines, hangup };
}
