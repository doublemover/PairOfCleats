# Service Mode

Service mode provides a lightweight workflow for multi-repo indexing. The
service separates repo syncing, durable queueing, and index workers, so you can
run each step independently or on a schedule.

Config
Create a config file at the default location:
`$PAIROFCLEATS_HOME/service/config.json`

Example:
```json
{
  "baseDir": "C:/pairofcleats/repos",
  "repos": [
    {
      "id": "example",
      "url": "https://github.com/org/repo.git",
      "path": "example",
      "branch": "main",
      "syncPolicy": "pull"
    }
  ],
  "queue": { "maxQueued": 20, "maxRetries": 2 },
  "worker": { "concurrency": 2 },
  "sync": { "policy": "pull", "intervalMs": 300000 }
}
```

Repo-level `indexModes` values are ignored by the indexer service; select `--mode` when enqueueing jobs.

Commands
```bash
# Sync repos (clone or pull)
pairofcleats service indexer sync --config /path/to/config.json

# Enqueue a repo for indexing
pairofcleats service indexer enqueue --repo /path/to/repo --mode code

# Process the queue once, or keep watching
pairofcleats service indexer work --concurrency 2
pairofcleats service indexer work --watch --interval 5000

# Queue status
pairofcleats service indexer status

# Embedding queue (service mode)
pairofcleats service indexer enqueue --queue embeddings --repo /path/to/repo --mode code
pairofcleats service indexer work --queue embeddings --concurrency 1

# Stage/mode-specific queues (optional)
pairofcleats service indexer enqueue --queue auto --stage stage2 --mode code --repo /path/to/repo
pairofcleats service indexer work --queue auto --stage stage2 --mode code --concurrency 1
```

Query serving
Use the API server to serve queries once indexes are built:
```bash
pairofcleats service indexer serve --repo /path/to/repo
```

Notes
- The queue is persisted in the cache root under `service/queue/queue.json`.
- Embedding jobs are stored in `service/queue/queue-embeddings.json`.
- Use `queue.maxRetries` to requeue failed jobs automatically; attempts are tracked per job.
- If `indexing.twoStage.background` is enabled, stage2 enrichment jobs are queued by default (set `indexing.twoStage.queue: false` to disable).
- Stage3 runs the embedding pass (`--stage stage3`), and stage4 builds SQLite/ANN (`--stage stage4`).
- Use `syncPolicy: "fetch"` for Sourcebot-style fetch-only workflows.
- Each job runs `build_index.js` for the configured repo/mode.
- Watch mode uses atomic attempt roots and promotion barriers (see `docs/specs/watch-atomicity.md`).


