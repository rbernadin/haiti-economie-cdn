import fs from "node:fs/promises";

const API_URL =
  process.env.MARQUEE_API_URL ||
  "https://YOUR-API-HOST/api/exchange-market-marquee"; // <-- change this

function isNum(x) {
  const n = Number(x);
  return Number.isFinite(n);
}

// Match your TopNavBar convention:
// up = red, down = green, tiny = neutral
const FLAT_EPS = 0.005; // 0.005% -> rounds to 0.00%

function variantFromPct(pct) {
  if (!isNum(pct)) return "neutral";
  const n = Number(pct);
  if (Math.abs(n) < FLAT_EPS) return "neutral";
  return n >= 0 ? "red" : "green";
}

async function main() {
  const res = await fetch(API_URL, {
    headers: { Accept: "application/json" },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} from ${API_URL} :: ${text.slice(0, 200)}`);
  }

  const api = await res.json();

  // Your API returns:
  // { ref:{value,change,percent}, tma:{...}, euro_achat:{...}, ... }
  // Your CDN wants:
  // { asof:"YYYY-MM-DD", data:{ ref:{value,pct,variant}, ... } }

  const data = {};
  for (const [key, obj] of Object.entries(api)) {
    const value = obj && isNum(obj.value) ? Number(obj.value) : 0;
    const pct =
      obj && isNum(obj.pct) ? Number(obj.pct) :
      obj && isNum(obj.percent) ? Number(obj.percent) : 0;

    data[key] = { value, pct, variant: variantFromPct(pct) };
  }

  const out = {
    asof: new Date().toISOString().slice(0, 10),
    data,
  };

  await fs.mkdir("cdn/daily", { recursive: true });
  await fs.writeFile("cdn/daily/marquee.json", JSON.stringify(out, null, 2) + "\n", "utf8");

  console.log("Updated cdn/daily/marquee.json from:", API_URL);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

