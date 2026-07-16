import * as fs from "fs";
import * as path from "path";
import { GraphSvgGenerator, GraphConfig } from "./graph.js";
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
  const userName = process.argv[2] || "SampleUser";
  // Optional: `bun run sample <name> <smoothness 0..1>` to sweep sharpness.
  const smoothnessArg = process.argv[3];
  const smoothness =
    smoothnessArg !== undefined ? Number(smoothnessArg) : undefined;

  const outDir = path.resolve(process.cwd(), "assets");
  fs.mkdirSync(outDir, { recursive: true });

  console.log("Generating sample terrains...");
  if (smoothness !== undefined && !Number.isNaN(smoothness)) {
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
