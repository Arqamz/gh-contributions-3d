import * as fs from "fs";
import * as path from "path";
import {
  GraphSvgGenerator,
  GraphConfig,
  VIEW_ANGLES,
  ViewAngle,
} from "./graph.js";
import { generateSampleContributions, SamplePattern } from "./sampleData.js";

// Parameter sweep: render the same sample data at a grid of checkpoints across
// the two knobs the renderer exposes — viewing `angle` and `smoothness` — so the
// combinations can be eyeballed side by side to pick the best-looking defaults.
// `smoothness` runs the triangle facets from sharp low-poly (0.0: few large flat
// facets) to smooth hills (1.0: many fine facets + blur); the checkpoints below
// (0 / 0.33 / 0.66 / 1.0) span subdivision levels 1 .. 3.
//
// One SVG per (pattern, angle, smoothness) is written to assets/sweep/ named
//   <pattern>-<angle>-s<NN>.svg   (NN = smoothness * 100, zero-padded)
// The canonical assets/sample-*.svg are left untouched (those track the chosen
// defaults and feed the README); this dumps the exploration grid separately.
//
// A *fixed* heightReference (matching generateSample.ts) keeps absolute height
// comparable across patterns, so height differences you see are real, not the
// auto-fit rescaling each graph to fill the frame.

// Representative distributions — enough spread to expose how angle/smoothness
// trade off, without rendering the whole sample set at every checkpoint.
const PATTERNS: SamplePattern[] = [
  "realistic",
  "tall",
  "flat",
  "high-low",
  "weekdays",
  "weekends",
];
const ANGLES: ViewAngle[] = ["low", "medium", "high", "top"];
const SMOOTHNESS = [0.0, 0.33, 0.66, 1.0];
const HEIGHT_REFERENCE = 20;

function tag(smoothness: number): string {
  return `s${String(Math.round(smoothness * 100)).padStart(2, "0")}`;
}

function main() {
  const userName = process.argv[2] || "SampleUser";

  const outDir = path.resolve(process.cwd(), "assets", "sweep");
  fs.mkdirSync(outDir, { recursive: true });

  const total = PATTERNS.length * ANGLES.length * SMOOTHNESS.length;
  console.log(
    `Sweeping ${PATTERNS.length} patterns x ${ANGLES.length} angles x ${SMOOTHNESS.length} smoothness = ${total} SVGs -> ${outDir}`,
  );

  let n = 0;
  for (const pattern of PATTERNS) {
    // Same seed/weeks as generateSample.ts so a sweep tile is directly
    // comparable to the canonical sample of the same pattern.
    const contributions = generateSampleContributions({
      pattern,
      weeks: 52,
      seed: 42,
    });
    for (const angle of ANGLES) {
      for (const smoothness of SMOOTHNESS) {
        const overrides: Partial<typeof GraphConfig> = {
          mode: "terrain",
          heightReference: HEIGHT_REFERENCE,
          ...VIEW_ANGLES[angle],
          smoothness,
        };
        const svg = new GraphSvgGenerator(overrides).generateSvg(
          contributions,
          `${userName} · ${pattern} · ${angle} · ${tag(smoothness)}`,
        );
        const name = `${pattern}-${angle}-${tag(smoothness)}.svg`;
        fs.writeFileSync(path.join(outDir, name), svg, "utf-8");
        n++;
      }
    }
    console.log(
      `  ${pattern.padEnd(11)} ${ANGLES.length * SMOOTHNESS.length} checkpoints`,
    );
  }
  console.log(`Done: ${n} SVGs written to ${outDir}`);
}

main();
