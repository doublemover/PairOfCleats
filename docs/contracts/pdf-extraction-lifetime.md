# PDF extraction resource lifetime

The existing PDF extractor captures each acquired loading/document resource and
its original destruction method/receiver. Current installed pdf.js exposes no
document-proxy destroy method; its loading task owns the transport. That optional
absence remains valid. A separate provided document disposer is independently
owned, while a missing required loading-task disposer remains unknown.

Disposal keeps the actual destruction promise through the existing two-second
bounded wait. A timeout is not closure and cannot start a second destruction of
that same resource. Successful closes are remembered; observed failures retry
only through the exact nonenumerable `pdfExtractionSession`. Explicit release
joins existing work before retrying a failed original method. Actual native
retry safety remains unqualified.

Accepted loading/page work remains part of the extraction lifetime after its
caller times out. A late document is retired before page use, and original
pending child observers keep their original receiver and authority even without
a true pending flag. All independent observers and resource closes must confirm
before the extraction owner reports settled. Pending owners remain reachable
through the existing extractor's process-local capability inventory.

Frozen extraction failures retain every independently attempted disposal failure.
Page work and page cleanup failures remain separate exact causes; cleanup cannot
replace the original exception. The top-level PDF consumer propagates an owned
pending lifetime instead of converting it into an ordinary skipped extraction.
The retained failure explicitly forbids automatic operation retries, including
the existing Stage1 queue and shard retry owners. A retryable primary cannot
override this retirement policy or start a replacement extraction while original
work remains pending. Recovery uses only that exact owner's disposal capability;
ordinary independently retryable queue work retains its existing behavior.
Settled unsupported/failed documents retain the existing permissive policy and
failure-reason contracts. No successful text meaning or producer version changes.

The authored fixture exercises actual extraction, late loading, original methods,
the existing cleanup wait, frozen/page errors and observer reconciliation with
inert PDF objects. It is unvalidated. Real pdf.js worker/platform behavior,
permission/full-disk failures, native retry safety, extraction quality, memory
and end-to-end Windows acceptance remain separate qualification.
