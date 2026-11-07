"""Filesystem policy controls; this does not claim real editor activation."""
import os
import tempfile
import zipfile
from types import SimpleNamespace
from runtime_harness import PACKAGE_ROOT
from PairOfCleats.lib.installation import installation_diagnostics


with tempfile.TemporaryDirectory() as root:
    installed = os.path.join(root, 'Installed Packages')
    packages = os.path.join(root, 'Packages')
    os.makedirs(installed)
    os.makedirs(packages)
    api = SimpleNamespace(installed_packages_path=lambda: installed, packages_path=lambda: packages)
    archive_path = os.path.join(installed, 'PairOfCleats.sublime-package')
    with zipfile.ZipFile(archive_path, 'w') as archive:
        archive.writestr('plugin.py', '# plugin')
        archive.writestr('editor-config-contract.json', '{}')
    assert installation_diagnostics(api) == []
    loose = os.path.join(packages, 'PairOfCleats')
    os.makedirs(loose)
    loose_plugin = os.path.join(loose, 'plugin.py')
    with open(loose_plugin, 'w', encoding='utf-8') as handle:
        handle.write('# intentional loose revision')
    assert any('override' in text for text in installation_diagnostics(api))
    os.unlink(archive_path)
    assert installation_diagnostics(api) == [], 'unpacked-only installation is valid'
    legacy = os.path.join(installed, 'pairofcleats.sublime-package')
    with zipfile.ZipFile(legacy, 'w') as archive:
        archive.writestr('PairOfCleats/plugin.py', '# old nested plugin')
        archive.writestr('PairOfCleats/editor-config-contract.json', '{}')
    messages = installation_diagnostics(api)
    assert any('Legacy package identity' in text for text in messages)
    assert any('archive root' in text for text in messages)
    assert any('bundled contract' in text for text in messages)
    with open(loose_plugin, encoding='utf-8') as handle:
        assert handle.read() == '# intentional loose revision', 'diagnostics must preserve user files'
print('Sublime installation identity and shadowing diagnostics passed')
