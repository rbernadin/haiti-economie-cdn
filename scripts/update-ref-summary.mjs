// scripts/update-ref-summary.mjs
// Fetches /api/ref-summary and writes cdn/daily/ref-summary.json
// CDN-only frontend reads this file (no API fallback in the app)

import fs from "node:fs/promises";

const API_URL =
  process.env.REF_SUMMARY_API_URL ||
  "https://haiti-economie-api.onrender.com/api/ref-summary?chartCount=20&lookback=260";

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
      console.log(`[retry] attempt ${i + 1}/${tries} failed: ${e?.message || e}. Waiting ${wait}ms...`);
      await sleep(wait);
    }
  }

  throw lastErr || new Error("Unknown fetch error");
}

async function main() {
  console.log("Fetching RefSummary from:", API_URL);

  const payload = await fetchJsonWithRetry(API_URL, 5);

  const asof =
    payload?.asof ||
    payload?.date ||
    payload?.latest?.date ||
    new Date().toISOString().slice(0, 10);

  const out = {
    asof,
    data: payload, // keep API shape intact, wrapped (like your other CDN files)
  };

  await fs.mkdir("cdn/daily", { recursive: true });
  await fs.writeFile("cdn/daily/ref-summary.json", JSON.stringify(out, null, 2) + "\n", "utf8");

  console.log("✅ Wrote cdn/daily/ref-summary.json");
}

main().catch((err) => {
  console.error("FAILED:", err?.stack || err);
  process.exit(1);
});
