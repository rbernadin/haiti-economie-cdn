// scripts/generate-exchange-market-marquee.mjs
import fs from "fs/promises";
import path from "path";

const API_BASE = process.env.API_BASE || "https://haiti-economie-api.onrender.com";
const OUT_DIR = process.env.OUT_DIR || "docs/daily";
const OUT_FILE = path.join(OUT_DIR, "exchange-market-marquee.json");

const FIELDS = [
  "ref",
  "tma",
  "marche_banc_achat",
  "marche_banc_vente",
  "euro_achat",
  "euro_vente",
  "peso_dom_achat",
  "peso_dom_vente",
  "dol_can_achat",
  "dol_can_vente",
];

const isNum = (v) => Number.isFinite(Number(v));
const toNum = (v) => (isNum(v) ? Number(v) : null);

function pickValue(entry) {
  if (entry && typeof entry === "object") {
    return toNum(entry.value) ?? toNum(entry.rate) ?? toNum(entry.v) ?? null;
  }
  return toNum(entry);
}

function pickPct(entry) {
  if (entry && typeof entry === "object") {
    return toNum(entry.change) ?? toNum(entry.percent) ?? toNum(entry.pct) ?? null;
  }
  return null;
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${t.slice(0, 160)}`);
  }
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) {
    const t = await res.text().catch(() => "");
    throw new Error(`Non-JSON response: ${t.slice(0, 160)}`);
  }
  return res.json();
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });

  // Backend route should return values + percent changes
  const src = await fetchJson(`${API_BASE}/api/exchange-market-marquee`);

  // Allow either {data:{...}} or direct root
  const payload = src?.data && typeof src.data === "object" ? src.data : src;

  const out = {
    asof: src?.asof || src?.date || new Date().toISOString().slice(0, 10),
    data: {},
  };

  for (const k of FIELDS) {
    const entry = payload?.[k];
    out.data[k] = {
      value: pickValue(entry),
      change: pickPct(entry), // percent
    };
  }

  await fs.writeFile(OUT_FILE, JSON.stringify(out, null, 2), "utf8");
  console.log(`✅ Wrote ${OUT_FILE}`);
}

main().catch((e) => {
  console.error("❌ generate-exchange-market-marquee failed:", e);
  process.exit(1);
});
