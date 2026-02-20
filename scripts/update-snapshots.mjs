// scripts/update-snapshots.mjs
import fs from "node:fs/promises";

const OUT_DIR = "cdn/daily";

const SNAPSHOTS = [
  {
    outFile: "marquee.json",
    url: "https://haiti-economie-api.onrender.com/api/exchange-market-marquee",
  },
  {
    outFile: "ref-summary.json",
    url: "https://haiti-economie-api.onrender.com/api/ref-summary-snapshot?chartCount=20",
  },
  {
    outFile: "home-snapshot.json",
    url: "https://haiti-economie-api.onrender.com/api/home-snapshot",
  },
  {
    outFile: "home-cards.json",
    url: "https://haiti-economie-api.onrender.com/api/home-cards-snapshot",
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
      console.log(`[retry] ${i + 1}/${tries} failed for ${url}: ${e?.message || e} (wait ${wait}ms)`);
      await sleep(wait);
    }
  }

  throw lastErr || new Error("Unknown fetch error");
}

function inferAsof(payload) {
  return (
    payload?.asof ||
    payload?.date ||
    payload?.latest?.date ||
    payload?.latest?.day ||
    new Date().toISOString().slice(0, 10)
  );
}

// IMPORTANT: if fetch fails, DO NOT overwrite existing file.
// This prevents 404s and keeps last good snapshot live.
async function writeSnapshot({ outFile, url }) {
  const outPath = `${OUT_DIR}/${outFile}`;

  try {
    console.log(`Fetching: ${url}`);
    const payload = await fetchJsonWithRetry(url, 5);

    const out = {
      asof: inferAsof(payload),
      data: payload,
    };

    await fs.writeFile(outPath, JSON.stringify(out, null, 2) + "\n", "utf8");
    console.log(`✅ Wrote ${outPath}`);
    return true;
  } catch (e) {
    console.log(`⚠️  SKIP (keeping previous): ${outFile}`);
    console.log(`   Reason: ${e?.message || e}`);
    return false;
  }
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });

  let ok = 0;
  let failed = 0;

  for (const s of SNAPSHOTS) {
    const did = await writeSnapshot(s);
    if (did) ok++;
    else failed++;
  }

  console.log(`Done. success=${ok}, skipped=${failed}`);
  // Do NOT fail the job if one endpoint is down.
  process.exit(0);
}

main().catch((err) => {
  console.error("FAILED:", err?.stack || err);
  process.exit(1);
});
