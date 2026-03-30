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

Minimal `service-config.json`:

```json
{
  "repos": [],
  "queue": {
    "maxQueued": 20,
    "maxRetries": 2
  },
  "worker": {
    "concurrency": 1
  },
  "embeddings": {
    "queue": {
      "maxQueued": 10,
      "maxRetries": 2
    },
    "worker": {
      "concurrency": 1,
      "maxMemoryMb": 4096
    }
  },
  "sync": {
    "policy": "pull",
    "intervalMs": 300000
  }
}
```

Default queue paths:

- `service/queue/queue.json` for index jobs
- `service/queue/queue-embeddings.json` for embedding jobs

## Queue identity

- Canonical queue classes are `index` and `embeddings`.
- Derived namespaces are supported and inherit queue-class behavior by prefix:
  - `index-stage2`, `index-code`
  - `embeddings-stage3`, `embeddings-records`
- Use `--queue auto --reason embeddings` when the work type should choose the queue.
- Status, shutdown, resume, repair, and worker behavior are keyed to the resolved queue identity, not the raw CLI token.

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

## Config validation

- The service config is validated on load before queue or worker actions run.
- Invalid config exits early with:
  - the config path
  - the offending field path
  - a remediation hint
- Current supported `sync.policy` values are `pull`, `fetch`, and `none`.
- Worker concurrency may be explicitly `0`; it is not coerced upward by the admission policy.

## Common commands

```bash
# Sync repos
pairofcleats service indexer sync --config /path/to/config.json

# Enqueue
pairofcleats service indexer enqueue --repo /path/to/repo --mode code

# Status
pairofcleats service indexer status --json

# Stop accepting new jobs and begin drain/cancel handling
pairofcleats service indexer shutdown --queue index --shutdown-mode drain --json

# Resume a queue after shutdown
pairofcleats service indexer resume --queue index --json

# Serve API for a repo
pairofcleats service indexer serve --repo /path/to/repo
```

## Repair and recovery

Use these commands when queue state needs intervention:

```bash
# Inspect repair state and stale-job causes
pairofcleats service indexer inspect --queue index --json

# Retry or quarantine one repair candidate
pairofcleats service indexer retry --queue index --job <job-id> --json
pairofcleats service indexer quarantine-job --queue index --job <job-id> --json

# Purge or unlock repair state
pairofcleats service indexer purge --queue index --json
pairofcleats service indexer unlock --queue index --lock shutdown --json

# Clean orphan artifacts and compact queue state
pairofcleats service indexer cleanup-orphans --queue index --json
pairofcleats service indexer compact --queue index --json
```

## Operator notes

- Prefer `--json` for automation; human output is for local inspection.
- For long-running service processes, set `PAIROFCLEATS_CACHE_ROOT` explicitly.
- Queue status should be interpreted together with:
  - backpressure state
  - operational envelope
  - shutdown state
  - quarantine/repair summaries
