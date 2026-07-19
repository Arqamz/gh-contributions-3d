import * as fs from "fs";
import * as path from "path";
import { retrieveContributionData } from "./fetchContributions.js";
import { GraphSvgGenerator, GraphMode, resolveViewAngle } from "./graph.js";
import { parseArgs, pickFlag } from "./cli.js";
import { DayContribution, GithubApiResponse } from "./types.js";

const USAGE = `Usage: bun run dev <github_username> [options]

Options:
  -a, --angle <preset|number>   viewing angle: low | medium | high | top,
                                or a raw rowRise number (default: medium)
  -s, --smoothness <0..1>       triangle sharpness: 0 = sharp low-poly,
                                1 = smooth rolling hills (default: 1)
  -m, --mode <terrain|columns>  render style (default: terrain)
  -o, --out <path>              write the SVG here instead of
                                assets/<user>-<mode>.svg

Examples:
  bun run dev octocat
  bun run dev octocat --angle high --smoothness 0.4
  bun run dev octocat -m columns -a top
  bun run dev octocat --out profile-3d/terrain.svg`;

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
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const userName = positional[0];
  const mode = (pickFlag(flags, "mode", "m") ?? "terrain") as GraphMode;
  const angle = pickFlag(flags, "angle", "view", "a"); // preset or raw rowRise
  const smoothnessArg = pickFlag(flags, "smoothness", "s"); // 0..1, optional
  const outArg = pickFlag(flags, "out", "o"); // explicit output path, optional
  const token = process.env.TOKEN_GITHUB;

  if (!userName) {
    console.error(USAGE);
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
  const smoothness = smoothnessArg !== undefined ? Number(smoothnessArg) : NaN;
  if (
    smoothnessArg !== undefined &&
    (Number.isNaN(smoothness) || smoothness < 0 || smoothness > 1)
  ) {
    console.error(
      `Error: --smoothness must be a number in 0..1 (got "${smoothnessArg}")`,
    );
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

    const svg = new GraphSvgGenerator({
      mode,
      ...resolveViewAngle(angle),
      ...(Number.isNaN(smoothness) ? {} : { smoothness }),
    }).generateSvg(contributions, userName);

    const outPath = outArg
      ? path.resolve(process.cwd(), outArg)
      : path.join(process.cwd(), "assets", `${userName}-${mode}.svg`);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
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
