import {
  mkdir,
  rm,
  writeFile,
} from "node:fs/promises";

import path from "node:path";

const API_URL =
  process.env.BUDGET_APPROVED_API_URL ||
  "https://haiti-economie-api.onrender.com/api/budget-approved-standardized?count=all";

const OUTPUT_DIR = path.resolve(
  "cdn/daily/budget-approved"
);

function slugify(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function compareStrings(a, b) {
  return String(a || "").localeCompare(String(b || ""));
}

function compareReleaseAsc(a, b) {
  const byPublication = compareStrings(
    a.publication_date,
    b.publication_date
  );

  if (byPublication !== 0) {
    return byPublication;
  }

  return compareStrings(
    a.imported_at,
    b.imported_at
  );
}

function sortRows(rows) {
  return [...rows].sort((a, b) => {
    const aRow = Number(a.source_row_number);
    const bRow = Number(b.source_row_number);

    if (
      Number.isFinite(aRow) &&
      Number.isFinite(bRow) &&
      aRow !== bRow
    ) {
      return aRow - bRow;
    }

    return Number(a.id || 0) - Number(b.id || 0);
  });
}

function getOfficialTotal(rows) {
  return (
    rows.find(
      (row) =>
        String(row.row_type || "").toLowerCase() === "total" &&
        Number(row.hierarchy_level) === 0
    ) ||
    rows.find(
      (row) =>
        String(row.entity_code || "").toUpperCase() === "TOTAL"
    ) ||
    null
  );
}

function maxImportedAt(rows) {
  const values = rows
    .map((row) => row.imported_at)
    .filter(Boolean)
    .sort();

  return values.length
    ? values[values.length - 1]
    : null;
}

async function writeJson(filename, data) {
  await mkdir(path.dirname(filename), {
    recursive: true,
  });

  await writeFile(
    filename,
    JSON.stringify(data, null, 2) + "\n",
    "utf8"
  );
}

async function fetchJson(url, attempts = 3) {
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
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

      if (attempt < attempts) {
        await new Promise((resolve) =>
          setTimeout(resolve, 1500)
        );
      }
    }
  }

  throw lastError;
}

console.log(`Fetching approved budget data...`);
console.log(API_URL);

const payload = await fetchJson(API_URL);

const rows = Array.isArray(payload)
  ? payload
  : payload.data;

if (!Array.isArray(rows)) {
  throw new Error(
    "API response does not contain a valid data array."
  );
}

if (rows.length === 0) {
  throw new Error(
    "API returned zero approved-budget rows."
  );
}

console.log(`Received ${rows.length} rows.`);

// --------------------------------------------------
// Clean previous generated directory
// --------------------------------------------------

await rm(OUTPUT_DIR, {
  recursive: true,
  force: true,
});

await mkdir(OUTPUT_DIR, {
  recursive: true,
});

// --------------------------------------------------
// Stable dataset timestamp
// --------------------------------------------------

const dataUpdatedAt = maxImportedAt(rows);

// --------------------------------------------------
// Group rows into official releases
// --------------------------------------------------

const releaseMap = new Map();

for (const row of rows) {
  const key = [
    row.fiscal_year || "",
    row.publication_date || "",
    row.budget_version || "",
    row.source_file_name || "",
  ].join("||");

  if (!releaseMap.has(key)) {
    releaseMap.set(key, {
      fiscal_year: row.fiscal_year,
      fiscal_year_start: row.fiscal_year_start,
      fiscal_year_end: row.fiscal_year_end,
      publication_date: row.publication_date,
      publication_number: row.publication_number,
      budget_version: row.budget_version,
      source_file_name: row.source_file_name,
      imported_at: row.imported_at,
      rows: [],
    });
  }

  const release = releaseMap.get(key);

  release.rows.push(row);

  if (
    row.imported_at &&
    (!release.imported_at ||
      row.imported_at > release.imported_at)
  ) {
    release.imported_at = row.imported_at;
  }
}

const releases = [...releaseMap.values()]
  .sort(compareReleaseAsc);

// --------------------------------------------------
// Build release metadata
// --------------------------------------------------

function buildReleaseSummary(release, file = null) {
  const total = getOfficialTotal(release.rows);

  return {
    fiscal_year: release.fiscal_year,
    fiscal_year_start: release.fiscal_year_start,
    fiscal_year_end: release.fiscal_year_end,

    budget_version: release.budget_version,

    publication_date: release.publication_date,
    publication_number: release.publication_number,

    source_file_name: release.source_file_name,
    imported_at: release.imported_at,

    row_count: release.rows.length,

    credits_fonctionnement:
      total?.credits_fonctionnement ?? null,

    credits_investissement:
      total?.credits_investissement ?? null,

    total_credits:
      total?.total_credits ?? null,

    calculated_total:
      total?.calculated_total ?? null,

    difference:
      total?.difference ?? null,

    ...(file ? { file } : {}),
  };
}

function buildReleasePayload(release) {
  const total = getOfficialTotal(release.rows);

  return {
    metadata: {
      fiscal_year: release.fiscal_year,
      fiscal_year_start: release.fiscal_year_start,
      fiscal_year_end: release.fiscal_year_end,

      budget_version: release.budget_version,

      publication_date: release.publication_date,
      publication_number: release.publication_number,

      source_file_name: release.source_file_name,
      imported_at: release.imported_at,

      row_count: release.rows.length,
    },

    total: total
      ? {
          credits_fonctionnement:
            total.credits_fonctionnement,

          credits_investissement:
            total.credits_investissement,

          total_credits:
            total.total_credits,

          calculated_total:
            total.calculated_total,

          difference:
            total.difference,
        }
      : null,

    data: sortRows(release.rows),
  };
}

// --------------------------------------------------
// Group releases by fiscal year
// --------------------------------------------------

const fiscalYearMap = new Map();

for (const release of releases) {
  const fy = release.fiscal_year || "unknown";

  if (!fiscalYearMap.has(fy)) {
    fiscalYearMap.set(fy, []);
  }

  fiscalYearMap.get(fy).push(release);
}

// --------------------------------------------------
// Write fiscal-year files
// --------------------------------------------------

const fiscalYearIndexes = [];

for (const [fiscalYear, fyReleases] of fiscalYearMap) {
  fyReleases.sort(compareReleaseAsc);

  const fiscalYearSlug = slugify(fiscalYear);

  const fiscalYearDir = path.join(
    OUTPUT_DIR,
    fiscalYearSlug
  );

  await mkdir(fiscalYearDir, {
    recursive: true,
  });

  const metadata = [];
  const usedNames = new Set();

  for (const release of fyReleases) {
    let versionSlug =
      slugify(release.budget_version) ||
      slugify(release.publication_date) ||
      "release";

    // Prevent accidental filename collision
    if (usedNames.has(versionSlug)) {
      versionSlug = [
        versionSlug,
        slugify(release.publication_date),
      ]
        .filter(Boolean)
        .join("-");
    }

    usedNames.add(versionSlug);

    const filename = `${versionSlug}.json`;

    const relativePath =
      `${fiscalYearSlug}/${filename}`;

    await writeJson(
      path.join(fiscalYearDir, filename),
      buildReleasePayload(release)
    );

    metadata.push(
      buildReleaseSummary(
        release,
        relativePath
      )
    );
  }

  const latestRelease =
    fyReleases[fyReleases.length - 1];

  await writeJson(
    path.join(fiscalYearDir, "latest.json"),
    buildReleasePayload(latestRelease)
  );

  const fyIndex = {
    fiscal_year: fiscalYear,

    fiscal_year_start:
      latestRelease.fiscal_year_start,

    fiscal_year_end:
      latestRelease.fiscal_year_end,

    latest: buildReleaseSummary(
      latestRelease,
      `${fiscalYearSlug}/latest.json`
    ),

    releases: [...metadata].reverse(),
  };

  await writeJson(
    path.join(fiscalYearDir, "index.json"),
    fyIndex
  );

  fiscalYearIndexes.push({
    fiscal_year: fiscalYear,

    fiscal_year_start:
      latestRelease.fiscal_year_start,

    fiscal_year_end:
      latestRelease.fiscal_year_end,

    latest_budget_version:
      latestRelease.budget_version,

    latest_publication_date:
      latestRelease.publication_date,

    latest_publication_number:
      latestRelease.publication_number,

    index_file:
      `${fiscalYearSlug}/index.json`,

    latest_file:
      `${fiscalYearSlug}/latest.json`,

    releases: [...metadata].reverse(),
  });
}

// --------------------------------------------------
// Global latest release
// --------------------------------------------------

const latestRelease =
  releases[releases.length - 1];

await writeJson(
  path.join(OUTPUT_DIR, "latest.json"),
  buildReleasePayload(latestRelease)
);

// --------------------------------------------------
// Full historical dataset
// --------------------------------------------------

await writeJson(
  path.join(OUTPUT_DIR, "all.json"),
  {
    source: "budget_approved_import_clean",
    data_updated_at: dataUpdatedAt,
    row_count: rows.length,
    release_count: releases.length,
    data: rows,
  }
);

// --------------------------------------------------
// Budget totals / historical series
// --------------------------------------------------

const totals = releases.map((release) =>
  buildReleaseSummary(release)
);

await writeJson(
  path.join(OUTPUT_DIR, "totals.json"),
  {
    source: "budget_approved_import_clean",
    data_updated_at: dataUpdatedAt,
    count: totals.length,
    data: totals,
  }
);

// --------------------------------------------------
// Master index
// --------------------------------------------------

fiscalYearIndexes.sort((a, b) =>
  compareStrings(
    b.fiscal_year_start,
    a.fiscal_year_start
  )
);

await writeJson(
  path.join(OUTPUT_DIR, "index.json"),
  {
    source: "budget_approved_import_clean",

    api:
      "/api/budget-approved-standardized?count=all",

    data_updated_at: dataUpdatedAt,

    row_count: rows.length,
    release_count: releases.length,

    latest: buildReleaseSummary(
      latestRelease,
      "latest.json"
    ),

    files: {
      latest: "latest.json",
      all: "all.json",
      totals: "totals.json",
    },

    fiscal_years: fiscalYearIndexes,
  }
);

console.log(
  `Built ${releases.length} budget releases across ${fiscalYearMap.size} fiscal years.`
);

console.log(
  `Output: ${OUTPUT_DIR}`
);