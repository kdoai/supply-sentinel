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
AZURE_OPENAI_ENDPOINT=https://supplysentinel-ai-xh5yr4.openai.azure.com/
AZURE_OPENAI_ACCOUNT_NAME=supplysentinel-ai-xh5yr4
AZURE_OPENAI_DEPLOYMENT=gpt-5.4
AZURE_OPENAI_SUBAGENT_DEPLOYMENT=gpt-5.4-mini
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
RUN_MODE=demo
SUPPLY_SENTINEL_STATE_STORE=cosmos
COSMOS_DB_ENDPOINT=<cosmos endpoint>
COSMOS_DB_DATABASE=supply-sentinel
COSMOS_DB_CONTAINER=runs
COSMOS_DB_USE_AAD=true
AZURE_CLIENT_ID=<runtime managed identity client id>
AZURE_OPENAI_ENDPOINT=<openai endpoint>
AZURE_OPENAI_DEPLOYMENT=gpt-5.4
AZURE_OPENAI_SUBAGENT_DEPLOYMENT=gpt-5.4-mini
AZURE_OPENAI_USE_AAD=true
HOST=0.0.0.0
PORT=4173
```

## 8. モード切替

| mode | CI/CD での指定 | 用途 |
| --- | --- | --- |
| `demo` | `workflow_dispatch -f run_mode=demo` | 安定デモ。GPT quota がなくても動く。 |
| `cloud` | `workflow_dispatch -f run_mode=cloud` | Azure OpenAI 実呼び出し。quota 通過後に使う。 |

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
