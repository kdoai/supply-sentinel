# GitHub CI/CD 設計

## 1. 目的

Supply Sentinel を GitHub から Azure へ安全に継続デプロイできる状態にする。

Hackathonでは、以下を満たせば十分。

- Pull Request / push 時にテストとWebビルドが走る
- main ブランチの品質が保たれる
- Azureデプロイは `workflow_dispatch` で手動実行できる
- Azure認証は GitHub OIDC を使い、長期シークレットを置かない
- Azureリソース名やサブスクリプションは GitHub Secrets / Variables で差し替える

## 2. Workflow構成

| Workflow | トリガー | 役割 |
|---|---|---|
| `ci.yml` | push / pull_request | Node構文チェック、ユニットテスト、`build:web`、成果物アップロード |
| `deploy-azure-functions.yml` | workflow_dispatch | CI相当の検証後、Azure Functionsへデプロイ |

## 3. CI設計

### 3.1 実行内容

```text
checkout
setup-node 20
npm install
node --check web/js/app.js
node --check web/js/panels.js
node --check web/js/map.js
node --check src/serve.mjs
npm test
npm run build:web
upload web artifact
```

この時点では外部APIキーを使わない。CIは必ずデモデータだけで成功する。

## 4. Azure Deploy設計

### 4.1 方式

GitHub Actions から Azure へは OIDC でログインする。

必要な GitHub Secrets:

```text
AZURE_CLIENT_ID
AZURE_TENANT_ID
AZURE_SUBSCRIPTION_ID
```

必要な GitHub Variables:

```text
AZURE_FUNCTIONAPP_NAME
AZURE_RESOURCE_GROUP
AZURE_FUNCTIONAPP_PACKAGE_PATH
```

`AZURE_FUNCTIONAPP_PACKAGE_PATH` は初期値 `.` とする。Azure Functions 専用構成に分離したら `src/function_app` または `dist/function_app` に変更する。

### 4.2 デプロイ対象

初期のAzure化では以下を同じリポジトリからデプロイする。

```text
src/
  function_app/
  supply_sentinel/
data/
  samples/
web/
  dashboard static assets
```

ただし本番寄りにする場合は、Functions用成果物とWeb用成果物を分離する。

## 5. 環境変数

Azure Functions App Settings:

```text
RUN_MODE=demo
AZURE_OPENAI_ENDPOINT=
AZURE_OPENAI_DEPLOYMENT=gpt-5.4
AZURE_OPENAI_SUBAGENT_DEPLOYMENT=gpt-5.4-mini
AZURE_OPENAI_API_VERSION=
AZURE_STORAGE_ACCOUNT=
SUPPLY_SENTINEL_INPUT_CONTAINER=input
SUPPLY_SENTINEL_OUTPUT_CONTAINER=output
COSMOS_DATABASE=supply-sentinel
COSMOS_CONTAINER_RUNS=runs
COSMOS_CONTAINER_ALERTS=alert_state
COSMOS_CONTAINER_EVENTS=risk_events
COSMOS_CONTAINER_ASSESSMENTS=impact_assessments
AI_MAX_INPUT_CHARS=12000
AI_MAX_EVENTS_PER_RUN=10
AI_ENABLE_REPORT_GENERATION=true
```

Key Vault / Managed Identity で扱うもの:

```text
AZURE_OPENAI_API_KEY
EXTERNAL_NEWS_API_KEY
SUPPLIER_PORTAL_API_KEY
```

Managed Identityで接続できる場合はAPIキーを減らす。

## 6. デプロイ後確認

Deploy workflow 後に最低限確認する内容:

- Functions App の `/api/health` が 200 を返す
- `/api/latest` が最新の dashboard model を返す
- 手動実行API `/api/run-demo` が成功する
- Cosmos DB に `runs` が1件追加される
- Application Insights にエラーが出ていない

## 7. 今後必要な実装変更

現在のコードはローカル/静的デモ中心。Azure Functionsで本格稼働するには以下が必要。

| 項目 | 現在 | 変更後 |
|---|---|---|
| Function entry | `src/function_app/timerTrigger.mjs` の簡易関数 | Azure Functions Node.js v4 programming model か function.json 構成に合わせる |
| State | `outputs/latest` | Cosmos DB + Blob output |
| Input | `data/samples` | Blob input container |
| AI | deterministic extractor | Azure OpenAI client |
| Dashboard data | `web/dashboard_data.json` | `/api/latest` から取得、または Blob static JSON |
| Demo playback | `web/demo_events.json` | demo modeでは維持。本番modeでは実行履歴から生成 |

## 8. ブランチ運用

Hackathonではシンプルにする。

- `main`: 常にデモ可能な状態
- PR: 任意。時間がなければ直接pushでもCIを必ず通す
- Azure deploy: 手動実行

## 9. 失敗時の切り戻し

- Azureデプロイに失敗しても GitHub Pages デモは維持する
- `RUN_MODE=demo` で deterministic mock に戻せる
- AI接続失敗時は前回の `dashboard_data` を表示する
- デモ直前は `?demo=play` の静的デモURLをバックアップにする
