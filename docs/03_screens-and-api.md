# 03 画面・API・LINE連携

## 全体の流れ

```
[スタッフのLINE] ─リッチメニュー→ [LIFF: web/index.html] ──fetch(text/plain)──┐
[店長のLINE/PC] ──────────────→ [LIFF: web/manager.html] ─fetch(text/plain)──┤
                                                                              ▼
                                                  [GAS Webアプリ doPost]  ⇄  [スプレッドシート]
[LINEプラットフォーム] ──Webhook──→ [GAS doPost(webhook)]    [GAS 時間主導トリガー] → Messaging API
```

- Webアプリ1本で API と Webhook の両方を受ける。LINE からの Webhook は `x-line-signature` ヘッダがあるが、GAS の `doPost(e)` ではヘッダが読めない（公式のイベントオブジェクトに headers が含まれない）。**GAS 単体では署名検証は実装できない。** そのため **Webhook 用と API 用でデプロイ URL のクエリを分ける**（`?src=line` と `?src=app`）
- **Webhook 用の URL には推測不能な秘密を足す**：`?src=line&k=<32文字のランダム>`。この値はスクリプトプロパティ `WEBHOOK_KEY` に置き、LINE Developers の Webhook URL 設定欄にだけ入れる。GitHub には絶対に出さない。API 用の URL（`?src=app`）は `web/js/config.js` に書くので**公開される**。両者で別の値にすること
- Webhook 側でやってよいのは「受け取った `replyToken` で返信する」だけ。**本文の userId を一切信用せず、シートへの書き込みもしない**。`replyToken` は LINE プラットフォームしか発行できないので、偽のリクエストを投げられても誰かに勝手なメッセージを送ることはできない
- 送信元を問わず、データを書き換える処理は必ず API 経由（IDトークン検証あり）
- 将来「LINEのトークから何かを更新する」機能が欲しくなったら、**この構成では安全に作れない**。署名検証を外部（Cloudflare Workers 等）で行って GAS に中継する形に変える必要がある

## 認証

1. LIFF で `liff.init()` → 未ログインなら `liff.login()`
2. `liff.getIDToken()` で IDトークンを取得し、すべての API 呼び出しの本文に `idToken` として入れる
3. GAS は `https://api.line.me/oauth2/v2.1/verify` に `id_token` と `client_id`（LINE Login チャネルID）を POST して検証。返ってきた `sub` が LINE ユーザーID
4. Staff シートの `line_user_id` で本人を特定。未登録なら `needsLink` を返す
5. 店長 API は `role=manager` の人だけ通す

**検証結果はキャッシュする。** `CacheService.getScriptCache()` に「IDトークンの SHA-256 ハッシュ → sub」を5〜10分入れる。IDトークンそのものをキャッシュキーにしない（長いうえに秘密）。毎回の外部通信（200〜500ms）が消え、レート制限にも当たらなくなる。

**LINE 側のレート制限は非公開**で、超えると 429 が返る。429 と 5xx は認証失敗と**別のエラーコード**にすること：

- `invalidToken` … トークンが不正。再ログインさせる
- `authTemporary` … 429 / 5xx。「混み合っています。少し待ってもう一度お試しください」と出す

429 を「ログインできません」と表示すると原因が分からなくなる。

クォータは心配ない。UrlFetchApp は1日20,000回（無料の Google アカウント）に対し、20人の店なら**1日平均16回**程度。

### 招待コード（`link`）

- コードは **8桁以上の英数**。IDトークン検証は「本物の LINE ユーザーか」しか保証せず、「**どのスタッフか**」を守っているのは招待コードだけ。4桁だと1万通りに有効コードが20個あり、自動化すれば数分で全員分特定できてしまう
- `invite_expires_at` を過ぎたコードは拒否する
- 失敗は `Log` に記録し、**同じ LINE ユーザーが5回続けて失敗したら一定時間拒否**する
- 紐付けに成功したら `invite_code` を空にする

## API（`POST {GAS_URL}?src=app`、本文は JSON 文字列、`Content-Type: text/plain;charset=utf-8`）

本文の形：`{ "action": "名前", "idToken": "...", "payload": { ... } }`
返り値の形：`{ "ok": true, "data": ... }` または `{ "ok": false, "error": "コード", "message": "人が読める説明" }`

ステータスコードとレスポンスヘッダは使えない（GAS が `script.googleusercontent.com` へリダイレクトするため）。成否は必ず本文の `ok` で判断する。

**GAS 側で例外が出ると、JSON ではなく HTML のエラーページが返る。** `doPost` 全体を try/catch で囲み、catch で `Log` に `error.stack` を書いてから `{ok:false}` を返すこと。フロント側も `JSON.parse` を try/catch で囲み、失敗したら「サーバーエラー」として扱う。これは最初に書くコード。

**書き込み系の action は `LockService.getScriptLock().waitLock(30000)` で囲む。** 読み取り専用（`me` / `mgr.load`）はロックしない。`waitLock` が取れなかったら `{ok:false, error:"busy"}` を返し、フロントは1回だけ自動で再試行する。

### スタッフ用

| action | payload | 返り値 data |
|---|---|---|
| `me` | なし | `{ staff, period, submission, requests, usual }` 未紐付けなら error `needsLink` |
| `link` | `{ inviteCode }` | `{ staff }` 招待コードが一致した行に line_user_id を書く |
| `submit` | `{ periodId, method: "usual"\|"custom", days: [{date,start,end}], saveAsUsual }` | `{ submission, requests }` 〆切後は error `closed` |

`submit` 成功後の受付メッセージは下の「LINE メッセージ」の応答方式で送る（送信数を使わないため）。

### 店長用

| action | payload | 返り値 data |
|---|---|---|
| `mgr.load` | `{ periodId }` | 店長画面に必要な全データ（Settings, Staff, Positions, UsualPattern, Requests, Submissions, Demand, Rules, Shifts, DayNotes） |
| `mgr.saveStaff` | `{ staff }` | 1人分のスキルカードを保存（NGは両方向に反映） |
| `mgr.saveUsual` | `{ staffId, days }` | いつもの勤務を保存 |
| `mgr.saveDemand` | `{ rows }` | 必要人数を保存 |
| `mgr.saveRules` | `{ rules }` | ルールのON/OFF |
| `mgr.saveShifts` | `{ periodId, revision, shifts }` | 叩き台・手直し結果を丸ごと保存。`revision` が現在値と違えば保存せず error `conflict` |
| `mgr.saveNote` | `{ date, text }` | 備考 |
| `mgr.openPeriod` | `{ month: '2026-12' }` | **新しい月を開く。** 月の暫定（`open`）と、その月に含まれる週（`draft`）をまとめて作る |
| `mgr.setStatus` | `{ periodId, status }` | 受付を開ける／締める（`draft` / `open` / `closed` / `published`） |
| `mgr.publish` | `{ periodId }` | 確定。ShiftSheet を出力し、status を published に |

自動作成とチェックは **ブラウザ側**（`scheduler.js`）で行い、結果を `mgr.saveShifts` で保存する。GAS の実行時間もクォータも使わずに済む（実測12ms）。

`mgr.load` は10シートを一度に返す。`Sheets.js` の `readTable(name)` は**必ず1回の `getValues()` で全件読む**契約にする。`getRange(i,j).getValue()` をループで回すと100倍遅くなる（初心者が最も踏む落とし穴）。書き込みも `setValues` で2次元配列を一発。ロックを解放する直前に `SpreadsheetApp.flush()` を呼ぶ。

`manager.html` は公開URLなので**誰でも画面を開ける**。データは API が `role=manager` で弾くので安全。画面を開いた直後の `mgr.load` が拒否されたら「権限がありません」とだけ表示する。

## スタッフ画面（web/index.html）

デモ①「LINEで開いた画面のイメージ」をそのまま実装する。

| 状態 | 表示 |
|---|---|
| 未紐付け | 「招待コードを入力してください」＋入力欄（コードは店長が口頭で伝える） |
| 受付中・未提出・いつもの勤務あり | 名前、対象週、〆切、「いつもの勤務」一覧、［いつも通りで提出］（大）［今週は変える］ |
| 受付中・未提出・いつもの勤務なし | ［希望を入力する］ |
| 月の暫定（入力） | 「曜日でまとめて」と「日ごとに直す」の2つ。曜日を変えるとその曜日すべてに入り、カレンダーで日ごとの例外を上書きできる。下書きは日ごとに持つ |
| 週の確認（入力） | 7日ぶんを日ごとに。「出られる」チェック＋開始・終了。［この内容で提出する］［戻る］ |
| 提出済み | 提出した内容、［内容を修正する］ |
| 完了 | 「✓ 希望を受け付けました」＋内容。「〆切まで修正できます」 |
| 受付期間外 | 「今は受付期間ではありません」＋次の受付予定 |

入力チェック：1回の勤務は2時間以上、終了は開始より後、営業時間内。

## 店長画面（web/manager.html）

デモの②③④を実装する。タブ：提出状況／シフト表／自動作成／スキル。

- 提出状況：○人/20人、未提出者の名前、各人の「いつも通り／変更あり」
- シフト表：紙形式（`01` の形式）。★＝責任者、各日の最下段に不足時間、右端に備考。下に「チェック」一覧。表示切替で「日別の過不足」（ヒートマップ＋出勤者のバー）
- 手直し：バーをタップ → 時間変更・ホール/キッチン切替・外す。空き行をタップ → その日に出られる人から追加。変更のたびにチェックを再計算（デモは「外す」だけ。追加・時間変更は新規実装）
- 自動作成：必要人数の表、土日ピーク加算、勤務の長さ、［叩き台を自動作成］、結果（充足率・不足・ルールの注意件数・各人の週合計/上限）
- スキル：店のルールのON/OFF、スキルカード一覧（展開して編集）、いつもの勤務の編集
- 確定：［確定してシフト表を出力］→ 確認画面（`confirm()` は使わずページ内で）→ `mgr.publish`

## LINE メッセージ

| いつ | 誰に | 内容 | 種類 |
|---|---|---|---|
| 提出・修正した時 | 本人 | 受付内容 | 応答（reply）※ |
| 募集開始 | 全員 | 受付開始・〆切 | プッシュ or 店のLINEグループに店長が投稿 |
| 〆切前日 | 未提出者 | リマインド | プッシュ |
| 確定 | 全員 | 確定のお知らせ | プッシュ or LINEグループ |

※ 受付メッセージを無料の「応答」で返す方法：提出成功後、LIFF の `liff.sendMessages()` で **本人の発言として**「シフト希望を提出しました」をトークに送る → それが Webhook に届く → GAS がその replyToken で受付内容を返信する。

成立の裏付け（公式で確認済み）：

- 応答メッセージ（reply）は**通数にカウントされない**
- テキストメッセージは Webhook を発生させる（テンプレートメッセージと Flex Message は発生しないので使わない）
- `chat_message.write` スコープは LIFF 登録画面のチェックボックス。申請・審査の記述はない

**動作条件が厳しい。** `liff.sendMessages()` が使えるのは「1対1のトーク・グループトーク・複数人トークから起動した LIFF アプリの LIFF ブラウザ内」だけ。次は 403 になる：

- **「最近使用したサービス」から開き直したとき**（実運用で一番踏む）
- Keepメモから／URLスキームで開いた／ユーザーがスコープを認可しなかった

→ **`liff.sendMessages()` は必ず try/catch で囲み、403 は正常系として扱う**（エラー表示を出さない）。画面の完了表示だけで用は足りる。

`replyToken` は **Webhook を受けてから1分以内**に使う必要がある。Webhook 側の処理は「Submissions / Requests を1回読んで返信して終わり」に限定し、重い処理を挟まないこと。

**店長には「LINEのトークに必ず届く」と約束しないこと。** `01` の S4 は「受付完了表示」だけを必須とし、トークへの受付メッセージは「届けばうれしい」扱いにする。

### 送信数の注意

LINE公式アカウントの無料プラン（コミュニケーションプラン）は **月額0円・無料メッセージ200通・追加メッセージ不可**（公式の料金ページで確認済み）。上限を超えるとエラーが返り、メッセージは送信されない。プッシュは「人数分」数えられる。

20人の店で毎週「受付確認20＋募集20＋リマインド5＋確定20」を送ると **月約280通**（65通 × 4.3週）で超える。MVP の方針：

- 受付確認は上の「応答」方式で送り、プッシュは使わない（応答メッセージは通数にカウントされないことを公式で確認済み）
- 募集開始・確定は、**店長が既存のスタッフ用LINEグループに投稿**（`06` #17 でグループありと確認済み。アプリはコピー用の文面を出す）
- アプリからのプッシュは「未提出者へのリマインド」だけ。未提出5人なら月約22通、初月に10人未提出でも約43通で収まる
- **今月の送信数は LINE の公式 API で実数を取る**：`GET https://api.line.me/v2/bot/message/quota`（上限）と `.../quota/consumption`（送信済み）。店長画面に「今月の送信数 23/200」と出す。Log シートの自前カウントは実数とズレる（店長が LINE Official Account Manager から手動配信した分、あいさつメッセージ、ブロック中ユーザー宛の不課金分が反映されないため）。Log は監査用に残し、表示は API の値を使う

## グループLINEから使う場合（この店の運用）

店のスタッフ用グループLINEに **LIFFのリンクを貼って**、各自がそこからタップして開く。
公式ドキュメントで確認した事実をもとに、次のように作る。

**本人の特定はそのまま動く。**
`liff.getContext()` の `type` が `group` のときも `userId` は返る（LIFFリファレンス）。
LIFF は LINE Login で**個人**を認証するので、どこから開いても「タップした本人」が分かる。
招待コードでの紐付けも、1対1で開いたときと同じ。

**ユーザーIDは「プロバイダーごと」に一意。**
> 同じユーザーであってもプロバイダーごとに異なる値が発行されます。プロバイダーが同じであれば、チャネルの種類（LINEログインチャネルやMessaging APIチャネル）にかかわらず、同じユーザーIDが割り当てられます。
> （[ユーザーIDを取得する](https://developers.line.biz/ja/docs/messaging-api/getting-user-ids/)）

→ **LINE Login チャネルと Messaging API チャネルは必ず同じプロバイダーに作る。**
別プロバイダーに作ると userId が食い違い、紐付けが丸ごと壊れる。`07` の手順はこれに従っている。

**`liff.sendMessages()` はグループに流れる。**
> ユーザーの代わりに、LIFFアプリが開かれているトークルームにメッセージを送信します。
> （[LIFF v2 APIリファレンス](https://developers.line.biz/ja/reference/liff/)）

グループから開くと、そのグループに「シフト希望を提出しました」が流れる。20人ぶん流れると邪魔なので、
**`liff.getContext().type === 'group'`（または `room`）のときは呼ばない**。画面の完了表示だけで足りる。

**グループIDは LIFF からは取れない。**
`getContext()` の `groupId` は2023年2月に廃止済み。どのグループから開いたかは分からない（分からなくて困らない）。

**リッチメニューはグループでは入口にならない。**
リッチメニューは「LINE公式アカウントを友だち追加しているユーザー」に出るもの。
グループでの入口は**貼ったリンク**になるので、グループのノートに貼って固定してもらう。

## リッチメニュー

2ボタン：［シフトを出す］→ LIFF（index.html）／［今週のシフト］→ 確定シフト（N2 で実装、それまでは非表示）
