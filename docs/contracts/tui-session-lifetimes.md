# Native session and transport lifetime

Status: source implementation, unvalidated (2026-10-22).

The native application owns its exact supervisor child through
`SupervisorLifetime`. Normal quit closes that child's stdin, observes final
events and enters the existing bounded shutdown/containment path. A terminal
read/draw error, supervisor exit, request-pipe failure or event-pipe failure uses
the same owner. A simultaneous cleanup failure is reported with the original
execution error retained as its cause.

Supervisor event input reads at most 128 KiB per newline-terminated frame before
JSON parsing, then uses the existing bounded ingress queue and turn budget.
Unicode frames retain their bytes. An oversized or incomplete final frame or a
read error closes the sender; drained transport disconnection while the child is
still alive ends the interactive loop and requests owned shutdown. Ordinary JSON
parse diagnostics retain their existing eight-message cap. Recorded files never
become a transport/control authority.

Initial and replenishment flow-credit writes report pipe failures. Credits are
cleared only after a successful write. Shutdown does not depend on sending one
more JSON request into a broken or full pipe: closing stdin is the graceful
request. The lifetime owner retains its platform containment fallback.

On Windows, termination uses only the job handle assigned to this supervisor.
`TerminateJobObject` errors are preserved; the subsequent bounded accounting
query must observe zero active processes before containment reports success.
Requesting termination or reaping only the supervisor does not prove descendants
have exited. A failed query or pending process count remains an error. This
process-family witness does not clear a canonical database owner's unresolved
storage exclusion or manufacture its authenticated native closure receipt.

Saved sessions keep their existing separate passive model, replay checkpoints,
virtual time and live background model. The picker now uses the same bounded
grapheme cursor and inert paste policy as the other forms. Its visible rows track
the exact selected entry across size changes. Cancelling a partially loaded page,
failing a load or replacing/detaching a replay discards the exact retained replay
capability when known; no other job or session is stopped.
The server capability binds the listed directory object, metadata revision and
ordinary log-file object. Replacing a directory/file or changing the selected
metadata requires a fresh selection. Invalid entries retain their original
diagnosis until relisted. An unfinished log may grow on the same object before
load; the returned bounded content hash still identifies the exact finite
snapshot read into the private replay owner.

Authored Rust sources cover bounded frames, Unicode/final-event delivery, partial
and oversized data, read failure, combined errors, picker editing/paste, all 64
selectable entries and exact replay discard. No Rust check, test, process,
terminal/ConPTY or Windows job-object acceptance ran during this source span.
The authored recording-identity fixture also covers metadata, directory and file
replacement, append-only snapshots and invalid-entry repair without retargeting.
