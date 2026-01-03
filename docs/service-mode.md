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
      "syncPolicy": "pull",
      "indexModes": "both"
    }
  ],
  "queue": { "maxQueued": 20 },
  "worker": { "concurrency": 2 },
  "sync": { "policy": "pull", "intervalMs": 300000 }
}
```

Commands
```bash
# Sync repos (clone or pull)
node tools/indexer-service.js sync --config /path/to/config.json

# Enqueue a repo for indexing
node tools/indexer-service.js enqueue --repo /path/to/repo --mode code

# Process the queue once, or keep watching
node tools/indexer-service.js work --concurrency 2
node tools/indexer-service.js work --watch --interval 5000

# Queue status
node tools/indexer-service.js status
```

Query serving
Use the API server to serve queries once indexes are built:
```bash
node tools/indexer-service.js serve --repo /path/to/repo
```

Notes
- The queue is persisted in the cache root under `service/queue/queue.json`.
- Use `syncPolicy: "fetch"` for Sourcebot-style fetch-only workflows.
- Each job runs `build_index.js` for the configured repo/mode.
