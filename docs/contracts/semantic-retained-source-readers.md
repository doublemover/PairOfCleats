# Retained source reader ownership

Status: UNVALIDATED source implementation and authored regression.

Artifact source excerpt hydration uses the existing verified contained-file reader
with the retained header's exact byte length/hash and the existing decoded-source
allowance. It allocates at most that admitted length and reads in at most 64 KiB
operations. A source growing after the initial descriptor stat cannot trigger an
unbounded `readFile` allocation. Successful bytes reach decoding and request-local
reuse only after final identity/hash checks and confirmed original descriptor close.
Caller cancellation during successful closure is rechecked before projection.

Streaming `verifySource` borrows the same existing contained descriptor owner with
64 KiB scratch. It consumes at most the pinned byte length plus one EOF probe byte,
checks the descriptor's initial/final size and timestamps, original byte/text hashes,
fatal UTF8 decoding, retained text length and complete scalar span boundaries, then
rechecks containment/file identity before original closure. Identity fields and
requested boundaries are captured before awaits, without copying source line-start
inventories. Mutating a supplied header cannot replace its expected hashes mid-read.
Binary sources keep their existing separate empty-text/hash semantics.

Ordinary descriptor size/hash/change/containment failures retain semantic-integrity
classification, independently of response/decoded-source output limits. Error
remapping first captures and confirms the original storage observation, safely reads
the code, and confirms the original again. Pending original closure and independent
falsey/pending inspection failures propagate with their existing private recovery
sessions. There is no implicit retry, read replay, replacement owner, cross-request
source cache, working-tree fallback or additional public limit.

The authored real partition/store regression covers short reads and scalar/BOM/CRLF
preservation, growth after descriptor stat, exact byte/scratch bounds, original
close faults plus falsey read failures, close-only recovery without rereads,
cancellation during closure, supplied identity mutation and same-size source edits.
Existing scalar-split and output-limit controls remain authoritative. No fixture,
native/provider/full-index/runtime or performance qualification was executed. This
does not change successful semantic producer/artifact/schema identities or claim
complete lease/transport/abandoned-callback closure or measured speedup.
