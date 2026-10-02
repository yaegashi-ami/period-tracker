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
export const predict = (state) => {
  const records = ordered(state.periods);
  if (!records.length) return null;
  const latest = records.at(-1).start;
  const cycles = records.slice(1).map((p, i) => ({ days: dayGap(records[i].start, p.start), start: records[i].start }));
  const recent = cycles.slice(-3).map(c => c.days).sort((a, b) => a - b);
  const fallback = Number.isInteger(state.cycleDays) && state.cycleDays > 0 ? state.cycleDays : 28;
  const median = recent.length ? (recent[Math.floor((recent.length - 1) / 2)] + recent[Math.floor(recent.length / 2)]) / 2 : fallback;
  const halfYear = cycles.filter(c => c.start >= sixMonthsBefore(latest));
  const average = halfYear.length ? halfYear.reduce((sum, c) => sum + c.days, 0) / halfYear.length : median;
  if (!median && !average) return null;
  const main = median ? shiftDay(latest, Math.round(median)) : null;
  return { main, alternative: average ? shiftDay(latest, Math.round(average)) : null,
    ovulation: main ? shiftDay(main, -14) : null, pmsFrom: main ? shiftDay(main, -10) : null,
    pmsTo: main ? shiftDay(main, -3) : null };
};
export const recordedInMonth = (periods, year, month) => {
  const first = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const next = month === 11 ? `${year + 1}-01-01` : `${year}-${String(month + 2).padStart(2, '0')}-01`;
  return periods.some(p => p.start < next && (p.end || p.start) >= first);
};
export const overlaps = (periods, id, start, end) => periods.some(p => p.id !== id && start <= (p.end || p.start) && (end || start) >= p.start);
