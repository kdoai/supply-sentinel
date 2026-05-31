// AI risk-extraction boundary (mock <-> Azure).
//
// Design philosophy: the AI only *extracts* the external risk event; the
// translation into business impact stays rule-based (impactEngine/routeEngine).
// This module is the single seam where the extractor swaps between:
//   - the deterministic local mock (riskExtraction.mjs) -> used in demo mode
//   - Azure AI Foundry / Azure OpenAI GPT          -> stub, wired post-cloud
//
// The local build NEVER calls the network: with no RUN_MODE=azure or no
// AZURE_OPENAI_* credentials it always uses the deterministic mock, so demos
// are fully reproducible offline. See docs/13 and docs/14.

import { extractRiskEvent as extractDeterministic } from "./riskExtraction.mjs";
import { resolveRunMode, azureOpenAiConfig, azureOpenAiConfigured } from "./config.mjs";

export async function extractRiskEvent(data, options = {}) {
  const mode = resolveRunMode(options);

  if (mode === "azure" && azureOpenAiConfigured()) {
    try {
      return await extractWithAzureOpenAi(data, azureOpenAiConfig());
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      // Fail safe: never break a run because the cloud path is unavailable.
      console.warn(`[aiClient] Azure extractor unavailable (${message}); using deterministic mock.`);
    }
  }

  return extractDeterministic(data);
}

// Placement for the Azure AI Foundry / Azure OpenAI GPT call.
//
// Intentionally not wired to the network in the local build. When RUN_MODE=azure
// and AZURE_OPENAI_* are configured, implement here:
//   1. Build a short prompt from data.newsEvents + data.supplierNotices.
//   2. Request structured output matching the RiskEvent schema
//      (see docs/13_azure_basic_design_ja.md §4.3).
//   3. Return the parsed RiskEvent object (same shape the mock returns).
// Until then this throws so extractRiskEvent() falls back to the mock.
async function extractWithAzureOpenAi(_data, _config) {
  throw new Error("Azure OpenAI extractor not configured in local build");
}

// Re-exported so tests and callers can reference the mock explicitly.
export { extractDeterministic };
