import { dayGap, shiftDay, recordAt, predict, recordedInMonth, overlaps } from "./calendar-model.mjs";
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
const emptyState = () => ({ version: 1, onboarded: false, cycleDays: null, irregular: false, showPremenstrual: true, showOvulation: true, periods: [] });
const loadState = () => {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.periods)) return emptyState();
    return { ...emptyState(), ...parsed, periods: parsed.periods.filter((p) => validISO(p.start) && (!p.end || validISO(p.end))) };
  } catch { return emptyState(); }
};
let state = loadState();
let displayedMonth = new Date();
let selectedDate = todayISO();
let hasSelectedDate = false;
let suppressDateClickUntil = 0;
let editingId = null;
let showCompletion = false;
const save = () => {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); return true; }
  catch { showNotice('保存できませんでした。ブラウザの保存設定を確認してください。'); return false; }
};
const show = (screen) => {
  for (const id of ['start-screen', 'welcome-screen', 'setup-screen', 'calendar-screen']) $(id).hidden = id !== screen;
  const step = screen === 'welcome-screen' ? 1 : screen === 'setup-screen' ? 2 : showCompletion ? 3 : 0;
  $('brand-bar').hidden = screen !== 'calendar-screen';
  $('app-shell').classList.toggle('is-start', screen === 'start-screen');
  document.body.classList.toggle('start-active', screen === 'start-screen');
  $('completion-card').hidden = !showCompletion;
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
const addStartRow = (value = '') => {
  const row = document.createElement('div'); row.className = 'date-row';
  const input = document.createElement('input'); input.type = 'date'; input.max = todayISO(); input.value = value; input.setAttribute('aria-label', '生理開始日');
  const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'remove-date'; remove.textContent = '×'; remove.setAttribute('aria-label', 'この入力欄を削除');
  remove.addEventListener('click', () => { if ($('start-date-list').children.length > 1) row.remove(); else input.value = ''; });
  row.append(input, remove); $('start-date-list').append(row);
};

$('start-button').addEventListener('click', () => show('welcome-screen'));
$('welcome-back').addEventListener('click', () => show('start-screen'));
$('welcome-next').addEventListener('click', () => { show('setup-screen'); $('cycle-days').focus(); });
$('setup-back').addEventListener('click', () => show('welcome-screen'));
$('add-start').addEventListener('click', () => { addStartRow(); $('start-date-list').lastElementChild.querySelector('input').focus(); });
$('irregular').addEventListener('change', () => { $('cycle-days').required = !$('irregular').checked; });
$('setup-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const rawCycle = $('cycle-days').value.trim();
  const cycle = rawCycle === '' ? null : Number(rawCycle);
  const irregular = $('irregular').checked;
  const starts = [...$('start-date-list').querySelectorAll('input')].map((input) => input.value).filter(Boolean);
  let error = '';
  if (!irregular && cycle === null) error = '周期の日数を入力するか、「周期が不定期」を選んでください。';
  else if (cycle !== null && (!Number.isInteger(cycle) || cycle < 1 || cycle > 365)) error = '周期は1〜365日の数字で入力してください。';
  else if (!starts.length) error = '生理開始日を1件以上入力してください。';
  else if (starts.some((start) => !validISO(start) || start > todayISO())) error = '生理開始日は今日以前の日付を選んでください。';
  else if (new Set(starts).size !== starts.length) error = '同じ開始日が重複しています。';
  showError('setup-error', error);
  if (error) return;
  state = { version: 1, onboarded: true, cycleDays: cycle, irregular, showPremenstrual: $('show-premenstrual').checked, showOvulation: $('show-ovulation').checked, periods: starts.map((start) => ({ id: createId(), start, end: null })) };
  if (!save()) return;
  displayedMonth = new Date();
  showCompletion = true;
  renderCalendar();
  show('calendar-screen');
});

$('dismiss-completion').addEventListener('click', () => { showCompletion = false; show('calendar-screen'); });

const sortedPeriods = () => [...state.periods].sort((a, b) => b.start.localeCompare(a.start));
const renderCalendar = () => {
  const year = displayedMonth.getFullYear(), month = displayedMonth.getMonth();
  $('month-label').textContent = `${year}年 ${month + 1}月 ▾`;
  $('month-label').setAttribute('aria-label', `${year}年${month + 1}月、年月を選ぶ`);
  const prediction = predict(state);
  $('ovulation-legend').hidden = !state.showOvulation;
  $('pms-legend').hidden = !state.showPremenstrual;
  $('prediction-note').textContent = !prediction ? '開始日を記録すると予測が表示されます。' : state.periods.length === 1 && !(Number.isInteger(state.cycleDays) && state.cycleDays > 0) ? '28日周期で仮に予測しています。' : '予測と各時期の表示は目安です。';
  const firstWeekday = new Date(year, month, 1).getDay();
  const count = Math.ceil((firstWeekday + new Date(year, month + 1, 0).getDate()) / 7) * 7;
  const grid = $('calendar-grid'); grid.replaceChildren();
  for (let i = 0; i < count; i++) {
    const date = new Date(year, month, i - firstWeekday + 1);
    const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const button = document.createElement('button'); button.type = 'button'; button.className = 'day';
    const mark = document.createElement('span'); mark.className = 'day-mark'; mark.textContent = date.getDate(); button.append(mark);
    const labels = [dateLabel(iso)];
    if (date.getMonth() !== month) button.classList.add('outside');
    if (iso === todayISO()) { button.classList.add('today'); button.setAttribute('aria-current', 'date'); labels.push('今日'); }
    button.setAttribute('aria-pressed', String(hasSelectedDate && iso === selectedDate));
    if (hasSelectedDate && iso === selectedDate) button.classList.add('selected');
    const record = recordAt(state.periods, iso);
    if (record) {
      mark.classList.add('period-color');
      if (record.provisional) mark.style.backgroundColor = ['#ec7da5','#ee88ac','#f093b4','#f29ebb','#f4a9c3'][record.offset];
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
    button.addEventListener('click', () => { if (Date.now() < suppressDateClickUntil) return; hasSelectedDate = true; selectedDate = iso; renderCalendar(); grid.querySelector(`[data-date="${iso}"]`)?.focus({ preventScroll: true }); });
    button.dataset.date = iso; grid.append(button);
  }
  const record = recordAt(state.periods, selectedDate);
  $('date-action').textContent = record ? '生理終了' : '生理開始';
  $('date-action').disabled = selectedDate > todayISO();
  $('date-action').setAttribute('aria-label', `${dateLabel(selectedDate)}を${record ? '生理終了日' : '生理開始日'}にする`);
  $('edit-period').disabled = !state.periods.length;
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
$('date-action').addEventListener('click', () => {
  if (!selectedDate || selectedDate > todayISO()) return;
  const record = recordAt(state.periods, selectedDate);
  showError('calendar-error', '');
  const previous = structuredClone(state);
  if (record) record.period.end = selectedDate;
  else state.periods.push({ id: createId(), start: selectedDate, end: null });
  if (!save()) { state = previous; return; }
  renderCalendar();
});
const populateEdit = (id) => {
  const period = state.periods.find(p => p.id === id); if (!period) return;
  editingId = id; $('edit-record-select').value = id;
  $('edit-start').value = period.start; $('edit-end').value = period.end || '';
  $('edit-start').max = todayISO(); $('edit-end').max = todayISO(); $('edit-end').min = period.start;
  showError('edit-error', '');
};
$('edit-period').addEventListener('click', () => {
  const select = $('edit-record-select'); select.replaceChildren();
  for (const p of sortedPeriods()) { const option = document.createElement('option'); option.value = p.id; option.textContent = `${dateLabel(p.start)} 開始`; select.append(option); }
  const record = recordAt(state.periods, selectedDate);
  const target = record?.period || sortedPeriods().find(p => p.start <= selectedDate) || sortedPeriods()[0];
  if (!target) return;
  populateEdit(target.id); $('edit-dialog').showModal();
});
$('edit-record-select').addEventListener('change', () => populateEdit($('edit-record-select').value));
$('edit-start').addEventListener('change', () => { $('edit-end').min = $('edit-start').value; });
$('close-edit').addEventListener('click', () => $('edit-dialog').close());
$('save-edit').addEventListener('click', () => {
  const period = state.periods.find(p => p.id === editingId); if (!period) return;
  const start = $('edit-start').value, end = $('edit-end').value || null;
  let error = '';
  if (!validISO(start) || start > todayISO()) error = '開始日は今日以前の日付にしてください。';
  else if (end && (!validISO(end) || end < start || end > todayISO())) error = '終了日は開始日から今日までの日付にしてください。';
  else if (overlaps(state.periods, editingId, start, end)) error = 'ほかの生理の記録と日付が重なっています。';
  showError('edit-error', error); if (error) return;
  const previous = structuredClone(state); period.start = start; period.end = end;
  if (!save()) { state = previous; return; }
  selectedDate = start; displayedMonth = new Date(`${start}T12:00:00`);
  $('edit-dialog').close(); renderCalendar();
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
addStartRow();
if (state.onboarded) { renderCalendar(); show('calendar-screen'); }
else show('start-screen');
