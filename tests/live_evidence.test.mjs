import test from "node:test";
import assert from "node:assert/strict";
import { collectLiveEvidence } from "../src/supply_sentinel/liveEvidence.mjs";

test("live evidence is disabled by default unless explicitly enabled", async () => {
  const result = await collectLiveEvidence({ enabled: false });
  assert.equal(result.enabled, false);
  assert.deepEqual(result.newsEvents, []);
  assert.deepEqual(result.provenance, []);
});

test("collects source-backed public web evidence from the RSS search adapter", async () => {
  const seenUrls = [];
  const fetchImpl = async (url) => {
    seenUrls.push(String(url));
    return new Response(`
      <rss><channel><item>
        <title>Naphtha supply tightens after refinery disruption - Example Energy News</title>
        <link>https://example.org/naphtha-refinery-disruption</link>
        <pubDate>Mon, 01 Jun 2026 00:30:00 GMT</pubDate>
        <description>Several Asian petrochemical buyers face delayed naphtha cargoes.</description>
      </item></channel></rss>
    `, { status: 200, headers: { "content-type": "application/rss+xml" } });
  };

  const result = await collectLiveEvidence({
    enabled: true,
    fetchImpl,
    now: new Date("2026-06-01T01:00:00Z"),
  });

  assert.equal(result.enabled, true);
  assert.equal(result.newsEvents.length, 1);
  assert.equal(result.provenance.length, 1);
  assert.match(seenUrls[0], /news\.google\.com\/rss\/search/);
  assert.match(seenUrls[0], /naphtha/);
  assert.equal(result.newsEvents[0].live, true);
  assert.equal(result.newsEvents[0].url, "https://example.org/naphtha-refinery-disruption");
  assert.equal(result.provenance[0].origin, "live_web");
  assert.equal(result.provenance[0].url, "https://example.org/naphtha-refinery-disruption");
});
