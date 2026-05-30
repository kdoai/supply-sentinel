# 実装メモ

## 現在の実装状況

ローカルMVPとして、AI呼び出しなしでも以下の一連の流れが通る状態にした。

1. サンプルニュースとサプライヤ通知を読み込む。
2. デモ用の決定論的ロジックでリスクイベントを抽出する。
3. 在庫、BOM、受注、代替材データを読み込む。
4. 影響製品、影響顧客、影響工場、在庫残日数を算出する。
5. リスクスコアを算出する。
6. Teams向けアラート、管理職向けレポート、HTMLダッシュボードを生成する。
7. アラート履歴を保存する。

## 実行方法

地図+ダッシュボードのデモ(メイン):

```powershell
node src\serve.mjs
```

起動後、ブラウザで http://localhost:4173 を開く。サーバーは起動時にパイプラインを
実行して `dashboard_data.json` を生成し、`web/` の静的ダッシュボードを配信する。
APIキー不要・外部CDN不要で完全オフライン動作する。

ヘッドレス実行(成果物のみ生成):

```powershell
node src\run-demo.mjs
```

PowerShellで `npm` がブロックされる場合は `npm.cmd` を使う。

```powershell
npm.cmd test
npm.cmd run demo
npm.cmd start   # ダッシュボードサーバー(= npm.cmd run dev)
```

## ダッシュボード設計(地図 + プロセスマイニング)

設計思想「外部供給リスク → 自社の業務影響への翻訳」を、川下メーカー視点の可視化レイヤーに拡張した。

- 川上(Upstream): 原産地・製油所 → 川中(Midstream): サプライヤー・港・輸送 → 川下(Downstream/自社): 工場 → 製品 → 顧客。
- 世界地図に「光の輸入ルート」を描画。リスク該当ルート(アジア)は赤く脈動、分散先(中東)は緑で健全と表示。
- 調達割合(share %)、課金額(monthly spend)、被影響分をサイドパネルで提示。
- プロセスフロー図(原産地→サプライヤー→工場→製品→顧客)でリスクの伝播を可視化。
- 影響判定・ルート判定は `routeEngine.mjs` の決定論ロジック(AI抽出とは分離、テスト可能)。

## 出力先

```text
outputs/latest/
+-- risk_event.json
+-- impact_assessment.json
+-- teams_alert.md
+-- management_report.md
+-- dashboard.html
+-- alert_history.json
```

## 現在の主なファイル

| ファイル | 役割 |
|---|---|
| `src/run-demo.mjs` | ローカルデモ実行 |
| `src/supply_sentinel/workflow.mjs` | 全体オーケストレーション |
| `src/supply_sentinel/ingestion.mjs` | JSON/CSV読み込み |
| `src/supply_sentinel/riskExtraction.mjs` | リスクイベント抽出 |
| `src/supply_sentinel/impactEngine.mjs` | BOM/在庫/受注/代替材との照合 |
| `src/supply_sentinel/routeEngine.mjs` | 調達ルート・割合・課金額・プロセスフロー生成 |
| `src/supply_sentinel/scoring.mjs` | リスクスコア算出 |
| `src/serve.mjs` | ローカルダッシュボードサーバー(依存ゼロ) |
| `web/index.html` `web/js/*.js` `web/styles.css` | 地図+ダッシュボードUI(オフライン) |
| `data/samples/supply_routes.csv` | 調達ルートのモックデータ(座標/割合/課金額) |
| `src/supply_sentinel/alertWriter.mjs` | Teams向けMarkdown生成 |
| `src/supply_sentinel/reportWriter.mjs` | 管理職向けレポート生成 |
| `src/supply_sentinel/dashboardWriter.mjs` | HTMLダッシュボード生成 |
| `src/supply_sentinel/stateStore.mjs` | 出力・履歴保存 |
| `src/function_app/timerTrigger.mjs` | Azure Functions向け入口のたたき台 |

## 現在のデモ結果

```text
Material: naphtha
Risk score: 82/100
Severity: high
Impacted products: Resin A, Solvent B, Coating C
Impacted customers: Customer Alpha, Customer Beta, Customer Gamma
Minimum inventory days: 5
```

## AI SDK方針

現時点では、AI部分を差し替えやすくするために `riskExtraction.mjs` に境界を切っている。

次の段階では、ここを Azure OpenAI 呼び出しに差し替える。

推奨:

- Node.js on Azure Functions
- Azure OpenAI
- OpenAI JavaScript SDK または Azure OpenAI SDK

ハッカソン最小構成では、Claude Agent SDK、LangChain、CrewAI、AutoGen のような重いエージェントフレームワークは使わない。

理由:

- Microsoft AI 技術の利用を審査で説明しやすい。
- Azure Functions に載せやすい。
- デモ失敗リスクが低い。
- Agentic AI らしさは、定期実行、状態管理、影響判定、通知、レポート生成で十分に表現できる。

## 次の実装候補

優先順は以下。

1. Azure OpenAI 連携を `riskExtraction.mjs` に追加する。
2. Teams Webhook または Power Automate 送信を追加する。
3. Azure Functions の `local.settings.json` テンプレートを作る。
4. Cosmos DB 保存に差し替える `stateStore` 実装を追加する。
5. ダッシュボードを発表用に日本語化する。
