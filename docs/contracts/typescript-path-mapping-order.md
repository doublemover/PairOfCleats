# TypeScript path mapping order

Implementation status: UNVALIDATED. The authored compiler-control fixture has
not been run.

The import resolver selects one eligible `paths` key before examining its target
array. An exact key wins over wildcard keys. Otherwise the longest matching
prefix before the wildcard wins; equal prefix lengths preserve configuration
declaration order. The suffix must match, but a longer suffix is not a second
precedence rule. Replacement entries of the selected key retain their declared
order. A missing selected key does not fall through to a different matching key.

The source rule follows `matchPatternOrExact`, `findBestPatternMatch` and
`tryLoadModuleUsingPaths` in the installed TypeScript implementation. Star
replacement occurs only for a nonempty captured star. An exact/empty capture
leaves a replacement star literal, rather than resolving an invented directory
or `index` source. Configurations with multiple stars remain outside the
compiler-admitted path profile.

`TS_PATH_MAPPING_VERSION` participates in the existing per-config fingerprint.
The existing importer cache compares that fingerprint before reuse, so unchanged
config bytes cannot admit outcomes from the prior selection algorithm. This is
an import-resolution cache meaning change; canonical compiler binding production
continues to use the compiler's own resolver. The shared `importResolution:4`
producer also changes the existing semantic policy identity so derived replay
cannot reuse import meaning from version 3. Compiler binding and CFG producers
retain their independent versions. No second configuration parser,
repository scan or global cache store is introduced.

The authored fixture creates bounded task-owned files and compares the local
helper with `ts.resolveModuleName` for equal-prefix order in both directions,
exact/longer prefixes, selected-target fallback, a missing winning key and
empty/exact star substitution. Supported-runtime execution, published import
graph acceptance and broader package/module-resolution parity remain pending.
