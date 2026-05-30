import { readFile } from "node:fs/promises";
import path from "node:path";

export async function loadJson(filePath) {
  const text = await readFile(filePath, "utf8");
  return JSON.parse(text);
}

export async function loadCsv(filePath) {
  const text = await readFile(filePath, "utf8");
  return parseCsv(text);
}

export function parseCsv(text) {
  const rows = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map(parseCsvLine);

  if (rows.length === 0) {
    return [];
  }

  const headers = rows[0].map((value) => value.trim());
  return rows.slice(1).map((row) => {
    const record = {};
    headers.forEach((header, index) => {
      record[header] = normalizeValue(row[index] ?? "");
    });
    return record;
  });
}

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      values.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  values.push(current);
  return values;
}

function normalizeValue(value) {
  const trimmed = value.trim();
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }
  if (trimmed.toLowerCase() === "true") {
    return true;
  }
  if (trimmed.toLowerCase() === "false") {
    return false;
  }
  return trimmed;
}

export async function loadSampleData(rootDir = process.cwd()) {
  const samplesDir = path.join(rootDir, "data", "samples");

  const [
    newsEvents,
    supplierNotices,
    inventory,
    bom,
    orders,
    alternatives,
    supplyRoutes,
  ] = await Promise.all([
    loadJson(path.join(samplesDir, "news_events.json")),
    loadJson(path.join(samplesDir, "supplier_notices.json")),
    loadCsv(path.join(samplesDir, "inventory.csv")),
    loadCsv(path.join(samplesDir, "bom.csv")),
    loadCsv(path.join(samplesDir, "orders.csv")),
    loadCsv(path.join(samplesDir, "alternatives.csv")),
    loadCsv(path.join(samplesDir, "supply_routes.csv")),
  ]);

  return {
    newsEvents,
    supplierNotices,
    inventory,
    bom,
    orders,
    alternatives,
    supplyRoutes,
  };
}
