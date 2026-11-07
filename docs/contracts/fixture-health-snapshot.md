# Fixture-health verified snapshots

Every fixture-health evaluation owns independent content certificates, bounded
metadata and one decoded chunk traversal per required mode. Manifest, selected
chunk/file metadata, MinHash and risk-flow bytes retain full SHA256 authority.
The hash also includes the canonical mode root and each selected relative path,
byte extent and content digest. Stat identity is an invocation witness, never a
substitute for mutable content hashing on a later call.

Decoded metadata retention is limited to 1 MiB per member and 8 MiB total; the
certificate envelope is 65,536 members. The original reader limits, compression
bounds, contained descriptors and format/MinHash identities remain mandatory.
No complete raw artifact representation is retained by the health context.
Code risk tags, SQL dialects and chunk UIDs share the same decoded traversal;
other modes retain their original mode-specific decisions.

The checksum-only path publishes only after confirmed original descriptor close.
False close results, frozen/falsey read failures and independent close failures
retain the existing contained-file owner. Unsettled ownership escapes snapshot
classification before the fixture helper can enter destructive rebuild admission.
Explicit close-only recovery cannot publish a failed invocation's certificate.

The helper evaluates before locking, again inside the original cooperative lock,
and again after an actual rebuild. Contexts never cross those boundaries. The
real lock regression starts with a valid risk-enabled fixture and exact health
stamp, verifies warm content without rewriting that stamp, then damages bytes
while preserving size/mtime. Restoring test-owned content after real lock
acquisition models another holder completing repair. Only a new inside-lock
evaluation can observe that repair and avoid an unnecessary build.

The current-contract unfused reference retains the original compatibility →
authority → risk/SQL/UID consumption pattern. It uses current contained readers,
current MinHash rules and current authority framing; it is not an old checkout.
It drops completed decoded representations before the next projection. A verified
warm reference stamp may reuse semantic decisions after hashing current bytes.

Nineteen parity cases cover JSON/JSONL/gzip/shards, hot/cold merging, code-only,
three-mode, prose-only and records-only selection, empty JSON signatures, risk,
SQL/UID/watch negatives, incompatible modes, same-stat replacement and an explicit
linked-path classification injected over ordinary files. No new symlinks are
created. Packed MinHash still requires a positive count; empty signatures use the
supported JSON format. Complete same-root decisions and authority digests match
the independent reference. Root-bearing authority digests are preserved in raw
samples; only the cross-process decision digest omits them.

Eight serial work fixtures execute 24 fresh child processes. Each child has an
8-second bound; each outer fixture stays under 30 seconds with zero retries and
native redo disabled. Small/code/three scopes measure the first evaluation; warm
measures three fresh-content evaluations after explicit warmup. Filesystem pages
are warm from fixture creation. Descriptor reads, bytes, wall/CPU, sampled heap
and lifetime RSS are retained separately from fixture build time.

The cold code scope reads each chunk part once instead of four consumption
passes. Warm byte work is nearly unchanged, and full fresh decoding costs extra
CPU/time versus the verified-stamp reference. Qualification claims bounded work,
shared cold decoding and preserved authority; it does not claim universal warm
latency or memory improvement. See the [source-bound receipt](../archived/fixture-health-snapshot-closeout-2026-11-05.md).
