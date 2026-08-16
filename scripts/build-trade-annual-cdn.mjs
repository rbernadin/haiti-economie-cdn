// scripts/build-trade-annual-cdn.mjs

import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

const API_URL =
  process.env.TRADE_ANNUAL_API_URL ||
  "https://haiti-economie-api.onrender.com/api/trade-history-standardized?count=all";

const OUT_DIR =
  process.env.TRADE_ANNUAL_OUT_DIR ||
  "cdn/annual/trade-haiti";

const REQUEST_TIMEOUT_MS = 45_000;
const MAX_ATTEMPTS = 4;

/* ---------------------------------------------------------
 * Helpers
 * ------------------------------------------------------ */

const sleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

function prettyJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(value) {
  return createHash("sha256")
    .update(value)
    .digest("hex");
}

function toNumber(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : null;
}

async function readJsonOrNull(filePath) {
  try {
    return JSON.parse(
      await readFile(filePath, "utf8")
    );
  } catch {
    return null;
  }
}

async function writeAtomic(filePath, contents) {
  await mkdir(
    path.dirname(filePath),
    { recursive: true }
  );

  const tempPath = `${filePath}.tmp`;

  await writeFile(
    tempPath,
    contents,
    "utf8"
  );

  await rename(
    tempPath,
    filePath
  );
}

/* ---------------------------------------------------------
 * Fetch
 * ------------------------------------------------------ */

async function fetchJsonWithRetry(url) {
  let lastError = null;

  for (
    let attempt = 1;
    attempt <= MAX_ATTEMPTS;
    attempt += 1
  ) {
    const controller =
      new AbortController();

    const timeout =
      setTimeout(
        () => controller.abort(),
        REQUEST_TIMEOUT_MS
      );

    try {
      console.log(
        `[annual-trade] Fetch attempt ${attempt}/${MAX_ATTEMPTS}`
      );

      const response =
        await fetch(url, {
          signal: controller.signal,

          headers: {
            Accept: "application/json",
            "Cache-Control": "no-cache",
            "User-Agent":
              "haiti-economie-cdn/1.0",
          },
        });

      if (!response.ok) {
        const text =
          await response
            .text()
            .catch(() => "");

        throw new Error(
          `HTTP ${response.status} ${response.statusText}${
            text
              ? ` — ${text.slice(0, 500)}`
              : ""
          }`
        );
      }

      const payload =
        await response.json();

      clearTimeout(timeout);

      return payload;
    } catch (error) {
      clearTimeout(timeout);

      lastError = error;

      console.error(
        `[annual-trade] Attempt ${attempt} failed:`,
        error?.message || error
      );

      if (attempt < MAX_ATTEMPTS) {
        await sleep(
          attempt * 4_000
        );
      }
    }
  }

  throw lastError;
}

/* ---------------------------------------------------------
 * Validation / normalization
 * ------------------------------------------------------ */

function validatePayload(payload) {
  if (
    !payload ||
    typeof payload !== "object"
  ) {
    throw new Error(
      "Trade API response is invalid."
    );
  }

  if (
    !Array.isArray(payload.history) ||
    payload.history.length === 0
  ) {
    throw new Error(
      "Trade API response does not contain history[]."
    );
  }

  return payload;
}

function normalizeHistory(history) {
  return history
    .map((row) => {
      const year =
        Number(row?.year);

      if (!Number.isInteger(year)) {
        return null;
      }

      return {
        year,

        trade_balance:
          toNumber(
            row.trade_balance
          ),

        exports_constant:
          toNumber(
            row.exports_constant
          ),

        imports_constant:
          toNumber(
            row.imports_constant
          ),
      };
    })
    .filter(Boolean)
    .sort(
      (a, b) => a.year - b.year
    );
}

/* ---------------------------------------------------------
 * Change detection
 * ------------------------------------------------------ */

function comparablePayload(payload) {
  if (!payload) {
    return null;
  }

  return {
    schema: payload.schema,
    dataset: payload.dataset,
    frequency: payload.frequency,
    latest: payload.latest,
    latest_breakdown:
      payload.latest_breakdown,
    history: payload.history,
    top_exports: payload.top_exports,
    top_imports: payload.top_imports,
    top_exports_year:
      payload.top_exports_year,
    top_imports_year:
      payload.top_imports_year,
  };
}

function datasetHash(payload) {
  return sha256(
    JSON.stringify(
      comparablePayload(payload)
    )
  );
}

/* ---------------------------------------------------------
 * Main
 * ------------------------------------------------------ */

async function main() {
  console.log(
    "[annual-trade] Building Haiti annual trade CDN..."
  );

  console.log(
    `[annual-trade] Source: ${API_URL}`
  );

  const apiPayload =
    validatePayload(
      await fetchJsonWithRetry(
        API_URL
      )
    );

  const history =
    normalizeHistory(
      apiPayload.history
    );

  if (!history.length) {
    throw new Error(
      "No valid annual trade records found."
    );
  }

  const first =
    history[0];

  const last =
    history.at(-1);

  /*
   * Prefer API latest metadata, but the annual history
   * itself remains the canonical time series.
   */
  const latest = {
    year:
      toNumber(
        apiPayload.latest?.year
      ) ?? last.year,

    trade_balance:
      toNumber(
        apiPayload.latest
          ?.trade_balance
      ) ?? last.trade_balance,

    change:
      toNumber(
        apiPayload.latest?.change
      ),

    percent:
      toNumber(
        apiPayload.latest?.percent
      ),
  };

  const latestBreakdown = {
    exports_constant:
      toNumber(
        apiPayload.latest_breakdown
          ?.exports_constant
      ),

    exports_perc_gdp:
      toNumber(
        apiPayload.latest_breakdown
          ?.exports_perc_gdp
      ),

    imports_constant:
      toNumber(
        apiPayload.latest_breakdown
          ?.imports_constant
      ),

    imports_perc_gdp:
      toNumber(
        apiPayload.latest_breakdown
          ?.imports_perc_gdp
      ),
  };

  const generatedAt =
    new Date().toISOString();

  const payload = {
    schema: 1,

    dataset:
      "haiti_trade_annual",

    title:
      "Commerce extérieur d’Haïti — données annuelles",

    frequency:
      "annual",

    country: {
      name: "Haiti",
      iso2: "HT",
      iso3: "HTI",
    },

    generated_at:
      generatedAt,

    source: {
      api: API_URL,
    },

    latest,

    latest_breakdown:
      latestBreakdown,

    stats: {
      observations:
        history.length,

      first_year:
        first.year,

      last_year:
        last.year,
    },

    history,

    /*
     * Preserve these exactly as supplied by the API.
     * They may use different source units, so the CDN
     * should not silently rescale them.
     */
    top_exports:
      Array.isArray(
        apiPayload.top_exports
      )
        ? apiPayload.top_exports
        : [],

    top_imports:
      Array.isArray(
        apiPayload.top_imports
      )
        ? apiPayload.top_imports
        : [],

    top_exports_year:
      toNumber(
        apiPayload.top_exports_year
      ),

    top_imports_year:
      toNumber(
        apiPayload.top_imports_year
      ),
  };

  const allFile =
    path.join(
      OUT_DIR,
      "all.json"
    );

  const latestFile =
    path.join(
      OUT_DIR,
      "latest.json"
    );

  const historyFile =
    path.join(
      OUT_DIR,
      "history.json"
    );

  const indexFile =
    path.join(
      OUT_DIR,
      "index.json"
    );

  const existing =
    await readJsonOrNull(
      allFile
    );

  if (
    existing &&
    datasetHash(existing) ===
      datasetHash(payload)
  ) {
    console.log(
      "[annual-trade] No trade data changes detected."
    );

    return;
  }

  /*
   * Full dataset
   */
  await writeAtomic(
    allFile,
    prettyJson(payload)
  );

  /*
   * Time-series-only file for charts.
   */
  await writeAtomic(
    historyFile,
    prettyJson({
      schema: 1,

      dataset:
        "haiti_trade_annual",

      frequency:
        "annual",

      generated_at:
        generatedAt,

      first_year:
        first.year,

      last_year:
        last.year,

      history,
    })
  );

  /*
   * Lightweight latest snapshot for cards/widgets.
   */
  await writeAtomic(
    latestFile,
    prettyJson({
      schema: 1,

      dataset:
        "haiti_trade_annual",

      frequency:
        "annual",

      generated_at:
        generatedAt,

      latest,

      latest_breakdown:
        latestBreakdown,

      top_exports:
        payload.top_exports,

      top_imports:
        payload.top_imports,

      top_exports_year:
        payload.top_exports_year,

      top_imports_year:
        payload.top_imports_year,
    })
  );

  /*
   * One immutable-style endpoint per year.
   * Historical revisions will overwrite the affected
   * year when the source API changes.
   */
  for (const row of history) {
    const archiveFile =
      path.join(
        OUT_DIR,
        "archive",
        `${row.year}.json`
      );

    await writeAtomic(
      archiveFile,
      prettyJson({
        schema: 1,

        dataset:
          "haiti_trade_annual",

        frequency:
          "annual",

        year:
          row.year,

        generated_at:
          generatedAt,

        data:
          row,

        source: {
          api: API_URL,
        },
      })
    );
  }

  /*
   * Discovery manifest
   */
  const index = {
    schema: 1,

    dataset:
      "haiti_trade_annual",

    title:
      "Commerce extérieur d’Haïti — données annuelles",

    frequency:
      "annual",

    generated_at:
      generatedAt,

    first_year:
      first.year,

    last_year:
      last.year,

    observations:
      history.length,

    years:
      history.map(
        (row) => ({
          year:
            row.year,

          trade_balance:
            row.trade_balance,

          exports_constant:
            row.exports_constant,

          imports_constant:
            row.imports_constant,

          file:
            `archive/${row.year}.json`,
        })
      ),

    files: {
      all:
        "all.json",

      latest:
        "latest.json",

      history:
        "history.json",

      archive:
        "archive/{year}.json",
    },
  };

  await writeAtomic(
    indexFile,
    prettyJson(index)
  );

  console.log(
    `[annual-trade] ${history.length} annual records generated.`
  );

  console.log(
    `[annual-trade] Coverage: ${first.year}–${last.year}`
  );

  console.log(
    `[annual-trade] Latest balance: ${latest.trade_balance}`
  );

  console.log(
    `[annual-trade] Output: ${OUT_DIR}`
  );
}

main().catch(
  (error) => {
    console.error(
      "[annual-trade] Build failed:",
      error
    );

    process.exit(1);
  }
);