// Job Bench — fetch script
// Pulls from public, documented job-board APIs only (no scraping of sites
// that don't offer one), filters for remote/part-time + recent listings,
// scores by relevance to your keywords, and writes jobs.json.

import { writeFileSync } from "fs";

// ---- Edit this to match your background / target roles ----
const KEYWORDS = [
  { word: "electronics", weight: 3 },
  { word: "repair", weight: 3 },
  { word: "technician", weight: 3 },
  { word: "3d print", weight: 3 },
  { word: "cad", weight: 2 },
  { word: "hardware", weight: 2 },
  { word: "technical support", weight: 2 },
  { word: "customer support", weight: 2 },
  { word: "data entry", weight: 2 },
  { word: "virtual assistant", weight: 2 },
  { word: "admin", weight: 1 },
  { word: "web", weight: 1 },
  { word: "design", weight: 1 },
  { word: "part time", weight: 4 },
  { word: "part-time", weight: 4 },
  { word: "contract", weight: 1 },
  { word: "freelance", weight: 1 },
];

// Rough, editable USD->NGN estimate. Update this number whenever the rate
// moves — this is NOT a live exchange rate.
const USD_TO_NGN = 1600;
const MIN_PAY_NGN_MONTHLY = 100000;
const MAX_AGE_HOURS = 48;

// ---- Location signal ----
// The three sources below (Jobicy, Arbeitnow, Remote OK) are global remote
// boards that skew heavily US/EU. Skill-keyword scoring alone ranks a US-only
// "repair technician" role above a genuinely open one, and never rewards a
// job that's actually open to Nigeria. This layer fixes that: it reads each
// job's stated geo eligibility (jobGeo/location/description) and boosts
// anything explicitly Nigeria/Africa-friendly or open to anywhere, while
// pushing down roles that name a single region Adedoyin can't work from.
const GEO_BOOST_KEYWORDS = [
  { word: "nigeria", weight: 10 },
  { word: "lagos", weight: 10 },
  { word: "africa", weight: 7 },
  { word: "anywhere", weight: 5 },
  { word: "worldwide", weight: 5 },
  { word: "global", weight: 3 },
  { word: "remote - global", weight: 5 },
  { word: "remote, global", weight: 5 },
  { word: "international", weight: 2 },
];

// Substrings that mean "not open to someone based in Nigeria" when they show
// up in a geo/location field or the description. Kept short and literal on
// purpose — this is a deprioritization signal, not a hard filter, since a
// posting can still be misclassified.
const GEO_RESTRICT_KEYWORDS = [
  "us citizens only",
  "u.s. citizens only",
  "usa only",
  "us only",
  "united states only",
  "must be based in the us",
  "must be located in the us",
  "us-based only",
  "eu citizens only",
  "european union only",
  "europe only",
  "eu only",
  "uk only",
  "united kingdom only",
  "uk-based only",
  "canada only",
  "must be based in canada",
  "australia only",
  "must be based in australia",
  "must reside in the united states",
  "authorized to work in the us without sponsorship",
];

// Bare region names, used only against a short geo/location field (not the
// full description, where they'd false-positive on unrelated mentions).
const GEO_FIELD_RESTRICT_REGEX =
  /\b(usa|us|united states|europe|eu|uk|united kingdom|canada|australia)\b/i;
const GEO_FIELD_OPEN_REGEX = /\b(anywhere|worldwide|global)\b/i;
const GEO_FIELD_AFRICA_REGEX = /\b(africa|nigeria)\b/i;

function scoreText(text) {
  const t = text.toLowerCase();
  let score = 0;
  for (const { word, weight } of KEYWORDS) {
    if (t.includes(word)) score += weight;
  }
  return score;
}

// geoField is a short, explicit eligibility string when the source provides
// one (Jobicy's jobGeo, Arbeitnow/Remote OK's location) — separate from the
// long free-text description, since a one-word field is unambiguous while a
// paragraph can mention "Europe" or "Canada" in passing.
function geoScore(description, geoField) {
  const t = (description || "").toLowerCase();
  let score = 0;
  for (const { word, weight } of GEO_BOOST_KEYWORDS) {
    if (t.includes(word)) score += weight;
  }
  for (const bad of GEO_RESTRICT_KEYWORDS) {
    if (t.includes(bad)) score -= 10;
  }
  if (geoField) {
    const g = String(geoField).toLowerCase();
    if (GEO_FIELD_AFRICA_REGEX.test(g)) score += 12;
    else if (GEO_FIELD_OPEN_REGEX.test(g)) score += 8;
    else if (GEO_FIELD_RESTRICT_REGEX.test(g)) score -= 6;
  }
  return score;
}

function isPartTimeOrRemoteFriendly(text) {
  const t = text.toLowerCase();
  return (
    t.includes("part time") ||
    t.includes("part-time") ||
    t.includes("remote") ||
    t.includes("contract") ||
    t.includes("freelance")
  );
}

function hoursAgo(dateStr) {
  const posted = new Date(dateStr).getTime();
  if (Number.isNaN(posted)) return null;
  return (Date.now() - posted) / (1000 * 60 * 60);
}

// Try to pull a monthly figure out of free-text salary strings.
// Handles both USD listings (converted to NGN) and naira listings (kept as-is,
// since Nigerian job boards quote salaries in NGN, usually per month).
// Returns { ngn, raw } or null if nothing usable is found.
function parsePay(raw) {
  if (!raw) return null;
  const text = String(raw);
  const nums = text.match(/[\d,]+(?:\.\d+)?/g);
  if (!nums) return { ngn: null, raw: text };
  const value = parseFloat(nums[nums.length - 1].replace(/,/g, ""));
  if (Number.isNaN(value)) return { ngn: null, raw: text };

  const isNaira = /₦|\bngn\b|\bnaira\b/i.test(text);
  const isYearly = /year|annum|yr|p\.a\./i.test(text);
  const isHourly = /hour|hr/i.test(text);

  if (isNaira) {
    let monthly = value;
    if (isYearly) monthly = value / 12;
    else if (isHourly) monthly = value * 160;
    return { ngn: Math.round(monthly), raw: text };
  }

  // crude heuristics for USD: yearly figures are usually >> monthly
  let monthlyUsd = value;
  if (isYearly || value > 8000) monthlyUsd = value / 12;
  if (isHourly) monthlyUsd = value * 160; // ~160 working hrs/mo

  return { ngn: Math.round(monthlyUsd * USD_TO_NGN), raw: text };
}

const COMMON_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (compatible; JobBenchBot/1.0; +https://github.com)",
  Accept: "application/json",
};

async function fetchJobicy() {
  try {
    const res = await fetch("https://jobicy.com/api/v2/remote-jobs?count=50", {
      headers: COMMON_HEADERS,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    console.log(`Jobicy: ${(data.jobs || []).length} jobs`);
    return (data.jobs || []).map((j) => ({
      id: `jobicy-${j.id}`,
      title: j.jobTitle,
      company: j.companyName,
      url: j.url,
      postedAt: j.pubDate,
      description: `${j.jobTitle} ${j.jobDescription || ""} ${j.jobType || ""} ${j.jobGeo || ""}`,
      geoField: j.jobGeo || null,
      location: j.jobGeo || null,
      payRaw: j.annualSalaryMin
        ? `${j.annualSalaryMin}-${j.annualSalaryMax || ""} ${j.salaryCurrency || "USD"}/yr`
        : j.jobType || null,
      source: "Jobicy",
    }));
  } catch (e) {
    console.error("Jobicy fetch failed:", e.message);
    return [];
  }
}

async function fetchArbeitnow() {
  try {
    const res = await fetch("https://www.arbeitnow.com/api/job-board-api", {
      headers: COMMON_HEADERS,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    console.log(`Arbeitnow: ${(data.data || []).length} jobs`);
    return (data.data || []).map((j) => ({
      id: `arbeitnow-${j.slug}`,
      title: j.title,
      company: j.company_name,
      url: j.url,
      postedAt: j.created_at
        ? new Date(j.created_at * 1000).toISOString()
        : null,
      description: `${j.title} ${j.description || ""} ${(j.tags || []).join(" ")} ${(j.job_types || []).join(" ")} ${j.location || ""}`,
      // Arbeitnow's own remote flag means "remote within this company's usual
      // hiring region" (mostly EU/DACH), not "open worldwide" — so it's kept
      // out of the geo field rather than treated as a Nigeria-friendly signal.
      geoField: j.location || null,
      location: j.location || (j.remote ? "Remote" : null),
      payRaw: null,
      source: "Arbeitnow",
    }));
  } catch (e) {
    console.error("Arbeitnow fetch failed:", e.message);
    return [];
  }
}

async function fetchRemoteOK() {
  try {
    // Remote OK returns 403/empty without a realistic User-Agent header.
    const res = await fetch("https://remoteok.com/api", {
      headers: COMMON_HEADERS,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const jobs = (data || []).filter((j) => j.id);
    console.log(`Remote OK: ${jobs.length} jobs`);
    return jobs
      .filter((j) => j.id)
      .map((j) => ({
        id: `remoteok-${j.id}`,
        title: j.position,
        company: j.company,
        url: j.url,
        postedAt: j.date,
        description: `${j.position} ${j.description || ""} ${(j.tags || []).join(" ")} ${j.location || ""}`,
        geoField: j.location || null,
        location: j.location || null,
        payRaw:
          j.salary_min || j.salary_max
            ? `${j.salary_min || ""}-${j.salary_max || ""} USD/yr`
            : null,
        source: "Remote OK",
      }));
  } catch (e) {
    console.error("Remote OK fetch failed:", e.message);
    return [];
  }
}

// Jooble is a global aggregator that, unlike the three sources above, also
// pulls from Nigerian job sites (Jobberman, MyJobMag, etc. don't offer a
// public API themselves, but Jooble indexes postings that originate there).
// Free API key from https://jooble.org/api/about — note the key has a
// LIFETIME cap of 500 requests, so this is called once per run, not per
// keyword. Set JOOBLE_API_KEY as a GitHub Actions secret; if it's not set,
// this source is skipped rather than failing the whole run.
async function fetchJooble() {
  const key = process.env.JOOBLE_API_KEY;
  if (!key) {
    console.warn("JOOBLE_API_KEY not set — skipping Jooble (Nigeria) fetch.");
    return [];
  }
  try {
    const res = await fetch(`https://jooble.org/api/${key}`, {
      method: "POST",
      headers: { ...COMMON_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify({
        keywords:
          "electronics repair technician OR remote OR part time OR technical support OR data entry",
        location: "Nigeria",
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const jobs = data.jobs || [];
    console.log(`Jooble (Nigeria): ${jobs.length} jobs`);
    return jobs.map((j, i) => ({
      id: `jooble-${j.id || i}`,
      title: j.title,
      company: j.company || null,
      url: j.link,
      postedAt: j.updated || null,
      description: `${j.title} ${j.snippet || ""} ${j.location || ""} ${j.type || ""}`,
      // Jooble was already asked to search within Nigeria, so treat its
      // location field (or a Nigeria fallback) as the geo signal directly.
      // Always append "Nigeria": Jooble often returns just "Lagos" or "Ikeja",
      // which wouldn't match the Africa/Nigeria geo regex on its own.
      geoField: `${j.location || ""} Nigeria`.trim(),
      location: j.location || "Nigeria",
      payRaw: j.salary || null,
      source: "Jooble (NG)",
    }));
  } catch (e) {
    console.error("Jooble fetch failed:", e.message);
    return [];
  }
}

async function main() {
  const [jobicy, arbeitnow, remoteok, jooble] = await Promise.all([
    fetchJobicy(),
    fetchArbeitnow(),
    fetchRemoteOK(),
    fetchJooble(),
  ]);

  console.log(
    `Fetched totals — Jobicy: ${jobicy.length}, Arbeitnow: ${arbeitnow.length}, Remote OK: ${remoteok.length}, Jooble (NG): ${jooble.length}`
  );

  const all = [...jobicy, ...arbeitnow, ...remoteok, ...jooble];

  if (all.length === 0) {
    console.warn(
      "WARNING: all sources returned 0 jobs — check for API errors above before assuming this is correct."
    );
  }

  const processed = all
    .map((j) => {
      const age = hoursAgo(j.postedAt);
      const pay = parsePay(j.payRaw);
      const skillScore = scoreText(j.description || j.title || "");
      const geoFit = geoScore(j.description, j.geoField);
      return {
        ...j,
        ageHours: age,
        skillScore,
        geoFit,
        // Geo fit dominates: a skill-relevant job that's US/EU-only should
        // still rank below a weaker skill match that's actually reachable
        // from Nigeria. relevance is kept as the combined field the UI/sort
        // already expects.
        relevance: skillScore + geoFit,
        partTimeOrFlexible: isPartTimeOrRemoteFriendly(j.description || ""),
        payEstimateNGN: pay?.ngn ?? null,
        payRawDisplay: pay?.raw ?? j.payRaw ?? "Not listed",
      };
    })
    // must have a usable posted date and be within window; if the source
    // gives no date at all, keep it but mark it so the UI can flag it
    .filter((j) => j.ageHours === null || j.ageHours <= MAX_AGE_HOURS)
    .sort((a, b) => b.relevance - a.relevance);

  const output = {
    generatedAt: new Date().toISOString(),
    maxAgeHours: MAX_AGE_HOURS,
    minPayNgnMonthly: MIN_PAY_NGN_MONTHLY,
    usdToNgnRateUsed: USD_TO_NGN,
    count: processed.length,
    jobs: processed,
  };

  writeFileSync("jobs.json", JSON.stringify(output, null, 2));
  console.log(`Wrote ${processed.length} jobs to jobs.json`);
}

main();
