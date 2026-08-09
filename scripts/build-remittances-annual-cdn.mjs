// scripts/build-remittances-annual-cdn.mjs

import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

const API_URL =
  process.env.REMITTANCES_ANNUAL_API_URL ||
  "https://haiti-economie-api.onrender.com/api/remittances-standardized?count=all";

const OUT_DIR =
  process.env.REMITTANCES_ANNUAL_OUT_DIR ||
  "cdn/annual/remittances-haiti";

const REQUEST_TIMEOUT_MS = 45_000;
const MAX_ATTEMPTS = 4;

const COUNTRY_KEYS = [
  "usa",
  "chili",
  "canada",
  "france",
  "bresil",
  "rep_dom",
  "uruguay",
  "bahamas",
  "turks_caicos",
  "martinique",
  "europe_autres",
  "antilles",
  "amerique_sud_autres",
  "amerique_central",
  "saint_martin",
  "afrique",
  "asie",
];

const DEPARTMENT_KEYS = [
  "ouest",
  "artibonite",
  "nord",
  "sud",
  "nord_ouest",
  "centre",
  "sud_est",
  "nippes",
  "nord_est",
  "grand_anse",
];

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

function round(value, digits = 2) {
  if (!Number.isFinite(value)) {
    return null;
  }

  const factor = 10 ** digits;

  return (
    Math.round(
      (value + Number.EPSILON) *
        factor
    ) / factor
  );
}

async function readJsonOrNull(filePath) {
  try {
    return JSON.parse(
      await readFile(filePath, "utf8")
    );
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }

    return null;
  }
}

async function writeAtomic(filePath, contents) {
  await mkdir(
    path.dirname(filePath),
    {
      recursive: true,
    }
  );

  const temporaryPath =
    `${filePath}.tmp`;

  await writeFile(
    temporaryPath,
    contents,
    "utf8"
  );

  await rename(
    temporaryPath,
    filePath
  );
}

/* ---------------------------------------------------------
 * API
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
        `[annual-remittances] Fetch attempt ${attempt}/${MAX_ATTEMPTS}`
      );

      const response =
        await fetch(url, {
          signal:
            controller.signal,

          headers: {
            Accept:
              "application/json",

            "Cache-Control":
              "no-cache",

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
        `[annual-remittances] Attempt ${attempt} failed:`,
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
 * Validation
 * ------------------------------------------------------ */

function validatePayload(payload) {
  if (
    !payload ||
    typeof payload !== "object"
  ) {
    throw new Error(
      "API response is invalid."
    );
  }

  if (
    !Array.isArray(
      payload.history
    )
  ) {
    throw new Error(
      "API response does not contain history[]."
    );
  }

  if (
    payload.history.length === 0
  ) {
    throw new Error(
      "Remittances history is empty."
    );
  }

  return payload.history;
}

/* ---------------------------------------------------------
 * Monthly normalization
 * ------------------------------------------------------ */

function normalizeMonthlyRow(row) {
  if (!row?.date) {
    return null;
  }

  const date =
    String(row.date)
      .slice(0, 10);

  const match =
    date.match(
      /^(\d{4})-(\d{2})-(\d{2})$/
    );

  if (!match) {
    return null;
  }

  return {
    ...row,

    date,

    year:
      Number(match[1]),

    month:
      Number(match[2]),

    total_rec:
      toNumber(
        row.total_rec
      ),

    breakdown_rec:
      row.breakdown_rec &&
      typeof row.breakdown_rec ===
        "object"
        ? row.breakdown_rec
        : {},

    departments_rec_yr:
      row.departments_rec_yr &&
      typeof row.departments_rec_yr ===
        "object"
        ? row.departments_rec_yr
        : {},

    meta:
      row.meta &&
      typeof row.meta === "object"
        ? row.meta
        : {},

    totals_exp:
      row.totals_exp &&
      typeof row.totals_exp ===
        "object"
        ? row.totals_exp
        : {},
  };
}

/* ---------------------------------------------------------
 * Numeric aggregation helpers
 * ------------------------------------------------------ */

function sumValues(rows, getter) {
  let sum = 0;
  let found = false;

  for (const row of rows) {
    const value =
      toNumber(
        getter(row)
      );

    if (value !== null) {
      sum += value;
      found = true;
    }
  }

  return found
    ? sum
    : null;
}

function sumObjectKeys(
  rows,
  objectName,
  keys
) {
  const result = {};

  for (const key of keys) {
    result[key] =
      sumValues(
        rows,
        (row) =>
          row?.[objectName]?.[key]
      );
  }

  return result;
}

/*
 * Department values end in "_yr" in the API.
 *
 * Therefore they are treated as already-annual
 * observations rather than values to be summed
 * month by month.
 *
 * We take the last non-null value available
 * within the year.
 */
function latestObjectValues(
  rows,
  objectName,
  keys
) {
  const result = {};

  for (const key of keys) {
    result[key] = null;

    for (
      let index =
        rows.length - 1;
      index >= 0;
      index -= 1
    ) {
      const value =
        toNumber(
          rows[index]?.[
            objectName
          ]?.[key]
        );

      if (value !== null) {
        result[key] =
          value;

        break;
      }
    }
  }

  return result;
}

/* ---------------------------------------------------------
 * Average transfer calculation
 * ------------------------------------------------------ */

function annualAverageTransfer(rows) {
  /*
   * Prefer a weighted average using monthly
   * transfer counts.
   *
   * This preserves the API's moyenne_rec unit
   * rather than trying to derive it from
   * total_rec, whose scale may differ.
   */

  let weightedSum = 0;
  let weightTotal = 0;

  const simpleValues = [];

  for (const row of rows) {
    const average =
      toNumber(
        row?.meta?.moyenne_rec
      );

    const transfers =
      toNumber(
        row?.meta
          ?.nobre_transferts_rec
      );

    if (average !== null) {
      simpleValues.push(
        average
      );
    }

    if (
      average !== null &&
      transfers !== null &&
      transfers > 0
    ) {
      weightedSum +=
        average * transfers;

      weightTotal +=
        transfers;
    }
  }

  if (weightTotal > 0) {
    return round(
      weightedSum /
        weightTotal,
      2
    );
  }

  if (simpleValues.length) {
    return round(
      simpleValues.reduce(
        (sum, value) =>
          sum + value,
        0
      ) /
        simpleValues.length,
      2
    );
  }

  return null;
}

/* ---------------------------------------------------------
 * Annual aggregation
 * ------------------------------------------------------ */

function buildAnnualRecord(
  year,
  rows
) {
  const sorted =
    [...rows].sort(
      (a, b) =>
        a.date.localeCompare(
          b.date
        )
    );

  const months =
    [
      ...new Set(
        sorted.map(
          (row) => row.month
        )
      ),
    ].sort(
      (a, b) => a - b
    );

  const monthsAvailable =
    months.length;

  const completeYear =
    monthsAvailable === 12 &&
    months.every(
      (month, index) =>
        month === index + 1
    );

  const totalRec =
    sumValues(
      sorted,
      (row) =>
        row.total_rec
    );

  const breakdownRec =
    sumObjectKeys(
      sorted,
      "breakdown_rec",
      COUNTRY_KEYS
    );

  const departmentsRecYr =
    latestObjectValues(
      sorted,
      "departments_rec_yr",
      DEPARTMENT_KEYS
    );

  const transferCount =
    sumValues(
      sorted,
      (row) =>
        row?.meta
          ?.nobre_transferts_rec
    );

  const totalExp =
    sumValues(
      sorted,
      (row) =>
        row?.totals_exp
          ?.total_exp
    );

  return {
    year,

    period: String(year),

    start_date:
      sorted[0]?.date ??
      null,

    end_date:
      sorted.at(-1)?.date ??
      null,

    months_available:
      monthsAvailable,

    months,

    complete_year:
      completeYear,

    status:
      completeYear
        ? "complete"
        : "partial",

    total_rec:
      totalRec,

    breakdown_rec:
      breakdownRec,

    /*
     * These values are not summed.
     * They are already marked yearly
     * in the source API.
     */
    departments_rec_yr:
      departmentsRecYr,

    meta: {
      nobre_transferts_rec:
        transferCount,

      moyenne_rec:
        annualAverageTransfer(
          sorted
        ),
    },

    totals_exp: {
      total_exp:
        totalExp,
    },
  };
}

/* ---------------------------------------------------------
 * YoY
 * ------------------------------------------------------ */

function addYearOverYear(history) {
  return history.map(
    (row, index) => {
      const previous =
        index > 0
          ? history[index - 1]
          : null;

      /*
       * Only compare full calendar years.
       * We don't compare a partial 2026
       * against a complete 2025.
       */
      if (
        !row.complete_year ||
        !previous?.complete_year
      ) {
        return {
          ...row,

          change_yoy: {
            total_rec:
              null,

            total_rec_pct:
              null,
          },
        };
      }

      const current =
        toNumber(
          row.total_rec
        );

      const prior =
        toNumber(
          previous.total_rec
        );

      if (
        current === null ||
        prior === null
      ) {
        return {
          ...row,

          change_yoy: {
            total_rec:
              null,

            total_rec_pct:
              null,
          },
        };
      }

      const change =
        current - prior;

      const pct =
        prior !== 0
          ? (change /
              Math.abs(prior)) *
            100
          : null;

      return {
        ...row,

        change_yoy: {
          total_rec:
            round(
              change,
              2
            ),

          total_rec_pct:
            pct === null
              ? null
              : round(
                  pct,
                  2
                ),
        },
      };
    }
  );
}

/* ---------------------------------------------------------
 * Build full annual dataset
 * ------------------------------------------------------ */

function aggregateAnnual(
  monthlyHistory
) {
  const groups =
    new Map();

  for (
    const rawRow
    of monthlyHistory
  ) {
    const row =
      normalizeMonthlyRow(
        rawRow
      );

    if (!row) {
      continue;
    }

    if (
      !groups.has(
        row.year
      )
    ) {
      groups.set(
        row.year,
        []
      );
    }

    groups
      .get(row.year)
      .push(row);
  }

  const history =
    [...groups.entries()]
      .sort(
        ([yearA], [yearB]) =>
          yearA - yearB
      )
      .map(
        ([year, rows]) =>
          buildAnnualRecord(
            year,
            rows
          )
      );

  return addYearOverYear(
    history
  );
}

/* ---------------------------------------------------------
 * Comparison / change detection
 * ------------------------------------------------------ */

function comparablePayload(
  payload
) {
  if (!payload) {
    return null;
  }

  return {
    schema:
      payload.schema,

    dataset:
      payload.dataset,

    frequency:
      payload.frequency,

    latest:
      payload.latest,

    history:
      payload.history,
  };
}

function datasetHash(payload) {
  return sha256(
    JSON.stringify(
      comparablePayload(
        payload
      )
    )
  );
}

/* ---------------------------------------------------------
 * Main
 * ------------------------------------------------------ */

async function main() {
  console.log(
    "[annual-remittances] Building annual remittances CDN..."
  );

  console.log(
    `[annual-remittances] Source: ${API_URL}`
  );

  const apiPayload =
    await fetchJsonWithRetry(
      API_URL
    );

  const monthlyHistory =
    validatePayload(
      apiPayload
    );

  const annualHistory =
    aggregateAnnual(
      monthlyHistory
    );

  if (!annualHistory.length) {
    throw new Error(
      "No annual records could be generated."
    );
  }

  const latest =
    annualHistory.at(-1);

  const first =
    annualHistory[0];

  const payload = {
    schema: 1,

    dataset:
      "remittances_brh_annual",

    title:
      "Transferts de fonds vers Haïti — données annuelles",

    frequency:
      "annual",

    currency:
      "USD",

    generated_at:
      new Date()
        .toISOString(),

    source: {
      institution:
        "BRH",

      api:
        API_URL,

      source_frequency:
        "monthly",

      aggregation:
        "Calendar-year aggregation of monthly observations",
    },

    methodology: {
      total_rec:
        "Sum of available monthly total_rec observations within each calendar year.",

      breakdown_rec:
        "Sum of available monthly received-remittance values by origin country.",

      departments_rec_yr:
        "Latest non-null yearly departmental value within each calendar year; not summed because the API fields are already identified as yearly (_yr).",

      nobre_transferts_rec:
        "Sum of available monthly transfer counts.",

      moyenne_rec:
        "Weighted annual average of monthly moyenne_rec using nobre_transferts_rec when available.",

      total_exp:
        "Sum of available monthly outgoing remittance totals.",

      partial_year:
        "A year with fewer than all 12 calendar months is marked partial.",
    },

    latest,

    stats: {
      years:
        annualHistory.length,

      first_year:
        first.year,

      last_year:
        latest.year,

      latest_complete_year:
        [...annualHistory]
          .reverse()
          .find(
            (row) =>
              row.complete_year
          )?.year ??
        null,
    },

    history:
      annualHistory,
  };

  const latestFile =
    path.join(
      OUT_DIR,
      "latest.json"
    );

  const indexFile =
    path.join(
      OUT_DIR,
      "index.json"
    );

  const existing =
    await readJsonOrNull(
      latestFile
    );

  if (
    existing &&
    datasetHash(existing) ===
      datasetHash(payload)
  ) {
    console.log(
      "[annual-remittances] No annual data changes detected."
    );

    return;
  }

  await writeAtomic(
    latestFile,
    prettyJson(payload)
  );

  /*
   * Write one standalone file per year.
   *
   * This also means a historical BRH revision
   * automatically updates the affected year.
   */
  for (
    const row
    of annualHistory
  ) {
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
          "remittances_brh_annual",

        frequency:
          "annual",

        currency:
          "USD",

        year:
          row.year,

        data:
          row,

        source: {
          institution:
            "BRH",

          api:
            API_URL,
        },
      })
    );
  }

  const index = {
    schema: 1,

    dataset:
      "remittances_brh_annual",

    title:
      "Transferts de fonds vers Haïti — données annuelles",

    frequency:
      "annual",

    currency:
      "USD",

    generated_at:
      payload.generated_at,

    first_year:
      first.year,

    last_year:
      latest.year,

    years:
      annualHistory.map(
        (row) => ({
          year:
            row.year,

          complete_year:
            row.complete_year,

          months_available:
            row.months_available,

          total_rec:
            row.total_rec,

          file:
            `archive/${row.year}.json`,
        })
      ),

    files: {
      latest:
        "latest.json",

      archive:
        "archive/{year}.json",
    },
  };

  await writeAtomic(
    indexFile,
    prettyJson(index)
  );

  console.log(
    `[annual-remittances] ${annualHistory.length} annual records generated.`
  );

  console.log(
    `[annual-remittances] Latest year: ${latest.year}`
  );

  console.log(
    `[annual-remittances] Months available: ${latest.months_available}`
  );

  console.log(
    `[annual-remittances] Complete year: ${latest.complete_year}`
  );

  console.log(
    `[annual-remittances] Output: ${latestFile}`
  );
}

main().catch(
  (error) => {
    console.error(
      "[annual-remittances] Build failed:",
      error
    );

    process.exit(1);
  }
);