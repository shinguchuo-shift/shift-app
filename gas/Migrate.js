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
    // シートを書き直さず、「担当業務」の列だけをその場で2列に分ける。
    // ほかの列（名前・LINEユーザーID・店長が足した列など）には一切さわらない
    var dcol = head.indexOf('担当業務') + 1;
    var idCol = head.indexOf('スタッフID') + 1;
    var last = staffSh.getLastRow();
    var duty = last > 1 ? staffSh.getRange(2, dcol, last - 1, 1).getValues() : [];
    var ids = (last > 1 && idCol > 0) ? staffSh.getRange(2, idCol, last - 1, 1).getValues() : duty;
    var n = 0;
    var vals = duty.map(function (d, i) {
      if (String(ids[i][0]).trim() === '' && String(d[0]).trim() === '') return ['', ''];   // 空の行
      n++;
      var lv = levelsFromDuty_(d[0]);
      return [SKILL_LEVELS[lv.hall], SKILL_LEVELS[lv.kitchen]];
    });
    staffSh.insertColumnAfter(dcol);
    staffSh.getRange(1, dcol, staffSh.getMaxRows(), 2).clearDataValidations();
    staffSh.getRange(1, dcol, 1, 2).setValues([['ホールのスキル', 'キッチンのスキル']]);
    if (vals.length) staffSh.getRange(2, dcol, vals.length, 2).setValues(vals);
    invalidateTable('Staff');
    applyDropdowns('Staff');
    done.push('スタッフ：担当業務をホール・キッチンのスキルに分けました（' + n + '人）');
  }

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
      var want = RULE_LABELS_V2[r.rule_key];
      if (want && RULE_LABELS_V1[r.rule_key] === r.label) {
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

  // 開くたびに呼ばれるので、直したときだけログに残す
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
