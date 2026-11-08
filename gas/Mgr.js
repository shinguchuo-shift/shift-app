/**
 * 店長用の action。
 * docs/03_screens-and-api.md「店長用」参照。
 */

/** 店長画面に必要なデータを一度に返す（往復回数を減らすため）。 */
function mgrLoad(req, p) {
  var _t0 = Date.now();
  // この画面で要るシートを、通信1回でまとめて読む。
  // 1枚ずつ読むと10枚で3秒ほどかかる（docs/03「速さについて」）。
  prefetchTables(['Settings', 'Staff', 'Periods',
                  'Submissions', 'Requests', 'Demand', 'Rules', 'Shifts', 'DayNotes']);

  requireManager(req);

  var st = readSettings();

  // 週の一覧（新しい順）。画面の切り替えに使う
  var allWeeks = readTable('Periods', function (r) { return (r.kind || 'week') === 'week'; })
    .sort(function (a, b) { return dateKey_(a.start_date) < dateKey_(b.start_date) ? 1 : -1; });

  var period;
  if (p.periodId) {
    period = allWeeks.filter(function (r) { return String(r.period_id) === String(p.periodId); })[0];
  } else {
    // 指定が無ければ、受付中 → 締切後 → それ以外 の順でいちばん手前の週
    period = allWeeks.filter(function (r) { return r.status === 'open'; })[0]
          || allWeeks.filter(function (r) { return r.status === 'closed'; })[0]
          || allWeeks[0];
  }
  if (!period) throw apiError('noPeriod', '対象週がありません。「新しい月を開く」で作ってください');

  var periodId = String(period.period_id);
  var want = periodId;

  // スタッフ
  var staff = readTable('Staff', function (r) { return r.active === true; }).map(function (s) {
    return {
      id: s.staff_id, name: s.name, type: s.type, role: s.role,
      capMin: Number(s.weekly_cap_min) || 0,
      leader: s.leader === true, closer: s.closer === true,
      duty: s.duty || 'both',
      ng: String(s.ng_staff_ids || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean),
      colorHue: Number(s.color_hue) || 0,
      memo: s.memo || ''
    };
  });

  // 希望（最新 rev だけを採る）
  var requests = {}, latest = {};
  readTable('Requests', function (r) { return String(r.period_id) === want && r.active !== false; })
    .forEach(function (r) {
      var k = r.staff_id + '/' + dateKey_(r.date);
      var rev = Number(r.rev) || 1;
      if (latest[k] !== undefined && latest[k] >= rev) return;
      latest[k] = rev;
      if (!requests[r.staff_id]) requests[r.staff_id] = {};
      requests[r.staff_id][dateKey_(r.date)] = {
        start: Number(r.start_min), end: Number(r.end_min)
      };
    });

  var submissions = {};
  readTable('Submissions', function (r) { return String(r.period_id) === want; })
    .forEach(function (r) { submissions[r.staff_id] = { method: r.method, at: r.updated_at }; });

  // 必要人数
  var demand = { weekday: { hall: [], kitchen: [] }, weekend: { hall: [], kitchen: [] } };
  readTable('Demand').sort(function (a, b) { return a.start_min - b.start_min; })
    .forEach(function (r) {
      if (!demand[r.day_type]) return;
      demand[r.day_type].hall.push(Number(r.hall) || 0);
      demand[r.day_type].kitchen.push(Number(r.kitchen) || 0);
    });

  var rules = {}, ruleLevels = {}, ruleLabels = {};
  readTable('Rules').forEach(function (r) {
    rules[r.rule_key] = r.enabled === true;
    ruleLevels[r.rule_key] = r.level || 'error';
    ruleLabels[r.rule_key] = r.label || r.rule_key;
  });

  var shifts = readTable('Shifts', function (r) { return String(r.period_id) === want; })
    .map(function (r) {
      return {
        date: dateKey_(r.date), staffId: r.staff_id, side: r.side,
        start: Number(r.start_min), end: Number(r.end_min), source: r.source
      };
    });

  var notes = {};
  readTable('DayNotes').forEach(function (r) { notes[dateKey_(r.date)] = r.text; });

  // 曜日と日付（月曜始まり）
  var days = [];
  // シリアル値で返ることがあるので、必ず dateKey_() を通してから Date にする
  var d0 = new Date(dateKey_(period.start_date) + 'T00:00:00');
  for (var i = 0; i < 7; i++) {
    var d = new Date(d0.getTime());
    d.setDate(d.getDate() + i);
    days.push({
      date: dateKey_(d), dow: i,
      label: (d.getMonth() + 1) + '/' + d.getDate(),
      wd: ['月', '火', '水', '木', '金', '土', '日'][i],
      dayType: i >= 5 ? 'weekend' : 'weekday'
    });
  }

  var grid = Number(st.grid_min) || 60;
  var openMin = Number(st.open_min) || 600;
  var closeMin = Number(st.close_min) || 1440;
  var slots = [];
  for (var m = openMin; m < closeMin; m += grid) slots.push(m);

  return {
    settings: {
      storeName: st.store_name || '', grid: grid,
      openMin: openMin, closeMin: closeMin,
      axisStart: Number(st.sheet_axis_start_min) || 480,
      axisEnd: Number(st.sheet_axis_end_min) || 1440,
      lanes: Number(st.sheet_lanes) || 12,
      minLen: Number(st.min_shift_min) || 180,
      maxLen: Number(st.max_shift_min) || 480,
      weekendPeakBoost: Number(st.weekend_peak_boost) || 0,
      peaks: String(st.peak_ranges || '').split(',').filter(Boolean).map(function (x) {
        var a = x.split('-'); return [Number(a[0]), Number(a[1])];
      }),
      footerNote: st.footer_note || '',
      // 区分ごとの終了上限（高校生は22時）。自動作成とチェックの両方で使う
      typeEndLimit: TYPE_END_LIMIT,
      staffTypes: STAFF_TYPES,
      duties: DUTIES
    },
    period: {
      id: want, startDate: dateKey_(period.start_date), endDate: dateKey_(period.end_date),
      status: period.status, revision: Number(period.revision) || 1,
      monthId: period.parent_id ? String(period.parent_id) : ''
    },
    // 画面の「対象週」切り替え用
    weeks: allWeeks.map(function (r) {
      return {
        id: String(r.period_id),
        startDate: dateKey_(r.start_date), endDate: dateKey_(r.end_date),
        status: r.status, monthId: r.parent_id ? String(r.parent_id) : ''
      };
    }),
    days: days, slots: slots,
    staff: staff, requests: requests, submissions: submissions,
    demand: demand, rules: rules, ruleLevels: ruleLevels, ruleLabels: ruleLabels,
    shifts: shifts, notes: notes,
    // 開発中の切り分け用。Phase 3 で消す
    _debug: { serverMs: Date.now() - _t0, prefetch: _lastPrefetch }
  };
}

/** 叩き台・手直し結果を丸ごと保存する。 */
function mgrSaveShifts(req, p) {
  requireManager(req);
  var want = dateKey_(p.periodId || PERIOD_ID);

  // 楽観ロック：別の端末で先に保存されていたら上書きしない
  var sh = sheetOf('Periods');
  var periods = readTable('Periods', function (r) { return dateKey_(r.period_id) === want; });
  var period = periods[0];
  if (!period) throw apiError('noPeriod', '対象週が見つかりません');

  var now = Number(period.revision) || 1;
  if (p.revision !== undefined && Number(p.revision) !== now) {
    throw apiError('conflict', '別の端末で変更されています。読み込み直してください');
  }

  // 対象週以外の行は残す
  var keep = readTable('Shifts', function (r) { return dateKey_(r.period_id) !== want; });
  var head = keysOf('Shifts');
  var rows = keep.map(function (r) { return head.map(function (k) { return r[k]; }); });

  var at = new Date();
  (p.shifts || []).forEach(function (s) {
    rows.push([want, s.date, s.staffId, s.side, s.start, s.end, s.source || 'auto', at]);
  });
  writeTable('Shifts', head, rows);

  // revision を進める
  var col = keysOf('Periods').indexOf('revision') + 1;
  sh.getRange(period._row, col).setValue(now + 1);

  return { saved: (p.shifts || []).length, revision: now + 1 };
}

/** ルールの ON/OFF を保存する。 */
function mgrSaveRules(req, p) {
  requireManager(req);
  var rows = readTable('Rules').map(function (r) {
    var v = p.rules && p.rules[r.rule_key];
    return [r.rule_key, v === undefined ? r.enabled : !!v, r.level, r.label];
  });
  writeTable('Rules', rows);
  return { saved: rows.length };
}

/** 備考を保存する。 */
function mgrSaveNote(req, p) {
  requireManager(req);
  var key = dateKey_(p.date);
  var rows = readTable('DayNotes')
    .filter(function (r) { return dateKey_(r.date) !== key; })
    .map(function (r) { return [r.date, r.text]; });
  if (p.text) rows.push([key, p.text]);
  writeTable('DayNotes', rows);
  return { saved: true };
}

/** 確定。シフト表シートを出して status を published にする。 */
function mgrPublish(req, p) {
  requireManager(req);
  var want = dateKey_(p.periodId || PERIOD_ID);
  var out = buildShiftSheet(want);

  var sh = sheetOf('Periods');
  var period = readTable('Periods', function (r) { return dateKey_(r.period_id) === want; })[0];
  sh.getRange(period._row, keysOf('Periods').indexOf('status') + 1).setValue('published');

  appendRowTo('Log', {
    at: new Date(), type: 'publish', staff_id: '', detail: out.getName()
  });

  return { sheet: out.getName(), overflow: out.overflow || [] };
}

/**
 * 新しい月を開く。月の暫定と、その月に含まれる週（月〜日）をまとめて作る。
 *
 * 毎月これを押せば、スタッフの画面に「12月分の暫定を出してください」が出る。
 * 手でシートに行を足す運用にすると、状態の書き間違いや親IDのずれで壊れるので、必ずここを通す。
 *
 * @param p { month: '2026-12', monthDeadline?: 'YYYY-MM-DD HH:MM' }
 */
function mgrOpenPeriod(req, p) {
  requireManager(req);

  var m = String(p.month || '').match(/^(\d{4})-(\d{2})$/);
  if (!m) throw apiError('badMonth', '月は 2026-12 の形で指定してください');
  var year = Number(m[1]), mon = Number(m[2]);

  var monthId = p.month;
  var first = new Date(year, mon - 1, 1);
  var last = new Date(year, mon, 0);               // 月末（0日＝前月の最終日）

  var existing = readTable('Periods');
  if (existing.some(function (r) { return String(r.period_id) === monthId; })) {
    throw apiError('exists', monthId + ' はもう作られています');
  }

  var st = readSettings();
  var dow = Number(st.deadline_dow);               // 0=月 … 6=日
  // deadline_time は '23:59' と書いてあっても、シートが時刻型に変換して Date で返すことがある
  var time = hhmmOf_(st.deadline_time);

  var rows = existing.map(function (r) {
    return keysOf('Periods').map(function (k) {
      if (k === 'start_date' || k === 'end_date') return dateKey_(r[k]);
      return r[k];
    });
  });

  // 月の暫定。〆切は前月末
  var monthDeadline = p.monthDeadline || (fmtDate_(new Date(year, mon - 1, 0)) + ' ' + time);
  rows.push([monthId, 'month', '', fmtDate_(first), fmtDate_(last), monthDeadline, 'open', 1]);

  // その月に「月曜」がある週をすべて作る（月初の週は前月から始まることがある）
  var weeks = [];
  var d = new Date(first.getTime());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));   // その週の月曜まで戻す
  while (d <= last) {
    var start = new Date(d.getTime());
    var end = new Date(d.getTime());
    end.setDate(end.getDate() + 6);

    // 〆切は、その週が始まる前の設定曜日
    var dl = new Date(start.getTime());
    dl.setDate(dl.getDate() - (7 - (isNaN(dow) ? 3 : dow)));

    var wid = fmtDate_(start);
    if (!existing.some(function (r) { return String(r.period_id) === wid; })) {
      rows.push([wid, 'week', monthId, fmtDate_(start), fmtDate_(end),
                 fmtDate_(dl) + ' ' + time, 'draft', 1]);
      weeks.push(wid);
    }
    d.setDate(d.getDate() + 7);
  }

  writeTable('Periods', rows);

  appendRowTo('Log', {
    at: new Date(), type: 'publish', staff_id: '',
    detail: monthId + ' を開きました（週 ' + weeks.length + '件）'
  });

  return { monthId: monthId, weeks: weeks };
}

/** 週の受付を開ける／締める。 */
function mgrSetStatus(req, p) {
  requireManager(req);
  var want = String(p.periodId);
  var period = readTable('Periods', function (r) { return String(r.period_id) === want; })[0];
  if (!period) throw apiError('noPeriod', '期間が見つかりません');

  var ok = { draft: 1, open: 1, closed: 1, published: 1 };
  if (!ok[p.status]) throw apiError('badStatus', '知らない状態です: ' + p.status);

  sheetOf('Periods').getRange(period._row, keysOf('Periods').indexOf('status') + 1)
    .setValue(toSheetValue('Periods', 'status', p.status));
  return { periodId: want, status: p.status };
}

/**
 * '23:59' の形に揃える。
 * 設定シートに '23:59' と書いてあっても、スプレッドシートが時刻型に変換して
 * Date で返してくることがあるため、どちらでも受けられるようにする。
 */
function hhmmOf_(v) {
  if (v instanceof Date) {
    return ('0' + v.getHours()).slice(-2) + ':' + ('0' + v.getMinutes()).slice(-2);
  }
  var m = String(v == null ? '' : v).match(/(\d{1,2}):(\d{2})/);
  return m ? ('0' + m[1]).slice(-2) + ':' + m[2] : '23:59';
}
