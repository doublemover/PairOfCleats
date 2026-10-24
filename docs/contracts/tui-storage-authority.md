# Native storage selection authority

Status: source and authored regressions, unvalidated (2026-10-22).

The native storage adapter resolves its existing launch environment and scope,
then uses the same contained locator reader and selection overlay as the storage
CLI. Existing explicit environment precedence remains intact. Missing selection
uses the canonical default; invalid or unknown selection grants no fallback
authority. Storage roots can be shared by repositories.

Preview identity pins home, effective descriptors and the verified locator's
path/status/byte hash. Execution re-reads that identity before any operation,
including when the selected path stayed the same but selection bytes changed.
Cleanup retains its original canonical plan privately and still uses the existing
apply owner for exact file revalidation and exclusion. No configuration, migration,
cleanup threshold or lease contract changes.

Authored disposable-file controls cover selected-root preview/list, old-preview
rejection, actual canonical cleanup of only the newly selected cache, same-path
selection changes, explicit environment precedence and invalid locator refusal.
They have not run; native terminal/host and final Windows qualification remain open.
