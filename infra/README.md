# Azure Infrastructure

Supply Sentinel is designed to demo as a low-cost, secure Azure application.
The target monthly cost for the hackathon environment is a few thousand yen by
running the agent on a timer, using serverless storage, and keeping AI calls
short and cached.

## Minimal Cloud Shape

| Layer | Azure service | Cost/security choice |
| --- | --- | --- |
| Frontend | Azure Storage static website | Static files only; no secrets in browser. |
| API and scheduler | Azure Container Apps Consumption + scheduled Job | API scales to zero/one replica; agent job runs every 6 hours by default. |
| Container registry | Azure Container Registry Basic | Private image registry, no admin password, GitHub OIDC pushes images. |
| State | Azure Cosmos DB for NoSQL Serverless | Serverless, local keys disabled, managed identity access. |
| AI | Azure OpenAI through Azure AI Foundry | Main and sub-agent deployments use `gpt-5.4-mini` on East US 2 `DataZoneStandard` for the live hackathon demo. |
| CI/CD identity | GitHub Actions OIDC + Entra ID | No publish profile, no client secret, no API key in Git. |

Teams notification is intentionally excluded from this deployment because the
current demo focuses on the dashboard and operational decision flow.

## Security Model

- GitHub deploys with OIDC federation, not a stored Azure password.
- The Container App and scheduled Job use managed identity for Cosmos DB and ACR pull.
- Cosmos DB local auth is disabled, so leaked keys cannot be abused.
- The public HTTP endpoint is read-only and returns only sanitized dashboard
  data for the demo.
- Static web storage allows public reads only for frontend assets.
- App settings may contain non-secret endpoint names. API keys are not required
  for Cosmos DB and must never be committed.

## Cost Guardrails

- Container Apps: 0.25 CPU / 0.5 GiB, max 1 API replica, scheduled job every 6 hours.
- ACR: Basic tier with short image retention.
- Cosmos DB: Serverless, one region, small demo documents.
- Storage: LRS only, small static assets.
- Azure OpenAI: main and sub-agent deployment is `gpt-5.4-mini`. Keep prompts
  short, keep the deployment capacity low, and use `RUN_MODE=demo` when a fully
  deterministic rehearsal is needed.
- Set a subscription budget alert manually or with the bootstrap script.

## First Setup

Prerequisites:

- Azure CLI logged in with an account that can create resource groups and role
  assignments.
- GitHub CLI logged in to `kdoai/supply-sentinel`.

Recommended command:

```powershell
.\scripts\bootstrap-azure-oidc.ps1 `
  -SubscriptionId "<subscription-id>" `
  -Repository "kdoai/supply-sentinel" `
  -Location "japaneast"
```

The script creates the resource group, Entra app registration, GitHub OIDC
federated credential, scoped role assignments, GitHub secrets/variables, and the
initial Bicep deployment. No client secret is created.

## Deploy

After bootstrap, run the GitHub Actions workflow:

```powershell
gh workflow run deploy-azure.yml -R kdoai/supply-sentinel -f run_mode=demo
```

The workflow validates the app, deploys Azure resources from `infra/main.bicep`,
builds and pushes the container image to ACR, updates the Container App and
scheduled Job, writes `web/config.js` with the API endpoint, and uploads the
static dashboard to the `$web` container.

## Switching Materials

The demo data model is intentionally product/material driven. To move from
naphtha to another material, replace or extend the sample files under `data/`
with:

- material master
- BOM
- inventory
- supplier/source notices
- route intelligence
- impacted orders and customers

The workflow and dashboard should remain the same. This preserves the original
design idea: external signals are translated into internal operational impact.
