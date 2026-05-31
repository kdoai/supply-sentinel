import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runSupplySentinel } from "./supply_sentinel/workflow.mjs";
import { createStateStore } from "./supply_sentinel/stateStore.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, "..");
const webDir = path.join(rootDir, "web");
const outputsDir = path.join(rootDir, "outputs", "latest");

const PORT = Number(process.env.PORT) || 4173;
const HOST = process.env.HOST || "127.0.0.1";

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".geojson": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

function contentTypeFor(filePath) {
  return CONTENT_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

// Resolve a request path against an allowed base dir, guarding against traversal.
function resolveWithin(baseDir, relative) {
  const resolved = path.resolve(baseDir, "." + path.posix.normalize("/" + relative));
  const baseWithSep = baseDir.endsWith(path.sep) ? baseDir : baseDir + path.sep;
  if (resolved !== baseDir && !resolved.startsWith(baseWithSep)) {
    return null;
  }
  return resolved;
}

async function sendFile(res, filePath) {
  try {
    const body = await readFile(filePath);
    res.writeHead(200, { "Content-Type": contentTypeFor(filePath) });
    res.end(body);
  } catch (err) {
    if (err && err.code === "ENOENT") {
      sendStatus(res, 404, "Not Found");
    } else {
      console.error(`Error reading ${filePath}:`, err && err.message ? err.message : err);
      sendStatus(res, 500, "Internal Server Error");
    }
  }
}

function sendStatus(res, code, message) {
  res.writeHead(code, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(message);
}

function sendJson(res, code, body) {
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify(body));
}

// Map a request to a file path inside an allowed dir, or null if not routable.
function route(pathname) {
  if (pathname === "/" || pathname === "/index.html") {
    return path.join(webDir, "index.html");
  }
  if (pathname === "/styles.css") {
    return path.join(webDir, "styles.css");
  }
  if (pathname === "/config.js") {
    return path.join(webDir, "config.js");
  }
  if (pathname === "/dashboard_data.json") {
    return path.join(outputsDir, "dashboard_data.json");
  }
  if (pathname === "/demo_events.json") {
    return path.join(webDir, "demo_events.json");
  }
  if (pathname.startsWith("/js/")) {
    return resolveWithin(path.join(webDir, "js"), pathname.slice("/js/".length));
  }
  if (pathname.startsWith("/assets/")) {
    return resolveWithin(path.join(webDir, "assets"), pathname.slice("/assets/".length));
  }
  return null;
}

const server = http.createServer(async (req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    sendStatus(res, 405, "Method Not Allowed");
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, `http://${req.headers.host || HOST}`).pathname);
  } catch {
    sendStatus(res, 400, "Bad Request");
    return;
  }

  if (pathname === "/api/health") {
    sendJson(res, 200, { ok: true, app: "Supply Sentinel", served_at: new Date().toISOString() });
    return;
  }

  if (pathname === "/api/latest-dashboard") {
    try {
      const store = createStateStore({ outputDir: outputsDir });
      const dashboard = await store.getLatestDashboard();
      sendJson(res, 200, {
        served_at: new Date().toISOString(),
        state_store: store.kind,
        dashboard,
      });
    } catch (err) {
      sendJson(res, 404, {
        error: "latest_dashboard_not_found",
        message: err && err.message ? err.message : String(err),
      });
    }
    return;
  }

  const filePath = route(pathname);
  if (!filePath) {
    sendStatus(res, 404, "Not Found");
    return;
  }

  await sendFile(res, filePath);
});

function logSummary(result) {
  if (!result || typeof result !== "object") return;
  const assessment = result.assessment || {};
  const kpis = (result.routeIntel && result.routeIntel.kpis) || {};
  const material = assessment.material ?? result.material ?? "unknown";
  const riskScore = assessment.risk_score ?? result.risk_score ?? "n/a";
  const affectedShare = kpis.affected_share_percent ?? assessment.affected_share ?? "n/a";
  const spendAtRisk = kpis.monthly_spend_at_risk ?? assessment.spend_at_risk ?? "n/a";
  const spendDisplay = typeof spendAtRisk === "number"
    ? `$${spendAtRisk.toLocaleString("en-US")}/mo`
    : spendAtRisk;
  const shareDisplay = typeof affectedShare === "number" ? `${affectedShare}%` : affectedShare;

  console.log("Supply Sentinel run complete:");
  console.log(`  Material:        ${material}`);
  console.log(`  Risk score:      ${riskScore}/100`);
  console.log(`  Affected share:  ${shareDisplay}`);
  console.log(`  Spend at risk:   ${spendDisplay}`);
}

async function main() {
  console.log("Generating dashboard data...");
  try {
    const result = await runSupplySentinel({ rootDir });
    logSummary(result);
  } catch (err) {
    console.error("Failed to generate dashboard data:", err && err.message ? err.message : err);
    console.error("Starting server anyway; /dashboard_data.json may be stale or missing.");
  }

  server.listen(PORT, HOST, () => {
    console.log("");
    console.log(`Supply Sentinel dashboard:  http://${HOST}:${PORT}`);
    console.log("Press Ctrl+C to stop.");
  });
}

main();
