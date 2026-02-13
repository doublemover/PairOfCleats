# `linguist-languages`

**Area:** Language detection / file classification

## Why this matters for PairOfCleats
Use Linguists language metadata and heuristics to classify files for parser selection and to exclude vendored/generated content.

## Implementation notes (practical)
- Consume `languages.yml` as the extension/filename/interpreter map (source of truth).
- Apply Linguist-style heuristics for vendored/generated detection to avoid indexing noise.
- Support overrides (e.g., `.gitattributes`) when heuristics are wrong.

## Where it typically plugs into PairOfCleats
- File triage: decide parser vs heuristic chunker based on detected language and confidence.
- Filters: expose `--language` / `--vendored` / `--generated` style constraints.

## Deep links (implementation-relevant)
1. Language metadata source of truth (extensions � language, filenames, interpreters)  https://github.com/github-linguist/linguist/blob/master/lib/linguist/languages.yml
2. How Linguist works (heuristics, vendored/generated classification)  https://github.com/github-linguist/linguist/blob/master/docs/how-linguist-works.md
3. Overrides (how to force language detection when heuristics are wrong)  https://github.com/github-linguist/linguist/blob/master/docs/overrides.md

## Suggested extraction checklist
- [x] Identify the exact API entrypoints you will call and the data structures you will persist. (Planned: load linguist-languages.json to map extensions/filenames to languageId.)
- [x] Record configuration knobs that meaningfully change output/performance. (Planned knobs: overrides and priority rules (repo config).)
- [x] Add at least one representative test fixture and a regression benchmark. (Planned fixture: tests/unified-syntax-representation/lang/contracts/*.test.js. Planned benchmark: tools/bench/language-repos.js.)

