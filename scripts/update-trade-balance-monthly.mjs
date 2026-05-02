// scripts/update-trade-balance-monthly.mjs
import fs from "node:fs/promises";
import path from "node:path";

const API_URL =
  process.env.TRADE_BALANCE_MONTHLY_API_URL ||
  "https://haiti-economie-api.onrender.com/api/trade-balance-monthly?count=36";

const OUT_DIR = path.join(process.cwd(), "cdn", "daily");
const OUT_FILE = path.join(OUT_DIR, "trade-balance-monthly.json");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchJsonWithRetry(url, retries = 4) {
  let lastError;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`Fetching data. Attempt ${attempt}/${retries}`);

      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      lastError = error;
      console.error(`Attempt ${attempt} failed: ${error.message}`);

      if (attempt < retries) {
        await sleep(5000);
      }
    }
  }

  throw lastError;
}

async function main() {
  console.log("Updating trade balance monthly CDN file...");
  console.log(`Source: ${API_URL}`);

  const data = await fetchJsonWithRetry(API_URL);

  const payload = {
    generated_at: new Date().toISOString(),
    source: API_URL,
    ...data,
  };

  await fs.mkdir(OUT_DIR, { recursive: true });

  await fs.writeFile(
    OUT_FILE,
    JSON.stringify(payload, null, 2),
    "utf8"
  );

  console.log(`Saved: ${OUT_FILE}`);
}

main().catch((error) => {
  console.error("Failed to update trade balance monthly CDN file.");
  console.error(error);
  process.exit(1);
});