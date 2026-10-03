import { dayGap, shiftDay, recordAt, predict, recordedInMonth, overlaps, intervalKey, activeReviews, cycleIntervals, gapCandidates, weightedCycles, predictionRecords, excludedPredictionRecords } from "./calendar-model.mjs?v=20261004-record-updates";
const STORAGE_KEY = 'period-tracker-prototype-v1';
const $ = (id) => document.getElementById(id);
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const validISO = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
};
const addDays = (value, days) => {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
};
const dateLabel = (value) => {
  const [year, month, day] = value.split('-').map(Number);
  return `${year}年${month}月${day}日`;
};
const createId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const emptyState = () => ({ version: 1, onboarded: false, cycleDays: null, cycleUnknown: true, showPremenstrual: true, showOvulation: true, periods: [], intervalReviews: [] });
const loadState = () => {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.periods)) return emptyState();
    const cycleDays = Number.isInteger(parsed.cycleDays) && parsed.cycleDays > 0 ? parsed.cycleDays : null;
    const stored = { ...parsed };
    delete stored.irregular;
    return { ...emptyState(), ...stored, cycleDays, cycleUnknown: parsed.cycleUnknown === true || cycleDays === null, periods: parsed.periods.filter((p) => validISO(p.start) && (!p.end || validISO(p.end))).map(({ id, start, end }) => ({ id, start, end: end || null })) };
  } catch { return emptyState(); }
};
let state = loadState();
let displayedMonth = new Date();
let selectedDate = todayISO();
let hasSelectedDate = true;
let suppressDateClickUntil = 0;
let editingId = null;
let completionTimer;
let storedSnapshot = localStorage.getItem(STORAGE_KEY);
let remoteUpdatePending = false;
let editDrafts = new Map();
let toastTimer;
const showUpdateToast = message => {
  const toast = $('update-toast');
  toast.textContent = message;
  if (!toast.matches(':popover-open')) toast.showPopover();
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.hidePopover(), 5000);
};
const save = () => {
  try {
    if (localStorage.getItem(STORAGE_KEY) !== storedSnapshot) {
      remoteUpdatePending = true;
      showUpdateToast('別のタブで記録が更新されました。編集画面を閉じて最新の記録を確認してください。');
      setTimeout(syncStoredState, 0);
      return false;
    }
    const next = { ...state, intervalReviews: activeReviews(state) };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    storedSnapshot = JSON.stringify(next);
    state = next;
    return true;
  }
  catch { showNotice('保存できませんでした。ブラウザの保存設定を確認してください。'); return false; }
};
const show = (screen) => {
  for (const id of ['start-screen', 'welcome-screen', 'setup-screen', 'calendar-screen']) $(id).hidden = id !== screen;
  const step = screen === 'welcome-screen' ? 1 : screen === 'setup-screen' ? 2 : 0;
  $('app-shell').classList.toggle('is-start', screen === 'start-screen');
  document.body.classList.toggle('start-active', screen === 'start-screen');
  const onboarding = screen === 'welcome-screen' || screen === 'setup-screen';
  $('app-shell').classList.toggle('is-onboarding', onboarding);
  document.body.classList.toggle('onboarding-active', onboarding);
  $('onboarding-progress').hidden = step === 0;
  $('onboarding-progress').dataset.step = String(step);
  $('progress-count').textContent = `${step} / 3`;
  for (const n of [1, 2, 3]) {
    const item = $(`progress-step-${n}`);
    item.classList.toggle('active', n === step);
    item.classList.toggle('complete', n < step);
    if (n === step) item.setAttribute('aria-current', 'step'); else item.removeAttribute('aria-current');
  }
  window.scrollTo({ top: 0, behavior: 'instant' });
};
const showNotice = (message) => { $('app-notice').textContent = message; $('app-notice').hidden = false; };
const showError = (id, message) => { const node = $(id); node.textContent = message; node.hidden = !message; };
const showCompletion = (message) => {
  $('completion-message').textContent = message;
  $('completion-toast').hidden = false;
  clearTimeout(completionTimer);
  completionTimer = setTimeout(() => { $('completion-toast').hidden = true; }, 4000);
};
const addStartRow = (value = '') => {
  const row = document.createElement('div'); row.className = 'date-row';
  const input = document.createElement('input'); input.type = 'date'; input.max = todayISO(); input.value = value; input.setAttribute('aria-label', '生理開始日');
  const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'remove-date'; remove.textContent = '×'; remove.setAttribute('aria-label', 'この入力欄を削除');
  remove.addEventListener('click', () => { if ($('start-date-list').children.length > 1) row.remove(); else input.value = ''; });
  row.append(input, remove); $('start-date-list').append(row);
};

const decodeBackup = (backup) => {
  if (backup?.format !== 'period-tracker-backup' || backup.formatVersion !== 1) {
    throw new Error('このアプリでエクスポートしたバックアップを選んでください。');
  }
  const data = backup.data;
  if (!data || data.version !== 1 || data.onboarded !== true || !Array.isArray(data.periods) || data.periods.length === 0 || data.periods.length > 2000) {
    throw new Error('バックアップの内容を確認できません。');
  }
  const cycleDays = data.cycleDays === null ? null : data.cycleDays;
  if (cycleDays !== null && (!Number.isInteger(cycleDays) || cycleDays < 1 || cycleDays > 365)) {
    throw new Error('周期の日数が正しくありません。');
  }
  if (typeof data.cycleUnknown !== 'boolean' || data.cycleUnknown !== (cycleDays === null)
    || typeof data.showPremenstrual !== 'boolean' || typeof data.showOvulation !== 'boolean') {
    throw new Error('設定の内容を確認できません。');
  }
  const periodIds = new Set();
  const periods = data.periods.map((period) => {
    if (!period || typeof period !== 'object' || !validISO(period.start) || period.start > todayISO()) {
      throw new Error('生理開始日の記録を確認できません。');
    }
    const end = period.end || null;
    if (end && (!validISO(end) || end < period.start || end > todayISO())) {
      throw new Error('生理終了日の記録を確認できません。');
    }
    let id = typeof period.id === 'string' && period.id.length > 0 && period.id.length <= 120 && !periodIds.has(period.id)
      ? period.id
      : createId();
    while (periodIds.has(id)) id = createId();
    periodIds.add(id);
    return { id, start: period.start, end };
  }).sort((a, b) => a.start.localeCompare(b.start));
  for (let i = 1; i < periods.length; i++) {
    if (periods[i].start === periods[i - 1].start || (periods[i - 1].end && periods[i].start <= periods[i - 1].end)) {
      throw new Error('日付が重複している記録があります。');
    }
  }
  const rawReviews = data.intervalReviews ?? [];
  if (!Array.isArray(rawReviews) || rawReviews.length > 2000 || rawReviews.some(review =>
    !review || !validISO(review.from) || !validISO(review.to) || review.from >= review.to || !['unknown', 'long'].includes(review.kind)
  )) {
    throw new Error('記録の確認内容を読み込めません。');
  }
  const restored = {
    version: 1,
    onboarded: true,
    cycleDays,
    cycleUnknown: data.cycleUnknown,
    showPremenstrual: data.showPremenstrual,
    showOvulation: data.showOvulation,
    periods,
    intervalReviews: rawReviews.map(({ from, to, kind }) => ({ from, to, kind })),
  };
  restored.intervalReviews = activeReviews(restored);
  return restored;
};

$('start-button').addEventListener('click', () => show('welcome-screen'));
$('start-import-button').addEventListener('click', () => $('import-file').click());
$('import-file').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) {
    showNotice('ファイルが大きすぎます。バックアップファイルを確認してください。');
    return;
  }
  let imported;
  try {
    imported = decodeBackup(JSON.parse(await file.text()));
  } catch (error) {
    showNotice(error instanceof SyntaxError ? 'JSONファイルを読み込めません。バックアップファイルを確認してください。' : error.message);
    return;
  }
  if (state.periods.length && !window.confirm('このブラウザの記録を、読み込むバックアップの内容に置き換えます。続けますか？')) return;
  const previous = state;
  state = imported;
  if (!save()) { state = previous; return; }
  displayedMonth = new Date();
  selectedDate = todayISO();
  hasSelectedDate = true;
  renderCalendar();
  $('app-notice').hidden = true;
  show('calendar-screen');
  showCompletion('記録を読み込みました');
});
$('export-records').addEventListener('click', () => {
  if (!state.periods.length) return;
  const backup = {
    format: 'period-tracker-backup',
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    data: {
      version: 1,
      onboarded: true,
      cycleDays: state.cycleDays,
      cycleUnknown: state.cycleUnknown,
      showPremenstrual: state.showPremenstrual,
      showOvulation: state.showOvulation,
      periods: state.periods.map(period => ({
        id: period.id,
        start: period.start,
        end: period.end || null,
      })),
      intervalReviews: activeReviews(state),
    },
  };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `period-tracker-${todayISO()}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
$('welcome-back').addEventListener('click', () => show('start-screen'));
$('welcome-next').addEventListener('click', () => {
  show('setup-screen');
  $('setup-title').focus({ preventScroll: true });
});
$('setup-back').addEventListener('click', () => show('welcome-screen'));
$('add-start').addEventListener('click', () => { addStartRow(); $('start-date-list').lastElementChild.querySelector('input').focus(); });
$('setup-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const rawCycle = $('cycle-days').value.trim();
  const cycle = rawCycle === '' ? null : Number(rawCycle);
  const cycleUnknown = cycle === null;
  const starts = [...$('start-date-list').querySelectorAll('input')].map((input) => input.value).filter(Boolean);
  let error = '';
  if (cycle !== null && (!Number.isInteger(cycle) || cycle < 1 || cycle > 365)) error = '周期は1〜365日の数字で入力してください。';
  else if (!starts.length) error = '生理開始日を1件以上入力してください。';
  else if (starts.some((start) => !validISO(start) || start > todayISO())) error = '生理開始日は今日以前の日付を選んでください。';
  else if (new Set(starts).size !== starts.length) error = '同じ開始日が重複しています。';
  else if ([...starts].sort().some((start, i, dates) => i > 0 && dayGap(dates[i - 1], start) < 2)) error = '開始日の翌日には、次の開始日を登録できません。';
  showError('setup-error', error);
  if (error) return;
  state = { version: 1, onboarded: true, cycleDays: cycleUnknown ? null : cycle, cycleUnknown, showPremenstrual: $('show-premenstrual').checked, showOvulation: $('show-ovulation').checked, periods: starts.map((start) => ({ id: createId(), start, end: null })) };
  if (!save()) return;
  displayedMonth = new Date();
  renderCalendar();
  show('calendar-screen');
  showCompletion('カレンダーができました');
});

const sortedPeriods = () => [...state.periods].sort((a, b) => b.start.localeCompare(a.start));
const periodThrough = (date) => sortedPeriods().find(period => period.start <= date) ?? null;
const canStartOn = (date, periods = state.periods) => {
  if (!validISO(date) || date > todayISO()) return false;
  const records = [...periods].sort((a, b) => a.start.localeCompare(b.start));
  if (records.some(p => p.start === date || (p.end && p.start <= date && date <= p.end))) return false;
  const previous = records.filter(p => p.start < date).at(-1);
  const next = records.find(p => p.start > date);
  return (!previous || dayGap(previous.end || previous.start, date) >= 2)
    && (!next || dayGap(date, next.start) >= 2);
};
const canEndOn = (period, date) => {
  const next = sortedPeriods().filter(p => p.start > period.start).at(-1);
  return date >= period.start && date <= todayISO()
    && (!next || dayGap(date, next.start) >= 2)
    && !overlaps(state.periods, period.id, period.start, date);
};
const renderCalendar = (promptGap = true) => {
  $('export-records').disabled = state.periods.length === 0;
  const year = displayedMonth.getFullYear(), month = displayedMonth.getMonth();
  $('month-label').textContent = `${year}年 ${month + 1}月 ▾`;
  $('month-label').setAttribute('aria-label', `${year}年${month + 1}月、年月を選ぶ`);
  const prediction = predict(state);
  const predictionRecordCount = predictionRecords(state).length;
  $('ovulation-legend').hidden = !state.showOvulation;
  $('pms-legend').hidden = !state.showPremenstrual;
  $('prediction-note').textContent = !prediction ? (predictionRecordCount > 1 ? '予測に使える周期がまだありません。' : '開始日を記録すると予測が表示されます。') : predictionRecordCount === 1 && !(Number.isInteger(state.cycleDays) && state.cycleDays > 0) ? '28日周期で予測しています。' : '予測と各時期の表示は目安です。';
  const firstWeekday = new Date(year, month, 1).getDay();
  const count = Math.ceil((firstWeekday + new Date(year, month + 1, 0).getDate()) / 7) * 7;
  const grid = $('calendar-grid'); grid.replaceChildren();
  for (let i = 0; i < count; i++) {
    const date = new Date(year, month, i - firstWeekday + 1);
    const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const button = document.createElement('button'); button.type = 'button'; button.className = 'day';
    const mark = document.createElement('span'); mark.className = 'day-mark';
    const number = document.createElement('span'); number.className = 'day-number'; number.textContent = date.getDate();
    mark.append(number); button.append(mark);
    const labels = [dateLabel(iso)];
    if (date.getMonth() !== month) button.classList.add('outside');
    if (iso === todayISO()) { button.classList.add('today'); button.setAttribute('aria-current', 'date'); labels.push('今日'); }
    button.setAttribute('aria-pressed', String(hasSelectedDate && iso === selectedDate));
    if (hasSelectedDate && iso === selectedDate) button.classList.add('selected');
    const record = recordAt(state.periods, iso);
    if (record) {
      mark.classList.add('period-color');
      if (record.provisional) mark.style.backgroundColor = ['#ed1769','#ef2170','#f12b77','#f3357e','#f53f85'][record.offset];
      labels.push(record.provisional ? '生理、終了日未入力の仮表示' : '生理');
    } else if (prediction) {
      const main = iso === prediction.main, alternative = iso === prediction.alternative;
      if (main || alternative) {
        mark.classList.add(main ? 'forecast-main' : 'forecast-alternative');
        if (main && alternative) mark.classList.add('forecast-both');
        if (main) labels.push('本命の生理開始予測日');
        if (alternative) labels.push('対抗の生理開始予測日');
      } else if (state.showOvulation && iso === prediction.ovulation) { mark.classList.add('ovulation-color'); labels.push('排卵予定日の目安'); }
      else if (state.showPremenstrual && prediction.pmsFrom && prediction.pmsFrom <= iso && iso <= prediction.pmsTo) { mark.classList.add('pms-color'); labels.push('PMSが出やすい時期の目安'); }
    }
    button.setAttribute('aria-label', labels.join('、'));
    button.addEventListener('click', () => { if (Date.now() < suppressDateClickUntil) return; hasSelectedDate = true; selectedDate = iso; showError('calendar-error', ''); renderCalendar(); grid.querySelector(`[data-date="${iso}"]`)?.focus({ preventScroll: true }); });
    button.dataset.date = iso; grid.append(button);
  }
  const record = recordAt(state.periods, selectedDate);
  const selectedStartPeriod = state.periods.find(period => period.start === selectedDate);
  const selectedEndPeriod = state.periods.find(period => period.end === selectedDate);
  const endingPeriod = selectedEndPeriod || periodThrough(selectedDate);
  const endOverlapsAnotherRecord = endingPeriod && !selectedEndPeriod && !canEndOn(endingPeriod, selectedDate);
  $('date-start-action').disabled = selectedDate > todayISO() || (!selectedStartPeriod && !canStartOn(selectedDate));
  $('date-end-action').disabled = selectedDate > todayISO() || !endingPeriod || Boolean(endOverlapsAnotherRecord);
  $('date-start-action').textContent = selectedStartPeriod ? 'キャンセル' : '生理開始';
  $('date-end-action').textContent = selectedEndPeriod ? 'キャンセル' : '生理終了';
  $('date-start-action').classList.toggle('is-active', Boolean(selectedStartPeriod));
  $('date-end-action').classList.toggle('is-active', Boolean(selectedEndPeriod));
  $('date-start-action').setAttribute('aria-pressed', String(Boolean(selectedStartPeriod)));
  $('date-end-action').setAttribute('aria-pressed', String(Boolean(selectedEndPeriod)));
  $('date-start-action').setAttribute('aria-label', `${dateLabel(selectedDate)}${selectedStartPeriod ? 'の生理開始をキャンセル' : 'を生理開始日にする'}`);
  $('date-end-action').setAttribute('aria-label', `${dateLabel(selectedDate)}${selectedEndPeriod ? 'の生理終了をキャンセル' : 'を生理終了日にする'}`);
  renderCalendarNotices(prediction);
  renderGapNotice(promptGap);
};
const renderCalendarNotices = (prediction) => {
  const container = $('calendar-notices');
  container.replaceChildren();
  const notices = [];
  const today = todayISO();
  const currentPeriod = recordAt(state.periods, today);
  if (currentPeriod) notices.push({ kind: 'period-color', text: currentPeriod.offset === 0 ? '生理開始日です' : `生理${currentPeriod.offset + 1}日目です` });

  if (prediction) {
    const mainDays = dayGap(today, prediction.main);
    const alternativeDays = dayGap(today, prediction.alternative);
    const inNoticeWindow = days => days >= 0 && days <= 2;
    if (prediction.main === prediction.alternative && inNoticeWindow(mainDays)) {
      notices.push({ kind: 'forecast-both', text: mainDays === 0 ? '本命／対抗の開始予定日です' : `本命／対抗の開始日${mainDays}日前です` });
    } else {
      if (inNoticeWindow(mainDays)) notices.push({ kind: 'forecast-main', text: mainDays === 0 ? '本命の開始予定日です' : `本命の開始日${mainDays}日前です` });
      if (inNoticeWindow(alternativeDays)) notices.push({ kind: 'forecast-alternative', text: alternativeDays === 0 ? '対抗の開始予定日です' : `対抗の開始日${alternativeDays}日前です` });
    }
    if (state.showOvulation && prediction.ovulation === today) notices.push({ kind: 'ovulation-color', text: '排卵予定日です' });
    if (state.showPremenstrual && prediction.pmsFrom <= today && today <= prediction.pmsTo) notices.push({ kind: 'pms-color', text: 'PMSが出やすい時期です' });
  }

  container.hidden = notices.length === 0;
  for (const notice of notices) {
    const row = document.createElement('p');
    row.className = 'calendar-notice';
    const dot = document.createElement('i');
    dot.className = `notice-dot ${notice.kind}`;
    dot.setAttribute('aria-hidden', 'true');
    const text = document.createElement('span');
    text.textContent = notice.text;
    row.append(dot, text);
    container.append(row);
  }
};
const moveMonth = delta => {
  displayedMonth = new Date(displayedMonth.getFullYear(), displayedMonth.getMonth() + delta, 1);
  renderCalendar();
};
$('prev-month').addEventListener('click', () => moveMonth(-1));
$('next-month').addEventListener('click', () => moveMonth(1));
let swipeStart = null;
const calendarGrid = $('calendar-grid');
calendarGrid.addEventListener('pointerdown', event => {
  if (!event.isPrimary || event.button !== 0) { swipeStart = null; return; }
  swipeStart = { id: event.pointerId, x: event.clientX, y: event.clientY, time: Date.now() };
});
calendarGrid.addEventListener('pointercancel', () => { swipeStart = null; });
window.addEventListener('pointerup', event => {
  const start = swipeStart; swipeStart = null;
  if (!start || start.id !== event.pointerId) return;
  const dx = event.clientX - start.x, dy = event.clientY - start.y;
  if (Math.abs(dx) < 55 || Math.abs(dx) < Math.abs(dy) * 1.5 || Date.now() - start.time > 1200) return;
  suppressDateClickUntil = Date.now() + 400;
  moveMonth(dx < 0 ? 1 : -1);
});
$('date-start-action').addEventListener('click', () => {
  if (!selectedDate || selectedDate > todayISO()) return;
  const selectedStartPeriod = state.periods.find(period => period.start === selectedDate);
  const previous = structuredClone(state);
  if (selectedStartPeriod) state.periods = state.periods.filter(period => period !== selectedStartPeriod);
  else {
    if (!canStartOn(selectedDate)) return;
    state.periods.push({ id: createId(), start: selectedDate, end: null });
  }
  showError('calendar-error', '');
  if (!save()) { state = previous; return; }
  renderCalendar();
});
$('date-end-action').addEventListener('click', () => {
  if (!selectedDate || selectedDate > todayISO()) return;
  const selectedEndPeriod = state.periods.find(period => period.end === selectedDate);
  if (selectedEndPeriod) {
    const previous = structuredClone(state);
    selectedEndPeriod.end = null;
    if (!save()) { state = previous; return; }
    renderCalendar();
    return;
  }
  const period = periodThrough(selectedDate);
  if (!period || !canEndOn(period, selectedDate)) return;
  showError('calendar-error', '');
  const previous = structuredClone(state);
  period.end = selectedDate;
  if (!save()) { state = previous; return; }
  renderCalendar();
});
const rememberEditDraft = () => {
  if (!editingId) return;
  editDrafts.set(editingId, { id: editingId, start: $('edit-start').value, end: $('edit-end-empty').checked ? null : $('edit-end').value || null });
};
const populateEdit = (id) => {
  const period = editDrafts.get(id) || state.periods.find(p => p.id === id); if (!period) return;
  editingId = id; $('edit-record-select').value = id;
  $('edit-start').value = period.start; $('edit-end').value = period.end || '';
  $('edit-end-empty').checked = !period.end;
  $('edit-end').disabled = !period.end;
  $('edit-start').max = todayISO(); $('edit-end').max = todayISO(); $('edit-end').min = period.start;
  showError('edit-error', '');
};
$('edit-record-select').addEventListener('change', () => { const id = $('edit-record-select').value; rememberEditDraft(); populateEdit(id); });
$('edit-start').addEventListener('change', () => { $('edit-end').min = $('edit-start').value; });
$('edit-end-empty').addEventListener('change', () => {
  const isEmpty = $('edit-end-empty').checked;
  $('edit-end').disabled = isEmpty;
  if (isEmpty) $('edit-end').value = '';
});
const renderEditRecords = (selectedId = null) => {
  const records = sortedPeriods();
  $('edit-record-select').replaceChildren(...records.map(record => {
    const option = document.createElement('option');
    option.value = record.id;
    option.textContent = `${dateLabel(record.start)} 開始`;
    return option;
  }));
  const selected = records.find(record => record.id === selectedId) || records[0];
  if (selected) populateEdit(selected.id);
  else editingId = null;
};
const renderCycleHistory = () => {
  const candidates = new Set(gapCandidates(state).map(c => c.key));
  const weights = new Map(weightedCycles(state).map(c => [c.key, c.weight]));
  $('cycle-history').replaceChildren();
  for (const record of excludedPredictionRecords(state).reverse()) {
    const item = document.createElement('li');
    const date = document.createElement('span');
    date.textContent = `${dateLabel(record.start)}の出血`;
    const status = document.createElement('small');
    status.textContent = 'イレギュラーな記録・予測には使いません';
    item.append(date, status);
    $('cycle-history').append(item);
  }
  cycleIntervals(state).reverse().forEach(cycle => {
    const item = document.createElement('li');
    const range = document.createElement('span');
    range.textContent = `${cycle.from} 〜 ${cycle.to}：${cycle.days}日間`;
    item.append(range);
    const status = document.createElement('small');
    if (cycle.kind === 'unknown') status.textContent = '記録不明・予測には使いません';
    else if (['long', 'short'].includes(cycle.kind)) {
      status.textContent = weights.get(cycle.key) < 1
        ? 'イレギュラーな周期・影響を抑えて計算'
        : `${cycle.kind === 'short' ? '短い' : '長い'}周期が続いているため計算に反映`;
    } else if (candidates.has(cycle.key)) status.textContent = 'まだ確認していない区間';
    if (status.textContent) item.append(status);
    if (cycle.kind !== 'recorded' || candidates.has(cycle.key)) {
      const review = document.createElement('button');
      review.type = 'button'; review.className = 'text-button'; review.textContent = '区間を確認';
      review.addEventListener('click', () => { $('cycle-dialog').close(); openGap(cycle.key); });
      item.append(review);
    }
    $('cycle-history').append(item);
  });
};
$('cycle-form').addEventListener('submit', event => { event.preventDefault(); saveCycleAndRecord(); });
$('edit-form').addEventListener('submit', event => { event.preventDefault(); saveCycleAndRecord(); });
$('save-cycle-records').addEventListener('click', () => saveCycleAndRecord());
$('open-cycle').addEventListener('click', () => {
  syncStoredState();
  editDrafts = new Map();
  $('edit-cycle-days').value = state.cycleDays ?? '';
  showError('cycle-error', '');
  const records = predictionRecords(state);
  renderCycleHistory();
  renderEditRecords(editingId);
  $('cycle-help').textContent = records.length >= 2
    ? '開始日が2件以上ある場合は、記録した周期を使って予測します。入力した日数は、開始日が1件のときの参考にします。'
    : '入力した日数は予測の参考です。空欄は「不明」として保存し、開始日が1件だけなら28日周期を参考にします。';
  $('cycle-dialog').showModal();
  $('cycle-title').focus({ preventScroll: true });
});
$('reset-data').addEventListener('click', () => {
  if (!window.confirm('このブラウザに保存した生理の記録と設定をすべて削除し、最初からやり直します。削除してもよいですか？')) return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    showNotice('リセットできませんでした。ブラウザの保存設定を確認してください。');
    return;
  }
  window.location.reload();
});
$('close-cycle').addEventListener('click', () => $('cycle-dialog').close());
const saveCycleAndRecord = () => {
  rememberEditDraft();
  const raw = $('edit-cycle-days').value.trim();
  const days = raw === '' ? null : Number(raw);
  const cycleError = $('edit-cycle-days').validity.badInput || (days !== null && (!Number.isInteger(days) || days < 1 || days > 365))
    ? '周期は1〜365日の数字で入力してください。' : '';
  const records = state.periods.map(p => editDrafts.get(p.id) || p);
  let editError = '';
  let invalidId = null;
  for (const period of records) {
    const original = state.periods.find(p => p.id === period.id);
    if (period.start === original.start && period.end === original.end) continue;
    if (!validISO(period.start) || period.start > todayISO()) editError = '開始日は今日以前の日付を入力してください。';
    else if (period.end && (!validISO(period.end) || period.end < period.start || period.end > todayISO())) editError = '終了日は開始日から今日までの日付にしてください。';
    else if (!canStartOn(period.start, records.filter(p => p.id !== period.id)) || overlaps(records, period.id, period.start, period.end)
      || (period.end && records.some(p => p.start > period.start && dayGap(period.end, p.start) < 2))) editError = '次の開始日は、前の開始日または入力済みの終了日の翌々日以降にしてください。';
    if (editError) { invalidId = period.id; break; }
  }
  if (invalidId) populateEdit(invalidId);
  showError('cycle-error', cycleError);
  showError('edit-error', editError);
  if (cycleError || editError) return;
  const previous = structuredClone(state);
  state.cycleUnknown = days === null;
  state.cycleDays = days;
  state.periods = records;
  const changed = JSON.stringify(previous) !== JSON.stringify(state);
  if (!save()) { state = previous; return; }
  $('cycle-dialog').close();
  renderCalendar();
  if (changed) showCompletion('変更が保存されました');
};
let activeGapKey = null;
let automaticGapShown = false;
let gapPromptTimer;
const getActiveGap = () => cycleIntervals(state).find(c => c.key === activeGapKey);
const openGap = (key) => {
  const gap = cycleIntervals(state).find(c => c.key === key);
  if (!gap) return;
  activeGapKey = key;
  automaticGapShown = true;
  const compactDate = iso => {
    const [year, month, day] = iso.split('-').map(Number);
    return `${gap.from.slice(0, 4) === gap.to.slice(0, 4) ? '' : `${year}年`}${month}月${day}日`;
  };
  $('gap-range').textContent = `${compactDate(gap.from)} — ${gap.days}日間 — ${compactDate(gap.to)}`;
  $('gap-choices').hidden = false;
  $('gap-date-form').hidden = true;
  $('gap-start').value = '';
  $('gap-start').min = shiftDay(gap.from, 1);
  $('gap-start').max = shiftDay(gap.to, -1);
  showError('gap-error', '');
  if (!$('gap-popover').matches(':popover-open')) $('gap-popover').showPopover();
  $('gap-title').focus({ preventScroll: true });
};
const renderGapNotice = (prompt = true) => {
  const candidates = gapCandidates(state);
  $('gap-notice').hidden = !candidates.length;
  if ($('gap-popover').matches(':popover-open') && !getActiveGap()) $('gap-popover').hidePopover();
  clearTimeout(gapPromptTimer);
  if (!prompt || automaticGapShown || !candidates.length) return;
  const promptWhenReady = () => {
    if (!$('completion-toast').hidden) { gapPromptTimer = setTimeout(promptWhenReady, 4200); return; }
    if ($('calendar-screen').hidden || document.querySelector('dialog[open], [popover]:popover-open')) return;
    const next = gapCandidates(state).at(-1);
    if (next) openGap(next.key);
  };
  gapPromptTimer = setTimeout(promptWhenReady, 0);
};
$('gap-notice').addEventListener('click', () => {
  const next = gapCandidates(state).at(-1);
  if (next) openGap(next.key);
});
$('close-gap').addEventListener('click', () => $('gap-popover').hidePopover());
$('gap-add').addEventListener('click', () => {
  $('gap-choices').hidden = true;
  $('gap-date-form').hidden = false;
  showError('gap-error', '');
});
$('gap-back').addEventListener('click', () => {
  $('gap-choices').hidden = false;
  $('gap-date-form').hidden = true;
  showError('gap-error', '');
});
const saveGapReview = (kind) => {
  const gap = getActiveGap();
  if (!gap) { showError('gap-error', '記録が変更されました。区間を選び直してください。'); return; }
  const previous = structuredClone(state);
  state.intervalReviews = activeReviews(state).filter(r => intervalKey(r.from, r.to) !== gap.key);
  state.intervalReviews.push({ from: gap.from, to: gap.to, kind });
  if (!save()) { state = previous; showError('gap-error', '保存できませんでした。もう一度お試しください。'); return; }
  $('gap-popover').hidePopover();
  renderCalendar(false);
};
$('gap-unknown').addEventListener('click', () => saveGapReview('unknown'));
$('gap-long').addEventListener('click', () => saveGapReview('long'));
$('gap-date-form').addEventListener('submit', event => {
  event.preventDefault();
  const gap = getActiveGap(), start = $('gap-start').value;
  let error = '';
  if (!gap) error = '記録が変更されました。区間を選び直してください。';
  else if (!validISO(start) || start <= gap.from || start >= gap.to || start > todayISO()) error = 'この区間の中から開始日を選んでください。';
  else if (!canStartOn(start)) error = '前の開始日または入力済みの終了日の翌々日以降を選んでください。';
  showError('gap-error', error);
  if (error) return;
  const previous = structuredClone(state);
  state.periods.push({ id: createId(), start, end: null });
  if (!save()) { state = previous; showError('gap-error', '保存できませんでした。もう一度お試しください。'); return; }
  $('gap-popover').hidePopover();
  displayedMonth = new Date(`${start}T12:00:00`);
  selectedDate = start; hasSelectedDate = true;
  renderCalendar(false);
});
const syncVisibility = () => {
  $('settings-premenstrual').checked = state.showPremenstrual;
  $('settings-ovulation').checked = state.showOvulation;
};
const positionVisibility = () => {
  const anchor = $('settings-button').getBoundingClientRect();
  const popover = $('settings-popover');
  const width = Math.min(260, window.innerWidth - 24);
  popover.style.width = `${width}px`;
  popover.style.left = `${Math.max(12, Math.min(anchor.right - width, window.innerWidth - width - 12))}px`;
  popover.style.top = `${Math.max(12, Math.min(anchor.bottom + 8, window.innerHeight - 128))}px`;
};
$('settings-popover').addEventListener('beforetoggle', event => {
  if (event.newState === 'open') { syncVisibility(); positionVisibility(); }
});
window.addEventListener('resize', positionVisibility);
window.addEventListener('scroll', () => {
  if ($('settings-popover').matches(':popover-open')) $('settings-popover').hidePopover();
}, { passive: true });
for (const id of ['settings-premenstrual', 'settings-ovulation']) {
  $(id).addEventListener('change', () => {
    const previous = structuredClone(state);
    state.showPremenstrual = $('settings-premenstrual').checked;
    state.showOvulation = $('settings-ovulation').checked;
    if (!save()) { state = previous; syncVisibility(); return; }
    renderCalendar();
  });
}
let firstPickerYear, lastPickerYear;
const renderMonthPicker = () => {
  const list = $('month-years'); list.replaceChildren(); const now = new Date();
  for (let year = firstPickerYear; year <= lastPickerYear; year++) {
    const section = document.createElement('section'); section.className = 'year-section'; section.id = `picker-year-${year}`;
    const heading = document.createElement('h3'); heading.textContent = year; section.append(heading);
    const months = document.createElement('div'); months.className = 'month-grid';
    for (let month = 0; month < 12; month++) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'month-option'; button.textContent = `${month + 1}月`;
      const recorded = recordedInMonth(state.periods, year, month);
      const current = now.getFullYear() === year && now.getMonth() === month;
      if (recorded) button.classList.add('has-record');
      if (current) { button.classList.add('current-month'); button.setAttribute('aria-current', 'date'); }
      button.setAttribute('aria-label', `${year}年${month + 1}月${recorded ? '、生理の記録あり' : ''}${current ? '、今月' : ''}`);
      button.setAttribute('aria-pressed', String(displayedMonth.getFullYear() === year && displayedMonth.getMonth() === month));
      button.addEventListener('click', () => { displayedMonth = new Date(year, month, 1); $('month-dialog').close(); renderCalendar(); });
      months.append(button);
    }
    section.append(months); list.append(section);
  }
};
$('month-label').addEventListener('click', () => {
  firstPickerYear = displayedMonth.getFullYear() - 1; lastPickerYear = displayedMonth.getFullYear() + 2;
  renderMonthPicker(); $('month-dialog').showModal();
  $(`picker-year-${displayedMonth.getFullYear()}`).scrollIntoView({ block: 'start' });
});
$('close-month').addEventListener('click', () => $('month-dialog').close());
$('earlier-years').addEventListener('click', () => { firstPickerYear -= 3; renderMonthPicker(); });
$('later-years').addEventListener('click', () => { lastPickerYear += 3; renderMonthPicker(); });
// 編集中は入力を保ち、閉じた後に別タブの最新記録を取り込む。
const editingIsOpen = () => Boolean(document.querySelector('dialog[open], #gap-popover:popover-open'));
const syncStoredState = () => {
  if (editingIsOpen()) return;
  const current = localStorage.getItem(STORAGE_KEY);
  if (current === storedSnapshot && !remoteUpdatePending) return;
  state = loadState();
  storedSnapshot = current;
  remoteUpdatePending = false;
  renderCalendar(false);
  show(state.onboarded ? 'calendar-screen' : 'start-screen');
};
window.addEventListener('storage', event => {
  if (event.key !== STORAGE_KEY && event.key !== null) return;
  if (localStorage.getItem(STORAGE_KEY) === storedSnapshot) return;
  remoteUpdatePending = true;
  showUpdateToast(editingIsOpen()
    ? '別のタブで記録が更新されました。入力は保持しています。保存せず編集画面を閉じて最新の記録を確認してください。'
    : '別のタブで記録が更新されました');
  syncStoredState();
});
let lastDisplayedDay = todayISO();
const refreshDay = () => {
  if (editingIsOpen() || lastDisplayedDay === todayISO()) return;
  lastDisplayedDay = todayISO();
  selectedDate = lastDisplayedDay;
  hasSelectedDate = true;
  displayedMonth = new Date();
  document.querySelectorAll('#start-date-list input').forEach(input => { input.max = lastDisplayedDay; });
  if (state.onboarded) renderCalendar(false);
};
const resumeApp = () => { syncStoredState(); refreshDay(); };
window.addEventListener('focus', resumeApp);
window.addEventListener('pageshow', resumeApp);
document.addEventListener('visibilitychange', () => { if (!document.hidden) resumeApp(); });
for (const dialog of document.querySelectorAll('dialog')) dialog.addEventListener('close', resumeApp);
$('gap-popover').addEventListener('toggle', event => { if (event.newState === 'closed') resumeApp(); });
const scheduleMidnight = () => {
  const now = new Date();
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  setTimeout(() => { resumeApp(); scheduleMidnight(); }, tomorrow - now + 100);
};
scheduleMidnight();
addStartRow();
if (state.onboarded) { renderCalendar(); show('calendar-screen'); }
else show('start-screen');
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./service-worker.js').catch(() => {}));
}
