# Tooling cache contained resource

Status: UNVALIDATED source and authored controls, 2026-10-22.

The actual tooling cache JSON reader borrows its sync descriptor through
`withContainedFileSync` and the shared contained-file resource owner. Singly linked regular
file and byte-bound admission remains before payload allocation/read. Original
read/stat/close methods are captured before opening and used through confirmed
close. Parsed payload is returned only after close succeeds. Invalid progress,
short extent or changed identity/link/stat fields fail before accepting JSON.

Operation and independent close failures retain their original causes and exact
resource capability. Pending original native work gates actual descriptor close.
A failed numeric close remains generation-unknown, and no path/inode/EBADF or
external cleanup shortcut authorizes a retry. A first close that was blocked by
original work can occur after that original observation confirms settlement.

Persistent command-probe read/write/invalidation and pruning catches propagate
an actual contained-file capability instead of returning an optional miss/false
or continuing after it. Recognition validates the private resource identity;
ordinary read failures keep their existing optional-cache behavior. Schema,
producer/key qualification, eviction authority and cache byte format are unchanged.

The authored `tooling-cache-contained-resource` fixture uses disposable actual
JSON/cache producer/consumer owners and sync fds. It covers positive bytes/hits,
bounded/singly linked admission before read without physical links, invalid and
short progress, every falsey read plus independent close failure, original native
prerequisites and replacement negatives, numeric-generation refusal, and actual
persistent-cache failure propagation with unchanged bytes. No checks have run.

This does not retain the cache writer's separate admission lease/Dir lifetime or
category exclusion on behalf of a failed reader. Those coordinator lifetimes,
other successful raw-open borrowers, cross-process ownership and native/platform
qualification remain separate work. Fixture teardown supplies no resource
settlement receipt, and no completed issue is claimed.
