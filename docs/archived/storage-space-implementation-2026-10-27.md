# Free-space observation and admission ownership — 2026-10-27

**Unvalidated source:** `d316a37ba9cace19e0fdd71f25c983a0cf9c856f`, tree
`b0bec14294c0868c8df788c236b6496e048d93b5`, branch
`codex/pr557-audit-repairs-20261012`. Windows x64, Node 26.12.1.
Local implementation checkpoint; not pushed or functionally qualified.

Free-space inspection previously projected every caught failure into an ordinary
incomplete report. That discarded independently pending resource observations;
an unsettled `ENOENT` also permitted another ancestor/native operation. The
existing failure-observation owner now captures original callbacks and receivers
before classification, retaining pending native or diagnostic/getter failures.
Confirmed ordinary errors still produce an incomplete observation. Successful
native replies must also be settled before their fields are inspected, and exact
accounting requires BigInt block size and available block count. Reserve arithmetic
remains exact and the existing thresholds are unchanged.

Write admission now captures one immutable capacity/path projection before an
await. A mutable provider response cannot inflate the capacity already inspected.
The actual provider observation stays required across inspection, publication and
return. Pending successful replies retain the existing admission lock/session;
explicit settlement releases that coordinator without repeating the failed work.
No new lease, recovery journal, deletion authority or eviction policy was added.

The reversible destination probe now retains function-valued failures unchanged,
just as the shared observation owner already does. Their original ownership
callback and receiver survive cleanup; coercing a function to text is no longer
allowed to discard that prerequisite. Original descriptor closure still precedes
probe-file unlink and session release. Cleanup cannot turn a failed write into a
successful probe.

Eleven **unexecuted** `shared/storage/free-space-observation/*` cases cover exact
arithmetic, ordinary errors, pending errors/ancestors/successful replies,
independent diagnostic ownership, invalid native fields, pending admission,
mutation during actual descriptor inspection, getter-owned work and callable
probe failure/recovery. They use disposable actual file/coordinator owners and
inert injected observations, acknowledge the original fixture owner before
recovery, and preserve roots if resource cleanup is unconfirmed. No symlink,
elevated token, GUI or arbitrary process command is required.

Static format/ESLint, changed JavaScript syntax, config budget, command inventory
generation and whitespace checks pass; shared-module analysis finds zero cycles.
Configuration inventory was refreshed. No functional fixture, native probe,
benchmark or publication front gate ran. These controls and existing destination,
reservation/admission and lifecycle checks must still execute on the resulting
candidate. #1267 common lifecycle/quota policy and #1574 custom/remaining backend
adoption remain open; this slice does not complete their broader acceptance.
