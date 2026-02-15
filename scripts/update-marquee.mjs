// scripts/update-marquee.mjs
// Fetches marquee data from your API and writes cdn/daily/marquee.json
// Includes retry logic to survive Render cold starts.

import fs from "node:fs/promises";

const API_URL =
  process.env.MARQUEE_API_URL ||
  "https://haiti-economie-api.onrender.com/api/exchange-market-marquee"; // <-- adjust if needed

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
  // Your API uses "percent"; TopNavBar supports "pct" or "percent"
  if (obj && isNum(obj.pct)) return Number(obj.pct);
  if (obj && isNum(obj.percent)) return Number(obj.percent);
  return 0;
}

function normalizeValue(obj) {
  if (obj && isNum(obj.value)) return Number(obj.value);
  // If API ever returns a bare number
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

      // Backoff: 2.5s, 5s, 7.5s, 10s, 12.5s
      const wait = 2500 * (i + 1);
      console.log(`[retry] attempt ${i + 1}/${tries} failed: ${e?.message || e}. Waiting ${wait}ms...`);
      await sleep(wait);
    }
  }

  throw lastErr || new Error("Unknown fetch error");
}

async function main() {
  console.log("Fetching marquee from:", API_URL);

  const api = await fetchJsonWithRetry(API_URL, 5);

  // API expected shape:
  // { ref:{value,change,percent}, tma:{...}, euro_achat:{...}, ... }
  // Output CDN shape:
  // { asof:"YYYY-MM-DD", data:{ ref:{value,pct,variant}, ... } }

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

  console.log("Wrote cdn/daily/marquee.json OK");
}

main().catch((err) => {
  console.error("FAILED:", err?.stack || err);
  process.exit(1);
});
