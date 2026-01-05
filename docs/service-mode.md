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
pairofcleats indexer-service sync --config /path/to/config.json

# Enqueue a repo for indexing
pairofcleats indexer-service enqueue --repo /path/to/repo --mode code

# Process the queue once, or keep watching
pairofcleats indexer-service work --concurrency 2
pairofcleats indexer-service work --watch --interval 5000

# Queue status
pairofcleats indexer-service status
```

Query serving
Use the API server to serve queries once indexes are built:
```bash
pairofcleats indexer-service serve --repo /path/to/repo
```

Notes
- The queue is persisted in the cache root under `service/queue/queue.json`.
- Use `syncPolicy: "fetch"` for Sourcebot-style fetch-only workflows.
- Each job runs `build_index.js` for the configured repo/mode.
