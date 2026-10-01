/** Assign a refresh batch across local calendar days without creating future posts. */
export function refreshPostTimes(count: number, now = Date.now()): number[] {
  if (count <= 0) return [];
  const days = Array.from({ length: count }, (_, index) => index < Math.ceil(count * .6) ? 0 : index < Math.ceil(count * .9) ? 1 : 2);
  for (let index = days.length - 1; index > 0; index--) {
    const swap = Math.floor(Math.random() * (index + 1));
    [days[index], days[swap]] = [days[swap], days[index]];
  }
  return days.map(day => {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - day);
    const end = day === 0 ? now : start.getTime() + 86400000 - 1;
    return start.getTime() + Math.floor(Math.random() * Math.max(1, end - start.getTime() + 1));
  });
}

/** Comments can arrive any time after publication, through the actual refresh instant. */
export function refreshCommentTimes(postAt: number, count: number, refreshAt = Date.now()): number[] {
  const start = Math.min(postAt, refreshAt);
  const duration = Math.max(0, refreshAt - start);
  return Array.from({ length: count }, () => start + Math.floor(Math.random() * (duration + 1)))
    .sort((left, right) => left - right);
}
