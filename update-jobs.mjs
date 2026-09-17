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

function scoreText(text) {
  const t = text.toLowerCase();
  let score = 0;
  for (const { word, weight } of KEYWORDS) {
    if (t.includes(word)) score += weight;
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

// Try to pull a monthly USD figure out of free-text salary strings.
// Returns { ngn, raw } or null if nothing usable is found.
function parsePay(raw) {
  if (!raw) return null;
  const text = String(raw);
  const nums = text.match(/[\d,]+(?:\.\d+)?/g);
  if (!nums) return { ngn: null, raw: text };
  const value = parseFloat(nums[nums.length - 1].replace(/,/g, ""));
  if (Number.isNaN(value)) return { ngn: null, raw: text };

  // crude heuristics: yearly figures are usually >> monthly
  let monthlyUsd = value;
  if (/year|annum|yr/i.test(text) || value > 8000) monthlyUsd = value / 12;
  if (/hour|hr/i.test(text)) monthlyUsd = value * 160; // ~160 working hrs/mo

  return { ngn: Math.round(monthlyUsd * USD_TO_NGN), raw: text };
}

async function fetchJobicy() {
  try {
    const res = await fetch("https://jobicy.com/api/v2/remote-jobs?count=50");
    const data = await res.json();
    return (data.jobs || []).map((j) => ({
      id: `jobicy-${j.id}`,
      title: j.jobTitle,
      company: j.companyName,
      url: j.url,
      postedAt: j.pubDate,
      description: `${j.jobTitle} ${j.jobDescription || ""} ${j.jobType || ""}`,
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
    const res = await fetch("https://www.arbeitnow.com/api/job-board-api");
    const data = await res.json();
    return (data.data || []).map((j) => ({
      id: `arbeitnow-${j.slug}`,
      title: j.title,
      company: j.company_name,
      url: j.url,
      postedAt: j.created_at
        ? new Date(j.created_at * 1000).toISOString()
        : null,
      description: `${j.title} ${j.description || ""} ${(j.tags || []).join(" ")} ${(j.job_types || []).join(" ")}`,
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
    const res = await fetch("https://remoteok.com/api");
    const data = await res.json();
    return (data || [])
      .filter((j) => j.id)
      .map((j) => ({
        id: `remoteok-${j.id}`,
        title: j.position,
        company: j.company,
        url: j.url,
        postedAt: j.date,
        description: `${j.position} ${j.description || ""} ${(j.tags || []).join(" ")}`,
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

async function main() {
  const [jobicy, arbeitnow, remoteok] = await Promise.all([
    fetchJobicy(),
    fetchArbeitnow(),
    fetchRemoteOK(),
  ]);

  const all = [...jobicy, ...arbeitnow, ...remoteok];

  const processed = all
    .map((j) => {
      const age = hoursAgo(j.postedAt);
      const pay = parsePay(j.payRaw);
      return {
        ...j,
        ageHours: age,
        relevance: scoreText(j.description || j.title || ""),
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
