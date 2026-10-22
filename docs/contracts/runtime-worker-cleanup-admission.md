# Runtime worker cleanup admission

Status: **UNVALIDATED** source and authored controls. No cleanup, worker, native,
test, syntax, formatting or bootstrap execution has been performed.

Worker pool selection and destroy-method capture occur inside the existing
bounded runtime teardown step. A throwing owner/method getter is a cleanup
failure; it cannot skip logger, parser, replay, cache-writer or subprocess
cleanup, or bypass retention of the actual runtime storage owner. One selected
pool and its original destroy method/receiver are used together. The ordinary
plural pool and legacy singular fallback remain supported, in their existing
scheduler-before-workers order and cleanup deadline.

The existing actual category-session fixture adds falsey owner-getter failures,
retained category admission, later logger cleanup and original plural/singular
method/receiver controls. They are unrun. Multi-error observation composition,
other runtime property acquisition, late native operations, failed-close retry
safety and complete current-source Windows qualification remain separate work.
