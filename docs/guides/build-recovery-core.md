# Retained build recovery through the core API

The core `buildIndex` API accepts an explicit retained generation for inspection,
validation or publication retry. These options do not add CLI flags. The command
registry, TUI and viewer still need their own integrations with this API.

```js
const plan = await buildIndex(repoRoot, {
  recovery: {
    action: 'inspect',
    operation: 'validate', // or 'publish'
    indexRoot: retainedBuildRoot,
    modes: ['code']
  }
});

const result = await buildIndex(repoRoot, {
  recovery: { action: 'execute', plan }
});
```

Inspection reads bounded metadata from the exact repository-owned build root. It
reports missing completion evidence and an existing writer lease without taking
the writer lock, parsing source, loading models or changing the current pointer.
An explicit missing root never falls back to current/latest.

Execution compares the reviewed plan with current metadata and configuration,
acquires the existing repository writer lease, then rechecks the plan. Both
operations run normal artifact validation under the current validation policy.
`validate` retains the generation without changing `current.json`. `publish`
also rehashes each selected mode's completion seal and uses the normal publication
owner with the pointer identity captured by inspection. A changed pointer rejects
publication. Both operations report zero parsing, embedding and artifact rebuild
work. Existing failed phases and attempts remain historical evidence; recovery
records a separate durable attempt.

`ERR_RECOVERY_PLAN_STALE`, `ERR_RECOVERY_BUSY`, `ERR_RECOVERY_VALIDATION` and
`ERR_RECOVERY_GENERATION_MISSING` identify failures before publication. A
post-publication bookkeeping error has `ERR_RECOVERY_POST_COMMIT` and
`publication.status: 'published'`; retrying must not treat it as an uncommitted
generation. Inspect again before a subsequent transaction.

Stage2 completion is recorded in the existing mode publication record after its
writers drain and before optional embedding callbacks. The seal binds the exact
manifest and artifact bytes, repository/build/mode, dependency signatures,
originating attempt and available preprocessing source identity. Later mutation
of those mode files invalidates the seal. This is not an immutable graph snapshot
or authority to reuse that generation as the current working tree. Automatic
cross-generation reuse, missing-stage resume, graph capability publication and
idempotent reuse of a previously executed plan remain unimplemented. A missing
historical seal is reported explicitly.

Durable attempts can be compared through the same core API:

```js
const { comparison, lines } = await buildIndex(repoRoot, {
  compareAttempts: {
    before: { buildRoot: firstRoot, attemptId: firstAttemptId },
    after: { buildRoot: secondRoot, attemptId: secondAttemptId }
  }
});
```

The structured comparison and readable lines distinguish changed, unchanged and
unknown evidence. Source and discovery identities reuse preprocessing hashes.
Effective analysis flags, configuration/policy evidence, requested concurrency,
admitted/observed workers and completed mode artifact work remain separate.
Failed or active attempts are partial; mode counts are not summed into whole-run
totals. Missing implementation working-tree, dependency/native or historical
timing evidence cannot establish sameness or a causal performance explanation.
