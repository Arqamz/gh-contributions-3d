import * as fs from "fs";
import * as path from "path";
import { retrieveContributionData } from "./fetchContributions.js";
import {
  GraphSvgGenerator,
  GraphMode,
  LegendEntry,
  resolveViewAngle,
} from "./graph.js";
import { parseArgs, pickFlag } from "./cli.js";
import { buildRepoContributions } from "./repoCommits.js";
import { DayContribution, GithubApiResponse } from "./types.js";

const USAGE = `Usage: bun run dev <github_username> [options]
       bun run dev --source repo [options]     # this repo's commit history

Options:
  --source <user|repo>          data source: a user's contribution calendar
                                (default) or the local git repo's commits,
                                coloured by each day's top committer
  --repo <path>                 (repo source) path to a local clone to read;
                                defaults to the current directory
  -a, --angle <preset|number>   viewing angle: low | medium | high | top,
                                or a raw rowRise number (default: medium)
  -s, --smoothness <0..1>       triangle sharpness: 0 = sharp low-poly,
                                1 = smooth rolling hills (default: 1)
  -m, --mode <terrain|columns>  render style (default: terrain)
  -o, --out <path>              write the SVG here instead of
                                assets/<name>-<mode>.svg

Examples:
  bun run dev octocat
  bun run dev octocat --angle high --smoothness 0.4
  bun run dev --source repo -a high
  bun run dev --source repo --out profile-3d/repo.svg`;

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

/** Resolve the output path: explicit --out, else assets/<name>-<mode>.svg. */
function resolveOutPath(
  outArg: string | undefined,
  name: string,
  mode: string,
): string {
  if (outArg) return path.resolve(process.cwd(), outArg);
  const safe = name.replace(/[^a-zA-Z0-9._-]+/g, "-");
  return path.join(process.cwd(), "assets", `${safe}-${mode}.svg`);
}

function writeSvg(outPath: string, svg: string, label: string) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, svg, "utf-8");
  console.log(`SVG (${label}) saved to: ${outPath}`);
}

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const source = (pickFlag(flags, "source") ?? "user") as "user" | "repo";
  const repoPath = pickFlag(flags, "repo", "path"); // repo mode: local clone dir
  const mode = (pickFlag(flags, "mode", "m") ?? "terrain") as GraphMode;
  const angle = pickFlag(flags, "angle", "view", "a"); // preset or raw rowRise
  const smoothnessArg = pickFlag(flags, "smoothness", "s"); // 0..1, optional
  const outArg = pickFlag(flags, "out", "o"); // explicit output path, optional

  if (source !== "user" && source !== "repo") {
    console.error(`Error: unknown source "${source}" (use user or repo)`);
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
  const projection = {
    mode,
    ...resolveViewAngle(angle),
    ...(Number.isNaN(smoothness) ? {} : { smoothness }),
  };

  try {
    if (source === "repo") {
      // Track a single repository: read its git history and colour each day by
      // the most active committer. Multi-author repos render as a rainbow; a
      // solo repo keeps the default green ramp. `--repo <path>` points at any
      // local clone; without it, the current working directory is used.
      const cwd = repoPath
        ? path.resolve(process.cwd(), repoPath)
        : process.cwd();
      console.log(`Reading commit history from ${cwd}...`);
      const repo = buildRepoContributions({ cwd });
      console.log(
        `${repo.repoName}: ${repo.totalCommits} commits, ${repo.authors.length} contributor(s)`,
      );
      const colorBy = repo.authors.length > 1 ? "author" : "height";
      const legend: LegendEntry[] =
        colorBy === "author"
          ? repo.authors
              .slice(0, 15)
              .map((a) => ({ label: a.label, color: a.color }))
          : [];

      const svg = new GraphSvgGenerator({
        ...projection,
        colorBy,
        authorColors: repo.authorColors,
      }).generateSvg(repo.contributions, repo.repoName, true, legend);

      writeSvg(
        resolveOutPath(outArg, repo.repoName, mode),
        svg,
        `repo/${mode}`,
      );
      return;
    }

    // Default: a user's GitHub contribution calendar.
    const userName = positional[0];
    const token = process.env.TOKEN_GITHUB;
    if (!userName) {
      console.error(USAGE);
      process.exit(1);
    }
    if (!token) {
      console.error("Error: TOKEN_GITHUB environment variable is not set.");
      process.exit(1);
    }

    console.log(`Fetching contributions for ${userName}...`);
    const data = await retrieveContributionData(userName, token);
    const contributions = toDayContributions(data);
    const total =
      data.data.user.contributionsCollection.contributionCalendar
        .totalContributions;
    console.log(`Total contributions: ${total}`);

    const svg = new GraphSvgGenerator(projection).generateSvg(
      contributions,
      userName,
    );
    writeSvg(resolveOutPath(outArg, userName, mode), svg, mode);
  } catch (error) {
    console.error(
      `Error: ${error instanceof Error ? error.message : "unknown error"}`,
    );
    process.exit(1);
  }
}

main();
