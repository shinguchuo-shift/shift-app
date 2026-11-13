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

/**
 * 説明書のスクショ用の見本モード。
 * 手元（localhost）で ?mock=<場面> を付けたときだけ、GAS を呼ばずに見本データ（mock/data.json）を返す。
 * 公開ページ（github.io）では絶対に効かない。見本データの作り方は tools/make-mock.mjs。
 */
const MOCK = (() => {
  const h = location.hostname;
  if (h !== 'localhost' && h !== '127.0.0.1') return null;
  return new URLSearchParams(location.search).get('mock');
})();

/** 見本モードで動いているか。 */
export const isMock = () => !!MOCK;

let mockData = null;

async function mockCall(action, payload) {
  if (!mockData) {
    const all = await fetch('mock/data.json').then(r => r.json());
    mockData = all[MOCK];
    if (!mockData) throw new ApiError('mock', `見本データに「${MOCK}」がありません`);
  }
  await new Promise(r => setTimeout(r, 150));

  if (action === 'me') {
    if (mockData.me.error) throw new ApiError(mockData.me.error, mockData.me.message);
    return JSON.parse(JSON.stringify(mockData.me));
  }
  if (action === 'me.submit') {
    // 出した内容をそのまま「提出済み」にして、完了画面が出せるようにする
    const m = mockData.me;
    const p = (m.month && m.month.id === payload.periodId) ? m.month : m.week;
    p.submitted = true;
    p.requests = {};
    (payload.days || []).forEach(d => { p.requests[d.date] = { start: d.start, end: d.end }; });
    delete p.fromMonth;
    return { periodId: payload.periodId };
  }
  if (action === 'me.link') return { staff: { name: 'スタッフ' } };
  if (action === 'mgr.load') return JSON.parse(JSON.stringify(mockData.mgr));
  return {};                                     // 保存系は何もしない
}

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
  if (MOCK) return mockCall(action, payload);

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
