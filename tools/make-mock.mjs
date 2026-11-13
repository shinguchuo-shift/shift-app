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
  peak3: 'ピーク帯はホール・キッチンそれぞれ研修中でない人を1人以上',
  close: '閉店時は締め作業ができる人を1人以上',
  ng: 'NG組み合わせは同じ時間に入れない',
  rookie: '研修中の人を1人きりにしない'
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
const { requests, submissions } = F.buildRequests();
const input = F.buildInput();
const shifts = generate(input).map(s => ({ ...s, source: 'auto' }));

/* ---------- 店長画面 ---------- */
const mgr = {
  settings: {
    storeName: STORE, grid: 60, openMin: 480, closeMin: 1440,
    axisStart: 480, axisEnd: 1440, lanes: 12, minLen: 180, maxLen: 480,
    weekendPeakBoost: 1, peaks: F.PEAKS,
    footerNote: '※シフト希望は毎週木曜日〆切です。原則雇用時通りの提出を心掛けてください。',
    typeEndLimit: F.TYPE_END_LIMIT
  },
  period: { id: '2026-11-02', startDate: '2026-11-02', endDate: '2026-11-08', status: 'closed', revision: 1, monthId: '2026-11' },
  weeks: [
    { id: '2026-11-09', startDate: '2026-11-09', endDate: '2026-11-15', status: 'draft', monthId: '2026-11' },
    { id: '2026-11-02', startDate: '2026-11-02', endDate: '2026-11-08', status: 'closed', monthId: '2026-11' }
  ],
  days: F.DAYS.map(d => ({ date: d.date, dow: d.dow, label: d.label, wd: d.wd, dayType: d.dayType })),
  slots: F.SLOTS,
  staff,
  requests,
  submissions: Object.fromEntries(Object.entries(submissions).filter(([, v]) => v)
    .map(([k]) => [k, { method: 'usual', at: '2026-10-28' }])),
  demand: { weekday: F.BASE_DEMAND, weekend: F.BASE_DEMAND },
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
      storeName: STORE, openMin: 480, closeMin: 1440, grid: 60, minLen: 180,
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
// 月の暫定がまだの大学生（月の入力・カレンダーの画面）
const monthScene = meFor('s03', { monthOpen: true, monthSubmitted: false, weekSubmitted: false });

const data = {
  // 店長
  mgr: { mgr },
  // スタッフ：週の確認
  week: { me: weekScene, mgr },
  // スタッフ：月の暫定
  month: { me: monthScene, mgr },
  // スタッフ：はじめて（招待コードの入力）
  link: { me: { error: 'needsLink', message: '招待コードの入力が必要です' }, mgr }
};

fs.mkdirSync('web/mock', { recursive: true });
fs.writeFileSync('web/mock/data.json', JSON.stringify(data));
console.log('書き出した: web/mock/data.json（場面：' + Object.keys(data).join(' / ') + '）');
