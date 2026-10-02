import test from 'node:test';
import assert from 'node:assert/strict';
import { dayGap, shiftDay, predict, recordAt, recordedInMonth, overlaps, cycleIntervals, gapCandidates, activeReviews, weightedCycles } from './calendar-model.mjs';
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
test('直近3周期の中央値と半年の平均、および指定された時期', () => {
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
test('半年前より古い周期は対抗の平均に含めない', () => {
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
test('半年以内の周期がない場合も仮の28日に戻さない', () => {
  const result = predict({ periods: [{ start: '2023-01-01' }, { start: '2024-01-02' }], cycleDays: 28 });
  assert.equal(result.main, '2025-01-02');
  assert.equal(result.alternative, result.main);
});

test('対抗は最新の開始日から6か月前を含み、それより前を除く', () => {
  const result = predict({ periods: [
    { start: '2025-04-01' }, { start: '2025-04-02' },
    { start: '2025-05-02' }, { start: '2025-10-02' }
  ] });
  // 4月1日開始の1日周期は除外。4月2日以降の30日・153日周期を平均。
  assert.equal(result.alternative, shiftDay('2025-10-02', 92));
  assert.equal(result.main, shiftDay('2025-10-02', 30));
});
test('6か月前に同じ日がない場合はその月の末日を含む', () => {
  for (const [latest, before, cutoff, next, expected] of [
    ['2025-10-31', '2025-04-29', '2025-04-30', '2025-05-31', 92],
    ['2024-08-31', '2024-02-28', '2024-02-29', '2024-03-31', 92],
    ['2025-08-31', '2025-02-27', '2025-02-28', '2025-03-31', 92]
  ]) {
    const result = predict({ periods: [before, cutoff, next, latest].map(start => ({ start })) });
    assert.equal(result.alternative, shiftDay(latest, expected));
  }
});

const fromCycles = (days) => {
  const rows = [{ id: '0', start: '2025-01-01', end: '2025-01-05' }];
  for (const [i, length] of days.entries()) rows.push({ id: String(i + 1), start: shiftDay(rows.at(-1).start, length), end: null });
  return { periods: rows, intervalReviews: [] };
};
const reviewCycle = (state, index, kind) => {
  const cycle = cycleIntervals(state)[index];
  state.intervalReviews.push({ from: cycle.from, to: cycle.to, kind });
};
test('確認候補は本人の最短周期の2倍以上。比較対象がなければ出さない', () => {
  assert.deepEqual(gapCandidates(fromCycles([63])), []);
  assert.deepEqual(gapCandidates(fromCycles([28, 55])).map(c => c.days), []);
  assert.deepEqual(gapCandidates(fromCycles([28, 56, 63])).map(c => c.days), [56, 63]);
  const state = fromCycles([28, 63]);
  assert.equal(state.intervalReviews.length, 0);
  assert.equal(predict(state).alternative, shiftDay(state.periods.at(-1).start, 46));
});
test('記録不明は前後の開始日を残したまま除外し、区間をつなぎ合わせない', () => {
  const state = fromCycles([28, 63, 30]);
  reviewCycle(state, 1, 'unknown');
  const result = predict(state);
  assert.equal(result.main, shiftDay(state.periods.at(-1).start, 29));
  assert.equal(result.alternative, result.main);
  assert.deepEqual(weightedCycles(state).map(c => c.days), [28, 30]);
  assert.equal(cycleIntervals(state)[1].days, 63);
  assert.equal(state.periods.length, 4);
  assert.equal(gapCandidates(state).length, 0);
});
test('除外した区間しかないときは28日や入力周期で補わない', () => {
  const state = fromCycles([63]);
  reviewCycle(state, 0, 'unknown');
  state.cycleDays = 28;
  assert.equal(predict(state), null);
});
test('単発の長い周期は4分の1の重みで計算し、履歴の実日数は保つ', () => {
  const state = fromCycles([28, 63]);
  reviewCycle(state, 1, 'long');
  const latest = state.periods.at(-1).start;
  assert.equal(predict(state).main, shiftDay(latest, 28));
  assert.equal(predict(state).alternative, shiftDay(latest, 35));
  assert.deepEqual(weightedCycles(state).map(c => c.weight), [1, 0.25]);
  assert.equal(cycleIntervals(state)[1].days, 63);
  assert.equal(gapCandidates(state).length, 0);
});
test('直近3区間で長い周期を2回確認したら最近の長い周期を通常の重みに戻す', () => {
  const state = fromCycles([29, 63, 64]);
  reviewCycle(state, 1, 'long'); reviewCycle(state, 2, 'long');
  const latest = state.periods.at(-1).start;
  assert.equal(predict(state).main, shiftDay(latest, 63));
  assert.equal(predict(state).alternative, shiftDay(latest, 52));
  assert.deepEqual(weightedCycles(state).map(c => c.weight), [1, 1, 1]);
});
test('通常の周期に戻ったら、昔の長い周期は小さい重みに戻す', () => {
  const state = fromCycles([28, 63, 64, 29, 30]);
  reviewCycle(state, 1, 'long'); reviewCycle(state, 2, 'long');
  assert.deepEqual(weightedCycles(state).map(c => c.weight), [1, 0.25, 0.25, 1, 1]);
  assert.equal(predict(state).main, shiftDay(state.periods.at(-1).start, 30));
});
test('だいたいの日付は前後の区間を除外し、正確な日付に直すと計算へ戻る', () => {
  const state = fromCycles([28, 30, 33, 29]);
  state.periods[2].approximate = true;
  assert.deepEqual(weightedCycles(state).map(c => c.days), [28, 29]);
  assert.equal(predict(state).main, shiftDay(state.periods.at(-1).start, 29));
  state.periods[2].approximate = false;
  assert.deepEqual(weightedCycles(state).map(c => c.days), [28, 30, 33, 29]);
});
test('間に日付を追加すると以前の区間の判断は残さず、新しい周期を使う', () => {
  const state = fromCycles([28, 63]);
  reviewCycle(state, 1, 'unknown');
  state.periods.push({ id: 'added', start: shiftDay(state.periods[1].start, 30), end: null });
  assert.deepEqual(activeReviews(state), []);
  assert.deepEqual(weightedCycles(state).map(c => c.days), [28, 30, 33]);
});
test('区間の端の日付変更で古い判断を外し、無関係な区間の判断は保つ', () => {
  const state = fromCycles([28, 63, 30]);
  reviewCycle(state, 0, 'unknown'); reviewCycle(state, 2, 'long');
  state.periods[0].start = shiftDay(state.periods[0].start, -1);
  assert.deepEqual(activeReviews(state).map(r => r.kind), ['long']);
});
test('古い保存形式でも読み取れ、計算は元の記録を書き換えない', () => {
  const state = { periods, cycleDays: 28 };
  const before = JSON.stringify(state);
  predict(state); gapCandidates(state); cycleIntervals(state);
  assert.equal(JSON.stringify(state), before);
});
