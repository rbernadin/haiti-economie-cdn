// scripts/update-marquee.mjs
// Writes:
// - cdn/daily/marquee.json (legacy: value + pct + variant)
// - cdn/daily/exchange-market-marquee.json (new: value + change (PERCENT) + absChange)
// Retry-safe for Render cold starts.

import fs from "node:fs/promises";

const API_URL =
  process.env.MARQUEE_API_URL ||
  "https://haiti-economie-api.onrender.com/api/exchange-market-marquee";

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

const FLAT_EPS = 0.005;

function variantFromPct(pct) {
  if (!isNum(pct)) return "neutral";
  const n = Number(pct);
  if (Math.abs(n) < FLAT_EPS) return "neutral";
  return n >= 0 ? "red" : "green";
}

function pickValue(entry) {
  if (entry && typeof entry === "object") {
    if (isNum(entry.value)) return Number(entry.value);
    if (isNum(entry.rate)) return Number(entry.rate);
    if (isNum(entry.v)) return Number(entry.v);
    return null;
  }
  return isNum(entry) ? Number(entry) : null;
}

function pickPercent(entry) {
  // IMPORTANT:
  // API has BOTH:
  // - change   = absolute delta
  // - percent  = percent delta
  // New TopNavBar prints as "%", so we must use percent.
  if (entry && typeof entry === "object") {
    if (isNum(entry.percent)) return Number(entry.percent);
    if (isNum(entry.pct)) return Number(entry.pct);
    return null;
  }
  return null;
}

function pickAbsChange(entry) {
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

async function main() {
  console.log("Fetching marquee from:", API_URL);

  const src = await fetchJsonWithRetry(API_URL, 5);

  const payload =
    src?.data && typeof src.data === "object" ? src.data : (src || {});

  const asof = src?.asof || src?.date || new Date().toISOString().slice(0, 10);

  const legacyData = {};
  const newData = {};

  for (const key of FIELDS) {
    const entry = payload?.[key];

    const value = pickValue(entry);
    const pct = pickPercent(entry);      // percent delta
    const absChange = pickAbsChange(entry); // absolute delta

    // Existing working file
    legacyData[key] = {
      value: value ?? 0,
      pct: pct ?? 0,
      variant: variantFromPct(pct),
    };

    // New TopNavBar file:
    // store percent delta inside "change" because TopNavBar prints it as "%".
    newData[key] = {
      value: value ?? null,
      change: pct ?? null,
      absChange: absChange ?? null,
    };
  }

  await fs.mkdir("cdn/daily", { recursive: true });

  await fs.writeFile(
    "cdn/daily/marquee.json",
    JSON.stringify({ asof, data: legacyData }, null, 2) + "\n",
    "utf8"
  );

  await fs.writeFile(
    "cdn/daily/exchange-market-marquee.json",
    JSON.stringify({ asof, data: newData }, null, 2) + "\n",
    "utf8"
  );

  console.log("✅ Wrote:");
  console.log("- cdn/daily/marquee.json");
  console.log("- cdn/daily/exchange-market-marquee.json");
}

main().catch((err) => {
  console.error("FAILED:", err?.stack || err);
  process.exit(1);
});
