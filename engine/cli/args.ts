// Shared command-line parsing for the recommend and eval runners.
import { parseArgs } from "node:util";

export interface CliOptions {
  positionals: string[];
  candidatesPath?: string; // --candidates <path>: read candidates from here instead of data/candidates.json
  casesPath?: string; // --cases <path>: read eval cases from here instead of data/cases.json
}

// Throws on unknown flags or a flag with no value, so a typo never silently falls back to the default file.
export function parseCliArgs(argv: string[]): CliOptions {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: { candidates: { type: "string" }, cases: { type: "string" } },
  });
  const out: CliOptions = { positionals };
  if (values.candidates !== undefined) out.candidatesPath = values.candidates;
  if (values.cases !== undefined) out.casesPath = values.cases;
  return out;
}
