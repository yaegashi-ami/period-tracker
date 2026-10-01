import test from 'node:test';
import assert from 'node:assert/strict';
import { dayGap, shiftDay, predict, recordAt, recordedInMonth, overlaps } from './calendar-model.mjs';
const periods = [
  { id: 'a', start: '2025-01-01', end: '2025-01-05' },
  { id: 'b', start: '2025-01-26', end: '2025-01-30' },
  { id: 'c', start: '2025-02-25', end: '2025-03-01' },
  { id: 'd', start: '2025-03-29', end: null }
];
test('日付差は閏日と年をまたいでも日数単位', () => {
  assert.equal(dayGap('2024-02-28', '2024-03-01'), 2);
  assert.equal(shiftDay('2024-12-31', 1), '2025-01-01');
});
test('直近3周期の中央値と1年の平均、および指定された時期', () => {
  assert.deepEqual(predict({ periods, cycleDays: 28 }), {
    main: '2025-04-28', alternative: '2025-04-27', ovulation: '2025-04-14', pmsFrom: '2025-04-18', pmsTo: '2025-04-25'
  });
});
test('開始日1回なら入力周期、未入力なら仮の28日、記録なしは予測なし', () => {
  assert.equal(predict({ periods: [periods[0]], cycleDays: 28 }).main, '2025-01-29');
  assert.equal(predict({ periods: [periods[0]], cycleDays: null }).main, '2025-01-29');
  assert.equal(predict({ periods: [periods[0]], cycleDays: 31 }).main, '2025-02-01');
  assert.equal(predict({ periods: [], cycleDays: 28 }), null);
});
test('1年以上前の周期は対抗の平均に含めない', () => {
  const result = predict({ periods: [{start:'2023-01-01'}, {start:'2023-01-11'}, ...periods], cycleDays: 28 });
  assert.equal(result.alternative, '2025-04-27');
});
test('仮表示は5日間、次の開始日で打ち切る', () => {
  assert.equal(recordAt(periods, '2025-04-02').offset, 4);
  assert.equal(recordAt(periods, '2025-04-03'), null);
  const next = [...periods, {id:'e', start:'2025-03-31', end:'2025-03-31'}];
  assert.equal(recordAt(next, '2025-03-31').period.id, 'e');
  assert.equal(recordAt(next, '2025-04-01'), null);
});
test('月跨ぎの確定記録と重複を検出する', () => {
  assert.equal(recordedInMonth([periods[2]], 2025, 2), true);
  assert.equal(recordedInMonth([periods[3]], 2025, 3), false);
  assert.equal(overlaps(periods, 'd', '2025-02-28', '2025-03-02'), true);
  assert.equal(overlaps(periods, 'd', '2025-03-29', '2025-04-01'), false);
});

test('2回目から仮の28日も入力周期も混ぜず本人の周期だけを使う', () => {
  const state = { periods: [{ start: '2025-01-01' }], cycleDays: null };
  predict(state);
  assert.equal(state.cycleDays, null);
  state.periods.push({ start: '2025-02-05' });
  for (const cycleDays of [null, 28, 31]) {
    const result = predict({ ...state, cycleDays });
    assert.equal(result.main, '2025-03-12');
    assert.equal(result.alternative, '2025-03-12');
  }
});
test('1年以内の周期がない場合も仮の28日に戻さない', () => {
  const result = predict({ periods: [{ start: '2023-01-01' }, { start: '2024-01-02' }], cycleDays: 28 });
  assert.equal(result.main, '2025-01-02');
  assert.equal(result.alternative, result.main);
});
