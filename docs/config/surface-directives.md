# Configuration surface governance

This is current contributor guidance. The [schema](schema.json),
[canonical loader](../../tools/dict-utils/config.js), runtime consumers,
[environment owner](../../src/shared/env.js) and
[generated inventory](inventory.md) determine accepted behavior. The old
[two-key hard-cut proposal](../archived/config-hard-cut.md) is historical design,
not an instruction to delete shipped settings or backends.

## Choose a public control deliberately

Prefer automatic policy for resource tuning and safe code defaults for stable
behavior. Expose persistent user intent in target configuration, per-invocation
intent through a command option, and only documented selected runtime overrides
or secrets through environment variables. When a setting has multiple supported
sources, its consuming owner must define precedence and test explicit false/zero.
Do not invent an env override by reading `process.env` in a new consumer.

A new public control needs a purpose, default, consumer, schema/CLI declaration,
meaningful regression and explicit reviewed budget change. Public-budget counts
are maintenance governance; they do not count every accepted internal/schema key
and are not an authorization or security boundary.

## Validate through the owners

Use [the configuration journey](../guides/configuration.md) to distinguish raw
schema validity, effective authority-filtered settings and live readiness.
Configuration IO belongs to the shared loader and environment/CLI owners;
consumers receive normalized options. Preserve user-owned trusted configuration
and repository authority filtering. Validation and previews never grant trust or
execute configured commands.

Unknown keys fail where the schema disallows them. Permissive map/extension
namespaces permit shape extension; they do not establish a runtime consumer.
Keep [inventory consumer warnings](inventory-notes.md) and generate affected
contract/inventory outputs using [registered generators](../tooling/generated-surfaces.json).
Avoid a second hand-maintained namespace/default list.
