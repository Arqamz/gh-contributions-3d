// Tiny zero-dependency flag parser for the CLIs. Supports `--key value`,
// `--key=value`, and single-dash aliases (`-s 0.5`). Anything not attached to a
// flag is collected as a positional argument, so `bun run dev octocat -a high`
// works. A flag with no value (end of args, or followed by another flag) is
// recorded as "true" so it can act as a boolean switch.

export interface ParsedArgs {
  positional: string[];
  flags: Record<string, string>;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    // A flag is `-x` / `--name` starting with a letter, so a negative number
    // (e.g. a value like `-5`) is treated as a value/positional, not a flag.
    if (!/^--?[a-zA-Z]/.test(a)) {
      positional.push(a);
      continue;
    }
    const body = a.replace(/^--?/, "");
    const eq = body.indexOf("=");
    if (eq >= 0) {
      flags[body.slice(0, eq)] = body.slice(eq + 1);
      continue;
    }
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("-")) {
      flags[body] = next;
      i++;
    } else {
      flags[body] = "true";
    }
  }
  return { positional, flags };
}

/** First defined value among the given flag names, or undefined. */
export function pickFlag(
  flags: Record<string, string>,
  ...names: string[]
): string | undefined {
  for (const n of names) {
    if (flags[n] !== undefined) return flags[n];
  }
  return undefined;
}
