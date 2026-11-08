# シフト作成アプリ 引き継ぎ一式

ファストフード店向けシフト作成アプリを、Claude Code で本番開発するための資料です。

## 中身

| ファイル | 内容 |
|---|---|
| `CLAUDE.md` | Claude Code が最初に読む指示書（技術構成・守ること・読む順番） |
| `docs/01_requirements.md` | 要件、今の紙のシフト表の形式、業務フロー、機能の優先順位 |
| `docs/02_data-model.md` | スプレッドシートのシートと列の設計 |
| `docs/03_screens-and-api.md` | 画面、GAS の API、LINE 連携、送信数の注意 |
| `docs/04_scheduler-logic.md` | 自動作成とチェックのロジック（デモの仕様化） |
| `docs/05_implementation-plan.md` | Phase 0〜7 の実装ステップと完了の確認 |
| `docs/06_open-questions.md` | 店長に確認すること（ヒアリングシート） |
| `docs/07_setup-guide.md` | LINE・GAS・GitHub Pages の初期設定 |
| `reference/shift-demo.html` | 動くデモ（ブラウザで開くだけで動く） |

## 使い方

1. このフォルダを好きな場所に置いて、そのフォルダで Claude Code を起動
2. 最初にこう頼む：

   > CLAUDE.md と docs/ を全部読んで、理解した内容を5行で要約して。そのあと Phase 0 で何をするかを、私がやること／Claude がやることに分けて教えて。まだコードは書かないで。

3. あとは `docs/05_implementation-plan.md` の Phase 順に進める

## 先にやっておくと楽なこと

- `docs/06_open-questions.md` を印刷して、デモを見せながら店長に聞く。答えを書き込んでから Claude Code に渡すと手戻りが減ります
- 特に #16（店独自のLINE公式アカウントを作ってよいか）と #20〜22（お金・保守）は、開発を始める前に確認
