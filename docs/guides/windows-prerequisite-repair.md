# Review Windows prerequisite repair

This source is **UNVALIDATED**. No installer, compiler, download or machine change
was executed while implementing it. Ordinary locked bootstrap still uses the
existing readiness, patch and native activation gates.

`tools/setup/prerequisites.js` is a dependency-free plan/apply entry. Planning
checks a user-acquired local bootstrapper and the explicitly selected Visual
Studio instance. It does not download an installer. The canonical provider is
Build Tools 2022 17.14.42; its version and build are recorded in Microsoft's
[release history](https://learn.microsoft.com/en-us/visualstudio/releases/2022/release-history).
The fixed source URL and SHA256 come from Microsoft's
[versioned package manifest](https://raw.githubusercontent.com/microsoft/winget-pkgs/master/manifests/m/Microsoft/VisualStudio/2022/BuildTools/17.14.42/Microsoft.VisualStudio.2022.BuildTools.installer.yaml).
Actual local length, SHA256, product/file version, signer subject, thumbprint and
native Authenticode status are inspected separately. A URL path alone is never
used as a checksum receipt. No security or execution policy is changed.

Create a request with explicit absolute paths. `mode` is `install` or `modify`;
`arch` is `x64` or `arm64`. A modify request requires the exact registered,
complete Build Tools 2022 instance. It does not select another edition or
overwrite an unknown existing directory.

```json
{
  "mode": "install",
  "arch": "x64",
  "installPath": "C:\\DeveloperTools\\BuildTools2022",
  "bootstrapperPath": "C:\\ApprovedInstallers\\vs_BuildTools.exe",
  "stateRoot": "C:\\DeveloperTools\\PairOfCleatsPrerequisiteState"
}
```

The invocation contract is:

```powershell
node tools/setup/prerequisites.js --plan prerequisite-request.json --json > prerequisite-plan.json
node tools/setup/prerequisites.js --apply-plan prerequisite-plan.json --approve-system-changes --accept-installer-terms --json
```

The current official metadata does **not** establish the complete installation
allocation for each package/cache/shared-component destination. The shipped
provider records this as unknown and returns
`deferred-unknown-system-destination-allocation`. Apply remains blocked even when
approval flags are present. Bootstrapper length is not expanded payload size.
A canonical provider with qualified destination evidence is required to enable
that action; editing a saved plan cannot supply it. Git, Python and initial Node
installation repair remain manual prerequisites, described in
[checkout prerequisites](bootstrap-prerequisites.md). No arbitrary installer or
ad hoc machine command is accepted as a replacement recipe.

Once a canonical provider has complete evidence, apply reconstructs its argv
from current source, rechecks the target/installer and implementation identity,
takes the existing apply lock and waits on the real vendor child. The selected
components are the C++ build workload, target tools and Windows 11 SDK component
listed in Microsoft's [component directory](https://learn.microsoft.com/en-us/visualstudio/install/workload-component-id-vs-build-tools?view=vs-2022).
The action uses bootstrapper `--wait`, `--passive`, `--norestart` and
`--noUpdateInstaller`, with no automatic elevation or inferred terms acceptance.
Microsoft documents [these switches and installer outcomes](https://learn.microsoft.com/en-us/visualstudio/install/use-command-line-parameters-to-install-visual-studio?view=vs-2022)
and the [bootstrapper-only wait behavior](https://learn.microsoft.com/en-us/visualstudio/install/command-line-parameter-examples?view=vs-2022).
Elevation required, another install running, cancellation, in-use instance,
reboot required/initiated and failure remain distinct results. Vendor failure
can leave partial machine changes. A timeout never proves installation stopped;
unconfirmed child/tree closure retains the apply lock and exact session handle.

Successful apply must rerun discovery and the compiler/header/link/target
capability owner, then return selected child-local environment values for the
next locked bootstrap. It does not write bootstrap readiness. The native rebuild
also rediscovers the selection and verifies capability before native source
tasks. Compiler capability evidence covers a small C++20/Windows/UCRT source,
selected command/header/library bytes, compiler output, linked PE/COFF target
and bounded child output/deadlines. It does not establish every transitive
header/library hash, hard disk allocation, executable activation, every addon's
compiler invocation or representative workload behavior.
