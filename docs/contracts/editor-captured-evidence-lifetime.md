# Captured editor evidence opening

VS Code's registered Open Captured Evidence command captures the original
context/risk publication object, repository root, serialized repository URI and
source rows before issuing its picker. Rows and nested row data are immutable;
the source choice must be the exact original item and the action must have been
offered by that picker. Mutating the published hit or repository object during
a prompt cannot substitute a different target. Replacing the publication or
starting a newer opener revokes the original operation's remaining UI authority.

Source-row capture admits at most 128 rows, 256 KiB of encoded JSON and 64 nesting
levels. These are encoded-size and nesting admission limits; serialization can
allocate transient data before the encoded-size check. They are not a bound on
all pre-serialization allocations. No new public configuration is introduced.

An exact range still requires the existing contained local source verifier, full
source hash, explicit UTF-16 coordinates, original opened document, URI, version,
clean buffer and exact returned editor. Checks after opening and displaying the
document fence later selection/reveal. A verified hash without exact UTF-16
coordinates opens the verified file and explains that no exact range is
available.

The verified-file-only branch derives its BOM-aware starting point inside the
same document authority from its original verified bytes; it does not need an
extra caller-side source read. All byte/buffer/version and native-await checks
remain, and no exact indexed range is inferred. Without a hash, freshness remains
unknown: the contained-path resolver admits only a file open, and a publication
check between opening its document and displaying it prevents a stale pending
file open from starting a
new display. This does not certify unknown source bytes or ranges.

Create Context from This Evidence passes the original opener's revocation
predicate into the existing collection owner. The collector checks both its own
keyed operation and that original parent through source/purpose prompts, packet
fetches, both preview displays, action choice and destination selection. A child
collection's current scope cannot revive a superseded parent opener. A false
parent observation is latched and a throwing prerequisite is retained exactly,
without diagnostic retries. This callback can revoke authority; it cannot grant
source, generation or resource-release authority.
The registered copy command forwards only its original node argument, keeping
additional native command arguments separate from that private prerequisite.

Original falsey failures and independent diagnostic/notification inspection
failures remain available separately in immutable returned failure evidence.
The opener uses the shared original failure snapshot and awaits its original
error notification. Reusing a frozen failure across deliberate attempts cannot
reinspect its message or lazy stack. An asynchronous notification rejection
remains an exact independent inspection value beside the original operation
failure, including when a newer opener supersedes it while notification is
pending. Completing that old notification cannot publish a new source action.
Informational notices are also awaited: the original publication is checked
again before an unknown-source notice can lead to file opening. Failed notices
retain their original failure; they cannot silently authorize the next action.
No observer-bearing error is adopted as proof that another owner settled. A
display, clipboard write or file write already accepted by its native boundary
is still awaited; revocation does not establish rollback or native cancellation.

Actual opener/operation/authority/collector and registered-command controls are
authored but **UNVALIDATED**. No tests, syntax/lint/format, bootstrap, editor,
child/native/IPC/browser/GPU/model, build or benchmark execution was performed.
Canonical producer qualification, real host behavior, accepted-write
interruption and performance acceptance remain separate.
