// scripts/update-latest-news.mjs

import fs from "node:fs/promises";
import path from "node:path";

const API_URL =
  process.env.LATEST_NEWS_API_URL ||
  "https://haiti-economie-api.onrender.com/api/wp/posts?per_page=12&page=1";

const OUT_DIR = path.join(process.cwd(), "cdn", "daily");
const OUT_FILE = path.join(OUT_DIR, "latest-news.json");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchJsonWithRetry(url, retries = 4) {
  let lastError;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`Fetching latest news. Attempt ${attempt}/${retries}`);
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

function extractPosts(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.posts)) return data.posts;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.data)) return data.data;
  return [];
}

function normalizePost(post) {
  return {
    id: post?.id ?? null,
    slug: post?.slug ?? "",
    date: post?.date ?? post?.published_at ?? null,
    modified: post?.modified ?? null,
    title: post?.title ?? "",
    excerpt: post?.excerpt ?? post?.summary ?? "",
    featured_image:
      post?.featured_image ||
      post?.featuredImage ||
      post?.jetpack_featured_media_url ||
      post?.thumbnail ||
      post?.image ||
      null,

    primary_category:
      post?.primary_category ||
      post?.category_name ||
      post?.category ||
      post?.categories_names?.[0] ||
      post?.categoriesNames?.[0] ||
      null,

    primary_category_slug:
      post?.primary_category_slug ||
      post?.category_slug ||
      post?.categories_slugs?.[0] ||
      post?.categoriesSlugs?.[0] ||
      null,

    categories_names:
      post?.categories_names ||
      post?.categoriesNames ||
      [],

    categories_slugs:
      post?.categories_slugs ||
      post?.categoriesSlugs ||
      [],
  };
}

async function main() {
  const data = await fetchJsonWithRetry(API_URL);
  const posts = extractPosts(data);

  const payload = {
    generated_at: new Date().toISOString(),
    source: API_URL,
    items: posts.map(normalizePost),
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
  console.error("Failed to update latest news CDN file.");
  console.error(error);
  process.exit(1);
});