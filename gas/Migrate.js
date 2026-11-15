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

/** ルールの説明文（スキル段階に合わせたもの）。 */
var RULE_LABELS_V2 = {
  peak3: 'ピーク帯はホール・キッチンそれぞれレベル2以上の人を1人以上',
  rookie: 'レベル1の人は、同じ側にレベル2以上がいる時間にだけ入れる'
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

/** 旧「担当業務」→ スキル段階。研修中はどちらも1、それ以外は担当する側を2にする。 */
function levelsFromDuty_(duty) {
  var d = String(duty || '').trim();
  if (d === '研修中' || d === 'trainee') return { hall: 1, kitchen: 1 };
  if (d === 'ホール' || d === 'hall') return { hall: 2, kitchen: 0 };
  if (d === 'キッチン' || d === 'kitchen') return { hall: 0, kitchen: 2 };
  return { hall: 2, kitchen: 2 };                // 両方・空欄
}

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

  // 1. スタッフ：担当業務 → ホール／キッチンのスキル
  var staffSh = ss.getSheetByName(tabOf('Staff'));
  var head = staffSh ? staffSh.getRange(1, 1, 1, staffSh.getLastColumn()).getValues()[0] : [];
  if (staffSh && head.indexOf('担当業務') >= 0 && head.indexOf('ホールのスキル') < 0) {
    // 見出しに無い列（担当業務）は、日本語の見出しのままキーになって読める
    var rows = readTable('Staff').map(function (s) {
      var lv = levelsFromDuty_(s['担当業務']);
      return keysOf('Staff').map(function (k) {
        if (k === 'hall_lv') return lv.hall;
        if (k === 'kitchen_lv') return lv.kitchen;
        return s[k] === undefined ? '' : s[k];
      });
    });
    var before = staffSh.getMaxRows();
    writeTable('Staff', rows);
    // 60人分の欄（プルダウン）を保つ
    if (staffSh.getMaxRows() < before) staffSh.insertRowsAfter(staffSh.getMaxRows(), before - staffSh.getMaxRows());
    applyDropdowns('Staff');
    done.push('スタッフ：担当業務をホール・キッチンのスキルに分けました（' + rows.length + '人）');
  }

  // 2. 必要人数：祝日の行（はじめは土日と同じ）
  var demand = readTable('Demand');
  if (!demand.some(function (r) { return r.day_type === 'holiday'; })) {
    // 1行ずつ足すと「08:00」が時刻に変わってしまうので、表ごと書き直す（書式なしテキストを保つ）
    var keep = demand.map(function (r) { return [r.day_type, r.start_min, r.hall, r.kitchen]; });
    var add = demand.filter(function (r) { return r.day_type === 'weekend'; })
      .map(function (r) { return ['holiday', r.start_min, r.hall, r.kitchen]; });
    writeTable('Demand', keep.concat(add));
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
      var want = RULE_LABELS_V2[r.rule_key];
      if (want && r.label !== want) {
        rulesSh.getRange(r._row, cols.indexOf('label') + 1).setValue(want);
        changed++;
      }
    });
    if (changed) { invalidateTable('Rules'); done.push('ルールの説明文を新しくしました（' + changed + '件）'); }
  }

  appendRowTo('Log', { at: new Date(), type: 'setup', staff_id: '',
    detail: 'シートを更新：' + (done.length ? done.join(' / ') : '変更なし') });
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
