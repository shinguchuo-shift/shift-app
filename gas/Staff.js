/**
 * スタッフ用の action。
 *
 * この店の運用は2段階（docs/06 #10）：
 *   1) 月の暫定  … 月のはじめに1ヶ月分をざっくり出す
 *   2) 週の確認  … その週が近づいたら、暫定を見せて「このままでよいか」を確認する
 *
 * 週の画面の初期値は「いつもの勤務」ではなく **その月の暫定** を使う。ここがこの店のやり方の肝。
 */

/** いま受付中の期間を探す。無ければ直近の closed を返す（画面で「受付期間外」を出すため）。 */
function currentPeriods_() {
  var all = readTable('Periods');
  // 受付中があればそれ。無ければ「いちばん最近 開始した期間」を見せる（準備中の先の週は出さない）
  var pick = function (kind) {
    var list = all.filter(function (p) { return (p.kind || 'week') === kind; })
      .sort(function (a, b) { return dateKey_(a.start_date) < dateKey_(b.start_date) ? 1 : -1; });
    var open = list.filter(function (p) { return p.status === 'open'; })[0];
    if (open) return open;
    var started = list.filter(function (p) { return p.status !== 'draft'; })[0];
    return started || list[list.length - 1] || null;
  };
  return { month: pick('month'), week: pick('week') };
}

/** その人の、その期間の希望（最新 rev だけ）。{ 'YYYY-MM-DD': {start,end} } */
function requestsOf_(periodId, staffId) {
  var want = String(periodId);
  var out = {}, latest = {};
  readTable('Requests', function (r) {
    return String(r.period_id) === want && r.staff_id === staffId && r.active !== false;
  }).forEach(function (r) {
    var d = dateKey_(r.date);
    var rev = Number(r.rev) || 1;
    if (latest[d] !== undefined && latest[d] >= rev) return;
    latest[d] = rev;
    out[d] = { start: Number(r.start_min), end: Number(r.end_min) };
  });
  return out;
}

/** 期間の日付を並べる。 */
function daysOf_(period) {
  var out = [];
  if (!period) return out;
  var d = new Date(dateKey_(period.start_date) + 'T00:00:00');
  var last = new Date(dateKey_(period.end_date) + 'T00:00:00');
  var wd = ['月', '火', '水', '木', '金', '土', '日'];
  while (d <= last) {
    var dow = (d.getDay() + 6) % 7;
    out.push({
      date: fmtDate_(d), dow: dow,
      label: (d.getMonth() + 1) + '/' + d.getDate(),
      wd: wd[dow],
      weekend: dow >= 5
    });
    d.setDate(d.getDate() + 1);
  }
  return out;
}

/** スタッフ画面に必要なデータを一度に返す。 */
function meLoad(req, p) {
  prefetchTables(['Settings', 'Staff', 'Periods', 'Requests', 'Submissions', 'UsualPattern']);

  var me = identify(req);
  var st = readSettings();
  var cur = currentPeriods_();

  // いつもの勤務（曜日ごと）
  var usual = {};
  readTable('UsualPattern', function (r) { return r.staff_id === me.staff_id; })
    .forEach(function (r) {
      usual[Number(r.dow)] = { start: Number(r.start_min), end: Number(r.end_min) };
    });

  var pack = function (period) {
    if (!period) return null;
    var pid = String(period.period_id);
    var subs = readTable('Submissions', function (r) {
      return String(r.period_id) === pid && r.staff_id === me.staff_id;
    })[0];
    return {
      id: pid,
      kind: period.kind || 'week',
      startDate: dateKey_(period.start_date),
      endDate: dateKey_(period.end_date),
      deadline: period.deadline_at ? String(period.deadline_at) : '',
      status: period.status,
      days: daysOf_(period),
      requests: requestsOf_(pid, me.staff_id),
      submitted: !!subs,
      method: subs ? subs.method : null
    };
  };

  var month = pack(cur.month);
  var week = pack(cur.week);

  // 週の初期値：その週がまだ未提出なら、月の暫定から該当日を引っぱってくる
  if (week && !week.submitted && month) {
    var base = {};
    week.days.forEach(function (d) {
      if (month.requests[d.date]) base[d.date] = month.requests[d.date];
    });
    week.fromMonth = base;
  }

  return {
    me: {
      id: me.staff_id, name: me.name, type: me.type,
      capMin: Number(me.weekly_cap_min) || 0
    },
    settings: {
      storeName: st.store_name || '',
      openMin: Number(st.open_min) || 600,
      closeMin: Number(st.close_min) || 1440,
      grid: Number(st.grid_min) || 60,
      minLen: Number(st.min_shift_min) || 180,
      // 高校生は22時まで。入力の選択肢をここで絞る
      endLimit: TYPE_END_LIMIT[me.type] || (Number(st.close_min) || 1440)
    },
    usual: usual,
    month: month,
    week: week
  };
}

/**
 * 希望を出す。行は消さず、rev を増やして追記する（同時提出で他人の行を消さないため）。
 * @param p { periodId, days: [{date,start,end}], method }
 */
function meSubmit(req, p) {
  var me = identify(req);
  var pid = String(p.periodId);

  var period = readTable('Periods', function (r) {
    return String(r.period_id) === pid;
  })[0];
  if (!period) throw apiError('noPeriod', '対象の期間が見つかりません');
  if (period.status !== 'open' && period.status !== 'closed') {
    throw apiError('closed', 'いまは受付期間ではありません');
  }

  // いまの最大 rev
  var rev = 1;
  readTable('Requests', function (r) {
    return String(r.period_id) === pid && r.staff_id === me.staff_id;
  }).forEach(function (r) { rev = Math.max(rev, (Number(r.rev) || 1) + 1); });

  // 古い行を無効にして、新しい rev を追記する
  var keep = readTable('Requests').map(function (r) {
    var mine = String(r.period_id) === pid && r.staff_id === me.staff_id;
    return keysOf('Requests').map(function (k) {
      if (k === 'active' && mine) return false;
      if (k === 'date') return dateKey_(r.date);
      return r[k];
    });
  });

  (p.days || []).forEach(function (d) {
    if (!d || d.end <= d.start) return;
    keep.push([pid, me.staff_id, d.date, d.start, d.end, rev, true]);
  });
  writeTable('Requests', keep);

  // 提出の記録
  var now = new Date();
  var subs = readTable('Submissions');
  var found = false;
  var rows = subs.map(function (r) {
    var mine = String(r.period_id) === pid && r.staff_id === me.staff_id;
    if (mine) found = true;
    return keysOf('Submissions').map(function (k) {
      if (mine && k === 'updated_at') return now;
      if (mine && k === 'method') return p.method || 'custom';
      return r[k];
    });
  });
  if (!found) rows.push([pid, me.staff_id, now, now, p.method || 'custom']);
  writeTable('Submissions', rows);

  return { periodId: pid, rev: rev, days: (p.days || []).length };
}
