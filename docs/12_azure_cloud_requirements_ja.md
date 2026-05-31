# Azure Cloud 要件定義

## 1. 目的

Supply Sentinel をハッカソンで「実務に使える早期警戒型サプライチェーン支援システム」として見せるため、Azure 上で最小コスト・最小権限・自動定期実行を満たす構成にする。

本番相当の狙いは、外部シグナルをただ要約することではなく、AI が外部テキストからリスクイベントを構造化し、自社の在庫・BOM・調達ルート・受注データに照らして業務影響へ翻訳すること。

## 2. ハッカソン要件への対応

| 要件 | 採用方針 | 状態 |
| --- | --- | --- |
| Azure アプリケーション実行基盤 | Azure Container Apps Consumption | 採用済み |
| 自動定期実行 | Azure Container Apps Job、cron `0 */6 * * *` | 採用済み |
| Microsoft AI 技術 | Azure OpenAI / Azure AI Foundry の GPT 系モデル | 接続済み |
| GPT モデル | メイン / サブエージェントとも `gpt-5.4-mini` | East US 2 / DataZoneStandard で稼働 |
| 状態管理 | Azure Cosmos DB for NoSQL Serverless | 採用済み |
| CI/CD | GitHub Actions + OIDC | 採用済み |
| 認証 | Microsoft Entra ID / Managed Identity | 採用済み |
| コスト管理 | 月 3,000 円 Budget アラート | 採用済み |

## 3. スコープ

### Must

- 外部ニュース・サプライヤ通知・社内デモデータを取り込み、ナフサ供給リスクを検知する。
- AI リスク抽出の入力テキストと構造化結果を画面で対比表示する。
- 在庫、BOM、調達ルート、受注情報から自社影響を算出する。
- 影響製品、影響顧客、影響工場、在庫残日数、調達ルート影響、初動対応案を表示する。
- Cosmos DB に最新ダッシュボードと実行履歴を保存する。
- GitHub Actions から Azure へ OIDC でデプロイする。
- API キーや接続文字列を Git に保存しない。

### Should

- 素材データを差し替えるだけで、包装材・半導体材料など別素材へ横展開できる。
- `RUN_MODE=demo` では deterministic mock で安定デモできる。
- `RUN_MODE=cloud` で Azure OpenAI の GPT 呼び出しを実行できる。

### Won't

- ログイン画面やユーザー管理は作らない。
- Teams 通知は今回の Cloud デモでは外す。
- 発注変更、サプライヤ切替、顧客正式通知は AI が自動実行しない。Human-in-the-loop を前提にする。

## 4. 機能要件

| ID | 要件 | 優先度 |
| --- | --- | --- |
| FR-001 | Container Apps Job が 6 時間ごとに監視ワークフローを起動する | Must |
| FR-002 | 外部シグナルを AI 入力テキストとして `meta.ai.inputs` に保持する | Must |
| FR-003 | AI 抽出結果を RiskEvent として構造化する | Must |
| FR-004 | `RUN_MODE=demo` では同じ入力から同じ結果を返す | Must |
| FR-005 | `RUN_MODE=cloud` では Azure OpenAI の `gpt-5.4-mini` をメインモデルとして使う | Must |
| FR-006 | サブエージェント用途のモデル設定として `gpt-5.4-mini` を保持する | Should |
| FR-007 | Cosmos DB に最新ダッシュボード、実行履歴、アラート履歴を保存する | Must |
| FR-008 | Web フロントは Cloud API `/api/latest-dashboard` から最新データを取得する | Must |
| FR-009 | Cloud API が落ちた場合は静的 `dashboard_data.json` にフォールバックできる | Should |
| FR-010 | 初動対応画面で「AIが読んだ生テキスト」と「構造化JSON」を対比する | Must |

## 5. 非機能要件

| 項目 | 要件 |
| --- | --- |
| コスト | 月数千円、目標 3,000 円。API は max 1 replica、Job は 6 時間ごと。 |
| セキュリティ | GitHub OIDC、Managed Identity、Cosmos DB local auth disabled。 |
| 可用性 | ハッカソンデモでは単一リージョンでよい。 |
| 運用性 | GitHub Actions から再現可能にデプロイできる。 |
| 監査性 | AI 入力、抽出結果、判定根拠、生成時刻を画面とデータに残す。 |
| 拡張性 | 素材マスタ・BOM・在庫・調達ルートを差し替えれば別素材に展開できる。 |

## 6. エージェント設計

| Agent | 役割 | GPT 利用 |
| --- | --- | --- |
| Scheduler Agent | Container Apps Job から定期実行を開始 | なし |
| Signal Collector Agent | ニュース、サプライヤ通知、社内データを正規化 | 原則なし |
| Risk Extraction Agent | 外部テキストから RiskEvent を抽出 | `gpt-5.4-mini` |
| Impact Assessment Agent | BOM・在庫・受注・調達ルートから影響を算出 | ルール中心 |
| Response Planner Agent | 初動対応案、承認事項、管理職向けサマリを生成 | `gpt-5.4-mini` |
| Supervisor Agent | 未解決アラート、前回結果、再評価対象を管理 | なし |

## 7. Human-in-the-loop

AI が自動で行うのは、検知、構造化、影響評価、初動案作成、レポート生成まで。

人が承認すること:

- 発注変更
- サプライヤ切替
- 代替材採用
- 顧客への正式通知
- 価格改定
- 生産計画の大幅変更

これにより、実務で導入しやすい「判断支援」に留める。

## 8. コスト設計

| リソース | 方針 |
| --- | --- |
| Azure Container Apps | Consumption、API は `0.25 CPU / 0.5Gi`、max 1 replica。 |
| Container Apps Job | cron `0 */6 * * *`。デモ中のみ手動実行可能。 |
| Cosmos DB | Serverless、1 container、少量ドキュメント。 |
| ACR | Basic。admin user disabled。 |
| Storage Static Website | LRS、小容量静的ファイルのみ。 |
| Log Analytics | 30 日保持。必要に応じて短縮可能。 |
| Azure OpenAI | East US 2 の `gpt-5.4-mini` を短いプロンプトで利用。必要時は deterministic fallback。 |
| Budget | 月 3,000 円アラート。課金停止ではなく通知。 |

## 9. セキュリティ要件

- GitHub に Azure client secret を置かない。
- GitHub Actions は OIDC federation で Azure にログインする。
- Container Apps と Job は User Assigned Managed Identity を使う。
- Cosmos DB は local auth disabled。
- ACR は admin user disabled。
- フロントには API キーを置かない。
- 公開 API は読み取り専用の `/api/latest-dashboard` と `/api/health` に限定する。

## 10. デモ成功条件

- ダッシュボードが Azure Static Website から開ける。
- Cloud API が Cosmos DB 由来の `dashboard` を返す。
- AI リスク抽出パネルで「入力テキスト → 構造化結果」が一目で伝わる。
- 不変条件が崩れない:
  - risk score: 82
  - 影響調達比率: 65%
  - 月間調達額: 7.8M USD / 12M USD
  - 影響ルート: 3 of 4
  - 最短在庫残日数: 5日
  - 素材: 3種類

## 11. 残課題

- データソースを実データに近づける。現状はニュース・サプライヤ通知・社内データをデモデータで再現している。
- RSS / メール添付 / 価格情報 API など、収集コネクタを段階的に増やす。
- コスト監視を見ながら、必要な時だけ `gpt-5.4` など上位モデルへ差し替えられる余地を残す。
