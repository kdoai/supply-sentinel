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

  if ((mode === "azure" || mode === "cloud") && azureOpenAiConfigured()) {
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

async function extractWithAzureOpenAi(data, config) {
  const endpoint = config.endpoint.replace(/\/$/, "");
  const url = `${endpoint}/openai/deployments/${encodeURIComponent(config.deployment)}/chat/completions?api-version=${encodeURIComponent(config.apiVersion)}`;
  const headers = {
    "content-type": "application/json",
  };

  if (config.useAad) {
    const { DefaultAzureCredential } = await import("@azure/identity");
    const credential = new DefaultAzureCredential();
    const token = await credential.getToken("https://cognitiveservices.azure.com/.default");
    headers.authorization = `Bearer ${token.token}`;
  } else {
    headers["api-key"] = config.apiKey;
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      temperature: 0,
      max_tokens: 900,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You extract supply-chain risk events. Return only valid JSON matching the requested schema. Do not invent facts beyond the sources.",
        },
        {
          role: "user",
          content: buildRiskExtractionPrompt(data),
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Azure OpenAI HTTP ${response.status}: ${await response.text()}`);
  }

  const payload = await response.json();
  const content = payload.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("Azure OpenAI returned no message content.");
  }

  return normalizeRiskEvent(JSON.parse(content), data);
}

function buildRiskExtractionPrompt({ newsEvents = [], supplierNotices = [] }) {
  const sourceBundle = {
    news_events: newsEvents.slice(0, 5),
    supplier_notices: supplierNotices.slice(0, 5),
  };

  return [
    "Extract one most important supply risk event from these sources.",
    "Return JSON with this schema:",
    "{",
    '  "material": "naphtha | packaging-film | semiconductor-adhesive | unknown",',
    '  "risk_type": "allocation | supply_delay | shutdown | logistics_delay | price_spike | unknown",',
    '  "region": "string or null",',
    '  "affected_period": "string",',
    '  "delay_days_min": 0,',
    '  "delay_days_max": 0,',
    '  "allocation_rate_percent": 100,',
    '  "severity": "low | medium | high | critical",',
    '  "confidence": "low | medium | high",',
    '  "evidence": ["short evidence strings"],',
    '  "summary": "one concise sentence",',
    '  "sources": { "news_id": "string or null", "supplier_notice_id": "string or null" }',
    "}",
    "Sources:",
    JSON.stringify(sourceBundle),
  ].join("\n");
}

function normalizeRiskEvent(event, data) {
  const fallback = extractDeterministic(data);
  const next = event && typeof event === "object" ? event : {};
  return {
    material: stringOr(next.material, fallback.material),
    risk_type: stringOr(next.risk_type, fallback.risk_type),
    region: next.region ?? fallback.region ?? null,
    affected_period: stringOr(next.affected_period, fallback.affected_period),
    delay_days_min: numberOr(next.delay_days_min, fallback.delay_days_min),
    delay_days_max: numberOr(next.delay_days_max, fallback.delay_days_max),
    allocation_rate_percent: numberOr(next.allocation_rate_percent, fallback.allocation_rate_percent),
    severity: stringOr(next.severity, fallback.severity),
    confidence: stringOr(next.confidence, fallback.confidence),
    evidence: Array.isArray(next.evidence) && next.evidence.length ? next.evidence.map(String) : fallback.evidence,
    summary: stringOr(next.summary, fallback.summary),
    sources: {
      news_id: next.sources?.news_id ?? fallback.sources?.news_id ?? null,
      supplier_notice_id: next.sources?.supplier_notice_id ?? fallback.sources?.supplier_notice_id ?? null,
    },
  };
}

function stringOr(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function numberOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

// Re-exported so tests and callers can reference the mock explicitly.
export { extractDeterministic };
