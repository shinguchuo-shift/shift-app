/**
 * 紙と同じ見た目の週間シフト表を、1枚のシートに出力する。
 * 形式の正解は docs/01_requirements.md「今のシフト表の形式」（実物の写真から起こしたもの）。
 *
 * 構造：
 *   1行目  年 ＋ 「〇〇店シフト表」の見出し
 *   以降、7日分のブロックを縦に並べる。各ブロックは
 *     - 時刻の見出し行（日ごとに繰り返す）
 *     - 勤務バーの行（Settings.sheet_lanes 行。既定12）
 *   左端 = 日付＋曜日（ブロックで縦結合、土は青字・日は赤字）
 *   右端 = 備考（ブロックで縦結合）
 *   最終行 = 注意書き
 *
 * 印刷設定（A4縦・余白・幅に合わせる）は Sheets の API から設定できない。
 * 本番は印刷設定済みの「_シフト表テンプレート」を copyTo() して使う。
 * ここでは列幅と行高だけ整えて、A4縦に近づける。
 */

/** 確定時に呼ぶ。指定した period のシフト表シートを作る。 */
function buildShiftSheet(periodId) {
  prefetchTables(['Settings', 'Periods', 'Staff', 'Shifts', 'DayNotes']);

  var st = readSettings();
  // period_id は「2026-11-02」の形なので、スプレッドシートが日付型に変換してしまう。
  // 文字列と Date のどちらで返ってきても一致するように、必ず正規化して比べる。
  var want = dateKey_(periodId);
  var period = readTable('Periods', function (r) { return dateKey_(r.period_id) === want; })[0];
  if (!period) throw new Error('期間が見つかりません: ' + periodId);

  var staff = readTable('Staff');
  var staffById = {};
  staff.forEach(function (s) { staffById[s.staff_id] = s; });

  var shifts = readTable('Shifts', function (r) { return dateKey_(r.period_id) === want; });
  var notes = {};
  readTable('DayNotes').forEach(function (n) { notes[dateKey_(n.date)] = n.text; });

  // --- 軸 ---
  var grid = Number(st.grid_min) || 60;
  var axisStart = Number(st.sheet_axis_start_min) || 480;
  var axisEnd = Number(st.sheet_axis_end_min) || 1440;
  var cols = Math.round((axisEnd - axisStart) / grid);     // 時刻の列数
  var lanes = Number(st.sheet_lanes) || 12;

  var COL_DATE = 1;                 // A列：日付
  var COL_T0 = 2;                   // B列から時刻
  var COL_MEMO = COL_T0 + cols;     // 時刻の右：備考
  var TOTAL = COL_MEMO;

  // --- シートを作り直す ---
  var ss = SpreadsheetApp.getActive();
  var name = shiftSheetName(periodId);
  var old = ss.getSheetByName(name);
  if (old) ss.deleteSheet(old);

  var tpl = ss.getSheetByName(TEMPLATE_SHEET);
  var sh = tpl
    ? tpl.copyTo(ss).setName(name)   // テンプレートがあれば印刷設定ごと引き継ぐ
    : ss.insertSheet(name);
  sh.clear();
  if (sh.getMaxColumns() > TOTAL) sh.deleteColumns(TOTAL + 1, sh.getMaxColumns() - TOTAL);

  // 週の日付を並べる
  var days = [];
  // シリアル値で返ることがあるので、必ず dateKey_() を通してから Date にする
  var d0 = new Date(dateKey_(period.start_date) + 'T00:00:00');
  for (var i = 0; i < 7; i++) {
    var d = new Date(d0.getTime());
    d.setDate(d.getDate() + i);
    days.push(d);
  }

  var rows = [];        // 書き込む値（2次元配列）
  var deco = [];        // あとでまとめて書式を当てるための記録
  var overflow = [];    // 行数が足りずに描けなかった日
  var r = 0;

  // --- 見出し行 ---
  var title = new Array(TOTAL).fill('');
  title[0] = d0.getFullYear() + '年';
  title[COL_T0 - 1] = (st.store_name || '') + 'シフト表';   // 時刻列の先頭に置き、あとで横に結合する
  rows.push(title);
  deco.push({ type: 'title', row: 1 });
  r = 1;

  // --- 7日分のブロック ---
  days.forEach(function (day, di) {
    var key = dateKey_(day);
    var blockTop = r + 1;                  // 1始まりの行番号

    // 時刻の見出し行（日ごとに繰り返す）
    var head = new Array(TOTAL).fill('');
    for (var c = 0; c < cols; c++) {
      var h = Math.floor((axisStart + c * grid) / 60) % 24;
      head[COL_T0 - 1 + c] = h === 0 ? 24 : h;
    }
    rows.push(head);
    deco.push({ type: 'timehead', row: blockTop });
    r++;

    // 勤務バーを「重ならない人は同じ行」に詰める
    var list = shifts.filter(function (s) { return dateKey_(s.date) === key; });
    var packed = packLanes_(list, lanes);

    // 行数が足りないと黙って消えてしまうので、必ず記録して呼び出し側に返す
    if (packed.length > lanes) {
      var lost = packed.slice(lanes).reduce(function (a, l) { return a + l.length; }, 0);
      overflow.push({ date: key, needed: packed.length, lanes: lanes, dropped: lost });
    }

    for (var li = 0; li < lanes; li++) {
      var row = new Array(TOTAL).fill('');
      (packed[li] || []).forEach(function (s) {
        var c0 = Math.round((Number(s.start_min) - axisStart) / grid);
        var c1 = Math.round((Number(s.end_min) - axisStart) / grid);
        if (c1 <= 0 || c0 >= cols) return;         // 軸の外は描かない
        c0 = Math.max(0, c0); c1 = Math.min(cols, c1);

        var who = staffById[s.staff_id];
        row[COL_T0 - 1 + c0] = who ? who.name : s.staff_id;
        deco.push({
          type: 'bar',
          row: blockTop + 1 + li,
          col: COL_T0 + c0,
          span: c1 - c0,
          hue: who ? Number(who.color_hue) || 0 : 0,
          leader: who ? who.leader === true : false
        });
      });
      rows.push(row);
      r++;
    }

    deco.push({
      type: 'block',
      top: blockTop,
      height: lanes + 1,
      day: day,
      dow: di,
      note: notes[key] || ''
    });
  });

  // --- 注意書き ---
  var foot = new Array(TOTAL).fill('');
  foot[0] = st.footer_note || '';
  rows.push(foot);
  deco.push({ type: 'footer', row: r + 1 });

  // 値をまとめて書き込む（1回）
  sh.getRange(1, 1, rows.length, TOTAL).setValues(rows);

  applyFormat_(sh, deco, { cols: cols, lanes: lanes, COL_DATE: COL_DATE, COL_T0: COL_T0, COL_MEMO: COL_MEMO, TOTAL: TOTAL, rows: rows.length });

  // 行が足りなかった日は Log に残す（黙って人が消えるのを防ぐ）
  overflow.forEach(function (o) {
    appendRowTo('Log', {
      at: new Date(), type: 'shiftsheet_overflow', staff_id: '',
      detail: o.date + '：' + o.needed + '行必要だが ' + o.lanes + '行しかなく、'
        + o.dropped + '人が表に出ていません（Settings.sheet_lanes を増やしてください）'
    });
  });

  SpreadsheetApp.flush();
  sh.overflow = overflow;
  return sh;
}

/**
 * 勤務を「時間が重ならないものは同じ行」に詰める（デモの lanes() と同じ考え方）。
 * 朝の人が上、重ならない夕方〜夜の人は同じ行の右側に入る。
 */
function packLanes_(list, lanes) {
  var sorted = list.slice().sort(function (a, b) {
    return (a.start_min - b.start_min) || (a.end_min - b.end_min);
  });
  var L = [];
  sorted.forEach(function (x) {
    var i = -1;
    for (var k = 0; k < L.length; k++) {
      if (L[k].end <= x.start_min) { i = k; break; }
    }
    if (i < 0) { L.push({ end: 0, items: [] }); i = L.length - 1; }
    L[i].items.push(x);
    L[i].end = x.end_min;
  });
  // 行数が足りなければ、溢れた分は最終行に寄せる（警告は呼び出し側で出す）
  return L.map(function (l) { return l.items; });
}

/** 書式をまとめて当てる。 */
function applyFormat_(sh, deco, geo) {
  var WD = ['月', '火', '水', '木', '金', '土', '日'];

  // 全体の下地
  sh.getRange(1, 1, geo.rows, geo.TOTAL)
    .setFontFamily('Noto Sans JP')
    .setFontSize(8)
    .setVerticalAlignment('middle')
    .setHorizontalAlignment('center');

  // 列幅：日付は広め、時刻は狭く、備考は広め
  sh.setColumnWidth(geo.COL_DATE, 58);
  for (var c = 0; c < geo.cols; c++) sh.setColumnWidth(geo.COL_T0 + c, 26);
  sh.setColumnWidth(geo.COL_MEMO, 78);

  deco.forEach(function (d) {
    if (d.type === 'title') {
      // 見出しは時刻列いっぱいに結合しないと、26px幅の列で縦書きになってしまう
      sh.getRange(d.row, geo.COL_T0, 1, geo.cols).merge()
        .setFontSize(11).setFontWeight('bold')
        .setHorizontalAlignment('center').setWrap(false);
      sh.getRange(d.row, 1).setHorizontalAlignment('left').setFontSize(8);
      sh.setRowHeight(d.row, 24);

    } else if (d.type === 'timehead') {
      sh.getRange(d.row, geo.COL_T0, 1, geo.cols)
        .setFontSize(7).setFontColor('#555555').setBackground('#f4f6f8');
      sh.setRowHeight(d.row, 14);

    } else if (d.type === 'block') {
      // 左端の日付（縦結合）。土は青字、日は赤字
      var cell = sh.getRange(d.top, geo.COL_DATE, d.height, 1);
      cell.merge()
        .setValue((d.day.getMonth() + 1) + '月' + d.day.getDate() + '日\n' + WD[d.dow])
        .setFontSize(8)
        .setWrap(true);
      if (d.dow === 5) cell.setFontColor('#1155cc');
      else if (d.dow === 6) cell.setFontColor('#cc0000');

      // 右端の備考（縦結合）
      sh.getRange(d.top, geo.COL_MEMO, d.height, 1)
        .merge()
        .setValue(d.note)
        .setFontSize(7)
        .setWrap(true)
        .setVerticalAlignment('top')
        .setHorizontalAlignment('left');

      // ブロック全体に罫線
      sh.getRange(d.top, 1, d.height, geo.TOTAL)
        .setBorder(true, true, true, true, true, true, '#c6ccd2', SpreadsheetApp.BorderStyle.SOLID);
      // ブロックの外枠を濃く
      sh.getRange(d.top, 1, d.height, geo.TOTAL)
        .setBorder(true, true, true, true, null, null, '#5f6a73', SpreadsheetApp.BorderStyle.SOLID);

      for (var i = 0; i < d.height; i++) sh.setRowHeight(d.top + i, i === 0 ? 14 : 15);

    } else if (d.type === 'bar') {
      var bar = sh.getRange(d.row, d.col, 1, d.span);
      if (d.span > 1) bar.merge();
      bar.setBackground(pastel_(d.hue))
        .setFontSize(8)
        .setFontColor('#1a1d21')
        .setHorizontalAlignment('center')
        .setBorder(true, true, true, true, null, null, '#8c959d', SpreadsheetApp.BorderStyle.SOLID);

    } else if (d.type === 'footer') {
      sh.getRange(d.row, 1, 1, geo.TOTAL).merge()
        .setFontSize(8)
        .setHorizontalAlignment('center');
      sh.setRowHeight(d.row, 20);
    }
  });

  sh.setFrozenRows(0);
  sh.setHiddenGridlines(true);
}

/** 色相から淡い色を作る（紙の表のパステル調に合わせる）。 */
function pastel_(hue) {
  return hslToHex_(((hue % 360) + 360) % 360, 0.62, 0.84);
}

function hslToHex_(h, s, l) {
  var c = (1 - Math.abs(2 * l - 1)) * s;
  var x = c * (1 - Math.abs((h / 60) % 2 - 1));
  var m = l - c / 2;
  var r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }
  var to = function (v) {
    var n = Math.round((v + m) * 255);
    return ('0' + Math.max(0, Math.min(255, n)).toString(16)).slice(-2);
  };
  return '#' + to(r) + to(g) + to(b);
}

/**
 * 日付を 'YYYY-MM-DD' に揃える。
 *
 * 日付はシートから3通りの形で返ってくるので、ここで必ず1つに揃える：
 *  - Date         … getValues() で読んだとき
 *  - 数値（シリアル値）… Advanced Sheets Service の batchGet で読んだとき
 *  - 文字列       … 書いたまま文字列で入っているとき（区切りが / のこともある）
 */
function dateKey_(v) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  if (typeof v === 'number' && isFinite(v)) {
    // Sheets のシリアル値は 1899-12-30 が 0
    var ms = Math.round((v - 25569) * 86400000);   // 25569 = 1970-01-01 のシリアル値
    return Utilities.formatDate(new Date(ms), 'UTC', 'yyyy-MM-dd');
  }
  var s = String(v).trim().replace(/[\/.]/g, '-');
  var m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) {
    return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
  }
  return s.slice(0, 10);
}

/** 手で動かすとき用。サンプルの期間で出力する。 */
function buildSampleShiftSheet() {
  var sh = buildShiftSheet(PERIOD_ID);
  SpreadsheetApp.getActive().setActiveSheet(sh);
  SpreadsheetApp.getActive().toast('シフト表を出力しました', '完了', 5);
}
