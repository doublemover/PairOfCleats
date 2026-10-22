# Tool installation ownership and lifetime

This describes authored source interfaces. The current implementation and
fixtures are **UNVALIDATED**; no installation, protocol handshake, platform
qualification or lifecycle acceptance is established by this document.

## Receipt strength

`tools/tooling/install-receipts.js` records an observed consumer, its physical
bytes, recipe identity and verification level. Observing an existing executable
does not adopt its installation directory or grant deletion authority. External
system/user/project tools retain their existing owner.

`tools/tooling/managed-install.js` separately owns installations created from a
canonical pinned descriptor: approved immutable HTTPS source, exact archive
size/SHA256, platform/architecture, contained layout and mandatory verifier.
It stores immutable generations and receipts below `toolingRoot/installs/<id>`.
`descriptorId` identifies the recipe; `installId` identifies the physical
generation. Repair of damaged bytes publishes a distinct generation with the
same descriptor identity and retains the damaged evidence.

The selected locator is published only after layout/byte verification and exact
verifier resource settlement. Live consumer leases prevent selection replacement
and removal. Failed updates retain the previous selection. A verified sibling
can be selected later without downloading it again. Removal acts on one intact,
selected, owned, idle generation; other generations and receipts remain.

## Allocation admission

Canonical recipes declare complete additional allocation bounds for every
destination, including archive/expanded artifacts, staging and package/build
caches. The internal declaration is:

```text
storageEstimate: {
  complete: true,
  writes: [{
    destination: "artifacts" | "scratch",  // or environmentKey, or absolute root
    requiredBytes: <inclusive additional allocation bound>,
    minimumFreeBytes: <optional nonnegative reserve>,
    hardBytes: <optional nonnegative logical-byte budget>
  }]
}
```

Each entry has exactly one destination selector. `environmentKey` binds to the
actual child-local environment location; an absolute `root` is explicit.
The installer binds these declarations to actual artifact and secondary write
paths and invokes shared storage admission with
`{writes:[{root,requiredBytes,minimumFreeBytes,hardBytes}]}`. Coverage cannot omit
the artifact root when secondary environment paths are overridden. Foreign or
incomplete destination authority defers writes through the storage owner.

An archive's compressed length alone does not bound extraction or transitive
package builds. Missing estimates defer before SDK/package acquisition and
directory preparation. Admission never cleans existing assets to fit. Existing
compatible selections can be reused without reacquiring an archive. The generic
archive and Go SDK publication boundaries also require admission before writing.
Current recipes without qualified complete bounds remain deferred.

## Actual resource settlement

`runToolInstallChild` uses the shared async subprocess owner and
`runManagedChildWithStorage` across preparation through actual child close or
confirmed tree termination. The generic publication wrapper holds shared storage
sessions and destination reservations through its archive/staging/verifier work.
All use the existing state `storage-access` coordination namespace.

A managed verifier receives `resourceId` and must return an exact
`{resourceId,settled:true,pending:false}` settlement with its result. A verifier
throw without equivalent settlement retains stage/locks/leases and exposes
`managedInstallSession`. Pending storage sessions and write reservations remain
on the error; nested child-storage handles are retained separately. The primary
operation error survives cleanup failure. Release occurs only after the actual
resource owner confirms settlement.

The read-only `resolveManagedToolInstallation` locator verifies selected receipt
and consumer command bytes. It does not pin a runtime lifetime. Consumers must
hold `retainManagedToolInstallation` until their actual owned children settle.
Structural search currently adopts configured selection and a command-byte
recheck; complete scoped lifetime adoption by structural/LSP/provider consumers
remains separate integration work. Installed bytes, executable/runtime checks,
protocol capability, model inference and project qualification remain distinct.

The legacy Go SDK owner retains its official-index/full-layout verification and
now uses admission at its writer boundary. Its synchronous verification adapter
and real SDK/consumer lifetime still require platform proof. Concrete portable
language descriptors, full package integrity closure and every operational
feature recipe are not implied by these generic interfaces.
