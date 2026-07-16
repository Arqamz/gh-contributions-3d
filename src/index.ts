import * as fs from "fs";
import * as path from "path";
import { retrieveContributionData } from "./fetchContributions.js";
import { GraphSvgGenerator, GraphMode } from "./graph.js";
import { DayContribution, GithubApiResponse } from "./types.js";

function toDayContributions(data: GithubApiResponse): DayContribution[] {
  const weeks =
    data.data.user.contributionsCollection.contributionCalendar.weeks;
  const out: DayContribution[] = [];
  weeks.forEach((week, weekIndex) => {
    week.contributionDays.forEach((d) => {
      const weekday = new Date(d.date).getUTCDay();
      out.push({
        date: d.date,
        count: d.contributionCount,
        weekday,
        weekIndex,
      });
    });
  });
  return out;
}

async function main() {
  const userName = process.argv[2];
  const mode = (process.argv[3] as GraphMode) || "terrain";
  const token = process.env.TOKEN_GITHUB;

  if (!userName) {
    console.error("Usage: bun run dev <github_username> [terrain|columns]");
    process.exit(1);
  }
  if (!token) {
    console.error("Error: TOKEN_GITHUB environment variable is not set.");
    process.exit(1);
  }
  if (mode !== "columns" && mode !== "terrain") {
    console.error(`Error: unknown mode "${mode}" (use columns or terrain)`);
    process.exit(1);
  }

  try {
    console.log(`Fetching contributions for ${userName}...`);
    const data = await retrieveContributionData(userName, token);
    const contributions = toDayContributions(data);
    const total =
      data.data.user.contributionsCollection.contributionCalendar
        .totalContributions;
    console.log(`Total contributions: ${total}`);

    const svg = new GraphSvgGenerator({ mode }).generateSvg(
      contributions,
      userName,
    );

    const outDir = path.resolve(process.cwd(), "assets");
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, `${userName}-${mode}.svg`);
    fs.writeFileSync(outPath, svg, "utf-8");
    console.log(`SVG (${mode}) saved to: ${outPath}`);
  } catch (error) {
    console.error(
      `Error: ${error instanceof Error ? error.message : "unknown error"}`,
    );
    process.exit(1);
  }
}

main();
