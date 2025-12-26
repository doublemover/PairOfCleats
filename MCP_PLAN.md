# MCP Plan: PairOfCleats

## Goals
- Per-repo indexing with a central cache (indexes, models, repometrics) outside the repo.
- On-demand indexing with incremental caching and optional prebuilt CI artifacts.
- MCP server interface for index status/build/search/model download.
- Non-git repos supported with strong recommendation to use git.

## Cache layout
- <cache>/repos/<repoId>/index-code/
- <cache>/repos/<repoId>/index-prose/
- <cache>/repos/<repoId>/state.json
- <cache>/repos/<repoId>/repometrics/
- <cache>/models/

Repo identity:
- Prefer git toplevel + remote URL (hash to repoId)
- If no git, hash absolute path

## Model download
- On startup, detect model files in cache; if missing, prompt to download.
- Provide preflight download command:
  - Node:
    node --input-type=module -e "import { pipeline } from '@xenova/transformers'; await pipeline('feature-extraction','Xenova/all-MiniLM-L12-v2');"
  - Python (HF cache):
    python -c "from huggingface_hub import snapshot_download; snapshot_download('Xenova/all-MiniLM-L12-v2')"

## Git handling
- If git missing or repo is not a git repo, warn once and continue without git metadata.
- If git present, store commit hash and dirty flag in state.json.

## MCP surface (minimum)
- index_status(repoPath)
- build_index(repoPath, mode=all, incremental=true)
- search(repoPath, query, filters...)
- download_models()

## Required fixes in current code
- Persist rich chunk metadata needed by search (tokens, ngrams, relations, docmeta, lint, etc.).
- Fix ANN path in search.js (undefined tokens var).
- Use or remove unused artifacts (dense vectors, sparse postings).
- Include required assets (tools/words_alpha.txt, merge scripts) or relocate paths.
- Add package.json/lock to declare dependencies.
- Store repometrics in central cache instead of repo.
- Make git metadata optional and resilient to missing git.

## Incremental caching effort
- Level 1: per-file hash + per-chunk embedding cache; rebuild global postings each run (3-5 days).
- Level 2: fully incremental postings/minhash updates with stable chunk ids (2-3 weeks).

## CI/CD artifact support
- Provide a script to build indexes (e.g., scripts/build-index.sh).
- GitHub Actions workflow to build on push and upload index artifacts.
- MCP checks repo config for artifact URL + commit; download if available.

## Phase: Roadmap review
- Evaluate ROADMAP.md items by impact on MCP utility, index quality, and maintenance cost.

## Phase: Enhancements
- Prioritize MCP-focused enhancements and SAST-inspired features (see report).
