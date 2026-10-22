# Authored recipe contracts

Current executable examples can opt into the existing documentation tooling with
a stable marker immediately before the snippet:

````text
<!-- poc:recipe target-status shell=portable effects=read-only -->
```sh
node bin/pairofcleats.js config dump --repo "path/to/your-project" --json
```
````

Use `kind=config` for complete JSON/JSONC examples. Mark historical/proposed
snippets explicitly with `classification=historical` or `classification=proposal`
when they need an inventory entry; these are excluded with a stated reason.
Partial config fragments need a declared enclosing-path owner before validation;
do not pretend they are complete schema inputs.

`node tools/docs/check-authored-recipes.js --json` extracts snippets from the
curated source guides, retains file/line and recipe IDs, tokenizes portable/POSIX/
PowerShell argv without shell evaluation, and resolves the canonical command
registry plus imported executable option definitions. Shared handler assertions
cover required combinations such as service purge's job/all scope. Config snippets
use the current schema. Multi-step recipes must retain selected config/workspace
identity. This command never executes Markdown, installs a tool, downloads a model,
contacts services or cleans live data.

The machine-readable result reports structural, behavior and platform coverage
separately. A route with no exported option owner reports partial coverage;
unmarked snippets and effective-loader/behavior/platform cases remain explicit
exclusions. Structural acceptance is not a successful first result or runtime
qualification. Add a small disposable fixture for behavior, using supported
bootstrap and the normal runner's jobs/30-second/no-retry policy. Optional/native/
viewer/model cases must record prerequisites and unrun scope honestly.

The checker and `tooling/docs/authored-recipes-contract` regression are authored
but **UNVALIDATED** in this development batch. Generated references remain owned
by their registered generators; this barrier covers marked authored recipes and
does not replace command/help/generated-surface drift checks.
