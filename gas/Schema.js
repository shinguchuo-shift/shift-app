/**
 * シートの名前と列の対応表。ここだけ見れば「コードの名前」と「シートの見出し」が分かる。
 *
 * 考え方：
 *  - 店長が見るスプレッドシートは **日本語**
 *  - コードの中は短い英語のキー（staff_id など）のまま
 *  - その橋渡しをこのファイルがやる
 *
 * 列を増やす・名前を変えるときは、ここだけ直せばよい。
 * シートの見出しを店長が手で書き換えると読めなくなるので、見出しの行は触らないよう伝えること。
 */

/** シート名：コードのキー → スプレッドシートのタブ名 */
var SHEET_NAME = {
  Settings:     '設定',
  Staff:        'スタッフ',
  UsualPattern: 'いつもの勤務',
  Periods:      '期間',
  Submissions:  '提出',
  Requests:     '希望',
  Demand:       '必要人数',
  Rules:        'ルール',
  Shifts:       'シフト',
  DayNotes:     '備考',
  Log:          'ログ'
};

/** 出力するシフト表シートの名前（確定するたびに作る） */
function shiftSheetName(periodId) {
  return 'シフト表_' + periodId;
}

/** 印刷設定済みのテンプレート（あれば複製して使う） */
var TEMPLATE_SHEET = '_シフト表テンプレート';

/**
 * 列：コードのキー → シートの見出し。並び順がそのまま列の順番。
 */
var COLUMNS = {
  Settings: [
    ['key',   '設定名'],
    ['value', '値'],
    ['note',  '説明']
  ],

  Staff: [
    ['staff_id',          'スタッフID'],
    ['name',              '名前'],
    ['type',              '区分'],
    ['role',              '権限'],
    ['active',            '在籍'],
    ['line_user_id',      'LINEユーザーID'],
    ['invite_code',       '招待コード'],
    ['invite_expires_at', '招待コードの期限'],
    ['weekly_cap_min',    '週の上限（時間）'],
    ['leader',            '責任者'],
    ['closer',            '締め作業'],
    ['duty',              '担当業務'],
    ['ng_staff_ids',      '組ませない相手'],
    ['color_hue',         '色'],
    ['memo',              'メモ']
  ],

  UsualPattern: [
    ['staff_id',  'スタッフID'],
    ['dow',       '曜日'],
    ['start_min', '開始'],
    ['end_min',   '終了']
  ],

  // kind='month' は月の暫定、kind='week' は週の確認。
  // 週の parent_id に、その週が属する月の period_id を入れる。
  Periods: [
    ['period_id',   '期間ID'],
    ['kind',        '種類'],
    ['parent_id',   '親の期間ID'],
    ['start_date',  '開始日'],
    ['end_date',    '終了日'],
    ['deadline_at', '〆切'],
    ['status',      '状態'],
    ['revision',    '版']
  ],

  Submissions: [
    ['period_id',    '期間ID'],
    ['staff_id',     'スタッフID'],
    ['submitted_at', '提出日時'],
    ['updated_at',   '更新日時'],
    ['method',       '方法']
  ],

  Requests: [
    ['period_id', '期間ID'],
    ['staff_id',  'スタッフID'],
    ['date',      '日付'],
    ['start_min', '開始'],
    ['end_min',   '終了'],
    ['rev',       '版'],
    ['active',    '有効']
  ],

  Demand: [
    ['day_type',  '平日・土日'],
    ['start_min', '開始'],
    ['hall',      'ホール'],
    ['kitchen',   'キッチン']
  ],

  Rules: [
    ['rule_key', 'ルールID'],
    ['enabled',  '使う'],
    ['level',    '強さ'],
    ['label',    '内容']
  ],

  Shifts: [
    ['period_id',  '期間ID'],
    ['date',       '日付'],
    ['staff_id',   'スタッフID'],
    ['side',       'ホール・キッチン'],
    ['start_min',  '開始'],
    ['end_min',    '終了'],
    ['source',     '作り方'],
    ['updated_at', '更新日時']
  ],

  DayNotes: [
    ['date', '日付'],
    ['text', '備考']
  ],

  Log: [
    ['at',       '日時'],
    ['type',     '種類'],
    ['staff_id', 'スタッフID'],
    ['detail',   '中身']
  ]
};

/** そのシートの見出し（日本語）の配列。書き込むときに使う。 */
function headerOf(key) {
  return COLUMNS[key].map(function (c) { return c[1]; });
}

/** そのシートのコード上のキーの配列。並び順は見出しと同じ。 */
function keysOf(key) {
  return COLUMNS[key].map(function (c) { return c[0]; });
}

/** 見出し（日本語）→ コードのキー の対応。読むときに使う。 */
function headerToKey(key) {
  var m = {};
  COLUMNS[key].forEach(function (c) { m[c[1]] = c[0]; });
  return m;
}

/**
 * 「文字列として入れたいのに、スプレッドシートが日付や数値に変えてしまう」列。
 * 例：period_id の '2026-11-02' は、放っておくと日付になり 46327 のような数値で返ってくる。
 * 書き込む前にこれらの列を「書式なしテキスト」にして防ぐ。
 */
/** 区分。高校生は労働基準法で22時以降に働けないので、ロジックで止める。 */
var STAFF_TYPES = ['社員', '主婦', '大学生', '高校生'];

/** 22時を超えて入れられない区分（分で持つ） */
var TYPE_END_LIMIT = { '高校生': 22 * 60 };

/** 担当業務。trainee（研修中）はどちらにも入るが、1人にしない。 */
var DUTIES = [
  ['hall',    'ホール'],
  ['kitchen', 'キッチン'],
  ['both',    '両方'],
  ['trainee', '研修中']
];

/** 担当業務から、入れる側を返す。 */
function sidesOfDuty(duty) {
  if (duty === 'hall') return ['hall'];
  if (duty === 'kitchen') return ['kitchen'];
  return ['hall', 'kitchen'];      // both / trainee
}

var TEXT_COLUMNS = {
  period_id: true, parent_id: true,
  date: true, start_date: true, end_date: true, deadline_at: true,
  staff_id: true, pos_key: true, rule_key: true,
  invite_code: true, line_user_id: true, ng_staff_ids: true, duty: true, type: true,
  start_min: true, end_min: true, dow: true
};

/* ===================================================================
 * 値の変換
 *
 * シートには日本語を入れ、コードの中は短い英語のままにする。
 * 見出し（COLUMNS）と同じ考え方を、セルの値にも広げたもの。
 * =================================================================== */

/** 選択肢の値：コード → シートの日本語。シート名ごとに分けている列もある。 */
var VALUE_MAPS = {
  dow: { 0: '月', 1: '火', 2: '水', 3: '木', 4: '金', 5: '土', 6: '日' },
  rule_key: { leader: '責任者', peak3: 'ピーク帯', close: '締め', ng: '組み合わせNG', rookie: '研修中' },
  role:     { staff: 'スタッフ', manager: '店長' },
  duty:     { hall: 'ホール', kitchen: 'キッチン', both: '両方', trainee: '研修中' },
  side:     { hall: 'ホール', kitchen: 'キッチン' },
  kind:     { month: '月の暫定', week: '週の確認' },
  status:   { draft: '準備中', open: '受付中', closed: '締切後', published: '確定済み' },
  method:   { usual: 'いつも通り', custom: '変更あり' },
  day_type: { weekday: '平日', weekend: '土日' },
  level:    { error: '必須', warn: '注意' },
  source:   { auto: '自動作成', manual: '手直し' },
  type:     { setup: '初期設定', error: 'エラー', publish: '確定',
              shiftsheet_overflow: '行あふれ' }
};

/** `type` はスタッフの区分（社員など）とログの種類で別物。ログだけ変換する。 */
var VALUE_MAPS_BY_SHEET = { Log: { type: VALUE_MAPS.type } };

/** 数の単位を変える列。分で持っているものを、シートでは時間で見せる。 */
var UNIT_COLUMNS = {
  weekly_cap_min: { toSheet: function (v) { return Number(v) / 60; },
                    fromSheet: function (v) { return Math.round(Number(v) * 60); } },
  // 分で持っているものを「10:00」の形で見せる。24:00 以降は 25:00 のように続けて書く
  start_min: { toSheet: minToHHMM_, fromSheet: hhmmToMin_ },
  end_min:   { toSheet: minToHHMM_, fromSheet: hhmmToMin_ }
};

function minToHHMM_(v) {
  var m = Number(v);
  if (!isFinite(m)) return v;
  return ('0' + Math.floor(m / 60)).slice(-2) + ':' + ('0' + (m % 60)).slice(-2);
}

function hhmmToMin_(v) {
  if (typeof v === 'number') return v;            // すでに分ならそのまま
  var t = String(v).trim();
  var m = t.match(/^(\d{1,2}):(\d{2})$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : Number(t);
}

/** チェックボックスにする列（TRUE/FALSE の英字を見せない）。 */
var BOOL_COLUMNS = { active: true, leader: true, closer: true, enabled: true };

/** その列に使う変換表を返す。無ければ null。 */
function valueMapOf(sheetKey, col) {
  var bySheet = VALUE_MAPS_BY_SHEET[sheetKey];
  if (bySheet && bySheet[col]) return bySheet[col];
  if (col === 'type') return null;              // スタッフの区分はそのまま日本語
  return VALUE_MAPS[col] || null;
}

/** コードの値 → シートに入れる値。 */
function toSheetValue(sheetKey, col, v) {
  if (UNIT_COLUMNS[col] && v !== '' && v !== null && v !== undefined) {
    return UNIT_COLUMNS[col].toSheet(v);
  }
  var map = valueMapOf(sheetKey, col);
  if (map && map[v] !== undefined) return map[v];
  return v;
}

/** シートの値 → コードで使う値。 */
function fromSheetValue(sheetKey, col, v) {
  if (col === 'dow') {
    var i = ['月', '火', '水', '木', '金', '土', '日'].indexOf(String(v).trim());
    return i >= 0 ? i : Number(v);
  }
  if (UNIT_COLUMNS[col] && v !== '' && v !== null && v !== undefined) {
    return UNIT_COLUMNS[col].fromSheet(v);
  }
  var map = valueMapOf(sheetKey, col);
  if (!map) return v;
  var t = String(v).trim();
  for (var k in map) if (map[k] === t) return k;
  return v;                                      // 既にコードの値ならそのまま
}

/* ===================================================================
 * プルダウン
 *
 * 店長が手で触る列は、決まった言葉しか入れられないようにする。
 * 「高校」と書いて22時の制限が効かない、「マネージャー」と書いて店長画面が
 * 開けない、のような書き間違いを入力の時点で止めるため。
 * =================================================================== */

/** シートごと・列ごとの選択肢（シートに見える日本語）。 */
function dropdownsOf(sheetKey) {
  var jp = function (col) {
    var m = VALUE_MAPS[col];
    return Object.keys(m).map(function (k) { return m[k]; });
  };
  return {
    Staff: {
      type: STAFF_TYPES,                 // 社員 / 主婦 / 大学生 / 高校生
      role: jp('role'),                  // スタッフ / 店長
      duty: jp('duty')                   // ホール / キッチン / 両方 / 研修中
    },
    Periods: {
      kind: jp('kind'),                  // 月の暫定 / 週の確認
      status: jp('status')               // 準備中 / 受付中 / 締切後 / 確定済み
    },
    Demand: {
      day_type: jp('day_type')           // 平日 / 土日
    },
    Rules: {
      level: jp('level')                 // 必須 / 注意
    }
  }[sheetKey] || null;
}
