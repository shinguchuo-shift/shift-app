/**
 * スタッフ画面。LINE の中（LIFF）で開く前提。
 *
 * この店の運用は2段階（docs/06 #10）：
 *   ① 月の暫定 … 月のはじめに1ヶ月分をざっくり出す。曜日ごとに入れて、違う日だけ直す
 *   ② 週の確認 … その週が近づいたら、暫定をそのまま見せて「このままでよいか」を聞く
 *
 * ②の初期値は「いつもの勤務」ではなく **①で出した暫定**。ここがこの店のやり方の肝。
 */

import { call, callRetry, ApiError } from './api.js?v=3';
import * as liffAuth from './liff-auth.js?v=1';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const hm = m => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const WD = ['月', '火', '水', '木', '金', '土', '日'];

let D = null;
let devStaffId = null;    // 開発中だけ。LINE から開けば要らない
let mode = 'home';        // home | editMonth | editWeek | done
let view = null;          // 'month' | 'week'。①②のどちらを見ているか
let draft = null;         // 入力中の内容

init();

async function init() {
  // 開発中は URL の ?staff=s03 で誰として見るかを決められる
  const q = new URLSearchParams(location.search);
  devStaffId = q.get('staff') || null;

  // ?debug=1 で、LIFF が何を返しているかをその場で見られる。
  // この画面は index.html（＝エンドポイントURL）そのものなので、LIFF の
  // 「redirectUri はエンドポイントURLで始まること」の決まりに引っかからない。
  if (q.get('debug') === '1') return showDebug();
  try {
    const r = await liffAuth.start('staff');
    if (r.enabled) devStaffId = null;      // LIFF が効いていれば本人が決まる
  } catch (err) {
    $('body').innerHTML = `<div class="state err"><b>LINEとの連携に失敗しました</b><br>
      <span class="small">${esc(err.message)}</span></div>`;
    return;
  }
  await load();
}

async function load() {
  const t0 = Date.now();
  const paint = () => {
    const el = $('state');
    if (!el) return false;
    const sec = Math.round((Date.now() - t0) / 1000);
    el.innerHTML = '読み込んでいます…<br>'
      + `<span class="small">${sec ? sec + '秒経過' : '少し時間がかかります'}</span>`;
    return true;
  };
  paint();
  const tick = setInterval(() => { if (!paint()) clearInterval(tick); }, 400);

  try {
    D = await call('me', {}, { devStaffId, idToken: liffAuth.getIdToken() });
    mode = 'home';
    render();
    setupDevBar();
  } catch (err) {
    // まだLINEアカウントとスタッフが結びついていない人は、招待コードの画面へ
    if (err.code === 'needsLink') return renderLink();
    $('body').innerHTML = `<div class="state err"><b>読み込めませんでした</b><br>
      <span class="small">${esc(err.message)}</span></div>`;
  } finally {
    clearInterval(tick);
  }
}

/** 開発中の「誰として見るか」切り替え。LINE から開くときは出さない。 */
async function setupDevBar() {
  if (liffAuth.isReady()) return;          // 本番（LIFF）では出さない
  const bar = $('devbar');
  bar.hidden = false;
  if ($('devWho').options.length) return;

  // スタッフ一覧は店長用 API から借りる（開発中だけの手抜き）
  try {
    const mgr = await call('mgr.load', {}, { idToken: liffAuth.getIdToken() });
    $('devWho').innerHTML = mgr.staff.map(s =>
      `<option value="${s.id}"${s.id === D.me.id ? ' selected' : ''}>${esc(s.name)}（${esc(s.type)}）</option>`
    ).join('');
    $('devWho').onchange = e => {
      const u = new URL(location.href);
      u.searchParams.set('staff', e.target.value);
      location.href = u.toString();
    };
  } catch (e) { bar.hidden = true; }
}

/**
 * 初回だけ：招待コードを入れて、LINEアカウントとスタッフを結びつける。
 * コードは店長が口頭か個別のLINEで伝える。
 */
function renderLink(msg) {
  $('topStore').textContent = 'シフト提出';
  $('body').innerHTML = `
    <p class="hi">はじめまして</p>
    <p class="sub">店長から聞いた<b>招待コード</b>を入れてください。<br>
      最初の1回だけです。</p>
    <div class="box">
      <label class="eyebrow" for="code">招待コード</label>
      <input id="code" class="codein" type="text" inputmode="latin"
             autocapitalize="characters" autocomplete="off"
             placeholder="例：K7M2QX94" maxlength="12">
      <p class="warn" id="codeMsg">${msg ? esc(msg) : ''}</p>
    </div>
    <div class="acts">
      <button class="btn big" id="doLink">つなげる</button>
    </div>
    <p class="small" style="text-align:center">
      コードが分からないときは店長に聞いてください。</p>`;

  const input = $('code');
  input.focus();
  input.oninput = () => { $('codeMsg').textContent = ''; };
  input.onkeydown = e => { if (e.key === 'Enter') $('doLink').click(); };

  $('doLink').onclick = async () => {
    const code = input.value.trim();
    if (!code) return $('codeMsg').textContent = '招待コードを入れてください';

    const btn = $('doLink');
    btn.disabled = true;
    btn.textContent = 'つないでいます…';
    try {
      const r = await callRetry('me.link', { inviteCode: code },
        { idToken: liffAuth.getIdToken() });
      toast(`${r.staff.name}さんとしてつながりました`);
      await load();                       // つながったので本来の画面へ
    } catch (err) {
      $('codeMsg').textContent = err.message;
      btn.disabled = false;
      btn.textContent = 'つなげる';
    }
  };
}

/**
 * LIFF の動作チェック（?debug=1）。実機で何が取れて何が取れないかを見るためのもの。
 * Phase 3 の仕上げで消す。
 */
async function showDebug() {
  const rows = [];
  const show = (k, v, ok) => {
    rows.push(`<div class="row"><b>${esc(k)}</b><span class="${
      ok === undefined ? '' : ok ? 'ok' : 'ng'}">${
      ok === undefined ? '' : (ok ? '✓ ' : '✕ ')}${esc(v)}</span></div>`);
    $('body').innerHTML = `<p class="hi">LIFF 動作チェック</p>
      <p class="sub">全部 ✓ なら本番に進めます。</p><div class="dbg">${rows.join('')}</div>`;
  };

  try {
    const r = await liffAuth.start('staff');
    show('LIFF を通ったか', r.enabled ? 'はい' : 'いいえ（localhost か ?noliff=1）', r.enabled);
    if (r.enabled) {
      show('どこから開いたか', (r.context && r.context.type) || '(不明)', true);
      show('IDトークン', liffAuth.getIdToken() ? '取得できた' : '取得できない', !!liffAuth.getIdToken());
      show('グループから開いたか', liffAuth.isGroup() ? 'はい' : 'いいえ', true);
    }
    const d = await call('me', {}, { devStaffId, idToken: liffAuth.getIdToken() });
    show('GAS との通信', 'つながった', true);
    show('あなた', `${d.me.name}（${d.me.type}）`, true);
    show('対象の月', d.month ? d.month.id : '(なし)', !!d.month);
    show('対象の週', d.week ? d.week.id : '(なし)', !!d.week);
    show('紐付け', '済み', true);
  } catch (err) {
    if (err.code === 'needsLink') {
      show('紐付け', 'まだ（招待コードの入力が要る）', false);
      show('', '通常の画面を開くと、招待コードの入力が出ます。', undefined);
    } else {
      show('エラー', (err.code ? err.code + ' / ' : '') + err.message, false);
    }
  }
}

/* ---------- 画面 ---------- */

function render() {
  $('topStore').textContent = `${D.settings.storeName} シフト提出`;
  const el = $('body');

  if (mode === 'editMonth') return renderEditMonth(el);
  if (mode === 'editWeek') return renderEditWeek(el);
  if (mode === 'done') return renderDone(el);
  renderHome(el);
  window.scrollTo({ top: 0 });
}

/**
 * 上の2段階。押すと①②を行き来できる。
 * 月を出したあとでも「やっぱり暫定を直したい」があるので、必ず両方に行けるようにする。
 */
function stepsBar(now) {
  const m = D.month, w = D.week;
  const cls = (key, has) => {
    if (!has) return 'step off';
    if (now === key) return 'step now';
    if (key === 'month' && m && m.submitted) return 'step done';
    if (key === 'week' && w && w.submitted) return 'step done';
    return 'step';
  };
  return `<div class="steps">
    <button class="${cls('month', !!m)}" data-view="month"${m ? '' : ' disabled'}>
      <b>① 月の暫定</b>${m ? monthLabel(m) : '—'}<br>${m ? (m.submitted ? '提出済み' : '未提出') : ''}</button>
    <button class="${cls('week', !!w)}" data-view="week"${w ? '' : ' disabled'}>
      <b>② 週の確認</b>${w ? `${fmt(w.startDate)}〜` : '—'}<br>${w ? (w.submitted ? '提出済み' : '未提出') : ''}</button>
  </div>`;
}

/** いま見るべきほうを決める（最初に開いたとき用）。 */
function defaultView() {
  const w = D.week, m = D.month;
  if (m && m.status === 'open' && !m.submitted) return 'month';   // まず暫定を出してもらう
  if (w && (w.status === 'open' || w.submitted)) return 'week';
  if (w) return 'week';
  return 'month';
}

const fmt = d => { const a = d.split('-'); return `${+a[1]}/${+a[2]}`; };
const monthLabel = m => `${+m.startDate.split('-')[1]}月分`;

function renderHome(el) {
  const w = D.week, m = D.month;
  if (!view) view = defaultView();
  const showWeek = view === 'week' && !!w;
  const target = showWeek ? w : m;

  let html = `<div class="head-row">
      <div><p class="hi">${esc(D.me.name)}さん</p>
        <p class="sub">${esc(D.me.type)}・週の上限 ${D.me.capMin / 60}時間${
          D.settings.endLimit < D.settings.closeMin
            ? `・${hm(D.settings.endLimit)}まで` : ''}</p></div>
      <span class="pill ${target && target.submitted ? 'ok' : 'ng'}">${
        target && target.submitted ? '提出済み' : '未提出'}</span>
    </div>
    ${stepsBar(showWeek ? 'week' : 'month')}`;

  if (showWeek) {
    html += renderWeekHome(w, m);
  } else if (m) {
    html += renderMonthHome(m);
  } else {
    html += '<div class="box"><p class="sub">いまは受付期間ではありません。</p></div>';
  }

  el.innerHTML = html;
  bind();
}

/** ① 月の暫定 */
function renderMonthHome(m) {
  const n = Object.keys(m.requests).length;
  let html = `<p class="dl">${monthLabel(m)}の暫定シフト　〆切 ${esc(m.deadline)}</p>`;

  if (m.submitted) {
    html += `<div class="box"><p class="eyebrow">出した暫定（${n}日）</p>
      ${dowSummary(m)}</div>
      <p class="small">このあと、週ごとにあらためて確認があります。</p>
      <div class="acts"><button class="btn ghost" id="edMonth">暫定を直す</button></div>`;
  } else {
    html += `<div class="box"><p class="eyebrow">いつもの勤務</p>${usualList()}</div>
      <p class="small">これをもとに${monthLabel(m)}の暫定を作ります。違う日はあとで直せます。</p>
      <div class="acts">
        <button class="btn big" id="mUsual">いつも通りで提出</button>
        <button class="btn ghost" id="edMonth">曜日ごとに決める</button>
      </div>`;
  }
  return html;
}

/** ② 週の確認 */
function renderWeekHome(w, m) {
  const base = w.submitted ? w.requests : (w.fromMonth || {});
  const hasBase = Object.keys(base).length > 0;

  let html = `<p class="dl">${fmt(w.startDate)}〜${fmt(w.endDate)} の希望　〆切 ${esc(w.deadline)}<br>
    <span class="small">〆切までは何度でも直せます</span></p>`;

  if (w.submitted) {
    html += `<div class="box"><p class="eyebrow">この週の希望（提出済み）</p>
      ${weekList(w.days, w.requests, m)}</div>
      <div class="acts"><button class="btn ghost" id="edWeek">内容を直す</button></div>`;
  } else if (hasBase) {
    html += `<div class="box">
      <p class="eyebrow">${monthLabel(m)}の暫定ではこうなっています</p>
      ${weekList(w.days, base, m)}</div>
      <p class="small">このままでよければ1タップで終わります。</p>
      <div class="acts">
        <button class="btn big" id="wOk">このままで提出</button>
        <button class="btn ghost" id="edWeek">この週は変える</button>
      </div>`;
  } else {
    html += `<div class="box"><p class="sub">暫定が出ていないので、この週の希望を入れてください。</p></div>
      <div class="acts"><button class="btn big" id="edWeek">希望を入れる</button></div>`;
  }
  return html;
}

/** いつもの勤務（曜日ごと） */
function usualList() {
  return `<ul class="pat">${WD.map((w, i) => {
    const u = D.usual[i];
    return `<li class="${i === 5 ? 'we' : i === 6 ? 'sun' : ''}"><span>${w}曜</span>
      <b class="${u ? '' : 'off'}">${u ? `${hm(u.start)}〜${hm(u.end)}` : '休み'}</b></li>`;
  }).join('')}</ul>`;
}

/** 月の暫定を曜日ごとにまとめて見せる（30日ぶん並べると長いので） */
function dowSummary(m) {
  const byDow = {};
  m.days.forEach(d => {
    const r = m.requests[d.date];
    if (!r) return;
    const k = `${r.start}-${r.end}`;
    byDow[d.dow] = byDow[d.dow] || {};
    byDow[d.dow][k] = (byDow[d.dow][k] || 0) + 1;
  });
  return `<ul class="pat">${WD.map((w, i) => {
    const got = byDow[i];
    if (!got) return `<li class="${i === 5 ? 'we' : i === 6 ? 'sun' : ''}"><span>${w}曜</span><b class="off">休み</b></li>`;
    const best = Object.keys(got).sort((a, b) => got[b] - got[a])[0];
    const [s, e] = best.split('-').map(Number);
    const others = Object.keys(got).length - 1;
    return `<li class="${i === 5 ? 'we' : i === 6 ? 'sun' : ''}"><span>${w}曜</span>
      <b>${hm(s)}〜${hm(e)}${others ? `<span class="tagc">ほか${others}通り</span>` : ''}</b></li>`;
  }).join('')}</ul>`;
}

/** 週の7日を並べる。月の暫定と違う日には印を付ける。 */
function weekList(days, req, m) {
  return `<ul class="pat">${days.map(d => {
    const r = req[d.date];
    const mv = m && m.requests ? m.requests[d.date] : null;
    const changed = m && m.submitted &&
      ((!!r !== !!mv) || (r && mv && (r.start !== mv.start || r.end !== mv.end)));
    return `<li class="${d.dow === 5 ? 'we' : d.dow === 6 ? 'sun' : ''}">
      <span>${d.label}（${d.wd}）</span>
      <b class="${r ? (changed ? 'chg' : '') : 'off'}">${r ? `${hm(r.start)}〜${hm(r.end)}` : '休み'}${
        changed ? '<span class="tagc">暫定から変更</span>' : ''}</b></li>`;
  }).join('')}</ul>`;
}

/* ---------- 入力 ---------- */

/**
 * 時刻の選択肢。終了側は区分の上限で切る（高校生は22時まで）。
 */
const timeOpts = (sel, isEnd) => {
  const last = isEnd ? Math.min(D.settings.endLimit, D.settings.closeMin) : D.settings.closeMin;
  let o = '';
  for (let m = D.settings.openMin; m <= last; m += D.settings.grid) {
    o += `<option value="${m}"${m === sel ? ' selected' : ''}>${hm(m)}</option>`;
  }
  return o;
};

/**
 * ① 月の暫定。
 *
 * 下書きは「日ごと」（draft.byDate）で持つ。曜日ごとの入力は、その曜日すべてに
 * 一括で入れるための道具という位置づけ。
 * 「毎週月曜17時、でも12/22だけ休み」のような出し方ができるようにするため。
 */
let monthTab = 'dow';     // dow（曜日ごと）| day（日ごと）
let editDate = null;      // カレンダーで開いている日

function renderEditMonth(el) {
  if (!draft || !draft.byDate) {
    const byDate = {};
    D.month.days.forEach(d => {
      // 出している暫定があればそれ、無ければ「いつもの勤務」から
      const cur = D.month.requests[d.date];
      const u = D.usual[d.dow];
      byDate[d.date] = cur ? { ...cur } : (u ? { ...u } : null);
    });
    draft = { byDate };
    editDate = null;
  }

  const n = Object.values(draft.byDate).filter(Boolean).length;

  el.innerHTML = `<p class="hi">${monthLabel(D.month)}の暫定</p>
    <p class="sub">出られる日：${n}日。曜日でまとめて決めて、違う日だけ直せます。</p>

    <div class="mtabs">
      <button class="mtab${monthTab === 'dow' ? ' on' : ''}" data-mtab="dow">曜日でまとめて</button>
      <button class="mtab${monthTab === 'day' ? ' on' : ''}" data-mtab="day">日ごとに直す</button>
    </div>

    ${monthTab === 'dow' ? dowSection() : daySection()}

    <div class="acts">
      <button class="btn big" id="mSubmit">この内容で提出する</button>
      <button class="btn ghost" id="back">戻る</button>
    </div>`;

  document.querySelectorAll('[data-mtab]').forEach(b => b.onclick = () => {
    monthTab = b.dataset.mtab; editDate = null; renderEditMonth(el);
  });

  if (monthTab === 'dow') bindDow(el);
  else bindDay(el);

  bind();
}

/** 曜日ごと：変えるとその曜日の全部の日に入る。 */
function dowSection() {
  return `<p class="small">変えると、${monthLabel(D.month)}のその曜日すべてに入ります。</p>
    <div class="days">${WD.map((w, i) => dayRow(i, w, dowValue(i), 'dow')).join('')}</div>`;
}

/** その曜日でいちばん多い設定を、代表として見せる。 */
function dowValue(dow) {
  const vals = D.month.days.filter(d => d.dow === dow).map(d => draft.byDate[d.date]);
  const on = vals.filter(Boolean);
  if (!on.length) return null;
  const count = {};
  on.forEach(v => { const k = `${v.start}-${v.end}`; count[k] = (count[k] || 0) + 1; });
  const best = Object.keys(count).sort((a, b) => count[b] - count[a])[0].split('-').map(Number);
  return { start: best[0], end: best[1] };
}

function bindDow(el) {
  for (let i = 0; i < 7; i++) {
    const apply = () => {
      const on = $('on' + i).checked;
      const v = on ? { start: Number($('s' + i).value), end: Number($('e' + i).value) } : null;
      D.month.days.filter(d => d.dow === i).forEach(d => {
        draft.byDate[d.date] = v ? { ...v } : null;
      });
      $('tm' + i).classList.toggle('off', !on);
      renderEditMonth(el);
    };
    $('on' + i).onchange = apply;
    $('s' + i).onchange = apply;
    $('e' + i).onchange = apply;
  }
}

/** 日ごと：カレンダーで見て、押した日だけ直す。 */
function daySection() {
  const days = D.month.days;
  const lead = days[0].dow;                       // 1日が何曜から始まるか
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push('<div class="cal-cell empty"></div>');

  days.forEach(d => {
    const v = draft.byDate[d.date];
    const sel = editDate === d.date ? ' sel' : '';
    const cls = d.dow === 5 ? ' sat' : d.dow === 6 ? ' sun' : '';
    const num = Number(d.date.slice(8));
    cells.push(`<button class="cal-cell${cls}${sel}${v ? ' on' : ''}" data-date="${d.date}">
      <span class="n">${num}</span>
      <span class="t">${v ? `${String(Math.floor(v.start / 60)).padStart(2, '0')}-${String(Math.floor(v.end / 60)).padStart(2, '0')}` : '休'}</span>
    </button>`);
  });

  return `<p class="small">日を押すと、その日だけ直せます。</p>
    <div class="cal-head">${WD.map((w, i) =>
      `<span class="${i === 5 ? 'sat' : i === 6 ? 'sun' : ''}">${w}</span>`).join('')}</div>
    <div class="cal">${cells.join('')}</div>
    ${editDate ? dayEditor(editDate) : ''}`;
}

function dayEditor(date) {
  const d = D.month.days.find(x => x.date === date);
  const v = draft.byDate[date];
  return `<div class="dayedit">
    <p class="eyebrow">${d.label}（${d.wd}）</p>
    <div class="sw"><input type="checkbox" id="dOn" ${v ? 'checked' : ''}>
      <label for="dOn">出られる</label></div>
    <div class="times${v ? '' : ' off'}" id="dTm">
      <select id="dS">${timeOpts(v ? v.start : D.settings.openMin, false)}</select>〜
      <select id="dE">${timeOpts(v ? v.end : D.settings.openMin + D.settings.minLen, true)}</select>
    </div>
    <div class="acts" style="margin-top:10px">
      <button class="btn sm" id="dOk">この日を直す</button>
      <button class="btn ghost sm" id="dClose">閉じる</button>
    </div>
  </div>`;
}

function bindDay(el) {
  document.querySelectorAll('[data-date]').forEach(b => b.onclick = () => {
    editDate = (editDate === b.dataset.date) ? null : b.dataset.date;
    renderEditMonth(el);
  });

  if (!editDate) return;
  $('dOn').onchange = e => $('dTm').classList.toggle('off', !e.target.checked);
  $('dOk').onclick = () => {
    if (!$('dOn').checked) {
      draft.byDate[editDate] = null;
    } else {
      const a = Number($('dS').value), b = Number($('dE').value);
      if (b - a < D.settings.minLen) {
        return toast(`${D.settings.minLen / 60}時間以上で入れてください`);
      }
      draft.byDate[editDate] = { start: a, end: b };
    }
    editDate = null;
    renderEditMonth(el);
  };
  $('dClose').onclick = () => { editDate = null; renderEditMonth(el); };
}

/** ② 週の確認：7日ぶんを日ごとに */
function renderEditWeek(el) {
  const w = D.week;
  if (!draft || !draft.byIndex) {
    const base = w.submitted ? w.requests : (w.fromMonth || {});
    const byIndex = {};
    w.days.forEach((d, i) => { byIndex[i] = base[d.date] ? { ...base[d.date] } : null; });
    draft = { byIndex };
  }

  el.innerHTML = `<p class="hi">${fmt(w.startDate)}〜${fmt(w.endDate)} の希望</p>
    <p class="sub">暫定から変わるところだけ直してください。</p>
    <div class="days">${w.days.map((d, i) =>
      dayRow(i, `${d.label}`, draft.byIndex[i], 'day', d)).join('')}</div>
    <div class="acts">
      <button class="btn big" id="wSubmit">この内容で提出する</button>
      <button class="btn ghost" id="back">戻る</button>
    </div>`;
  bindDays('day');
  bind();
}

function dayRow(i, label, v, kind, d) {
  const on = !!v;
  const cls = d ? (d.dow === 5 ? ' we' : d.dow === 6 ? ' sun' : '')
                : (i === 5 ? ' we' : i === 6 ? ' sun' : '');
  const sub = d ? `（${d.wd}）` : '曜';
  return `<div class="day${cls}">
    <div class="d">${label}<small>${sub}</small></div>
    <div class="sw"><input type="checkbox" id="on${i}" ${on ? 'checked' : ''}>
      <label for="on${i}">出られる</label></div>
    <div class="times${on ? '' : ' off'}" id="tm${i}" style="grid-column:2">
      <select id="s${i}">${timeOpts(v ? v.start : D.settings.openMin, false)}</select>〜
      <select id="e${i}">${timeOpts(v ? v.end : D.settings.openMin + D.settings.minLen, true)}</select>
    </div>
  </div>`;
}

function bindDays(kind) {
  const n = kind === 'dow' ? 7 : D.week.days.length;
  for (let i = 0; i < n; i++) {
    $('on' + i).onchange = e => {
      $('tm' + i).classList.toggle('off', !e.target.checked);
      draft.byIndex[i] = e.target.checked
        ? { start: Number($('s' + i).value), end: Number($('e' + i).value) } : null;
    };
    $('s' + i).onchange = $('e' + i).onchange = () => {
      if ($('on' + i).checked) {
        draft.byIndex[i] = { start: Number($('s' + i).value), end: Number($('e' + i).value) };
      }
    };
  }
}

/* ---------- 送信 ---------- */

function collect(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    if (!$('on' + i).checked) { out.push(null); continue; }
    const a = Number($('s' + i).value), b = Number($('e' + i).value);
    if (b - a < D.settings.minLen) {
      return { error: `${n === 7 ? WD[i] + '曜' : D.week.days[i].label}：${D.settings.minLen / 60}時間以上で入れてください` };
    }
    out.push({ start: a, end: b });
  }
  return { out };
}

async function submitMonth() {
  const days = [];
  D.month.days.forEach(d => {
    const v = draft.byDate[d.date];
    if (v) days.push({ date: d.date, start: v.start, end: v.end });
  });
  await send(D.month.id, days, 'custom',
    `${monthLabel(D.month)}の暫定を出しました（${days.length}日）`);
}

async function submitWeek(useBase) {
  let days;
  if (useBase) {
    const base = D.week.fromMonth || {};
    days = D.week.days.filter(d => base[d.date])
      .map(d => ({ date: d.date, start: base[d.date].start, end: base[d.date].end }));
  } else {
    const got = collect(D.week.days.length);
    if (got.error) return toast(got.error);
    days = [];
    D.week.days.forEach((d, i) => {
      const v = got.out[i];
      if (v) days.push({ date: d.date, start: v.start, end: v.end });
    });
  }
  await send(D.week.id, days, useBase ? 'usual' : 'custom', '希望を受け付けました');
}

async function send(periodId, days, method, msg) {
  const btns = document.querySelectorAll('.acts .btn');
  btns.forEach(b => b.disabled = true);
  try {
    const auth = { devStaffId, idToken: liffAuth.getIdToken() };
    await callRetry('me.submit', { periodId, days, method }, auth);
    D = await call('me', {}, auth);
    view = (D.month && periodId === D.month.id) ? 'month' : 'week';
    draft = null;
    mode = 'done';
    doneMsg = msg;
    render();
  } catch (err) {
    toast('出せませんでした：' + err.message);
    btns.forEach(b => b.disabled = false);
  }
}

let doneMsg = '';

function renderDone(el) {
  const w = D.week, m = D.month;
  const target = (view === 'week' && w) ? w : m;
  if (!target) { mode = 'home'; return render(); }

  el.innerHTML = `<div class="chat">
      <p class="ttl">✓ ${esc(doneMsg)}</p>
      ${target === w
        ? weekList(w.days, w.requests, m)
        : `<p class="small">${monthLabel(m)}の暫定</p>${dowSummary(m)}`}
      <p class="small" style="margin-top:8px">〆切（${esc(target.deadline)}）までは直せます。</p>
    </div>
    <p class="chat-note">LINEのトークにも同じ内容が届きます</p>
    <div class="acts">
      <button class="btn ghost" id="back">トップに戻る</button>
    </div>`;
  bind();
}

/* ---------- 共通 ---------- */

function bind() {
  document.querySelectorAll('[data-view]').forEach(b => b.onclick = () => {
    if (b.disabled) return;
    view = b.dataset.view;
    draft = null;
    mode = 'home';
    render();
  });
  const on = (id, fn) => { if ($(id)) $(id).onclick = fn; };
  on('edMonth', () => { draft = null; mode = 'editMonth'; render(); });
  on('edWeek', () => { draft = null; mode = 'editWeek'; render(); });
  on('back', () => { draft = null; mode = 'home'; render(); });
  on('mUsual', () => {
    const days = [];
    D.month.days.forEach(d => {
      const v = D.usual[d.dow];
      if (v) days.push({ date: d.date, start: v.start, end: v.end });
    });
    send(D.month.id, days, 'usual', `${monthLabel(D.month)}の暫定を出しました（${days.length}日）`);
  });
  on('mSubmit', submitMonth);
  on('wOk', () => submitWeek(true));
  on('wSubmit', () => submitWeek(false));
}

function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2400);
}
