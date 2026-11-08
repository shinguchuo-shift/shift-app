/**
 * GAS の API を呼ぶ。CORS まわりの作法をここに閉じ込める。
 *
 * 守ること（docs/03）：
 *  - Content-Type は text/plain。application/json にするとプリフライト（OPTIONS）が飛び、
 *    GAS は OPTIONS を処理できないので必ず失敗する
 *  - レスポンスヘッダもHTTPステータスも読めない（GAS が別ドメインへリダイレクトするため）。
 *    成否は本文の ok で判断する
 *  - GAS で例外が出ると JSON ではなく HTML のエラーページが返る。
 *    JSON.parse は必ず try/catch で囲む
 */

import { GAS_URL } from './config.js?v=2';

/** API のエラー。画面側で error コードを見て出し分ける。 */
export class ApiError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/**
 * action を呼ぶ。
 * @param {string} action 例 'mgr.load'
 * @param {Object} payload
 * @param {Object} opts { idToken, timeoutMs, devStaffId }
 */
export async function call(action, payload = {}, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs || 60000);

  let text;
  try {
    const res = await fetch(GAS_URL + '?src=app', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action,
        idToken: opts.idToken || null,
        // 開発中だけ：誰として見るか。本番（DEV_MODE=false）では無視される
        devStaffId: opts.devStaffId || null,
        payload
      }),
      redirect: 'follow',
      signal: ctrl.signal
    });
    text = await res.text();
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new ApiError('timeout', '時間内に応答がありませんでした。通信を確かめてもう一度お試しください');
    }
    throw new ApiError('network', '通信できませんでした。GAS_URL とデプロイの設定を確かめてください');
  } finally {
    clearTimeout(timer);
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    // HTML が返ってきている＝GAS 側で例外、または承認が必要な状態
    throw new ApiError('badResponse', 'サーバーから予期しない応答が返りました（GAS 側のエラーか、承認が必要です）');
  }

  if (!data.ok) throw new ApiError(data.error || 'server', data.message || 'エラーが起きました');
  return data.data;
}

/** 1回だけ自動で再試行する（混雑時の busy 用）。 */
export async function callRetry(action, payload, opts) {
  try {
    return await call(action, payload, opts);
  } catch (err) {
    if (err.code === 'busy') return await call(action, payload, opts);
    throw err;
  }
}
