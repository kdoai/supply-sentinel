// propagationEngine.mjs — deterministic risk propagation over the supply DAG.
//
// Given a network (nodes+edges) and a disruption (hit nodes + capacity drop),
// it propagates reduced "availability" downstream and derives meaningful,
// formula-based business metrics (affected supply %, spend at risk, inventory
// days, transparent risk score). It coexists with impactEngine/routeEngine;
// it does NOT replace them.
//
// Reuses scoring.mjs so the risk score stays explainable (5 weighted factors).

import { calculateRiskScore, severityFromScore } from "./scoring.mjs";

const FULL = 0.999; // availability >= FULL means "fully supplied"

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

// Kahn topological order. Returns ids upstream-first.
export function topoOrder(nodes, edges) {
  const indeg = new Map(nodes.map((n) => [n.id, 0]));
  const adj = new Map(nodes.map((n) => [n.id, []]));
  for (const e of edges) {
    if (!adj.has(e.source) || !indeg.has(e.target)) continue;
    adj.get(e.source).push(e.target);
    indeg.set(e.target, indeg.get(e.target) + 1);
  }
  const queue = [];
  for (const [id, d] of indeg) if (d === 0) queue.push(id);
  const order = [];
  while (queue.length) {
    const id = queue.shift();
    order.push(id);
    for (const t of adj.get(id) || []) {
      indeg.set(t, indeg.get(t) - 1);
      if (indeg.get(t) === 0) queue.push(t);
    }
  }
  return order;
}

// Compute availability ∈ [0,1] for every node given a disruption.
// availability[target] = Σ availability[source]*dependency + (1 - Σdependency)
// (the unmodeled remainder of intake is assumed fully available).
export function propagate(network, disruption = {}) {
  const nodes = network.nodes || [];
  const edges = network.edges || [];
  const inbound = new Map(nodes.map((n) => [n.id, []]));
  for (const e of edges) if (inbound.has(e.target)) inbound.get(e.target).push(e);

  const drop = Number(disruption.capacity_drop) || 0;
  const hit = new Map();
  for (const id of disruption.hit_nodes || []) hit.set(id, clamp01(1 - drop));
  for (const [id, d] of Object.entries(disruption.node_drops || {})) {
    hit.set(id, clamp01(1 - Number(d)));
  }

  const avail = new Map();
  for (const id of topoOrder(nodes, edges)) {
    if (hit.has(id)) {
      avail.set(id, hit.get(id));
      continue;
    }
    const ins = inbound.get(id) || [];
    if (ins.length === 0) {
      avail.set(id, 1);
      continue;
    }
    let sum = 0;
    let depSum = 0;
    for (const e of ins) {
      const dep = e.dependency != null ? Number(e.dependency) : (Number(e.share_percent) || 0) / 100;
      sum += (avail.has(e.source) ? avail.get(e.source) : 1) * dep;
      depSum += dep;
    }
    avail.set(id, clamp01(sum + Math.max(0, 1 - depSum)));
  }
  return avail;
}

// Edges whose target is our side (plant/self) carrying the focal material.
function inboundToSelf(network) {
  const byId = new Map((network.nodes || []).map((n) => [n.id, n]));
  const focal = network.focal_material;
  return (network.edges || []).filter((e) => {
    const t = byId.get(e.target);
    return t && (t.kind === "plant" || t.kind === "self") && e.material === focal;
  });
}

// Full propagation + status maps + formula-based business metrics.
// context: { inventory[], alternatives[], risk_inputs{severity,confidence} }
export function computeMetrics(network, disruption = {}, context = {}) {
  const avail = propagate(network, disruption);
  const byId = new Map((network.nodes || []).map((n) => [n.id, n]));
  const focal = network.focal_material;

  // --- supply side: affected share + spend (full spend on affected lanes,
  // matching the established route-engine KPI semantics). ---
  const selfEdges = inboundToSelf(network);
  let totalVolume = 0;
  let affectedVolume = 0;
  let totalSpend = 0;
  let spendAtRisk = 0;
  for (const e of selfEdges) {
    const vol = Number(e.monthly_volume) || 0;
    const spend = Number(e.monthly_spend_usd) || 0;
    const affected = (avail.get(e.source) ?? 1) < FULL;
    totalVolume += vol;
    totalSpend += spend;
    if (affected) {
      affectedVolume += vol;
      spendAtRisk += spend;
    }
  }
  const affectedSupplyRatio = totalVolume > 0 ? Math.round((affectedVolume / totalVolume) * 100) : 0;

  // --- downstream: impacted products / customers / orders (availability < 1). ---
  const impactedProducts = [];
  for (const n of network.nodes || []) {
    if (n.kind === "product" && (avail.get(n.id) ?? 1) < FULL) impactedProducts.push(n.name);
  }
  const impactedOrders = [];
  const impactedCustomers = new Set();
  for (const e of network.edges || []) {
    const src = byId.get(e.source);
    const tgt = byId.get(e.target);
    if (!src || !tgt || tgt.kind !== "customer") continue;
    if ((avail.get(src.id) ?? 1) >= FULL) continue; // product feeding this customer is fine
    impactedCustomers.add(tgt.name);
    impactedOrders.push({
      order_id: e.order_id || null,
      customer: tgt.name,
      product: src.name,
      quantity: Number(e.monthly_volume) || null,
      priority: e.priority || tgt.priority || "medium",
    });
  }

  // --- inventory days (stock / daily usage), focal material. ---
  const invRows = (context.inventory || []).filter((r) => r.material === focal);
  const invDays = invRows.map((r) => round1(Number(r.stock_qty) / Number(r.daily_usage)));
  const inventoryDaysMin = invDays.length ? Math.min(...invDays) : null;

  // --- transparent risk score (reuse scoring.mjs). ---
  const approvedAlternatives = (context.alternatives || []).filter((a) => a.approved === true);
  const riskInputs = context.risk_inputs || {};
  const hasAnyDisruption = (disruption.hit_nodes || []).length > 0;
  const { score, factors } = calculateRiskScore({
    riskEvent: {
      severity: riskInputs.severity || (hasAnyDisruption ? "medium" : "low"),
      confidence: riskInputs.confidence || (hasAnyDisruption ? "medium" : "low"),
    },
    inventoryDaysMin,
    impactedOrders,
    approvedAlternatives,
  });

  // --- status maps for rendering. ---
  const nodeStatus = {};
  for (const n of network.nodes || []) {
    const a = avail.get(n.id) ?? 1;
    let status = "normal";
    if (a < FULL) status = "disrupted";
    nodeStatus[n.id] = { availability: round3(a), status };
  }
  // mark resilient backups: a focal self-supplier that is fine while a sibling lane is down.
  const plantsWithLoss = new Set(selfEdges.filter((e) => (avail.get(e.source) ?? 1) < FULL).map((e) => e.target));
  for (const e of selfEdges) {
    if ((avail.get(e.source) ?? 1) >= FULL && plantsWithLoss.has(e.target)) {
      if (nodeStatus[e.source]) nodeStatus[e.source].status = "resilient";
    }
  }

  const edgeStatus = {};
  for (const e of network.edges || []) {
    const srcAvail = avail.get(e.source) ?? 1;
    const tgt = byId.get(e.target);
    if (tgt && tgt.kind === "customer") {
      const prodAvail = avail.get(e.source) ?? 1;
      edgeStatus[e.id] = prodAvail >= FULL ? "normal"
        : (e.priority || tgt.priority) === "high" ? "disrupted" : "exposed";
    } else if (srcAvail < FULL) {
      edgeStatus[e.id] = "disrupted";
    } else if (tgt && (tgt.kind === "plant" || tgt.kind === "self") && e.material === focal && plantsWithLoss.has(e.target)) {
      edgeStatus[e.id] = "resilient";
    } else {
      edgeStatus[e.id] = "normal";
    }
  }

  return {
    availability: Object.fromEntries([...avail].map(([k, v]) => [k, round3(v)])),
    node_status: nodeStatus,
    edge_status: edgeStatus,
    hit_nodes: disruption.hit_nodes || [],
    metrics: {
      risk_score: score,
      severity: severityFromScore(score),
      event_severity: riskInputs.severity || null,
      scoring_factors: factors,
      affected_supply_ratio: affectedSupplyRatio,
      spend_at_risk_usd: spendAtRisk,
      total_spend_usd: totalSpend,
      inventory_days_min: inventoryDaysMin,
      impacted_products: impactedProducts,
      impacted_customers: [...impactedCustomers],
      impacted_orders: impactedOrders,
    },
  };
}

// Downstream reachable set from a node — powers the click-to-trace interaction.
export function traceDownstream(network, startId) {
  const adj = new Map((network.nodes || []).map((n) => [n.id, []]));
  for (const e of network.edges || []) if (adj.has(e.source)) adj.get(e.source).push(e);
  const nodes = new Set([startId]);
  const edges = new Set();
  const stack = [startId];
  while (stack.length) {
    const id = stack.pop();
    for (const e of adj.get(id) || []) {
      edges.add(e.id);
      if (!nodes.has(e.target)) {
        nodes.add(e.target);
        stack.push(e.target);
      }
    }
  }
  return { nodes: [...nodes], edges: [...edges] };
}

function round1(v) {
  return Math.round(v * 10) / 10;
}
function round3(v) {
  return Math.round(v * 1000) / 1000;
}
