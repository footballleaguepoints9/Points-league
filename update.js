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

function nameKeys(clubName) {
  const keys = [clubName];
  for (const base of Object.keys(ALIASES)) {
    if (clubName.toLowerCase().includes(base.toLowerCase())) {
      keys.push(base);
      for (const alias of ALIASES[base]) keys.push(alias);
    }
  }
  return Array.from(new Set(keys));
}

function headlineMentions(headline, clubName) {
  const h = headline.toLowerCase();
  return nameKeys(clubName).some(function (k) {
    return h.indexOf(k.toLowerCase()) !== -1;
  });
}

async function fetchReports(fromDate, toDate, warnings) {
  if (!GUARDIAN_KEY) {
    warnings.push(
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

  console.log("Guardian: searching match reports " + fromDate + " to " + toDate);

  try {
    const res = await fetch(url);
    if (!res.ok) {
      const detail =
        res.status === 401 || res.status === 403
          ? "the key was rejected — check it was copied in full"
          : res.status === 429
          ? "daily quota reached"
          : res.statusText;
      warnings.push("Guardian returned " + res.status + " (" + detail + ").");
      console.warn("Guardian: HTTP " + res.status + " — " + detail);
      return [];
    }

    const json = await res.json();
    const results = json.response && json.response.results ? json.response.results : [];
    console.log("Guardian: " + results.length + " match reports returned.");

    if (results.length === 0) {
      warnings.push("Guardian returned no match reports for " + fromDate + "\u2013" + toDate + ".");
    }

    return results.map(function (r) {
      return {
        headline: (r.fields && r.fields.headline) || r.webTitle || "",
        url: r.webUrl
      };
    });
  } catch (err) {
    warnings.push("Guardian lookup failed: " + err.message);
    console.warn("Guardian lookup skipped:", err.message);
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

  /* ---- last completed matchweek ---- */
  let recap = null;
  try {
    const played = await api(BASE + "/matches?status=FINISHED");
    const finished = played.matches || [];
    const lastWeek = finished.reduce(function (max, m) {
      return Math.max(max, m.matchday || 0);
    }, 0);

    if (lastWeek > 0) {
      const weekMatches = finished.filter(function (m) { return m.matchday === lastWeek; });
      const dates = weekMatches.map(function (m) { return m.utcDate.slice(0, 10); }).sort();
      const reports = await fetchReports(dates[0], dates[dates.length - 1], warnings);

      const entries = [];
      for (const m of weekMatches) {
        const homeOwner = clubOwner[m.homeTeam.id];
        const awayOwner = clubOwner[m.awayTeam.id];
        if (!homeOwner && !awayOwner) continue;

        const hg = m.score.fullTime.home;
        const ag = m.score.fullTime.away;
        const homeShort = m.homeTeam.shortName || m.homeTeam.name;
        const awayShort = m.awayTeam.shortName || m.awayTeam.name;

        const report = reports.find(function (r) {
          return headlineMentions(r.headline, m.homeTeam.name) &&
                 headlineMentions(r.headline, m.awayTeam.name);
        });

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
      recap = { matchday: lastWeek, entries: entries, hasReports: reports.length > 0 };
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

  console.log(
    "Wrote standings.json \u2014 " + sides.mine.total + " to " + sides.dads.total +
      (recap ? "\nRecap: matchweek " + recap.matchday + ", " + recap.entries.length + " entries" : "") +
      (warnings.length ? "\nWarnings:\n  " + warnings.join("\n  ") : "")
  );
}

main().catch(function (err) {
  console.error("Update failed:", err.message);
  process.exit(1);
});
