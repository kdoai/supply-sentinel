import test from "node:test";
import assert from "node:assert/strict";
import { loadSampleData } from "../src/supply_sentinel/ingestion.mjs";
import { extractRiskEvent as extractViaClient, extractDeterministic } from "../src/supply_sentinel/aiClient.mjs";

test("aiClient in demo mode matches the deterministic mock", async () => {
  const data = await loadSampleData();
  const viaClient = await extractViaClient(data, { mode: "demo" });
  const direct = extractDeterministic(data);

  assert.equal(viaClient.material, "naphtha");
  assert.deepEqual(viaClient, direct);
});

test("aiClient falls back to the mock when azure is requested without credentials", async () => {
  const data = await loadSampleData();
  // No AZURE_OPENAI_* env in CI/local -> azureOpenAiConfigured() is false,
  // so this must safely return the deterministic event, never throw.
  const event = await extractViaClient(data, { mode: "azure" });
  assert.equal(event.material, "naphtha");
  assert.ok(Array.isArray(event.evidence));
});
