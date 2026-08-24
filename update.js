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
const API = "https://api.football-data.org/v4/competitions/PL/standings";

async function main() {
  if (!TOKEN) {
    throw new Error(
      "No API token found. Add FOOTBALL_DATA_TOKEN as a repository secret."
    );
  }

  const res = await fetch(API, { headers: { "X-Auth-Token": TOKEN } });
  if (!res.ok) {
    throw new Error(`football-data.org returned ${res.status} ${res.statusText}`);
  }
  const data = await res.json();

  const table = (data.standings || [])
    .filter((s) => s.type === "TOTAL")
    .flatMap((s) => s.table || []);

  if (table.length === 0) {
    throw new Error("The API response contained no league table.");
  }

  function find(keyword) {
    const needle = keyword.toLowerCase();
    return table.find((row) =>
      (row.team && row.team.name ? row.team.name : "").toLowerCase().includes(needle)
    );
  }

  const sides = {};
  const warnings = [];

  for (const key of Object.keys(ROSTERS)) {
    const roster = ROSTERS[key];
    const teams = roster.teams.map((keyword) => {
      const row = find(keyword);
      if (!row) {
        warnings.push(`Not in this season's Premier League: ${keyword}`);
        return { club: keyword, played: 0, won: 0, drawn: 0, points: 0, inLeague: false };
      }
      return {
        club: row.team.shortName || row.team.name,
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
      teams,
      total: teams.reduce((sum, t) => sum + t.points, 0)
    };
  }

  const season = data.season || {};
  const startYear = season.startDate ? season.startDate.slice(0, 4) : "";
  const endYear = season.endDate ? season.endDate.slice(2, 4) : "";

  const output = {
    updated: new Date().toISOString(),
    season: startYear && endYear ? `${startYear}/${endYear}` : "",
    matchday: season.currentMatchday || null,
    sides,
    warnings
  };

  const outDir = path.join(__dirname, "site");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, "standings.json"),
    JSON.stringify(output, null, 2)
  );

  console.log(
    `Wrote standings.json — ${sides.mine.total} to ${sides.dads.total}` +
      (warnings.length ? `\nWarnings:\n  ${warnings.join("\n  ")}` : "")
  );
}

main().catch((err) => {
  console.error("Update failed:", err.message);
  process.exit(1);
});
