import assert from "node:assert/strict";
import test from "node:test";

import { buildEvidenceTimeline } from "../src/supply_sentinel/evidenceTimeline.mjs";

test("buildEvidenceTimeline uses only public live URLs and shows score movement", () => {
  const timeline = buildEvidenceTimeline({
    provenance: [
      {
        id: "old",
        kind: "news",
        source: "Reuters",
        claim: "Semiconductor adhesive supply delay hits Asian electronics makers",
        url: "https://example.org/old",
        published_at: "2026-05-01T00:00:00Z",
        origin: "live_web",
      },
      {
        id: "fake",
        kind: "news",
        source: "Demo",
        claim: "架空ソース",
        url: "https://example.org/fake",
        published_at: "2026-05-02T00:00:00Z",
        origin: "demo_source",
      },
      {
        id: "new",
        kind: "news",
        source: "Kpler",
        claim: "Naphtha shortage after refinery outage",
        url: "https://example.org/new",
        published_at: "2026-05-03T00:00:00Z",
        origin: "live_web",
      },
    ],
    assessment: {
      risk_score: 82,
      inventory_days_min: 5,
      impacted_products: ["樹脂"],
      impacted_customers: ["自動車部品A社"],
    },
    riskEvent: { material: "naphtha" },
    materials: [
      { material_id: "naphtha", display_name: "ナフサ", aliases: ["naphtha"], monitoring_keywords: ["refinery outage"] },
      { material_id: "semiconductor-adhesive", display_name: "半導体接着材", aliases: ["semiconductor adhesive"] },
    ],
  });

  assert.equal(timeline.length, 2);
  assert.deepEqual(timeline.map((item) => item.url), ["https://example.org/old", "https://example.org/new"]);
  assert.equal(timeline[0].material, "semiconductor-adhesive");
  assert.equal(timeline[1].material, "naphtha");
  assert.ok(timeline[0].score_after > timeline[0].score_before);
  assert.equal(timeline.at(-1).score_after, 82);
});
