# Tool lifecycle approval file read

Status: **UNVALIDATED source and authored regressions**. No fixture, syntax,
format, bootstrap, CLI/child, executable, installer or native acceptance has run.

The existing lifecycle `--apply-plan` consumer reads the explicitly selected file
through `readVerifiedContainedFile`, with the same 1 MiB limit and cancellation
signal. It no longer performs a pathname read after a separate size check. The
existing reader rejects nonordinary/symlink paths, bounds allocation from the
opened descriptor and checks identity and size/timestamps after reading. A file
that grows or changes during the admitted read cannot reach plan application.

`readToolLifecycleApproval` is the actual CLI read boundary. The caller supplies
launch-selected absolute tooling root and tool identity again. File data cannot
authorize another target. The canonical plan version, kind, operation, plan ID
shape and matching absolute target must be present. The existing apply owner
still recomputes the current plan and requires the reviewed plan ID before any
mutating owner is invoked. This adds no approval prompt, flag or alternate plan
engine; an approval file is not a deletion or installation capability.

`TOOL_LIFECYCLE_PLAN_VERSION` names the existing version 1 identity for producer
and reader. Receipt vocabulary and operation behavior remain unchanged. Ordinary
verification stays read-only and does not execute or adopt a tool.

`lifecycle-approval-contained-read.test.js` authors actual disposable canonical
receipt/plan bytes and the real bounded reader. Controls cover normal read-only
apply, unchecked pathname-read refusal, invalid plan/target metadata, oversize,
growth after admitted stat, simulated symlink status without creating a link,
cancellation before open and unchanged consumer bytes. None has run. The reader
is reused as-is: this does not repair its separately unresolved FD-close error
composition, qualify hostile filesystem races or establish crash/native/resource
settlement proof. A failed read never starts the lifecycle apply operation.
