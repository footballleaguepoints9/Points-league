/* Fetches the current Premier League table and writes site/standings.json.
 *
 * EVERYTHING YOU MIGHT WANT TO CHANGE IS IN THE ROSTERS BLOCK BELOW.
 *
 *   name   — the short name shown above the big number
 *   label  — the heading above that person's list of clubs
 *   teams  — enough of each club's name to identify it
 *
 * Use straight quotes ("), not curly ones. If your phone keyboard changes
 * them, turn off smart punctuation before editing.
 */

const ROSTERS = {
  mine: {
    name: "Jeremy",
    label: "Jeremy's five",
    teams: ["Arsenal", "Leeds", "Brighton", "Chelsea", "Manchester United"]
  },
  dads: {
    name: "Dad",
    label: "Dad's five",
    teams: ["Manchester City", "Tottenham", "Liverpool", "Aston Villa", "Newcastle"]
  }
};

/* ================= nothing below here needs editing ================= */

const fs = require("fs");
const path = require("path");

const TOKEN = process.env.FOOTBALL_DATA_TOKEN;
const GUARDIAN_KEY = process.env.GUARDIAN_KEY; // optional — adds match report links
const BASE = "https://api.football-data.org/v4/competitions/PL";

/* Extra ways a club might be written in a newspaper headline. */
const ALIASES = {
  "Manchester United": ["Man Utd", "Man United"],
  "Manchester City": ["Man City"],
  "Tottenham": ["Spurs"],
  "Brighton": ["Brighton & Hove Albion", "Brighton and Hove Albion"],
  "Wolverhampton": ["Wolves"],
  "Nottingham Forest": ["Forest"],
  "Aston Villa": ["Villa"],
  "Newcastle": ["Newcastle United"],
  "Leeds": ["Leeds United"],
  "West Ham": ["West Ham United"]
};

async function api(url) {
  const res = await fetch(url, { headers: { "X-Auth-Token": TOKEN } });
  if (!res.ok) {
    throw new Error(`football-data.org returned ${res.status} ${res.statusText}`);
  }
  return res.json();
}

/* ---------- match reports (optional, needs a free Guardian key) ---------- */

/* Club names arrive as full legal names ("Arsenal FC", "AFC Bournemouth").
 * Newspapers never write them that way, so build a list of plausible forms. */

/* Bare first words that would be ambiguous between two clubs. */
const AMBIGUOUS = ["manchester", "sheffield", "bristol", "west", "north"];

/* Trailing words that papers routinely drop ("Coventry City" -> "Coventry"). */
const DROPPABLE = "United|City|Town|Albion|Hotspur|Wanderers|Rovers|Athletic|County|Forest";

function stripCorporate(name) {
  return name
    .replace(/^A\.?F\.?C\.?\s+/i, "")
    .replace(/\s+A\.?F\.?C\.?$/i, "")
    .replace(/\s+F\.?C\.?$/i, "")
    .trim();
}

function nameKeys(team) {
  const out = new Set();
  const full = team.name || "";
  const short = team.shortName || "";

  [full, short].forEach(function (n) {
    if (!n) return;
    const base = stripCorporate(n);
    if (base) out.add(base);

    const m = base.match(new RegExp("^(.*?)\\s+(" + DROPPABLE + ")$", "i"));
    if (m) {
      const head = m[1].trim();
      if (head.length >= 4 && AMBIGUOUS.indexOf(head.toLowerCase()) === -1) {
        out.add(head);
      }
    }
  });

  Object.keys(ALIASES).forEach(function (base) {
    if (full.toLowerCase().indexOf(base.toLowerCase()) !== -1) {
      out.add(base);
      ALIASES[base].forEach(function (a) { out.add(a); });
    }
  });

  return Array.from(out);
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* Match against the headline AND the article URL slug — Guardian match report
 * URLs usually contain both club names, which is more reliable than a headline. */
function mentions(report, team) {
  const haystack = (
    (report.headline || "") + " " + (report.url || "").replace(/[^a-z0-9]+/gi, " ")
  ).toLowerCase();

  return nameKeys(team).some(function (k) {
    const norm = k.replace(/[^a-z0-9]+/gi, " ").trim().toLowerCase();
    if (!norm) return false;
    return new RegExp("\\b" + escapeRe(norm) + "\\b").test(haystack);
  });
}

/* Warnings are shown on the page, so each distinct problem is reported once
 * however many matchweeks hit it. */
const seenWarnings = {};
function warnOnce(warnings, message) {
  if (seenWarnings[message]) return;
  seenWarnings[message] = true;
  warnings.push(message);
}

async function fetchReports(fromDate, toDate, warnings, week) {
  const tag = "MW" + week + ": ";

  if (!GUARDIAN_KEY) {
    warnOnce(
      warnings,
      "GUARDIAN_KEY is not set, so no match report links. Add it as a repository " +
      "secret and pass it through in publish.yml."
    );
    console.log("Guardian: no key present — skipping report lookup.");
    return [];
  }

  const url =
    "https://content.guardianapis.com/search" +
    "?section=football&tag=tone/matchreports" +
    "&from-date=" + fromDate + "&to-date=" + toDate +
    "&page-size=50&show-fields=headline" +
    "&api-key=" + GUARDIAN_KEY;

  console.log(tag + "searching Guardian match reports " + fromDate + " to " + toDate);

  try {
    const res = await fetch(url);
    if (!res.ok) {
      const detail =
        res.status === 401 || res.status === 403
          ? "the key was rejected — check it was copied in full"
          : res.status === 429
          ? "daily quota reached"
          : res.statusText;
      warnOnce(warnings, "Guardian returned " + res.status + " (" + detail + ").");
      console.warn(tag + "Guardian HTTP " + res.status + " — " + detail);
      return [];
    }

    const json = await res.json();
    const results = json.response && json.response.results ? json.response.results : [];
    console.log(tag + results.length + " match reports returned.");

    return results.map(function (r) {
      return {
        headline: (r.fields && r.fields.headline) || r.webTitle || "",
        url: r.webUrl
      };
    });
  } catch (err) {
    warnOnce(warnings, "Guardian lookup failed: " + err.message);
    console.warn(tag + "Guardian lookup skipped:", err.message);
    return [];
  }
}

/* ---------- the generated result sentence ---------- */

function capital(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function summarise(club, opponent, isHome, gf, ga) {
  const where = isHome ? "at home to " + opponent : "away at " + opponent;
  const margin = Math.abs(gf - ga);

  if (gf > ga) {
    const how =
      margin >= 3 ? "They ran away with it." :
      margin === 2 ? "Comfortable enough in the end." :
      "They edged it.";
    return club + " won " + gf + "\u2013" + ga + " " + where + ". " + how + " Three points.";
  }
  if (gf < ga) {
    const how =
      margin >= 3 ? "A heavy afternoon." :
      margin === 2 ? "Never really in it." :
      "A narrow one to lose.";
    return club + " lost " + gf + "\u2013" + ga + " " + where + ". " + how + " No points.";
  }
  const how = gf === 0 ? "Goalless." : capital(gf + " apiece.");
  return club + " drew " + gf + "\u2013" + ga + " " + where + ". " + how + " One point.";
}

/* ---------------------------- main ---------------------------- */

async function main() {
  if (!TOKEN) {
    throw new Error("No API token found. Add FOOTBALL_DATA_TOKEN as a repository secret.");
  }

  const data = await api(BASE + "/standings");

  const table = (data.standings || [])
    .filter(function (s) { return s.type === "TOTAL"; })
    .flatMap(function (s) { return s.table || []; });

  if (table.length === 0) {
    throw new Error("The API response contained no league table.");
  }

  function find(keyword) {
    const needle = keyword.toLowerCase();
    return table.find(function (row) {
      const n = row.team && row.team.name ? row.team.name : "";
      return n.toLowerCase().indexOf(needle) !== -1;
    });
  }

  const sides = {};
  const warnings = [];
  const clubOwner = {}; // football-data team id -> { side, club }

  for (const key of Object.keys(ROSTERS)) {
    const roster = ROSTERS[key];
    const teams = roster.teams.map(function (keyword) {
      const row = find(keyword);
      if (!row) {
        warnings.push("Not in this season's Premier League: " + keyword);
        return { club: keyword, played: 0, won: 0, drawn: 0, points: 0, inLeague: false };
      }
      const club = row.team.shortName || row.team.name;
      clubOwner[row.team.id] = { side: key, club: club };
      return {
        club: club,
        played: row.playedGames || 0,
        won: row.won || 0,
        drawn: row.draw || 0,
        points: row.points || 0,
        position: row.position || null,
        inLeague: true
      };
    });

    sides[key] = {
      name: roster.name,
      label: roster.label,
      teams: teams,
      total: teams.reduce(function (sum, t) { return sum + t.points; }, 0)
    };
  }

  /* ---- every completed matchweek, newest first ---- */
  let recap = null;
  try {
    const played = await api(BASE + "/matches?status=FINISHED");
    const finished = played.matches || [];

    /* Group finished matches by matchday. */
    const byWeek = {};
    for (const m of finished) {
      const wk = m.matchday || 0;
      if (!wk) continue;
      if (!byWeek[wk]) byWeek[wk] = [];
      byWeek[wk].push(m);
    }

    const weekNumbers = Object.keys(byWeek)
      .map(Number)
      .sort(function (a, b) { return b - a; }); // newest first

    const weeks = [];

    for (const wk of weekNumbers) {
      const weekMatches = byWeek[wk];

      /* Skip any week in which none of the ten clubs played. */
      const relevant = weekMatches.filter(function (m) {
        return clubOwner[m.homeTeam.id] || clubOwner[m.awayTeam.id];
      });
      if (relevant.length === 0) continue;

      const dates = weekMatches.map(function (m) { return m.utcDate.slice(0, 10); }).sort();
      const reports = await fetchReports(dates[0], dates[dates.length - 1], warnings, wk);

      const entries = [];
      for (const m of relevant) {
        const homeOwner = clubOwner[m.homeTeam.id];
        const awayOwner = clubOwner[m.awayTeam.id];

        const hg = m.score.fullTime.home;
        const ag = m.score.fullTime.away;
        const homeShort = m.homeTeam.shortName || m.homeTeam.name;
        const awayShort = m.awayTeam.shortName || m.awayTeam.name;

        const report = reports.find(function (r) {
          return mentions(r, m.homeTeam) && mentions(r, m.awayTeam);
        });

        if (!report && reports.length) {
          console.log("MW" + wk + " no report matched: " + homeShort + " v " + awayShort);
        }

        const pair = [[homeOwner, true], [awayOwner, false]];
        for (const item of pair) {
          const owner = item[0];
          const isHome = item[1];
          if (!owner) continue;

          const gf = isHome ? hg : ag;
          const ga = isHome ? ag : hg;
          const opponent = isHome ? awayShort : homeShort;

          entries.push({
            side: owner.side,
            club: owner.club,
            opponent: opponent,
            home: isHome,
            fixture: homeShort + " " + hg + "\u2013" + ag + " " + awayShort,
            date: m.utcDate,
            points: gf > ga ? 3 : (gf === ga ? 1 : 0),
            summary: summarise(owner.club, opponent, isHome, gf, ga),
            reportHeadline: report ? report.headline : null,
            reportUrl: report ? report.url : null
          });
        }
      }

      entries.sort(function (a, b) { return new Date(a.date) - new Date(b.date); });

      /* Points each side earned in this week alone. */
      const totals = { mine: 0, dads: 0 };
      entries.forEach(function (e) { totals[e.side] += e.points; });

      weeks.push({
        matchday: wk,
        entries: entries,
        totals: totals,
        hasReports: reports.length > 0
      });
    }

    if (weeks.length) {
      recap = { latest: weeks[0].matchday, weeks: weeks };
    }
  } catch (err) {
    warnings.push("Recaps unavailable: " + err.message);
  }

  const season = data.season || {};
  const startYear = season.startDate ? season.startDate.slice(0, 4) : "";
  const endYear = season.endDate ? season.endDate.slice(2, 4) : "";

  const output = {
    updated: new Date().toISOString(),
    season: startYear && endYear ? startYear + "/" + endYear : "",
    matchday: season.currentMatchday || null,
    sides: sides,
    recap: recap,
    warnings: warnings
  };

  const outDir = path.join(__dirname, "site");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "standings.json"), JSON.stringify(output, null, 2));

  let recapNote = "";
  if (recap && recap.weeks && recap.weeks.length) {
    const totalEntries = recap.weeks.reduce(function (n, w) { return n + w.entries.length; }, 0);
    recapNote =
      "\nRecap: " + recap.weeks.length + " matchweek(s), " +
      totalEntries + " entries, latest is MW" + recap.latest;
  }

  console.log(
    "Wrote standings.json \u2014 " + sides.mine.total + " to " + sides.dads.total +
      recapNote +
      (warnings.length ? "\nWarnings:\n  " + warnings.join("\n  ") : "")
  );
}

main().catch(function (err) {
  console.error("Update failed:", err.message);
  process.exit(1);
});
