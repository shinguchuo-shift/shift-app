/**
 * アプリの更新に合わせて、今あるスプレッドシートを新しい形に直す。
 * メニュー「シフトアプリ」→「アプリの更新に合わせてシートを直す」から実行する。
 * 何回実行しても同じ結果になる（済んでいるところは飛ばす）。行は消さない。
 *
 * 2026-11-15 の更新：
 *  - スタッフの「担当業務」を「ホールのスキル」「キッチンのスキル」（0〜3段階）に分ける
 *  - 必要人数に「祝日」の行を足す（はじめは土日と同じ人数）
 *  - 「祝日」シート（2026〜2027年の祝日入り）と「繁忙期」シートを作る
 *  - ルールの説明文をスキル段階に合わせる
 */

/** ルールの説明文（2026-11-15 前半：スキル段階のとき）。 */
var RULE_LABELS_V2 = {
  peak3: 'ピーク帯はホール・キッチンそれぞれレベル2以上の人を1人以上',
  rookie: 'レベル1の人は、同じ側にレベル2以上がいる時間にだけ入れる'
};

/** ルールの説明文（いま：担当業務＋スタッフレベル）。 */
var RULE_LABELS_V3 = {
  peak3: 'ピーク帯はホール・キッチンそれぞれ一人前以上の人を1人以上',
  rookie: '研修中・半人前の人は、同じ側に一人前以上がいる時間にだけ入れる'
};

/** 以前の説明文。これと同じなら新しい説明文に置き換える。 */
var RULE_LABELS_V1 = {
  peak3: 'ピーク帯はホール・キッチンそれぞれ研修中でない人を1人以上',
  rookie: '研修中の人を1人きりにしない'
};

/** 日本の祝日（2026〜2027年）。春分・秋分は国立天文台の暦要項による。 */
var HOLIDAYS_JP = [
  ['2026-01-01', '元日'], ['2026-01-12', '成人の日'], ['2026-02-11', '建国記念の日'],
  ['2026-02-23', '天皇誕生日'], ['2026-03-20', '春分の日'], ['2026-04-29', '昭和の日'],
  ['2026-05-03', '憲法記念日'], ['2026-05-04', 'みどりの日'], ['2026-05-05', 'こどもの日'],
  ['2026-05-06', '振替休日'], ['2026-07-20', '海の日'], ['2026-08-11', '山の日'],
  ['2026-09-21', '敬老の日'], ['2026-09-22', '国民の休日'], ['2026-09-23', '秋分の日'],
  ['2026-10-12', 'スポーツの日'], ['2026-11-03', '文化の日'], ['2026-11-23', '勤労感謝の日'],
  ['2027-01-01', '元日'], ['2027-01-11', '成人の日'], ['2027-02-11', '建国記念の日'],
  ['2027-02-23', '天皇誕生日'], ['2027-03-21', '春分の日'], ['2027-03-22', '振替休日'],
  ['2027-04-29', '昭和の日'], ['2027-05-03', '憲法記念日'], ['2027-05-04', 'みどりの日'],
  ['2027-05-05', 'こどもの日'], ['2027-07-19', '海の日'], ['2027-08-11', '山の日'],
  ['2027-09-20', '敬老の日'], ['2027-09-23', '秋分の日'], ['2027-10-11', 'スポーツの日'],
  ['2027-11-03', '文化の日'], ['2027-11-23', '勤労感謝の日']
];

/** その列を、シートの最終行まで「書式なしテキスト」にする（'11-14' が日付に化けないように）。 */
function textWholeColumn_(key, col) {
  var sh = sheetOf(key);
  var i = keysOf(key).indexOf(col);
  if (i >= 0) sh.getRange(1, i + 1, sh.getMaxRows(), 1).setNumberFormat('@');
}

/** 本体。やったことの一覧を返す。 */
function migrateV2() {
  var done = [];
  var ss = book();

  // 1. スタッフ：担当業務（ホール/キッチン/両方/研修中）＋スタッフレベル（1〜3）＋1日の勤務時間
  //    シートは書き直さず、列の見出しと中身をその場で直す・列を差し込むだけ。ほかの列には触らない
  var staffSh = ss.getSheetByName(tabOf('Staff'));
  if (staffSh) done = done.concat(migrateStaffColumns_(staffSh));

  // 2. 必要人数：祝日の行（はじめは土日と同じ）
  var demand = readTable('Demand');
  if (!demand.some(function (r) { return r.day_type === 'holiday'; })) {
    // 下に行を足すだけ（シートは書き直さない）。「08:00」が時刻に変わらないよう書式なしテキストで入れる
    appendRowsByHeader_('Demand', demand.filter(function (r) { return r.day_type === 'weekend'; })
      .map(function (r) { return { day_type: 'holiday', start_min: r.start_min, hall: r.hall, kitchen: r.kitchen }; }));
    done.push('必要人数：祝日の行を足しました（土日と同じ人数。あとで直してください）');
  }

  // 3. 祝日シート
  if (!ss.getSheetByName(tabOf('Holidays'))) {
    writeTable('Holidays', HOLIDAYS_JP);
    done.push('祝日シートを作りました（2026〜2027年の祝日入り）');
  }

  // 4. 繁忙期シート
  if (!ss.getSheetByName(tabOf('BusyPeriods'))) {
    writeTable('BusyPeriods', []);
    textWholeColumn_('BusyPeriods', 'hours');
    done.push('繁忙期シートを作りました（空。期間と増やす人数を書いてください）');
  }

  // 5. ルールの説明文
  var rulesSh = ss.getSheetByName(tabOf('Rules'));
  if (rulesSh) {
    var cols = keysOf('Rules');
    var changed = 0;
    readTable('Rules').forEach(function (r) {
      // 古い説明文のままの行だけ直す（店長が自分で書き換えた説明は触らない）
      var want = RULE_LABELS_V3[r.rule_key];
      if (want && r.label !== want && (RULE_LABELS_V1[r.rule_key] === r.label || RULE_LABELS_V2[r.rule_key] === r.label)) {
        rulesSh.getRange(r._row, cols.indexOf('label') + 1).setValue(want);
        changed++;
      }
    });
    if (changed) { invalidateTable('Rules'); done.push('ルールの説明文を新しくしました（' + changed + '件）'); }
  }

  // 6. 月はあるのに週が足りない（はじめのサンプルは1週だけだった）。対象週のプルダウンで全部の週を選べるようにする
  var periods = readTable('Periods');
  var stt = readSettings();
  var addWeeks = [];
  periods.filter(function (r) { return r.kind === 'month'; }).forEach(function (r) {
    addWeeks = addWeeks.concat(missingWeekRows_(String(r.period_id), periods.concat(addWeeks.map(function (w) {
      return { period_id: w[0] };
    })), stt));
  });
  if (addWeeks.length) {
    appendRowsByHeader_('Periods', addWeeks.map(function (w) {
      var o = {}; keysOf('Periods').forEach(function (k, i) { o[k] = w[i]; }); return o;
    }));
    done.push('期間：足りない週を作りました（' + addWeeks.map(function (w) { return w[0]; }).join('、') + '）');
  }

  // 7. 設定：レベルごとの1日の勤務時間（はじめは今までと同じ3〜8時間）
  var have = {};
  readTable('Settings').forEach(function (r) { have[r.key] = true; });
  var addSet = [];
  [[1, '半人前'], [2, '一人前'], [3, 'ベテラン']].forEach(function (x) {
    if (!have['day_min_h_' + x[0]]) addSet.push({ key: 'day_min_h_' + x[0], value: 3, note: x[1] + 'の1日の勤務時間の最短（時間）' });
    if (!have['day_max_h_' + x[0]]) addSet.push({ key: 'day_max_h_' + x[0], value: 8, note: x[1] + 'の1日の勤務時間の最長（時間）。最短と同じにすると固定' });
  });
  if (addSet.length) {
    appendRowsByHeader_('Settings', addSet);
    done.push('設定：レベルごとの1日の勤務時間を足しました（はじめはどれも3〜8時間）');
  }

  // 8. 30分単位（2026-11-16 オーナー要望）：刻みを30分にし、必要人数に30分の行を足す
  done = done.concat(migrateTo30_());

  // 直したときだけログに残す
  if (done.length) {
    appendRowTo('Log', { at: new Date(), type: 'setup', staff_id: '', detail: 'シートを更新：' + done.join(' / ') });
  }
  return done;
}

/** メニューから呼ぶ。 */
function menuMigrate() {
  var ui = SpreadsheetApp.getUi();
  var done = migrateV2();
  ui.alert('シートを直しました',
    done.length ? done.map(function (x) { return '・' + x; }).join('\n')
                : 'もう新しい形になっています。直すところはありませんでした。',
    ui.ButtonSet.OK);
}

/** スキルの欄（'2 一人でできる' や 2 や '入らない'）を数にする。 */
function skillNum_(v) {
  var m = String(v === undefined ? '' : v).match(/\d/);
  return m ? Number(m[0]) : 0;
}

/**
 * スタッフシートの列を「担当業務・スタッフレベル・1日の勤務時間」にそろえる。
 * 列の差し込みと、その列の中身の書き換えだけを行う。
 */
function migrateStaffColumns_(sh) {
  var done = [];
  var head = function () {
    return sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(function (h) { return String(h).trim(); });
  };
  var h = head();
  var last = sh.getLastRow();
  var n = Math.max(last - 1, 0);
  var idCol = h.indexOf('スタッフID') + 1;
  var ids = (n && idCol) ? sh.getRange(2, idCol, n, 1).getValues() : [];
  var blank = function (i) { return !ids[i] || String(ids[i][0]).trim() === ''; };

  // A. ホールのスキル・キッチンのスキル（0〜3）→ 担当業務・スタッフレベル（同じ2列を書き換える）
  var ch = h.indexOf('ホールのスキル') + 1, ck = h.indexOf('キッチンのスキル') + 1;
  if (ch && ck && h.indexOf('担当業務') < 0) {
    var hv = n ? sh.getRange(2, ch, n, 1).getValues() : [];
    var kv = n ? sh.getRange(2, ck, n, 1).getValues() : [];
    var duty = [], level = [];
    for (var i = 0; i < n; i++) {
      if (blank(i)) { duty.push(['']); level.push(['']); continue; }
      var a = skillNum_(hv[i][0]), b = skillNum_(kv[i][0]);
      var d = (a >= 1 && b >= 1) ? ((a === 1 && b === 1) ? 'trainee' : 'both')
            : a >= 1 ? 'hall' : b >= 1 ? 'kitchen' : 'both';
      var lv = d === 'trainee' ? 1 : Math.min(3, Math.max(1, Math.max(a, b)));
      duty.push([toSheetValue('Staff', 'duty', d)]);
      level.push([toSheetValue('Staff', 'staff_level', lv)]);
    }
    sh.getRange(1, ch, sh.getMaxRows(), 1).clearDataValidations();
    sh.getRange(1, ck, sh.getMaxRows(), 1).clearDataValidations();
    sh.getRange(1, ch).setValue('担当業務');
    sh.getRange(1, ck).setValue('スタッフレベル');
    if (n) { sh.getRange(2, ch, n, 1).setValues(duty); sh.getRange(2, ck, n, 1).setValues(level); }
    done.push('スタッフ：スキルの2列を「担当業務」「スタッフレベル」に直しました');
    h = head();
  }

  // B. 担当業務だけある（スタッフレベルが無い）→ 右に「スタッフレベル」を差し込む
  var cd = h.indexOf('担当業務') + 1;
  if (cd && h.indexOf('スタッフレベル') < 0) {
    var dv = n ? sh.getRange(2, cd, n, 1).getValues() : [];
    sh.insertColumnAfter(cd);
    sh.getRange(1, cd + 1, sh.getMaxRows(), 1).clearDataValidations();
    sh.getRange(1, cd + 1).setValue('スタッフレベル');
    if (n) sh.getRange(2, cd + 1, n, 1).setValues(dv.map(function (x, i) {
      if (blank(i)) return [''];
      return [toSheetValue('Staff', 'staff_level', String(x[0]).trim() === '研修中' ? 1 : 2)];
    }));
    done.push('スタッフ：「スタッフレベル」の列を足しました（研修中は半人前、ほかは一人前）');
    h = head();
  }

  // C. 「1日の勤務時間」が無ければ、スタッフレベルの右に差し込む（空＝レベルの既定）
  var cl = h.indexOf('スタッフレベル') + 1;
  if (cl && h.indexOf('1日の勤務時間') < 0) {
    sh.insertColumnAfter(cl);
    var col = sh.getRange(1, cl + 1, sh.getMaxRows(), 1);
    col.clearDataValidations();
    col.setNumberFormat('@');          // 「4-6」が日付に化けないように
    sh.getRange(1, cl + 1).setValue('1日の勤務時間');
    done.push('スタッフ：「1日の勤務時間」の列を足しました（空ならレベルの既定。5なら5時間、4-6なら4〜6時間）');
  }

  if (done.length) { invalidateTable('Staff'); applyDropdowns('Staff'); }
  return done;
}

/**
 * 刻みを30分にする。
 *  - 設定の grid_min を 30 に
 *  - 必要人数の「1時間ごとの行」に、同じ人数の「30分の行」を足す（9:00 が 3人なら 9:30 も 3人）
 *  - 足したあと、必要人数の行を「平日・土日・祝日」「時刻」の順に並べ替える（行の中身は変えない）
 * もう30分になっていれば何もしない。
 */
function migrateTo30_() {
  var done = [];
  var st = readSettings();
  var grid = Number(st.grid_min) || 60;
  var openMin = Number(st.open_min) || 480, closeMin = Number(st.close_min) || 1440;

  if (grid !== 30) {
    var setSh = sheetOf('Settings');
    var row = readTable('Settings').filter(function (r) { return r.key === 'grid_min'; })[0];
    var head = setSh.getRange(1, 1, 1, setSh.getLastColumn()).getValues()[0].map(function (h) { return String(h).trim(); });
    var cv = head.indexOf('値') + 1, cn = head.indexOf('説明') + 1;
    if (row && cv) {
      setSh.getRange(row._row, cv).setValue(30);
      if (cn) setSh.getRange(row._row, cn).setValue('時間の刻み（分）。30＝30分単位');
    } else {
      appendRowsByHeader_('Settings', [{ key: 'grid_min', value: 30, note: '時間の刻み（分）。30＝30分単位' }]);
    }
    invalidateTable('Settings');
    done.push('設定：時間の刻みを30分にしました');
  }

  // 必要人数：30分の行が無い時刻に足す
  var rows = readTable('Demand');
  var have = {};
  rows.forEach(function (r) { have[r.day_type + '/' + Number(r.start_min)] = true; });
  var add = [];
  rows.forEach(function (r) {
    var m = Number(r.start_min) + 30;
    if (Number(r.start_min) % 60 !== 0 || m >= closeMin || m < openMin) return;
    if (have[r.day_type + '/' + m]) return;
    add.push({ day_type: r.day_type, start_min: m, hall: r.hall, kitchen: r.kitchen });
    have[r.day_type + '/' + m] = true;
  });
  if (add.length) {
    appendRowsByHeader_('Demand', add);
    // 並べ替え（行ごと動くだけで、中身は変わらない）。見出しの名前で列を探す
    var sh = sheetOf('Demand');
    var hd = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(function (h) { return String(h).trim(); });
    var cType = hd.indexOf('平日・土日') + 1, cStart = hd.indexOf('開始') + 1;
    if (cType && cStart && sh.getLastRow() > 2) {
      sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn())
        .sort([{ column: cType, ascending: true }, { column: cStart, ascending: true }]);
    }
    invalidateTable('Demand');
    done.push('必要人数：30分の行を足しました（' + add.length + '行。はじめは前の時刻と同じ人数）');
  }
  return done;
}
