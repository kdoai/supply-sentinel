import test from "node:test";
import assert from "node:assert/strict";
import { runResearchAgent } from "../src/supply_sentinel/researchAgent.mjs";

const CLOUD_CONFIG = {
  endpoint: "https://example-aoai.openai.azure.com",
  apiKey: "test-key",
  deployment: "gpt-5.4-mini",
  subagentDeployment: "gpt-5.4-mini",
  apiVersion: "preview",
  useAad: false,
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

function responsesPayload() {
  return new Response(JSON.stringify({
    output: [
      {
        id: "ws_1",
        type: "web_search_call",
        action: {
          type: "search",
          queries: ["naphtha refinery outage Asia"],
          sources: [
            {
              url: "https://example.org/naphtha-outage",
              title: "Asian refinery cuts naphtha runs",
              snippet: "Buyers face tighter naphtha cargo availability.",
              source: "Example Energy",
            },
          ],
        },
      },
      {
        type: "message",
        content: [
          {
            type: "output_text",
            text: "Asian naphtha supply tightened.",
            annotations: [
              { type: "url_citation", url: "https://example.org/naphtha-outage", title: "Asian refinery cuts naphtha runs" },
            ],
          },
        ],
      },
    ],
  }), { status: 200, headers: { "content-type": "application/json" } });
}

test("hosted web search path requires Responses web_search and preserves returned citations", async () => {
  const bodies = [];
  const fetchImpl = async (url, init) => {
    const href = String(url);
    assert.match(href, /\/openai\/v1\/responses/);
    bodies.push(JSON.parse(init.body));
    return responsesPayload();
  };

  const result = await runResearchAgent({
    enabled: true,
    mode: "cloud",
    config: CLOUD_CONFIG,
    fetchImpl,
    now: new Date("2026-06-01T01:00:00Z"),
    materials: ["naphtha"],
    provider: "azure_web_search",
  });

  assert.equal(result.enabled, true);
  assert.equal(result.mode, "agent");
  assert.equal(result.provider, "azure_web_search");
  assert.equal(bodies[0].tools[0].type, "web_search");
  assert.equal(bodies[0].tool_choice, "required");
  assert.deepEqual(result.queries, ["naphtha refinery outage Asia"]);
  assert.equal(result.provenance.length, 1);
  assert.equal(result.provenance[0].url, "https://example.org/naphtha-outage");
  assert.equal(result.provenance[0].provider, "azure_web_search");
  assert.equal(result.newsEvents[0].evidence_id, result.provenance[0].id);
  assert.equal(result.search_health.accepted_count, 1);
});

test("falls back to deterministic RSS/GDELT when hosted web search is unsupported", async () => {
  const seen = [];
  const fetchImpl = async (url) => {
    const href = String(url);
    seen.push(href);
    if (href.includes("/openai/v1/responses")) {
      return new Response("web_search unsupported", { status: 400 });
    }
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
    provider: "auto",
  });

  assert.equal(result.mode, "rss");
  assert.ok(seen.some((url) => url.includes("/openai/v1/responses")));
  assert.ok(result.provenance.length >= 1);
  assert.equal(result.provenance[0].url, "https://example.org/fallback-rss");
  assert.match(result.agent_error || "", /unsupported|400/);
  assert.equal(result.search_health.fallback_from, "azure_web_search");
});

test("fails hosted path when required web_search was not executed, then falls back", async () => {
  const fetchImpl = async (url) => {
    const href = String(url);
    if (href.includes("/openai/v1/responses")) {
      return new Response(JSON.stringify({ output: [{ type: "message", content: [{ type: "output_text", text: "No search." }] }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return rssResponse([{ title: "RSS only - Example", link: "https://example.org/no-search-fallback" }]);
  };

  const result = await runResearchAgent({
    enabled: true,
    mode: "cloud",
    config: CLOUD_CONFIG,
    fetchImpl,
    now: new Date("2026-06-01T01:00:00Z"),
    materials: ["naphtha"],
    provider: "auto",
  });

  assert.equal(result.mode, "rss");
  assert.match(result.agent_error || "", /did not execute web_search/);
  assert.equal(result.provenance[0].url, "https://example.org/no-search-fallback");
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

test("demo mode never calls hosted web search even when configured", async () => {
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(String(url));
    return rssResponse([{ title: "RSS only - Example", link: "https://example.org/demo-rss" }]);
  };

  const result = await runResearchAgent({
    enabled: true,
    mode: "demo",
    config: CLOUD_CONFIG,
    fetchImpl,
    now: new Date("2026-06-01T01:00:00Z"),
    materials: ["naphtha"],
  });

  assert.equal(result.mode, "rss");
  assert.ok(!seen.some((u) => u.includes("/openai/v1/responses")), "demo mode must not call hosted web search");
});
