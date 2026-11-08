/**
 * デモ（reference/shift-demo.html）と同じサンプルデータを作る。
 * 乱数は seed 固定なので、デモと必ず同じ値になる。
 * ここで作ったデータは Setup.js のサンプル投入にも使う（スタッフ名は架空のまま）。
 */

const H0 = 8, N = 16;            // 営業 8:00〜24:00（16コマ）
export const GRID = 60;
export const OPEN_MIN = H0 * 60;         // 600
export const CLOSE_MIN = (H0 + N) * 60;  // 1440

export const DAYS = [
  { date: '2026-11-02', dow: 0, label: '11/2', wd: '月' },
  { date: '2026-11-03', dow: 1, label: '11/3', wd: '火' },
  { date: '2026-11-04', dow: 2, label: '11/4', wd: '水' },
  { date: '2026-11-05', dow: 3, label: '11/5', wd: '木' },
  { date: '2026-11-06', dow: 4, label: '11/6', wd: '金' },
  { date: '2026-11-07', dow: 5, label: '11/7', wd: '土' },
  { date: '2026-11-08', dow: 6, label: '11/8', wd: '日' }
].map(d => ({ ...d, dayType: d.dow >= 5 ? 'weekend' : 'weekday' }));

export const POSITIONS = [
  { key: 'reg', label: 'レジ', side: 'hall', sort: 1 },
  { key: 'drink', label: 'ドリンク', side: 'hall', sort: 2 },
  { key: 'dt', label: 'DT', side: 'hall', sort: 3 },
  { key: 'fry', label: 'フライヤー', side: 'kitchen', sort: 4 },
  { key: 'build', label: '組立', side: 'kitchen', sort: 5 }
];

// サンプルのスタッフ。名前はすべて架空。
// [名前, 担当業務, 区分, 週の上限(h)]
// 担当業務：hall=ホール / kitchen=キッチン / both=両方 / trainee=研修中
const RAW = [
  ['佐藤',   'hall',    '主婦',   25], ['鈴木', 'kitchen', '社員',   40],
  ['高橋',   'both',    '大学生', 20], ['田中', 'hall',    '高校生', 15],
  ['伊藤',   'both',    '社員',   40], ['渡辺', 'kitchen', '主婦',   25],
  ['山本',   'trainee', '高校生', 15], ['中村', 'hall',    '主婦',   25],
  ['小林',   'kitchen', '大学生', 20], ['加藤', 'both',    '社員',   40],
  ['吉田',   'hall',    '高校生', 15], ['山田', 'kitchen', '社員',   40],
  ['佐々木', 'both',    '主婦',   25], ['山口', 'hall',    '大学生', 20],
  ['松本',   'trainee', '大学生', 20], ['井上', 'both',    '高校生', 15],
  ['木村',   'both',    '社員',   40], ['林',   'kitchen', '主婦',   25],
  ['斎藤',   'both',    '大学生', 20], ['清水', 'hall',    '社員',   40]
];

/** 区分ごとの終了上限。高校生は労働基準法で22時以降は働けない。 */
export const TYPE_END_LIMIT = { '高校生': 22 * 60 };

export const SLOTS = Array.from({ length: N }, (_, i) => OPEN_MIN + i * GRID);

// 8時〜24時の16コマ。開店準備の8〜10時は少なめ
export const BASE_DEMAND = {
  hall:    [1, 1, 2, 3, 3, 3, 2, 2, 2, 3, 3, 3, 2, 2, 1, 1],
  kitchen: [1, 1, 2, 3, 3, 3, 2, 2, 2, 3, 3, 3, 2, 2, 1, 1]
};

export const PEAKS = [[11 * 60, 14 * 60], [17 * 60, 20 * 60]];

/** デモと同じ疑似乱数（mulberry32）。seed が同じなら必ず同じ列が出る。 */
function rng(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

const isWE = d => d >= 5;

/**
 * サンプルの希望。[開始時, 終了時] の配列（時間単位）を返す。
 * 区分ごとに出方を変えてある。高校生は22時を超えない。
 */
function sampleReqHours() {
  const r = rng(42), req = {};
  RAW.forEach((s, id) => {
    const type = s[2];
    req[id] = DAYS.map((_, d) => {
      const x = r(), y = r();
      let v = null;
      if (type === '主婦') {
        v = !isWE(d) && x < .75 ? [9, y < .5 ? 15 : 16] : null;
      } else if (type === '高校生') {
        // 平日は放課後から、土日は昼から。いずれも22時まで
        v = isWE(d) ? (x < .7 ? (y < .5 ? [10, 17] : [14, 22]) : null)
                    : (x < .55 ? [17, 22] : null);
      } else if (type === '大学生') {
        v = isWE(d) ? (x < .75 ? (y < .5 ? [9, 18] : [14, 24]) : null)
                    : (x < .6 ? (y < .5 ? [17, 22] : [18, 24]) : null);
      } else {   // 社員
        const opts = [[8, 16], [14, 24], [9, 17], [16, 24], [10, 19]];
        v = x < .85 ? opts[Math.floor(y * opts.length)] : null;
      }
      // 区分の上限を超えないように切る
      const lim = TYPE_END_LIMIT[type];
      if (v && lim && v[1] > lim / 60) v = [v[0], lim / 60];
      if (v && v[1] - v[0] < 3) v = null;
      return v;
    });
  });
  return req;
}

/** 責任者・締め・NG などの設定。 */
function sampleSkills() {
  const sk = {};
  RAW.forEach((s, id) => {
    const [, duty, type, cap] = s;
    sk[id] = {
      duty: duty,
      // 責任者は社員、締めは社員と大学生（高校生は22時までなので締めに入れない）
      leader: type === '社員',
      closer: (type === '社員' || type === '大学生') && duty !== 'trainee',
      capMin: cap * 60,
      ng: []
    };
  });
  sk[3].ng = ['s11'];   // 田中 × 吉田
  sk[10].ng = ['s04'];
  return sk;
}

export const UNSUBMITTED = [6, 15];   // サンプルで未提出の人

const id = i => 's' + String(i + 1).padStart(2, '0');

/** スタッフ一覧（scheduler の入力形）。 */
export function buildStaff() {
  const sk = sampleSkills();
  return RAW.map((s, i) => ({
    id: id(i),
    name: s[0],
    type: s[2],
    capMin: sk[i].capMin,
    leader: sk[i].leader,
    closer: sk[i].closer,
    duty: sk[i].duty,
    ng: sk[i].ng,
    colorHue: (i * 137) % 360     // デモの hue=sid*137%360 と同じ並び
  }));
}

/** 「いつもの勤務」。デモの usual。 */
export function buildUsual() {
  const req = sampleReqHours();
  const out = {};
  RAW.forEach((_, i) => {
    out[id(i)] = DAYS.map((d, di) => {
      const v = req[i][di];
      return v ? { dow: d.dow, start: v[0] * 60, end: v[1] * 60 } : null;
    }).filter(Boolean);
  });
  return out;
}

/** 提出された希望。デモの fresh() と同じ（未提出2名、今週だけ変えた人2名）。 */
export function buildRequests() {
  const usual = sampleReqHours();
  const requests = {}, submissions = {};

  RAW.forEach((_, i) => {
    const sid = id(i);
    const submitted = !UNSUBMITTED.includes(i);
    submissions[sid] = submitted;
    requests[sid] = {};
    if (!submitted) return;
    DAYS.forEach((d, di) => {
      const v = usual[i][di];
      if (v) requests[sid][d.date] = { start: v[0] * 60, end: v[1] * 60 };
    });
  });

  // デモの「今週だけ変えた人」
  delete requests[id(0)][DAYS[2].date];                                  // 佐藤：水曜を休みに
  requests[id(4)][DAYS[5].date] = { start: 10 * 60, end: 16 * 60 };      // 伊藤：土曜を10-16に

  return { requests, submissions };
}

/** scheduler.generate() / checks() に渡す入力一式。 */
export function buildInput(overrides = {}) {
  const { requests } = buildRequests();
  return {
    days: DAYS,
    slots: SLOTS,
    grid: GRID,
    staff: buildStaff(),
    positions: POSITIONS,
    requests,
    demand: { weekday: BASE_DEMAND, weekend: BASE_DEMAND },
    peaks: PEAKS,
    weekendPeakBoost: 1,
    rules: { leader: true, peak3: true, close: true, ng: true, rookie: true },
    minLen: 180,
    maxLen: 480,
    closeMin: CLOSE_MIN,
    typeEndLimit: TYPE_END_LIMIT,
    ...overrides
  };
}
