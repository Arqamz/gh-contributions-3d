import { DayContribution } from "./types.js";

export type GraphMode = "columns" | "terrain";

interface Point2D {
  x: number;
  y: number;
}
interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Configuration for the graph.
 *
 * The projection is a simple *oblique* axonometric map rather than a true
 * isometric one. Weeks run horizontally (like the real GitHub graph), days
 * fan down-and-to-the-left, and height (contribution count) is extruded
 * straight up the screen. Because the day axis carries a horizontal component,
 * rows staircase apart instead of stacking on top of each other, and because
 * height maps to pure vertical screen offset the peaks stay legible — the
 * failure mode of a top-down isometric view where everything looks flat.
 */
export const GraphConfig = {
  mode: "terrain" as GraphMode,

  // Cell footprint / pitch (px in world space)
  step: 18, // distance between cell centers
  cellSize: 15, // column footprint (< step leaves a gap between columns)
  heightScale: 165, // screen px for a full-height peak
  baseHeight: 3, // minimum column height so 1-contribution days read

  // Oblique projection basis (screen px per world unit).
  //   week -> ( step, 0 )                horizontal, weeks stay level
  //   day  -> ( -step*rowShift, step*rowRise )   down-left fan
  //   z    -> ( 0, -1 )                  extrude up
  // rowRise controls how "from the side" the view is (bigger => rows are
  // pushed further apart vertically => heights read more strongly).
  // rowShift controls the leftward fan that keeps rows from overlapping.
  rowRise: 0.9,
  rowShift: 0.34,

  // Terrain smoothing / normalization
  subdiv: 2, // cells per axis to subdivide each day/week into (finer mesh -> room for slopes)
  // 0.0 = sharp, jagged peaks (like the reference); 1.0 = heavily rounded hills.
  // Drives fractional blur passes on the subdivided lattice. Peak *height* is
  // preserved across the range (heights are re-normalized after smoothing), so
  // this trades peak sharpness for slope gentleness without shrinking the terrain.
  smoothness: 0.2,
  maxSmoothPasses: 6, // blur passes at smoothness = 1.0

  // Height normalization. "auto" fits the tallest ~p97 day to a full-height peak
  // (any real graph fills the frame). A number instead scales counts against a
  // fixed reference so absolute height is comparable across graphs — the sample
  // generator sets this so "tall" and "flat" patterns actually look different.
  heightReference: "auto" as number | "auto",
  peakPercentile: 0.97, // the "auto" percentile
  peakClamp: 1.6, // days above the reference may exceed full height by this factor before clamping

  // Lighting (Lambert, terrain only). Height drives the green (pale valleys ->
  // deep peaks) and the facet lines carry the 3D read, so lighting is a soft
  // modifier: enough to shape the facets, not so much it bleaches the greens to
  // near-white (which reads as translucent) or darkens valleys below peaks.
  ambient: 0.62,
  diffuse: 0.34,
  light: { x: -0.4, y: -0.55, z: 0.75 } as Vec3, // from upper-front

  // Terrain solidity: perimeter skirt drops to -baseThickness to close the mesh.
  baseThickness: 8, // px of base "lip" below the flat floor
  skirtBrightness: 0.62, // flat shade for the vertical cliff walls

  // Layout
  padding: 30,
  titleHeight: 50,

  // Colors
  colors: {
    empty: "#ebedf0",
    stroke: "#1b1f24",
    // GitHub green ramp, pale -> dark
    levels: ["#9be9a8", "#40c463", "#30a14e", "#216e39", "#0d4429"],
    // Terrain-specific: a pale flat floor the mountains rise from, and a thin
    // grey facet line stroked on every triangle for the low-poly look.
    terrainFloor: "#c3e4c8",
    mesh: "#5a6268",
  },
  meshStroke: 0.12, // facet line width in terrain mode
  meshOpacity: 0.55, // facet line opacity
  // Height->color easing (terrain). <1 pushes mid-height slopes toward the
  // saturated deep greens sooner, so the surface reads rich rather than pale.
  colorGamma: 0.7,
};

type Config = typeof GraphConfig;

// Fixed per-face brightness for column faces, keyed by which world axis the
// face normal points along. Top is brightest, vertical faces progressively
// darker to sell the volume.
const FACE_BRIGHTNESS = {
  top: 1.0,
  front: 0.68, // +day facing (toward viewer)
  back: 0.4,
  right: 0.78, // +week facing
  left: 0.5, // -week facing
};

interface Bounds {
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
}

export class GraphSvgGenerator {
  private readonly cfg: Config;

  constructor(overrides: Partial<Config> = {}) {
    this.cfg = { ...GraphConfig, ...overrides };
  }

  generateSvg(
    contributions: DayContribution[],
    userName: string,
    includeCredit = true,
  ): string {
    const grid = this.buildGrid(contributions);
    const elements =
      this.cfg.mode === "terrain"
        ? this.renderTerrain(grid)
        : this.renderColumns(grid);
    const bounds = this.calculateBounds(grid);
    return this.wrapInSvg(elements, bounds, userName, includeCredit);
  }

  // --- grid ----------------------------------------------------------------

  /** grid[day][week] = raw contribution count. */
  private buildGrid(contributions: DayContribution[]): number[][] {
    const maxWeek = Math.max(0, ...contributions.map((c) => c.weekIndex));
    const grid: number[][] = Array.from({ length: 7 }, () =>
      new Array(maxWeek + 1).fill(0),
    );
    for (const c of contributions) {
      if (grid[c.weekday]) grid[c.weekday][c.weekIndex] = c.count;
    }
    return grid;
  }

  /** High-percentile value used to normalize heights (robust to a single spike). */
  private peakValue(grid: number[][]): number {
    return Math.max(1, this.percentile(grid.flat().filter((v) => v > 0)));
  }

  /** Percentile of the (smoothed) terrain lattice, for "auto" height fitting. */
  private finePeak(fine: number[][]): number {
    return Math.max(1e-6, this.percentile(fine.flat().filter((v) => v > 1e-6)));
  }

  private percentile(values: number[]): number {
    if (values.length === 0) return 1;
    values.sort((a, b) => a - b);
    const idx = Math.min(
      values.length - 1,
      Math.floor(values.length * this.cfg.peakPercentile),
    );
    return values[idx];
  }

  // --- projection ----------------------------------------------------------

  /**
   * Oblique projection. Inputs are world-space pixels: x = week*step,
   * y = day*step, z = height in screen px. Weeks stay horizontal, days fan
   * down-left (rowShift) with vertical foreshortening (rowRise), z extrudes up.
   */
  private project(x: number, y: number, z: number): Point2D {
    const { rowRise, rowShift } = this.cfg;
    return {
      x: x - y * rowShift,
      y: y * rowRise - z,
    };
  }

  /** Larger = nearer the viewer; used for back-to-front painter ordering. */
  private depth(week: number, day: number): number {
    // Days dominate depth (they fan toward the viewer); weeks are a tiebreak.
    return day * 1000 + week;
  }

  // --- columns mode --------------------------------------------------------

  private renderColumns(grid: number[][]): string[] {
    const peak = this.peakValue(grid);
    const { cellSize, step, colors } = this.cfg;
    const inset = (step - cellSize) / 2;

    interface Cell {
      week: number;
      day: number;
      count: number;
    }
    const cells: Cell[] = [];
    for (let day = 0; day < grid.length; day++) {
      for (let week = 0; week < grid[day].length; week++) {
        cells.push({ week, day, count: grid[day][week] });
      }
    }
    // Back-to-front so nearer columns overpaint farther ones.
    cells.sort((a, b) => this.depth(a.week, a.day) - this.depth(b.week, b.day));

    const out: string[] = [];
    for (const { week, day, count } of cells) {
      const wx = week * step + inset;
      const dy = day * step + inset;
      if (count <= 0) {
        out.push(this.renderFloorTile(wx, dy, cellSize, colors.empty));
        continue;
      }
      out.push(...this.renderBox(wx, dy, cellSize, count, peak));
    }
    return out;
  }

  private renderFloorTile(
    wx: number,
    dy: number,
    s: number,
    fill: string,
  ): string {
    const pts = [
      this.project(wx, dy, 0),
      this.project(wx + s, dy, 0),
      this.project(wx + s, dy + s, 0),
      this.project(wx, dy + s, 0),
    ];
    return this.polygon(pts, fill, 0.5, this.cfg.colors.stroke);
  }

  private renderBox(
    wx: number,
    dy: number,
    s: number,
    count: number,
    peak: number,
  ): string[] {
    const norm = Math.min(1, count / peak);
    const h = this.cfg.baseHeight + norm * this.cfg.heightScale;
    const base = this.colorForLevel(count);

    // 8 corners: b* = base (z=0), t* = top (z=h). Numbered around the footprint.
    const b1 = this.project(wx, dy, 0);
    const b2 = this.project(wx + s, dy, 0);
    const b3 = this.project(wx + s, dy + s, 0);
    const b4 = this.project(wx, dy + s, 0);
    const t1 = this.project(wx, dy, h);
    const t2 = this.project(wx + s, dy, h);
    const t3 = this.project(wx + s, dy + s, h);
    const t4 = this.project(wx, dy + s, h);

    // Each side face + the top; cull the ones facing away from the viewer via
    // projected winding order so we never draw hidden geometry.
    const faces: { pts: Point2D[]; brightness: number }[] = [
      { pts: [b1, b2, t2, t1], brightness: FACE_BRIGHTNESS.back }, // -day
      { pts: [b3, b4, t4, t3], brightness: FACE_BRIGHTNESS.front }, // +day
      { pts: [b2, b3, t3, t2], brightness: FACE_BRIGHTNESS.right }, // +week
      { pts: [b1, b4, t4, t1], brightness: FACE_BRIGHTNESS.left }, // -week
    ];

    const out: string[] = [];
    for (const f of faces) {
      if (this.isFrontFacing(f.pts)) {
        out.push(this.polygon(f.pts, this.shade(base, f.brightness), 0.4));
      }
    }
    // Top always faces up toward the viewer; draw last so it sits on top.
    out.push(
      this.polygon(
        [t1, t2, t3, t4],
        this.shade(base, FACE_BRIGHTNESS.top),
        0.5,
        this.cfg.colors.stroke,
      ),
    );
    return out;
  }

  /** Signed area > 0 for a screen-space front-facing quad (SVG y is down). */
  private isFrontFacing(pts: Point2D[]): boolean {
    let area = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      area += a.x * b.y - b.x * a.y;
    }
    return area > 0;
  }

  // --- terrain mode --------------------------------------------------------

  private renderTerrain(grid: number[][]): string[] {
    const days = grid.length; // 7
    const weeks = grid[0]?.length ?? 0;

    // Vertex heights on a (days+1) x (weeks+1) lattice: each vertex is the
    // average of the up-to-4 cells around it, then blurred so peaks merge into
    // a continuous surface.
    const vh: number[][] = Array.from({ length: days + 1 }, (_, vd) =>
      Array.from({ length: weeks + 1 }, (_, vw) => {
        let sum = 0;
        let n = 0;
        for (const [dd, ww] of [
          [vd - 1, vw - 1],
          [vd - 1, vw],
          [vd, vw - 1],
          [vd, vw],
        ]) {
          if (dd >= 0 && dd < days && ww >= 0 && ww < weeks) {
            sum += grid[dd][ww];
            n++;
          }
        }
        return n ? sum / n : 0;
      }),
    );
    // Bilinearly upsample the coarse field to a finer lattice, then blur it.
    // The upsample + blur turns the blocky per-cell steps into gradual slopes
    // that lead up to the peaks — instead of vertical cliffs and flat plateaus —
    // while keeping peak positions and rough height intact.
    const S = Math.max(1, Math.floor(this.cfg.subdiv));
    const fd = days * S;
    const fw = weeks * S;
    const bilerp = (fi: number, fj: number): number => {
      const gi = Math.min(days - 1, Math.floor(fi / S));
      const gj = Math.min(weeks - 1, Math.floor(fj / S));
      const ti = fi / S - gi;
      const tj = fj / S - gj;
      const top = vh[gi][gj] + (vh[gi][gj + 1] - vh[gi][gj]) * tj;
      const bot = vh[gi + 1][gj] + (vh[gi + 1][gj + 1] - vh[gi + 1][gj]) * tj;
      return top + (bot - top) * ti;
    };
    let fine: number[][] = Array.from({ length: fd + 1 }, (_, fi) =>
      Array.from({ length: fw + 1 }, (_, fj) => bilerp(fi, fj)),
    );
    // Fractional blur driven by `smoothness` (0..1). Record the peak before
    // smoothing and rescale after, so blurring gentles the slopes without
    // shrinking the terrain — peaks stay as tall as the data made them.
    const gridMax = (g: number[][]) => g.reduce((m, r) => Math.max(m, ...r), 0);
    const peakBefore = gridMax(fine);
    const passes =
      Math.max(0, Math.min(1, this.cfg.smoothness)) * this.cfg.maxSmoothPasses;
    const fullPasses = Math.floor(passes);
    const frac = passes - fullPasses;
    for (let p = 0; p < fullPasses; p++) fine = this.blur(fine);
    if (frac > 0) {
      const b = this.blur(fine);
      fine = fine.map((row, r) => row.map((v, c) => v + (b[r][c] - v) * frac));
    }
    const peakAfter = gridMax(fine);
    if (peakBefore > 0 && peakAfter > 0) {
      const k = peakBefore / peakAfter;
      fine = fine.map((row) => row.map((v) => v * k));
    }

    // Normalize: fit the reference contribution level to a full-height peak.
    // "auto" self-fits (p97) so any real graph fills the frame; a fixed number
    // makes absolute height comparable across graphs (used by the sample gen).
    const ref =
      this.cfg.heightReference === "auto"
        ? this.finePeak(fine)
        : this.cfg.heightReference;
    const denom = Math.max(1e-6, ref);

    const { step, heightScale, peakClamp } = this.cfg;
    const fstep = step / S;
    const zAt = (fi: number, fj: number): Vec3 => ({
      x: fj * fstep,
      y: fi * fstep,
      z: Math.min(peakClamp, fine[fi][fj] / denom) * heightScale,
    });
    // Painter depth on the fine lattice; day (fi) dominates so nearer rows win.
    const fineDepth = (fi: number, fj: number): number => fi * 100000 + fj;

    const zMax = heightScale || 1;

    // A face is any polygon (top triangle or skirt quad) in world space, tagged
    // with a painter depth. `skirt` faces are the vertical perimeter walls that
    // close the heightfield into a solid mass; they are back-face culled.
    interface Face {
      verts: Vec3[];
      depth: number;
      color: string;
      brightness: number;
      skirt: boolean;
    }
    const faces: Face[] = [];

    // Top surface: two triangles per fine cell, colored by height, Lambert-lit.
    for (let fi = 0; fi < fd; fi++) {
      for (let fj = 0; fj < fw; fj++) {
        const p00 = zAt(fi, fj);
        const p01 = zAt(fi, fj + 1);
        const p10 = zAt(fi + 1, fj);
        const p11 = zAt(fi + 1, fj + 1);
        const d = fineDepth(fi, fj);
        for (const t of [
          [p00, p01, p11],
          [p00, p11, p10],
        ]) {
          const centerZ = (t[0].z + t[1].z + t[2].z) / 3;
          faces.push({
            verts: t,
            depth: d,
            color: this.colorForHeight(centerZ / zMax),
            brightness: this.lambert(t[0], t[1], t[2]),
            skirt: false,
          });
        }
      }
    }

    // Solid fill. The top surface alone is a hollow shell — where the terrain
    // steps down toward the viewer you would see under it to the floor. To make
    // it a solid mass we drop a vertical "curtain" from every cell's viewer-
    // facing edge down to the base plane. Painted back-to-front, nearer curtains
    // overpaint farther ones, so the union fills the whole front silhouette.
    // Back-facing curtains are culled, so only the exposed faces are drawn.
    const baseZ = -this.cfg.baseThickness;
    const wall = (top1: Vec3, top2: Vec3, fi: number, fj: number) => {
      const avgTop = (top1.z + top2.z) / 2;
      faces.push({
        verts: [
          top1,
          top2,
          { x: top2.x, y: top2.y, z: baseZ },
          { x: top1.x, y: top1.y, z: baseZ },
        ],
        depth: fineDepth(fi, fj),
        color: this.colorForHeight(avgTop / zMax),
        brightness: this.cfg.skirtBrightness,
        skirt: true,
      });
    };
    for (let fi = 0; fi < fd; fi++) {
      for (let fj = 0; fj < fw; fj++) {
        // Day-facing curtain: the front (+day) edge of every cell.
        wall(zAt(fi + 1, fj), zAt(fi + 1, fj + 1), fi + 1, fj);
      }
      // Week-facing curtains: the left and right silhouette of each row.
      wall(zAt(fi, 0), zAt(fi + 1, 0), fi, 0);
      wall(zAt(fi, fw), zAt(fi + 1, fw), fi, fw);
    }
    // Back edge (day 0) closes the far side; culled unless it faces the viewer.
    for (let fj = 0; fj < fw; fj++) {
      wall(zAt(0, fj), zAt(0, fj + 1), 0, fj);
    }

    faces.sort((a, b) => a.depth - b.depth);

    const out: string[] = [];
    for (const f of faces) {
      const pts = f.verts.map((v) => this.project(v.x, v.y, v.z));
      // Skirt walls facing away from the viewer are hidden — cull them.
      if (f.skirt && !this.isFrontFacing(pts)) continue;
      const fill = this.shade(f.color, f.brightness);
      if (f.skirt) {
        // Solid body: stroke with the fill colour so adjacent curtains seal
        // without seams, and no facet lines clutter the smooth front face.
        out.push(this.polygon(pts, fill, 0.6, fill));
      } else {
        // Top surface keeps the thin grey facet lines for the low-poly read.
        out.push(
          this.polygon(
            pts,
            fill,
            this.cfg.meshStroke,
            this.cfg.colors.mesh,
            this.cfg.meshOpacity,
          ),
        );
      }
    }
    return out;
  }

  private blur(vh: number[][]): number[][] {
    const rows = vh.length;
    const cols = vh[0].length;
    return vh.map((row, r) =>
      row.map((_, c) => {
        let sum = 0;
        let n = 0;
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            const rr = r + dr;
            const cc = c + dc;
            if (rr >= 0 && rr < rows && cc >= 0 && cc < cols) {
              sum += vh[rr][cc];
              n++;
            }
          }
        }
        return sum / n;
      }),
    );
  }

  /** Lambert brightness for a triangle given its 3 world-space corners. */
  private lambert(a: Vec3, b: Vec3, c: Vec3): number {
    const u = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
    const v = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z };
    let nx = u.y * v.z - u.z * v.y;
    let ny = u.z * v.x - u.x * v.z;
    let nz = u.x * v.y - u.y * v.x;
    if (nz < 0) {
      nx = -nx;
      ny = -ny;
      nz = -nz;
    }
    const len = Math.hypot(nx, ny, nz) || 1;
    const L = this.cfg.light;
    const llen = Math.hypot(L.x, L.y, L.z) || 1;
    const dot = (nx * L.x + ny * L.y + nz * L.z) / (len * llen);
    return this.cfg.ambient + this.cfg.diffuse * Math.max(0, dot);
  }

  // --- colors --------------------------------------------------------------

  private colorForLevel(count: number): string {
    const l = this.cfg.colors.levels;
    if (count <= 0) return this.cfg.colors.empty;
    if (count === 1) return l[0];
    if (count <= 3) return l[1];
    if (count <= 6) return l[2];
    if (count <= 12) return l[3];
    return l[4];
  }

  /**
   * Continuous gradient by normalized height t in [0,1]. Rises from the pale
   * flat floor (t≈0) through the green ramp so valleys read as ground and peaks
   * as dark forest — the reference's floor-to-peak spread.
   */
  private colorForHeight(t: number): string {
    const ramp = [this.cfg.colors.terrainFloor, ...this.cfg.colors.levels];
    const clamped = Math.max(0, Math.min(1, t));
    const eased = Math.pow(clamped, this.cfg.colorGamma);
    const scaled = eased * (ramp.length - 1);
    const i = Math.min(ramp.length - 2, Math.floor(scaled));
    const f = scaled - i;
    return this.mixHex(ramp[i], ramp[i + 1], f);
  }

  private mixHex(a: string, b: string, t: number): string {
    const ca = this.hexToRgb(a);
    const cb = this.hexToRgb(b);
    const r = Math.round(ca[0] + (cb[0] - ca[0]) * t);
    const g = Math.round(ca[1] + (cb[1] - ca[1]) * t);
    const bl = Math.round(ca[2] + (cb[2] - ca[2]) * t);
    return `rgb(${r}, ${g}, ${bl})`;
  }

  private hexToRgb(hex: string): [number, number, number] {
    return [
      parseInt(hex.slice(1, 3), 16),
      parseInt(hex.slice(3, 5), 16),
      parseInt(hex.slice(5, 7), 16),
    ];
  }

  private shade(color: string, brightness: number): string {
    const [r, g, b] = color.startsWith("#")
      ? this.hexToRgb(color)
      : this.parseRgb(color);
    const light = Math.min(1, brightness);
    return `rgb(${Math.round(r * light)}, ${Math.round(g * light)}, ${Math.round(b * light)})`;
  }

  private parseRgb(rgb: string): [number, number, number] {
    const m = rgb.match(/\d+/g)?.map(Number) ?? [0, 0, 0];
    return [m[0], m[1], m[2]];
  }

  // --- svg plumbing --------------------------------------------------------

  private polygon(
    pts: Point2D[],
    fill: string,
    strokeWidth: number,
    stroke = fill,
    strokeOpacity = 1,
  ): string {
    const points = pts
      .map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`)
      .join(" ");
    const so = strokeOpacity < 1 ? ` stroke-opacity="${strokeOpacity}"` : "";
    return `<polygon points="${points}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"${so}/>`;
  }

  private calculateBounds(grid: number[][]): Bounds {
    const days = grid.length;
    const weeks = grid[0]?.length ?? 0;
    const { step, heightScale, baseHeight, padding, titleHeight } = this.cfg;
    // Columns top out at heightScale+baseHeight; terrain peaks can reach
    // peakClamp*heightScale. Reserve the taller of the two so nothing clips.
    const maxH = Math.max(
      heightScale + baseHeight,
      heightScale * this.cfg.peakClamp,
    );
    const W = weeks * step;
    const D = days * step;

    const baseZ = -this.cfg.baseThickness;
    const corners = [
      this.project(0, 0, 0),
      this.project(W, 0, 0),
      this.project(W, D, 0),
      this.project(0, D, 0),
      this.project(0, 0, maxH),
      this.project(W, 0, maxH),
      // Skirt base dips below the floor along the front/side edges.
      this.project(0, D, baseZ),
      this.project(W, D, baseZ),
    ];
    const xs = corners.map((p) => p.x);
    const ys = corners.map((p) => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    return {
      width: maxX - minX + padding * 2,
      height: maxY - minY + padding * 2 + titleHeight,
      offsetX: -minX + padding,
      offsetY: -minY + padding + titleHeight,
    };
  }

  private wrapInSvg(
    elements: string[],
    bounds: Bounds,
    userName: string,
    includeCredit: boolean,
  ): string {
    const w = bounds.width.toFixed(0);
    const h = bounds.height.toFixed(0);
    const credit = includeCredit
      ? `<text x="${bounds.width - 8}" y="${bounds.height - 8}" class="credit" text-anchor="end">github.com/arqamz/gh-contributions-3d</text>`
      : "";

    return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
  <title>GitHub Contribution Graph for ${userName}</title>
  <defs>
    <style>
      .title { font: 600 16px 'Segoe UI', Arial, sans-serif; fill: #8b949e; }
      .subtitle { font: 400 12px 'Segoe UI', Arial, sans-serif; fill: #8b949e; }
      .credit { font: 8px 'Segoe UI', Arial, sans-serif; fill: #6e7781; opacity: 0.8; }
      .graph { filter: drop-shadow(0 1px 3px rgba(0,0,0,0.15)); }
    </style>
  </defs>
  <text x="20" y="25" class="title">GitHub Contributions</text>
  <text x="20" y="42" class="subtitle">${userName}</text>
  <g class="graph" transform="translate(${bounds.offsetX.toFixed(2)}, ${bounds.offsetY.toFixed(2)})">
    ${elements.join("\n    ")}
  </g>
  ${credit}
</svg>`;
  }
}
