# `@vue/compiler-sfc`

**Area:** Framework parsing (Vue SFC)

## Why this matters for PairOfCleats
Parse `.vue` single-file components into descriptor blocks with accurate location mapping; enables separate chunking of `<template>`, `<script>`, `<style>`.

## Implementation notes (practical)
- Use `parse()` to get the SFC descriptor and per-block `loc` mappings.
- Use `compileScript()` for `<script setup>` transforms and binding metadata if needed.
- Treat generated code carefully: store original locations and map back from transforms.

## Where it typically plugs into PairOfCleats
- Emit separate chunks per block plus a synthetic 'component summary' chunk (props/emits/imports).
- Record cross-block relations (template uses script bindings).

## Deep links (implementation-relevant)
1. Vue SFC tooling API overview (parse/compileScript/compileTemplate) — https://vuejs.org/api/sfc-tooling.html
2. Source: parse() implementation (descriptor blocks + loc mapping) — https://github.com/vuejs/core/blob/main/packages/compiler-sfc/src/parse.ts
3. Source: compileScript() (script setup transforms; binding metadata) — https://github.com/vuejs/core/blob/main/packages/compiler-sfc/src/compileScript.ts

## Suggested extraction checklist
- [ ] Confirm you can obtain stable node/section ranges (`start/end` offsets or line/column).
- [ ] Identify the minimal AST traversal/query approach that yields needed metadata (avoid full transforms unless required).
- [ ] Decide what becomes chunk metadata vs. what stays as derived indexes (postings/relations).
- [ ] Note any performance pitfalls (per-file program creation, per-node FFI, full-file buffering).