// scripts/generate-home-cards-snapshot.mjs
import fs from "node:fs";
import path from "node:path";

const API_BASE = process.env.API_BASE || "https://haiti-economie-api.onrender.com";
const OUT_FILE = path.resolve("cdn/daily/home-cards.json");

async function fetchJson(url) {
  const r = await fetch(url, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}`);
  return r.json();
}

function ensureDir(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
}

function inferAsof(payload) {
  return (
    payload?.asof ||
    payload?.updatedAt ||
    payload?.date ||
    payload?.latest?.date ||
    payload?.latest?.day ||
    new Date().toISOString().slice(0, 10)
  );
}

(async () => {
  const url = `${API_BASE.replace(/\/+$/, "")}/api/home-cards-snapshot`;
  console.log("Fetching:", url);

  const payload = await fetchJson(url);

  const out = {
    asof: inferAsof(payload),
    generatedAt: new Date().toISOString(),
    cards: Array.isArray(payload?.cards) ? payload.cards : (payload?.data?.cards || []),
  };

  if (!Array.isArray(out.cards) || out.cards.length === 0) {
    console.error("Invalid payload/cards:", payload);
    process.exit(1);
  }

  ensureDir(OUT_FILE);
  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(`✅ Wrote ${OUT_FILE} (asof=${out.asof}, generatedAt=${out.generatedAt})`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});