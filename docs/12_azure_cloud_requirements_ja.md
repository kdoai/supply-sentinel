# Azure化 要件定義

## 1. 目的

Supply Sentinel を、Hackathon デモで「実務に導入できる早期警戒型サプライチェーン支援システム」として説明できる状態にする。

現時点のローカル/静的モックは、ナフサ供給リスクのデモ体験として成立している。次段階では、同じ設計思想を維持しつつ、Azure 上で以下を実現する。

- Agent が定期的に外部シグナルを巡回する
- GPT 系モデルで供給リスクを構造化する
- 在庫、BOM、代替材、受注と照合する
- 自社影響、初動タスク、管理職レポートを生成する
- ナフサ以外の原材料にも、データ差し替えで対応できる
- 1か月 1万円以内を目指す最小構成で運用できる

## 2. ハッカソン要件への対応

| 要件 | 対応方針 |
|---|---|
| Azure アプリケーション実行基盤 | Azure Functions Timer Trigger を必須採用。必要に応じて HTTP Trigger でデモAPIも提供する。 |
| Microsoft AI 技術 | Azure AI Foundry / Azure OpenAI の GPT 系モデルを利用する。Agent Service はマルチエージェント実行基盤として採用候補にする。 |
| Agentic AI | Scheduler Agent、Signal Collector Agent、Risk Extraction Agent、Impact Assessment Agent、Response Planner Agent、Supervisor Agent に分割する。 |
| 定期自動実行 | Azure Functions Timer Trigger で 1時間ごと、またはデモ時のみ手動実行可能にする。 |
| 実務を動かせること | 「ニュース要約」ではなく、「自社影響に翻訳し、初動を準備する」ことを主価値にする。 |
| 低コスト | Consumption/Flex Consumption、短いプロンプト、候補イベントのみAI処理、キャッシュ、デモデータ利用で月1万円以内を狙う。 |

参考:

- Azure Functions Timer Trigger: https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-timer
- Azure Functions Consumption cost: https://learn.microsoft.com/en-us/azure/azure-functions/functions-consumption-costs
- Azure Functions pricing: https://azure.microsoft.com/pricing/details/functions/
- Azure AI Foundry Agent Service: https://learn.microsoft.com/azure/ai-services/agents/overview
- Azure AI Foundry: https://learn.microsoft.com/azure/ai-foundry/

## 3. スコープ

### 3.1 Hackathon Cloud MVP でやること

| ID | 要件 | 優先度 |
|---|---|---|
| FR-C-001 | Azure Functions の Timer Trigger で巡回処理を起動する | Must |
| FR-C-002 | デモデータ、外部シグナル、社内マスタを Storage から読み込む | Must |
| FR-C-003 | GPT 系モデルでニュース/通知から RiskEvent を抽出する | Must |
| FR-C-004 | BOM、在庫、受注、代替材と照合し ImpactAssessment を生成する | Must |
| FR-C-005 | Cosmos DB に実行履歴、検知イベント、未解決アラートを保存する | Must |
| FR-C-006 | ダッシュボードが最新の評価結果を表示できる | Must |
| FR-C-007 | 管理職レポートと部門別初動タスクを生成する | Must |
| FR-C-008 | データを変えるだけで対象原材料を差し替えられる | Must |
| FR-C-009 | GitHub Actions でテスト、ビルド、Azure デプロイを実行する | Must |
| FR-C-010 | Teams通知は今回スコープ外にする | Must |

### 3.2 今回やらないこと

- ログイン画面、ユーザー管理、細かい権限制御
- ERP/PLM/MES との本番接続
- 自動発注、自動サプライヤ切替、顧客への自動正式通知
- 株価予測、投資判断
- 大規模ストリーミング基盤
- Azure AI Search など固定費が出やすい構成

## 4. 非機能要件

| ID | 要件 | 内容 |
|---|---|---|
| NFR-C-001 | 低コスト | 月額 1万円以内を目標。常時起動を避け、従量課金中心にする。 |
| NFR-C-002 | 再現性 | デモデータだけで同じシナリオを安定再現できる。 |
| NFR-C-003 | 説明可能性 | RiskEvent、スコア根拠、照合した社内データ、推奨初動を保存・表示する。 |
| NFR-C-004 | データ品質 | サンプルでも、実務投入を想定したスキーマ、発生時刻、ソース、信頼度、重複排除キーを持つ。 |
| NFR-C-005 | セキュリティ | APIキーをGitHubに置かない。Azure Managed Identity、Key Vault、GitHub OIDCを使う。 |
| NFR-C-006 | 拡張性 | ナフサ以外も material master / BOM / supplier route / signal rules を差し替えて対応する。 |
| NFR-C-007 | Human-in-the-loop | 発注変更、サプライヤ切替、顧客通知、生産計画変更はAIが実行せず、人の承認対象として出力する。 |

## 5. データ要件

ハッカソンではデモデータでよい。ただし「ハリボテ」に見えないよう、実務のデータ粒度に寄せる。

### 5.1 外部シグナル

| 種別 | デモデータ | 将来の接続元候補 | 役割 |
|---|---|---|---|
| 業界ニュース | `news_events.json` | GDELT、業界紙RSS、企業ニュースリリース | 早期兆候、広域リスクの検知 |
| サプライヤ通知 | `supplier_notices.json` | メール、PDF、サプライヤポータル、SharePoint | 自社関連性と確度の高い遅延・割当情報 |
| 物流情報 | `supply_routes.csv` + demo event | 港湾混雑情報、AIS、フォワーダ通知 | 輸送遅延の補助シグナル |
| 災害・気象 | demo event | 気象庁防災情報XML、災害情報API | 工場・港湾・輸送ルート影響 |
| 価格情報 | demo event | 商品市況、World Bank Pink Sheet 等 | 需給逼迫の補助シグナル |

### 5.2 社内データ

| 種別 | デモファイル | 必須項目 | 差し替え単位 |
|---|---|---|---|
| 原材料マスタ | 追加対象 | material_id, display_name, category, criticality, aliases | ナフサ以外へ横展開する中心 |
| BOM | `bom.csv` | product_id, material_id, usage_qty, plant_id | 製品別影響判定 |
| 在庫 | `inventory.csv` | material_id, plant_id, stock_qty, daily_usage, days_of_supply | 残日在庫算出 |
| 代替材 | `alternatives.csv` | material_id, alternative_material_id, approved, lead_time_days, constraints | 初動提案 |
| 受注 | `orders.csv` | order_id, customer_id, product_id, plant_id, due_date, priority, amount | 顧客影響・優先順位 |
| 調達ルート | `supply_routes.csv` | material_id, supplier, origin, port, plant, share_percent, lead_time_days, spend | 地図・調達構成 |

## 6. マルチエージェント要件

| Agent | 役割 | 入力 | 出力 | GPT利用 |
|---|---|---|---|---|
| Scheduler Agent | Timer Trigger から全体実行を開始 | cron, last_run | run_id | なし |
| Signal Collector Agent | 外部/社内データを収集・正規化 | news, supplier notice, csv/json | SignalEnvelope[] | 原則なし |
| Risk Extraction Agent | 外部シグナルから供給リスクを抽出 | SignalEnvelope[] | RiskEvent | あり |
| Impact Assessment Agent | 自社データと照合 | RiskEvent, inventory, BOM, orders | ImpactAssessment | 原則ルール、必要時GPT |
| Response Planner Agent | 初動タスク、承認事項、管理職レポート生成 | ImpactAssessment | ActionPlan, Report | あり |
| Supervisor Agent | 重複排除、未解決アラート管理、再評価 | previous state, current run | state update | 原則なし |

## 7. コスト要件

月 1万円以内を目指す最小構成。

| 項目 | 方針 |
|---|---|
| Azure Functions | Consumption/Flex Consumption。常時起動しない。デモは手動または1時間間隔。 |
| Azure OpenAI | GPT-4o mini または同等の低コストGPT系モデルを優先。高価なモデルは最終レポートだけに限定可能。 |
| Cosmos DB | Serverless または Free Tier を候補。履歴件数を制限しTTLを設定。 |
| Storage | Blob/Queue/Table相当の小容量利用。 |
| Application Insights | サンプリングと保存期間短縮。 |
| AI Search | 初期構成では使わない。RAGが必要になった段階で検討。 |

コスト低減策:

- ニュース全件をGPTに投げない。キーワード/ルールで候補を絞る。
- 同一URL/同一通知本文はハッシュで重複排除する。
- RiskEvent 抽出は Structured Output で短く返す。
- 管理職レポートは高リスク時だけ生成する。
- デモではAI応答をキャッシュし、失敗時は deterministic mock にフォールバックする。
- 未解決アラートだけ再評価し、解決済みはスキップする。

### 7.1 月額1万円以内の目安

正確な金額はリージョン、為替、モデル単価で変動するため、提出時はAzure Pricing Calculatorで再確認する。ただし Hackathon MVP では以下の制約で1万円以内を狙える。

| サービス | 最小構成 | コスト抑制条件 |
|---|---|---|
| Azure Functions | Consumption/Flex Consumption | 1時間ごと、またはデモ時手動。Always Ready を使わない。Functionsには無料実行枠がある。 |
| Azure OpenAI / Foundry model | GPT-4o mini 相当 | 1回の巡回で候補10件以下、Risk抽出とReport生成だけに限定。キャッシュ利用。 |
| Cosmos DB | Free Tier または Serverless | Free Tierは開発/小規模用途に向く。Serverlessは利用量課金だがFree Tier対象外。どちらかを選ぶ。 |
| Storage Account | Hot tier small dataset | デモデータ、PDF数件、出力JSONのみ。ライフサイクルで古い成果物を削除。 |
| Application Insights | 最小ログ + サンプリング | デバッグログを絞り、保持期間を短くする。 |

設計判断:

- 初期は Cosmos DB Free Tier を第一候補にする。
- スパイクが少なく、実行頻度が低い場合は Cosmos DB Serverless も候補。
- Azure AI Search は固定費が出やすいため初期構成から外す。
- Container Apps / AKS / VM は常時費用が出やすいため使わない。

参考:

- Azure Cosmos DB Free Tier: https://learn.microsoft.com/azure/cosmos-db/free-tier
- Azure Cosmos DB Serverless: https://learn.microsoft.com/azure/cosmos-db/serverless
- Azure Blob Storage pricing: https://azure.microsoft.com/pricing/details/storage/blobs/
- Azure Monitor pricing: https://azure.microsoft.com/pricing/details/monitor/

## 8. 受入条件

Hackathon デモ前の完了条件:

- GitHub Actions の CI が通る
- Azure デプロイ用 workflow が用意されている
- Timer Trigger 相当の実行設計が説明できる
- Azure AI Foundry / Azure OpenAI を使う境界がコード/設計で明確
- デモデータをナフサ以外に差し替えられるスキーマになっている
- 画面上で「外部リスクを自社影響へ翻訳する」価値が一目で伝わる
