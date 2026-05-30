// Route engine: deterministic geo + sourcing layer.
//
// Design philosophy alignment: the AI extracts the external risk event, but the
// translation into "which procurement routes, what share, how much spend, which
// plants" is rule-based and testable -- the same boundary used by impactEngine.
//
// Tiers (川上 / 川中 / 川下):
//   upstream   = origin refinery / mill (where the material is produced)
//   midstream  = supplier + transit port + transport mode
//   downstream = our plant -> product -> customer (the side we sit on)

const REGION_GROUPS = {
  asia: ["asia", "southeast asia", "east asia", "northeast asia", "south asia"],
  "southeast asia": ["southeast asia", "asia"],
  "east asia": ["east asia", "asia"],
  "middle east": ["middle east", "gulf"],
  europe: ["europe", "eu", "western europe"],
  japan: ["japan", "domestic"],
};

export function buildRouteIntelligence(riskEvent, data) {
  const allRoutes = (data.supplyRoutes ?? []).map(normalizeRoute);
  const focalMaterial = riskEvent.material;
  const eventRegion = riskEvent.region ?? null;

  const routes = allRoutes.map((route) => {
    const isFocal = sameKey(route.material, focalMaterial);
    const inAffectedRegion = isFocal && regionMatches(eventRegion, route.region);
    const status = !isFocal ? "normal" : inAffectedRegion ? "disrupted" : "resilient";
    return { ...route, focal: isFocal, affected: inAffectedRegion, status };
  });

  const sourcing = buildSourcing(routes, focalMaterial);
  const mapNodes = buildMapNodes(routes);
  const flow = buildFlow(routes, focalMaterial, data);
  const kpis = buildKpis(routes, sourcing, riskEvent);

  return {
    focal_material: focalMaterial,
    event_region: eventRegion,
    routes,
    map_nodes: mapNodes,
    sourcing,
    flow,
    kpis,
  };
}

function buildSourcing(routes, focalMaterial) {
  const byMaterial = {};
  for (const route of routes) {
    const bucket = (byMaterial[route.material] ??= {
      material: route.material,
      total_share: 0,
      total_spend: 0,
      affected_share: 0,
      affected_spend: 0,
      route_count: 0,
      affected_count: 0,
      routes: [],
    });
    bucket.total_share += route.share_percent;
    bucket.total_spend += route.monthly_spend_usd;
    bucket.route_count += 1;
    if (route.affected) {
      bucket.affected_share += route.share_percent;
      bucket.affected_spend += route.monthly_spend_usd;
      bucket.affected_count += 1;
    }
    bucket.routes.push({
      route_id: route.route_id,
      origin: route.origin.name,
      region: route.region,
      supplier: route.supplier,
      share_percent: route.share_percent,
      monthly_spend_usd: route.monthly_spend_usd,
      lead_time_days: route.lead_time_days,
      status: route.status,
    });
  }

  return {
    by_material: byMaterial,
    focal: byMaterial[focalMaterial] ?? null,
  };
}

function buildMapNodes(routes) {
  const nodes = new Map();
  const add = (id, type, label, sublabel, lat, lng, affected) => {
    const existing = nodes.get(id);
    if (existing) {
      existing.affected = existing.affected || affected;
      return;
    }
    nodes.set(id, { id, type, label, sublabel, lat, lng, affected });
  };

  for (const route of routes) {
    add(
      `origin:${route.origin.name}`,
      "origin",
      route.origin.name,
      `${route.origin.country} · ${route.origin.type}`,
      route.origin.lat,
      route.origin.lng,
      route.affected,
    );
    if (route.port.name && route.port.lat != null) {
      add(
        `port:${route.port.name}`,
        "port",
        route.port.name,
        route.transport_mode,
        route.port.lat,
        route.port.lng,
        route.affected,
      );
    }
    add(
      `plant:${route.plant.name}`,
      "plant",
      route.plant.name,
      "Our plant",
      route.plant.lat,
      route.plant.lng,
      route.affected,
    );
  }

  return [...nodes.values()];
}

// Process-mining style left-to-right flow for the focal material:
// Origin (upstream) -> Supplier/Port (midstream) -> Plant -> Product -> Customer
function buildFlow(routes, focalMaterial, data) {
  const nodes = new Map();
  const edges = [];
  const addNode = (id, stage, label, sublabel, type) => {
    if (!nodes.has(id)) {
      nodes.set(id, { id, stage, label, sublabel, type, value: 0 });
    }
    return nodes.get(id);
  };
  const addEdge = (source, target, value, status) => {
    edges.push({ source, target, value, status });
    nodes.get(source).value += value;
    nodes.get(target).value += value;
  };

  const focalRoutes = routes.filter((route) => sameKey(route.material, focalMaterial));
  for (const route of focalRoutes) {
    const originId = `o:${route.origin.name}`;
    const midId = `m:${route.supplier}`;
    const plantId = `p:${route.plant.name}`;
    addNode(originId, 0, route.origin.name, route.region, "origin");
    addNode(midId, 1, route.supplier, route.port.name || route.transport_mode, "supplier");
    addNode(plantId, 2, route.plant.name, "plant", "plant");
    addEdge(originId, midId, route.share_percent, route.status);
    addEdge(midId, plantId, route.share_percent, route.status);
  }

  // Plant -> Product -> Customer, derived from BOM + orders for the focal material.
  const bom = data.bom ?? [];
  const orders = data.orders ?? [];
  const focalProducts = new Set(
    bom.filter((row) => sameKey(row.material, focalMaterial)).map((row) => row.product),
  );
  for (const order of orders) {
    if (!focalProducts.has(order.product)) {
      continue;
    }
    const plantId = `p:${order.plant}`;
    const productId = `pr:${order.product}`;
    const customerId = `c:${order.customer}`;
    addNode(plantId, 2, order.plant, "plant", "plant");
    addNode(productId, 3, order.product, "product", "product");
    addNode(customerId, 4, order.customer, order.priority, "customer");
    const value = Number(order.quantity) || 1;
    const status = order.priority === "high" ? "disrupted" : "exposed";
    addEdge(plantId, productId, value, status);
    addEdge(productId, customerId, value, status);
  }

  return { nodes: [...nodes.values()], edges };
}

function buildKpis(routes, sourcing, riskEvent) {
  const focal = sourcing.focal;
  const focalRoutes = routes.filter((route) => route.focal);
  return {
    focal_material: riskEvent.material,
    total_routes: focalRoutes.length,
    affected_routes: focalRoutes.filter((route) => route.affected).length,
    resilient_routes: focalRoutes.filter((route) => route.status === "resilient").length,
    affected_share_percent: focal ? round(focal.affected_share, 1) : 0,
    total_share_percent: focal ? round(focal.total_share, 1) : 0,
    monthly_spend_at_risk: focal ? focal.affected_spend : 0,
    total_monthly_spend: focal ? focal.total_spend : 0,
    lead_time_max_days: focalRoutes.length
      ? Math.max(...focalRoutes.map((route) => route.lead_time_days))
      : 0,
  };
}

function normalizeRoute(row) {
  return {
    route_id: row.route_id,
    material: row.material,
    region: row.region,
    origin: {
      name: row.origin_name,
      country: row.origin_country,
      type: row.origin_type,
      lat: toNum(row.origin_lat),
      lng: toNum(row.origin_lng),
    },
    supplier: row.supplier,
    port: {
      name: row.port_name,
      lat: toNum(row.port_lat),
      lng: toNum(row.port_lng),
    },
    transport_mode: row.transport_mode,
    plant: {
      name: row.dest_plant,
      lat: toNum(row.plant_lat),
      lng: toNum(row.plant_lng),
    },
    share_percent: toNum(row.share_percent),
    monthly_spend_usd: toNum(row.monthly_spend_usd),
    lead_time_days: toNum(row.lead_time_days),
    baseline_status: row.baseline_status,
  };
}

function regionMatches(eventRegion, routeRegion) {
  const event = String(eventRegion ?? "").toLowerCase().trim();
  const route = String(routeRegion ?? "").toLowerCase().trim();
  if (!event || !route) {
    return false;
  }
  if (event === route) {
    return true;
  }
  const group = REGION_GROUPS[event];
  return Boolean(group && group.includes(route));
}

function sameKey(left, right) {
  return String(left).toLowerCase() === String(right).toLowerCase();
}

function toNum(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
