# Azure 基本設計

## 1. 設計方針

Supply Sentinel の設計思想は変えない。

> 外部リスクを、自社が今日動くべき業務影響に翻訳する。

Azure化では、今のモックを「クラウドに置き換える」のではなく、以下の分離を明確にする。

- 外部シグナル収集
- AIによるリスク抽出
- 社内データ照合
- 影響評価
- 初動タスク/レポート生成
- 状態管理
- 可視化

これにより、ナフサだけでなく、米、包装材、半導体部材、樹脂、溶剤などへ横展開できる。

## 2. 推奨Azure構成

### 2.1 最小構成

```text
GitHub Actions
  |
  | OIDC deploy
  v
Azure Functions
  - Timer Trigger: 定期巡回
  - HTTP Trigger: 最新結果API / 手動実行API
  |
  +--> Azure AI Foundry / Azure OpenAI
  |     - GPT系モデル
  |     - Risk Extraction Agent
  |     - Response Planner Agent
  |
  +--> Azure Storage Account
  |     - demo input files
  |     - supplier notice PDFs/text
  |     - generated dashboard data
  |
  +--> Azure Cosmos DB
        - runs
        - risk_events
        - impact_assessments
        - alert_state

Static Dashboard
  - 初期はGitHub PagesまたはFunctions static response
  - Azure審査説明ではFunctions実行基盤を主対象にする
```

### 2.2 採用サービス

| 領域 | サービス | 理由 |
|---|---|---|
| 定期実行 | Azure Functions Timer Trigger | ハッカソン要件を満たし、低コスト。 |
| API | Azure Functions HTTP Trigger | 手動実行、最新結果取得、デモ画面更新に使う。 |
| AI | Azure AI Foundry / Azure OpenAI | GPT系モデル利用。Foundry上でモデル/Agentを管理できる。 |
| Agent | Azure AI Agent Service または Functions内の論理Agent | Agent Serviceを使えば審査要件に強い。最小実装ではFunctionsでマルチエージェントを順次実行する。 |
| 状態管理 | Azure Cosmos DB | 未解決アラート、実行履歴、差分評価を保存。 |
| ファイル | Azure Storage Blob | デモデータ、通知PDF、生成JSONを保存。 |
| 機密情報 | Key Vault | AI endpoint/key、外部APIキーを保存。 |
| 認証 | Managed Identity / GitHub OIDC | アプリ内ログインは作らないが、クラウド間認証は安全にする。 |
| 監視 | Application Insights | 実行時間、失敗、AI呼び出し回数を監視。 |

## 3. マルチエージェント設計

### 3.1 Agent一覧

```text
Scheduler Agent
  -> Signal Collector Agent
  -> Risk Extraction Agent
  -> Impact Assessment Agent
  -> Response Planner Agent
  -> Supervisor Agent
```

### 3.2 Agent責務

#### Scheduler Agent

- Azure Functions Timer Trigger で起動する。
- `run_id` を発行する。
- 前回実行状態を読み込み、未解決アラートを再評価対象に入れる。

#### Signal Collector Agent

- 外部ニュース、サプライヤ通知、物流/災害/価格シグナルを `SignalEnvelope` に正規化する。
- 重複排除キーを生成する。
- GPTに渡す前にルールで候補を絞る。

#### Risk Extraction Agent

- Azure AI Foundry / Azure OpenAI の GPT 系モデルを使う。
- 非構造テキストから `RiskEvent` を抽出する。
- 出力は JSON schema / structured output 相当で固定する。
- 抽出対象:
  - material_id
  - risk_type
  - region
  - delay_days
  - allocation_rate
  - severity
  - confidence
  - evidence

#### Impact Assessment Agent

- 原則ルールベース。
- BOM、在庫、受注、代替材、調達ルートと照合する。
- `RiskEvent.material_id` を中心に、対象製品、工場、顧客、受注を特定する。
- リスクスコアを算出する。
- ここでは「AIが判断する」というより、「AI抽出結果を業務ルールで検証する」位置づけにする。

#### Response Planner Agent

- GPT 系モデルを使い、初動タスクと管理職レポートを生成する。
- 入力は ImpactAssessment の構造化JSONだけに限定する。
- 出力は以下:
  - recommended_actions
  - department_tasks
  - approval_required
  - management_report

#### Supervisor Agent

- 前回結果との差分を管理する。
- 未解決アラートを再評価する。
- 低リスク化したものは `resolved` にする。
- 既存アラートのスコアが上昇した場合は `escalated` にする。

## 4. データモデル

### 4.1 Material Master

```json
{
  "material_id": "naphtha",
  "display_name": "ナフサ",
  "category": "petrochemical_feedstock",
  "criticality": "high",
  "aliases": ["naphtha", "ナフサ", "ナフサ由来原料"],
  "monitoring_keywords": ["refinery disruption", "allocation", "shipment delay"]
}
```

対象原材料を変える場合は、まずこのマスタを追加する。BOM、在庫、調達ルート、代替材、受注が同じ `material_id` を参照すれば、アプリのロジックは変えない。

### 4.2 SignalEnvelope

```json
{
  "signal_id": "news-2026-001",
  "source_type": "news",
  "source_name": "GDELT",
  "observed_at": "2026-05-31T06:31:00+09:00",
  "title": "Naphtha supply tightens after refinery disruption in Asia",
  "body": "...",
  "url": "https://example.com/news/001",
  "material_candidates": ["naphtha"],
  "region_candidates": ["Asia"],
  "reliability": "medium",
  "dedupe_hash": "sha256:..."
}
```

### 4.3 RiskEvent

```json
{
  "risk_event_id": "risk-20260531-naphtha-asia-001",
  "material_id": "naphtha",
  "risk_type": "allocation",
  "region": "Asia",
  "delay_days_min": 5,
  "delay_days_max": 7,
  "allocation_rate_percent": 70,
  "severity": "high",
  "confidence": "high",
  "evidence": [
    {
      "signal_id": "notice-2026-001",
      "quote": "5-7 day shipment delay",
      "reason": "shipment delay"
    }
  ]
}
```

### 4.4 ImpactAssessment

```json
{
  "assessment_id": "assess-20260531-naphtha-001",
  "risk_event_id": "risk-20260531-naphtha-asia-001",
  "material_id": "naphtha",
  "risk_score": 82,
  "inventory_days_min": 5,
  "impacted_products": ["樹脂A", "溶剤B", "コーティングC"],
  "impacted_customers": ["自動車部品A社", "包装材B社", "化学品C社"],
  "impacted_plants": ["千葉工場", "大阪工場"],
  "monthly_spend_at_risk": 7800000,
  "approval_required": ["発注内容の変更", "サプライヤ切替"]
}
```

## 5. データ収集設計

### 5.1 初期デモ

初期デモでは Storage Blob に以下を置く。

```text
input/
  materials/materials.json
  external/news_events.json
  external/supplier_notices.json
  internal/inventory.csv
  internal/bom.csv
  internal/orders.csv
  internal/alternatives.csv
  internal/supply_routes.csv
```

これにより、デモデータでも「実務で接続するデータの型」を示せる。

### 5.2 将来の実接続

| データ | 収集方法 | 備考 |
---|---|---|
| ニュース | GDELT API、RSS、業界紙API | まずキーワード検索。AI処理は候補のみ。 |
| サプライヤ通知 | Microsoft Graph mail、SharePoint/Blob PDF | PDFはOCR/Document Intelligenceを追加候補。 |
| 災害・気象 | 気象庁防災情報XML | 港湾・工場地域との紐づけに使う。 |
| 物流 | 港湾混雑、フォワーダ通知、AIS系API | 初期はデモデータ。商用APIは後段。 |
| 価格 | 商品市況、World Bank Pink Sheet等 | 需給逼迫の補助シグナル。 |
| 社内在庫/BOM | ERP、PLM、MES、CSV export | ハッカソンではBlob上のCSV。 |

## 6. 現在実装からの変更点

| 領域 | 現在 | Azure化後 |
|---|---|---|
| 実行 | `node src/serve.mjs` / GitHub Pages | Azure Functions Timer Trigger + HTTP Trigger |
| AI | `riskExtraction.mjs` の deterministic mock | Azure AI Foundry / Azure OpenAI GPT系モデル |
| Agent | 1つの `workflow.mjs` で順次実行 | 論理Agentに分割し、Supervisorが状態管理 |
| データ | `data/samples` と `web/demo_events.json` | Azure Blob Storage の input dataset |
| 状態 | `outputs/latest` のローカルJSON | Cosmos DB `runs`, `risk_events`, `impact_assessments`, `alert_state` |
| UI | 静的HTML + JSON | HTTP APIから最新結果取得。デモ時は自動再生モード維持 |
| CI/CD | 手動push / gh-pages | GitHub Actions CI + Azure deploy workflow |
| セキュリティ | ローカル実行 | Managed Identity、Key Vault、GitHub OIDC |

## 7. OSS参考観点

ユーザー提示の参考OSSは、実装をそのまま移植するのではなく、以下の観点を取り込む。

| OSS | 参考にする点 |
|---|---|
| deveshkp/woodpecker-ai | simulator、AI consumer、real-time dashboard、event feed の分離。Supply Sentinel では `demo_events.json` とイベントログに反映済み。 |
| hhtzuhh/Aorta | 早期警戒システムとして、連続データからリスクを検知し、現場向け推奨を出すストーリー設計。 |
| kavishsathia/sworn | Agentの責務分割、証跡、判定根拠の明示という観点を参考にする。 |

Woodpecker AI は README 上で simulated telemetry、AI detection consumer、real-time dashboard、event feed を分けており、Supply Sentinel でも「収集」「AI抽出」「影響評価」「可視化」を分ける設計にする。

## 8. セキュリティ設計

Hackathonではログインは作らない。ただし、クラウド利用として最低限の安全性は確保する。

- GitHub Actions は Azure OIDC でログインし、発行済み publish profile は使わない。
- Azure Functions は Managed Identity で Storage / Cosmos / Key Vault にアクセスする。
- Azure OpenAI key は Key Vault または Managed Identity 対応設定で管理する。
- CORS はデモURLだけ許可する。
- Cosmos DB は最小権限。アプリからは対象DB/Containerのみアクセス。
- 入力PDF/メール本文は Blob に保存し、PII を含む場合は後続フェーズでマスキングする。

## 9. 運用設計

| 項目 | 設計 |
|---|---|
| 実行頻度 | ハッカソン: 手動/1時間ごと。本番候補: 15分〜1時間。 |
| アラート状態 | `new`, `watching`, `escalated`, `resolved` |
| 再評価 | 未解決アラートのみ次回実行で再評価 |
| ログ | run_id単位で Signal数、AI呼び出し数、token概算、処理時間、エラーを保存 |
| 失敗時 | AI失敗時は前回結果を保持し、deterministic extractor にフォールバック |
| デモ安定化 | demo mode ではAI応答キャッシュを使う |

## 10. 拡張方針

ナフサ以外に展開する場合:

1. `materials.json` に原材料を追加する
2. BOM に `material_id` を追加する
3. 在庫/調達ルート/代替材/受注を追加する
4. monitoring keywords を追加する
5. Risk Extraction Agent の schema は変えない

つまり、製品・原材料の追加はコード変更ではなくデータ変更で対応する。
