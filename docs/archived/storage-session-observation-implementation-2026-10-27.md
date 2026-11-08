# Storage session action and receipt observations — 2026-10-27

**Unvalidated source:** `99d84d2c534c92b4cefd022353dee366c49bccaf`, tree
`e01fece89b3be9c36b337a27e1eb690926e132c4`. Branch
`codex/pr557-audit-repairs-20261012`; Windows x64, Node 26.12.1.
Local source checkpoint, not pushed or functionally qualified.

The common session adapter previously captured only rejected action values.
Successful resource-bearing values and settlement receipts could carry an
unconfirmed original observer while metadata was released. Receipt fields were
also read live. The failure wrapper swallowed observer exceptions and could
discard independently pending inspection work.

The existing adapter now captures action observations before calling the
original settlement owner, including successful values, callable and falsey
failures. Settlement remains the resource owner's disposal opportunity. Receipt
observations precede field reads; immutable captured fields and rechecked action
and receipt prerequisites precede exact metadata release. Direct session receipt
validation uses the same projection. No new session/recovery/deletion owner exists.

Failure attachment uses the existing storage composer to retain original
callbacks/receivers, independent observer/getter/descriptor errors, frozen primary
capabilities and nested session handles. Mutable primary identity is retained
when attachment is possible; fallback keeps the exact original cause. Captured
callbacks are sealed against report mutation. Resource settlement is distinct
from explicit metadata release and grants no path-derived cleanup authority.

Eleven **unexecuted** `shared/storage/session-resource-observation/*` cases use
actual disposable metadata leases with inert native-resource controls. They
cover successful results, callback replacement, pending/getter/mutating receipts,
independent observer work, mutable/frozen/callable/falsey primaries and direct
session receipt admission. Existing original-closure, nested/frozen-error,
unconfirmed-resource and partial-admission checks remain required unchanged.

Format/ESLint, changed JavaScript syntax, config budget, generated command
inventory and whitespace checks pass; shared-module analysis reports zero
cycles. No functional fixture, native binding, child, benchmark or publication
front gate ran. #1267/#1574 common lifetime adoption and full current-candidate
qualification remain; this is not whole-session, cleanup or crash acceptance.
