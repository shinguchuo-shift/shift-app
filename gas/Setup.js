/**
 * シートの作成とサンプルデータの投入。
 * docs/02_data-model.md の設計どおりにシートを作る。
 *
 * 使い方：GAS エディタで setupAll() を選んで実行。
 * 既存のシートは中身を作り直すので、実データを入れたあとは実行しないこと。
 */

/** 列の定義は Schema.js にある（タブ名も見出しも日本語）。 */

var PERIOD_ID = '2026-11-02';      // 週の確認（月〜日）
var MONTH_ID = '2026-11';          // 月の暫定

/** 全部まとめて作る。これを実行する。 */
function setupAll() {
  setupSheets();
  setupSampleData();
  removeDefaultSheet_();
  SpreadsheetApp.getActive().toast('シートとサンプルデータを作りました', '完了', 5);
}

/** 空のシートと列見出しだけ作る。 */
function setupSheets() {
  Object.keys(COLUMNS).forEach(function (key) {
    writeTable(key, []);
  });
}

/** デモと同じサンプルデータを入れる（スタッフ名は架空）。 */
function setupSampleData() {
  // --- Settings ---
  writeTable('Settings', [
    ['store_name', 'サンプル店', 'シフト表の見出しに出る'],
    ['open_min', 480, '営業開始（8:00）'],
    ['close_min', 1440, '営業終了（24:00）'],
    ['grid_min', 60, '時間の刻み。60固定'],
    ['sheet_axis_start_min', 480, 'シフト表の横軸の左端（8:00）'],
    ['sheet_axis_end_min', 1440, 'シフト表の横軸の右端（24:00）'],
    ['sheet_lanes', 12, 'シフト表の1日あたりの行数'],
    ['deadline_dow', 3, '〆切の曜日の既定値（3=木）'],
    ['deadline_time', '23:59', '〆切の時刻の既定値'],
    ['peak_ranges', '660-840,1020-1200', 'ピーク帯（11〜14時、17〜20時）'],
    ['weekend_peak_boost', 1, '土日ピークの加算人数'],
    ['min_shift_min', 180, '1回の勤務の最短（3時間）'],
    ['max_shift_min', 480, '1回の勤務の最長（8時間）'],
    ['footer_note', '※シフト希望は毎週木曜日〆切です。原則雇用時通りの提出を心掛けてください。', 'シフト表の下に出す注意書き'],
    ['liff_url_staff', 'https://liff.line.me/2012473249-yrLHA1fl', 'スタッフ用のリンク（配布用の紙に載せる）'],
    ['liff_url_manager', 'https://liff.line.me/2012473249-4aDhOvyt', '店長用のリンク（グループには貼らない）']
  ]);

  // --- Staff ---
  writeTable('Staff', SAMPLE_STAFF.map(function (s, i) {
    return [
      s.id, s.name, s.type,
      i === 0 ? 'manager' : 'staff',       // 1人目を店長役にしておく
      true, '',                             // active / line_user_id
      newInviteCode(), '',               // invite_code / invite_expires_at
      s.capMin, s.leader, s.closer, s.duty,
      (s.ng || []).join(','), s.colorHue, ''
    ];
  }));

  // --- UsualPattern ---
  var usualRows = [];
  Object.keys(SAMPLE_USUAL).forEach(function (sid) {
    SAMPLE_USUAL[sid].forEach(function (u) {
      usualRows.push([sid, u.dow, u.start, u.end]);
    });
  });
  writeTable('UsualPattern', usualRows);

  // --- Periods ---
  // 運用は2段階：まず月の暫定を出してもらい、その後その週をあらためて確認する
  writeTable('Periods', [
    [MONTH_ID,  'month', '',       '2026-11-01', '2026-11-30', '2026-10-25 23:59', 'closed', 1],
    [PERIOD_ID, 'week',  MONTH_ID, '2026-11-02', '2026-11-08', '2026-10-29 23:59', 'closed', 1]
  ]);

  // --- Submissions / Requests ---
  var now = new Date();
  var subRows = [], reqRows = [];

  // 月の暫定：「いつもの勤務」を11月のカレンダーに展開したもの。
  // 実際の運用でも、スタッフは普段のパターンを下敷きに暫定を出す
  Object.keys(SAMPLE_USUAL).forEach(function (sid) {
    var byDow = {};
    SAMPLE_USUAL[sid].forEach(function (u) { byDow[u.dow] = u; });

    var rows = 0;
    for (var d = 1; d <= 30; d++) {
      var date = new Date(2026, 10, d);                 // 10 = 11月
      var dow = (date.getDay() + 6) % 7;                // 月曜=0 に直す
      var u = byDow[dow];
      if (!u) continue;
      reqRows.push([MONTH_ID, sid, fmtDate_(date), u.start, u.end, 1, true]);
      rows++;
    }
    if (rows) subRows.push([MONTH_ID, sid, now, now, 'usual']);
  });

  // 週の確認：月の暫定から変えた人もいる、という状態をサンプルで作る
  Object.keys(SAMPLE_REQUESTS).forEach(function (sid) {
    if (!SAMPLE_SUBMISSIONS[sid]) return;          // 未提出の人は行を作らない
    subRows.push([PERIOD_ID, sid, now, now, 'usual']);
    var days = SAMPLE_REQUESTS[sid];
    Object.keys(days).forEach(function (date) {
      reqRows.push([PERIOD_ID, sid, date, days[date].start, days[date].end, 1, true]);
    });
  });

  writeTable('Submissions', subRows);
  writeTable('Requests', reqRows);

  // --- Demand ---
  var demandRows = [];
  ['weekday', 'weekend'].forEach(function (dt) {
    SAMPLE_SLOTS.forEach(function (min, i) {
      demandRows.push([dt, min, SAMPLE_DEMAND.hall[i], SAMPLE_DEMAND.kitchen[i]]);
    });
  });
  writeTable('Demand', demandRows);

  // --- Rules ---
  writeTable('Rules', [
    ['leader', true, 'error', '営業中は毎時間、時間帯責任者を1人以上'],
    ['peak3', true, 'error', 'ピーク帯はホール・キッチンそれぞれ研修中でない人を1人以上'],
    ['close', true, 'error', '閉店時は締め作業ができる人を1人以上'],
    ['ng', true, 'error', 'NG組み合わせは同じ時間に入れない'],
    ['rookie', true, 'warn', '研修中の人を1人きりにしない']
  ]);

  // --- Shifts（叩き台を作った結果） ---
  writeTable('Shifts', SAMPLE_SHIFTS.map(function (s) {
    return [PERIOD_ID, s.date, s.staffId, s.side, s.start, s.end, 'auto', now];
  }));

  // --- DayNotes（紙の表にあった備考の例） ---
  writeTable('DayNotes', [
    ['2026-11-02', 'シェイク分解'],
    ['2026-11-07', '棚卸し']
  ]);

  writeTable('Log', [[now, 'setup', '', 'サンプルデータを投入']]);
}

/** Date を 'YYYY-MM-DD' の文字列にする。 */
function fmtDate_(d) {
  return d.getFullYear() + '-'
    + ('0' + (d.getMonth() + 1)).slice(-2) + '-'
    + ('0' + d.getDate()).slice(-2);
}


/**
 * 日本語化する前の英語名のタブを片付ける。
 * サンプルデータしか入っていない前提。実データを入れたあとは実行しないこと。
 */
function removeOldEnglishSheets_() {
  var ss = SpreadsheetApp.getActive();
  var removed = [];
  Object.keys(SHEET_NAME).forEach(function (key) {
    if (key === SHEET_NAME[key]) return;            // 名前が同じなら触らない
    var sh = ss.getSheetByName(key);                // 'Staff' などの旧タブ
    if (sh && ss.getSheets().length > 1) { ss.deleteSheet(sh); removed.push(key); }
  });
  // 改名・廃止で使われなくなったタブ
  ['対象週', 'ポジション'].forEach(function (n) {
    var sh = ss.getSheetByName(n);
    if (sh && ss.getSheets().length > 1) { ss.deleteSheet(sh); removed.push(n); }
  });

  // 旧い名前で出力したシフト表も片付ける
  ss.getSheets().forEach(function (sh) {
    if (/^ShiftSheet_/.test(sh.getName()) && ss.getSheets().length > 1) {
      removed.push(sh.getName());
      ss.deleteSheet(sh);
    }
  });
  return removed;
}

/** clasp create が作る空の「シート1」を消す。 */
function removeDefaultSheet_() {
  var ss = SpreadsheetApp.getActive();
  ['シート1', 'Sheet1'].forEach(function (n) {
    var sh = ss.getSheetByName(n);
    if (sh && ss.getSheets().length > 1) ss.deleteSheet(sh);
  });
}
