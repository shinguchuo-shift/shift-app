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
                  'Submissions', 'Requests', 'Demand', 'Rules', 'Shifts', 'DayNotes',
                  'Holidays', 'BusyPeriods']);

  requireManager(req);

  var st = readSettings();
  var levelHours = levelHoursOf_(st);

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
      // スタッフレベル（1 半人前／2 一人前／3 ベテラン）。空なら一人前
      level: Number(s.staff_level) || 2,
      // 1日の勤務時間（分）。スタッフの欄が空ならレベルの既定
      dayMin: dayLenOfStaff_(s, levelHours).min,
      dayMax: dayLenOfStaff_(s, levelHours).max,
      dayHours: String(s.day_hours || ''),
      ng: String(s.ng_staff_ids || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean),
      colorHue: Number(s.color_hue) || 0,
      memo: s.memo || ''
    };
  });

  // 希望。月の希望をもとにし、週を出した人だけ週の内容で置きかえる（2026-11-17 オーナー要望）
  //  - 週を出した人   → 週の希望（source='week'）
  //  - 週を出していないが、その日が入る月の希望を出した人 → 月の希望（source='month'）
  //  - どちらも出していない人 → 未提出
  var latestOf = function (pid, staffFilter) {           // { staffId: { date: {start,end} } }（最新 rev）
    var out = {}, latest = {};
    readTable('Requests', function (r) { return String(r.period_id) === pid && r.active !== false; })
      .forEach(function (r) {
        var k = r.staff_id + '/' + dateKey_(r.date);
        var rev = Number(r.rev) || 1;
        if (latest[k] !== undefined && latest[k] >= rev) return;
        latest[k] = rev;
        if (!out[r.staff_id]) out[r.staff_id] = {};
        out[r.staff_id][dateKey_(r.date)] = { start: Number(r.start_min), end: Number(r.end_min) };
      });
    return out;
  };
  var subsOf = function (pid) {
    var out = {};
    readTable('Submissions', function (r) { return String(r.period_id) === pid; })
      .forEach(function (r) { out[r.staff_id] = { method: r.method, at: r.updated_at }; });
    return out;
  };

  var weekReq = latestOf(want);
  var weekSub = subsOf(want);

  // この週の日付と、その日が入る月（週が月をまたぐときは日ごとに違う月）
  var wk0 = new Date(dateKey_(period.start_date) + 'T00:00:00');
  var weekDates = [];
  for (var wi = 0; wi < 7; wi++) {
    var wd = new Date(wk0.getTime()); wd.setDate(wd.getDate() + wi); weekDates.push(dateKey_(wd));
  }
  var months = readTable('Periods', function (r) { return r.kind === 'month'; });
  var monthOf = function (date) {
    return months.filter(function (m) { return dateKey_(m.start_date) <= date && date <= dateKey_(m.end_date); })[0];
  };
  var monthData = {};                                     // monthId → { req, sub }
  weekDates.forEach(function (date) {
    var m = monthOf(date);
    if (m && !monthData[m.period_id]) {
      monthData[m.period_id] = { req: latestOf(String(m.period_id)), sub: subsOf(String(m.period_id)) };
    }
  });

  var requests = {}, submissions = {};
  readTable('Staff').forEach(function (s) {
    var id = s.staff_id;
    // 週を「変更あり」で出した人は、週の希望をそのまま使う
    if (weekSub[id] && weekSub[id].method !== 'usual') {
      requests[id] = weekReq[id] || {};
      submissions[id] = { method: weekSub[id].method, at: weekSub[id].at, source: 'week' };
      return;
    }
    var got = {}, from = null;
    weekDates.forEach(function (date) {
      var m = monthOf(date);
      var md = m && monthData[m.period_id];
      if (!md || !md.sub[id]) return;
      from = from || md.sub[id];
      var r = (md.req[id] || {})[date];
      if (r) got[date] = r;
    });
    // 週を「このまま（いつも通り）」で出した人は、月の希望そのものを使う。
    // 以前は月をまたぐ週で12月分が抜けたまま出されていたので、出された中身ではなく月の希望を見る
    if (weekSub[id]) {
      requests[id] = from ? got : (weekReq[id] || {});
      submissions[id] = { method: weekSub[id].method, at: weekSub[id].at, source: 'week' };
      return;
    }
    if (from) {
      requests[id] = got;
      submissions[id] = { method: 'month', at: from.at, source: 'month' };
    }
  });

  // 必要人数は、営業時間の刻み（スロット）ごとの配列にそろえる。
  // 30分の行が無い時刻は、その前の時刻の人数を引き継ぐ（1時間ごとの表のままでも30分刻みで使える）
  var grid0 = Number(st.grid_min) || 60;
  var open0 = Number(st.open_min) || 600, close0 = Number(st.close_min) || 1440;
  var demandRows = readTable('Demand');
  var tableOf = function (dt) {
    var rows = demandRows.filter(function (r) { return r.day_type === dt; })
      .sort(function (a, b) { return Number(a.start_min) - Number(b.start_min); });
    if (!rows.length) return null;
    var t = { hall: [], kitchen: [] };
    for (var m = open0; m < close0; m += grid0) {
      var hit = null;
      rows.forEach(function (r) { if (Number(r.start_min) <= m) hit = r; });
      t.hall.push(hit ? Number(hit.hall) || 0 : 0);
      t.kitchen.push(hit ? Number(hit.kitchen) || 0 : 0);
    }
    return t;
  };
  var demand = { weekday: tableOf('weekday') || { hall: [], kitchen: [] } };
  demand.weekend = tableOf('weekend') || demand.weekday;
  // 祝日の行がまだ無いシートでは、土日の表を使う
  demand.holiday = tableOf('holiday') || demand.weekend;

  // 祝日（日付 → 名前）
  var holidays = {};
  readTable('Holidays').forEach(function (r) {
    if (r.date !== '' && r.date !== undefined) holidays[dateKey_(r.date)] = String(r.name || '祝日');
  });

  // 繁忙期
  var busy = readTable('BusyPeriods', function (r) { return r.start_date !== '' && r.end_date !== ''; })
    .map(function (r) {
      return {
        name: String(r.name || '繁忙期'),
        start: dateKey_(r.start_date), end: dateKey_(r.end_date),
        hall: Number(r.hall) || 0, kitchen: Number(r.kitchen) || 0,
        ranges: parseHourRanges_(r.hours),
        hours: String(r.hours || '')
      };
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
    var key = dateKey_(d);
    days.push({
      date: key, dow: i,
      label: (d.getMonth() + 1) + '/' + d.getDate(),
      wd: ['月', '火', '水', '木', '金', '土', '日'][i],
      // 祝日は土日より優先する（日曜の祝日も「祝日」の表）
      dayType: holidays[key] ? 'holiday' : (i >= 5 ? 'weekend' : 'weekday'),
      holiday: holidays[key] || ''
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
      duties: DUTIES,
      staffLevels: STAFF_LEVELS,
      levelHours: levelHours
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
    demand: demand, busy: busy, rules: rules, ruleLevels: ruleLevels, ruleLabels: ruleLabels,
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
  var monthExists = existing.some(function (r) { return String(r.period_id) === monthId; });

  var st = readSettings();
  var time = hhmmOf_(st.deadline_time);
  var extra = [];
  if (!monthExists) {
    // 月の暫定。〆切は前月末
    var monthDeadline = p.monthDeadline || (fmtDate_(new Date(year, mon - 1, 0)) + ' ' + time);
    extra.push([monthId, 'month', '', fmtDate_(first), fmtDate_(last), monthDeadline, 'open', 1]);
  }
  var weekRows = missingWeekRows_(monthId, existing, st);
  var weeks = weekRows.map(function (r) { return r[0]; });

  // 月も週もそろっているなら、作るものは無い
  if (monthExists && !weeks.length) throw apiError('exists', monthId + ' はもう作られています');

  // 期間シートは書き直さず、下に行を足す
  appendRowsByHeader_('Periods', extra.concat(weekRows).map(function (w) {
    var o = {}; keysOf('Periods').forEach(function (k, i) { o[k] = w[i]; }); return o;
  }));

  appendRowTo('Log', {
    at: new Date(), type: 'publish', staff_id: '',
    detail: monthId + (monthExists ? ' の足りない週を作りました' : ' を開きました') + '（週 ' + weeks.length + '件）'
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

/**
 * 繁忙期の「時間帯」を分の組にする。
 *   '11-14,17-20' → [[660,840],[1020,1200]]
 *   '11:30-14' や全角・「〜」も読む。空なら []（＝一日中）
 */
function parseHourRanges_(text) {
  var t = String(text || '')
    .replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
    .replace(/[〜～ー－−—]/g, '-').replace(/[、，\s]+/g, ',').replace(/：/g, ':');
  var toMin = function (x) {
    var m = String(x).match(/^(\d{1,2})(?::(\d{2}))?$/);
    return m ? Number(m[1]) * 60 + Number(m[2] || 0) : NaN;
  };
  return t.split(',').filter(Boolean).map(function (part) {
    var ab = part.split('-');
    return [toMin(ab[0]), toMin(ab[1])];
  }).filter(function (r) { return isFinite(r[0]) && isFinite(r[1]) && r[1] > r[0]; });
}

/**
 * その月の週のうち、まだ無いものの行を返す（期間シートの列の並び）。
 * 週は「月曜がその月に入っている週」。11月なら 11/2・9・16・23・30 の5週。
 * 〆切は、その週が始まる前の設定曜日（既定は木曜）。
 */
function missingWeekRows_(monthId, existing, st) {
  var m = String(monthId).match(/^(\d{4})-(\d{2})$/);
  if (!m) return [];
  var year = Number(m[1]), mon = Number(m[2]);
  var last = new Date(year, mon, 0);
  var dow = Number(st.deadline_dow);               // 0=月 … 6=日
  var time = hhmmOf_(st.deadline_time);
  var have = {};
  existing.forEach(function (r) { have[String(r.period_id)] = true; });

  var d = new Date(year, mon - 1, 1);
  d.setDate(d.getDate() + ((7 - ((d.getDay() + 6) % 7)) % 7));   // その月の最初の月曜まで進める
  var rows = [];
  while (d <= last) {
    var start = new Date(d.getTime());
    var end = new Date(d.getTime()); end.setDate(end.getDate() + 6);
    var dl = new Date(start.getTime());
    dl.setDate(dl.getDate() - (7 - (isNaN(dow) ? 3 : dow)));
    var wid = fmtDate_(start);
    if (!have[wid]) rows.push([wid, 'week', monthId, fmtDate_(start), fmtDate_(end), fmtDate_(dl) + ' ' + time, 'draft', 1]);
    d.setDate(d.getDate() + 7);
  }
  return rows;
}

/**
 * レベルごとの1日の勤務時間（分）。設定シートの day_min_h_1 / day_max_h_1 … から読む。
 * 無ければ全体の min_shift_min / max_shift_min（3〜8時間）。
 */
function levelHoursOf_(st) {
  var defMin = Number(st.min_shift_min) || 180, defMax = Number(st.max_shift_min) || 480;
  var out = {};
  [1, 2, 3].forEach(function (lv) {
    var mn = Number(st['day_min_h_' + lv]) * 60 || defMin;
    var mx = Number(st['day_max_h_' + lv]) * 60 || defMax;
    out[lv] = { min: mn, max: Math.max(mn, mx) };
  });
  return out;
}

/**
 * スタッフの1日の勤務時間（分）。「1日の勤務時間」の欄に「5」なら5時間ちょうど、「4-6」なら4〜6時間。
 * 空や読めない値ならレベルの既定。
 */
function dayLenOfStaff_(s, levelHours) {
  var def = levelHours[Number(s.staff_level) || 2] || levelHours[2];
  var t = String(s.day_hours === undefined ? '' : s.day_hours)
    .replace(/[０-９．]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
    .replace(/[〜～ー－−—]/g, '-').replace(/時間|h/gi, '').trim();
  var m = t.match(/^(\d+(?:\.\d+)?)(?:\s*-\s*(\d+(?:\.\d+)?))?$/);
  if (!m) return def;
  var a = Number(m[1]), b = m[2] ? Number(m[2]) : a;
  if (!(a > 0 && a <= 24 && b >= a && b <= 24)) return def;
  return { min: Math.round(a * 60), max: Math.round(b * 60) };
}

/**
 * 必要人数を保存する。シートは書き直さず、今ある行の数字だけを直す（無い行は下に足す）。
 * @param p { demand: { weekday|weekend|holiday: { hall: [..], kitchen: [..] } } }  配列は営業開始からの1時間ごと
 */
function mgrSaveDemand(req, p) {
  requireManager(req);
  var d = p.demand || {};
  var st = readSettings();
  var grid = Number(st.grid_min) || 60;
  var openMin = Number(st.open_min) || 480;

  var sh = sheetOf('Demand');
  var header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(function (h) { return String(h).trim(); });
  var colOf = function (k) { return header.indexOf(headerOf('Demand')[keysOf('Demand').indexOf(k)]) + 1; };
  var cHall = colOf('hall'), cKitchen = colOf('kitchen');
  if (!cHall || !cKitchen) throw apiError('badSheet', '必要人数シートの見出しが見つかりません');

  var rows = readTable('Demand');
  var add = [], changed = 0;
  ['weekday', 'weekend', 'holiday'].forEach(function (dt) {
    var t = d[dt];
    if (!t) return;
    (t.hall || []).forEach(function (_, i) {
      var min = openMin + i * grid;
      var h = Math.max(0, Math.round(Number(t.hall[i]) || 0));
      var k = Math.max(0, Math.round(Number((t.kitchen || [])[i]) || 0));
      var row = rows.filter(function (r) { return r.day_type === dt && Number(r.start_min) === min; })[0];
      if (row) {
        if (Number(row.hall) !== h) { sh.getRange(row._row, cHall).setValue(h); changed++; }
        if (Number(row.kitchen) !== k) { sh.getRange(row._row, cKitchen).setValue(k); changed++; }
      } else {
        add.push({ day_type: dt, start_min: min, hall: h, kitchen: k });
      }
    });
  });
  appendRowsByHeader_('Demand', add);
  invalidateTable('Demand');
  return { changed: changed, added: add.length };
}
