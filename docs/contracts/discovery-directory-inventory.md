# Discovery directory reuse for imports

The existing filesystem discovery traversal records bounded raw name/kind rows
before source-mode, generated-file or ignore filtering. A directory is admitted
only after complete enumeration, original directory closure and unchanged known
device/inode/time identity. SCM-selected files do not create directory coverage.
Receipts are private to actual arrays in one invocation, with at most 4,096
directories and an 8 MiB row/label accounting allowance. Partial, cancelled or
over-budget directories are discarded as completeness evidence.

Mode filtering, preprocess projection and the indexer's ordering owner explicitly
forward that original private inventory. Copying source record fields, serializing
an array or a different root cannot reconstruct completeness. No public setting,
persistent/global path cache, extra enumeration or filesystem namespace is added.

Import existence construction checks the original root, canonical directory and
metadata snapshot before reusing rows. Its own ignore policy still determines
which child directories to scan: uncovered or differently filtered directories
use normal bounded traversal. Unsupported/oversized/generated source files can
remain valid import targets because selected code files never define completeness.
Existing scan caps, link-prefix unknown results, read errors and standalone use
retain their contracts. Reused directories are checked again before publishing
the index; changed subtrees provide neither positive nor negative authority.
Private discovery arrays obtain positives from admitted raw rows or actual delta
enumeration, rather than seeding old selected records after directory changes.
Unvisited entries under a scan cap remain unknown. Standalone caller arrays keep
their existing seed contract; this does not qualify arbitrary old caller seeds.

These are filesystem observations rather than an atomic filesystem snapshot;
adversarial metadata restoration and arbitrary concurrent path replacement remain
separate qualification. Directory metadata/canonical checks have their own cost.
Avoided directory enumeration is not a measured end-to-end speedup. Native Dir
closure, source-input mutation, large 100/10,000-file workloads, retained memory,
real import-resolution parity and current Windows limits still need acceptance.

Actual small discovery/preprocess/ordering/import regression controls and a
synthetic 10,000-row/budget data-owner control are authored and **UNVALIDATED**.
No tests, syntax, formatting, bootstrap, native execution or performance campaign
ran. A synthetic row count is not a 10,000-file disk measurement. Import producer
identity advances for changed discovery-array existence admission; public
artifact formats remain unchanged. Ignored/unknown evidence is not
upgraded by a source-mode selection or receipt existence alone.
