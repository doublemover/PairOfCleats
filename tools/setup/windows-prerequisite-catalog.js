// Official metadata inspected 2026-10-22; acquisition/installation UNVALIDATED.
// Do not infer payload length or installation peak from a bootstrapper digest.
export const WINDOWS_PREREQUISITE_CATALOG = Object.freeze({
  schemaVersion: 1,
  id: 'visual-studio-2022-build-tools-17.14.42',
  productId: 'Microsoft.VisualStudio.Product.BuildTools',
  version: '17.14.42', buildVersion: '17.14.37806.7', channelId: 'VisualStudio.17.Release',
  url: 'https://download.visualstudio.microsoft.com/download/pr/c95450be-0a45-4779-b142-33f567ccfd6e/68978bb28916156802e60e04c5ee50b94348d802fe151a3ca24433f27984187b/vs_BuildTools.exe',
  sha256: '68978bb28916156802e60e04c5ee50b94348d802fe151a3ca24433f27984187b',
  bytes: null,
  signature: { publisherOrganization: 'Microsoft Corporation', state: 'must-observe-local-valid-authenticode' },
  allocation: { complete: false, writes: null, reason: 'Official release/manifest sources do not establish the full per-destination installation peak.' },
  components: { x64: ['Microsoft.VisualStudio.Workload.VCTools', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', 'Microsoft.VisualStudio.Component.Windows11SDK.26100'],
    arm64: ['Microsoft.VisualStudio.Workload.VCTools', 'Microsoft.VisualStudio.Component.VC.Tools.ARM64', 'Microsoft.VisualStudio.Component.Windows11SDK.26100'] },
  sources: {
    release: 'https://learn.microsoft.com/en-us/visualstudio/releases/2022/release-history',
    digest: 'https://raw.githubusercontent.com/microsoft/winget-pkgs/master/manifests/m/Microsoft/VisualStudio/2022/BuildTools/17.14.42/Microsoft.VisualStudio.2022.BuildTools.installer.yaml',
    components: 'https://learn.microsoft.com/en-us/visualstudio/install/workload-component-id-vs-build-tools?view=vs-2022',
    arguments: 'https://learn.microsoft.com/en-us/visualstudio/install/use-command-line-parameters-to-install-visual-studio?view=vs-2022',
    wait: 'https://learn.microsoft.com/en-us/visualstudio/install/command-line-parameter-examples?view=vs-2022',
    signature: 'https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.security/get-authenticodesignature?view=powershell-7.5'
  }
});
