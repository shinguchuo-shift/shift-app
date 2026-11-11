/**
 * ウェブアプリの入口。doPost で action を振り分ける。
 * docs/03_screens-and-api.md 参照。
 *
 * 約束ごと：
 *  - 返り値は必ず {ok:true, data} / {ok:false, error, message} の形。
 *    GAS はリダイレクトを挟むのでHTTPステータスが使えない
 *  - 例外は必ず捕まえる。捕まえないと JSON ではなく HTML のエラーページが返り、
 *    フロント側の JSON.parse が落ちて原因が分からなくなる
 *  - 書き込み系は LockService で囲む。読み取り専用は囲まない
 *    （囲むと〆切直前に全員が直列化して詰まる）
 */

/** 書き込みを伴う action。ここに入れたものだけロックする。 */
var WRITE_ACTIONS = {
  'me.link': true, 'me.submit': true,
  'mgr.saveShifts': true, 'mgr.saveRules': true, 'mgr.saveDemand': true,
  'mgr.saveStaff': true, 'mgr.saveUsual': true, 'mgr.saveNote': true,
  'mgr.openPeriod': true, 'mgr.setStatus': true, 'mgr.publish': true
};

function doPost(e) {
  var req = {};
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return respond({ ok: false, error: 'badRequest', message: '本文が JSON ではありません' });
  }

  var lock = null;
  try {
    if (WRITE_ACTIONS[req.action]) {
      lock = LockService.getScriptLock();
      if (!lock.tryLock(30000)) {
        return respond({ ok: false, error: 'busy', message: '混み合っています。もう一度お試しください' });
      }
    }
    return respond({ ok: true, data: route(req.action, req) });

  } catch (err) {
    logError_(req.action, err);
    return respond({
      ok: false,
      error: err.apiCode || 'server',
      message: err.apiCode ? err.message : 'サーバーでエラーが起きました'
    });

  } finally {
    if (lock) {
      SpreadsheetApp.flush();   // 書き込みを確定させてから離す
      lock.releaseLock();
    }
  }
}

/** action の振り分け。 */
function route(action, req) {
  var p = req.payload || {};
  switch (action) {
    case 'ping':            return { pong: true, devMode: DEV_MODE, at: new Date().toISOString() };
    case 'me':              return meLoad(req, p);
    case 'me.link':         return meLink(req, p);
    case 'me.submit':       return meSubmit(req, p);
    case 'mgr.load':        return mgrLoad(req, p);
    case 'mgr.saveShifts':  return mgrSaveShifts(req, p);
    case 'mgr.saveRules':   return mgrSaveRules(req, p);
    case 'mgr.saveNote':    return mgrSaveNote(req, p);
    case 'mgr.openPeriod':  return mgrOpenPeriod(req, p);
    case 'mgr.setStatus':   return mgrSetStatus(req, p);
    case 'mgr.publish':     return mgrPublish(req, p);
    default:
      throw apiError('unknownAction', '知らない操作です: ' + action);
  }
}

/** エラーを Log シートに残す。IDトークンや本文は残さない。 */
function logError_(action, err) {
  try {
    appendRowTo('Log', {
      at: new Date(), type: 'error', staff_id: '',
      detail: (action || '?') + ': ' + (err && err.stack ? err.stack : String(err)).slice(0, 2000)
    });
  } catch (e) { /* ログで落ちても本体は落とさない */ }
}

/** JSON 文字列として返す。 */
function respond(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ---------- 開発中だけの GET。Phase 3 で消す ---------- */

function doGet(e) {
  var action = e && e.parameter ? e.parameter.action : null;
  try {
    // 設定が入っているかの確認（値そのものは返さない）。開発中だけ
    if (action === 'config') {
      var props = PropertiesService.getScriptProperties();
      var ch = props.getProperty('LINE_LOGIN_CHANNEL_ID');
      return respond({
        ok: true,
        devMode: DEV_MODE,
        チャネルID: ch ? '設定済み（' + String(ch).length + '桁、末尾 ' + String(ch).slice(-4) + '）' : '未設定',
        スクリプトプロパティの数: props.getKeys().length,
        キー一覧: props.getKeys()
      });
    }
    if (action === 'status') {
      var ss = SpreadsheetApp.getActive();
      return respond({
        ok: true, spreadsheet: ss.getName(), devMode: DEV_MODE,
        sheets: ss.getSheets().map(function (sh) {
          return { name: sh.getName(), rows: Math.max(0, sh.getLastRow() - 1) };
        })
      });
    }
    // サンプルデータを作り直す。開発中だけ。Phase 3 で消す
    if (action === 'setup' && e.parameter.confirm === 'yes') {
      var removed = removeOldEnglishSheets_();
      setupAll();
      return respond({
        ok: true, removed: removed,
        sheets: SpreadsheetApp.getActive().getSheets().map(function (s) { return s.getName(); })
      });
    }
    if (action === 'buildsheet') {
      var out = buildShiftSheet(e.parameter.period || PERIOD_ID);
      return respond({ ok: true, sheet: out.getName(), rows: out.getLastRow(), overflow: out.overflow || [] });
    }
    if (action === 'dumpsheet') {
      var s = SpreadsheetApp.getActive().getSheetByName(e.parameter.name);
      if (!s) return respond({ ok: false, error: 'notfound' });
      var rng = s.getRange(1, 1, s.getLastRow(), s.getLastColumn());
      var widths = [];
      for (var c = 1; c <= s.getLastColumn(); c++) widths.push(s.getColumnWidth(c));
      return respond({
        ok: true,
        values: rng.getDisplayValues(), colors: rng.getBackgrounds(),
        fontColors: rng.getFontColors(), widths: widths,
        merges: s.getRange(1, 1, s.getLastRow(), s.getLastColumn()).getMergedRanges()
          .map(function (m) { return [m.getRow(), m.getColumn(), m.getNumRows(), m.getNumColumns()]; })
      });
    }
    return respond({ ok: true, message: 'シフト作成アプリ API', devMode: DEV_MODE });
  } catch (err) {
    logError_('GET:' + action, err);
    return respond({ ok: false, error: 'server', message: String(err) });
  }
}
