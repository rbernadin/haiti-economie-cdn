// scripts/update-marquee.mjs
// Fetches marquee data from your API and writes:
// 1) cdn/daily/marquee.json  (legacy shape: value + pct + variant)
// 2) cdn/daily/exchange-market-marquee.json (new TopNavBar shape: value + change (percent))
// Includes retry logic to survive Render cold starts.

import fs from "node:fs/promises";

const API_URL =
  process.env.MARQUEE_API_URL ||
  "https://haiti-economie-api.onrender.com/api/exchange-market-marquee";

// Keep a stable list (matches what TopNavBar displays)
const FIELDS = [
  "ref",
  "marche_banc_achat",
  "marche_banc_vente",
  "euro_achat",
  "peso_dom_achat",
  "dol_can_achat",
  "tma",
  "euro_vente",
  "peso_dom_vente",
  "dol_can_vente",
];

function isNum(x) {
  const n = Number(x);
  return Number.isFinite(n);
}

// Match your TopNavBar convention:
// up = red, down = green, tiny/unknown = neutral
const FLAT_EPS = 0.005; // 0.005% -> rounds to 0.00%

function variantFromPct(pct) {
  if (!isNum(pct)) return "neutral";
  const n = Number(pct);
  if (Math.abs(n) < FLAT_EPS) return "neutral";
  return n >= 0 ? "red" : "green";
}

function pickValue(entry) {
  // Accept: value | rate | v | bare number
  if (entry && typeof entry === "object") {
    if (isNum(entry.value)) return Number(entry.value);
    if (isNum(entry.rate)) return Number(entry.rate);
    if (isNum(entry.v)) return Number(entry.v);
    return null;
  }
  return isNum(entry) ? Number(entry) : null;
}

function pickPercent(entry) {
  // IMPORTANT: Prefer percent/pct FIRST.
  // Your API returns:
  //   change = absolute change
  //   percent = percent change
  if (entry && typeof entry === "object") {
    if (isNum(entry.percent)) return Number(entry.percent);
    if (isNum(entry.pct)) return Number(entry.pct);
    // last resort fallback if API ever sends pct under "change"
    if (isNum(entry.change)) return Number(entry.change);
  }
  return null;
}

function pickAbsChange(entry) {
  // absolute change (e.g., 0.12 HTG)
  if (entry && typeof entry === "object" && isNum(entry.change)) return Number(entry.change);
  return null;
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchJsonWithRetry(url, tries = 5) {
  let lastErr = null;

  for (let i = 0; i < tries; i++) {
    try {
      const ctrl = new AbortController();
      const timeoutMs = 25000; // allow time for cold start + DB
      const t = setTimeout(() => ctrl.abort(), timeoutMs);

      const res = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: ctrl.signal,
      });

      clearTimeout(t);

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status} ${res.statusText} :: ${text.slice(0, 240)}`);
      }

      return await res.json();
    } catch (e) {
      lastErr = e;
      const wait = 2500 * (i + 1);
      console.log(
        `[retry] attempt ${i + 1}/${tries} failed: ${e?.message || e}. Waiting ${wait}ms...`
      );
      await sleep(wait);
    }
  }

  throw lastErr || new Error("Unknown fetch error");
}

async function main() {
  console.log("Fetching marquee from:", API_URL);

  const src = await fetchJsonWithRetry(API_URL, 5);

  // Support either:
  //  - direct object payload { ref:{...}, tma:{...}, ... }
  //  - wrapped shape { asof, data:{...} }
  const payload =
    src?.data && typeof src.data === "object" ? src.data : (src || {});

  const asof = src?.asof || src?.date || new Date().toISOString().slice(0, 10);

  // 1) legacy file: marquee.json
  const legacyData = {};

  // 2) new file: exchange-market-marquee.json (for new TopNavBar)
  const newData = {};

  for (const key of FIELDS) {
    const entry = payload?.[key];

    const value = pickValue(entry);
    const percent = pickPercent(entry);
    const absChange = pickAbsChange(entry);

    // Legacy output (existing working file)
    legacyData[key] = {
      value: value ?? 0,
      pct: percent ?? 0,
      variant: variantFromPct(percent),
    };

    // New TopNavBar output:
    // TopNavBar prints entry.change as "%", so we store percent there.
    newData[key] = {
      value: value ?? null,
      change: percent ?? null,     // <-- percent change (what TopNavBar expects to print as %)
      absChange: absChange ?? null // <-- optional: absolute change (for future use)
    };
  }

  const outLegacy = { asof, data: legacyData };
  const outNew = { asof, data: newData };

  await fs.mkdir("cdn/daily", { recursive: true });

  await fs.writeFile("cdn/daily/marquee.json", JSON.stringify(outLegacy, null, 2) + "\n", "utf8");
  console.log("Wrote cdn/daily/marquee.json OK");

  await fs.writeFile(
    "cdn/daily/exchange-market-marquee.json",
    JSON.stringify(outNew, null, 2) + "\n",
    "utf8"
  );
  console.log("Wrote cdn/daily/exchange-market-marquee.json OK");
}

main().catch((err) => {
  console.error("FAILED:", err?.stack || err);
  process.exit(1);
});
