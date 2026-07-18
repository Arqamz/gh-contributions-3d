# 3D GitHub Contributions

Turn a GitHub user's contribution calendar into a 3D **terrain** — a shaded,
low-poly mesh where busy days rise into deep-green mountains and quiet stretches
stay a pale, flat plain.

![Terrain](./docs/hero.svg)

The terrain is a single **heightfield** over the calendar grid: each day is a
lattice vertex whose height is its contribution count, and the surface is
triangulated and flat-shaded (Lambert) per facet for the low-poly 3D read. Empty
days sit at `z=0` and _are_ the ground plane the mountains rise from — there is
no solid base or extruded underside, so it reads as terrain on a floor rather
than a chunky bar. (A blockier extruded look is available via the `solidBase`
config flag in `src/graph.ts`.)

## Development environment

This project uses [Nix](https://nixos.org/) with flakes and runs on
[Bun](https://bun.sh/) (no npm/pnpm/node needed for execution). With flakes
enabled:

```bash
nix develop
```

That drops you into a shell with `bun` (and `nodejs_24` as a fallback runtime).

## Setup

1. Install dependencies:
   ```bash
   bun install
   ```
2. Set up your environment variables:
   ```bash
   cp .env.example .env
   ```
   Edit `.env` and add your `TOKEN_GITHUB`. Bun loads `.env` automatically.

## Usage

Fetch a real user's contributions and render an SVG:

```bash
bun run dev <github_username> [options]
```

| Option               | Values                                                          | Default   |
| -------------------- | --------------------------------------------------------------- | --------- |
| `-a`, `--angle`      | `low` \| `medium` \| `high` \| `top`, or a raw `rowRise` number | `medium`  |
| `-s`, `--smoothness` | `0`–`1` (0 = sharp low-poly, 1 = smooth hills)                  | `1`       |
| `-m`, `--mode`       | `terrain` \| `columns`                                          | `terrain` |

The SVG is written to `assets/<username>-<mode>.svg`. **angle** and
**smoothness** are the two terrain knobs (detailed below), e.g.:

```bash
bun run dev octocat --angle high --smoothness 0.4
bun run dev octocat -m columns -a top
```

### Viewing angle

The **angle** controls the camera tilt, i.e. how top-down the terrain is drawn.
It takes a preset — `low`, `medium` (default), `high`, `top` — or a raw
`rowRise` number:

| Preset   | Look                                  | Best for                               |
| -------- | ------------------------------------- | -------------------------------------- |
| `low`    | Side-on; peaks tower                  | Sparse / realistic graphs              |
| `medium` | Balanced 3/4 tilt (default)           | Most graphs                            |
| `high`   | Top-down; a peak's depth ≈ its height | Dense day-patterns (weekdays/weekends) |
| `top`    | Near-overhead                         | Reading shape when height hides it     |

Low angles lift each row only a few pixels, so a tall front row hides
everything behind it and dense patterns collapse into a flat wall. Raising the
angle spreads the rows apart until plateau tops and hidden valleys open up — use
`high` or `top` when the shape is hard to read.

```bash
bun run dev octocat --angle high
```

Generate sample graphs (no token required), one SVG per pattern:

```bash
bun run sample [name] [-a|--angle <preset|number>] [-s|--smoothness <0..1>]
```

- **name** — label shown in the title (default `SampleUser`).
- **`-s`, `--smoothness`** — `0.0`–`1.0` controlling the **triangle facets**:
  `0.0` is a crisp low-poly look — few large flat triangles, each isometric
  facet a discrete plane — while `1.0` splits each cell into many fine triangles
  and blurs them into smooth rolling hills. It drives both the facet resolution
  (subdivision level) and the slope blur along one axis.
- **`-a`, `--angle`** — viewing angle (see the table above), e.g.
  `bun run sample Me --smoothness 0.2 --angle high`.

This writes `assets/sample-<pattern>.svg` for each pattern: `realistic`, `tall`,
`flat`, `high-low`, `weekdays`, `weekends` — a spread of height distributions to
eyeball the renderer against.

### Sweeping parameters to find the best look

The terrain has two knobs — the viewing **angle** and the peak **smoothness**.
To compare them side by side, the sweep renders a grid of checkpoints across
both onto a few representative patterns:

```bash
bun run sweep [name]
```

This writes one SVG per checkpoint to `assets/sweep/` named
`<pattern>-<angle>-s<NN>.svg` (where `NN` is smoothness × 100). By default it
sweeps all six patterns × `low|medium|high|top` × `0.0|0.33|0.66|1.0` — 96 SVGs.
Open the folder and eyeball which `(angle, smoothness)` reads best for each
distribution, then set those as the config defaults (`VIEW_ANGLES` /
`smoothness` in `src/graph.ts`). The current defaults are **`medium` angle,
`smoothness` 1.0** (smooth rolling hills) — best overall for realistic data,
though rigid day-patterns (`weekdays`/`weekends`) read more clearly at a `high`
or `top` angle where the day axis spreads apart. The canonical
`assets/sample-*.svg` are left untouched. Adjust the `PATTERNS`, `ANGLES`, and
`SMOOTHNESS` arrays at the top of `src/sweep.ts` to widen or narrow the grid.

## Formatting & linting

```bash
bun run lint
bun run format
```
