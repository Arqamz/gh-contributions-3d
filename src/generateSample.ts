import * as fs from "fs";
import * as path from "path";
import { GraphSvgGenerator, GraphConfig, resolveViewAngle } from "./graph.js";
import { parseArgs, pickFlag } from "./cli.js";
import {
  generateSampleContributions,
  summarizeContributions,
  SamplePattern,
} from "./sampleData.js";

// One SVG per pattern so the terrain renderer can be observed across very
// different height distributions. A *fixed* heightReference is used (instead of
// auto-fit) so absolute height is comparable: "tall" towers, "flat" stays low.
const PATTERNS: SamplePattern[] = [
  "realistic",
  "tall",
  "flat",
  "high-low",
  "weekdays",
  "weekends",
];
const HEIGHT_REFERENCE = 20;

function main() {
  // Options: `bun run sample [name] [--angle <preset|number>] [--smoothness <0..1>]`
  //   --angle/-a/-view : low | medium | high | top, or a raw rowRise number
  //   --smoothness/-s  : 0 (sharp low-poly) .. 1 (smooth rolling hills)
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const userName = positional[0] || "SampleUser";
  const smoothnessArg = pickFlag(flags, "smoothness", "s");
  const smoothness =
    smoothnessArg !== undefined ? Number(smoothnessArg) : undefined;
  if (
    smoothness !== undefined &&
    (Number.isNaN(smoothness) || smoothness < 0 || smoothness > 1)
  ) {
    console.error(
      `Error: --smoothness must be a number in 0..1 (got "${smoothnessArg}")`,
    );
    process.exit(1);
  }
  const angle = resolveViewAngle(pickFlag(flags, "angle", "view", "a"));

  const outDir = path.resolve(process.cwd(), "assets");
  fs.mkdirSync(outDir, { recursive: true });

  console.log("Generating sample terrains...");
  if (smoothness !== undefined) {
    console.log(`Smoothness override: ${smoothness}`);
  }

  for (const pattern of PATTERNS) {
    const contributions = generateSampleContributions({
      pattern,
      weeks: 52,
      seed: 42,
    });
    const overrides: Partial<typeof GraphConfig> = {
      mode: "terrain",
      heightReference: HEIGHT_REFERENCE,
      ...angle,
    };
    if (smoothness !== undefined && !Number.isNaN(smoothness)) {
      overrides.smoothness = smoothness;
    }
    const svg = new GraphSvgGenerator(overrides).generateSvg(
      contributions,
      `${userName} · ${pattern}`,
    );
    const outPath = path.join(outDir, `sample-${pattern}.svg`);
    fs.writeFileSync(outPath, svg, "utf-8");
    const kb = (fs.statSync(outPath).size / 1024).toFixed(0);
    console.log(
      `  ${pattern.padEnd(11)} ${summarizeContributions(contributions)}  -> ${outPath} (${kb} KB)`,
    );
  }
}

main();
