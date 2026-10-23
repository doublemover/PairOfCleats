# Encoding budget and original resource failures

Status: UNVALIDATED source implementation and authored controls.

The existing bounded evidence encoder, source-linked input capture, report finalizer,
source-linked writer and finite-may checker distinguish encoded byte exhaustion
from pending original work before mapping an error code to a budget result. Each
actual catch captures the original storage observation, requires settlement, reads
the diagnostic code safely and requires the captured original again. A code getter
cannot replace its observer or introduce an independent falsey/pending failure that
is lost during classification. Producer error factories are guarded similarly.

Ordinary settled JSON budget exhaustion keeps its current provider error or the
checker's unknown/encoded-byte-allowance frontier. Remapped errors retain the
captured original through the existing failure compositor. Pending original work
propagates with the existing private resource/session authority and cannot become
an ordinary budget diagnostic, accepted report, published sidecar or checked fact.
There is no replacement resource owner, implicit close retry, callback replay,
changed encoding, relaxed byte limit, new store or new public option.

The authored fixture first acquires a real contained descriptor whose original
FileHandle close rejects with the same diagnostic budget code. It sends that
original retained failure through all five catches and the existing sidecar and
checked-summary entry points, checks no publication/inventory admission, and then
recovers only the original session without rereads. It also authors diagnostic
getter mutation, independent falsey/pending inspections, throwing/mutating producer
factories and ordinary settled budget controls. These have not been executed.

This is a failure-admission repair. Successful producer, report identity, artifact,
checker/transfer and schema meanings are unchanged. Arbitrary caller/proxy memory,
provider/native/transport lifetimes, durable proof/source-language soundness and
runtime/performance/full-index qualification remain separate and open. It claims
no broad issue closure or measured speedup.
