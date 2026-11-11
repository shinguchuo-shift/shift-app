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
