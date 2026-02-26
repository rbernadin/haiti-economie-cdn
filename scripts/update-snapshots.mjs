// scripts/update-snapshots.mjs
import fs from "node:fs/promises";

const OUT_DIR = "cdn/daily";
const API_BASE = process.env.API_BASE || "https://haiti-economie-api.onrender.com";

const SNAPSHOTS = [
  {
    outFile: "marquee.json",
    url: `${API_BASE.replace(/\/+$/, "")}/api/exchange-market-marquee`,
    mode: "wrap",
  },
  {
    outFile: "ref-summary.json",
    url: `${API_BASE.replace(/\/+$/, "")}/api/ref-summary-snapshot?chartCount=20`,
    mode: "wrap",
  },
  {
    outFile: "home-snapshot.json",
    url: `${API_BASE.replace(/\/+$/, "")}/api/home-snapshot`,
    mode: "wrap",
  },

  // ✅ IMPORTANT: HomeGrid expects TOP-LEVEL "cards"
  {
    outFile: "home-cards.json",
    url: `${API_BASE.replace(/\/+$/, "")}/api/home-cards-snapshot`,
    mode: "homeCards",
  },
];

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
        `[retry] ${i + 1}/${tries} failed for ${url}: ${e?.message || e} (wait ${wait}ms)`
      );
      await sleep(wait);
    }
  }

  throw lastErr || new Error("Unknown fetch error");
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

async function fileExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function buildOutput(payload, mode) {
  const generatedAt = new Date().toISOString();

  // Default wrapper format (safe for routes that vary)
  if (mode === "wrap") {
    return {
      asof: inferAsof(payload),
      generatedAt,
      data: payload,
    };
  }

  // HomeGrid wants top-level cards
  if (mode === "homeCards") {
    const cards =
      payload?.cards ||
      payload?.data?.cards || // in case backend changes shape later
      [];

    return {
      asof: inferAsof(payload),
      generatedAt,
      cards,
    };
  }

  // fallback
  return { asof: inferAsof(payload), generatedAt, data: payload };
}

function validateOutput(out, mode) {
  if (mode === "homeCards") {
    return Array.isArray(out?.cards) && out.cards.length > 0;
  }
  // wrap mode doesn't need strict checks (some endpoints may return empty states)
  return true;
}

async function writeSnapshot({ outFile, url, mode }) {
  const outPath = `${OUT_DIR}/${outFile}`;
  const alreadyExists = await fileExists(outPath);

  try {
    console.log(`Fetching: ${url}`);
    const payload = await fetchJsonWithRetry(url, 5);

    const out = buildOutput(payload, mode);

    if (!validateOutput(out, mode)) {
      throw new Error(`Invalid output shape for ${outFile} (mode=${mode})`);
    }

    await fs.writeFile(outPath, JSON.stringify(out, null, 2) + "\n", "utf8");
    console.log(`✅ Wrote ${outPath} (asof=${out.asof}, generatedAt=${out.generatedAt})`);
  } catch (e) {
    if (alreadyExists) {
      console.log(`⚠️  Keeping previous ${outFile} (fetch failed): ${e?.message || e}`);
      return;
    }
    throw new Error(`Failed to create ${outFile} (and no previous file exists): ${e?.message || e}`);
  }
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });

  for (const s of SNAPSHOTS) {
    await writeSnapshot(s);
  }

  console.log("✅ All snapshots generated.");
}

main().catch((err) => {
  console.error("FAILED:", err?.stack || err);
  process.exit(1);
});