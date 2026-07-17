# 3D GitHub Contributions

Turn a GitHub user's contribution calendar into a 3D **terrain** — a shaded,
low-poly mesh where busy days rise into deep-green mountains and quiet stretches
stay a pale, flat plain.

![Terrain](./assets/sample-high-low.svg)

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
bun run dev <github_username> [terrain|columns]
```

The SVG is written to `assets/<username>-<mode>.svg`. `terrain` is the default;
`columns` is a simpler extruded-bar style.

Generate sample graphs (no token required), one SVG per pattern:

```bash
bun run sample [name] [smoothness]
```

- **name** — label shown in the title (default `SampleUser`).
- **smoothness** — `0.0`–`1.0` peak sharpness: `0.0` sharp and jagged, `1.0`
  soft rolling hills.

This writes `assets/sample-<pattern>.svg` for each pattern: `realistic`, `tall`,
`flat`, `high-low`, `weekdays`, `weekends` — a spread of height distributions to
eyeball the renderer against.

## Formatting & linting

```bash
bun run lint
bun run format
```
