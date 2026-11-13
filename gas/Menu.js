/**
 * スプレッドシートに出る「シフトアプリ」メニュー。
 *
 * 店長が普段やること（人の入れ替え、招待コードの発行）を、
 * 手でセルをいじらずにここから行えるようにする。
 * スタッフIDの重複や招待コードの付け忘れを防ぐのが目的。
 */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('シフトアプリ')
    .addItem('スタッフを追加', 'menuAddStaff')
    .addSeparator()
    .addItem('招待コードを発行し直す（選んだ行）', 'menuReissueCode')
    .addItem('退職にする（選んだ行）', 'menuRetire')
    .addItem('復帰させる（選んだ行）', 'menuRejoin')
    .addSeparator()
    .addItem('招待コードの一覧を出す', 'menuListCodes')
    .addItem('配布用の紙を作る（印刷して配る）', 'menuPrintCodes')
    .addToUi();
}

/** 招待コード。紛らわしい文字（0/O、1/I/L）を除いた8桁。毎回ランダム。 */
function newInviteCode() {
  var chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  var code = '';
  for (var i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

/** 次のスタッフID（s01, s02 … の続き）。 */
function nextStaffId_() {
  var max = 0;
  readTable('Staff').forEach(function (s) {
    var m = String(s.staff_id || '').match(/^s(\d+)$/);
    if (m) max = Math.max(max, Number(m[1]));
  });
  return 's' + ('0' + (max + 1)).slice(-2);
}

/** スタッフを1人追加する。 */
function menuAddStaff() {
  var ui = SpreadsheetApp.getUi();

  var res = ui.prompt('スタッフを追加',
    '名前を入れてください（例：山田）', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  var name = res.getResponseText().trim();
  if (!name) return ui.alert('名前が空です');

  var id = nextStaffId_();
  var code = newInviteCode();

  // 色は既存とかぶりにくいように、人数に応じてずらす
  var hue = (readTable('Staff').length * 137) % 360;

  appendRowTo('Staff', {
    staff_id: id, name: name, type: '大学生', role: 'staff',
    active: true, line_user_id: '', invite_code: code, invite_expires_at: '',
    weekly_cap_min: 20 * 60, leader: false, closer: false,
    duty: 'both', ng_staff_ids: '', color_hue: hue, memo: ''
  });

  // 真偽の列をチェックボックスにする（追加した行だけ）
  var sh = sheetOf('Staff');
  var row = sh.getLastRow();
  keysOf('Staff').forEach(function (k, i) {
    if (BOOL_COLUMNS[k]) sh.getRange(row, i + 1).insertCheckboxes();
  });
  sh.getRange(row, 1).activate();

  ui.alert('追加しました',
    name + 'さんを追加しました（' + id + '）。\n\n'
    + '招待コード： ' + code + '\n\n'
    + 'この行の「区分」「担当業務」「週の上限」を直してから、\n'
    + '本人に招待コードを伝えてください。',
    ui.ButtonSet.OK);
}

/** 選んだ行の招待コードを発行し直す（忘れた・漏れたとき）。 */
function menuReissueCode() {
  var ui = SpreadsheetApp.getUi();
  var row = pickedStaffRow_(ui);
  if (!row) return;

  var sh = sheetOf('Staff');
  var cols = keysOf('Staff');
  var code = newInviteCode();

  sh.getRange(row.row, cols.indexOf('invite_code') + 1).setValue(code);
  sh.getRange(row.row, cols.indexOf('line_user_id') + 1).setValue('');  // 紐付けも解除
  invalidateTable('Staff');

  ui.alert('発行し直しました',
    row.name + 'さんの招待コード： ' + code + '\n\n'
    + '前の紐付けは解除しました。本人にこのコードを伝えて、\n'
    + 'もう一度つないでもらってください。',
    ui.ButtonSet.OK);
}

/** 退職にする。行は消さない（過去のシフトが追えなくなるため）。 */
function menuRetire() {
  var ui = SpreadsheetApp.getUi();
  var row = pickedStaffRow_(ui);
  if (!row) return;

  var ok = ui.alert('退職にしますか',
    row.name + 'さんを「在籍していない」状態にします。\n\n'
    + '・これから先のシフトには入らなくなります\n'
    + '・過去のシフトはそのまま残ります\n'
    + '・LINEとの紐付けは解除します\n\n'
    + '行は消しません（消すと過去のシフトが誰のものか分からなくなります）',
    ui.ButtonSet.OK_CANCEL);
  if (ok !== ui.Button.OK) return;

  var sh = sheetOf('Staff');
  var cols = keysOf('Staff');
  sh.getRange(row.row, cols.indexOf('active') + 1).setValue(false);
  sh.getRange(row.row, cols.indexOf('line_user_id') + 1).setValue('');
  sh.getRange(row.row, cols.indexOf('invite_code') + 1).setValue('');
  invalidateTable('Staff');

  appendRowTo('Log', { at: new Date(), type: 'setup', staff_id: row.id, detail: '退職にしました' });
  ui.alert(row.name + 'さんを退職にしました');
}

/** 復帰させる（辞めた人が戻ってきたとき）。 */
function menuRejoin() {
  var ui = SpreadsheetApp.getUi();
  var row = pickedStaffRow_(ui);
  if (!row) return;

  var sh = sheetOf('Staff');
  var cols = keysOf('Staff');
  var code = newInviteCode();
  sh.getRange(row.row, cols.indexOf('active') + 1).setValue(true);
  sh.getRange(row.row, cols.indexOf('invite_code') + 1).setValue(code);
  invalidateTable('Staff');

  ui.alert('復帰させました',
    row.name + 'さんを在籍に戻しました。\n\n招待コード： ' + code + '\n\n'
    + 'もう一度つないでもらってください。',
    ui.ButtonSet.OK);
}

/** まだ紐付けていない人の招待コードを一覧で出す（配るとき用）。 */
function menuListCodes() {
  var yet = readTable('Staff', function (s) {
    return s.active === true && !s.line_user_id && s.invite_code;
  });

  if (!yet.length) {
    return SpreadsheetApp.getUi().alert('全員つながっています',
      'まだつないでいない人はいません。', SpreadsheetApp.getUi().ButtonSet.OK);
  }

  var lines = yet.map(function (s) {
    return '　' + s.name + '　' + s.invite_code;
  }).join('\n');

  SpreadsheetApp.getUi().alert('まだつないでいない人（' + yet.length + '人）',
    lines + '\n\nこのコードを本人に伝えてください。\n'
    + 'グループに貼らず、口頭か個別のLINEで伝えてください。',
    SpreadsheetApp.getUi().ButtonSet.OK);
}

/** いま選ばれている「スタッフ」シートの行を返す。 */
function pickedStaffRow_(ui) {
  var sh = SpreadsheetApp.getActiveSheet();
  if (sh.getName() !== tabOf('Staff')) {
    ui.alert('「' + tabOf('Staff') + '」シートで、対象の人の行を選んでから実行してください');
    return null;
  }
  var row = sh.getActiveRange().getRow();
  if (row < 2) {
    ui.alert('見出しの行が選ばれています。対象の人の行を選んでください');
    return null;
  }
  var cols = keysOf('Staff');
  var name = sh.getRange(row, cols.indexOf('name') + 1).getValue();
  var id = sh.getRange(row, cols.indexOf('staff_id') + 1).getValue();
  if (!id) {
    ui.alert('その行にスタッフがいません');
    return null;
  }
  return { row: row, name: name, id: id };
}

/**
 * 招待コードの配布用シートを作る。
 *
 * コードは「その人になりすます鍵」なので、グループに貼ってはいけない。
 * 1人ずつ切り取って手渡しできる形にする。
 */
function menuPrintCodes() {
  var ui = SpreadsheetApp.getUi();

  var url = liffUrlStaff_(ui);
  if (!url) return;

  var yet = readTable('Staff', function (s) {
    return s.active === true && !s.line_user_id && s.invite_code;
  });
  if (!yet.length) {
    return ui.alert('全員つながっています', '配る相手がいません。', ui.ButtonSet.OK);
  }

  var ss = SpreadsheetApp.getActive();
  var name = '招待コード配布';
  var old = ss.getSheetByName(name);
  if (old) ss.deleteSheet(old);
  var sh = ss.insertSheet(name);

  var store = readSettings().store_name || '';
  var COLS = 2;                                   // 横に2人ずつ
  var rows = [];
  var deco = [];

  for (var i = 0; i < yet.length; i += COLS) {
    var top = rows.length + 1;
    var line1 = [], line2 = [], line3 = [], line4 = [], line5 = [];
    for (var c = 0; c < COLS; c++) {
      var p = yet[i + c];
      line1.push(p ? p.name + ' さん' : '');
      line2.push(p ? store + ' シフトアプリ' : '');
      line3.push(p ? p.invite_code : '');
      line4.push(p ? '下のリンクを開いて、上のコードを入れてください' : '');
      line5.push(p ? url : '');
      if (p) deco.push({ row: top + 2, col: c + 1 });
    }
    rows.push(line1, line2, line3, line4, line5, ['', '']);
    deco.push({ block: true, top: top, cols: COLS });
  }

  sh.getRange(1, 1, rows.length, COLS).setValues(rows);
  sh.setColumnWidth(1, 300);
  sh.setColumnWidth(2, 300);

  deco.forEach(function (d) {
    if (d.block) {
      sh.getRange(d.top, 1, 5, d.cols)
        .setBorder(true, true, true, true, false, false, '#999999', SpreadsheetApp.BorderStyle.DASHED)
        .setHorizontalAlignment('center')
        .setVerticalAlignment('middle');
      sh.getRange(d.top, 1, 1, d.cols).setFontSize(13).setFontWeight('bold');
      sh.getRange(d.top + 1, 1, 1, d.cols).setFontSize(9).setFontColor('#666666');
      sh.getRange(d.top + 3, 1, 1, d.cols).setFontSize(9).setFontColor('#666666');
      sh.getRange(d.top + 4, 1, 1, d.cols).setFontSize(8).setFontColor('#1155cc');
      for (var i = 0; i < 5; i++) sh.setRowHeight(d.top + i, i === 2 ? 40 : 20);
    } else {
      // 招待コードの行
      sh.getRange(d.row, d.col)
        .setFontSize(22).setFontWeight('bold').setFontFamily('Courier New');
    }
  });

  sh.setHiddenGridlines(true);
  ss.setActiveSheet(sh);

  ui.alert('配布用の紙を作りました',
    yet.length + '人分を「' + name + '」シートに出しました。\n\n'
    + '印刷して、点線で切って1人ずつ手渡してください。\n\n'
    + '⚠ グループLINEには貼らないこと。\n'
    + '　 コードは本人になりすませる鍵なので、他の人に見えると危険です。',
    ui.ButtonSet.OK);
}

/** スタッフ用の LIFF URL。設定に無ければ1回だけ聞いて覚える。 */
function liffUrlStaff_(ui) {
  var st = readSettings();
  if (st.liff_url_staff) return String(st.liff_url_staff);

  var res = ui.prompt('スタッフ用のリンクを教えてください',
    'LINE Developers の LIFF タブにある「LIFF URL」を貼り付けてください。\n'
    + '（https://liff.line.me/ で始まるもの）\n\n一度入れれば次からは聞きません。',
    ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return null;

  var url = res.getResponseText().trim();
  if (!/^https:\/\/liff\.line\.me\//.test(url)) {
    ui.alert('https://liff.line.me/ で始まるURLを入れてください');
    return null;
  }

  appendRowTo('Settings', {
    key: 'liff_url_staff', value: url, note: 'スタッフ用の LIFF URL（配布用の紙に載せる）'
  });
  return url;
}
