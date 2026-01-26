# `pino-pretty`

**Area:** Log formatting / developer ergonomics

## Why this matters for PairOfCleats
Pretty-print Pino JSON logs in dev while keeping structured logs for production; runs well as a transport.

## Implementation notes (practical)
- Transport options must be serializable unless explicitly handled (e.g., `messageFormat` as a function).
- Run pretty transport in worker threads so it does not slow main execution.

## Where it typically plugs into PairOfCleats
- Provide a `--pretty` dev mode that uses pino-pretty transport without impacting CI/service performance.

## Deep links (implementation-relevant)
1. README: handling non-serializable transport options (messageFormat as function)  https://github.com/pinojs/pino-pretty#handling-non-serializable-options
2. Pino transports doc (how to run pretty transport in worker threads)  https://github.com/pinojs/pino/blob/main/docs/transports.md

## Suggested extraction checklist
- [x] Identify the exact API entrypoints you will call and the data structures you will persist. (Use pino transport target `pino-pretty` when pretty logging is enabled (src/shared/progress.js).)
- [x] Record configuration knobs that meaningfully change output/performance. (pretty flag, level, ringMax, ringMaxBytes; transport options colorize/translateTime (src/shared/progress.js).)
- [x] Add at least one representative test fixture and a regression benchmark. (Fixture: tests/fixture-smoke.js (logging path). Benchmark: tools/bench-language-repos.js.)