import { loadWorldBooks } from "./settings-storage";
import type { TwitterState } from "./twitter-storage";

/** X uses its own explicit selection, without inheriting or merging global bindings. */
export function selectedTwitterWorldBooks(state: TwitterState, sensitive = false) {
  const chosen = sensitive ? state.sensitiveTopics.worldBookIds : state.worldBookIds;
  const ids = new Set(chosen);
  return loadWorldBooks().filter(book => ids.has(book.id));
}

export function twitterWorldBookText(state: TwitterState, sensitive = false, maxLength = 3200): string {
  return selectedTwitterWorldBooks(state, sensitive)
    .map(book => `${book.name}：${book.entries.filter(entry => !entry.disable).map(entry => entry.content).join("；")}`)
    .join("\n").slice(0, maxLength);
}
