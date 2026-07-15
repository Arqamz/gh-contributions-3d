import { DayContribution } from "./types.js";

export type SamplePattern =
  | "random"
  | "sparse"
  | "heavy"
  | "weekend-heavy"
  | "realistic"
  | "tall"
  | "flat"
  | "high-low"
  | "weekdays"
  | "weekends";

export interface SampleOptions {
  pattern?: SamplePattern;
  weeks?: number;
  seed?: number;
}

// Seeded random number generator for reproducability
class SeededRandom {
  private seed: number;

  constructor(seed: number) {
    this.seed = seed;
  }

  next(): number {
    this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff;
    return this.seed / 0x7fffffff;
  }

  nextInt(max: number): number {
    return Math.floor(this.next() * max);
  }
}

// Fake GitHub contribution data for testing SVG generation.
export function generateSampleContributions(
  options: SampleOptions = {},
): DayContribution[] {
  const { pattern = "realistic", weeks = 52, seed = 42 } = options;

  const rng = new SeededRandom(seed);
  const contributions: DayContribution[] = [];

  const startDate = new Date("2025-01-20");

  for (let weekIndex = 0; weekIndex < weeks; weekIndex++) {
    for (let weekday = 0; weekday < 7; weekday++) {
      const dayOffset = weekIndex * 7 + weekday;
      const date = new Date(startDate);
      date.setDate(startDate.getDate() + dayOffset);

      const count = generateContributionCount(
        rng,
        pattern,
        weekday,
        weekIndex,
        weeks,
      );

      contributions.push({
        date: date.toISOString().split("T")[0],
        count,
        weekday,
        weekIndex,
      });
    }
  }

  return contributions;
}

function generateContributionCount(
  rng: SeededRandom,
  pattern: string,
  weekday: number,
  weekIndex: number,
  weeks: number,
): number {
  const isWeekend = weekday === 0 || weekday === 6;

  switch (pattern) {
    case "sparse":
      // Very few contributions - 10% chance of 1-3 commits
      return rng.next() < 0.1 ? rng.nextInt(3) + 1 : 0;

    case "heavy":
      // Very active - 80% chance of 1-15 commits
      return rng.next() < 0.8 ? rng.nextInt(15) + 1 : 0;

    case "weekend-heavy":
      // More active on weekends
      if (isWeekend) {
        return rng.next() < 0.7 ? rng.nextInt(10) + 1 : 0;
      }
      return rng.next() < 0.3 ? rng.nextInt(4) + 1 : 0;

    case "random":
      // Completely random distribution
      return rng.next() < 0.5 ? rng.nextInt(12) : 0;

    case "tall":
      // Extremely tall everywhere: high counts every single day.
      return 18 + rng.nextInt(15); // 18-32

    case "flat":
      // Extremely flat everywhere: a uniform, shallow field.
      return 1 + rng.nextInt(2); // 1-2

    case "high-low": {
      // Alternating bands of very high and near-empty weeks.
      const band = Math.floor((weekIndex / Math.max(1, weeks)) * 6);
      if (band % 2 === 0) return 14 + rng.nextInt(12); // 14-25
      return rng.next() < 0.15 ? 1 : 0;
    }

    case "weekdays":
      // Consistent: only weekdays, nothing on weekends.
      return isWeekend ? 0 : 6 + rng.nextInt(10); // 6-15

    case "weekends":
      // Consistent: only weekends, nothing on weekdays.
      return isWeekend ? 6 + rng.nextInt(10) : 0; // 6-15

    case "realistic":
    default: {
      // Realistic pattern: weekdays more active, occasional bursts
      const baseChance = isWeekend ? 0.25 : 0.55;
      const burstChance = rng.next() < 0.05; // 5% chance of burst

      if (burstChance) {
        return rng.nextInt(12) + 5; // Burst: 5-16 commits
      }

      if (rng.next() < baseChance) {
        // Normal contribution day
        const baseCount = isWeekend ? rng.nextInt(4) : rng.nextInt(6) + 1;
        return baseCount;
      }

      return 0;
    }
  }
}

export function summarizeContributions(
  contributions: DayContribution[],
): string {
  const total = contributions.reduce((sum, c) => sum + c.count, 0);
  const daysWithContributions = contributions.filter((c) => c.count > 0).length;
  const maxContributions = Math.max(...contributions.map((c) => c.count));

  return `Total: ${total} contributions, ${daysWithContributions} active days, max ${maxContributions} in a day`;
}
