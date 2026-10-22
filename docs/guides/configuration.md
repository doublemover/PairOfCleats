# Configure a target repository

Run these commands in the application checkout after its locked bootstrap.
The target's `.pairofcleats.json` is JSONC; merge chosen settings into the existing
object instead of replacing project policy with a copied template.

<!-- poc:recipe config-raw shell=portable effects=read-only -->
```sh
node bin/pairofcleats.js config validate --repo "path/to/your-project"
```

Raw validation checks schema shape. An explicitly named missing `--config` is
an error; an absent optional target config can use defaults.

<!-- poc:recipe config-effective shell=portable effects=read-only -->
```sh
node bin/pairofcleats.js config validate --effective --repo "path/to/your-project" --json
node bin/pairofcleats.js config dump --repo "path/to/your-project" --json
```

Effective validation uses the canonical loader, authority filtering and trusted
merge. Its source/ignored-path report explains why a schema-valid repository
setting may not take effect. It does not start language tools, verify a model,
download anything or establish index readiness. Human `config dump` also lists
the selected source layers and discarded authority paths.
Both effective validation and dump accept an explicit `--config <file>` with
the same selected-file and authority rules; a missing selected file is an error.
Dump keeps the runtime preview, policy and derived path fields and also reports
normalized selected provider/backend policy. Without `--capabilities`, its MCP
SDK availability is unknown rather than labeled missing. Diagnostic environment
inputs apply to embedding intent and canonical model/cache path selection;
observed process/startup values still describe the current process.

Defaults and automatic policy are followed by repository settings allowed by
repository trust, then separately selected user-owned trusted policy. Supported
environment overrides and per-command CLI options are applied by their runtime
consumers. The preview records selected values and provenance; CLI precedence is
command-specific. Explicit `false` and `0` are meaningful where the schema and
consumer accept them; do not replace them with truthy defaults.

For an untrusted repository, execution/storage authority such as provider
commands, paths, environment, auto-install policy and vector extensions can be
discarded. Review user-owned policy or deliberately review repository trust;
validation never grants trust. Keep credentials outside project examples.

Use the [schema](../config/schema.json) for accepted structure, the
[generated contract](../config/contract.md) for the public surface, and
[inventory notes](../config/inventory-notes.md) to find runtime consumers.
A permissive extension namespace does not prove an arbitrary key is consumed.
Resource/concurrency settings guide admitted work; they are not a fixed RAM cap
for parsers, subprocesses or every repository.

The [old hard-cut proposal](../archived/config-hard-cut.md) is historical design.
It does not remove currently accepted backends, namespaces or runtime overrides.
