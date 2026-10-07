# Node runtime policy

Reviewed against official sources on 2026-10-05. This policy records selected
versions, not a claim that every platform has passed validation.

## Application runtime

- The compatibility floor remains `node >=24.15.0` in `package.json` and the
  lockfile. The patched native dependency graph requires that floor.
- `.nvmrc`, CI, nightly, CI Long and release jobs pin **24.21.0**. Keep native
  `node_modules` cache keys aligned with that exact version, OS, architecture,
  lockfile and patch set. The workflow contract reads `.nvmrc` and checks every
  Node pin and native-cache version.
- **26.10.0** is a separate evaluation target. It is not the release baseline
  and has no claimed macOS compatibility or performance result yet. See the
  [matched macOS comparison](../benchmarks/node-runtime-comparison.md).

The official [release schedule](https://github.com/nodejs/Release#release-schedule)
lists Node 24 as Active LTS, entering maintenance on 2026-10-20 and reaching
end of life on 2028-04-30. Node 26 is Current, with LTS scheduled for 2026-10-28
and end of life on 2029-04-30. These future dates remain subject to change.
The [official release index](https://nodejs.org/dist/index.json) supplies the
exact versions above. Node 24.21.0 includes intervening security updates after
24.15.0; the package compatibility floor is not a recommendation to stay on an
older patch/minor release.

## GitHub Actions runtime

The Node interpreter used by an action is separate from the application runtime
installed by `setup-node`. Setting `node-version` alone does not migrate other
actions away from Node 20.

This bounded migration selects the first Node 24 action major for each existing
action, retaining the existing inputs, archive format, release flow and token
permissions:

| Action | Selected major | Official runtime definition |
| --- | --- | --- |
| checkout | v5 | [action.yml](https://github.com/actions/checkout/blob/v5/action.yml) |
| setup-node | v5 | [action.yml](https://github.com/actions/setup-node/blob/v5/action.yml) |
| cache | v5 | [action.yml](https://github.com/actions/cache/blob/v5/action.yml) |
| upload-artifact | v6 | [action.yml](https://github.com/actions/upload-artifact/blob/v6/action.yml) |
| download-artifact | v7 | [action.yml](https://github.com/actions/download-artifact/blob/v7/action.yml) |
| github-script | v8 | [action.yml](https://github.com/actions/github-script/blob/v8/action.yml) |
| attest-build-provenance | v3 | [composite action and pinned dependencies](https://github.com/actions/attest-build-provenance/blob/v3/action.yml) |

`github/codeql-action@v4` is already on the Node 24 generation. Rust toolchain
selection remains unchanged. Hosted runners must supply a compatible runner;
Node 24 actions require Actions Runner **2.327.1 or later**, as documented by
[checkout v5](https://github.com/actions/checkout/releases/tag/v5.0.0).

Migration review:

- setup-node v5 adds automatic npm cache detection. These workflows already
  explicitly request `cache: npm`; their intended cache behavior is retained.
- Artifact paths, names, `include-hidden-files`, compression and download
  destinations are retained. Upload v5 and download v6 still declare Node 20;
  their next majors are the required runtime change.
- The current newest actions are not all the smallest compatible runtime
  migration: [github-script v9](https://github.com/actions/github-script/releases/tag/v9.0.0)
  changes ESM/Octokit imports; [download v8](https://github.com/actions/download-artifact/releases/tag/v8.0.0)
  changes hash-mismatch failure behavior; and attestation v4 wraps a newer
  generic attestation implementation. This patch does not mix those behavior
  changes into the runtime/security repair. Review future action upgrades
  independently; this selection does not imply every old major is supported
  indefinitely.
- Workflow contract checks must continue recognizing artifact and checkout
  steps after action-major changes, rather than silently bypassing checks that
  used to match only `@v4`.

Application dependency audits and action-runtime upgrades address different
dependency graphs. Keep `npm audit --audit-level=low` unchanged; passing a
runtime contract is not evidence of a clean live security audit or hosted CI.
