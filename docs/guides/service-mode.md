# Operate one queue-backed indexer

This guide is for the queue-backed service indexer. For HTTP setup use the
[HTTP API guide](../api/server.md). Prepare the application checkout and select an
explicit service config, repository root and queue namespace for every invocation.
A worker's `--config` choice is not persisted into later status/repair commands.

## Select a disposable service identity

Create a task-owned service config outside live production state. Replace all
paths below with the same absolute paths; `baseDir` and `queueDir` are resolved
by each invocation, so absolute values avoid working-directory ambiguity.

```json
{
  "baseDir": "C:/work/poc-service-fixture/repos",
  "queueDir": "C:/work/poc-service-fixture/queue",
  "repos": [],
  "queue": { "maxQueued": 20, "maxRetries": 2 },
  "worker": { "concurrency": 1 },
  "sync": { "policy": "none", "intervalMs": 300000 }
}
```

Use your platform's absolute path syntax. The config validates on load; errors
name a field and hint. Retain the config path, resolved queue directory/class/
namespace and selected repository in the operator record. Canonical classes are
`index` and `embeddings`; derived names such as `index-code` and
`embeddings-stage3` inherit the corresponding class but remain distinct queues.

## Diagnose, enqueue and work

<!-- poc:recipe service-status shell=portable effects=read-only -->
```sh
node bin/pairofcleats.js service indexer status --config "path/to/service-config.json" --queue index --json
node bin/pairofcleats.js service indexer inspect --config "path/to/service-config.json" --queue index --json
```

Inspect status/backpressure/shutdown/quarantine and actual selected identity
before enqueueing. Add only deliberately selected target repositories to the
service configuration according to [its owner](../../tools/service/config.js).
Then enqueue and start the same config/queue:

<!-- poc:recipe service-work shell=portable effects=queue-and-derived-build -->
```sh
node bin/pairofcleats.js service indexer enqueue --config "path/to/service-config.json" --queue index --repo "path/to/your-project" --mode code --json
node bin/pairofcleats.js service indexer work --watch --config "path/to/service-config.json" --queue index
```

Change the explicit queue token throughout when operating an embeddings-derived
namespace. Status on another class/namespace or the ambient default config says
nothing about this worker. Progress is bound to the claimed execution correlation;
a recent file or prior stage count does not prove owned current work.

## Intervene deliberately

Read-only diagnosis comes first. Retain job IDs, owner/claim evidence, failure
receipts and pending work before changing queue state. A zero exit only means the
requested operation returned; verify the intended queue/job actually recovered.

<!-- poc:recipe service-retry shell=portable effects=queue-state-write -->
```sh
node bin/pairofcleats.js service indexer retry --config "path/to/service-config.json" --queue index --job "job-id-from-inspect" --json
node bin/pairofcleats.js service indexer quarantine-job --config "path/to/service-config.json" --queue index --job "job-id-from-inspect" --json
```

Retry and quarantine are alternative deliberate decisions, not a sequence to run
blindly. Shutdown changes admission and drains/cancels according to the selected
mode; resume changes that same queue's shutdown state:

<!-- poc:recipe service-shutdown shell=portable effects=queue-admission-write -->
```sh
node bin/pairofcleats.js service indexer shutdown --config "path/to/service-config.json" --queue index --shutdown-mode drain --json
node bin/pairofcleats.js service indexer resume --config "path/to/service-config.json" --queue index --json
```

Preview repair cleanup against the same selected config and queue:

<!-- poc:recipe service-purge-preview shell=portable effects=read-only -->
```sh
node bin/pairofcleats.js service indexer purge --config "path/to/service-config.json" --queue index --job "job-id-from-inspect" --dry-run --json
node bin/pairofcleats.js service indexer unlock --config "path/to/service-config.json" --queue index --lock shutdown --dry-run --json
node bin/pairofcleats.js service indexer cleanup-orphans --config "path/to/service-config.json" --queue index --dry-run --json
```

Purge requires one `--job` or deliberate `--all`; `--all` covers every eligible
repair entry in this selected namespace. Removing `--dry-run` authorizes the
reported mutation and can irreversibly discard repair state/artifacts. Unlock
requires ownership-safe stale evidence; never use it to displace a live worker.
Orphan cleanup requires a reviewed candidate inventory. Keep live locks, snapshots
and original failure evidence. Do not use these interventions as routine readiness
spot checks against ambient production defaults.

Each running queue execution owns the persisted claim owner, version and expiry.
An independent deadline aborts its existing job signal when confirmed authority
runs out, even if replay loading or heartbeat I/O is still pending. The safety
margin is 5% of the lease, capped at 250 ms; normalized renewal intervals are at
most one third of the lease. Expiry is anchored to a monotonic deadline at claim
admission, with an additional wall-clock expiry check for this local queue.
Successful I/O extends authority only by a matching persisted expiry increase;
a minimum-interval no-write receipt, rollback of the wall clock or late renewal
cannot revive an abandoned execution. Missing claim receipts reject admission.

Lease loss stops renewal admission and skips stale completion. Pending producer,
renewal and cleanup work remains owned until actual settlement; the failed count
includes the abandoned execution. Structured diagnostics retain the execution ID,
owner/version, confirmed expiry, confirmation and in-flight ages, cancellation
reason and cleanup-pending state. Positive simulated fixtures use actual claim
receipt fields. These new expiry/lifecycle regressions are authored and unexecuted.

After an approved repair, inspect/status this exact config/queue again, then
verify selected job outcome and target mode readiness/known query. The config-A /
ambient-config-B sentinel, embeddings namespace and live-lock transcript fixtures
are **UNVALIDATED** in the current development batch; no live queue was changed.

## Operator diagnostics

Inspect the selected service without applying recovery actions:

```sh
node tools/reports/diagnostics-report.js --report queue-health,stale-jobs --config "path/to/service-config.json" --queue index --json
```

Omit `--json` for the human report. Both formats retain stale-job root causes
and concrete remediation. Structured actions carry the exact Node executable,
absolute service script/config, queue, job and inspected working directory.
Human commands preserve that working directory, including relative service
paths. Review the inspect output before taking a suggested retry or quarantine
action. If `--queue-dir` selects a directory different from the service config,
the report gives `STALE_JOB_RECOVERY_CONFIG_MISMATCH` and withholds executable
recovery actions until a matching service config is selected.

Risk reports accept `--report risk-coverage --repo <root>` or
`--report cap-heavy-risk-packs --context-pack <json>`. The latter retains the
producer's availability status, analysis code, reason, summary-only, degradation
and strict-failure fields. Disabled and summary-only results are warnings;
healthy uncapped output is OK; capped/degraded output is a warning; missing,
timed-out, invalid or unrecognized output is an error in the report.

`--report all` selects the reports applicable to the supplied inputs. Unsupported
or empty selections, missing required inputs and a selection that runs no report
fail as request errors. Valid reports keep a successful CLI exit status even
when they contain warnings/errors; automation can apply its own policy to
`summary.status`. No repair operation is performed by report generation.
