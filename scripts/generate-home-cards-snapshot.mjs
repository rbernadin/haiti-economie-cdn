// scripts/generate-home-cards-snapshot.mjs
import fs from "node:fs";
import path from "node:path";

const API_BASE = process.env.API_BASE || "https://haiti-economie-api.onrender.com";

// where you want it inside the CDN repo
const OUT_FILE = path.resolve("cdn/core/home-cards-snapshot.json");

// optional: also inject into core bundle file if you use one
const CORE_BUNDLE_FILE = path.resolve("cdn/core/core-bundle.json");
const UPDATE_CORE_BUNDLE = true;

async function fetchJson(url) {
  const r = await fetch(url, { headers: { "accept": "application/json" } });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}`);
  return r.json();
}

function ensureDir(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
}

function isValid(payload) {
  return payload && Array.isArray(payload.cards) && payload.cards.length > 0;
}

(async () => {
  const url = `${API_BASE.replace(/\/+$/, "")}/api/home-cards-snapshot`;
  console.log("Fetching:", url);

  const payload = await fetchJson(url);
  if (!isValid(payload)) {
    console.error("Invalid payload shape:", payload);
    process.exit(1);
  }

  ensureDir(OUT_FILE);
  fs.writeFileSync(OUT_FILE, JSON.stringify(payload, null, 2), "utf8");
  console.log("Wrote:", OUT_FILE);

  if (UPDATE_CORE_BUNDLE) {
    ensureDir(CORE_BUNDLE_FILE);

    let bundle = {};
    if (fs.existsSync(CORE_BUNDLE_FILE)) {
      try {
        bundle = JSON.parse(fs.readFileSync(CORE_BUNDLE_FILE, "utf8"));
      } catch {
        bundle = {};
      }
    }

    // put it under a stable key in your core bundle
    bundle.homeCardsSnapshot = payload;

    fs.writeFileSync(CORE_BUNDLE_FILE, JSON.stringify(bundle, null, 2), "utf8");
    console.log("Updated core bundle:", CORE_BUNDLE_FILE);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
