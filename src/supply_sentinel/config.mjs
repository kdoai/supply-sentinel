// Runtime configuration seam.
//
// The local build can run in "demo" mode with deterministic mocks and no cloud
// credentials, while Azure runs in "cloud" mode with Managed Identity. These
// helpers centralize how the app decides between the local mock and the Azure
// path, matching the environment variables
// documented in docs/13_azure_basic_design_ja.md and docs/14_github_cicd_azure_ja.md.
//
// Nothing here performs network calls. It only reads env vars so the Azure
// boundary is explicit and swappable without touching business logic.

export function resolveRunMode(options = {}) {
  const mode = options.mode || process.env.RUN_MODE || "demo";
  return String(mode).toLowerCase();
}

export function azureOpenAiConfig() {
  return {
    endpoint: process.env.AZURE_OPENAI_ENDPOINT || "",
    apiKey: process.env.AZURE_OPENAI_API_KEY || "",
    deployment: process.env.AZURE_OPENAI_DEPLOYMENT || "gpt-5.4-mini",
    subagentDeployment: process.env.AZURE_OPENAI_SUBAGENT_DEPLOYMENT || "gpt-5.4-mini",
    apiVersion: process.env.AZURE_OPENAI_API_VERSION || "2025-04-01-preview",
    useAad: String(process.env.AZURE_OPENAI_USE_AAD || "true").toLowerCase() !== "false",
  };
}

// True only when enough Azure OpenAI settings exist to attempt a real call.
export function azureOpenAiConfigured() {
  const config = azureOpenAiConfig();
  return Boolean(config.endpoint && config.deployment && (config.useAad || config.apiKey));
}

// Where input signals/master data come from. "local" = files under data/samples
// (current behavior). "blob" = Azure Storage container (future; see docs/13 §5).
export function dataSourceMode(options = {}) {
  const mode = options.dataSource || process.env.SUPPLY_SENTINEL_DATA_SOURCE || "local";
  return String(mode).toLowerCase();
}

// State/result storage. "local" keeps the current file-based outputs under
// outputs/latest. "cosmos" uses Cosmos DB when credentials or Managed Identity
// are available.
export function stateStoreMode(options = {}) {
  const mode = options.stateStore || process.env.SUPPLY_SENTINEL_STATE_STORE || "local";
  return String(mode).toLowerCase();
}

export function cosmosDbConfig() {
  return {
    endpoint: process.env.COSMOS_DB_ENDPOINT || "",
    key: process.env.COSMOS_DB_KEY || "",
    databaseId: process.env.COSMOS_DB_DATABASE || "supply-sentinel",
    containerId: process.env.COSMOS_DB_CONTAINER || "runs",
    useAad: String(process.env.COSMOS_DB_USE_AAD || "true").toLowerCase() !== "false",
  };
}

export function cosmosDbConfigured() {
  const config = cosmosDbConfig();
  return Boolean(config.endpoint && (config.useAad || config.key));
}
