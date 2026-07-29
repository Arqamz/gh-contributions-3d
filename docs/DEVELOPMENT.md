# Development & local usage

Run the renderer locally, tweak the terrain, or hack on the code.

## How it works

The terrain is a single **heightfield** over the calendar grid: each day is a
lattice vertex whose height is its contribution count, and the surface is
triangulated and flat-shaded (Lambert) per facet for the low-poly 3D read. Empty
days sit at `z=0` and _are_ the ground plane the mountains rise from — there is
no solid base or extruded underside, so it reads as terrain on a floor rather
than a chunky bar. (A blockier extruded look is available via the `solidBase`
config flag in `src/graph.ts`.)

## Environment

This project uses [Nix](https://nixos.org/) with flakes and runs on
[Bun](https://bun.sh/). With flakes enabled:

```bash
nix develop   # drops you into a shell with bun (and nodejs_24 as fallback)
bun install
```

Set up a token so the renderer can call the GitHub API:

```bash
cp .env.example .env   # then edit .env and set TOKEN_GITHUB (Bun loads .env automatically)
```

## Render a real user

```bash
bun run dev <github_username> [options]
```

| Option               | Values                                                          | Default   |
| -------------------- | --------------------------------------------------------------- | --------- |
| `--source`           | `user` (a profile's calendar) \| `repo` (local git commits)     | `user`    |
| `-a`, `--angle`      | `low` \| `medium` \| `high` \| `top`, or a raw `rowRise` number | `medium`  |
| `-s`, `--smoothness` | `0`–`1` (0 = sharp low-poly, 1 = smooth hills)                  | `1`       |
| `-m`, `--mode`       | `terrain` \| `columns`                                          | `terrain` |
| `-o`, `--out`        | output path                                                     | `assets/<name>-<mode>.svg` |

```bash
bun run dev octocat --angle high --smoothness 0.4
bun run dev octocat -m columns -a top
bun run dev octocat --out profile-3d/terrain.svg
```

### Repo mode (`--source repo`)

Instead of a user's calendar, render the **local git repo's** trailing-year
commit history, colouring each day by its most active committer. No token is
needed — it shells out to `git log` in the current directory. With more than one
contributor the terrain becomes a rainbow (each author a distinct hue, with a
legend); a single-author repo keeps the default green ramp. Days with multiple
authors take the colour of whoever committed most that day.

```bash
bun run dev --source repo                        # this repo -> assets/<repo>-terrain.svg
bun run dev --source repo --repo ~/code/some-clone   # any local clone
bun run dev --source repo --repo ../other -a high    # steeper angle
bun run dev --source repo --repo ../other --out repo.svg
```

`--repo <path>` points the generator at any local clone (defaults to the current
directory). The path just needs to be a git working copy with commit history.

Contributor identity is keyed on author email; colours are assigned by commit
rank via a golden-angle hue spread (see `hueForRank` in `src/repoCommits.ts` —
swap the rank index for a hash of the id there to make each author's colour
stable across rank changes instead).

### Viewing angle

The **angle** controls the camera tilt (how top-down the terrain is drawn) via
`rowRise` — bigger spreads the rows apart so hidden valleys and plateau tops
open up.

| Preset   | Look                                  | Best for                               |
| -------- | ------------------------------------- | -------------------------------------- |
| `low`    | Side-on; peaks tower                  | Sparse / realistic graphs              |
| `medium` | Balanced 3/4 tilt (default)           | Most graphs                            |
| `high`   | Top-down; a peak's depth ≈ its height | Dense day-patterns (weekdays/weekends) |
| `top`    | Near-overhead                         | Reading shape when height hides it     |

### Smoothness

`-s`/`--smoothness` is a single `0.0`–`1.0` knob over the **triangle facets**:
`0.0` is a crisp low-poly look (few large flat triangles) while `1.0` splits each
cell into many fine triangles and blurs them into smooth rolling hills. It drives
both the facet resolution (subdivision level) and the slope blur along one axis.

## Sample graphs (no token)

```bash
bun run sample [name] [-a|--angle <preset|number>] [-s|--smoothness <0..1>]
```

Writes `assets/sample-<pattern>.svg` for each pattern (`realistic`, `tall`,
`flat`, `high-low`, `weekdays`, `weekends`) — a spread of height distributions to
eyeball the renderer against. `name` sets the title (default `SampleUser`).

## Sweeping parameters

To compare angle × smoothness side by side:

```bash
bun run sweep [name]
```

Writes one SVG per checkpoint to `assets/sweep/` named
`<pattern>-<angle>-s<NN>.svg` (`NN` = smoothness × 100) — by default all six
patterns × `low|medium|high|top` × `0.0|0.33|0.66|1.0` (96 SVGs). Adjust the
`PATTERNS`, `ANGLES`, and `SMOOTHNESS` arrays at the top of `src/sweep.ts` to
widen or narrow the grid. The current defaults are **`medium` angle,
`smoothness` 1.0**.

## Formatting & linting

```bash
bun run lint
bun run format
```
