# Proven dependency retirement — 2026-10-27

Source `1515ad0a8ebfb7c3125ffd5570f3e86e79133837`, tree
`56f256459bd2f5873c66f77f824c0bccfe0536fc`, branch
`codex/pr557-audit-repairs-20261012`. Functional regression execution is deferred.

## Evidence and changes

The five retired direct roots were `@ast-grep/napi` 0.40.5, `@swc/core` 1.16.13,
`@mdx-js/mdx` 3.1.1, `@vscode/ripgrep` 1.17.0 and `tree-sitter-lua` 2.1.3.
Before removal, the complete lockfile graph gave each only one incoming edge:
the root dependency declaration. Tracked source/configuration/editor/tool/test
searches were followed through actual dynamic and executable owners:

- Structural search resolves a separate canonical managed/external ast-grep CLI;
  the NAPI package has no executable export or API consumer.
- JavaScript parser/version selection is Babel/Acorn/Esprima. MDX dispatch uses
  the Markdown chunker; no selected SWC/MDX compiler consumer exists.
- Dictionary discovery uses PATH rg with filesystem fallback; no package rgPath
  consumer or executable export bridges bundled ripgrep to that command.
- Lua's native registry exclusively names the scoped grammar; bootstrap derives
  its native package list from that registry. Route/caps strings naming
  `tree-sitter-lua` remain logical identities and were preserved.

The manifest and three stale SWC/ripgrep/unscoped-Lua install permissions were
removed. `npm install --package-lock-only --ignore-scripts --offline --no-audit
--no-fund` regenerated the lockfile successfully. It removed 110 package records;
retained versions, resolved sources and integrity values did not change. Arrow
18.1.0 still satisfies LanceDB's explicit peer range; esquery 1.7.0 still has its
jsdoccomment/ESLint consumers. NAN 2.29.0 remains required by optional RE2. No
unrelated transitive dependency or supported parser/CLI route was removed.

The new curated ownership inventory records these positive ownership exceptions.
Its authored `tooling/install/dependency-ownership-inventory` regression checks
actual manifest/lock/native registry, stale permissions and retained peer/
transitive edges. It does not decide removal from grep alone. January dependency
research sheets/coverage are explicitly deprecated as active inventories;
historical JSON snapshot data is preserved and its bundled-ripgrep claim is
superseded in the guide, bundle and package sheet.

## Fresh setup evidence

After the dependency change, **`npm run bootstrap:ci` exited 0** on Node 26.12.1,
Windows x64, ABI 147. Locked install, patches, native builds and verification
completed and saved a fresh readiness receipt: **37 verified required packages,
33 activated language routes, 8 patch packages / 26 target files / 61 hunks**.
The complete 21,383-byte log contains **zero warning/error/failed matches**.
Optional sharp was absent and explicitly outside required setup; no required
package was skipped or substituted.

Manifest SHA-256: `2b47fe661003f3f14c698ee021dfef79b0c6bd036a89d2d6e620da7c3993cab2`.
Lockfile SHA-256: `35831a7c495558296c31fbe8d9dcff73cc80ad5f0d13c3d84362fceec5efb498`.
Bootstrap log SHA-256: `a9406ee0451620057c2b7a1cabadbefa09ef5930dfa68e543042a58aacd7c955`.

Author-workspace log and original lock-graph comparison are historical local
receipts under `.tmp/tasks/dependency-roots-20261027/`; clean checkouts do not
contain them. The readiness file remains ignored task-local setup state.

Format/ESLint, config budget, JavaScript syntax and whitespace checks passed;
the command inventory was refreshed through its owner. No project functional
fixture or publication front gate ran. #672/#681 remain open for their focused
Lua/parser/MDX/structural/dictionary/LanceDB checks and complete acceptance.

Separate source `506cd2acbae600712ef717db2ebdf4a50768ffe6`, tree
`94054062cbf409884c61ef99956df9d947f185f4`, adds `windowsHide:true` to the direct
benchmark worker, build/retrieval child and report child launches. The existing
worker/settlement tests remain; no redundant property-only test or functional
run was added. This is source suppression of another window path, not observed
whole-benchmark/native process-tree qualification under #1675.
