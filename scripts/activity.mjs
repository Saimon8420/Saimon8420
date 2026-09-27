// Builds activity.svg — the contribution grid + streak readout, drawn in the
// portfolio's Mission Control palette. Runs daily from a GitHub Action so the
// README never depends on a third-party card service.
//   GITHUB_TOKEN=… node scripts/activity.mjs
import { writeFileSync } from "node:fs";

const USER = process.env.GH_USER ?? "Saimon8420";
const TOKEN = process.env.GITHUB_TOKEN;
if (!TOKEN) throw new Error("GITHUB_TOKEN is required");

async function gql(query, variables = {}) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json();
  if (!res.ok || body.errors) throw new Error(JSON.stringify(body.errors ?? body));
  return body.data;
}

const CAL = `query($login:String!,$from:DateTime,$to:DateTime){user(login:$login){createdAt
  contributionsCollection(from:$from,to:$to){contributionCalendar{totalContributions
  weeks{contributionDays{date contributionCount}}}}}}`;

// Last 12 months for the grid.
const recent = (await gql(CAL, { login: USER })).user;
const weeks = recent.contributionsCollection.contributionCalendar.weeks;
const yearTotal = recent.contributionsCollection.contributionCalendar.totalContributions;

// Every year since sign-up for the all-time total and the streaks.
const days = new Map();
const first = new Date(recent.createdAt).getUTCFullYear();
const now = new Date();
for (let y = first; y <= now.getUTCFullYear(); y++) {
  const from = new Date(Date.UTC(y, 0, 1)).toISOString();
  const to = new Date(Math.min(Date.UTC(y, 11, 31, 23, 59, 59), now.getTime())).toISOString();
  const c = (await gql(CAL, { login: USER, from, to })).user.contributionsCollection.contributionCalendar;
  for (const w of c.weeks) for (const d of w.contributionDays) days.set(d.date, d.contributionCount);
}
const dates = [...days.keys()].sort();
const allTime = dates.reduce((s, d) => s + days.get(d), 0);

let longest = 0, run = 0;
for (const d of dates) {
  run = days.get(d) > 0 ? run + 1 : 0;
  longest = Math.max(longest, run);
}
// Current streak: today may still be empty, so start from yesterday in that case.
let current = 0;
let i = dates.length - 1;
if (i >= 0 && days.get(dates[i]) === 0) i--;
for (; i >= 0 && days.get(dates[i]) > 0; i--) current++;
const activeDays = dates.filter((d) => days.get(d) > 0).length;

// ---- draw ----
const C = {
  bg: "#070a09", panel: "#0e1310", panel2: "#121814", border: "#202c26",
  text: "#e1f0e8", muted: "#7a8f84", green: "#2dd49a", amber: "#f5b84a",
  // Five-step ramp, empty → hottest, same as the portfolio's Source Activity.
  cells: ["#16201b", "#0f4a36", "#138060", "#1fae80", "#2dd49a"],
};
const MONO = "'JetBrains Mono',ui-monospace,SFMono-Regular,Consolas,Menlo,monospace";
const DISP = "'Space Grotesk','Segoe UI',Inter,Helvetica,Arial,sans-serif";
const fmt = (n) => n.toLocaleString("en-US");

const counts = weeks.flatMap((w) => w.contributionDays.map((d) => d.contributionCount)).filter((n) => n > 0).sort((a, b) => a - b);
const q = (p) => counts[Math.floor((counts.length - 1) * p)] ?? 1;
const cuts = [q(0.25), q(0.5), q(0.8)];
const level = (n) => (n === 0 ? 0 : n <= cuts[0] ? 1 : n <= cuts[1] ? 2 : n <= cuts[2] ? 3 : 4);

const W = 880, CELL = 12, GAP = 3, GX = 62, GY = 92;
let grid = "", months = "";
weeks.forEach((w, wi) => {
  const x = GX + wi * (CELL + GAP);
  w.contributionDays.forEach((d) => {
    const dow = new Date(d.date + "T00:00:00Z").getUTCDay();
    const y = GY + dow * (CELL + GAP);
    grid += `<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="2" fill="${C.cells[level(d.contributionCount)]}"><title>${d.date}: ${d.contributionCount}</title></rect>`;
  });
  // Label a month at the column where its 1st falls, so a partial first
  // week never crowds the next label.
  const firstOfMonth = w.contributionDays.find((d) => d.date.endsWith("-01"));
  if (firstOfMonth && wi < weeks.length - 2) {
    const m = Number(firstOfMonth.date.slice(5, 7)) - 1;
    months += `<text x="${x}" y="${GY - 10}">${"Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ")[m]}</text>`;
  }
});
const gridBottom = GY + 7 * (CELL + GAP) - GAP;

const stat = (x, label, value, sub, hot = false) => `
  <g transform="translate(${x} ${gridBottom + 34})">
    <text class="lbl" y="0">${label}</text>
    <text y="32" style="font-family:${DISP};font-size:28px;font-weight:700;letter-spacing:-0.5px;fill:${hot ? C.green : C.text}">${value}</text>
    <text class="sub" y="52">${sub}</text>
  </g>`;
const H = gridBottom + 124;
const legend = C.cells.map((c, k) => `<rect x="${W - 120 + k * 15}" y="${gridBottom + 14}" width="11" height="11" rx="2" fill="${c}"/>`).join("");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${USER} contribution activity">
  <defs>
    <pattern id="bp" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M24 0H0V24" fill="none" stroke="${C.border}" stroke-width="0.6" opacity="0.55"/></pattern>
  </defs>
  <style>
    text{font-family:${MONO};fill:${C.muted};font-size:11px}
    .lbl{letter-spacing:2px;font-size:10.5px}
    .sub{font-size:10.5px}
    @keyframes blink{0%,100%{opacity:1}50%{opacity:.25}}
    .dot{animation:blink 2.4s ease-in-out infinite}
  </style>
  <rect width="${W}" height="${H}" rx="10" fill="${C.bg}"/>
  <rect width="${W}" height="${H}" rx="10" fill="url(#bp)"/>
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="10" fill="none" stroke="${C.border}"/>
  <path d="M1 14V1H14M${W - 14} 1H${W - 1}V14M${W - 1} ${H - 14}V${H - 1}H${W - 14}M14 ${H - 1}H1V${H - 14}" fill="none" stroke="${C.green}" stroke-opacity="0.55" stroke-width="1.5"/>

  <circle class="dot" cx="30" cy="34" r="4" fill="${C.green}"/>
  <text class="lbl" x="44" y="38">CONTRIBUTION SIGNAL</text>
  <text class="lbl" x="${W - 28}" y="38" text-anchor="end" fill="${C.green}">@${USER.toUpperCase()} · LAST 12 MONTHS</text>
  <line x1="28" y1="54" x2="${W - 28}" y2="54" stroke="${C.border}"/>

  <g>${months}</g>
  <text x="28" y="${GY + 1 * (CELL + GAP) + 10}">Mon</text>
  <text x="28" y="${GY + 3 * (CELL + GAP) + 10}">Wed</text>
  <text x="28" y="${GY + 5 * (CELL + GAP) + 10}">Fri</text>
  ${grid}
  <text x="${W - 128}" y="${gridBottom + 23}" text-anchor="end">less</text>${legend}<text x="${W - 42}" y="${gridBottom + 23}">more</text>

  ${stat(28, "LAST 12 MONTHS", fmt(yearTotal), "contributions")}
  ${stat(248, "ALL TIME", fmt(allTime), `since ${first}`)}
  ${stat(468, "CURRENT STREAK", `${current}d`, current > 0 ? "● live" : "resting", current > 0)}
  ${stat(688, "LONGEST STREAK", `${longest}d`, `${fmt(activeDays)} active days`)}
</svg>
`;
writeFileSync(new URL("../activity.svg", import.meta.url), svg);
console.log(`activity.svg · ${yearTotal} last 12m · ${allTime} all-time · streak ${current}/${longest}`);
