// scripts/update-world-bank-haiti.mjs

import fs from "node:fs/promises";
import path from "node:path";
import { POPULAR_WORLD_BANK_HAITI_INDICATORS } from "./world-bank-haiti-indicators.mjs";

const API_BASE = process.env.API_BASE || "https://haiti-economie-api.onrender.com";

const OUT_DIR = path.join(process.cwd(), "cdn", "daily", "world-bank-haiti");
const BY_CODE_DIR = path.join(OUT_DIR, "by-code");
const BY_SLUG_DIR = path.join(OUT_DIR, "by-slug");

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Fetch failed ${response.status}: ${url}`);
  }

  return response.json();
}

async function writeJson(filePath, data) {
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function safeFileName(value) {
  return String(value)
    .trim()
    .replaceAll("/", "_")
    .replaceAll("\\", "_")
    .replaceAll(" ", "_");
}

function getLatestFromHistory(history = []) {
  const valid = history
    .filter((row) => row && row.value !== null && row.value !== undefined && Number.isFinite(Number(row.value)))
    .sort((a, b) => Number(a.year) - Number(b.year));

  const latest = valid.length ? valid[valid.length - 1] : null;
  const previous = valid.length > 1 ? valid[valid.length - 2] : null;

  let change_abs = null;
  let change_pct = null;

  if (latest && previous) {
    change_abs = Number(latest.value) - Number(previous.value);

    if (Number(previous.value) !== 0) {
      change_pct = (change_abs / Number(previous.value)) * 100;
    }
  }

  return latest
    ? {
        ...latest,
        previous_year: previous?.year ?? null,
        previous_value: previous?.value ?? null,
        change_abs,
        change_pct,
      }
    : null;
}

function buildIndicatorPayload({ registryItem, apiPayload }) {
  const history = Array.isArray(apiPayload?.history) ? apiPayload.history : [];
  const latest = apiPayload?.latest || getLatestFromHistory(history);

  return {
    generated_at: new Date().toISOString(),
    cdn_generated_at: new Date().toISOString(),
    available: history.length > 0,
    country_code: "HTI",
    country_name: apiPayload?.history?.[0]?.country_name || "Haiti",
    indicator_code: registryItem.code,
    indicator_name: apiPayload?.indicator_name || registryItem.title,
    title: registryItem.title,
    slug: registryItem.slug,
    unit: registryItem.unit,
    category: registryItem.category,
    evergreen_path: registryItem.evergreenPath || null,
    source: "World Bank, World Development Indicators",
    source_note:
      "Les données peuvent être révisées lorsque la Banque mondiale met à jour les séries de PIB, de population, de prix ou de parité de pouvoir d’achat.",
    latest,
    count: history.length,
    history,
  };
}

async function fetchIndicatorPayload(registryItem) {
  const encodedCode = encodeURIComponent(registryItem.code);
  const url = `${API_BASE}/api/world-bank-haiti-data/indicator/${encodedCode}`;

  try {
    const apiPayload = await fetchJson(url);
    return buildIndicatorPayload({ registryItem, apiPayload });
  } catch (error) {
    console.warn(`Warning: could not fetch ${registryItem.code}. Writing placeholder. ${error.message}`);

    return buildIndicatorPayload({
      registryItem,
      apiPayload: {
        indicator_name: registryItem.title,
        history: [],
        latest: null,
      },
    });
  }
}

async function main() {
  await ensureDir(OUT_DIR);
  await ensureDir(BY_CODE_DIR);
  await ensureDir(BY_SLUG_DIR);

  console.log("Fetching World Bank Haiti indicator list...");

  let indicatorsPayload = {
    generated_at: new Date().toISOString(),
    country_code: "HTI",
    count: 0,
    indicators: [],
  };

  try {
    indicatorsPayload = await fetchJson(`${API_BASE}/api/world-bank-haiti-data/indicators`);
  } catch (error) {
    console.warn(`Warning: could not fetch indicator list. ${error.message}`);
  }

  console.log("Fetching World Bank Haiti latest values...");

  let latestPayload = {
    generated_at: new Date().toISOString(),
    country_code: "HTI",
    count: 0,
    latest: [],
  };

  try {
    latestPayload = await fetchJson(`${API_BASE}/api/world-bank-haiti-data/latest`);
  } catch (error) {
    console.warn(`Warning: could not fetch latest values. ${error.message}`);
  }

  const popularIndex = [];

  for (const item of POPULAR_WORLD_BANK_HAITI_INDICATORS) {
    console.log(`Generating popular indicator snapshot: ${item.code} (${item.slug})`);

    const payload = await fetchIndicatorPayload(item);

    const codeFile = `${safeFileName(item.code)}.json`;
    const slugFile = `${safeFileName(item.slug)}.json`;

    await writeJson(path.join(BY_CODE_DIR, codeFile), payload);
    await writeJson(path.join(BY_SLUG_DIR, slugFile), payload);

    popularIndex.push({
      code: item.code,
      slug: item.slug,
      title: item.title,
      unit: item.unit,
      category: item.category,
      evergreen_path: item.evergreenPath || null,
      available: payload.available,
      latest_year: payload.latest?.year ?? null,
      latest_value: payload.latest?.value ?? null,
      files: {
        by_code: `by-code/${codeFile}`,
        by_slug: `by-slug/${slugFile}`,
      },
    });
  }

  const indexPayload = {
    generated_at: new Date().toISOString(),
    api_base: API_BASE,
    country_code: "HTI",
    source: "World Bank, World Development Indicators",
    files: {
      indicators: "indicators.json",
      latest: "latest.json",
      popular: "popular.json",
    },
    popular_count: popularIndex.length,
    popular_indicators: popularIndex,
  };

  await writeJson(path.join(OUT_DIR, "indicators.json"), indicatorsPayload);
  await writeJson(path.join(OUT_DIR, "latest.json"), latestPayload);
  await writeJson(path.join(OUT_DIR, "popular.json"), {
    generated_at: new Date().toISOString(),
    country_code: "HTI",
    count: popularIndex.length,
    indicators: popularIndex,
  });
  await writeJson(path.join(OUT_DIR, "index.json"), indexPayload);

  console.log(`Done. Files written to ${OUT_DIR}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});