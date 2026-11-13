/**
 * スプレッドシートの読み書き。
 *
 * 呼ぶときは **コードのキー**（'Staff' など）を渡す。
 * 実際のタブ名と列の見出しは日本語で、その対応は Schema.js が持っている。
 *
 * 決まりごと：
 *  - 列は必ず「名前」で引く。列番号は直書きしない（店長が列を並べ替えても壊れないように）
 *  - シートは1枚につき1回だけ読む。getRange(i,j).getValue() をループで回すと100倍遅くなる
 *  - たくさんのシートが要るときは prefetchTables() で一括して読む
 *
 * 速さについて（実測）：
 *  - GAS の往復だけで約1.4秒
 *  - getDataRange().getValues() は1枚あたり約0.3秒。10枚読むと3秒
 *  - Advanced Sheets Service の batchGet なら、10枚でも通信1回で約0.25秒
 */

/** 1回の実行のあいだ、読んだシートを覚えておく。実行が終われば消える。 */
var _tableCache = {};

/** 直近の prefetch の結果。開発中の切り分け用（Phase 3 で消す）。 */
var _lastPrefetch = null;

/** 覚え書きを捨てる。書き込んだあとに呼ぶ。 */
function invalidateTable(key) {
  if (key) delete _tableCache[key];
  else _tableCache = {};
}

/** スプレッドシート本体。コンテナバインドなので getActive() で取れる。 */
function book() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

/** コードのキーから、日本語のタブ名を得る。 */
function tabOf(key) {
  return SHEET_NAME[key] || key;
}

/** タブを取る。無ければ作る。 */
function sheetOf(key) {
  var ss = book(), name = tabOf(key);
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

/**
 * 複数のシートを「通信1回」でまとめて読む。
 * 使えないとき（未承認・未有効）は何もしない。readTable() が1枚ずつ読むので止まりはしない。
 */
function prefetchTables(keys) {
  var want = keys.filter(function (k) { return !_tableCache[k]; });
  if (!want.length) { _lastPrefetch = { skipped: true }; return; }

  var t0 = Date.now();
  try {
    // UNFORMATTED_VALUE を指定しないと TRUE/FALSE や数値が「文字列」で返ってくる。
    // 日付は SERIAL_NUMBER（数値）で返るので dateKey_() で揃える。
    var res = Sheets.Spreadsheets.Values.batchGet(book().getId(), {
      ranges: want.map(function (k) { return "'" + tabOf(k) + "'"; }),
      majorDimension: 'ROWS',
      valueRenderOption: 'UNFORMATTED_VALUE',
      dateTimeRenderOption: 'SERIAL_NUMBER'
    });
    (res.valueRanges || []).forEach(function (vr, i) {
      _tableCache[want[i]] = toObjects_(want[i], vr.values || []);
    });
    _lastPrefetch = { ok: true, sheets: want.length, ms: Date.now() - t0 };
  } catch (err) {
    _lastPrefetch = { ok: false, ms: Date.now() - t0, error: String(err).slice(0, 200) };
    console.warn('prefetchTables が使えませんでした（1枚ずつ読みます）: ' + err);
  }
}

/**
 * シートを「コードのキーをキーにしたオブジェクトの配列」として読む。
 * @param {string} key 'Staff' などコードのキー
 * @param {function=} filter 1行ごとの絞り込み
 */
function readTable(key, filter) {
  if (!_tableCache[key]) {
    var sh = book().getSheetByName(tabOf(key));
    _tableCache[key] = sh ? toObjects_(key, sh.getDataRange().getValues()) : [];
  }
  var rows = _tableCache[key];
  return filter ? rows.filter(filter) : rows.slice();
}

/**
 * 2次元配列を、見出しの日本語をコードのキーに読み替えたオブジェクトの配列に変える。
 * batchGet は末尾の空セルを省いて返すので、行の長さが揃っていない前提で組む。
 */
function toObjects_(key, values) {
  if (!values || values.length < 2) return [];

  var map = headerToKey(key);
  var head = values[0].map(function (h) {
    var t = String(h).trim();
    return map[t] || t;          // 対応表に無い見出しは、そのままキーにする
  });

  var rows = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r] || [];
    var empty = true;
    for (var i = 0; i < row.length; i++) {
      if (row[i] !== '' && row[i] !== null && row[i] !== undefined) { empty = false; break; }
    }
    if (empty) continue;

    var obj = {};
    for (var c = 0; c < head.length; c++) {
      if (head[c] === '') continue;
      var raw = (row[c] === undefined ? '' : row[c]);
      obj[head[c]] = fromSheetValue(key, head[c], raw);
    }
    obj._row = r + 1;            // 実際の行番号（1始まり）
    rows.push(obj);
  }
  return rows;
}

/**
 * シートを丸ごと書き直す（日本語の見出し＋中身）。
 * @param {string} key  'Staff' などコードのキー
 * @param {Array<Array>} rows 中身。Schema.js の列の並び順で渡す
 */
function writeTable(key, rows) {
  invalidateTable(key);
  var head = headerOf(key);
  var sh = sheetOf(key);
  sh.clear();

  // コードの値をシート用の日本語・単位に変える
  var cols = keysOf(key);
  var shown = rows.map(function (r) {
    return r.map(function (v, i) { return toSheetValue(key, cols[i], v); });
  });

  var all = [head].concat(shown.length ? shown : []);

  // 値を入れる前に、文字列で持ちたい列を「書式なしテキスト」にしておく。
  // これをしないと '2026-11-02' が日付に変換され、読むとき 46327 のような数値で返る。
  cols.forEach(function (k, i) {
    if (TEXT_COLUMNS[k]) sh.getRange(1, i + 1, Math.max(all.length, 2), 1).setNumberFormat('@');
  });

  sh.getRange(1, 1, all.length, head.length).setValues(all);   // ← 一発で書く
  sh.getRange(1, 1, 1, head.length)
    .setFontWeight('bold')
    .setBackground('#eef1f5');
  sh.setFrozenRows(1);

  // 真偽の列はチェックボックスにする（TRUE / FALSE の英字を見せないため）
  if (all.length > 1) {
    cols.forEach(function (k, i) {
      if (BOOL_COLUMNS[k]) sh.getRange(2, i + 1, all.length - 1, 1).insertCheckboxes();
    });
  }

  sh.autoResizeColumns(1, Math.min(head.length, 8));           // 見出しが読める幅にする
  applyDropdowns(key);                                         // 決まった言葉の列はプルダウンに
  return sh;
}

/** 設定シートを { 設定名: 値 } の形で読む。 */
function readSettings() {
  var out = {};
  readTable('Settings').forEach(function (r) { out[r.key] = r.value; });
  return out;
}

/** 1行だけ追記する。 */
function appendRowTo(key, obj) {
  invalidateTable(key);
  var sh = sheetOf(key);
  sh.appendRow(keysOf(key).map(function (k) {
    return toSheetValue(key, k, obj[k] === undefined ? '' : obj[k]);
  }));
}

/** batchGet が効いているかを確かめる（開発用。GAS エディタから実行）。 */
function benchRead() {
  var keys = ['Settings', 'Staff', 'Periods', 'Submissions',
              'Requests', 'Demand', 'Rules', 'Shifts', 'DayNotes'];

  invalidateTable();
  var t = Date.now();
  keys.forEach(function (k) { readTable(k); });
  var oneByOne = Date.now() - t;

  invalidateTable();
  t = Date.now();
  prefetchTables(keys);
  keys.forEach(function (k) { readTable(k); });
  var batched = Date.now() - t;

  var msg = '1枚ずつ: ' + oneByOne + 'ms ／ batchGet: ' + batched + 'ms';
  console.log(msg);
  return msg;
}

/**
 * プルダウンを付ける。データは書き換えない（今入っている値はそのまま）。
 * 見出しを除く全行（シートの最終行まで）にかけるので、あとで行を足しても効く。
 * @param {string} key 'Staff' などコードのキー
 * @returns {number} プルダウンを付けた列の数
 */
function applyDropdowns(key) {
  var lists = dropdownsOf(key);
  if (!lists) return 0;

  var sh = book().getSheetByName(tabOf(key));
  if (!sh) return 0;

  var rows = Math.max(sh.getMaxRows() - 1, 1);
  var cols = keysOf(key);
  var n = 0;

  Object.keys(lists).forEach(function (col) {
    var i = cols.indexOf(col);
    if (i < 0) return;
    var rule = SpreadsheetApp.newDataValidation()
      .requireValueInList(lists[col], true)       // true = セルに ▼ を出す
      .setAllowInvalid(false)                      // 一覧にない言葉は入れさせない
      .setHelpText('一覧から選んでください：' + lists[col].join(' / '))
      .build();
    sh.getRange(2, i + 1, rows, 1).setDataValidation(rule);
    n++;
  });
  return n;
}

/** プルダウンを付けるシートすべてにかける。 */
function applyAllDropdowns() {
  var done = [];
  ['Staff', 'Periods', 'Demand', 'Rules'].forEach(function (k) {
    var n = applyDropdowns(k);
    if (n) done.push(tabOf(k) + '（' + n + '列）');
  });
  return done;
}
