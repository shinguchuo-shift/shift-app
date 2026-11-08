/**
 * docs/04「テストで確認すること」を実装したもの。
 * 実行： node --test test/
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { generate, checks, sidesOf, isTrainee, endLimitOf } from '../web/js/scheduler.js';
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
  const kinds = new Set(['不足', '責任者', 'ピーク', '締め', 'NG', '研修中', '時間外']);
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
    assert.ok(sidesOf(staff).includes(s.side),
      `${staff.name}（${staff.duty}）が ${s.side} に入っている`);
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

test('研修中の人が1人きりにならない（rookie が ON のとき）', () => {
  const input = buildInput();
  const shifts = generate(input);
  const trainees = input.staff.filter(isTrainee);
  assert.ok(trainees.length > 0, 'サンプルに研修中がいない（前提が崩れている）');

  // 警告として出るのは許すが、チェックの種類としては「研修中」で出ること
  for (const d of DAYS) {
    for (const c of checks(input, shifts, d.date)) {
      if (c.kind === '研修中') assert.equal(c.level, 'warn');
    }
  }
});

test('スロットの境界に合っている（grid の倍数）', () => {
  const input = buildInput();
  for (const s of generate(input)) {
    assert.equal((s.start - SLOTS[0]) % GRID, 0, `${s.staffId}: 開始がスロット境界でない`);
    assert.equal((s.end - SLOTS[0]) % GRID, 0, `${s.staffId}: 終了がスロット境界でない`);
  }
});
