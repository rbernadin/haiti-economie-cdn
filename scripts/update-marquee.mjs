// scripts/update-marquee.mjs
// Fetches marquee data from your API and writes cdn/daily/marquee.json
// ALSO fetches ref-summary and writes cdn/daily/ref-summary.json
// Includes retry logic to survive Render cold starts.

import fs from "node:fs/promises";

const MARQUEE_API_URL =
  process.env.MARQUEE_API_URL ||
  "https://haiti-economie-api.onrender.com/api/exchange-market-marquee";

const REF_SUMMARY_API_URL =
  process.env.REF_SUMMARY_API_URL ||
  "https://haiti-economie-api.onrender.com/api/ref-summary?chartCount=20&lookback=260";

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

function normalizePct(obj) {
  // IMPORTANT:
  // Your API provides:
  // - percent = percent change
  // - change  = absolute change
  // We want percent for "pct".
  if (obj && isNum(obj.percent)) return Number(obj.percent);
  if (obj && isNum(obj.pct)) return Number(obj.pct);
  return 0;
}

function normalizeValue(obj) {
  if (obj && isNum(obj.value)) return Number(obj.value);
  if (isNum(obj)) return Number(obj);
  return 0;
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchJsonWithRetry(url, tries = 5) {
  let lastErr = null;

  for (let i = 0; i < tries; i++) {
    try {
      const ctrl = new AbortController();
      const timeoutMs = 25000;
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

async function writeMarqueeJson() {
  console.log("Fetching marquee from:", MARQUEE_API_URL);

  const api = await fetchJsonWithRetry(MARQUEE_API_URL, 5);

  // API expected shape:
  // { ref:{value,change,percent}, tma:{...}, euro_achat:{...}, ... }
  const data = {};
  for (const [key, obj] of Object.entries(api || {})) {
    const value = normalizeValue(obj);
    const pct = normalizePct(obj);

    data[key] = {
      value,
      pct,
      variant: variantFromPct(pct),
    };
  }

  const out = {
    asof: new Date().toISOString().slice(0, 10),
    data,
  };

  await fs.mkdir("cdn/daily", { recursive: true });
  await fs.writeFile("cdn/daily/marquee.json", JSON.stringify(out, null, 2) + "\n", "utf8");

  console.log("✅ Wrote cdn/daily/marquee.json OK");
}

async function writeRefSummaryJson() {
  console.log("Fetching ref-summary from:", REF_SUMMARY_API_URL);

  const payload = await fetchJsonWithRetry(REF_SUMMARY_API_URL, 5);

  // Keep the API shape intact (RefSummary component expects `latest`, `chart`, etc.)
  const asof =
    payload?.asof ||
    payload?.date ||
    payload?.latest?.date ||
    new Date().toISOString().slice(0, 10);

  const out = {
    asof,
    data: payload,
  };

  await fs.mkdir("cdn/daily", { recursive: true });
  await fs.writeFile("cdn/daily/ref-summary.json", JSON.stringify(out, null, 2) + "\n", "utf8");

  console.log("✅ Wrote cdn/daily/ref-summary.json OK");
}

async function main() {
  await writeMarqueeJson();
  await writeRefSummaryJson();
}

main().catch((err) => {
  console.error("FAILED:", err?.stack || err);
  process.exit(1);
});

