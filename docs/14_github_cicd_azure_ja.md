# GitHub CI/CD 設計

## 1. 目的

Supply Sentinel を GitHub から Azure へ安全に継続デプロイする。長期シークレットや API キーを GitHub に置かず、OIDC と Managed Identity を使う。

## 2. Workflow

| Workflow | Trigger | 役割 |
| --- | --- | --- |
| `ci.yml` | push / pull_request | 構文チェック、テスト、Web build |
| `deploy-azure.yml` | workflow_dispatch | Azure IaC、container build/push、Container Apps 更新、静的サイト upload |

## 3. Deploy Workflow の流れ

1. Checkout
2. Node.js setup
3. `npm ci --ignore-scripts`
4. `node --check`
5. `npm test`
6. `npm run build:web`
7. Azure login with GitHub OIDC
8. Bicep deployment
9. Docker build on GitHub runner
10. ACR push
11. Container Apps API / Job update
12. `web/config.js` を Cloud API 向けに生成
13. Azure Storage Static Website に upload

ACR Tasks は使わない。サブスクリプションによって ACR Tasks が禁止されることがあるため、GitHub runner 上で Docker build する。

## 4. GitHub Secrets

値は OIDC 用の識別子のみ。client secret は使わない。

```text
AZURE_CLIENT_ID
AZURE_TENANT_ID
AZURE_SUBSCRIPTION_ID
```

## 5. GitHub Variables

```text
AZURE_RESOURCE_GROUP=rg-supply-sentinel-demo
AZURE_LOCATION=japaneast
AZURE_APP_NAME=supplysentinel
AZURE_GITHUB_PRINCIPAL_ID=<service-principal-object-id>
AZURE_OPENAI_ENDPOINT=https://supplysentinel-ai-eus2-xh5yr4.cognitiveservices.azure.com/
AZURE_OPENAI_ACCOUNT_NAME=supplysentinel-ai-eus2-xh5yr4
AZURE_OPENAI_DEPLOYMENT=gpt-5.4-mini
AZURE_OPENAI_SUBAGENT_DEPLOYMENT=gpt-5.4-mini
AZURE_OPENAI_API_VERSION=2025-04-01-preview
```

OpenAI endpoint と deployment 名は機密ではない。API キーは使わない。

## 6. Azure RBAC

| Principal | Scope | Role |
| --- | --- | --- |
| GitHub OIDC Service Principal | Resource Group | Contributor |
| GitHub OIDC Service Principal | Resource Group | Role Based Access Control Administrator |
| GitHub OIDC Service Principal | Resource Group | Storage Blob Data Contributor |
| GitHub OIDC Service Principal | Resource Group | AcrPush |
| Runtime Managed Identity | ACR | AcrPull |
| Runtime Managed Identity | Cosmos DB | Cosmos DB Built-in Data Contributor |
| Runtime Managed Identity | Azure OpenAI | Cognitive Services OpenAI User |

## 7. Azure App Settings / Env

Container Apps API と Job の両方に同じ環境変数を渡す。

```text
RUN_MODE=cloud
SUPPLY_SENTINEL_STATE_STORE=cosmos
COSMOS_DB_ENDPOINT=<cosmos endpoint>
COSMOS_DB_DATABASE=supply-sentinel
COSMOS_DB_CONTAINER=runs
COSMOS_DB_USE_AAD=true
AZURE_CLIENT_ID=<runtime managed identity client id>
AZURE_OPENAI_ENDPOINT=<openai endpoint>
AZURE_OPENAI_DEPLOYMENT=gpt-5.4-mini
AZURE_OPENAI_SUBAGENT_DEPLOYMENT=gpt-5.4-mini
AZURE_OPENAI_USE_AAD=true
AZURE_OPENAI_API_VERSION=2025-04-01-preview
HOST=0.0.0.0
PORT=4173
```

## 8. モード切替

`deploy-azure.yml` の `run_mode` 既定は **`cloud`**(本番で AI を生かすのが既定)。

| mode | CI/CD での指定 | 用途 |
| --- | --- | --- |
| `cloud` | 既定 / `workflow_dispatch -f run_mode=cloud` | Azure OpenAI 実呼び出し(チャット相談 + LLM 調査エージェント)。本番デモで使う。 |
| `demo` | `workflow_dispatch -f run_mode=demo` | 安定デモ。GPT quota がなくても動く。LLM は呼ばない。 |

### 8.1 AI を「本当に生かす」ための前提(cloud)

`run_mode=cloud` だけでは不十分で、以下が揃って初めて LLM が呼ばれる。1つでも欠けると安全側で決定論 fallback に落ちる(壊れはしない)。

1. **`run_mode=cloud`**(既定)。
2. GitHub Variables に **`AZURE_OPENAI_ENDPOINT`** が設定済み(空だと `azureOpenAiConfigured()=false` → fallback)。
3. **`AZURE_OPENAI_ACCOUNT_NAME`** を設定(Runtime Managed Identity に Cognitive Services OpenAI User ロールを付与するため。未設定だと AAD 認証で 401)。
4. デプロイ名 (`AZURE_OPENAI_DEPLOYMENT`) が実在し、**quota が残っている**(429 だと fallback)。
5. `SUPPLY_SENTINEL_LIVE_EVIDENCE=true`(調査エージェントが Web 検索する。Bicep 既定 true)。

### 8.2 生きているかの判定方法

- **チャット**: 回答カードのバッジが `… / cloud` なら LLM 応答、`… / fallback` なら決定論 fallback。
- **調査エージェント**: `latest-dashboard` の `dashboard.meta.evidence_collection.live_mode` が
  - `agent` … モデルが tool-calling で検索を駆動(本番の狙い)
  - `rss` … 決定論の RSS 収集に fallback
  - `disabled` … ライブ証拠オフ
  - `live_queries` にモデルが実際に投げた検索クエリが入る。`live_count` が取得記事数。

## 9. デプロイ確認

```powershell
Invoke-WebRequest https://supplysentinelwebxh5yr4j.z11.web.core.windows.net/
Invoke-WebRequest https://supplysentinel-api.whitecoast-18504dfb.japaneast.azurecontainerapps.io/api/health
Invoke-WebRequest https://supplysentinel-api.whitecoast-18504dfb.japaneast.azurecontainerapps.io/api/latest-dashboard
```

期待値:

- static site が 200
- health が `{ ok: true }`
- latest-dashboard が `state_store=cosmos`
- dashboard に `risk_score` が含まれる

## 10. 失敗時の切り戻し

- `RUN_MODE=demo` で再デプロイする。
- Cloud API が不調でも、フロントは `web/dashboard_data.json` に fallback できる。
- Container image は ACR の `supply-sentinel:latest` と SHA tag を持つ。
- 重要なリソースは Bicep で再作成できる。
