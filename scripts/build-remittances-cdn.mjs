// scripts/build-remittances-cdn.mjs

import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

const API_URL =
  process.env.REMITTANCES_API_URL ||
  "https://haiti-economie-api.onrender.com/api/remittances-standardized?count=all";

const OUT_DIR =
  process.env.REMITTANCES_OUT_DIR ||
  "cdn/daily/remittances-haiti";

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

async function readJsonOrNull(filePath) {
  try {
    const text = await readFile(filePath, "utf8");
    return JSON.parse(text);
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
 * Fetch with retries
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
        `[remittances] Fetching API — attempt ${attempt}/${MAX_ATTEMPTS}`
      );

      const response =
        await fetch(url, {
          signal: controller.signal,

          headers: {
            Accept: "application/json",

            "Cache-Control":
              "no-cache",

            "User-Agent":
              "haiti-economie-cdn/1.0",
          },
        });

      if (!response.ok) {
        const body =
          await response
            .text()
            .catch(() => "");

        throw new Error(
          `HTTP ${response.status} ${response.statusText}${
            body
              ? ` — ${body.slice(0, 500)}`
              : ""
          }`
        );
      }

      const json =
        await response.json();

      clearTimeout(timeout);

      return json;
    } catch (error) {
      clearTimeout(timeout);

      lastError = error;

      console.error(
        `[remittances] Attempt ${attempt} failed:`,
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
      "API response is not an object."
    );
  }

  if (
    !Array.isArray(
      payload.history
    )
  ) {
    throw new Error(
      "API response is missing history[]."
    );
  }

  if (
    payload.history.length === 0
  ) {
    throw new Error(
      "API returned an empty remittances history."
    );
  }

  const validRows =
    payload.history.filter(
      (row) =>
        row &&
        typeof row === "object" &&
        row.date
    );

  if (!validRows.length) {
    throw new Error(
      "No valid dated remittance observations were found."
    );
  }

  return validRows;
}

/* ---------------------------------------------------------
 * Normalize
 * ------------------------------------------------------ */

function normalizeHistory(rows) {
  const unique =
    new Map();

  for (const row of rows) {
    if (!row?.date) {
      continue;
    }

    const normalized = {
      ...row,

      date:
        String(row.date)
          .slice(0, 10),

      total_rec:
        row.total_rec == null
          ? null
          : Number(
              row.total_rec
            ),
    };

    unique.set(
      normalized.date,
      normalized
    );
  }

  return [
    ...unique.values(),
  ].sort(
    (a, b) =>
      a.date.localeCompare(
        b.date
      )
  );
}

function normalizePayload(payload) {
  const validRows =
    validatePayload(payload);

  const history =
    normalizeHistory(
      validRows
    );

  const latest =
    history.at(-1) ??
    null;

  return {
    schema:
      payload.schema ?? 1,

    generated_at:
      payload.generated_at ??
      null,

    latest: latest
      ? {
          date:
            latest.date,

          total_rec:
            latest.total_rec,
        }
      : null,

    history,
  };
}

/* ---------------------------------------------------------
 * Comparison
 *
 * Ignore generated_at because it changes every API call.
 * ------------------------------------------------------ */

function comparablePayload(payload) {
  if (!payload) {
    return null;
  }

  return {
    schema:
      payload.schema ?? 1,

    latest:
      payload.latest ??
      null,

    history:
      payload.history ??
      [],
  };
}

function payloadHash(payload) {
  return sha256(
    JSON.stringify(
      comparablePayload(payload)
    )
  );
}

/* ---------------------------------------------------------
 * Index
 * ------------------------------------------------------ */

function buildIndex(payload) {
  const history =
    payload.history;

  const latest =
    payload.latest;

  const first =
    history[0] ?? null;

  return {
    schema: 1,

    dataset:
      "remittances_brh",

    title:
      "Transferts de fonds vers Haïti",

    frequency:
      "monthly",

    currency:
      "USD",

    generated_at:
      new Date().toISOString(),

    latest,

    observations:
      history.length,

    first_date:
      first?.date ?? null,

    last_date:
      latest?.date ?? null,

    files: {
      latest:
        "latest.json",

      archive:
        latest?.date
          ? `archive/${latest.date.slice(
              0,
              7
            )}.json`
          : null,
    },
  };
}

/* ---------------------------------------------------------
 * Main
 * ------------------------------------------------------ */

async function main() {
  console.log(
    "[remittances] Building Haiti remittances CDN..."
  );

  console.log(
    `[remittances] Source: ${API_URL}`
  );

  const rawPayload =
    await fetchJsonWithRetry(
      API_URL
    );

  const payload =
    normalizePayload(
      rawPayload
    );

  const latest =
    payload.latest;

  if (!latest?.date) {
    throw new Error(
      "Latest observation has no date."
    );
  }

  const latestMonth =
    latest.date.slice(0, 7);

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

  const archiveFile =
    path.join(
      OUT_DIR,
      "archive",
      `${latestMonth}.json`
    );

  const existing =
    await readJsonOrNull(
      latestFile
    );

  const oldHash =
    existing
      ? payloadHash(existing)
      : null;

  const newHash =
    payloadHash(payload);

  if (
    oldHash &&
    oldHash === newHash
  ) {
    console.log(
      "[remittances] No source-data changes detected."
    );

    /*
     * Important:
     * do not rewrite generated_at just because
     * the workflow ran again.
     */
    return;
  }

  /*
   * CDN generation time should represent when
   * the snapshot was actually updated.
   */
  const finalPayload = {
    ...payload,

    generated_at:
      new Date()
        .toISOString(),

    source: {
      institution: "BRH",

      endpoint:
        API_URL,

      frequency:
        "monthly",
    },
  };

  const index =
    buildIndex(
      finalPayload
    );

  await writeAtomic(
    latestFile,
    prettyJson(
      finalPayload
    )
  );

  /*
   * Archive represents the full state of the
   * dataset when this latest month was published
   * or revised.
   *
   * If BRH revises the latest month, the same
   * YYYY-MM archive file is updated.
   */
  await writeAtomic(
    archiveFile,
    prettyJson(
      finalPayload
    )
  );

  await writeAtomic(
    indexFile,
    prettyJson(index)
  );

  console.log(
    `[remittances] ${finalPayload.history.length} observations written.`
  );

  console.log(
    `[remittances] Latest month: ${latest.date}`
  );

  console.log(
    `[remittances] Latest received: ${latest.total_rec}`
  );

  console.log(
    `[remittances] Output: ${latestFile}`
  );

  console.log(
    `[remittances] Archive: ${archiveFile}`
  );
}

main().catch(
  (error) => {
    console.error(
      "[remittances] CDN generation failed:",
      error
    );

    process.exit(1);
  }
);
