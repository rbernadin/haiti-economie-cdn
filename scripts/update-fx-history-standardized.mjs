import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const API_URL =
  process.env.API_URL ||
  "https://haiti-economie-api.onrender.com/api/fx-history-standardized";

const OUT_DIR = process.env.OUT_DIR || "cdn/daily";
const MAIN_FILE = process.env.MAIN_FILE || "fx-history-standardized.json";

const ALIAS_FILES = (process.env.ALIAS_FILES || "")
  .split(",")
  .map((x) => x.trim())
  .filter(Boolean);

const generatedAt = new Date().toISOString();

function withNoCache(url) {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}_=${Date.now()}`;
}

async function fetchJsonWithRetry(url, attempts = 3) {
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const res = await fetch(withNoCache(url), {
        headers: {
          Accept: "application/json",
          "Cache-Control": "no-cache",
          Pragma: "no-cache",
        },
      });

      const text = await res.text();

      if (!res.ok) {
        throw new Error(
          `HTTP ${res.status} ${res.statusText}: ${text.slice(0, 500)}`
        );
      }

      try {
        return JSON.parse(text);
      } catch {
        throw new Error(`API did not return valid JSON: ${text.slice(0, 500)}`);
      }
    } catch (err) {
      lastError = err;

      if (attempt < attempts) {
        const delayMs = attempt * 3000;
        console.log(
          `Attempt ${attempt} failed. Retrying in ${delayMs / 1000}s...`
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  throw lastError;
}

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function collectArrays(value, output = []) {
  if (Array.isArray(value)) {
    output.push(value);

    for (const item of value.slice(0, 5)) {
      collectArrays(item, output);
    }

    return output;
  }

  if (isObject(value)) {
    for (const child of Object.values(value)) {
      collectArrays(child, output);
    }
  }

  return output;
}

function scoreArray(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return 0;

  const sample = arr.slice(0, 10);
  let score = arr.length;

  for (const item of sample) {
    if (!isObject(item)) continue;

    const keys = Object.keys(item).map((k) => k.toLowerCase());

    if (
      keys.some((k) =>
        [
          "date",
          "day",
          "asof",
          "as_of",
          "date_observation",
          "observation_date",
          "created_at",
          "updated_at",
        ].includes(k)
      )
    ) {
      score += 100;
    }

    if (
      keys.some((k) =>
        [
          "taux_ref",
          "taux_reference",
          "reference_rate",
          "tma",
          "taux_tma",
          "marche_banc_achat",
          "marche_banc_vente",
          "volume_achat",
          "volume_vente",
        ].includes(k)
      )
    ) {
      score += 100;
    }
  }

  return score;
}

function findBestRecordsArray(payload) {
  if (Array.isArray(payload)) return payload;

  const knownKeys = [
    "data",
    "rows",
    "items",
    "records",
    "history",
    "results",
    "fx",
    "rates",
  ];

  if (isObject(payload)) {
    for (const key of knownKeys) {
      if (Array.isArray(payload[key])) return payload[key];
    }
  }

  const arrays = collectArrays(payload);
  arrays.sort((a, b) => scoreArray(b) - scoreArray(a));

  return arrays[0] || [];
}

function getDateValue(record) {
  if (!isObject(record)) return null;

  const possibleKeys = [
    "date",
    "day",
    "asof",
    "as_of",
    "date_observation",
    "observation_date",
    "created_at",
    "updated_at",
  ];

  for (const key of possibleKeys) {
    if (record[key]) {
      const time = Date.parse(record[key]);
      if (!Number.isNaN(time)) return time;
    }
  }

  return null;
}

function pickLatestRecord(records) {
  if (!Array.isArray(records) || records.length === 0) return null;

  let latest = records[0];
  let latestTime = getDateValue(latest);

  for (const record of records) {
    const time = getDateValue(record);

    if (time !== null && (latestTime === null || time > latestTime)) {
      latest = record;
      latestTime = time;
    }
  }

  return latest;
}

async function writeJson(filePath, payload) {
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`Wrote ${filePath}`);
}

const payload = await fetchJsonWithRetry(API_URL);

if (!payload || typeof payload !== "object") {
  throw new Error("API response was empty or not a JSON object/array.");
}

if (isObject(payload) && (payload.ok === false || payload.success === false)) {
  throw new Error(`API returned an error response: ${JSON.stringify(payload)}`);
}

if (isObject(payload) && payload.error) {
  throw new Error(`API returned an error field: ${JSON.stringify(payload.error)}`);
}

const records = findBestRecordsArray(payload);

if (!records.length && process.env.ALLOW_EMPTY !== "true") {
  throw new Error(
    "No usable FX records were found in the API response. Set ALLOW_EMPTY=true only if this is expected."
  );
}

const latest = pickLatestRecord(records);

await mkdir(OUT_DIR, { recursive: true });

const mainPath = path.join(OUT_DIR, MAIN_FILE);
await writeJson(mainPath, payload);

for (const alias of ALIAS_FILES) {
  await writeJson(path.join(OUT_DIR, alias), payload);
}

await writeJson(path.join(OUT_DIR, "fx-history-standardized-meta.json"), {
  generated_at: generatedAt,
  source_url: API_URL,
  main_file: MAIN_FILE,
  alias_files: ALIAS_FILES,
  record_count: records.length,
  latest_record: latest,
});

console.log("FX history CDN update complete.");
console.log(`Records found: ${records.length}`);