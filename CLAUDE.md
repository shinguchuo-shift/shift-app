# シフト作成アプリ（ファストフード店向け）

Claude Code はこのファイルを最初に読み、`docs/` の順番どおりに理解してから作業すること。

## このプロジェクトは何か

ファストフード店（スタッフ約20名、営業 **8:00〜24:00**、ホール／キッチン）のシフト作成を楽にするアプリ。

**2026-11-08 オーナーOK。本番環境へ進む段階。**

- 区分：**社員 / 主婦 / 大学生 / 高校生**。**高校生は22時まで**（労働基準法。`TYPE_END_LIMIT` でロジックが止める）
- 担当業務：**キッチン / ホール / 両方 / 研修中**。ポジション別レベル0〜3は**廃止**
- 希望の出し方は2段階：**月の暫定 → 週の確認**

- スタッフは **LINEの中で** 希望シフトを出す（「いつも通りで提出」ボタン1つで終わるのが基本）
- 店長は希望とスキルをもとに **叩き台を自動作成** → 手直し → 紙と同じ形式の **週間シフト表** を出す
- 動くデモが `reference/shift-demo.html` にある。画面・用語・自動作成ロジックの正解はこのデモ。迷ったらデモを開いて合わせる

## 開発者について（重要）

- オーナーは溝口（みっちー）。プログラミングは独学の初心者、Excel・Googleスプレッドシートは得意。LINE Messaging API × GAS × スプレッドシートでアプリを作った経験あり
- 説明は日本語で、専門用語には一言説明を添える
- 1回の作業は小さく区切り、各ステップの最後に「何ができたか」「どう確認するか」を短く伝える
- ファイル構成を大きく変える・ライブラリを追加する・データ構造を変える時は、先に理由を説明して確認を取る
- オーナーが自分で手を動かす作業（LINE Developersの設定など）は、画面のどこを押すかまで手順で示す

## 技術構成（決定済み）

| 役割 | 技術 | 補足 |
|---|---|---|
| データ | Google スプレッドシート | 店長が直接見て直せることを優先。設計は `docs/02_data-model.md` |
| バックエンド | Google Apps Script（Webアプリ） | `doPost` で JSON API、LINE Webhook、時間主導トリガー |
| スタッフ画面 | LIFF（静的HTML/JS） | GitHub Pages で公開。LIFF SDK で本人のLINE IDを取得 |
| 店長画面 | 同じ静的サイトの `manager.html`（LIFF） | スタッフシートの `role=manager` の人だけ使える |
| 自動作成ロジック | 純粋なJS（`web/js/scheduler.js`） | ブラウザで実行。Node でテストできるよう DOM に依存しない |
| 本人の識別 | LINEログインチャネル ＋ LIFF | **LINE公式アカウントは不要**。無料。`docs/07` 参照 |
| 通知 | 店長がグループLINEに投稿 | アプリは文面を出すだけ。Messaging API は当面使わない |
| デプロイ | `clasp`（GAS）、GitHub Pages（web） | |

フレームワーク（React等）やビルドツールは使わない。素のHTML/CSS/JS（ES Modules）で書く。デモのCSSトークンとUIをそのまま流用してよい。

## フォルダ構成（目標）

```
gas/                 Apps Script（clasp で push）
  appsscript.json
  Api.js             doPost のルーティング
  Auth.js            LIFF IDトークン検証、スタッフ特定
  Sheets.js          シート読み書き（列名ベースでアクセス）
  Line.js            Messaging API 送信・Webhook
  Jobs.js            募集開始・リマインドのトリガー
  ShiftSheet.js      紙形式のシフト表シートを出力
web/                 GitHub Pages で公開
  index.html         スタッフ用（LIFF）
  manager.html       店長用（LIFF）
  css/app.css
  js/api.js          GAS 呼び出し
  js/scheduler.js    自動作成・チェック（デモから移植）
  js/staff.js
  js/manager.js
test/
  scheduler.test.mjs node --test で実行
docs/                仕様（このフォルダ）
reference/           デモ
```

## 守ること

- **個人情報**：スタッフの実名・LINEユーザーID・スプレッドシートIDを Git にコミットしない。秘密情報（チャネルアクセストークン等）は GAS の「スクリプト プロパティ」に置く。`.gitignore` を最初に作る
- **認証**：GAS の API は毎回、LIFF の IDトークンを LINE の verify エンドポイントで検証してから処理する。フロントから送られた userId をそのまま信用しない
- **CORS**：GitHub Pages → GAS の fetch は `Content-Type: text/plain` で JSON 文字列を送り、プリフライトを発生させない（GAS は OPTIONS を処理できない）
- **時刻**：**保存と受け渡しは「営業日の0:00からの分」**（整数）。24:00 = 1440、翌3:00 = 1620。表示だけ `HH:MM` に変換。`grid_min` は 60 固定（30分単位はやらない）
- **自動作成の内部は「スロット番号」で計算する。分で計算しない。** 分を入れると全候補がマイナス点になり、エラーも出ずに空のシフトが返る。`docs/04`「単位のルール」を必ず先に読む
- **曜日**：月曜始まり（0=月 … 6=日）でデモと揃える
- **シートの列は名前で引く**（列番号を直書きしない）。店長が列を並べ替えても壊れないように
- **文字列で持ちたい列は Schema.js の `TEXT_COLUMNS` に入れる。** `2026-11-02` のような値は放っておくと日付に変換され、読むと `46327` のような数値で返る
- **スプレッドシートは日本語、コードは英語のキー。** タブ名と列見出しの対応は `gas/Schema.js` にまとめてある。
  列を増やす・名前を変えるときは Schema.js だけ直す。シートの1行目（見出し）は書き換えないよう店長に伝えること
- **自動作成ロジックはテストを書いてから直す**。`test/` にデモと同じサンプルデータを使ったテストを置く
- **書き込みは行を消さない**。`rev` を増やして追記し、読み出しは最新だけを採る。書き込み系は `LockService.getScriptLock()` で囲む（読み取り専用は囲まない）
- **シートの値を `innerHTML` に入れる前に必ずエスケープする**。名前・備考・店長メモが対象
- 送信メッセージ数を増やす変更（プッシュ通知の追加）は、月の送信数の見積もりを添えて相談する

## 作業するときに踏みやすい罠

- **ローカル確認は HTTP サーバで開く**。`cd web && python3 -m http.server 8000` → `http://localhost:8000/`。`index.html` をダブルクリックすると ES Modules が CORS で全滅し、画面が真っ白になる
- **GAS は `clasp push` だけでは `/exec` に反映されない**。「デプロイを管理」→ 鉛筆アイコン → バージョン「新バージョン」→ デプロイ、が必要。`clasp deploy -i <deploymentId>` でコマンド化しておくとよい
- **`.clasp.json` はコミットしてよい**。scriptId は秘密情報ではない（アクセス制御は Google 側の共有設定）。`.gitignore` に入れると `clasp push` が動かなくなる
- **GitHub Pages は10分キャッシュする**。JS/CSS の読み込みに `?v=<コミットハッシュ>` を付ける。
  **`import` の行にも付けること。** HTML の `<script src>` だけ変えても、その中の `import './api.js'` は古いまま読まれる。付けないと「直したのに直らない」で時間を失う。LIFF ブラウザのキャッシュはさらに読みにくい
- **LIFF ブラウザに DevTools がない**。`window.onerror` を拾って画面に出す開発モードを早めに作る
- **GAS の承認は「そのとき使っていた権限」の分しか降りない**。あとから外部通信などを足したら
  `authorize()` を1回実行して承認し直す。`appsscript.json` に書くだけでは効かない。
  **確認用の関数を try/catch で囲まないこと。** 囲むと権限エラーを握りつぶして「実行完了」になり、
  承認画面が出ないまま詰まる（実際に踏んだ）
- **LIFF はエンドポイントURLより下の階層でしか動かない**。`index.html` を登録したなら `other.html` では
  `invalid url` で弾かれる。確認用の画面は別ファイルにせず、クエリで分ける（`index.html?debug=1`）
- **GAS の例外は HTML のエラーページとして返る**。`doPost` 全体を try/catch し、`Log` に `error.stack` を書いてから `{ok:false}` を返す
- **GAS は速くない**。往復だけで約1.4秒かかる。画面には必ず経過を出すこと（何も変わらないと「固まった」と思われる）
- **たくさんのシートを読むときは `prefetchTables()` を使う**。`getDataRange().getValues()` は1枚あたり約0.3秒で、10枚読むと3秒。
  Advanced Sheets Service の `batchGet` なら10枚で約0.25秒（実測で `mgr.load` が 4.7秒 → 1.8秒）。
  `readTable()` は1実行のあいだ結果を覚えるので、同じシートを2回読んでも通信は1回で済む
- **batchGet で読むと値の型が変わる**。`valueRenderOption: 'UNFORMATTED_VALUE'` を指定しないと TRUE/FALSE や数値が文字列で返る。
  日付はシリアル値（数値）で返るので、**日付は必ず `dateKey_()` を通してから比べる・Date にする**

## 読む順番

1. `docs/01_requirements.md` 要件・業務フロー・機能の優先順位
2. `docs/02_data-model.md` スプレッドシート設計
3. `docs/03_screens-and-api.md` 画面・API・LINE連携
4. `docs/04_scheduler-logic.md` 自動作成とチェックのロジック
5. `docs/05_implementation-plan.md` 実装ステップ（この順で進める）
6. `docs/06_open-questions.md` 店舗に未確認のこと（ここに関わる実装は仮置きにして目印を残す）
7. `docs/07_setup-guide.md` LINE・GAS・GitHub Pages の初期設定

## 今どこまで進んでいるか

- [x] デモ（`reference/shift-demo.html`）で店長に見せる前提の画面とロジックを確認済み
- [x] 技術レビュー済み（2026-11-01）。成立しない前提を洗い出し、各 docs に反映した
- [x] オーナー確認済み：LINE公式アカウントOK／本部システムなし／表の軸は現状維持／30分単位なし／中抜けなし／希望はLINEグループで収集／既存アプリは使わない
- [x] 元の紙のシフト表を写真で確認し、`docs/01` の形式を実物ベースに更新
- [ ] **元の Excel ファイルが未入手**。「_シフト表テンプレート」 の元にするので、手に入ると Phase 5 が大幅に楽になる
- [ ] `06` の #20〜22（お金・保守）が未確認。友人案件なので着手前に決めておく
- [x] **Phase 0a（CORS 疎通テスト）完了（2026-11-03）。** `text/plain` の POST が通ることを実測で確認。`application/json` は失敗するので、プリフライト回避が効いている証拠も取れた。詳細は `docs/05`
- [x] clasp でスプレッドシート「シフト作成アプリ（開発）」とコンテナバインドのスクリプトを作成済み。`gas/.clasp.json` に scriptId / parentId あり
- [x] **Phase 0b 済**：`.gitignore`、`gas/Sheets.js`（列名で読み書き）、`gas/Setup.js`（12シート＋サンプル20人）、`gas/SampleData.js`（デモと同じ seed 固定データ）
- [x] **Phase 1a 済**：`web/js/scheduler.js` に generate / checks を純粋関数として移植。`test/scheduler.test.mjs` が15本通る（`node --test test/scheduler.test.mjs`）。生成27ms、66件配置
- [x] **Phase 5 先行着手**：`gas/ShiftSheet.js` で紙形式の出力。オーナーの最優先要件なので前倒しした
- [x] **GAS 承認済み・`setupAll()` 実行済み**。12シートにサンプルデータが入っている（Staff 20、Requests 91、Shifts 66 ほか）
- [x] **紙形式のシフト表が出た**（`シフト表_2026-11-02`、93行×22列）。軸7:00〜翌3:00、日ごとの時刻見出し、12行の行詰め、土=青字・日=赤字、備考、注意書きまで実物どおり。あふれゼロ
- [ ] **実物の Excel が未入手**。もらえたら 「_シフト表テンプレート」 にして印刷設定ごと流用する（A4縦はコードから設定できないため）
- [x] **Phase 2 の一部 済**：`gas/Api.js`（doPost ルーティング・try/catch・LockService）、`gas/Auth.js`（開発用モード＋IDトークン検証の実装）、`gas/Mgr.js`（mgr.load / saveShifts / saveRules / saveNote / publish）
- [x] **Phase 4（店長画面）の第一版 済**：`web/manager.html` ＋ `web/js/manager.js` ＋ `web/css/app.css` ＋ `web/js/api.js`。4タブ（提出状況・シフト表・自動作成・スキル）が実データで動く。自動作成はブラウザで24ms
- [ ] ⚠ **`gas/Auth.js` の `DEV_MODE` が `true`。** 実データを入れる前に必ず `false` にする（ウェブアプリは匿名公開なので、true のままだと URL を知る人が誰でも店長として操作できる）
- [x] **手直し 済**：バーを押して時間変更・ホール/キッチン切替・外す／空きマスを押してその日に出られる人から追加／全部消して手で組む。希望の外に入れた分は赤枠と「!」で区別し、件数も出す。変更のたびにチェックを再計算
- [x] **提出状況に希望の一覧表** を追加（行＝スタッフ、列＝曜日、週合計と上限、日ごとの出られる人数）
- [x] **対象週の切り替えと「新しい月を開く」済**（2026-11-08）。`mgr.openPeriod` が月の暫定＋その月の週をまとめて作る。`mgr.setStatus` で受付の開け閉め
- [ ] 店長画面の未実装：スキルカードの編集、必要人数の編集、備考の編集
- [x] **スタッフ画面の第一版 済**：`web/index.html` ＋ `web/js/staff.js`。**月の暫定 → 週の確認** の2段階（`06` #10）。週の初期値は「いつもの勤務」ではなく**その月の暫定**。「このままで提出」1タップ、暫定から変えた日には印
- [x] **期間シートが2種類に**：`kind`（month / week）と `parent_id`。月の暫定も週の確認も同じ `希望` シートに入る
- [x] **区分・担当業務・営業時間を本番仕様に**（2026-11-08）。テスト18本が通る
- [x] **月の暫定を日ごとにも入れられる**（2026-11-08）。曜日でまとめて決めてから、カレンダーで日ごとの例外を上書きする。下書きは日ごとに持つ
- [ ] スタッフ画面の未実装：招待コードでの紐付け画面、確定シフトの表示（N2）、受付期間外の出し分け
- [x] **GitHub Pages 公開済み**（2026-11-08）: https://shinguchuo-shift.github.io/shift-app/
  リポジトリ https://github.com/shinguchuo-shift/shift-app （公開）。`main` に push すると自動で反映
- [x] **LIFF の受け口を用意**（`web/js/liff-auth.js`）。LIFF ID が未設定なら素通りするので、今までどおりブラウザでも動く
- [ ] **次**：LINE Developers でプロバイダー＋LINEログインチャネル＋LIFF を作る（`docs/07` 手順3）
- [x] **本番認証に切り替え済み**（2026-11-11）。`DEV_MODE = false`。IDトークンを LINE に問い合わせて検証し、
  Staff の `line_user_id` で本人を特定する。初回は招待コード（`me.link`）で紐付け。
  トークン無し・偽トークン・`devStaffId` でのなりすましは、すべて弾かれることを確認済み
- [x] **スプレッドシートに「シフトアプリ」メニューを追加**（2026-11-11）。スタッフの追加・退職・復帰・
  招待コードの発行をメニューから行う。手でセルをいじらせない
- [x] **確認用の口を本番で封鎖**。`DEV_MODE` が false のとき `?action=setup` などは `devOnly` で拒否
- [ ] **実データはまだ入れていない**（中身は架空のサンプル20人）。実名を入れる前に `06` #19 を確認する
- [ ] Phase 1b（スロット単位へのリファクタ）

## 開発中だけの仕掛け（Phase 2 で消す）

`gas/PingTest.js` の `doGet` に開発用のアクションを置いている。ブラウザや curl から叩ける：

| URL | 用途 |
|---|---|
| `?action=status` | シートの一覧と行数 |
| `?action=buildsheet` | シフト表を出力 |
| `?action=dumpsheet&name=...` | シートの値・色・結合を JSON で吸い出す |

吸い出した JSON は `node tools/preview-sheet.mjs <dump.json> <out.html>` で HTML に起こせる。
スプレッドシートを開かずに見た目を確認するためのもの。`Api.js` を作るときに `PingTest.js` ごと消す。
