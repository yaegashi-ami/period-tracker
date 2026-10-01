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
let selectedDate = null;
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
const showNotice = (message) => {
  $('selected-date-panel').innerHTML = '';
  const strong = document.createElement('strong'); strong.textContent = message;
  $('selected-date-panel').append(strong);
};
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
const recordForDate = (iso) => {
  const confirmed = state.periods.find((p) => p.end && p.start <= iso && iso <= p.end);
  if (confirmed) return { type: 'confirmed', start: confirmed.start === iso };
  const provisional = state.periods.find((p) => !p.end && p.start <= iso && iso <= addDays(p.start, 4));
  return provisional ? { type: 'provisional', start: provisional.start === iso } : null;
};
const renderRecords = () => {
  const list = $('records-list'); list.replaceChildren();
  if (!state.periods.length) { const p = document.createElement('p'); p.className = 'empty-records'; p.textContent = 'まだ記録がありません。'; list.append(p); return; }
  for (const period of sortedPeriods()) {
    const row = document.createElement('div'); row.className = 'record-row';
    const text = document.createElement('div');
    const title = document.createElement('strong'); title.textContent = `${dateLabel(period.start)} 開始`;
    const end = document.createElement('small'); end.textContent = period.end ? `${dateLabel(period.end)} 終了` : '終了日未入力・5日間は仮表示';
    const button = document.createElement('button'); button.type = 'button'; button.textContent = '修正'; button.addEventListener('click', () => openEdit(period.id));
    text.append(title, end); row.append(text, button); list.append(row);
  }
};
const renderCalendar = () => {
  const year = displayedMonth.getFullYear(), month = displayedMonth.getMonth();
  $('month-label').textContent = `${year}年 ${month + 1}月`;
  $('cycle-summary').textContent = state.irregular ? `周期は不定期${state.cycleDays ? `・入力した目安 ${state.cycleDays}日` : ''}` : `入力した周期の目安 ${state.cycleDays}日`;
  const firstWeekday = new Date(year, month, 1).getDay();
  const grid = $('calendar-grid'); grid.replaceChildren();
  for (let i = 0; i < 42; i++) {
    const date = new Date(year, month, i - firstWeekday + 1);
    const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const button = document.createElement('button'); button.type = 'button'; button.className = 'day'; button.textContent = date.getDate();
    button.setAttribute('aria-label', `${dateLabel(iso)}${recordForDate(iso) ? '、生理の記録があります' : ''}`);
    if (date.getMonth() !== month) button.classList.add('outside');
    if (iso === todayISO()) button.classList.add('today');
    if (iso === selectedDate) button.classList.add('selected');
    const record = recordForDate(iso);
    if (record) { button.classList.add(record.type); if (record.start) button.classList.add('start'); }
    button.addEventListener('click', () => openDate(iso));
    grid.append(button);
  }
  renderRecords();
};
$('prev-month').addEventListener('click', () => { displayedMonth = new Date(displayedMonth.getFullYear(), displayedMonth.getMonth() - 1, 1); renderCalendar(); });
$('next-month').addEventListener('click', () => { displayedMonth = new Date(displayedMonth.getFullYear(), displayedMonth.getMonth() + 1, 1); renderCalendar(); });
const openDate = (iso) => {
  selectedDate = iso; renderCalendar();
  $('dialog-title').textContent = dateLabel(iso); showError('date-error', '');
  $('record-start').disabled = iso > todayISO() || state.periods.some((p) => p.start === iso);
  const select = $('period-for-end'); select.replaceChildren();
  for (const p of sortedPeriods().filter((p) => p.start <= iso)) {
    const option = document.createElement('option'); option.value = p.id; option.textContent = `${dateLabel(p.start)} 開始`; select.append(option);
  }
  $('record-end').disabled = iso > todayISO() || !select.options.length;
  $('selected-date-panel').innerHTML = '';
  const strong = document.createElement('strong'); strong.textContent = dateLabel(iso);
  const p = document.createElement('p'); p.textContent = '開始日や終了日を記録・修正できます。';
  $('selected-date-panel').append(strong, p);
  $('date-dialog').showModal();
};
$('close-dialog').addEventListener('click', () => $('date-dialog').close());
$('record-start').addEventListener('click', () => {
  if (!selectedDate || selectedDate > todayISO()) return;
  if (state.periods.some((p) => p.start === selectedDate)) { showError('date-error', 'この日はすでに開始日として記録されています。'); return; }
  state.periods.push({ id: createId(), start: selectedDate, end: null });
  if (!save()) return; $('date-dialog').close(); renderCalendar();
});
$('record-end').addEventListener('click', () => {
  const period = state.periods.find((p) => p.id === $('period-for-end').value);
  if (!period || !selectedDate || selectedDate > todayISO() || selectedDate < period.start) return;
  period.end = selectedDate;
  if (!save()) return; $('date-dialog').close(); renderCalendar();
});
$('add-today').addEventListener('click', () => openDate(todayISO()));
const openEdit = (id) => {
  const period = state.periods.find((p) => p.id === id); if (!period) return;
  editingId = id; $('edit-start').value = period.start; $('edit-end').value = period.end ?? '';
  $('edit-start').max = todayISO(); $('edit-end').max = todayISO(); showError('edit-error', ''); $('edit-dialog').showModal();
};
$('close-edit').addEventListener('click', () => $('edit-dialog').close());
$('save-edit').addEventListener('click', () => {
  const period = state.periods.find((p) => p.id === editingId); if (!period) return;
  const start = $('edit-start').value, end = $('edit-end').value || null;
  let error = '';
  if (!validISO(start) || start > todayISO()) error = '開始日は今日以前の日付にしてください。';
  else if (state.periods.some((p) => p.id !== editingId && p.start === start)) error = '同じ開始日が重複しています。';
  else if (end && (!validISO(end) || end < start || end > todayISO())) error = '終了日は開始日から今日までの日付にしてください。';
  showError('edit-error', error); if (error) return;
  period.start = start; period.end = end;
  if (!save()) return; $('edit-dialog').close(); renderCalendar();
});
$('settings-button').addEventListener('click', () => {
  $('settings-premenstrual').checked = state.showPremenstrual;
  $('settings-ovulation').checked = state.showOvulation;
  $('settings-dialog').showModal();
});
$('close-settings').addEventListener('click', () => $('settings-dialog').close());
$('save-settings').addEventListener('click', () => {
  state.showPremenstrual = $('settings-premenstrual').checked;
  state.showOvulation = $('settings-ovulation').checked;
  if (!save()) return; $('settings-dialog').close();
});

addStartRow();
if (state.onboarded) { renderCalendar(); show('calendar-screen'); }
else show('start-screen');
