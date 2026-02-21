// scripts/generate-fx-bundles.mjs
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const API_BASE = process.env.API_BASE || "https://haiti-economie-api.onrender.com";
const ENDPOINT = `${API_BASE}/api/fx-history-standardized`;
const OUT_DIR = path.resolve(__dirname, "..", "cdn", "daily");

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

function pctChange(curr, prev) {
  const c = n(curr);
  const p = n(prev);
  if (c == null || p == null || p === 0) return null;
  return ((c - p) / p) * 100;
}

function pickRow(row, keys) {
  const out = { date: row?.date ?? null };
  for (const k of keys) out[k] = row?.[k] ?? null;
  return out;
}

async function fetchJSON(url) {
  const r = await fetch(url, { headers: { Accept: "application/json" } });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`Fetch failed ${r.status} ${r.statusText}: ${url}\n${text}`);
  }
  return r.json();
}

async function writeJSON(filename, data) {
  const fullPath = path.join(OUT_DIR, filename);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, JSON.stringify(data, null, 2), "utf8");
  console.log("✅ wrote", path.relative(path.resolve(__dirname, ".."), fullPath));
}

function buildBundlePayload(apiData, keys, meta = {}) {
  const historyIn = Array.isArray(apiData?.history) ? apiData.history : [];
  const history = historyIn.map((row) => pickRow(row, keys));
  const latest = history.length ? history[history.length - 1] : null;

  return {
    generatedAt: new Date().toISOString(),
    asof: latest?.date ?? null,
    latest,
    history,
    ...meta,
  };
}

function bestBank(latest, mode /* "buy" | "sell" */) {
  // buy = customer sells USD to bank -> want highest *_achat
  // sell = customer buys USD from bank -> want lowest *_vente
  const banks = [
    { key: "unibank", label: "Unibank" },
    { key: "sogebank", label: "Sogebank" },
    { key: "buh", label: "BUH" },
    { key: "sogebel", label: "Sogebel" },
    { key: "capital", label: "Capital Bank" },
    { key: "bnc", label: "BNC" },
  ];

  let best = null;

  for (const b of banks) {
    const field = `${b.key}_${mode === "buy" ? "achat" : "vente"}`;
    const value = n(latest?.[field]);
    if (value == null) continue;

    if (!best) best = { bank: b.label, field, value };
    else if (mode === "buy" && value > best.value) best = { bank: b.label, field, value };
    else if (mode === "sell" && value < best.value) best = { bank: b.label, field, value };
  }

  return best; // { bank, field, value } | null
}

function sumNums(...vals) {
  let s = 0;
  let any = false;
  for (const v of vals) {
    const x = n(v);
    if (x == null) continue;
    s += x;
    any = true;
  }
  return any ? s : null;
}

async function main() {
  console.log("API_BASE:", API_BASE);
  await fs.mkdir(OUT_DIR, { recursive: true });

  const bundles = [
    {
      file: "fx-core-730.json",
      count: 730,
      keys: [
        "taux_ref",
        "taux_tma",
        "informel_achat",
        "informel_vente",
        "marche_banc_achat",
        "marche_banc_vente",

        // banks
        "unibank_achat", "unibank_vente",
        "sogebank_achat", "sogebank_vente",
        "buh_achat", "buh_vente",
        "sogebel_achat", "sogebel_vente",
        "capital_achat", "capital_vente",
        "bnc_achat", "bnc_vente",
      ],
    },
    {
      file: "fx-transactions-interventions-365.json",
      count: 365,
      keys: [
        "volume_achat",
        "volume_vente",
        "intervention_us_achat",
        "intervention_us_vente",
        "intervention_euro_achat",
        "intervention_euro_vente",
      ],
    },
    {
      file: "fx-others-365.json",
      count: 365,
      keys: [
        "euro_achat", "euro_vente",
        "peso_dom_achat", "peso_dom_vente",
        "dol_can_achat", "dol_can_vente",
      ],
    },
    {
      file: "refsummary-260.json",
      count: 260,
      keys: ["taux_ref", "volume_achat", "volume_vente"],
    },
  ];

  // ---- Generate bundles ----
  for (const b of bundles) {
    const url = `${ENDPOINT}?count=${b.count}`;
    console.log("\n→ fetching", url);
    const apiData = await fetchJSON(url);

    const payload = buildBundlePayload(apiData, b.keys, {
      source: "fx-history-standardized",
      count: b.count,
    });

    await writeJSON(b.file, payload);
  }

  // ---- Generate tiny QuickLinks snapshot ----
  // Use last 2 rows to compute pct changes
  console.log("\n→ fetching for quicklinks", `${ENDPOINT}?count=2`);
  const two = await fetchJSON(`${ENDPOINT}?count=2`);
  const h2 = Array.isArray(two?.history) ? two.history : [];
  const prev = h2.length >= 2 ? h2[h2.length - 2] : null;
  const latest = h2.length ? h2[h2.length - 1] : null;

  const snap = {
    generatedAt: new Date().toISOString(),
    asof: latest?.date ?? null,

    // 1) Transactions bancaires (example: show achats + pct; also include ventes)
    transactions: {
      volume_achat: n(latest?.volume_achat),
      volume_vente: n(latest?.volume_vente),
      pct_volume_achat: pctChange(latest?.volume_achat, prev?.volume_achat),
      pct_volume_vente: pctChange(latest?.volume_vente, prev?.volume_vente),
    },

    // 2) Marché bancaire (include both achat/vente + pct)
    marche_bancaire: {
      achat: n(latest?.marche_banc_achat),
      vente: n(latest?.marche_banc_vente),
      pct_achat: pctChange(latest?.marche_banc_achat, prev?.marche_banc_achat),
      pct_vente: pctChange(latest?.marche_banc_vente, prev?.marche_banc_vente),
    },

    // 3) Interventions (daily totals; labeled "USD + EUR" if you want)
    interventions: {
      intervention_us_achat: n(latest?.intervention_us_achat),
      intervention_us_vente: n(latest?.intervention_us_vente),
      intervention_euro_achat: n(latest?.intervention_euro_achat),
      intervention_euro_vente: n(latest?.intervention_euro_vente),

      // daily totals (simple sum; you can display as "USD + EUR")
      total_usd: sumNums(latest?.intervention_us_achat, latest?.intervention_us_vente),
      total_eur: sumNums(latest?.intervention_euro_achat, latest?.intervention_euro_vente),
      total_usd_plus_eur: sumNums(
        latest?.intervention_us_achat,
        latest?.intervention_us_vente,
        latest?.intervention_euro_achat,
        latest?.intervention_euro_vente
      ),

      pct_total_usd_plus_eur: pctChange(
        sumNums(
          latest?.intervention_us_achat,
          latest?.intervention_us_vente,
          latest?.intervention_euro_achat,
          latest?.intervention_euro_vente
        ),
        sumNums(
          prev?.intervention_us_achat,
          prev?.intervention_us_vente,
          prev?.intervention_euro_achat,
          prev?.intervention_euro_vente
        )
      ),
    },

    // 4) Autres devises (example: Euro vente)
    autres_devises: {
      euro_vente: n(latest?.euro_vente),
      pct_euro_vente: pctChange(latest?.euro_vente, prev?.euro_vente),

      // optional extra if you want later
      euro_achat: n(latest?.euro_achat),
      peso_dom_achat: n(latest?.peso_dom_achat),
      peso_dom_vente: n(latest?.peso_dom_vente),
      dol_can_achat: n(latest?.dol_can_achat),
      dol_can_vente: n(latest?.dol_can_vente),
    },

    // 5) Taux affichés par les banques (best deal)
    // buy = user sells USD to bank (highest achat)
    // sell = user buys USD from bank (lowest vente)
    best_bank: {
      best_buy_usd: bestBank(latest, "buy"),
      best_sell_usd: bestBank(latest, "sell"),
    },
  };

  await writeJSON("quicklinks.json", snap);

  console.log("\n🎉 Done.");
}

main().catch((err) => {
  console.error("❌ generate-fx-bundles failed:", err);
  process.exit(1);
});