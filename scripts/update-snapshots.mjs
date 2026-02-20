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

async function fileExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function writeSnapshot({ outFile, url }) {
  const outPath = `${OUT_DIR}/${outFile}`;
  const alreadyExists = await fileExists(outPath);

  try {
    console.log(`Fetching: ${url}`);
    const payload = await fetchJsonWithRetry(url, 5);

    const out = {
      asof: inferAsof(payload),
      data: payload,
    };

    await fs.writeFile(outPath, JSON.stringify(out, null, 2) + "\n", "utf8");
    console.log(`✅ Wrote ${outPath}`);
  } catch (e) {
    // If we already have a previous file, keep it.
    // If we DON'T have the file yet, FAIL (otherwise you'll get a 404 on the Pages).
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
