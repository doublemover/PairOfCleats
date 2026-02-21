# Service Mode

Service mode provides queue-backed indexing workflows for multi-repo environments.

## Canonical run path

Use this as the canonical long-running command:

```bash
pairofcleats service indexer work --watch --config <path-to-config.json> --queue index
```

Release smoke command:

```bash
pairofcleats service indexer smoke --json
```

## Required environment

- `PAIROFCLEATS_CACHE_ROOT` (recommended explicit value in CI/release flows)

Default queue paths:

- `service/queue/queue.json` for index jobs
- `service/queue/queue-embeddings.json` for embedding jobs

## Security defaults

`tools/service/config.js` enforces these defaults unless explicitly overridden:

- `security.allowShell: false`
- `security.allowPathEscape: false`

## Config defaults

- `queue.maxQueued: 20`
- `queue.maxRetries: 2`
- `worker.concurrency: 1`
- `embeddings.queue.maxQueued: 10`
- `embeddings.queue.maxRetries: 2`
- `embeddings.worker.concurrency: 1`
- `embeddings.worker.maxMemoryMb: 4096`
- `sync.policy: pull`
- `sync.intervalMs: 300000`

## Common commands

```bash
# Sync repos
pairofcleats service indexer sync --config /path/to/config.json

# Enqueue
pairofcleats service indexer enqueue --repo /path/to/repo --mode code

# Status
pairofcleats service indexer status --json

# Serve API for a repo
pairofcleats service indexer serve --repo /path/to/repo
```
