import { loadBoxState } from "./question-box-storage";

export type QuestionBoxProjectionEntry = { id: string; timestamp: string; content: string; authorType: "user" | "character" | "npc" };
const compact = (value: string, limit: number) => value.replace(/\s+/g, " ").trim().slice(0, limit);

/** Derived from live box state: deleting a question or session also removes every associated event. */
export function loadQuestionBoxProjectionEntries(characterId: string, options?: { afterTimestamp?: string }): QuestionBoxProjectionEntry[] {
  const events: QuestionBoxProjectionEntry[] = [];
  const add = (id: string, time: number, content: string, authorType: QuestionBoxProjectionEntry["authorType"]) => {
    if (!Number.isFinite(time)) return;
    const timestamp = new Date(time).toISOString();
    if (!options?.afterTimestamp || timestamp > options.afterTimestamp) events.push({ id, timestamp, content, authorType });
  };
  for (const box of loadBoxState().sessions) {
    if (box.ownerId !== characterId && box.ownerId !== "user") continue;
    if (box.ownerId === characterId) {
      add(`question_box_${box.id}`, box.startsAt, `你开启了一期提问箱${box.topic ? `，主题是「${compact(box.topic, 100)}」` : ""}。`, "character");
    }
    for (const question of box.questions) {
      if (box.ownerId === "user" && question.senderId === characterId) {
        add(`question_box_question_${question.id}`, question.createdAt, `你匿名向用户的提问箱提出了问题：“${compact(question.text, 300)}”。`, "character");
        if (question.answer) add(`question_box_answer_${question.id}`, question.answer.createdAt, `用户回答了你在提问箱里问的问题“${compact(question.text, 220)}”：“${compact(question.answer.original, 500)}”。`, "user");
      }
      if (box.ownerId === characterId) {
        // The sender is deliberately never copied into C's timeline, including for U's delivery.
        add(`question_box_question_${question.id}`, question.createdAt, `你的提问箱收到一条匿名问题：“${compact(question.text, 300)}”。发问者身份未知。`, "npc");
        if (question.answer) add(`question_box_answer_${question.id}`, question.answer.createdAt, `你在提问箱回答了匿名问题“${compact(question.text, 220)}”：“${compact(question.answer.original, 500)}”。`, "character");
      }
    }
  }
  return events.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}
