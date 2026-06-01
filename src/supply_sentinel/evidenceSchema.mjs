const PROMPT_INJECTION_PATTERNS = [
  /ignore (all )?(previous|prior) instructions/i,
  /system prompt/i,
  /developer message/i,
  /reveal.*(secret|key|token|credential)/i,
  /curl\s+https?:\/\//i,
  /powershell|cmd\.exe|bash\s+-c/i,
  /プロンプト|指示を無視|秘密|認証情報/,
];

export function normalizeEvidenceRecord({
  id,
  provider,
  sourceId = null,
  kind = "news",
  label = "公開Web記事",
  source = null,
  title = "",
  snippet = "",
  url = "",
  canonicalUrl = "",
  feedUrl = "",
  publishedAt = null,
  fetchedAt = new Date().toISOString(),
  material = "unknown",
  region = null,
  query = null,
  confidence = "medium",
  relevanceScore = null,
  status = "accepted",
  raw = null,
} = {}) {
  const canonical = canonicalUrl || url;
  const safeUrl = canonical || feedUrl || url;
  const domain = sourceDomain(canonical || url || feedUrl);
  const content = [title, snippet].filter(Boolean).join("\n");
  const rejectedReason = rejectionReason({ url: safeUrl, content, status });
  const finalStatus = rejectedReason ? "rejected" : status;
  const finalConfidence = confidenceWithFreshness({
    confidence,
    publishedAt,
    fetchedAt,
    domain,
    snippet,
    status: finalStatus,
  });
  const finalId = id || `ev-${slug(provider || "web")}-${shortHash(`${safeUrl}|${title}`)}`;

  return {
    id: finalId,
    kind,
    label,
    source: source || domain || provider || "公開Web",
    claim: title || snippet || "公開Webシグナル",
    raw_excerpt: snippet || title || "",
    confidence: finalConfidence,
    url: safeUrl,
    canonical_url: canonical || safeUrl,
    feed_url: feedUrl || null,
    title: title || snippet || "",
    snippet: snippet || title || "",
    source_domain: domain,
    provider: provider || "unknown",
    query,
    published_at: publishedAt || null,
    fetched_at: fetchedAt,
    material,
    region,
    relevance_score: relevanceScore,
    content_hash: shortHash(content || safeUrl),
    status: finalStatus,
    rejected_reason: rejectedReason,
    source_id: sourceId,
    origin: "live_web",
    raw,
  };
}

export function evidenceToNewsEvent(evidence, severityHint = "medium") {
  return {
    id: evidence.id,
    source: evidence.source,
    published_at: evidence.published_at || evidence.fetched_at,
    material: evidence.material || "unknown",
    region: evidence.region || null,
    event_type: "live_web_signal",
    severity_hint: severityHint,
    headline: evidence.title || evidence.claim,
    summary: evidence.snippet || evidence.raw_excerpt || evidence.claim,
    url: evidence.url,
    canonical_url: evidence.canonical_url,
    source_domain: evidence.source_domain,
    provider: evidence.provider,
    query: evidence.query,
    confidence: evidence.confidence,
    relevance_score: evidence.relevance_score,
    content_hash: evidence.content_hash,
    status: evidence.status,
    live: true,
    fetched_at: evidence.fetched_at,
    evidence_id: evidence.id,
  };
}

export function canonicalizeGoogleNewsUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return { url: "", canonical_url: "", feed_url: "" };
  try {
    const parsed = new URL(raw);
    if (!/(\.|^)news\.google\.com$/i.test(parsed.hostname)) {
      return { url: raw, canonical_url: raw, feed_url: null };
    }
    const embedded = parsed.searchParams.get("url") || parsed.searchParams.get("u");
    if (embedded && /^https?:\/\//i.test(embedded)) {
      return { url: embedded, canonical_url: embedded, feed_url: raw };
    }
    return { url: raw, canonical_url: raw, feed_url: raw };
  } catch {
    return { url: raw, canonical_url: raw, feed_url: null };
  }
}

export function buildSearchError({
  source,
  sourceId = null,
  provider = null,
  status = null,
  url = null,
  retryAfter = null,
  durationMs = null,
  message = "",
} = {}) {
  return {
    source: source || sourceId || provider || "unknown",
    source_id: sourceId,
    provider,
    status,
    url: url ? String(url) : null,
    retry_after: retryAfter,
    duration_ms: durationMs,
    message: message || (status ? `HTTP ${status}` : "search failed"),
  };
}

export function sourceDomain(value) {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function containsPromptInjection(value) {
  const text = String(value || "");
  return PROMPT_INJECTION_PATTERNS.some((pattern) => pattern.test(text));
}

export function evidenceAccepted(evidence) {
  return evidence?.status !== "rejected" && /^https?:\/\//i.test(String(evidence?.url || ""));
}

function rejectionReason({ url, content, status }) {
  if (status === "rejected") return "upstream rejected";
  if (!/^https?:\/\//i.test(String(url || ""))) return "missing public URL";
  if (containsPromptInjection(content)) return "prompt injection pattern";
  return null;
}

function confidenceWithFreshness({ confidence, publishedAt, fetchedAt, domain, snippet, status }) {
  if (status === "rejected") return "low";
  let score = { low: 1, medium: 2, high: 3 }[String(confidence || "").toLowerCase()] || 2;
  const published = Date.parse(publishedAt || "");
  const fetched = Date.parse(fetchedAt || "");
  if (Number.isFinite(published) && Number.isFinite(fetched)) {
    const ageDays = (fetched - published) / 86_400_000;
    if (ageDays > 45) score -= 1;
    if (ageDays <= 14) score += 0.25;
  }
  if (/news\.google\.com$/i.test(domain || "")) score -= 0.25;
  if (!String(snippet || "").trim()) score -= 0.25;
  if (score >= 2.75) return "high";
  if (score >= 1.75) return "medium";
  return "low";
}

export function slug(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "source";
}

export function shortHash(value) {
  let hash = 0;
  const text = String(value);
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}
