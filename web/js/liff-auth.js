/**
 * LIFF（LINE内ブラウザ）でのログインと本人確認。
 *
 * 考え方：
 *  - LIFF ID が設定されていなければ、何もしないで通す（開発中はこれ）
 *  - 設定されていれば liff.init() → 未ログインなら liff.login()
 *  - 以後、API 呼び出しに IDトークンを添える
 *
 * グループLINEから開かれることを前提にしている（docs/03「グループLINEから使う場合」）。
 * そのため `liff.sendMessages()` は使わない。使うとグループに投稿が流れてしまう。
 */

import { LIFF_ID_STAFF, LIFF_ID_MANAGER } from './config.js?v=3';

const SDK = 'https://static.line-scdn.net/liff/edge/2/sdk.js';

let ready = false;
let idToken = null;
let context = null;      // { type: 'utou' | 'group' | 'room' | 'external' | 'none' }

/** 読み込んだページに応じた LIFF ID。 */
function liffIdFor(kind) {
  return kind === 'manager' ? LIFF_ID_MANAGER : LIFF_ID_STAFF;
}

/** SDK を1回だけ読み込む。 */
function loadSdk() {
  if (window.liff) return Promise.resolve();
  return new Promise((ok, ng) => {
    const s = document.createElement('script');
    s.src = SDK;
    s.onload = ok;
    s.onerror = () => ng(new Error('LIFF SDK を読み込めませんでした'));
    document.head.appendChild(s);
  });
}

/**
 * 起動する。
 * @param {'staff'|'manager'} kind
 * @returns {Promise<{enabled:boolean, context:Object|null}>}
 *   enabled=false なら LIFF を使っていない（開発中のブラウザ表示）
 */
export async function start(kind) {
  const id = liffIdFor(kind);
  if (!id) return { enabled: false, context: null };   // 未設定なら素通り

  await loadSdk();
  await liff.init({ liffId: id });

  if (!liff.isLoggedIn()) {
    // ログイン後にこのページへ戻ってくる
    liff.login({ redirectUri: location.href });
    await new Promise(() => {});                        // 画面が遷移するので以降は実行されない
  }

  idToken = liff.getIDToken();
  context = liff.getContext();
  ready = true;
  return { enabled: true, context };
}

/** API に添える IDトークン。LIFF を使っていなければ null。 */
export const getIdToken = () => idToken;

/** LIFF の中で動いているか。 */
export const isReady = () => ready;

/**
 * グループ・複数人トークから開かれたか。
 * ここが true のときは、本人以外の目に触れる操作（トークへの投稿）をしない。
 */
export const isGroup = () => !!context && (context.type === 'group' || context.type === 'room');

/** LINEアプリの中か（外部ブラウザだと false）。 */
export const inLineApp = () => !!context && context.type !== 'external';
