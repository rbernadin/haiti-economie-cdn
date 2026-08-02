import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const API_URL =
  process.env.INFLATION_API_URL ||
  "https://haiti-economie-api.onrender.com/api/inflation-history-standardized?count=all";

const OUT_DIR =
  process.env.INFLATION_OUT_DIR ||
  "cdn/daily/inflation-haiti";

const REQUEST_TIMEOUT_MS = 45_000;
const MAX_ATTEMPTS = 4;

const EXPECTED_FIELDS = [
  "indice_general",
  "alimentaires",
  "alcool",
  "habillement",
  "logement",
  "meubles",
  "sante",
  "transport",
  "communication",
  "loisirs",
  "enseignement",
  "restaurants",
  "biens_services",

  "indice_general_var_perc",
  "alimentaires_var_perc",
  "alcool_var_perc",
  "habillement_var_perc",
  "logement_var_perc",
  "meubles_var_perc",
  "sante_var_perc",
  "transport_var_perc",
  "communication_var_perc",
  "loisirs_var_perc",
  "enseignement_var_perc",
  "restaurants_var_perc",
  "biens_services_var_perc",

  "metro",
  "reste_ouest",
  "nord",
  "sud",
  "transversal",

  "metro_var_perc",
  "reste_ouest_var_perc",
  "nord_var_perc",
  "sud_var_perc",
  "transversal_var_perc",

  "ipc_produits_locaux",
  "ipc_produits_importes",

  "indice_general_var_mois",
  "alimentaires_var_mois",
  "alcool_var_mois",
  "habillement_var_mois",
  "logement_var_mois",
  "meubles_var_mois",
  "sante_var_mois",
  "transport_var_mois",
  "communication_var_mois",
  "loisirs_var_mois",
  "enseignement_var_mois",
  "restaurants_var_mois",
  "biens_services_var_mois",

  "metro_var_mois",
  "reste_ouest_var_mois",
  "nord_var_mois",
  "sud_var_mois",
  "transversal_var_mois",
];

const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

function prettyJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function readTextOrNull(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function writeAtomic(filePath, contents) {
  await mkdir(path.dirname(filePath), { recursive: true });

  const temporaryPath = `${filePath}.tmp`;
  await writeFile(temporaryPath, contents, "utf8");
  await rename(temporaryPath, filePath);
}

async function fetchJsonWithRetry(url) {
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      REQUEST_TIMEOUT_MS
    );

    try {
      console.log(`Fetching inflation API, attempt ${attempt}/${MAX_ATTEMPTS}...`);

      const response = await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          "User-Agent": "haiti-economie-cdn/1.0",
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(
          `Inflation API returned ${response.status} ${response.statusText}`
        );
      }

      const contentType = response.headers.get("content-type") || "";

      if (!contentType.toLowerCase().includes("application/json")) {
        throw new Error(
          `Expected JSON but received content-type: ${contentType || "unknown"}`
        );
      }

      return await response.json();
    } catch (error) {
      lastError = error;
      console.error(`Attempt ${attempt} failed:`, error.message);

      if (attempt < MAX_ATTEMPTS) {
        await sleep(attempt * 5_000);
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError || new Error("Unable to retrieve inflation data.");
}

function validateRow(row, label) {
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    throw new Error(`${label} must be a JSON object.`);
  }

  if (
    typeof row.period !== "string" ||
    !/^\d{4}-\d{2}$/.test(row.period)
  ) {
    throw new Error(`${label}.period must use YYYY-MM format.`);
  }

  const missingFields = EXPECTED_FIELDS.filter(
    (field) => !Object.prototype.hasOwnProperty.call(row, field)
  );

  if (missingFields.length) {
    throw new Error(
      `${label} is missing fields: ${missingFields.join(", ")}`
    );
  }

  for (const field of EXPECTED_FIELDS) {
    const value = row[field];

    if (
      value !== null &&
      (typeof value !== "number" || !Number.isFinite(value))
    ) {
      throw new Error(
        `${label}.${field} must be a finite number or null.`
      );
    }
  }
}

function validatePayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("The API payload must be a JSON object.");
  }

  if (!Array.isArray(payload.history)) {
    throw new Error("payload.history must be an array.");
  }

  if (!Number.isInteger(payload.count) || payload.count < 0) {
    throw new Error("payload.count must be a non-negative integer.");
  }

  if (payload.count !== payload.history.length) {
    throw new Error(
      `Count mismatch: payload.count=${payload.count}, history.length=${payload.history.length}.`
    );
  }

  if (!payload.history.length) {
    throw new Error(
      "The API returned an empty inflation history. Existing CDN files were preserved."
    );
  }

  validateRow(payload.latest, "payload.latest");

  payload.history.forEach((row, index) => {
    validateRow(row, `payload.history[${index}]`);
  });

  const lastHistoryRow = payload.history[payload.history.length - 1];

  if (payload.as_of !== payload.latest.period) {
    throw new Error(
      `as_of (${payload.as_of}) does not match latest.period (${payload.latest.period}).`
    );
  }

  if (lastHistoryRow.period !== payload.latest.period) {
    throw new Error(
      `The final history period (${lastHistoryRow.period}) does not match latest.period (${payload.latest.period}).`
    );
  }

  for (let index = 1; index < payload.history.length; index += 1) {
    const previous = payload.history[index - 1].period;
    const current = payload.history[index].period;

    if (previous > current) {
      throw new Error(
        `History is not in ascending order at ${previous} → ${current}.`
      );
    }
  }
}

async function main() {
  const payload = await fetchJsonWithRetry(API_URL);
  validatePayload(payload);

  /*
   * Preserve the API response shape exactly. Existing consumers can switch
   * from the Render endpoint to latest.json without changing data.latest,
   * data.history, data.count or data.as_of.
   */
  const latestContents = prettyJson(payload);
  const latestPath = path.join(OUT_DIR, "latest.json");
  const existingLatest = await readTextOrNull(latestPath);

  if (existingLatest === latestContents) {
    console.log(
      `No source changes detected. CDN remains current through ${payload.as_of}.`
    );
    return;
  }

  const generatedAt = new Date().toISOString();
  const digest = sha256(latestContents);
  const archiveRelativePath = `archive/${payload.as_of}.json`;
  const archivePath = path.join(OUT_DIR, archiveRelativePath);

  const manifest = {
    dataset: "haiti-monthly-inflation",
    title: "Inflation mensuelle en Haïti",
    frequency: "monthly",
    as_of: payload.as_of,
    count: payload.count,
    generated_at: generatedAt,
    source_api: API_URL,
    sha256: digest,
    files: {
      latest: "latest.json",
      archive: archiveRelativePath,
    },
    fields: EXPECTED_FIELDS,
  };

  await writeAtomic(latestPath, latestContents);
  await writeAtomic(archivePath, latestContents);
  await writeAtomic(
    path.join(OUT_DIR, "index.json"),
    prettyJson(manifest)
  );

  console.log(`Inflation CDN updated through ${payload.as_of}.`);
  console.log(`Rows published: ${payload.count}.`);
  console.log(`SHA-256: ${digest}.`);
}

main().catch((error) => {
  console.error("Inflation CDN build failed:", error);
  process.exitCode = 1;
});
