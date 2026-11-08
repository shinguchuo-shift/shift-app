/**
 * 公開してよい設定だけを置く。
 *
 * ⚠ 秘密情報はここに書かない（GAS のスクリプトプロパティへ）。
 *    このファイルは GitHub Pages でも GitHub のリポジトリでも誰でも読める。
 *
 * ⚠ 下の GAS_URL は「開発用」。中身は架空のサンプルデータで、`gas/Auth.js` の
 *    DEV_MODE が true のまま（誰でも店長として操作できる）。
 *    **本番は別のスプレッドシート・別のデプロイを作り、DEV_MODE を false にしてから
 *    その URL に差し替える。** 開発用と本番を混ぜない。
 */

/** GAS のウェブアプリ URL（末尾は /exec）。 */
export const GAS_URL =
  'https://script.google.com/macros/s/AKfycbx5lFeB_CnbDFoz80PFVckb-HGnvllbX_Ps0aAvDSwkdAIh8xEfCDv6jUAeLeWafRThmA/exec';

/** LIFF ID。Phase 3 で LINE Developers で作ったら入れる。公開されても問題ない。 */
export const LIFF_ID_STAFF = '';
export const LIFF_ID_MANAGER = '';
