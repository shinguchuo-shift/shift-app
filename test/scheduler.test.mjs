/**
 * docs/04「テストで確認すること」を実装したもの。
 * 実行： node --test test/
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { generate, checks, sidesOf, isTrainee, endLimitOf, levelOf, needAt, needsHelp, isCapable, dayLenOf } from '../web/js/scheduler.js';
import { buildInput, DAYS, SLOTS, GRID, CLOSE_MIN, TYPE_END_LIMIT } from './fixtures.mjs';

const byId = (input, id) => input.staff.find(s => s.id === id);

test('サンプルデータで、誰かが必ず配置される', () => {
  const input = buildInput();
  const shifts = generate(input);
  // 単位を取り違えると全候補がマイナス点になり、静かに0件になる。その保険
  assert.ok(shifts.length > 0, '1件も配置されていない（スコアの単位を疑うこと）');
  assert.ok(shifts.length > 50, `配置が少なすぎる: ${shifts.length}件`);
});

test('同じ入力なら毎回同じ結果になる', () => {
  const a = generate(buildInput());
  const b = generate(buildInput());
  assert.deepEqual(a, b);
});

test('誰も週の上限を超えない', () => {
  const input = buildInput();
  const used = {};
  for (const s of generate(input)) {
    used[s.staffId] = (used[s.staffId] || 0) + (s.end - s.start);
  }
  for (const [id, min] of Object.entries(used)) {
    assert.ok(min <= byId(input, id).capMin,
      `${id} が上限超過: ${min}分 > ${byId(input, id).capMin}分`);
  }
});

test('希望時間の外には入らない', () => {
  const input = buildInput();
  for (const s of generate(input)) {
    const req = input.requests[s.staffId][s.date];
    assert.ok(req, `${s.staffId} は ${s.date} に希望を出していない`);
    assert.ok(s.start >= req.start && s.end <= req.end,
      `${s.staffId} ${s.date}: ${s.start}-${s.end} が希望 ${req.start}-${req.end} の外`);
  }
});

test('1日1人1回まで', () => {
  const seen = new Set();
  for (const s of generate(buildInput())) {
    const key = s.date + '/' + s.staffId;
    assert.ok(!seen.has(key), `${key} が重複している`);
    seen.add(key);
  }
});

test('勤務の長さが min〜max に収まる', () => {
  const input = buildInput();
  for (const s of generate(input)) {
    const len = s.end - s.start;
    assert.ok(len >= input.minLen, `${s.staffId} ${s.date}: ${len}分 < 最短${input.minLen}分`);
    assert.ok(len <= input.maxLen, `${s.staffId} ${s.date}: ${len}分 > 最長${input.maxLen}分`);
  }
});

test('営業時間の外には出ない', () => {
  const input = buildInput();
  for (const s of generate(input)) {
    assert.ok(s.start >= SLOTS[0], `${s.staffId}: 開始が営業前`);
    assert.ok(s.end <= CLOSE_MIN, `${s.staffId}: 終了が営業後`);
  }
});

test('rules.ng が ON なら NG 同士が重ならない', () => {
  const input = buildInput();
  const shifts = generate(input);
  const pairs = input.staff.flatMap(a => (a.ng || []).map(b => [a.id, b]));
  assert.ok(pairs.length > 0, 'サンプルに NG の組が無い（前提が崩れている）');

  for (const [a, b] of pairs) {
    for (const d of DAYS) {
      const x = shifts.find(s => s.date === d.date && s.staffId === a);
      const y = shifts.find(s => s.date === d.date && s.staffId === b);
      if (x && y) {
        assert.ok(x.end <= y.start || y.end <= x.start,
          `${d.date}: ${a} と ${b} が重なっている`);
      }
    }
  }
});

test('必要人数を全部 0 にしたら誰も入らない', () => {
  const zero = SLOTS.map(() => 0);
  const input = buildInput({
    demand: { weekday: { hall: zero, kitchen: zero }, weekend: { hall: zero, kitchen: zero } },
    weekendPeakBoost: 0,
    rules: { leader: false, peak3: false, close: false, ng: true, rookie: false }
  });
  assert.equal(generate(input).length, 0);
});

test('ルールを全部 OFF にしたら、不足以外のチェックが出ない', () => {
  const input = buildInput({
    rules: { leader: false, peak3: false, close: false, ng: false, rookie: false }
  });
  const shifts = generate(input);
  for (const d of DAYS) {
    for (const c of checks(input, shifts, d.date)) {
      assert.equal(c.kind, '不足', `${d.date} に「${c.kind}」が出ている`);
    }
  }
});

test('チェックが日ごとに返り、既知の種類だけを含む', () => {
  const input = buildInput();
  const shifts = generate(input);
  const kinds = new Set(['不足', '責任者', 'ピーク', '締め', 'NG', '研修中', '時間外', '担当外', '勤務時間']);
  for (const d of DAYS) {
    for (const c of checks(input, shifts, d.date)) {
      assert.ok(kinds.has(c.kind), `知らない種類: ${c.kind}`);
      assert.ok(['error', 'warn'].includes(c.level), `level が変: ${c.level}`);
      assert.ok(c.message.length > 0);
    }
  }
});

test('研修中のチェックは warn、他は error', () => {
  const input = buildInput();
  const shifts = generate(input);
  for (const d of DAYS) {
    for (const c of checks(input, shifts, d.date)) {
      assert.equal(c.level, c.kind === '研修中' ? 'warn' : 'error');
    }
  }
});

test('自動作成した結果に「時間外」のチェックは出ない', () => {
  const input = buildInput();
  const shifts = generate(input);
  for (const d of DAYS) {
    for (const c of checks(input, shifts, d.date)) {
      assert.notEqual(c.kind, '時間外', `${d.date}: ${c.message}`);
    }
  }
});

test('担当業務どおりの side にしか入らない', () => {
  const input = buildInput();
  for (const s of generate(input)) {
    const staff = byId(input, s.staffId);
    assert.ok(sidesOf(staff).includes(s.side), `${staff.name}（${staff.duty}）が ${s.side} に入っている`);
  }
});

test('高校生は22時を超えて入らない', () => {
  const input = buildInput();
  const limit = TYPE_END_LIMIT['高校生'];
  const hs = input.staff.filter(s => s.type === '高校生');
  assert.ok(hs.length > 0, 'サンプルに高校生がいない（前提が崩れている）');

  for (const s of generate(input)) {
    const staff = byId(input, s.staffId);
    if (staff.type !== '高校生') continue;
    assert.ok(s.end <= limit,
      `${staff.name}（高校生）が ${s.end / 60}時まで入っている（上限 ${limit / 60}時）`);
  }
});

test('endLimitOf() が区分ごとの上限を返す', () => {
  const input = buildInput();
  for (const s of input.staff) {
    const want = s.type === '高校生' ? TYPE_END_LIMIT['高校生'] : input.closeMin;
    assert.equal(endLimitOf(s, input), want, `${s.name} の上限が合わない`);
  }
});

test('研修中・半人前は、同じ側に一人前以上がいる時間にしか入らない（rookie が ON のとき）', () => {
  const input = buildInput();
  const shifts = generate(input);
  assert.ok(input.staff.some(s => isTrainee(s)), 'サンプルに研修中がいない（前提が崩れている）');
  assert.ok(input.staff.some(s => !isTrainee(s) && levelOf(s) === 1), 'サンプルに半人前がいない（前提が崩れている）');

  for (const x of shifts) {
    const staff = byId(input, x.staffId);
    if (!needsHelp(staff)) continue;
    for (let m = x.start; m < x.end; m += GRID) {
      const ok = shifts.some(y => y !== x && y.date === x.date && y.side === x.side
        && y.start <= m && m < y.end && isCapable(byId(input, y.staffId)));
      assert.ok(ok, `${staff.name} が ${x.date} ${m / 60}時に1人`);
    }
  }
  for (const d of DAYS) {
    for (const c of checks(input, shifts, d.date)) assert.notEqual(c.kind, '研修中', c.message);
  }
});

test('担当業務の外の側に手で入れるとチェックで出る', () => {
  const input = buildInput();
  const shifts = [{ date: DAYS[0].date, staffId: 's01', side: 'kitchen', start: 600, end: 900 }];   // 佐藤：ホールだけ
  assert.ok(checks(input, shifts, DAYS[0].date).some(c => c.kind === '担当外'));
});

test('1日の勤務時間：人ごとの設定どおりの長さで入る', () => {
  const input = buildInput();
  // 全員を「ちょうど4時間」にする
  input.staff = input.staff.map(s => ({ ...s, dayMin: 240, dayMax: 240 }));
  const shifts = generate(input);
  assert.ok(shifts.length > 0);
  for (const x of shifts) assert.equal(x.end - x.start, 240, `${x.staffId} ${x.date} が ${(x.end - x.start) / 60}時間`);
});

test('1日の勤務時間：設定が無ければ全体の min〜max', () => {
  const input = buildInput();
  const d = dayLenOf(input.staff[0], input);
  assert.deepEqual(d, { min: input.minLen, max: input.maxLen });
});

test('1日の勤務時間から外れると「勤務時間」の注意が出る', () => {
  const input = buildInput();
  input.staff = input.staff.map(s => s.id === 's02' ? { ...s, dayMin: 300, dayMax: 360 } : s);
  const shifts = [{ date: DAYS[0].date, staffId: 's02', side: 'kitchen', start: 540, end: 1020 }];   // 8時間
  const c = checks(input, shifts, DAYS[0].date).find(x => x.kind === '勤務時間');
  assert.ok(c && c.level === 'warn');
});

test('祝日は祝日の表を使う（土日と同じくピーク加算も付く）', () => {
  const holidayTable = { hall: SLOTS.map(() => 5), kitchen: SLOTS.map(() => 5) };
  const input = buildInput();
  input.demand = { ...input.demand, holiday: holidayTable };
  const hol = DAYS.find(d => d.dayType === 'holiday');
  const wd = DAYS.find(d => d.dayType === 'weekday');
  const peakI = SLOTS.indexOf(12 * 60), offI = SLOTS.indexOf(9 * 60);
  assert.equal(needAt(input, hol, 'hall', offI), 5);
  assert.equal(needAt(input, hol, 'hall', peakI), 5 + input.weekendPeakBoost);
  assert.equal(needAt(input, wd, 'hall', peakI), input.demand.weekday.hall[peakI]);
});

test('祝日の表が無ければ土日の表を使う', () => {
  const input = buildInput();
  const { holiday, ...rest } = input.demand;
  input.demand = rest;
  const hol = DAYS.find(d => d.dayType === 'holiday');
  assert.equal(needAt(input, hol, 'hall', 0), input.demand.weekend.hall[0]);
});

test('繁忙期は期間と時間帯の中だけ人数を足す', () => {
  const input = buildInput({
    busy: [{ name: 'テスト', start: '2026-11-05', end: '2026-11-06', hall: 2, kitchen: 1, ranges: [[11 * 60, 14 * 60]] }]
  });
  const thu = DAYS[3], fri = DAYS[4], wed = DAYS[2];
  const i12 = SLOTS.indexOf(12 * 60), i15 = SLOTS.indexOf(15 * 60);
  const base = buildInput();
  assert.equal(needAt(input, thu, 'hall', i12), needAt(base, thu, 'hall', i12) + 2);
  assert.equal(needAt(input, fri, 'kitchen', i12), needAt(base, fri, 'kitchen', i12) + 1);
  assert.equal(needAt(input, thu, 'hall', i15), needAt(base, thu, 'hall', i15));   // 時間帯の外
  assert.equal(needAt(input, wed, 'hall', i12), needAt(base, wed, 'hall', i12));   // 期間の外
});

test('繁忙期の時間帯を空にすると一日中足す', () => {
  const input = buildInput({ busy: [{ start: '2026-11-02', end: '2026-11-02', hall: 1, kitchen: 0, ranges: [] }] });
  const base = buildInput();
  for (let i = 0; i < SLOTS.length; i++) {
    assert.equal(needAt(input, DAYS[0], 'hall', i), needAt(base, DAYS[0], 'hall', i) + 1);
  }
});

test('スロットの境界に合っている（grid の倍数）', () => {
  const input = buildInput();
  for (const s of generate(input)) {
    assert.equal((s.start - SLOTS[0]) % GRID, 0, `${s.staffId}: 開始がスロット境界でない`);
    assert.equal((s.end - SLOTS[0]) % GRID, 0, `${s.staffId}: 終了がスロット境界でない`);
  }
});
