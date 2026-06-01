// Tests for the LLM-driven research agent (the scheduled 情報収集エージェント).
//
// No real network and no real Azure: a mock fetchImpl routes Azure-OpenAI calls
// vs Google-News RSS calls by URL, so the full tool-calling loop is exercised
// deterministically and offline.

import test from "node:test";
import assert from "node:assert/strict";
import { runResearchAgent } from "../src/supply_sentinel/researchAgent.mjs";

const CLOUD_CONFIG = {
  endpoint: "https://example-aoai.openai.azure.com",
  apiKey: "test-key",
  deployment: "gpt-5.4-mini",
  subagentDeployment: "gpt-5.4-mini",
  apiVersion: "2025-04-01-preview",
  useAad: false, // api-key path -> no @azure/identity / network for auth
};

function rssResponse(items) {
  const body = `<rss><channel>${items
    .map(
      (it) => `<item><title>${it.title}</title><link>${it.link}</link>` +
        `<pubDate>${it.pubDate || "Mon, 01 Jun 2026 00:30:00 GMT"}</pubDate>` +
        `<description>${it.description || it.title}</description></item>`,
    )
    .join("")}</channel></rss>`;
  return new Response(body, { status: 200, headers: { "content-type": "application/rss+xml" } });
}

function azureMessageResponse(message) {
  return new Response(JSON.stringify({ choices: [{ message }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

test("agent path: model drives a search via tool-calling and grounds the curated evidence", async () => {
  const azureBodies = [];
  let azureCall = 0;

  const fetchImpl = async (url, init) => {
    const href = String(url);
    if (href.includes("openai.azure.com")) {
      azureBodies.push(JSON.parse(init.body));
      azureCall += 1;
      if (azureCall === 1) {
        // Turn 1: the model decides to call the search tool.
        return azureMessageResponse({
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: { name: "search_news", arguments: JSON.stringify({ query: "naphtha refinery outage Asia", material: "naphtha" }) },
            },
          ],
        });
      }
      // Turn 2: the model returns curated JSON. The 2nd URL is hallucinated and
      // must be dropped; the 1st is real and must be kept + annotated.
      return azureMessageResponse({
        role: "assistant",
        content: JSON.stringify({
          evidence: [
            { url: "https://example.org/naphtha-outage", why_relevant: "Asian refinery cut runs", material: "naphtha", confidence: "high" },
            { url: "https://hallucinated.example/not-real", why_relevant: "made up", material: "naphtha", confidence: "low" },
          ],
          summary: "Asian naphtha supply tightening.",
        }),
      });
    }
    // Google News RSS search.
    assert.match(href, /news\.google\.com\/rss\/search/);
    assert.match(href, /naphtha/);
    return rssResponse([
      { title: "Asian refinery cuts naphtha runs - Reuters", link: "https://example.org/naphtha-outage" },
    ]);
  };

  const result = await runResearchAgent({
    enabled: true,
    mode: "cloud",
    config: CLOUD_CONFIG,
    fetchImpl,
    now: new Date("2026-06-01T01:00:00Z"),
    materials: ["naphtha"],
  });

  assert.equal(result.enabled, true);
  assert.equal(result.mode, "agent");
  assert.deepEqual(result.queries, ["naphtha refinery outage Asia"]);

  // The first Azure request must advertise the search_news tool.
  assert.equal(azureBodies[0].tools[0].function.name, "search_news");
  // The second request must include the tool result message we fed back.
  assert.ok(azureBodies[1].messages.some((m) => m.role === "tool"));

  // Only the REAL url survives (anti-hallucination); it carries the agent note.
  assert.equal(result.provenance.length, 1);
  assert.equal(result.provenance[0].url, "https://example.org/naphtha-outage");
  assert.equal(result.provenance[0].agent_curated, true);
  assert.equal(result.provenance[0].agent_note, "Asian refinery cut runs");
  assert.equal(result.newsEvents[0].url, "https://example.org/naphtha-outage");
});

test("falls back to deterministic RSS collection when the cloud model errors", async () => {
  const fetchImpl = async (url) => {
    const href = String(url);
    if (href.includes("openai.azure.com")) {
      return new Response("rate limited", { status: 429 });
    }
    // The deterministic collectLiveEvidence path uses the configured RSS source.
    return rssResponse([
      { title: "Naphtha allocation tightens - Example Energy", link: "https://example.org/fallback-rss" },
    ]);
  };

  const result = await runResearchAgent({
    enabled: true,
    mode: "cloud",
    config: CLOUD_CONFIG,
    fetchImpl,
    now: new Date("2026-06-01T01:00:00Z"),
    materials: ["naphtha"],
  });

  assert.equal(result.mode, "rss");
  assert.equal(result.enabled, true);
  assert.ok(result.provenance.length >= 1);
  assert.equal(result.provenance[0].url, "https://example.org/fallback-rss");
});

test("returns disabled/empty when live evidence is turned off", async () => {
  let fetched = false;
  const fetchImpl = async () => {
    fetched = true;
    return rssResponse([]);
  };

  const result = await runResearchAgent({ enabled: false, fetchImpl });

  assert.equal(result.enabled, false);
  assert.equal(result.mode, "disabled");
  assert.deepEqual(result.provenance, []);
  assert.deepEqual(result.queries, []);
  assert.equal(fetched, false, "must not hit the network when disabled");
});

test("demo mode never calls the cloud model even when configured", async () => {
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(String(url));
    return rssResponse([{ title: "RSS only - Example", link: "https://example.org/demo-rss" }]);
  };

  const result = await runResearchAgent({
    enabled: true,
    mode: "demo", // demo must skip the LLM path entirely
    config: CLOUD_CONFIG,
    fetchImpl,
    now: new Date("2026-06-01T01:00:00Z"),
    materials: ["naphtha"],
  });

  assert.equal(result.mode, "rss");
  assert.ok(!seen.some((u) => u.includes("openai.azure.com")), "demo mode must not call Azure OpenAI");
});
