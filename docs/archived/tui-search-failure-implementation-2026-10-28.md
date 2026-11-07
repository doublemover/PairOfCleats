# Native search failure and recovery implementation

Source review for #1558, Windows-only solo implementation, 2026-10-28.
Source head `2abf062b44c413406ba8cff17fc09033e89c8f99`, tree
`e6d932de45d85e9864a6f78e4e3b08e0db17c885` (checkpoint 232).
Commits 226–232 implement the following owners. Their functional checks have
not executed; checkpoint 240 is the agreed full Windows validation boundary.

- A closed, bounded catalog supplies static explanations, optional field
  identities, enumerated actions and opaque diagnostic IDs. Its strict schema
  binds each reason to matching outcome/actions. Rust definitions are generated
  from it and registered for freshness checking.
- The child bridge reads only complete, bounded machine JSON error envelopes.
  Human stderr, private paths/messages and arbitrary codes are not display
  authority. Original child errors and cleanup observers remain private and
  authoritative through projection, including frozen failures.
- Supervisor settlement separates operation failure from successful retrieval
  diagnostics. Fresh admission rejection gets a terminal reply; duplicate IDs
  cannot finalize or replace accepted work. Resource-pending replies offer status
  inspection without retry. Status consults original session/supervisor owners.
- Rust separates failure, cancellation, timeout, pending cleanup and successful
  empty/nonempty responses. Empty-page wording requires an admitted success.
  Cancellation waits for actual terminal settlement. Failed continuation retains
  and labels its previous admitted page.
- Editing preserves the form; explicit retry keeps its original request/scope.
  Scope changes discard old failure/actions. Recovery opens registered index
  validation/tooling doctor forms without preview or launch; reservations, jobs
  and continuations prevent replacement. Setup inspection reads metadata without
  native probes, provisioning or elevated launches.
- Required-index failure could exit inside the metadata loader, bypassing the
  runner's JSON envelope and cleanup. JSON callers now throw through that owner.
  Ordinary advisory warnings remain enabled.

Existing native search test bodies moved to `search_tests.rs` unchanged except
whitespace, verified against the original module after removing its shared
import. No assertion/case was removed. Terminal expectations now observe static
failure presentation, retaining failure status, reaping, recovery, positive hits,
source, continuation, snapshot privacy and terminal restoration checks.

Authored controls cover projection/schema/privacy/malformed frames; supervisor
timeout/cancel/admission/resource ownership; original child cleanup; seven actual
supervisor/CLI causes and success controls; native model recovery/scope; and two
actual ConPTY first-failure/correction cases at 80×24 and 32×24. These are source,
not execution receipts. They use the production binary/supervisor path.

Cached format/ESLint, changed JavaScript syntax, Rust formatting, script-inventory
refresh and whitespace checks passed. An initial import-attributes draft failed
the existing ESLint parser; the final loader uses its supported syntax level.

Closeout remains: execute these and existing search controls on the frozen
Windows candidate; establish actual supervisor/native cause, privacy, pending
cleanup and keyboard coverage, adding any missing discriminating integration
case. Keep #1558 open. Native/ConPTY/runtime performance are not qualified by
source edits. Historical `.tmp` receipts belong to the author's workspace.
