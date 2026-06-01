// Helpers for model responses that are *intended* to be JSON.
//
// Reasoning models occasionally return a small amount of surrounding text or a
// truncated-looking fragment when the token budget is tight. The app should not
// treat that as success, but we can safely try to recover a single JSON object
// before falling back to the deterministic path.

export function parseJsonObject(text) {
  const value = String(text ?? "").trim();
  if (!value) {
    throw new Error("Model returned empty JSON content.");
  }

  try {
    return JSON.parse(value);
  } catch (firstError) {
    const extracted = extractFirstJsonObject(value);
    if (!extracted) {
      throw firstError;
    }
    return JSON.parse(extracted);
  }
}

function extractFirstJsonObject(text) {
  const start = text.indexOf("{");
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }

  return null;
}
