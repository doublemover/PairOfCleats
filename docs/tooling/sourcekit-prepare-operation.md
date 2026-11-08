# Explicit SourceKit workspace preparation

The fixed preparation entry point is currently available as:

```text
node tools/tooling/prepare-sourcekit.js --repo <repository> --swift <absolute-swift-command> --json
```

The default invocation observes the selected executable bytes and passive
workspace preflight. It does not run Swift, resolve packages, publish a ready
marker or grant workspace execution authority. Review its effects and exact
repository/command selection before repeating it with `--apply`.

Apply requires an existing exact repository execution grant and a trusted
absolute Swift command. The SourceKit owner creates and verifies its existing
in-process operation plan, then receives that same plan in workspace preflight.
The only package command is `swift package resolve`. This may evaluate
`Package.swift`, fetch dependencies, modify `Package.resolved`, `.build` and
`.swiftpm`, and use the selected Swift environment's cache configuration.
SourceKit workspace loading may also evaluate build-server hooks or plugins.
Preparation adds no separate cache manager or cleanup authority.

The operation uses a bounded 30-second child deadline and immediate lock
admission. Cancellation and unresolved child teardown preserve the existing
preflight/managed-command resource owners. A failed apply reports an unconfirmed
application state because package writes may already have occurred.

Successful output means workspace/package preflight completed. It does not
qualify a Swift installation, compile the project, start SourceKit or establish
consumer readiness. Its plan identity is diagnostic data. A report, JSON
round-trip, historical marker or repository configuration cannot grant a future
workspace load; that operational caller needs its own current in-process plan.
Ordinary indexing continues to use the passive admission contract.

The source includes trusted fixture coverage for preview, explicit apply,
revoked trust, cancellation and rejection of serialized authority. Those
fixtures and real supported-platform Swift operation remain unexecuted in the
parallel implementation wave.
