// Repo mode data source: instead of a user's GitHub contribution calendar, read
// a single repository's own commit history from the local git checkout and turn
// it into the same day-grid the terrain renderer consumes. Each day is coloured
// by its most active committer, so a busy multi-author repo renders as a
// rainbow of contributor-tinted mountains (single-author repos stay green — the
// caller decides that by inspecting `authors.length`).

import { execFileSync } from "node:child_process";
import * as path from "node:path";
import { DayContribution } from "./types.js";

/** One raw commit as read from `git log` (author date + identity). */
export interface RepoCommit {
  iso: string; // strict ISO-8601 author date (%aI)
  email: string; // lower-cased author email (%ae) — the identity key
  name: string; // author display name (%an)
}

/** A contributor, after aggregation, ranked by total commits in the window. */
export interface AuthorInfo {
  id: string; // identity key (email, or name when email is empty)
  label: string; // display name for the legend
  color: string; // assigned swatch colour (hex)
  commits: number; // total commits in the window
}

export interface RepoContributions {
  contributions: DayContribution[];
  authors: AuthorInfo[]; // ranked, most commits first
  authorColors: Record<string, string>; // id -> hex, handed to the renderer
  repoName: string; // "owner/repo" or a best-effort local name
  totalCommits: number; // commits counted inside the window
}

// git log field delimiter: the ASCII unit separator never appears in emails or
// names, so it is a safe split token even for names containing spaces/commas.
const US = "\x1f";

/**
 * Read commits from the git repo at `cwd`. `sinceISO` is passed to `--since`
 * so large repos don't dump their entire history; anything outside the calendar
 * window is dropped again during aggregation (git's `--since` filters on commit
 * date, which can differ slightly from the author date we bucket by).
 *
 * Merge commits are excluded (`--no-merges`): they are usually automated and
 * would inflate whoever pressed "merge" rather than reflect authored work.
 */
export function readRepoCommits(
  sinceISO?: string,
  cwd = process.cwd(),
): RepoCommit[] {
  const args = ["log", "--no-merges", `--pretty=format:%aI${US}%ae${US}%an`];
  if (sinceISO) args.push(`--since=${sinceISO}`);

  let out: string;
  try {
    out = execFileSync("git", args, {
      cwd,
      encoding: "utf-8",
      maxBuffer: 512 * 1024 * 1024,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Could not read git history in "${cwd}". Is it a git repository with commits? (${msg})`,
    );
  }

  const commits: RepoCommit[] = [];
  for (const line of out.split("\n")) {
    if (!line) continue;
    const [iso, email, name] = line.split(US);
    if (!iso) continue;
    const cleanEmail = (email ?? "").trim().toLowerCase();
    const cleanName = (name ?? "").trim();
    commits.push({
      iso,
      email: cleanEmail,
      name: cleanName || cleanEmail || "unknown",
    });
  }
  return commits;
}

interface Calendar {
  start: Date; // a Sunday, UTC midnight — grid column 0
  weeks: number; // number of week columns
}

/**
 * A GitHub-style trailing calendar: `weeksBack` weeks ending today, snapped
 * back to the Sunday that starts the earliest week. Mirrors the contribution
 * graph so repo mode reuses the same 7×N grid and stays a sane width.
 */
function buildCalendar(weeksBack: number, today: Date): Calendar {
  const end = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
  );
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - weeksBack * 7);
  start.setUTCDate(start.getUTCDate() - start.getUTCDay()); // back to Sunday
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000);
  return { start, weeks: Math.floor(days / 7) + 1 };
}

const DAY_MS = 86_400_000;

/** Locate a commit's (weekIndex, weekday) in the calendar, or null if outside. */
function dayCell(
  start: Date,
  weeks: number,
  iso: string,
): { weekIndex: number; weekday: number } | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const diff = Math.round((day - start.getTime()) / DAY_MS);
  if (diff < 0) return null;
  const weekIndex = Math.floor(diff / 7);
  if (weekIndex >= weeks) return null; // commit dated after the window
  return { weekIndex, weekday: diff % 7 };
}

// Golden-angle hue spread: consecutive ranks land ~137.5° apart on the colour
// wheel, so even the top handful of contributors get maximally distinct hues
// (a true rainbow) rather than the near-neighbours a plain hash can produce.
// Colours are assigned by commit rank, so they are deterministic for a given
// commit set. To make a contributor's colour stable across rank changes instead,
// swap the `i` here for a hash of `id` — this is the single knob for that.
function hueForRank(i: number): string {
  const hue = (i * 137.508) % 360;
  return hslToHex(hue, 0.62, 0.5);
}

function hslToHex(h: number, s: number, l: number): string {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0,
    g = 0,
    b = 0;
  if (h < 60) [r, g] = [c, x];
  else if (h < 120) [r, g] = [x, c];
  else if (h < 180) [g, b] = [c, x];
  else if (h < 240) [g, b] = [x, c];
  else if (h < 300) [r, b] = [x, c];
  else [r, b] = [c, x];
  const to = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

/** Best-effort "owner/repo" (or local folder name) for the SVG subtitle. */
function detectRepoName(cwd: string): string {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  try {
    const url = execFileSync("git", ["config", "--get", "remote.origin.url"], {
      cwd,
      encoding: "utf-8",
    }).trim();
    if (url) {
      const parts = url.replace(/\.git$/, "").split(/[/:]/);
      return parts.slice(-2).join("/");
    }
  } catch {
    // no remote configured — fall through to the folder name
  }
  return path.basename(path.resolve(cwd));
}

/**
 * Full repo-mode pipeline: read git history, bucket commits into the trailing
 * calendar, pick each day's top committer, and assign contributor colours.
 */
export function buildRepoContributions(
  opts: { weeksBack?: number; cwd?: string; today?: Date } = {},
): RepoContributions {
  const { weeksBack = 52, cwd = process.cwd(), today = new Date() } = opts;
  const cal = buildCalendar(weeksBack, today);
  const commits = readRepoCommits(cal.start.toISOString(), cwd);

  // Per-day author counts, keyed "weekIndex:weekday".
  const dayAuthors = new Map<string, Map<string, number>>();
  const authorTotals = new Map<string, number>();
  // For each id, tally the display names seen so the legend shows the common one.
  const authorNames = new Map<string, Map<string, number>>();
  let totalCommits = 0;

  for (const c of commits) {
    const cell = dayCell(cal.start, cal.weeks, c.iso);
    if (!cell) continue;
    const id = c.email || c.name.toLowerCase();
    const key = `${cell.weekIndex}:${cell.weekday}`;

    const perDay = dayAuthors.get(key) ?? new Map<string, number>();
    perDay.set(id, (perDay.get(id) ?? 0) + 1);
    dayAuthors.set(key, perDay);

    authorTotals.set(id, (authorTotals.get(id) ?? 0) + 1);

    const names = authorNames.get(id) ?? new Map<string, number>();
    names.set(c.name, (names.get(c.name) ?? 0) + 1);
    authorNames.set(id, names);

    totalCommits++;
  }

  // Build a DayContribution for every cell in the grid (empty days included so
  // the grid stays a full 7×weeks rectangle, matching the calendar renderer).
  const contributions: DayContribution[] = [];
  for (let wi = 0; wi < cal.weeks; wi++) {
    for (let wd = 0; wd < 7; wd++) {
      const perDay = dayAuthors.get(`${wi}:${wd}`);
      let count = 0;
      let top: string | undefined;
      let best = -1;
      if (perDay) {
        for (const [id, n] of perDay) {
          count += n;
          // Most commits wins; ties broken by smallest id for determinism.
          if (n > best || (n === best && (top === undefined || id < top))) {
            best = n;
            top = id;
          }
        }
      }
      const d = new Date(cal.start);
      d.setUTCDate(d.getUTCDate() + wi * 7 + wd);
      contributions.push({
        date: d.toISOString().slice(0, 10),
        count,
        weekday: wd,
        weekIndex: wi,
        topAuthor: top,
      });
    }
  }

  // Rank contributors and assign colours.
  const ranked = [...authorTotals.entries()].sort(
    (a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1),
  );
  const authors: AuthorInfo[] = ranked.map(([id, commitCount], i) => {
    const names = authorNames.get(id);
    let label = id;
    if (names) {
      let bestN = -1;
      for (const [name, n] of names) {
        if (name && n > bestN) {
          bestN = n;
          label = name;
        }
      }
    }
    return { id, label, color: hueForRank(i), commits: commitCount };
  });
  const authorColors: Record<string, string> = {};
  for (const a of authors) authorColors[a.id] = a.color;

  return {
    contributions,
    authors,
    authorColors,
    repoName: detectRepoName(cwd),
    totalCommits,
  };
}
