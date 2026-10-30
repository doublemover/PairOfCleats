# Windows P2/P3 closure follow-up — 2026-10-30

Three additional reports are closed with `completed` state and individual
GitHub readbacks: **#1350, #1468 and #1623**. This follows the
[44-report delta](windows-p2-p3-closure-delta-2026-10-30.md).
Current program snapshot: **791 reports,419 closed/372 open**. The346-report
P2/P3 intake now has **331 qualified closures/nine remaining/six editor exclusions**.

Fresh checks use the published runtime/fixture source
`0276a5d33e96e0b41b33a8db77688af0eedb90a3`, Node26.13.0, Windows x64/ABI147,
one job, original30-second bounds, zero retries and native-status redo disabled.
All **15** focused cases pass; no failures, timeouts or skips.

- **#1350:** all four original LSP lifetime controls pass with the changed real
  pool/client owners: delayed close302ms, graceful timeout/confirmed force
  disposal8,199ms, kill timeout294ms, actual server exit296ms. Pending disposal
  retains ownership and replacement barriers; observers cannot mask failure.
  The [complete healthy phase drain](windows-native-phase-closeout-2026-10-30.md)
  passes three fresh cases and preserves its compiler-authority contract.
- **#1623:** the original actual A→B loaded/supplied normal-builder authority
  fixture passes13,475ms. Rejection preserves A's pointer, creates no B output,
  and settles the original lease/journal. Healthy A→A and permitted thread
  changes remain covered. Complete compiler-inventory/verifier equality and
  the original compiler-revocation negative pass independently.
- **#1468:** ten current-binary language checks pass: native Rust/Java/Python
  and CPython, C/Objective-C/C++, Ruby/PHP/Scala/Groovy/R lexical consumers and
  all three Perl package cases. The exact-original/current Perl counterfactual
  separately proves wrong roles/lost calls before the repair and complete
  canonical consumers afterward. Full authored ranges, LF envelopes and
  role-derived UID changes remain strict; producer identities invalidate reuse.

The [durable receipt](windows-p2-p3-closure-followup-2026-10-30.json) preserves
each current GitHub closeout and focused result. Relevant production owners and
original fixtures match the stated published source; unrelated new #1484 tests
were being prepared separately. Historical `.tmp/`/`.testLogs` files are author
receipts, not clean-checkout deliverables. No final-head full-suite result or
non-Windows execution is inferred.

The nine open targets are **#1384,#1413,#1484,#1541,#1542,#1544,#1627,#1733,#1767**.
The first two retain only requested editor exclusions; #1767 retains POSIX
physical-name work and #1627 compatible optional native Tantivy qualification.
The remaining Windows work is additional #1484 functional/memory acceptance,
actual model/admission costs and the full SQLite build/update campaign.
