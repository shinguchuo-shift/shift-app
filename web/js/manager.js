/**
 * 店長画面。
 * タブ：提出状況／シフト表／自動作成／スキル。
 * データは mgr.load で一度に取り、自動作成はこのブラウザで動かす（GAS の時間を使わない）。
 */

import { call, callRetry, ApiError } from './api.js?v=3';
import * as liffAuth from './liff-auth.js?v=1';
import { generate, checksAll, sidesOf, isTrainee, endLimitOf } from './scheduler.js?v=3';

const $ = id => document.getElementById(id);

/** シートの値を画面に出す前に必ず通す。名前・備考・メモは店長が自由に書ける。 */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const hm = m => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const hourLabel = m => { const h = Math.floor(m / 60) % 24; return h === 0 ? 24 : h; };
const SIDE = { hall: 'ホール', kitchen: 'キッチン' };

let D = null;          // mgr.load の結果
let shifts = [];       // 画面上のシフト
let stale = false;     // 希望やルールが変わって作り直しが要る状態
let dirty = false;     // 手直ししたが、まだ保存していない
let showAll = false;   // 追加するとき、希望を出していない人も出す
let tab = 'sub';

/* ---------- 起動 ---------- */

init();

async function init() {
  try {
    await liffAuth.start('manager');
  } catch (err) {
    $('state').className = 'state err';
    $('state').textContent = 'LINEとの連携に失敗しました：' + err.message;
    return;
  }

  // GAS は往復だけで1.5秒、シートを読むと5秒前後かかる。
  // 何も変わらないと「固まった」と思われるので、経過を出し続ける。
  const t0 = Date.now();
  const paint = () => {
    const el = $('state');
    if (!el) return false;
    const sec = Math.round((Date.now() - t0) / 1000);
    el.innerHTML = 'スプレッドシートを読んでいます…'
      + '<br><span style="font-size:12px;color:var(--sub)">'
      + (sec ? `${sec}秒経過` : '5秒ほどかかります')
      + (sec >= 8 ? '（初回は時間がかかります）' : '') + '</span>';
    return true;
  };
  paint();   // タイマーが絞られる環境でも、最初の1回は必ず出す
  const tick = setInterval(() => { if (!paint()) clearInterval(tick); }, 400);

  try {
    D = await call('mgr.load', {}, auth());
    shifts = D.shifts.slice();
    $('title').textContent = `${D.settings.storeName} シフト作成`;
    renderHeader();
    $('tabs').classList.remove('hidden');
    document.querySelectorAll('.tab').forEach(b => b.onclick = () => show(b.dataset.tab));
    show('sub');
  } catch (err) {
    const el = $('state');
    if (!el) return;
    el.className = 'state err';

    // 権限まわりは原因が分かるように出し分ける
    const guide = {
      needsLink: ['この画面を使う準備ができていません',
        'スタッフ画面で招待コードを入れて、LINEアカウントを結びつけてください。'],
      forbidden: ['権限がありません',
        'この画面は店長だけが使えます。スタッフ一覧の「権限」が「店長」になっているか確認してください。'],
      noToken: ['LINEからログインしてください',
        'LINEのトークに貼ったリンクから開いてください。']
    }[err.code];

    el.innerHTML = guide
      ? `<b>${esc(guide[0])}</b><br><span style="color:var(--sub)">${esc(guide[1])}</span>`
      : `<b>読み込めませんでした</b><br><span style="color:var(--sub)">${esc(err.message)}</span>`
        + `<div class="acts" style="justify-content:center;margin-top:14px">`
        + `<button class="btn ghost" id="retry">もう一度試す</button></div>`;
    if ($('retry')) $('retry').onclick = () => location.reload();
  } finally {
    clearInterval(tick);
  }
}

/** 見出し。対象週の切り替えもここに出す。 */
function renderHeader() {
  const opts = (D.weeks || []).map(w =>
    `<option value="${w.id}"${w.id === D.period.id ? ' selected' : ''}>`
    + `${fmt(w.startDate)}〜${fmt(w.endDate)}（${statusLabel(w.status)}）</option>`).join('');

  $('sub').innerHTML =
    `<label class="wk-pick">対象週 <select id="weekSel">${opts}</select></label>`
    + ` <span class="small">スタッフ${D.staff.length}名</span>`;

  $('weekSel').onchange = e => switchWeek(e.target.value);
}

const fmt = d => { const a = String(d).split('-'); return `${+a[1]}/${+a[2]}`; };

/** 別の週に切り替える。手直しが未保存なら止める。 */
async function switchWeek(id) {
  if (id === D.period.id) return;
  if (dirty && !confirmLeave()) { $('weekSel').value = D.period.id; return; }
  const keep = tab;
  $('body').innerHTML = '<div class="state">切り替えています…</div>';
  try {
    D = await call('mgr.load', { periodId: id }, auth());
    shifts = D.shifts.slice();
    dirty = false; stale = false;
    renderHeader();
    show(keep);
  } catch (err) {
    $('body').innerHTML = `<div class="state err">切り替えられませんでした：${esc(err.message)}</div>`;
  }
}

function confirmLeave() {
  toast('保存していない手直しがあります。もう一度選ぶと捨てて切り替えます');
  if (confirmLeave.armed) { confirmLeave.armed = false; return true; }
  confirmLeave.armed = true;
  setTimeout(() => { confirmLeave.armed = false; }, 6000);
  return false;
}

function fmtRange() {
  const a = D.days[0], b = D.days[6];
  return `${a.label}（${a.wd}）〜${b.label}（${b.wd}）`;
}
const statusLabel = s =>
  ({ draft: '準備中', open: '受付中', closed: '〆切後', published: '確定・配信済み' }[s] || s);

function show(t) {
  tab = t;
  document.querySelectorAll('.tab').forEach(b =>
    b.setAttribute('aria-selected', String(b.dataset.tab === t)));
  ({ sub: renderSub, sheet: renderSheet, auto: renderAuto, skill: renderSkill }[t])();
  window.scrollTo({ top: 0 });
}

function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2200);
}

/* ---------- 入力をつくる ---------- */

/** scheduler に渡す形に整える。 */
function schedulerInput() {
  return {
    days: D.days, slots: D.slots, grid: D.settings.grid,
    staff: D.staff, requests: D.requests,
    demand: D.demand, peaks: D.settings.peaks,
    weekendPeakBoost: D.settings.weekendPeakBoost,
    rules: D.rules, ruleLevels: D.ruleLevels,
    minLen: D.settings.minLen, maxLen: D.settings.maxLen,
    closeMin: D.settings.closeMin,
    typeEndLimit: D.settings.typeEndLimit || {}
  };
}

const staffById = id => D.staff.find(s => s.id === id);

/** API に添える認証情報。LIFF を使っていなければ null が入るだけ。 */
const auth = () => ({ idToken: liffAuth.getIdToken() });

/** その人が、その日に出られると言っている時間。無ければ null。 */
const requestOf = (staffId, date) => (D.requests[staffId] || {})[date] || null;

/** 希望の外に入っているか（店長が意図して入れた分と、事故を見分けるため）。 */
function isOutOfRequest(s) {
  const r = requestOf(s.staffId, s.date);
  return !r || s.start < r.start || s.end > r.end;
}

/** 担当業務の表示名。 */
const DUTY = { hall: 'ホール', kitchen: 'キッチン', both: '両方', trainee: '研修中' };

/** その日・その side・その slot の必要人数。 */
function need(day, side, i) {
  const base = D.demand[day.dayType][side][i] || 0;
  const peak = D.settings.peaks.some(([a, b]) => D.slots[i] >= a && D.slots[i] < b);
  return base + (day.dayType === 'weekend' && peak ? D.settings.weekendPeakBoost : 0);
}

/** その日の不足（人×コマ）と必要総数。 */
function dayShort(day) {
  let short = 0, total = 0;
  for (const side of ['hall', 'kitchen']) {
    for (let i = 0; i < D.slots.length; i++) {
      const n = need(day, side, i);
      total += n;
      const c = shifts.filter(x => x.date === day.date && x.side === side
        && x.start <= D.slots[i] && D.slots[i] < x.end).length;
      short += Math.max(0, n - c);
    }
  }
  return { short, total };
}

/* ---------- ① 提出状況 ---------- */

function renderSub() {
  const submitted = D.staff.filter(s => D.submissions[s.id]);
  const missing = D.staff.filter(s => !D.submissions[s.id]);
  const pct = Math.round(submitted.length / D.staff.length * 100);

  $('body').innerHTML = `
    <div class="card">
      <h2>提出状況</h2>
      <p class="lead">〆切までに希望を出した人。未提出の人にだけリマインドを送ります。</p>
      <div class="kpis">
        <div class="kpi"><span>提出済み</span><b>${submitted.length} / ${D.staff.length}</b></div>
        <div class="kpi"><span>未提出</span><b>${missing.length}</b></div>
        <div class="kpi"><span>いつも通り</span><b>${
          submitted.filter(s => D.submissions[s.id].method === 'usual').length}</b></div>
      </div>
      <div class="bar"><i style="width:${pct}%"></i></div>
    </div>

    <div class="card">
      <h2>未提出の人</h2>
      <p class="lead">${missing.length ? '声をかける、またはリマインドを送ってください。' : '全員から届いています。'}</p>
      <div class="people">${
        missing.length
          ? missing.map(s => `<span class="chip no">${esc(s.name)}</span>`).join('')
          : '<p class="okline">全員提出済みです。</p>'}</div>
    </div>

    <div class="card">
      <h2>出された希望</h2>
      <p class="lead">誰が、どの日の何時から何時まで出られるか。「いつも通り」と違う人には印を付けています。</p>
      <div class="sheet">${requestTable()}</div>
    </div>`;
}

/**
 * 希望の一覧。行＝スタッフ、列＝曜日。
 * 店長が「この日は誰が出られるんやったっけ」を一目で見るための表。
 */
function requestTable() {
  // 出られる日が多い人を上に。未提出は最後にまとめる
  const order = D.staff.slice().sort((a, b) => {
    const sa = D.submissions[a.id] ? 1 : 0, sb = D.submissions[b.id] ? 1 : 0;
    if (sa !== sb) return sb - sa;
    return Object.keys(D.requests[b.id] || {}).length - Object.keys(D.requests[a.id] || {}).length;
  });

  const head = '<tr><th class="who">名前</th>'
    + D.days.map(d => {
      const cls = d.dow === 5 ? 'sat' : d.dow === 6 ? 'sun' : '';
      return `<th class="${cls}">${d.label}<br><small>${d.wd}</small></th>`;
    }).join('')
    + '<th class="tot">合計</th></tr>';

  const rows = order.map(s => {
    const sub = D.submissions[s.id];
    const req = D.requests[s.id] || {};

    if (!sub) {
      return `<tr class="unsub"><td class="who">${esc(s.name)}</td>`
        + `<td colspan="${D.days.length}">未提出</td><td class="tot">−</td></tr>`;
    }

    let totalMin = 0;
    const cells = D.days.map(d => {
      const r = req[d.date];
      if (!r) return '<td class="off">休み</td>';
      totalMin += r.end - r.start;
      const cls = d.dow >= 5 ? 'we' : '';
      return `<td class="on ${cls}">${hm(r.start)}<br>${hm(r.end)}</td>`;
    }).join('');

    const over = totalMin > s.capMin;
    return `<tr><td class="who">${esc(s.name)}`
      + `<small>${esc(s.type)}</small></td>${cells}`
      + `<td class="tot${over ? ' over' : ''}">${totalMin / 60}h<small>/${s.capMin / 60}h</small></td></tr>`;
  }).join('');

  // 日ごとに何人出られるか
  const foot = '<tr class="sum"><td class="who">出られる人</td>'
    + D.days.map(d =>
      `<td>${D.staff.filter(s => (D.requests[s.id] || {})[d.date]).length}人</td>`).join('')
    + '<td class="tot"></td></tr>';

  return `<table class="req">${head}${rows}${foot}</table>`;
}

/* ---------- ② シフト表（紙の形） ---------- */

function renderSheet() {
  // シフトが空でも表は出す。空きマスを押して手で組めるようにするため
  // （ここで早く返してしまうと「全部消して手で組む」が成立しない）
  const empty = !shifts.length;

  const checks = checksAll(schedulerInput(), shifts);
  const errs = checks.reduce((a, c) => a + c.items.filter(i => i.level === 'error').length, 0);
  const warns = checks.reduce((a, c) => a + c.items.filter(i => i.level === 'warn').length, 0);

  const out = shifts.filter(isOutOfRequest).length;

  $('body').innerHTML = `
    ${stale ? `<div class="notice"><span>希望やルールが変わりました。作り直すと反映されます。</span>
      <button class="btn ghost sm" id="regen">作り直す</button></div>` : ''}
    ${dirty ? `<div class="notice"><span><b>手直しが保存されていません。</b>このまま閉じると元に戻ります。</span>
      <button class="btn sm" id="saveTop">保存する</button></div>` : ''}
    ${empty ? `<div class="notice"><span>シフトがありません。空いているマスを押して人を入れるか、自動作成で叩き台を作ってください。</span>
      <button class="btn sm" id="goAuto">自動作成へ</button></div>` : ''}
    <div class="card">
      <h2>週間シフト表</h2>
      <p class="lead">★は時間帯責任者。<b>バーを押すと時間を変えたり外したりできます。空いているマスを押すと人を入れられます。</b></p>
      <div class="kpis">
        <div class="kpi"><span>配置</span><b>${shifts.length}件</b></div>
        <div class="kpi"><span>要対応</span><b>${errs}</b></div>
        <div class="kpi"><span>注意</span><b>${warns}</b></div>
        ${out ? `<div class="kpi warnbox"><span>希望の外</span><b>${out}件</b></div>` : ''}
      </div>
      <div class="sheet">${weekTable()}</div>
      ${empty ? '' : `<div class="acts" style="margin-top:12px">
        <button class="btn ghost sm" id="clearAll">全部消して手で組む</button>
      </div>`}
    </div>
    <div class="card">
      <h2>チェック</h2>
      <p class="lead">「スキル」タブのルールと、各人のスキルカードをもとに確認しています。</p>
      ${checkList(checks)}
    </div>
    <div class="card">
      <h2>確定</h2>
      <p class="lead">確定すると、紙と同じ形のシートを出力します（印刷・PDFはそこから）。</p>
      <div class="acts">
        <button class="btn ghost" id="save">保存する</button>
        <button class="btn" id="publish">確定してシフト表を出力</button>
      </div>
    </div>`;

  if ($('regen')) $('regen').onclick = () => { runGenerate(); show('sheet'); };
  $('save').onclick = saveShifts;
  $('publish').onclick = publish;
  if ($('clearAll')) $('clearAll').onclick = clearAll;
  if ($('saveTop')) $('saveTop').onclick = saveShifts;
  if ($('goAuto')) $('goAuto').onclick = () => show('auto');

  document.querySelectorAll('td.nm').forEach(td =>
    td.onclick = () => openBarPanel(Number(td.dataset.i)));
  document.querySelectorAll('td.blank.add').forEach(td =>
    td.onclick = () => openAddPanel(td.dataset.date, Number(td.dataset.min)));
}

/* ---------- 手直し ---------- */

/** 変更したら呼ぶ。保存していない印を立てて、表とチェックを描き直す。 */
function changed() {
  dirty = true;
  closePanel();
  renderSheet();
}

/** 全部消して、空から手で組み始める。 */
function clearAll() {
  if (!shifts.length) return;
  const btn = $('clearAll');
  if (btn.dataset.ok !== '1') {
    btn.dataset.ok = '1';
    btn.textContent = 'もう一度押すと全部消えます';
    setTimeout(() => { if ($('clearAll')) { btn.dataset.ok = '0'; btn.textContent = '全部消して手で組む'; } }, 5000);
    return;
  }
  shifts = [];
  changed();
  toast('全部消しました。空きマスを押して人を入れてください');
}

function closePanel() {
  const p = $('panel');
  if (p) p.remove();
}

/** パネルの入れ物を出す。 */
function openPanel(title, inner) {
  closePanel();
  const el = document.createElement('div');
  el.id = 'panel';
  el.className = 'panel-wrap';
  el.innerHTML = `<div class="panel-bg"></div>
    <div class="panel" role="dialog" aria-label="${esc(title)}">
      <div class="panel-h"><b>${esc(title)}</b>
        <button class="x" id="panelClose" aria-label="閉じる">×</button></div>
      ${inner}
    </div>`;
  document.body.appendChild(el);
  el.querySelector('.panel-bg').onclick = closePanel;
  $('panelClose').onclick = closePanel;
  return el;
}

/** 時刻の選択肢。営業時間のあいだを grid 刻みで。 */
function timeOptions(from, to, sel) {
  let o = '';
  for (let m = from; m <= to; m += D.settings.grid) {
    o += `<option value="${m}"${m === sel ? ' selected' : ''}>${hm(m)}</option>`;
  }
  return o;
}

/** バーを押したとき：時間を変える・ホール/キッチンを変える・外す。 */
function openBarPanel(i) {
  const s = shifts[i];
  if (!s) return;
  const who = staffById(s.staffId);
  const day = D.days.find(d => d.date === s.date);
  const req = requestOf(s.staffId, s.date);
  const { openMin, closeMin, grid } = D.settings;

  const can = sidesOf(who);
  const sideBtns = ['hall', 'kitchen'].map(x =>
    `<button class="btn sm ${s.side === x ? '' : 'ghost'}" data-side="${x}"
      ${can.includes(x) ? '' : 'disabled title="担当業務が違います"'}>${SIDE[x]}</button>`).join('');

  openPanel(`${who.name}　${day.label}（${day.wd}）`, `
    <p class="lead">${req ? `希望：${hm(req.start)}〜${hm(req.end)}` : '<b class="warn">この日は希望を出していません</b>'}</p>
    <div class="frow">
      <label>開始<select id="pStart">${timeOptions(openMin, closeMin - grid, s.start)}</select></label>
      <label>終了<select id="pEnd">${timeOptions(openMin + grid, closeMin, s.end)}</select></label>
    </div>
    <div class="frow">${sideBtns}</div>
    <p class="lead" id="pWarn"></p>
    <div class="acts">
      <button class="btn" id="pOk">この内容にする</button>
      <button class="btn ghost danger" id="pDel">外す</button>
    </div>`);

  let side = s.side;
  document.querySelectorAll('[data-side]').forEach(b => b.onclick = () => {
    side = b.dataset.side;
    document.querySelectorAll('[data-side]').forEach(x =>
      x.className = 'btn sm' + (x.dataset.side === side ? '' : ' ghost'));
    check();
  });
  $('pStart').onchange = check;
  $('pEnd').onchange = check;
  check();

  function check() {
    const a = Number($('pStart').value), b = Number($('pEnd').value);
    const msgs = [];
    if (b <= a) msgs.push('終了は開始より後にしてください');
    else {
      if (b - a < D.settings.minLen) msgs.push(`${D.settings.minLen / 60}時間より短い勤務です`);
      if (req && (a < req.start || b > req.end)) msgs.push('希望の外に入っています');
      if (!req) msgs.push('希望を出していない日です');
    }
    $('pWarn').innerHTML = msgs.length
      ? msgs.map(m => `<span class="warn">${m}</span>`).join('<br>') : '';
    $('pOk').disabled = b <= a;
  }

  $('pOk').onclick = () => {
    s.start = Number($('pStart').value);
    s.end = Number($('pEnd').value);
    s.side = side;
    s.source = 'manual';
    changed();
    toast(`${who.name}さんを ${hm(s.start)}〜${hm(s.end)} ${SIDE[side]} にしました`);
  };
  $('pDel').onclick = () => {
    shifts.splice(i, 1);
    changed();
    toast(`${who.name}さんを外しました`);
  };
}

/** 空きマスを押したとき：その日・その時間に入れる人から選んで追加する。 */
function openAddPanel(date, min) {
  const day = D.days.find(d => d.date === date);
  const already = new Set(shifts.filter(s => s.date === date).map(s => s.staffId));

  const rank = s => {
    const r = requestOf(s.id, date);
    if (!r) return 2;
    return (r.start <= min && min < r.end) ? 0 : 1;   // 0=その時間に出られる 1=別の時間なら
  };

  const list = D.staff
    .filter(s => !already.has(s.id) && sidesOf(s).length)
    .map(s => ({ s, rank: rank(s) }))
    .filter(x => showAll || x.rank === 0)
    .sort((a, b) => a.rank - b.rank
      || (isTrainee(a.s) ? 1 : 0) - (isTrainee(b.s) ? 1 : 0)
      || (b.s.leader ? 1 : 0) - (a.s.leader ? 1 : 0));

  const used = {};
  shifts.forEach(x => { used[x.staffId] = (used[x.staffId] || 0) + (x.end - x.start); });

  const rows = list.map(({ s, rank }) => {
    const r = requestOf(s.id, date);
    const over = (used[s.id] || 0) >= s.capMin;
    const lv = `<span class="lv${isTrainee(s) ? ' zero' : ''}">${DUTY[s.duty] || s.duty}</span>`
      + `<span class="lv zero">${esc(s.type)}</span>`;
    return `<button class="cand${rank ? ' off' : ''}" data-id="${s.id}">
      <span class="c1">${s.leader ? '★' : ''}${esc(s.name)}<small>${esc(s.type)}</small></span>
      <span class="c2">${r ? `希望 ${hm(r.start)}〜${hm(r.end)}` : '<b class="warn">希望なし</b>'}
        ${over ? '<b class="warn">上限いっぱい</b>' : ''}</span>
      <span class="c3">${lv}</span>
    </button>`;
  }).join('');

  openPanel(`${day.label}（${day.wd}）${hm(min)} に入れる`, `
    <p class="lead">押すと ${hm(min)} から ${D.settings.minLen / 60}時間で入ります。時間はあとで直せます。</p>
    <label class="switch"><input type="checkbox" id="pAll" ${showAll ? 'checked' : ''}>
      希望を出していない人も出す</label>
    <div class="cands">${rows || '<p class="state">この時間に出られる人がいません。上のチェックを入れると全員から選べます。</p>'}</div>`);

  $('pAll').onchange = e => { showAll = e.target.checked; openAddPanel(date, min); };

  document.querySelectorAll('.cand').forEach(b => b.onclick = () => {
    const s = staffById(b.dataset.id);
    const r = requestOf(s.id, date);
    let end = min + D.settings.minLen;
    if (r && r.end < end) end = r.end;                       // 希望の終わりを越えない
    if (end > D.settings.closeMin) end = D.settings.closeMin; // 閉店を越えない
    if (end <= min) end = Math.min(min + D.settings.grid, D.settings.closeMin);

    shifts.push({
      date, staffId: s.id, side: sidesOf(s)[0],
      start: min, end, source: 'manual'
    });
    changed();
    toast(`${s.name}さんを ${hm(min)}〜${hm(end)} に入れました`);
  });
}

/** 紙と同じ並びの表を組み立てる。 */
function weekTable() {
  const { axisStart, axisEnd, grid, lanes } = D.settings;
  const cols = Math.round((axisEnd - axisStart) / grid);
  const colOf = min => Math.round((min - axisStart) / grid);

  // 画面では、その日に本当に要る行数だけ描く。
  // 紙（ShiftSheet）は A4 に合わせて Settings.sheet_lanes 行で固定だが、
  // 画面で同じことをすると空行だらけで縦に長くなり、週全体が見渡せなくなる。

  let html = '<table class="wk">';
  for (const day of D.days) {
    const list = shifts
      .map((s, i) => ({ ...s, i }))
      .filter(s => s.date === day.date)
      .sort((a, b) => a.start - b.start || a.end - b.end);

    // 重ならない人は同じ行の右側に詰める
    const L = [];
    for (const x of list) {
      let k = L.findIndex(l => l.end <= x.start);
      if (k < 0) { L.push({ end: 0, items: [] }); k = L.length - 1; }
      L[k].items.push(x); L[k].end = x.end;
    }
    if (!L.length) L.push({ items: [] });          // 誰も入っていない日も1行は出す
    const over = L.length > lanes;                 // 紙に収まらない日は印として出す

    const dcls = day.dow === 5 ? 'sat' : day.dow === 6 ? 'sun' : '';
    const rows = L.length + 1;

    // 時刻の見出し（日ごとに繰り返す）
    html += `<tr><th class="day ${dcls}" rowspan="${rows + 1}">${day.label}<br><small>${day.wd}</small>`
      + `<br><small class="cnt">${list.length}人</small>`
      + (over ? `<br><small class="over" title="紙は${lanes}行までです">紙に収まりません</small>` : '')
      + '</th>'
      + Array.from({ length: cols }, (_, i) =>
        `<th class="hr">${hourLabel(axisStart + i * grid)}</th>`).join('')
      + `<td class="memo" rowspan="${rows + 1}">${esc(D.notes[day.date] || '')}</td></tr>`;

    // 空きマス。営業時間内なら押して人を追加できる
    const blank = (ci) => {
      const min = axisStart + ci * grid;
      const inOpen = min >= D.settings.openMin && min < D.settings.closeMin;
      return inOpen
        ? `<td class="blank add" data-date="${day.date}" data-min="${min}"></td>`
        : '<td class="blank"></td>';
    };

    // バーの行
    L.forEach(l => {
      let row = '', c = 0;
      for (const x of l.items) {
        const a = Math.max(0, colOf(x.start)), b = Math.min(cols, colOf(x.end));
        if (b <= a) continue;
        for (; c < a; c++) row += blank(c);
        const who = staffById(x.staffId);
        const out = isOutOfRequest(x);
        row += `<td class="nm${out ? ' out' : ''}" colspan="${b - a}" data-i="${x.i}"`
          + ` title="${esc(who.name)}（${DUTY[who.duty] || ''}・${esc(who.type)}） ${hm(x.start)}〜${hm(x.end)} ${SIDE[x.side]}`
          + `${out ? '（希望の外）' : ''}"`
          + ` style="background:hsl(${who.colorHue} 62% 84%)">`
          + (who.leader ? '★' : '') + esc(who.name) + (out ? '<span class="mk">!</span>' : '')
          + '</td>';
        c = b;
      }
      for (; c < cols; c++) row += blank(c);
      html += `<tr>${row}</tr>`;
    });

    // 最下段：その時間の不足
    html += '<tr class="sum">' + Array.from({ length: cols }, (_, i) => {
      const min = axisStart + i * grid;
      const si = D.slots.indexOf(min);
      if (si < 0) return '<td></td>';
      const s = ['hall', 'kitchen'].reduce((a, side) => {
        const c2 = shifts.filter(x => x.date === day.date && x.side === side
          && x.start <= min && min < x.end).length;
        return a + Math.max(0, need(day, side, si) - c2);
      }, 0);
      return `<td class="${s ? 'sh' : ''}">${s ? '−' + s : ''}</td>`;
    }).join('') + '</tr>';
  }
  return html + '</table>';
}

/**
 * チェックは27件くらい出るので、全部並べると画面が縦に長くなりすぎる。
 * 日ごとにたたんでおき、件数だけ見せて、気になる日を開いてもらう。
 */
function checkList(checks) {
  const body = checks.map(c => {
    if (!c.items.length) return '';
    const day = D.days.find(d => d.date === c.date);
    const dcls = day.dow === 5 ? 'sat' : day.dow === 6 ? 'sun' : '';
    const errs = c.items.filter(i => i.level === 'error').length;
    const warns = c.items.length - errs;
    const counts = [
      errs ? `<span class="tag">要対応 ${errs}</span>` : '',
      warns ? `<span class="tag w">注意 ${warns}</span>` : ''
    ].join('');
    return `<details class="chk-day">
      <summary><b class="${dcls}">${day.label}（${day.wd}）</b> ${counts}</summary>
      <ul>${c.items.map(i =>
        `<li><span class="tag ${i.level === 'warn' ? 'w' : ''}">${esc(i.kind)}</span>
          <span>${esc(i.message)}</span></li>`).join('')}</ul>
    </details>`;
  }).join('');
  return body || '<p class="okline">ルール違反はありません。</p>';
}

/* ---------- ③ 自動作成 ---------- */

function renderAuto() {
  const rows = D.slots.map((min, i) => `<tr>
      <td>${hm(min)}</td>
      <td>${D.demand.weekday.hall[i]}</td><td>${D.demand.weekday.kitchen[i]}</td>
      <td>${D.demand.weekend.hall[i]}</td><td>${D.demand.weekend.kitchen[i]}</td>
    </tr>`).join('');

  $('body').innerHTML = `
    <div class="card">
      <h2>叩き台を自動作成</h2>
      <p class="lead">希望とスキルカード、必要人数、ルールをもとに作ります。作ったあと手直しできます。</p>
      <div class="acts"><button class="btn" id="gen">叩き台を自動作成</button></div>
      <div id="result"></div>
    </div>

    <div class="card">
      <h2>必要人数</h2>
      <p class="lead">時間帯ごとの人数。土日のピーク帯は自動で +${D.settings.weekendPeakBoost}人します。</p>
      <div class="sheet"><table class="wk">
        <tr><th class="hr">時刻</th><th class="hr">平日ホール</th><th class="hr">平日キッチン</th>
            <th class="hr">土日ホール</th><th class="hr">土日キッチン</th></tr>
        ${rows}
      </table></div>
      <p class="lead" style="margin-top:9px">1回の勤務：${D.settings.minLen / 60}〜${D.settings.maxLen / 60}時間</p>
    </div>`;

  $('gen').onclick = () => {
    const btn = $('gen');
    btn.disabled = true;
    btn.textContent = '作成中…';
    // 同期で回るので、1フレーム遅らせて「作成中」を先に描かせる
    setTimeout(() => {
      const ms = runGenerate();
      btn.disabled = false;
      btn.textContent = '叩き台を自動作成';
      renderResult(ms);
    }, 0);
  };
}

function runGenerate() {
  const t0 = performance.now();
  shifts = generate(schedulerInput()).map(s => ({ ...s, source: 'auto' }));
  stale = false;
  return Math.round(performance.now() - t0);
}

function renderResult(ms) {
  let short = 0, total = 0;
  for (const day of D.days) { const d = dayShort(day); short += d.short; total += d.total; }
  const checks = checksAll(schedulerInput(), shifts);
  const errs = checks.reduce((a, c) => a + c.items.filter(i => i.level === 'error').length, 0);
  const warns = checks.reduce((a, c) => a + c.items.filter(i => i.level === 'warn').length, 0);

  const used = {};
  shifts.forEach(s => { used[s.staffId] = (used[s.staffId] || 0) + (s.end - s.start); });
  const over = D.staff.filter(s => (used[s.id] || 0) > s.capMin);

  $('result').innerHTML = `
    <div class="kpis" style="margin-top:13px">
      <div class="kpi"><span>充足率</span><b>${Math.round((1 - short / total) * 100)}%</b></div>
      <div class="kpi"><span>不足</span><b>${short * D.settings.grid / 60}人×h</b></div>
      <div class="kpi"><span>要対応</span><b>${errs}</b></div>
      <div class="kpi"><span>注意</span><b>${warns}</b></div>
      <div class="kpi"><span>配置</span><b>${shifts.length}件</b></div>
    </div>
    <p class="lead">${ms}ミリ秒で作成しました。${
      over.length ? `<b style="color:var(--err)">上限超過 ${over.length}名</b>` : '週の上限を超えた人はいません。'}</p>
    <div class="acts">
      <button class="btn" id="toSheet">シフト表で見る</button>
      <button class="btn ghost" id="saveHere">保存する</button>
    </div>`;
  $('toSheet').onclick = () => show('sheet');
  $('saveHere').onclick = saveShifts;
}

/* ---------- ④ スキル ---------- */

function renderSkill() {
  const ruleRows = Object.keys(D.rules).map(k => `
    <label><input type="checkbox" data-rule="${k}" ${D.rules[k] ? 'checked' : ''}>
      <span>${esc(D.ruleLabels[k])}${D.ruleLevels[k] === 'warn' ? '（注意）' : ''}</span></label>`).join('');

  const people = D.staff.map(s => {
    const limit = endLimitOf(s, schedulerInput());
    const ngNames = (s.ng || []).map(id => staffById(id)?.name).filter(Boolean);
    return `<details class="sk">
      <summary><span class="nm">${esc(s.name)}
        <small>${DUTY[s.duty] || s.duty}・${esc(s.type)}・週${s.capMin / 60}h${
          s.leader ? '・責任者' : ''}${s.closer ? '・締め可' : ''}</small>
      </span></summary>
      <div class="ed">
        <div class="lvrow">
          <span class="lv">${DUTY[s.duty] || s.duty}</span>
          <span class="lv zero">${esc(s.type)}</span>
          ${limit < D.settings.closeMin
            ? `<span class="lv warnlv">${hm(limit)}まで</span>` : ''}
        </div>
        ${ngNames.length ? `<p style="margin:8px 0 0">組ませない：${esc(ngNames.join('、'))}</p>` : ''}
        ${s.memo ? `<p style="margin:6px 0 0">メモ：${esc(s.memo)}</p>` : ''}
      </div>
    </details>`;
  }).join('');

  $('body').innerHTML = `
    <div class="card">
      <h2>店のルール</h2>
      <p class="lead">チェックを外すと、自動作成とチェックの両方で見なくなります。</p>
      <div class="rules">${ruleRows}</div>
      <div class="acts" style="margin-top:12px"><button class="btn ghost" id="saveRules">ルールを保存</button></div>
    </div>
    <div class="card">
      <h2>対象の月と週</h2>
      <p class="lead">毎月はじめにここで次の月を開きます。月の暫定とその月の週がまとめて作られます。</p>
      <div class="frow">
        <label>開く月<input type="month" id="newMonth" value="${nextMonthValue()}"></label>
        <button class="btn" id="openMonth">この月を開く</button>
      </div>
      <p class="lead" id="openMsg"></p>
      <hr style="border:0;border-top:1px solid var(--line);margin:14px 0">
      <p class="lead">いま見ている週（${fmt(D.period.startDate)}〜${fmt(D.period.endDate)}）の受付</p>
      <div class="acts">
        <button class="btn ghost sm" data-st="open">受付中にする</button>
        <button class="btn ghost sm" data-st="closed">締め切る</button>
      </div>
    </div>

    <div class="card">
      <h2>スキルカード</h2>
      <p class="lead">担当業務と区分。高校生は22時までしか入りません。編集は次の段階で作ります。</p>
      ${people}
    </div>`;

  document.querySelectorAll('[data-rule]').forEach(el => el.onchange = () => {
    D.rules[el.dataset.rule] = el.checked;
    if (shifts.length) stale = true;
  });
  $('openMonth').onclick = openMonth;
  document.querySelectorAll('[data-st]').forEach(b => b.onclick = () => setStatus(b.dataset.st));
  $('saveRules').onclick = async () => {
    try {
      await callRetry('mgr.saveRules', { rules: D.rules }, auth());
      toast('ルールを保存しました');
    } catch (err) { toast('保存できませんでした：' + err.message); }
  };
}

/** 次の月を既定値にする（たいてい次の月を開くので） */
function nextMonthValue() {
  const d = new Date(D.period.startDate + 'T00:00:00');
  d.setMonth(d.getMonth() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** 新しい月を開く。月の暫定と、その月の週をまとめて作る。 */
async function openMonth() {
  const month = $('newMonth').value;
  if (!month) return toast('月を選んでください');
  const btn = $('openMonth');
  btn.disabled = true;
  $('openMsg').textContent = '作っています…';
  try {
    const r = await callRetry('mgr.openPeriod', { month }, auth());
    $('openMsg').innerHTML =
      `<b style="color:var(--ok)">${esc(r.monthId)} を開きました</b>（週 ${r.weeks.length}件）<br>`
      + `<span class="small">スタッフの画面に「暫定を出してください」が出ます。`
      + `週は「準備中」なので、その週が近づいたら上の［受付中にする］で開けてください。</span>`;
    D = await call('mgr.load', { periodId: D.period.id }, auth());
    renderHeader();
  } catch (err) {
    $('openMsg').innerHTML = `<span class="warn">${esc(err.message)}</span>`;
  } finally {
    btn.disabled = false;
  }
}

/** いま見ている週の受付を開ける／締める。 */
async function setStatus(status) {
  try {
    await callRetry('mgr.setStatus', { periodId: D.period.id, status }, auth());
    D.period.status = status;
    const w = (D.weeks || []).find(x => x.id === D.period.id);
    if (w) w.status = status;
    renderHeader();
    toast(status === 'open' ? '受付中にしました' : '締め切りました');
  } catch (err) {
    toast('変えられませんでした：' + err.message);
  }
}

/* ---------- 保存・確定 ---------- */

async function saveShifts() {
  try {
    const r = await callRetry('mgr.saveShifts', {
      periodId: D.period.id, revision: D.period.revision, shifts
    }, auth());
    D.period.revision = r.revision;
    dirty = false;
    if (tab === 'sheet') renderSheet();
    toast(`保存しました（${r.saved}件）`);
  } catch (err) {
    toast(err.code === 'conflict'
      ? '別の端末で変更されています。読み込み直してください'
      : '保存できませんでした：' + err.message);
  }
}

async function publish() {
  if (!confirmInline()) return;
  try {
    await saveShifts();
    const r = await callRetry('mgr.publish', { periodId: D.period.id }, auth());
    const extra = r.overflow && r.overflow.length
      ? `（${r.overflow.length}日分、行が足りず表に出ていない人がいます）` : '';
    toast(`確定しました：${r.sheet}${extra}`);
    D.period.status = 'published';
    $('sub').textContent = `${fmtRange()} ／ スタッフ${D.staff.length}名 ／ ${statusLabel('published')}`;
  } catch (err) {
    toast('確定できませんでした：' + err.message);
  }
}

/** confirm() は使わず、ページ内で確認する（docs/03）。 */
function confirmInline() {
  const box = $('body').querySelector('.card:last-child');
  if (box.dataset.confirming === '1') { box.dataset.confirming = '0'; return true; }
  box.dataset.confirming = '1';
  toast('もう一度押すと確定します');
  setTimeout(() => { box.dataset.confirming = '0'; }, 6000);
  return false;
}
