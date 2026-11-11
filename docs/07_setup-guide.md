# 07 初期設定ガイド

LINE Developers や Google の画面は変わることがある。Claude Code はこの手順を案内する前に、公式ドキュメントで今の手順を確認すること。

## まず押さえること：3つは別物

よく混ざるので先に分ける。

| もの | 何か | この店では |
|---|---|---|
| **店のグループLINE** | スタッフ個人のLINEどうしのグループ | **すでにある。そのまま使う** |
| **LINEログインチャネル ＋ LIFF** | アプリが「誰がタップしたか」を知る仕組み | **必須。無料** |
| **LINE公式アカウント（Messaging API）** | 店が持つボット。自動でメッセージを送る | **任意。最初は作らない** |

**公式アカウントが無くても、紐付けも提出も動く。** 公式ドキュメントで確認した事実：

- 「LIFFアプリを追加できるチャネルタイプは以下の2つです」＝**LINEログイン**／LINEミニアプリ。
  「以下のチャネルタイプにはLIFFアプリは追加できません」＝**Messaging API**
  （[LIFFアプリの開発を始める](https://developers.line.biz/ja/docs/liff/getting-started/)）
- LINEログインチャネルの作成手順に、公式アカウントは前提として出てこない
  （[LINEログインを始めよう](https://developers.line.biz/ja/docs/line-login/getting-started/)）
- 「リンクされたLINE公式アカウント」は**友だち追加オプション**などのための任意設定
  （[LINE公式アカウントをリンクする](https://developers.line.biz/ja/docs/line-login/link-a-bot/)）
- 「LINEログインは…**無料で利用できます**」（[LINEログインの概要](https://developers.line.biz/ja/docs/line-login/overview/)）

**公式アカウントを作らないと使えないもの**：アプリからのプッシュ通知（未提出者へのリマインド）、
リッチメニュー、Webhook での自動返信。
この店は通知を**店長がグループに投稿**する運用なので、無くても回る。

**あとから足せる。** ユーザーIDはプロバイダーごとに一意なので、**同じプロバイダー**に
Messaging API チャネルを足せば、それまでの紐付けはそのまま使える（`03` 参照）。

## 用意するもの

- Google アカウント（店用に分けるのがおすすめ）
- LINE ビジネスID と LINE Developers のアカウント（**LINE公式アカウントは不要**）
- GitHub アカウント
- Node.js（clasp とテスト用）

## 1. スプレッドシートと GAS

1. Google ドライブで新しいスプレッドシート「〇〇店 シフト」を作る
2. 拡張機能 → Apps Script でプロジェクトを開き、スクリプトIDを控える
3. PC で `npm i -g @google/clasp` → `clasp login` → `gas/` で `clasp clone <スクリプトID>`
4. Phase 0 の `Setup.js` を push して、`setupSheets()` を実行
5. デプロイ → 新しいデプロイ → 種類「ウェブアプリ」、実行ユーザー「自分」、アクセス「全員」。URL を控える（これが GAS_URL）

## 2.（任意・あとで）LINE公式アカウントと Messaging API

**最初は飛ばしてよい。** 自動でメッセージを送りたくなったときに作る。
作るときは **手順3と同じプロバイダー**に作ること（別だとユーザーIDが食い違い、紐付けが壊れる）。

1. LINE公式アカウントを作る（無料のコミュニケーションプランから）
2. 公式アカウントの設定で Messaging API を有効にし、**手順3と同じプロバイダー**を選ぶ
3. LINE Developers の Messaging API チャネルで
   - チャネルアクセストークン（長期）を発行 → GAS のスクリプトプロパティ `LINE_CHANNEL_ACCESS_TOKEN`
   - Webhook URL に `GAS_URL?src=line&k=<32文字のランダム>` を設定し、Webhook を ON
4. 公式アカウントの応答設定で「応答メッセージ」を OFF、「Webhook」を ON

## 3. LINEログインチャネルと LIFF（ここが本体）

1. LINE Developers で**プロバイダー**を作る（店の名前でよい）
2. そのプロバイダーに **LINEログインチャネル**を作る。アプリタイプは **［ウェブアプリ］**
3. チャネルID → GAS のスクリプトプロパティ `LINE_LOGIN_CHANNEL_ID`（IDトークン検証に使う）
4. 「リンクされたLINE公式アカウント」は**空のままでよい**（手順2をやった場合だけ設定する）
5. LIFF タブで LIFF アプリを2つ追加
   - スタッフ用：エンドポイント `https://<GitHubユーザー名>.github.io/<リポジトリ名>/index.html`、サイズ Full、スコープ `openid` `profile`
   - 店長用：エンドポイント `.../manager.html`、サイズ Full、スコープ `openid` `profile`
   - ※ `chat_message.write` は**付けない**。グループから開くと受付メッセージがグループに流れてしまうため（`03` 参照）
6. LIFF ID を `web/js/config.js` に書く（LIFF ID は公開されても問題ない）
7. **エンドポイントURLの決まりに注意。**
   > redirectUriに指定したURLが［エンドポイントURL］に設定したURLで始まらない場合、ログイン処理に失敗し、エラー画面が表示されます。
   > （[LIFF v2 APIリファレンス](https://developers.line.biz/ja/reference/liff/) liff.login）

   > liff.init()メソッドはエンドポイントURLと完全に一致、もしくはエンドポイントURLよりも下の階層においてのみ動作します。

   つまり **エンドポイントURLに登録したページ（とその下の階層）でしか LIFF は動かない**。
   `index.html` を登録したなら、`liff-check.html` のような別ファイルでは
   `access.line.me/.../error400?...invalid url...` になる。
   確認用の画面を足すときは、**別ファイルを作らずクエリで分ける**（`index.html?debug=1` など）。
8. **チャネルのステータスを「公開済み」にする。**
   作った直後は「開発中」で、Admin／Tester 権限の人しか使えない。
   ⚠ **「公開済み」から「開発中」には戻せない**と公式に明記されている。先にテスターで動作確認してから公開する

## 4. GitHub Pages ✅ 済（2026-11-08）

- リポジトリ：https://github.com/shinguchuo-shift/shift-app （公開）
- 公開URL：**https://shinguchuo-shift.github.io/shift-app/**
  - スタッフ用：`https://shinguchuo-shift.github.io/shift-app/index.html`
  - 店長用：`https://shinguchuo-shift.github.io/shift-app/manager.html`
- `web/` だけを公開するワークフローは `.github/workflows/pages.yml`。
  `main` に push すると自動で反映される（1〜2分）
- **キャッシュ対策は自動**：JS/CSS の `?v=` をコミットハッシュに書き換えてから公開するので、
  手でバージョンを上げる必要はない
- `gas/.clasp.json` はスプレッドシートIDを含むので公開していない（`.clasp.json.example` が雛形）

### 以前の手順（参考）

1. リポジトリを作り、Settings → Pages → Source を「GitHub Actions」にする。`web/` フォルダだけを公開するワークフロー（`.github/workflows/pages.yml`）は Claude Code に作ってもらう
2. `web/js/config.js` に `GAS_URL` と LIFF ID を設定
3. 公開URLをスマホの LINE で開いて、LIFF が起動するか確認

## 5. グループLINEに貼る

リッチメニューは公式アカウントの機能なので、この構成では使わない。代わりに**リンクを貼る**。

1. スタッフ用の LIFF URL（`https://liff.line.me/<スタッフ用LIFF ID>`）をコピー
2. 店のスタッフ用グループLINEに貼る
3. **グループの「ノート」に貼るか、アナウンスで固定する**（トークが流れても消えないように）
4. 店長用（`https://liff.line.me/<店長用LIFF ID>`）は**グループに貼らない**。店長が自分でブックマークする

スタッフは初回だけ招待コードを入れて紐付け、以降はリンクを押すだけ。

## スクリプトプロパティ一覧

| キー | 中身 |
|---|---|
| LINE_LOGIN_CHANNEL_ID | LINEログインのチャネルID（**必須**） |
| LINE_CHANNEL_ACCESS_TOKEN | Messaging API の長期トークン（手順2をやった場合だけ） |
| WEBHOOK_KEY | Webhook URL に付ける32文字のランダム（手順2をやった場合だけ） |
| DEV_USER_ID | 開発中だけ。設定するとトークン検証をとばしてこのユーザーとして動く。**本番前に必ず消す** |

## 権限の承認でつまずいたら

**承認は「そのとき使っていた権限」の分しか降りない。** あとから `UrlFetchApp`（LINEへの問い合わせ）を
使い始めても、古い承認のままだと `UrlFetchApp.fetch を呼び出す権限がありません` で止まる。
`appsscript.json` に `oauthScopes` を書いてあっても、承認し直すまでは効かない。

直し方：GAS エディタで **`authorize()` を1回実行**する。足りない権限の同意画面が出るので許可する。
実行後、シート・外部通信・設定の状態がトーストで出る。

## 本番前チェック

- [ ] DEV_USER_ID を消した
- [ ] スプレッドシートの共有が「制限付き」（店長と開発者だけ）
- [ ] 招待コードは紐付けたら空になる
- [ ] 実名や LINE ID が GitHub に上がっていない
- [ ] 今月の送信数が Log で数えられている
