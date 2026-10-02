export const dayGap = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
export const shiftDay = (iso, days) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
export const ordered = (periods) => [...periods].sort((a, b) => a.start.localeCompare(b.start));
export const recordAt = (periods, iso) => {
  const records = ordered(periods);
  for (let i = records.length - 1; i >= 0; i--) {
    const p = records[i];
    const end = p.end || shiftDay(p.start, 4);
    if (p.start <= iso && iso <= end && (!records[i + 1] || iso < records[i + 1].start)) {
      return { period: p, provisional: !p.end, offset: dayGap(p.start, iso) };
    }
  }
  return null;
};
const sixMonthsBefore = (iso) => {
  const [year, month, day] = iso.split('-').map(Number);
  const first = new Date(Date.UTC(year, month - 7, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(day, lastDay));
  return first.toISOString().slice(0, 10);
};
// 区間の判断は隣り合う開始日の組に結び付ける。日付変更・記録追加後は持ち越さない。
export const intervalKey = (from, to) => `${from}/${to}`;
export const activeReviews = (state) => {
  const records = ordered(state.periods);
  const keys = new Set(records.slice(1).map((p, i) => intervalKey(records[i].start, p.start)));
  return (Array.isArray(state.intervalReviews) ? state.intervalReviews : []).filter(review =>
    review && ['unknown', 'long'].includes(review.kind) && keys.has(intervalKey(review.from, review.to))
  );
};
export const cycleIntervals = (state) => {
  const records = ordered(state.periods);
  const reviews = new Map(activeReviews(state).map(review => [intervalKey(review.from, review.to), review.kind]));
  return records.slice(1).map((record, i) => {
    const from = records[i].start, to = record.start, key = intervalKey(from, to);
    return { key, from, to, days: dayGap(from, to), kind: reviews.get(key) ?? 'recorded',
      approximate: records[i].approximate === true || record.approximate === true };
  });
};
export const gapCandidates = (state) => {
  const cycles = cycleIntervals(state).filter(c => c.days > 0 && !c.approximate && c.kind !== 'unknown');
  if (cycles.length < 2) return [];
  const shortest = Math.min(...cycles.map(c => c.days));
  return cycles.filter(c => c.kind === 'recorded' && c.days >= shortest * 2);
};
export const weightedCycles = (state) => {
  const intervals = cycleIntervals(state);
  const recentLong = intervals.slice(-3).filter(c => c.kind === 'long' && !c.approximate && c.days > 0);
  const restored = new Set(recentLong.length >= 2 ? recentLong.map(c => c.key) : []);
  return intervals.filter(c => c.days > 0 && !c.approximate && c.kind !== 'unknown').map(c => ({
    ...c, weight: c.kind === 'long' && !restored.has(c.key) ? 0.25 : 1
  }));
};
const weightedMedian = (cycles) => {
  const values = [...cycles].sort((a, b) => a.days - b.days);
  const middle = values.reduce((sum, c) => sum + c.weight, 0) / 2;
  let total = 0;
  for (let i = 0; i < values.length; i++) {
    total += values[i].weight;
    if (total > middle) return values[i].days;
    if (total === middle) return (values[i].days + values[i + 1].days) / 2;
  }
};
export const predict = (state) => {
  const records = ordered(state.periods);
  if (!records.length) return null;
  const latest = records.at(-1).start;
  const cycles = weightedCycles(state);
  // 不明な区間しかないときに、初期値の28日へ戻して予測を作らない。
  if (records.length > 1 && !cycles.length) return null;
  const fallback = Number.isInteger(state.cycleDays) && state.cycleDays > 0 ? state.cycleDays : 28;
  const median = cycles.length ? weightedMedian(cycles.slice(-3)) : fallback;
  const halfYear = cycles.filter(c => c.from >= sixMonthsBefore(latest));
  const average = halfYear.length
    ? halfYear.reduce((sum, c) => sum + c.days * c.weight, 0) / halfYear.reduce((sum, c) => sum + c.weight, 0)
    : median;
  const main = shiftDay(latest, Math.round(median));
  return { main, alternative: shiftDay(latest, Math.round(average)),
    ovulation: shiftDay(main, -14), pmsFrom: shiftDay(main, -10), pmsTo: shiftDay(main, -3) };
};
export const recordedInMonth = (periods, year, month) => {
  const first = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const next = month === 11 ? `${year + 1}-01-01` : `${year}-${String(month + 2).padStart(2, '0')}-01`;
  return periods.some(p => p.start < next && (p.end || p.start) >= first);
};
export const overlaps = (periods, id, start, end) => periods.some(p => p.id !== id && start <= (p.end || p.start) && (end || start) >= p.start);
