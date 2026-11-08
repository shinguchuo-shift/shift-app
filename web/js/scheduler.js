/**
 * 叩き台の自動作成とチェック。
 *
 * DOM にも GAS にも依存しない純粋関数。ブラウザと Node のどちらでも動く。
 * 仕様は docs/04_scheduler-logic.md。正解はデモ reference/shift-demo.html の generate() / checks()。
 *
 * 単位について（docs/04「単位のルール」）：
 *   内部はすべて「スロット番号」で計算する。分では計算しない。
 *   分で len を扱うと -0.6*(len-useful) が巨大なマイナスになり、
 *   全候補が 0 点以下になって誰も配置されなくなる（エラーも出ない）。
 *   分⇔スロットの変換は toInput() / fromOutput() の境界だけでやる。
 */

/** スコアの係数。大きくすると何が起きるかをコメントで添える。 */
export const WEIGHTS = {
  hit: 1,        // 人手不足の解消をどれだけ重視するか。上げると「とにかく頭数」になる
  leader: 1.2,   // 責任者の穴埋め。上げると責任者が優先的に長時間入る
  peak3: 0.8,    // ピーク帯のレベル3。上げるとベテランがピークに寄る
  close: 1.5,    // 締め要員。上げると closer が閉店まで入りやすくなる
  waste: 0.6,    // 役に立たない時間への罰。上げると勤務が短く刻まれる
  rookie: 0.4,   // 教育中を1人にする罰。上げると新人がベテランに張り付く
  usedDiv: 200   // week の偏り調整。小さくすると「よく働く人」を避けるようになる
};

/* ---------- 補助 ---------- */

/**
 * 担当業務から、入れる側を返す。
 *   ホール → hall ／ キッチン → kitchen ／ 両方・研修中 → 両方
 * 研修中はどちらにも入れるが、1人にはしない（下の rookie ルール）。
 */
export function sidesOf(staff) {
  if (staff.duty === 'hall') return ['hall'];
  if (staff.duty === 'kitchen') return ['kitchen'];
  return ['hall', 'kitchen'];
}

/** 研修中か。 */
export const isTrainee = staff => staff.duty === 'trainee';

/**
 * その人を入れてよい終了時刻の上限（分）。
 * 高校生は労働基準法により22時以降は働けないので、ここで止める。
 * 上限は入力（typeEndLimit）で渡す。店の都合でも足せるようにしてある。
 */
export function endLimitOf(staff, input) {
  const lim = (input.typeEndLimit || {})[staff.type];
  return lim === undefined ? input.closeMin : Math.min(lim, input.closeMin);
}

/** 組ませない相手かどうか。片方向だけ入っていても NG とみなす。 */
function isNG(a, b) {
  return (a.ng || []).includes(b.id) || (b.ng || []).includes(a.id);
}

/** slot がピーク帯に入っているか。peaks は分で持つ。 */
function inPeak(peaks, min) {
  return peaks.some(([a, b]) => min >= a && min < b);
}

/**
 * その日・その side・その slot に必要な人数。
 * 土日かつピーク内なら weekendPeakBoost を足す。
 */
function need(input, day, side, i) {
  const base = input.demand[day.dayType][side][i] || 0;
  const isWeekend = day.dayType === 'weekend';
  const boost = (isWeekend && inPeak(input.peaks, input.slots[i])) ? input.weekendPeakBoost : 0;
  return base + boost;
}

/** 分を HH:MM にする。 */
const hhmm_ = m => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** 連続する true を「10〜12時」のような文字列にまとめる。 */
function ranges(flags, slots, grid) {
  const out = [];
  let st = -1;
  for (let i = 0; i <= flags.length; i++) {
    if (i < flags.length && flags[i]) {
      if (st < 0) st = i;
    } else if (st >= 0) {
      const from = Math.floor(slots[st] / 60);
      const to = Math.floor((slots[i - 1] + grid) / 60);
      out.push(`${from}〜${to}時`);
      st = -1;
    }
  }
  return out.join('、');
}

/* ---------- 自動作成 ---------- */

/**
 * 叩き台を作る（貪欲法）。
 * @returns {Array<{date,staffId,side,start,end}>} start/end は分
 */
export function generate(input) {
  const { staff, days, slots, grid } = input;
  const rules = input.rules;
  const nSlots = slots.length;

  // 1スロットあたりの分。長さの計算はすべてスロット数で行う
  const minLen = Math.max(1, Math.round(input.minLen / grid));
  const maxLen = Math.max(minLen, Math.round(input.maxLen / grid));

  const used = {};            // 週の使用スロット数
  staff.forEach(s => { used[s.id] = 0; });
  const out = [];

  // 忙しい日から埋める（土→日→金→月→火→水→木）。上限時間を先に使い切らせる
  const order = [5, 6, 4, 0, 1, 2, 3];

  for (const di of order) {
    const day = days[di];
    const placed = [];                                   // この日の配置
    const cover = { hall: new Array(nSlots).fill(0), kitchen: new Array(nSlots).fill(0) };
    const lead = new Array(nSlots).fill(0);
    const v3 = { hall: new Array(nSlots).fill(0), kitchen: new Array(nSlots).fill(0) };
    const done = new Set();                              // 1日1人1回まで
    let closerCount = 0;

    for (;;) {
      let best = null;

      for (const s of staff) {
        if (done.has(s.id)) continue;
        const req = input.requests[s.id] && input.requests[s.id][day.date];
        if (!req) continue;

        // 週の上限の残り（スロット数）
        const capSlots = Math.floor(s.capMin / grid);
        const rem = capSlots - used[s.id];
        if (rem < minLen) continue;

        const a0 = slots.indexOf(req.start);
        const a1 = slots.indexOf(req.end);
        // 希望の終わりが営業終了と同じなら slots に無いので末尾扱いにする
        let reqEnd = a1 >= 0 ? a1 : nSlots;
        if (a0 < 0) continue;

        // 高校生は22時まで。区分ごとの上限を超える候補は作らない
        const limit = endLimitOf(s, input);
        if (limit < input.closeMin) {
          const li = slots.indexOf(limit);
          reqEnd = Math.min(reqEnd, li >= 0 ? li : nSlots);
        }

        const trainee = isTrainee(s);
        for (const side of sidesOf(s)) {

          for (let a = a0; a + minLen <= reqEnd; a++) {
            const maxHere = Math.min(maxLen, reqEnd - a, rem);
            for (let len = minLen; len <= maxHere; len++) {
              const e = a + len;

              // NG相手と時間が重なる候補は捨てる
              if (rules.ng && placed.some(p =>
                isNG(p.staff, s) && p.a < e && a < p.e)) continue;

              let hit = 0, lh = 0, ph = 0, alone = 0, useful = 0;
              for (let i = a; i < e; i++) {
                let u = false;
                const nd = need(input, day, side, i);
                if (cover[side][i] < nd) { hit++; u = true; }
                // need>0 の時間に限る（デモには無い条件。docs/04 参照）
                if (rules.leader && s.leader && lead[i] === 0 && nd > 0) { lh++; u = true; }
                // ピーク帯に「研修中でない人」を置きたい
                if (rules.peak3 && !trainee && inPeak(input.peaks, slots[i]) && v3[side][i] === 0 && nd > 0) { ph++; u = true; }
                // 研修中を1人にしない
                if (rules.rookie && trainee && v3[side][i] === 0) alone++;
                if (u) useful++;
              }
              let ch = 0;
              const endMin = a + len < nSlots ? slots[a + len] : slots[nSlots - 1] + grid;
              if (rules.close && s.closer && endMin === input.closeMin && closerCount === 0) ch = 1;

              if (!useful) continue;

              const score = WEIGHTS.hit * hit
                + WEIGHTS.leader * lh
                + WEIGHTS.peak3 * ph
                + WEIGHTS.close * ch
                - WEIGHTS.waste * (len - useful)
                - WEIGHTS.rookie * alone
                - (used[s.id] * grid / 60) / WEIGHTS.usedDiv;

              if (!best || score > best.score) best = { score, staff: s, side, a, e, trainee };
            }
          }
        }
      }

      if (!best || best.score <= 0) break;

      placed.push(best);
      done.add(best.staff.id);
      used[best.staff.id] += best.e - best.a;
      for (let i = best.a; i < best.e; i++) {
        cover[best.side][i]++;
        if (best.staff.leader) lead[i]++;
        if (!best.trainee) v3[best.side][i]++;   // 研修中でない人の数
      }
      const endMin = best.e < nSlots ? slots[best.e] : slots[nSlots - 1] + grid;
      if (best.staff.closer && endMin === input.closeMin) closerCount++;

      out.push({
        date: day.date,
        staffId: best.staff.id,
        side: best.side,
        start: slots[best.a],
        end: endMin
      });
    }
  }

  return out;
}

/* ---------- チェック ---------- */

/**
 * 1日分のチェック。
 * @returns {Array<{kind,level,message}>}
 */
export function checks(input, shifts, date) {
  const { staff, slots, grid, rules } = input;
  const day = input.days.find(d => d.date === date);
  const nSlots = slots.length;
  const byId = Object.fromEntries(staff.map(s => [s.id, s]));
  const list = shifts.filter(x => x.date === date)
    .map(x => ({ ...x, staff: byId[x.staffId] }));
  const out = [];

  // その slot に入っている人
  const at = i => list.filter(x => x.start <= slots[i] && slots[i] < x.end);

  // 不足
  let short = 0;
  for (const side of ['hall', 'kitchen']) {
    for (let i = 0; i < nSlots; i++) {
      const c = at(i).filter(x => x.side === side).length;
      short += Math.max(0, need(input, day, side, i) - c);
    }
  }
  if (short) {
    // 表示は「人×h」。スロット数そのままではなく grid で時間に直す
    const hours = short * grid / 60;
    out.push({ kind: '不足', level: lv('不足'), message: `人手が足りない時間 合計${hours}人×h` });
  }

  // 責任者
  if (rules.leader) {
    const f = Array.from({ length: nSlots }, (_, i) =>
      need(input, day, 'hall', i) + need(input, day, 'kitchen', i) > 0 &&
      !at(i).some(x => x.staff.leader));
    const t = ranges(f, slots, grid);
    if (t) out.push({ kind: '責任者', level: lv('責任者'), message: `責任者がいない：${t}` });
  }

  // ピーク帯のレベル3
  if (rules.peak3) {
    for (const side of ['hall', 'kitchen']) {
      const f = Array.from({ length: nSlots }, (_, i) =>
        inPeak(input.peaks, slots[i]) && need(input, day, side, i) > 0 &&
        !at(i).some(x => x.side === side && !isTrainee(x.staff)));
      const t = ranges(f, slots, grid);
      if (t) {
        const label = side === 'hall' ? 'ホール' : 'キッチン';
        out.push({ kind: 'ピーク', level: lv('ピーク'), message: `${label}に研修中でない人がいない：${t}` });
      }
    }
  }

  // 締め
  if (rules.close && !list.some(x => x.end === input.closeMin && x.staff.closer)) {
    out.push({ kind: '締め', level: lv('締め'), message: '閉店時に締め作業ができる人がいない' });
  }

  // 区分の時間制限（高校生は22時まで）
  list.forEach(x => {
    const limit = endLimitOf(x.staff, input);
    if (x.end > limit) {
      out.push({
        kind: '時間外', level: 'error',
        message: `${x.staff.name}さん（${x.staff.type}）は${hhmm_(limit)}までです：${hhmm_(x.start)}〜${hhmm_(x.end)}`
      });
    }
  });

  // NG
  if (rules.ng) {
    list.forEach((a, i) => list.slice(i + 1).forEach(b => {
      if (isNG(a.staff, b.staff) && a.start < b.end && b.start < a.end) {
        out.push({ kind: 'NG', level: lv('NG'), message: `${a.staff.name}さんと${b.staff.name}さんが同じ時間` });
      }
    }));
  }

  // 教育中
  if (rules.rookie) {
    list.forEach(x => {
      if (!isTrainee(x.staff)) return;
      const f = Array.from({ length: nSlots }, (_, i) =>
        slots[i] >= x.start && slots[i] < x.end &&
        !at(i).some(y => y.side === x.side && !isTrainee(y.staff)));
      const t = ranges(f, slots, grid);
      if (t) out.push({ kind: '研修中', level: lv('研修中'), message: `${x.staff.name}さんが1人になる時間：${t}` });
    });
  }

  return out;

  // level は Rules シートの level 列から読む。無ければ既定値
  function lv(kind) {
    const key = { '不足': null, '責任者': 'leader', 'ピーク': 'peak3', '締め': 'close', 'NG': 'ng', '研修中': 'rookie', '時間外': null }[kind];
    if (!key) return 'error';
    return (input.ruleLevels && input.ruleLevels[key]) || (key === 'rookie' ? 'warn' : 'error');
  }
}

/** 全日分のチェックをまとめて返す。 */
export function checksAll(input, shifts) {
  return input.days.map(d => ({ date: d.date, items: checks(input, shifts, d.date) }));
}
