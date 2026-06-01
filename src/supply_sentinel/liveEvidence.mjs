import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  buildSearchError,
  canonicalizeGoogleNewsUrl,
  evidenceToNewsEvent,
  normalizeEvidenceRecord,
  shortHash,
  slug,
  sourceDomain,
} from "./evidenceSchema.mjs";

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_MAX_ITEMS = 3;
const GDELT_DOC_ENDPOINT = "https://api.gdeltproject.org/api/v2/doc/doc";
const GOOGLE_NEWS_RSS_SEARCH = "https://news.google.com/rss/search";

export function liveEvidenceEnabled(options = {}) {
  const value = options.enabled ?? process.env.SUPPLY_SENTINEL_LIVE_EVIDENCE ?? "false";
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

export async function collectLiveEvidence({
  rootDir = process.cwd(),
  fetchImpl = globalThis.fetch,
  now = new Date(),
  enabled,
  provider = "auto",
} = {}) {
  if (!liveEvidenceEnabled({ enabled })) {
    return { enabled: false, fetched_at: now.toISOString(), newsEvents: [], provenance: [], errors: [] };
  }
  if (typeof fetchImpl !== "function") {
    return {
      enabled: true,
      fetched_at: now.toISOString(),
      newsEvents: [],
      provenance: [],
      errors: [{ source: "runtime", message: "fetch is not available" }],
    };
  }

  const fetchedAt = now.toISOString();
  const sources = await loadExternalSources(rootDir);
  const enabledSources = sources.filter((source) => source.enabled !== false && sourceMatchesProvider(source, provider));
  const results = await Promise.all(
    enabledSources.map(async (source) => {
      const started = Date.now();
      try {
        return { ok: true, source, durationMs: Date.now() - started, value: await collectFromSource(source, { fetchImpl, fetchedAt }) };
      } catch (error) {
        return { ok: false, source, durationMs: Date.now() - started, error };
      }
    }),
  );

  const newsEvents = [];
  const provenance = [];
  const errors = [];
  for (const result of results) {
    if (result.ok) {
      newsEvents.push(...result.value.newsEvents);
      provenance.push(...result.value.provenance);
    } else {
      errors.push(normalizeSearchError(result.error, result.source, result.durationMs));
    }
  }

  const dedupedNewsEvents = dedupeByUrl(newsEvents).slice(0, sourceLimit("SUPPLY_SENTINEL_LIVE_EVIDENCE_MAX_ITEMS", 18));
  const dedupedProvenance = dedupeByUrl(provenance).slice(0, sourceLimit("SUPPLY_SENTINEL_LIVE_EVIDENCE_MAX_ITEMS", 18));

  return {
    enabled: true,
    fetched_at: fetchedAt,
    newsEvents: dedupedNewsEvents,
    provenance: dedupedProvenance,
    errors,
    search_health: buildSearchHealth({ provider: provider === "auto" ? "rss_gdelt" : provider, fetchedAt, provenance: dedupedProvenance, newsEvents: dedupedNewsEvents, errors, sources: enabledSources }),
  };
}

// Ad-hoc single-query public-news search (Google News RSS over HTTPS).
//
// This is the search-tool backend the LLM research agent calls: the model picks
// the query, this runs it, and returns the normalized news/provenance items.
// Reused for tool-calling, so it intentionally takes a free-form query instead
// of a configured source entry.
export async function searchNewsQuery(query, {
  fetchImpl = globalThis.fetch,
  maxItems = DEFAULT_MAX_ITEMS,
  fetchedAt = new Date().toISOString(),
  material = "unknown",
  region = null,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  label = "AI調査エージェント検索",
} = {}) {
  const trimmed = String(query || "").trim();
  if (!trimmed) return { query: "", newsEvents: [], provenance: [] };
  if (typeof fetchImpl !== "function") {
    throw new Error("fetch is not available");
  }

  const url = new URL(GOOGLE_NEWS_RSS_SEARCH);
  url.searchParams.set("q", trimmed);
  url.searchParams.set("hl", "en-US");
  url.searchParams.set("gl", "US");
  url.searchParams.set("ceid", "US:en");

  const response = await fetchWithTimeout(fetchImpl, url, Number(timeoutMs) || DEFAULT_TIMEOUT_MS, "text/xml,application/rss+xml");
  if (!response.ok) {
    throw httpError({ source, provider: "google_news", url, response });
  }

  const xml = await response.text();
  const items = parseRssItems(xml).slice(0, Math.min(Number(maxItems) || DEFAULT_MAX_ITEMS, 10));
  const source = {
    id: `agent-search-${slug(trimmed)}`,
    label,
    provider: "google_news",
    material,
    region,
    confidence: "medium",
    severity_hint: "medium",
    query: trimmed,
  };

  const newsEvents = [];
  const provenance = [];
  for (const article of items) {
    const item = normalizeRssArticle(article, source, fetchedAt);
    if (!item) continue;
    newsEvents.push(item.newsEvent);
    provenance.push(item.provenance);
  }
  return { query: trimmed, newsEvents, provenance };
}

async function loadExternalSources(rootDir) {
  const filePath = path.join(rootDir, "data", "external_sources.json");
  try {
    const text = await readFile(filePath, "utf8");
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error && error.code === "ENOENT") return [];
    throw error;
  }
}

async function collectFromSource(source, { fetchImpl, fetchedAt }) {
  if (source.type === "rss") {
    return collectFromRss(source, { fetchImpl, fetchedAt });
  }
  if (source.type !== "gdelt_doc") {
    return { newsEvents: [], provenance: [] };
  }

  const maxItems = Math.min(Number(source.max_items) || DEFAULT_MAX_ITEMS, 10);
  const url = new URL(GDELT_DOC_ENDPOINT);
  url.searchParams.set("query", source.query || "");
  url.searchParams.set("mode", "ArtList");
  url.searchParams.set("format", "json");
  url.searchParams.set("maxrecords", String(maxItems));
  url.searchParams.set("sort", "DateDesc");

  const response = await fetchWithTimeout(fetchImpl, url, Number(source.timeout_ms) || DEFAULT_TIMEOUT_MS);
  if (!response.ok) {
    throw httpError({ source, provider: "gdelt", url, response });
  }

  const payload = await response.json();
  const articles = Array.isArray(payload.articles) ? payload.articles : [];
  const newsEvents = [];
  const provenance = [];

  for (const article of articles.slice(0, maxItems)) {
    const item = normalizeGdeltArticle(article, source, fetchedAt);
    if (!item) continue;
    newsEvents.push(item.newsEvent);
    provenance.push(item.provenance);
  }

  return { newsEvents, provenance };
}

async function collectFromRss(source, { fetchImpl, fetchedAt }) {
  const url = new URL(source.url);
  if (!["https:"].includes(url.protocol)) {
    throw new Error(`${source.id || source.label || "rss"} must use HTTPS`);
  }

  const response = await fetchWithTimeout(fetchImpl, url, Number(source.timeout_ms) || DEFAULT_TIMEOUT_MS, "text/xml,application/rss+xml");
  if (!response.ok) {
    throw httpError({ source, provider: "google_news", url, response });
  }

  const xml = await response.text();
  const items = parseRssItems(xml).slice(0, Math.min(Number(source.max_items) || DEFAULT_MAX_ITEMS, 10));
  const newsEvents = [];
  const provenance = [];
  for (const article of items) {
    const item = normalizeRssArticle(article, source, fetchedAt);
    if (!item) continue;
    newsEvents.push(item.newsEvent);
    provenance.push(item.provenance);
  }
  return { newsEvents, provenance };
}

async function fetchWithTimeout(fetchImpl, url, timeoutMs, accept = "application/json") {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, {
      headers: { accept },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

function normalizeGdeltArticle(article, source, fetchedAt) {
  const url = stringOr(article.url, "");
  const title = stringOr(article.title, "");
  if (!url || !title) return null;

  const domain = stringOr(article.domain, "") || safeHostname(url);
  const sourceName = stringOr(article.sourceCommonName, "") || domain || source.label || "GDELT";
  const publishedAt = parseGdeltDate(article.seendate) || fetchedAt;
  const id = `live-${slug(source.id || source.label || "gdelt")}-${shortHash(url)}`;
  const summary = [
    title,
    domain ? `配信元: ${domain}` : "",
    source.query ? `検索条件: ${source.query}` : "",
  ].filter(Boolean).join(" / ");
  const evidence = normalizeEvidenceRecord({
    id,
    provider: "gdelt",
    sourceId: source.id || null,
    label: source.label || "GDELT公開ニュース検索",
    source: sourceName,
    title,
    snippet: summary,
    url,
    canonicalUrl: url,
    publishedAt,
    fetchedAt,
    material: source.material || "unknown",
    region: source.region || null,
    query: source.query || null,
    confidence: source.confidence || "medium",
    raw: article,
  });

  return {
    newsEvent: evidenceToNewsEvent(evidence, source.severity_hint || "medium"),
    provenance: evidence,
  };
}

function normalizeRssArticle(article, source, fetchedAt) {
  const links = canonicalizeGoogleNewsUrl(article.link);
  const url = links.url;
  const title = stringOr(article.title, "");
  if (!url || !title) return null;

  const sourceName = extractSourceFromTitle(title) || safeHostname(url) || source.label || "RSS";
  const publishedAt = parseRssDate(article.pubDate) || fetchedAt;
  const id = `live-${slug(source.id || source.label || "rss")}-${shortHash(links.canonical_url || url)}`;
  const summary = stripHtml(stringOr(article.description, title));
  const evidence = normalizeEvidenceRecord({
    id,
    provider: "google_news",
    sourceId: source.id || null,
    label: source.label || "Google News RSS検索",
    source: sourceName,
    title,
    snippet: summary,
    url,
    canonicalUrl: links.canonical_url,
    feedUrl: links.feed_url,
    publishedAt,
    fetchedAt,
    material: source.material || "unknown",
    region: source.region || null,
    query: source.query || null,
    confidence: source.confidence || "medium",
    raw: article,
  });

  return {
    newsEvent: evidenceToNewsEvent(evidence, source.severity_hint || "medium"),
    provenance: evidence,
  };
}

function parseRssItems(xml) {
  const items = [];
  const itemPattern = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let match;
  while ((match = itemPattern.exec(String(xml || "")))) {
    const body = match[1];
    items.push({
      title: xmlText(body, "title"),
      link: xmlText(body, "link"),
      pubDate: xmlText(body, "pubDate"),
      description: xmlText(body, "description"),
    });
  }
  return items;
}

function xmlText(body, tagName) {
  const pattern = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i");
  const match = String(body || "").match(pattern);
  return match ? decodeXml(match[1].replace(/^<!\[CDATA\[|\]\]>$/g, "")) : "";
}

function decodeXml(value) {
  return String(value || "")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&apos;", "'");
}

function stripHtml(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseRssDate(value) {
  const time = Date.parse(String(value || ""));
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function extractSourceFromTitle(title) {
  const parts = String(title || "").split(" - ");
  return parts.length > 1 ? parts[parts.length - 1].trim() : "";
}

function parseGdeltDate(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{4})(\d{2})(\d{2})T?(\d{2})(\d{2})(\d{2})Z?$/);
  if (!match) return null;
  const [, y, m, d, hh, mm, ss] = match;
  return `${y}-${m}-${d}T${hh}:${mm}:${ss}Z`;
}

function dedupeByUrl(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = item.url || item.id;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function sourceLimit(envName, fallback) {
  const value = Number(process.env[envName]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function httpError({ source, provider, url, response }) {
  const error = new Error(`${source.id || source.label || provider || "search"} HTTP ${response.status}`);
  error.sourceId = source.id || null;
  error.provider = provider || source.provider || null;
  error.status = response.status;
  error.url = String(url);
  error.retryAfter = response.headers?.get?.("retry-after") || null;
  return error;
}

function normalizeSearchError(error, source, durationMs) {
  return buildSearchError({
    source: source?.label || source?.id || error?.source,
    sourceId: error?.sourceId || source?.id || null,
    provider: error?.provider || source?.provider || source?.type || null,
    status: error?.status || null,
    url: error?.url || source?.url || null,
    retryAfter: error?.retryAfter || null,
    durationMs,
    message: error?.message || String(error),
  });
}

function sourceMatchesProvider(source, provider) {
  if (!provider || provider === "auto") return true;
  if (provider === "google_news") return source.type === "rss";
  if (provider === "gdelt") return source.type === "gdelt_doc";
  return true;
}

function buildSearchHealth({ provider, fetchedAt, provenance, newsEvents, errors, sources }) {
  const accepted = provenance.filter((item) => item.status !== "rejected").length;
  const rejected = provenance.filter((item) => item.status === "rejected").length;
  return {
    provider,
    retrieved_count: newsEvents.length,
    accepted_count: accepted,
    rejected_count: rejected,
    error_count: errors.length,
    errors,
    last_success_at: accepted > 0 ? fetchedAt : null,
    source_count: sources.length,
  };
}

function safeHostname(value) {
  return sourceDomain(value);
}

function stringOr(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}
