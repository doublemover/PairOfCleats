# Spec: VFS token URIs (draft)

Status: Draft (Milestone A). Optional tooling enhancement.

Goal: provide stable, deterministic URIs for LSP servers that change when document content changes, while preserving human-readable virtual paths.

Non-goals:
- Replace `file://` fallback when required by a server.
- Change `virtualPath` or `docHash` definitions.

---

## 1) Token derivation (normative)

Token inputs are controlled by configuration (`tooling.vfs.tokenMode`):

- `virtualPath`: `tokenSeed = virtualPath`
- `docHash`: `tokenSeed = docHash`
- `docHash+virtualPath`: `tokenSeed = docHash + "|" + virtualPath` (default)

Compute:

```
token = xxh64(tokenSeed)
```

Token MUST be lowercase hex (16 chars for xxh64).
If a `docHash`-based mode is selected and `docHash` is missing, producers MUST fall back to `virtualPath`.

If hash routing is enabled, the routing token MAY be reused as the URI token.

---

## 2) URI format (normative)

`poc-vfs` scheme with token query parameter:

```
poc-vfs:///<encodedVirtualPath>?token=<token>
```

Encoding rules:
- Each path segment MUST be encoded with `encodeURIComponent`.
- Only the query parameter is added; the path is still recognizable.

---

## 3) Behavior

- If the token changes, the provider MUST treat the document as new.
- If token mode uses `docHash`, changing content MUST change the token.
- For `file://` URIs, the token influences disk path via hash routing (see `docs/specs/vfs-hash-routing.md`).

---

## 4) Invariants

- Token MUST be lowercase hex and deterministic.
- Tokens MUST NOT be derived from untrusted input without hashing.

---

## 5) Related specs

- `docs/specs/vfs-hash-routing.md`
- `docs/specs/lsp-provider-hardening.md`
