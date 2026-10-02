// scripts/update-minimum-wage-haiti.mjs

import fs from "node:fs/promises";
import path from "node:path";

const API_BASE =
  process.env.MINIMUM_WAGE_HAITI_API_URL ||
  "https://haiti-economie-api.onrender.com/api/minimum-wage-haiti";

const CURRENT_API_URL = `${API_BASE}/current`;
const HISTORY_API_URL = `${API_BASE}/history`;

const OUT_DIR = path.join(process.cwd(), "cdn", "daily");
const OUT_FILE = path.join(OUT_DIR, "minimum-wage-haiti.json");

const sleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

async function fetchJsonWithRetry(url, label, retries = 4) {
  let lastError;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(
        `Fetching ${label}. Attempt ${attempt}/${retries}`
      );
      console.log(`Source: ${url}`);

      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(
          `HTTP ${response.status}: ${response.statusText}`
        );
      }

      return await response.json();
    } catch (error) {
      lastError = error;

      console.error(
        `Attempt ${attempt} failed: ${error.message}`
      );

      if (attempt < retries) {
        await sleep(5000);
      }
    }
  }

  throw lastError;
}

async function main() {
  const [current, history] = await Promise.all([
    fetchJsonWithRetry(
      CURRENT_API_URL,
      "current Haiti minimum wage data"
    ),
    fetchJsonWithRetry(
      HISTORY_API_URL,
      "Haiti minimum wage history"
    ),
  ]);

  const payload = {
    generated_at: new Date().toISOString(),

    dataset: "haiti_minimum_wage",

    sources: {
      current: CURRENT_API_URL,
      history: HISTORY_API_URL,
    },

    current,

    history,
  };

  await fs.mkdir(OUT_DIR, {
    recursive: true,
  });

  await fs.writeFile(
    OUT_FILE,
    JSON.stringify(payload, null, 2),
    "utf8"
  );

  console.log(`Saved: ${OUT_FILE}`);
}

main().catch((error) => {
  console.error(
    "Failed to update Haiti minimum wage CDN file."
  );
  console.error(error);
  process.exit(1);
});