// scripts/update-homegrid.mjs
// Generates HomeGrid JSON files for GitHub Pages CDN.
// - cdn/daily/home-snapshot.json  (from /api/home-snapshot)
// - cdn/daily/home-cards.json     (from /api/home-cards-snapshot)
// Includes retry logic for Render cold starts.

import fs from "node:fs/promises";

const HOME_SNAPSHOT_API_URL =
  process.env.HOME_SNAPSHOT_API_URL ||
  "https://haiti-economie-api.onrender.com/api/home-snapshot";

const HOME_CARDS_API_URL =
  process.env.HOME_CARDS_API_URL ||
  "https://haiti-economie-api.onrender.com/api/home-cards-snapshot";

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
      console.log(`[retry] ${url} attempt ${i + 1}/${tries} failed: ${e?.message || e}. Waiting ${wait}ms...`);
      await sleep(wait);
    }
  }

  throw lastErr || new Error("Unknown fetch error");
}

function isValidHomeSnapshot(obj) {
  // Your existing HomeGrid expects: { cards: {...}, ... }
  return !!(obj && typeof obj === "object" && obj.cards && typeof obj.cards === "object");
}

function isValidHomeCards(obj) {
  // Your current /api/home-cards-snapshot returns: { cards: [...] }
  const cards = obj?.cards;
  return Array.isArray(cards);
}

async function main() {
  console.log("Fetching:", HOME_SNAPSHOT_API_URL);
  console.log("Fetching:", HOME_CARDS_API_URL);

  const [homeSnapshot, homeCards] = await Promise.all([
    fetchJsonWithRetry(HOME_SNAPSHOT_API_URL, 5),
    fetchJsonWithRetry(HOME_CARDS_API_URL, 5),
  ]);

  if (!isValidHomeSnapshot(homeSnapshot)) {
    throw new Error("home-snapshot API returned unexpected shape (missing cards object).");
  }

  if (!isValidHomeCards(homeCards)) {
    throw new Error("home-cards API returned unexpected shape (cards must be an array).");
  }

  const asof = new Date().toISOString().slice(0, 10);

  // Wrap in a consistent CDN shape (like marquee):
  // HomeGrid will accept either {data: {...}} or direct object.
  const outHomeSnapshot = { asof, data: homeSnapshot };
  const outHomeCards = { asof, cards: homeCards.cards };

  await fs.mkdir("cdn/daily", { recursive: true });

  await fs.writeFile(
    "cdn/daily/home-snapshot.json",
    JSON.stringify(outHomeSnapshot, null, 2) + "\n",
    "utf8"
  );

  await fs.writeFile(
    "cdn/daily/home-cards.json",
    JSON.stringify(outHomeCards, null, 2) + "\n",
    "utf8"
  );

  console.log("Wrote:");
  console.log("- cdn/daily/home-snapshot.json");
  console.log("- cdn/daily/home-cards.json");
}

main().catch((err) => {
  console.error("FAILED:", err?.stack || err);
  process.exit(1);
});
