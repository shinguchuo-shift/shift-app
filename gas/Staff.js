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
  prefetchTables(['Settings', 'Staff', 'Periods', 'Requests', 'Submissions', 'UsualPattern', 'Shifts', 'DayNotes']);

  var me = identify(req);
  var st = readSettings();
  var cur = currentPeriods_();

  // 週のプルダウンに出す週：準備中を除く（受付中・締切後・確定済み）。古い順
  var allWeeks = readTable('Periods', function (r) { return (r.kind || 'week') === 'week' && r.status !== 'draft'; })
    .sort(function (a, b) { return dateKey_(a.start_date) < dateKey_(b.start_date) ? -1 : 1; });
  // 見る週：画面で選んだ週があればそれ、無ければ今の週
  var pickedWeek = cur.week;
  if (p && p.weekId) {
    pickedWeek = allWeeks.filter(function (r) { return String(r.period_id) === String(p.weekId); })[0] || cur.week;
  }

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
  var week = pack(pickedWeek);

  // 週の初期値：その週がまだ未提出なら、その週が属する月の暫定から該当日を引っぱってくる
  if (week && !week.submitted) {
    var parentId = pickedWeek.parent_id ? String(pickedWeek.parent_id) : (month ? month.id : '');
    var monthReq = month && month.id === parentId ? month.requests : requestsOf_(parentId, me.staff_id);
    var base = {};
    week.days.forEach(function (d) {
      if (monthReq[d.date]) base[d.date] = monthReq[d.date];
    });
    week.fromMonth = base;
    // 月の希望を出していれば、週を出さなくても月の希望がシフト表に使われる
    week.monthSubmitted = readTable('Submissions', function (r) {
      return String(r.period_id) === parentId && r.staff_id === me.staff_id;
    }).length > 0;
  }

  // 確定済みの週は、自分の確定シフトも返す
  if (week && week.status === 'published') {
    week.confirmed = readTable('Shifts', function (r) {
      return String(r.period_id) === week.id && r.staff_id === me.staff_id;
    }).map(function (r) {
      return { date: dateKey_(r.date), start: Number(r.start_min), end: Number(r.end_min), side: r.side };
    }).sort(function (a, b) { return a.date < b.date ? -1 : 1; });

    // 全員の確定シフト（読むだけ）。紙のシフト表と同じ内容なので、名前と時間・ホール/キッチンだけ渡す
    var who = {};
    readTable('Staff').forEach(function (s) { who[s.staff_id] = s; });
    week.board = readTable('Shifts', function (r) { return String(r.period_id) === week.id; })
      .map(function (r) {
        var s = who[r.staff_id] || {};
        return {
          date: dateKey_(r.date), start: Number(r.start_min), end: Number(r.end_min), side: r.side,
          name: String(s.name || ''), leader: s.leader === true, hue: Number(s.color_hue) || 0,
          me: r.staff_id === me.staff_id
        };
      })
      .sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : a.start - b.start || a.end - b.end; });
    var notes = {};
    readTable('DayNotes').forEach(function (n) {
      var d = dateKey_(n.date);
      if (d >= week.startDate && d <= week.endDate && n.text) notes[d] = String(n.text);
    });
    week.notes = notes;
  }

  // いちばん新しい確定済みの週（画面で「シフトが確定しました」と知らせる）
  var pub = allWeeks.filter(function (r) { return r.status === 'published'; }).slice(-1)[0];
  var latestPublished = pub
    ? { id: String(pub.period_id), startDate: dateKey_(pub.start_date), endDate: dateKey_(pub.end_date) }
    : null;

  var weeks = allWeeks.map(function (r) {
    return { id: String(r.period_id), startDate: dateKey_(r.start_date), endDate: dateKey_(r.end_date), status: r.status };
  });

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
    week: week,
    weeks: weeks,
    latestPublished: latestPublished
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

/**
 * 招待コードで、LINEアカウントとスタッフを結びつける。
 *
 * 初回だけ。店長が口頭か個別LINEで伝えたコードを入れてもらう。
 * コードは総当たりを避けるため8桁英数。失敗は Log に残し、続けて失敗したら止める。
 *
 * @param p { inviteCode }
 */
function meLink(req, p) {
  if (DEV_MODE) throw apiError('devMode', '開発用モードでは紐付けは使いません');

  if (!req.idToken) throw apiError('noToken', 'LINEからログインしてください');
  var sub = verifyIdToken_(req.idToken);

  var code = String(p.inviteCode || '').trim().toUpperCase();
  if (!code) throw apiError('badCode', '招待コードを入れてください');

  // 立て続けの失敗を止める（同じLINEユーザーで5回まで）
  var cache = CacheService.getScriptCache();
  var key = 'link_ng_' + Utilities.base64Encode(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, sub));
  var ng = Number(cache.get(key) || 0);
  if (ng >= 5) {
    throw apiError('tooMany', '間違いが続いたので、しばらく待ってからお試しください');
  }

  var staff = readTable('Staff');

  // もう紐付いているなら、そのまま通す（コードを入れ直した人向け）
  var already = staff.filter(function (s) { return s.line_user_id === sub; })[0];
  if (already) return { staff: { id: already.staff_id, name: already.name }, already: true };

  var hit = staff.filter(function (s) {
    return s.active === true
      && String(s.invite_code || '').trim().toUpperCase() === code;
  })[0];

  if (!hit) {
    cache.put(key, String(ng + 1), 1800);           // 30分で忘れる
    appendRowTo('Log', {
      at: new Date(), type: 'error', staff_id: '',
      detail: '招待コードが一致しません（' + (ng + 1) + '回目）'
    });
    throw apiError('badCode', '招待コードが違います。店長に確認してください');
  }

  // 期限切れ
  if (hit.invite_expires_at) {
    var limit = new Date(dateKey_(hit.invite_expires_at) + 'T23:59:59');
    if (!isNaN(limit) && new Date() > limit) {
      throw apiError('expired', '招待コードの期限が切れています。店長に再発行してもらってください');
    }
  }

  // 書き込む：LINEユーザーIDを入れ、使った招待コードは消す
  var sh = sheetOf('Staff');
  var cols = keysOf('Staff');
  sh.getRange(hit._row, cols.indexOf('line_user_id') + 1).setValue(sub);
  sh.getRange(hit._row, cols.indexOf('invite_code') + 1).setValue('');
  invalidateTable('Staff');
  cache.remove(key);

  appendRowTo('Log', {
    at: new Date(), type: 'setup', staff_id: hit.staff_id, detail: 'LINEアカウントと紐付けました'
  });

  return { staff: { id: hit.staff_id, name: hit.name }, already: false };
}
