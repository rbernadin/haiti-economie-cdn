// scripts/update-general-budget.mjs

import fs from "node:fs/promises";
import path from "node:path";

const API_URL =
  process.env.GENERAL_BUDGET_API_URL ||
  "https://haiti-economie-api.onrender.com/api/general-budget?count=10";

const OUT_DIR = path.join(process.cwd(), "cdn", "daily");
const OUT_FILE = path.join(OUT_DIR, "general-budget.json");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchJsonWithRetry(url, retries = 4) {
  let lastError;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`Fetching general budget data. Attempt ${attempt}/${retries}`);
      console.log(`Source: ${url}`);

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
  console.error("Failed to update general budget CDN file.");
  console.error(error);
  process.exit(1);
});