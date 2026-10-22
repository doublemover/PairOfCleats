# Reviewed machine-local command-probe policy

`storage policy-plan --category command-probes` previews a machine-local policy.
`--entry-limit`, `--hard-bytes`, `--max-age-ms` and `--enabled` are optional;
omitted fields preserve the current selection or legacy defaults. Defaults are
256 entries, 2 GiB logical bytes, 30 days maximum age and enabled. Numeric zero is
literal zero and bypasses cache use. `--enabled false` bypasses reads, writes and
invalidation while preserving existing bytes. Portable repository configuration
does not own this policy.

Save the preview JSON and review its exact `planId`. Apply using
`storage policy-apply --home <same-home> --category command-probes --plan <file>
--plan-id <reviewed-id>`. Publication changes only `config/storage-policies.json`
under the selected application home, with a create-only, hash-bound selection
receipt in `config/storage-policy-selections`. A changed prior locator, changed
receipt, wrong home, category or plan ID rejects publication. Configuration is
not a cleanup plan and does not remove or relocate cached bytes.

The real command-probe reader, writer and prune owner consume this policy.
Future writes admit their serialized bytes before publication; cooperative
writer exclusion protects producer-owned pruning. Entry count and logical byte
bounds use exact arithmetic. The existing 8 MiB single-entry bound remains.
Age is based on the producer creation timestamp, and an explicit caller TTL may
shorten it. Read hits do not write last-use metadata. Invalid policy metadata or
missing immutable receipts disable cache use and leave bytes untouched; doctor
and explain report the invalid policy.

Eviction still requires complete current producer, filename/key and regular
file identity. Unknown files, additional retention/reference/pin fields,
unreadable entries and incomplete inventories cannot be removed to admit a
write. A marker alone is insufficient. Disabled or zero-limit categories are
inspectable but are never automatically cleared. This policy currently covers
command probes only; it is not a whole-application quota or physical disk limit.
Runtime, interruption, platform, concurrent-writer and measurement acceptance
remain deferred; source and regressions are authored but unvalidated.
