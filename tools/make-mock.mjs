/**
 * 説明書のスクショ用に、見本データ（web/mock/data.json）を作る。
 *
 * 本番は LINE の認証が通らないと画面が出ないので、手元（localhost）で
 * ?mock=<場面> を付けたときだけ、この見本データで画面を出す（web/js/api.js）。
 * 名前はすべて架空。実データは使わない。
 *
 * 使い方： node tools/make-mock.mjs
 */
import fs from 'node:fs';
import { generate } from '../web/js/scheduler.js';
import * as F from '../test/fixtures.mjs';

const WD = ['月', '火', '水', '木', '金', '土', '日'];
const STORE = 'サンプル店';
const LABELS = {
  leader: '営業中は毎時間、時間帯責任者を1人以上',
  peak3: 'ピーク帯はホール・キッチンそれぞれ一人前以上の人を1人以上',
  close: '閉店時は締め作業ができる人を1人以上',
  ng: 'NG組み合わせは同じ時間に入れない',
  rookie: '研修中・半人前の人は、同じ側に一人前以上がいる時間にだけ入れる'
};

const pad = n => String(n).padStart(2, '0');
const key = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** 期間の日付を並べる（スタッフ画面の形） */
function daysOf(start, end) {
  const out = [];
  const d = new Date(start + 'T00:00:00');
  const last = new Date(end + 'T00:00:00');
  while (d <= last) {
    const dow = (d.getDay() + 6) % 7;
    out.push({ date: key(d), dow, label: `${d.getMonth() + 1}/${d.getDate()}`, wd: WD[dow], weekend: dow >= 5 });
    d.setDate(d.getDate() + 1);
  }
  return out;
}

const staff = F.buildStaff().map((s, i) => ({
  ...s, role: i === 0 ? 'manager' : 'staff', memo: ''
}));
const byId = Object.fromEntries(staff.map(s => [s.id, s]));
const usualAll = F.buildUsual();
const { submissions } = F.buildRequests();
// 見本の繁忙期（週末のピーク帯にホール・キッチン+1）
const busy = [{ name: '週末フェア', start: '2026-11-07', end: '2026-11-08', hall: 1, kitchen: 1,
  ranges: [[660, 840], [1020, 1200]], hours: '11-14,17-20' }];
// 30分刻み。30分始まり・終わりの希望の見本も入れる（佐藤 金曜 9:30〜13:30、斎藤 月曜 18:30〜23:30）
const input = F.buildInput30({ busy }, {
  s01: { '2026-11-06': { start: 570, end: 810 } },
  s19: { '2026-11-02': { start: 1110, end: 1410 } }
});
const requests = input.requests;
const shifts = generate(input).map(s => ({ ...s, source: 'auto' }));
// 手入力の行の見本：11/4 の夜に1人足した
shifts.push({ date: '2026-11-04', staffId: 's19', side: 'hall', start: 1140, end: 1320, source: 'added' });

/* ---------- 店長画面 ---------- */
const mgr = {
  settings: {
    storeName: STORE, grid: 30, openMin: 480, closeMin: 1440,
    axisStart: 480, axisEnd: 1440, lanes: 12, minLen: 180, maxLen: 480,
    weekendPeakBoost: 1, peaks: F.PEAKS,
    footerNote: '※シフト希望は毎週木曜日〆切です。原則雇用時通りの提出を心掛けてください。',
    levelHours: { 1: { min: 180, max: 480 }, 2: { min: 180, max: 480 }, 3: { min: 180, max: 480 } },
    typeEndLimit: F.TYPE_END_LIMIT
  },
  period: { id: '2026-11-02', startDate: '2026-11-02', endDate: '2026-11-08', status: 'closed', revision: 1, monthId: '2026-11' },
  weeks: [
    { id: '2026-11-30', startDate: '2026-11-30', endDate: '2026-12-06', status: 'draft', monthId: '2026-11' },
    { id: '2026-11-23', startDate: '2026-11-23', endDate: '2026-11-29', status: 'draft', monthId: '2026-11' },
    { id: '2026-11-16', startDate: '2026-11-16', endDate: '2026-11-22', status: 'draft', monthId: '2026-11' },
    { id: '2026-11-09', startDate: '2026-11-09', endDate: '2026-11-15', status: 'draft', monthId: '2026-11' },
    { id: '2026-11-02', startDate: '2026-11-02', endDate: '2026-11-08', status: 'closed', monthId: '2026-11' }
  ],
  days: F.DAYS.map(d => ({ date: d.date, dow: d.dow, label: d.label, wd: d.wd, dayType: d.dayType, holiday: d.holiday || '' })),
  slots: input.slots,
  staff,
  requests: { ...requests, s07: Object.fromEntries(F.DAYS.filter(d => usualAll.s07.some(u => u.dow === d.dow))
    .map(d => { const u = usualAll.s07.find(x => x.dow === d.dow); return [d.date, { start: u.start, end: u.end }]; })) },
  // 週を出した人のほか、山本（s07）は週は未提出だが月の希望を出している（月の希望がそのまま使われる）
  submissions: {
    ...Object.fromEntries(Object.entries(submissions).filter(([, v]) => v)
      .map(([k]) => [k, { method: 'usual', at: '2026-10-28', source: 'week' }])),
    s07: { method: 'month', at: '2026-10-25', source: 'month' }
  },
  demand: input.demand,
  busy,
  rules: { leader: true, peak3: true, close: true, ng: true, rookie: true },
  ruleLevels: { leader: 'error', peak3: 'error', close: 'error', ng: 'error', rookie: 'warn' },
  ruleLabels: LABELS,
  shifts,
  notes: { '2026-11-02': 'シェイク分解', '2026-11-07': '棚卸し' }
};

/* ---------- スタッフ画面 ---------- */
function meFor(sid, { monthOpen, monthSubmitted, weekSubmitted }) {
  const s = byId[sid];
  const usual = {};
  usualAll[sid].forEach(u => { usual[u.dow] = { start: u.start, end: u.end }; });

  const mDays = daysOf('2026-11-01', '2026-11-30');
  const mReq = {};
  if (monthSubmitted) mDays.forEach(d => { if (usual[d.dow]) mReq[d.date] = { ...usual[d.dow] }; });

  const wDays = daysOf('2026-11-02', '2026-11-08');
  const fromMonth = {};
  wDays.forEach(d => { if (mReq[d.date]) fromMonth[d.date] = { ...mReq[d.date] }; });

  return {
    me: { id: sid, name: s.name, type: s.type, capMin: s.capMin },
    settings: {
      storeName: STORE, openMin: 480, closeMin: 1440, grid: 30, minLen: 180,
      endLimit: F.TYPE_END_LIMIT[s.type] || 1440
    },
    usual,
    month: {
      id: '2026-11', kind: 'month', startDate: '2026-11-01', endDate: '2026-11-30',
      deadline: '2026-10-31 23:59', status: monthOpen ? 'open' : 'closed',
      days: mDays, requests: mReq, submitted: monthSubmitted, method: monthSubmitted ? 'usual' : null
    },
    week: {
      id: '2026-11-02', kind: 'week', startDate: '2026-11-02', endDate: '2026-11-08',
      deadline: '2026-10-29 23:59', status: 'open',
      days: wDays,
      requests: weekSubmitted ? { ...fromMonth } : {},
      submitted: weekSubmitted, method: weekSubmitted ? 'usual' : null,
      fromMonth: weekSubmitted ? undefined : fromMonth
    }
  };
}

// 週の確認がまだの高校生（「このままで提出」の画面）
const weekScene = meFor('s07', { monthOpen: false, monthSubmitted: true, weekSubmitted: false });

/**
 * 週のプルダウン用：前の週（10/26〜11/1）は確定済み、という見本。
 * 確定シフトは、11/2の週に自動作成した分を1週前にずらして作る（架空）。
 */
const shiftDate = (d, n) => { const x = new Date(d + 'T00:00:00'); x.setDate(x.getDate() + n); return key(x); };
function pastWeekFor(sid) {
  const days = daysOf('2026-10-26', '2026-11-01');
  const confirmed = shifts.filter(x => x.staffId === sid)
    .map(x => ({ date: shiftDate(x.date, -7), start: x.start, end: x.end, side: x.side }))
    .sort((a, b) => a.date < b.date ? -1 : 1);
  const requests = {};
  confirmed.forEach(x => { requests[x.date] = { start: x.start, end: x.end }; });
  // 全員の表（11/2の週の自動作成を1週前にずらした架空のもの）
  const board = shifts.map(x => {
    const s = byId[x.staffId];
    return { date: shiftDate(x.date, -7), start: x.start, end: x.end, side: x.side,
      name: s.name, leader: s.leader, hue: s.colorHue, me: x.staffId === sid };
  }).sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : a.start - b.start);
  return { id: '2026-10-26', kind: 'week', startDate: '2026-10-26', endDate: '2026-11-01',
    deadline: '2026-10-22 23:59', status: 'published', days, requests, submitted: true, method: 'usual', confirmed,
    board, notes: { '2026-10-31': '棚卸し' } };
}
const staffWeeks = [
  { id: '2026-10-26', startDate: '2026-10-26', endDate: '2026-11-01', status: 'published' },
  { id: '2026-11-02', startDate: '2026-11-02', endDate: '2026-11-08', status: 'open' }
];
// 月の暫定がまだの大学生（月の入力・カレンダーの画面）
const monthScene = meFor('s03', { monthOpen: true, monthSubmitted: false, weekSubmitted: false });

const data = {
  // 店長
  mgr: { mgr },
  // スタッフ：週の確認
  week: { me: { ...weekScene, weeks: staffWeeks, latestPublished: staffWeeks[0] }, meWeeks: { '2026-10-26': pastWeekFor('s07') }, mgr },
  // スタッフ：確定済みの週を見ているところ（高橋）
  pub: { me: { ...meFor('s03', { monthOpen: false, monthSubmitted: true, weekSubmitted: true }), week: pastWeekFor('s03'), weeks: staffWeeks }, mgr },
  // スタッフ：月の暫定
  month: { me: monthScene, mgr },
  // スタッフ：はじめて（招待コードの入力）
  link: { me: { error: 'needsLink', message: '招待コードの入力が必要です' }, mgr }
};

fs.mkdirSync('web/mock', { recursive: true });
fs.writeFileSync('web/mock/data.json', JSON.stringify(data));
console.log('書き出した: web/mock/data.json（場面：' + Object.keys(data).join(' / ') + '）');
