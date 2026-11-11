/**
 * 本人の特定。
 *
 * いまは開発用モード。Phase 3 で LIFF の IDトークン検証に切り替える。
 * docs/03_screens-and-api.md「認証」参照。
 */

/**
 * 開発用モード。
 *
 * true の間は IDトークンを検証せず、Staff シートの role=manager の人として動く。
 * ウェブアプリは「全員（匿名を含む）」に公開されているため、
 * true のままだと URL を知っている人は誰でも店長として操作できる。
 *
 * 2026-11-11 に false にした。以後は LIFF の IDトークンを LINE に問い合わせて検証し、
 * Staff シートの line_user_id で本人を特定する。初回は招待コードで紐付ける（me.link）。
 *
 * ⚠ 元に戻さないこと。手元で画面だけ確認したいときは、
 *    ブラウザ側を localhost で開くか ?noliff=1 を付ける（GAS 側は本番のまま）。
 */
var DEV_MODE = false;

/**
 * リクエストから本人を特定して Staff の行を返す。
 * @param {Object} req doPost で受け取った本文
 * @returns {Object} Staff の1行。特定できないときは例外
 */
function identify(req) {
  var staff = readTable('Staff', function (r) { return r.active === true; });

  if (DEV_MODE) {
    // 開発中は誰として見るかを選べる（スタッフ画面の確認に使う）
    if (req && req.devStaffId) {
      var who = staff.filter(function (s) { return s.staff_id === req.devStaffId; })[0];
      if (who) return who;
    }
    var mgr = staff.filter(function (s) { return s.role === 'manager'; })[0];
    if (!mgr) throw apiError('noManager', '権限が manager のスタッフがいません');
    return mgr;
  }

  // --- ここから本番（Phase 3 で有効にする） ---
  if (!req.idToken) throw apiError('noToken', 'ログインが必要です');

  var sub = verifyIdToken_(req.idToken);
  var me = staff.filter(function (s) { return s.line_user_id === sub; })[0];
  if (!me) throw apiError('needsLink', '招待コードの入力が必要です');
  return me;
}

/** 店長だけ通す。 */
function requireManager(req) {
  var me = identify(req);
  if (me.role !== 'manager') throw apiError('forbidden', '権限がありません');
  return me;
}

/**
 * LIFF の IDトークンを LINE に問い合わせて検証し、LINEユーザーID（sub）を返す。
 * 結果は 10分キャッシュする（毎回の外部通信とレート制限を避けるため）。
 */
function verifyIdToken_(idToken) {
  var cache = CacheService.getScriptCache();
  // トークンそのものは長くて秘密なので、ハッシュをキーにする
  var key = 'idt_' + Utilities.base64Encode(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, idToken));

  var hit = cache.get(key);
  if (hit) return hit;

  var props = PropertiesService.getScriptProperties();
  var channelId = props.getProperty('LINE_LOGIN_CHANNEL_ID');
  if (!channelId) throw apiError('config', 'LINE_LOGIN_CHANNEL_ID が未設定です');

  var res;
  try {
    res = UrlFetchApp.fetch('https://api.line.me/oauth2/v2.1/verify', {
      method: 'post',
      contentType: 'application/x-www-form-urlencoded',
      payload: { id_token: idToken, client_id: channelId },
      muteHttpExceptions: true
    });
  } catch (err) {
    // 通信そのものが失敗したとき（LINE側の不調・ネットワーク）
    throw apiError('authTemporary', '認証に時間がかかっています。少し待ってもう一度お試しください');
  }

  var code = res.getResponseCode();
  if (code === 429 || code >= 500) {
    // 認証失敗と混ぜない。混ぜると「ログインできません」と出て原因が分からなくなる
    throw apiError('authTemporary', '混み合っています。少し待ってもう一度お試しください');
  }
  if (code !== 200) throw apiError('invalidToken', 'ログインし直してください');

  var sub;
  try {
    sub = JSON.parse(res.getContentText()).sub;
  } catch (err) {
    throw apiError('invalidToken', 'ログインし直してください');
  }
  if (!sub) throw apiError('invalidToken', 'ログインし直してください');

  cache.put(key, sub, 600);
  return sub;
}

/** API が返すエラー。 */
function apiError(code, message) {
  var e = new Error(message);
  e.apiCode = code;
  return e;
}

/**
 * 追加の権限を承認するための関数。GAS エディタから1回だけ実行する。
 *
 * なぜ要るか：承認は「そのとき使っていた権限」の分しか降りない。
 * あとから UrlFetchApp（LINEへの問い合わせ）を使い始めても、
 * 古い承認のままだと「呼び出す権限がありません」で止まる。
 * この関数が外部通信とシートの両方に触るので、実行すると必要な権限がまとめて出る。
 */
function authorize() {
  var out = [];

  // 1) シート
  try {
    out.push('シート: ' + SpreadsheetApp.getActive().getName());
  } catch (e) {
    out.push('シート: NG ' + e);
  }

  // 2) 外部通信（LINE への問い合わせ）
  try {
    var res = UrlFetchApp.fetch('https://api.line.me/oauth2/v2.1/verify', {
      method: 'post',
      contentType: 'application/x-www-form-urlencoded',
      payload: { id_token: 'dummy', client_id: 'dummy' },
      muteHttpExceptions: true
    });
    // 400 が返れば通信できている（中身はわざと不正なので 400 が正解）
    out.push('外部通信: OK（LINE から ' + res.getResponseCode() + ' が返りました）');
  } catch (e) {
    out.push('外部通信: NG ' + e);
  }

  // 3) キャッシュとプロパティ
  try {
    CacheService.getScriptCache().put('authcheck', '1', 60);
    var ch = PropertiesService.getScriptProperties().getProperty('LINE_LOGIN_CHANNEL_ID');
    out.push('チャネルID: ' + (ch ? '設定済み' : '未設定'));
  } catch (e) {
    out.push('設定: NG ' + e);
  }

  var msg = out.join('\n');
  console.log(msg);
  SpreadsheetApp.getActive().toast(msg, '権限の確認', 10);
  return msg;
}
