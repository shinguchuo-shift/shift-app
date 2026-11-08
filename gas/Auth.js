/**
 * 本人の特定。
 *
 * いまは開発用モード。Phase 3 で LIFF の IDトークン検証に切り替える。
 * docs/03_screens-and-api.md「認証」参照。
 */

/**
 * 開発用モード。true の間は IDトークンを検証せず、
 * Staff シートの role=manager の人として動く。
 *
 * ⚠ 実データを入れる前に必ず false にすること。
 *    ウェブアプリは「全員（匿名を含む）」に公開されているため、
 *    true のままだと URL を知っている人は誰でも店長として操作できる。
 */
var DEV_MODE = true;

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

  var res = UrlFetchApp.fetch('https://api.line.me/oauth2/v2.1/verify', {
    method: 'post',
    contentType: 'application/x-www-form-urlencoded',
    payload: { id_token: idToken, client_id: channelId },
    muteHttpExceptions: true
  });

  var code = res.getResponseCode();
  if (code === 429 || code >= 500) {
    // 認証失敗と混ぜない。混ぜると「ログインできません」と出て原因が分からなくなる
    throw apiError('authTemporary', '混み合っています。少し待ってもう一度お試しください');
  }
  if (code !== 200) throw apiError('invalidToken', 'ログインし直してください');

  var sub = JSON.parse(res.getContentText()).sub;
  cache.put(key, sub, 600);
  return sub;
}

/** API が返すエラー。 */
function apiError(code, message) {
  var e = new Error(message);
  e.apiCode = code;
  return e;
}
