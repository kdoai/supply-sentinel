// networkSchema.mjs — the LOCKED data contract for the multi-tier supply network.
//
// Phase B/C agents author scenario/timeseries JSON; this module mechanically
// validates them so parallel work cannot diverge on shape or numbers.
// DO NOT change the invariants here without bumping the schema doc + golden tests.

export const TIERS = { SELF: 0, TIER1: 1, TIER2: 2, ORIGIN: 3 };
export const KINDS = ["self", "plant", "product", "customer", "supplier", "refinery", "port"];
export const PROVENANCE_KINDS = ["news", "supplier_notice", "logistics", "price_feed"];

// Shared status color tokens (kept identical to web/js/panels.js + flow.js).
export const STATUS_COLORS = {
  disrupted: "#c9362f",
  exposed: "#b66a00",
  resilient: "#18794e",
  normal: "#2563a8",
};

const SHARE_TOLERANCE = 1.5; // Σ share_percent per (target,material) ≈ 100
const DEP_TOLERANCE = 0.02; // dependency ≈ share_percent / 100
const SPEND_TOLERANCE = 1; // spend == round(volume*price)

function isNum(v) {
  return typeof v === "number" && Number.isFinite(v);
}

// Validate a network {focal_material, nodes[], edges[]}. Returns {ok, errors[]}.
export function validateNetwork(network, label = "network") {
  const errors = [];
  const nodes = Array.isArray(network?.nodes) ? network.nodes : null;
  const edges = Array.isArray(network?.edges) ? network.edges : null;
  if (!nodes) errors.push(`${label}: nodes[] missing`);
  if (!edges) errors.push(`${label}: edges[] missing`);
  if (!nodes || !edges) return { ok: false, errors };

  const ids = new Set();
  for (const n of nodes) {
    if (!n || typeof n.id !== "string") errors.push(`${label}: node without string id`);
    else if (ids.has(n.id)) errors.push(`${label}: duplicate node id ${n.id}`);
    else ids.add(n.id);
    if (n && !KINDS.includes(n.kind)) errors.push(`${label}: node ${n?.id} bad kind ${n?.kind}`);
    if (n && !Number.isInteger(n.tier)) errors.push(`${label}: node ${n?.id} bad tier ${n?.tier}`);
  }

  const edgeIds = new Set();
  for (const e of edges) {
    if (!e || typeof e.id !== "string") {
      errors.push(`${label}: edge without string id`);
      continue;
    }
    if (edgeIds.has(e.id)) errors.push(`${label}: duplicate edge id ${e.id}`);
    edgeIds.add(e.id);
    if (!ids.has(e.source)) errors.push(`${label}: edge ${e.id} source ${e.source} not a node`);
    if (!ids.has(e.target)) errors.push(`${label}: edge ${e.id} target ${e.target} not a node`);
    if (e.source === e.target) errors.push(`${label}: edge ${e.id} is a self-loop`);
    if (isNum(e.monthly_volume) && isNum(e.unit_price_usd)) {
      const expected = Math.round(e.monthly_volume * e.unit_price_usd);
      if (!isNum(e.monthly_spend_usd) || Math.abs(e.monthly_spend_usd - expected) > SPEND_TOLERANCE) {
        errors.push(`${label}: edge ${e.id} spend ${e.monthly_spend_usd} != volume*price ${expected}`);
      }
    }
  }

  // DAG check (Kahn). A cycle means topoSort can't drain all nodes.
  if (topoLength(nodes, edges) !== nodes.length) {
    errors.push(`${label}: graph has a cycle (must be a DAG)`);
  }

  // Per (target, material) share/dependency sums for material-bearing volume edges.
  const groups = new Map();
  for (const e of edges) {
    // Only material-bearing physical-supply edges carry the share/dependency
    // invariant. Product→customer order edges carry order qty, not intake share.
    if (!isNum(e.monthly_volume) || !e.material) continue;
    const key = `${e.target}__${e.material}`;
    const g = groups.get(key) || { share: 0, dep: 0, edges: [] };
    g.share += Number(e.share_percent) || 0;
    g.dep += Number(e.dependency) || 0;
    g.edges.push(e);
    groups.set(key, g);
  }
  for (const [key, g] of groups) {
    if (Math.abs(g.share - 100) > SHARE_TOLERANCE) {
      errors.push(`${label}: Σ share_percent for ${key} = ${g.share} (≈100 expected)`);
    }
    for (const e of g.edges) {
      const expectDep = (Number(e.share_percent) || 0) / 100;
      if (Math.abs((Number(e.dependency) || 0) - expectDep) > DEP_TOLERANCE) {
        errors.push(`${label}: edge ${e.id} dependency ${e.dependency} != share/100 ${expectDep}`);
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

export function validateScenario(scenario, label = "scenario") {
  const errors = [];
  for (const field of ["id", "label", "material", "focal_material"]) {
    if (!scenario?.[field]) errors.push(`${label}: missing ${field}`);
  }
  if (!scenario?.network) errors.push(`${label}: missing network`);
  else {
    const r = validateNetwork(scenario.network, `${label}.network`);
    errors.push(...r.errors);
  }
  const d = scenario?.disruption;
  if (!d || !Array.isArray(d.hit_nodes)) errors.push(`${label}: disruption.hit_nodes[] missing`);
  for (const p of scenario?.provenance ?? []) {
    if (!PROVENANCE_KINDS.includes(p.kind)) errors.push(`${label}: provenance kind ${p.kind} invalid`);
  }
  return { ok: errors.length === 0, errors };
}

export function validateTimeseries(ts, label = "timeseries") {
  const errors = [];
  const months = Array.isArray(ts?.months) ? ts.months : null;
  if (!months) {
    errors.push(`${label}: months[] missing`);
    return { ok: false, errors };
  }
  for (const m of months) {
    if (!m.month) errors.push(`${label}: month entry without 'month'`);
    if (!m.metrics) errors.push(`${label}: month ${m.month} without metrics`);
  }
  return { ok: errors.length === 0, errors };
}

// Topological drain count (Kahn). Equals node count iff the graph is a DAG.
function topoLength(nodes, edges) {
  const indeg = new Map(nodes.map((n) => [n.id, 0]));
  const adj = new Map(nodes.map((n) => [n.id, []]));
  for (const e of edges) {
    if (!adj.has(e.source) || !indeg.has(e.target)) continue;
    adj.get(e.source).push(e.target);
    indeg.set(e.target, (indeg.get(e.target) || 0) + 1);
  }
  const queue = [];
  for (const [id, d] of indeg) if (d === 0) queue.push(id);
  let count = 0;
  while (queue.length) {
    const id = queue.shift();
    count += 1;
    for (const t of adj.get(id) || []) {
      indeg.set(t, indeg.get(t) - 1);
      if (indeg.get(t) === 0) queue.push(t);
    }
  }
  return count;
}
