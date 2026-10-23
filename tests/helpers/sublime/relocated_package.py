"""Import the complete installed plugin without a repository beside it."""
import importlib
import json
import os
import shutil
import sys
import tempfile
import zipfile

from runtime_harness import PACKAGE_ROOT, install_fake_modules


source = sys.argv[1]
with tempfile.TemporaryDirectory() as temporary:
    packages = os.path.join(temporary, 'Packages')
    os.makedirs(packages)
    package = os.path.join(packages, 'PairOfCleats')
    if zipfile.is_zipfile(source):
        with zipfile.ZipFile(source) as archive:
            assert os.path.basename(source) == 'PairOfCleats.sublime-package'
            assert 'plugin.py' in archive.namelist()
            assert 'PairOfCleats/plugin.py' not in archive.namelist()
            archive.extractall(package)
    else:
        shutil.copytree(source, package, ignore=shutil.ignore_patterns('__pycache__'))
    sys.path = [packages] + [entry for entry in sys.path if entry != PACKAGE_ROOT]
    sublime, _ = install_fake_modules()
    plugin = importlib.import_module('PairOfCleats.plugin')
    assert os.path.commonpath([package, plugin.__file__]) == package
    plugin.plugin_loaded()
    assert plugin.config.EDITOR_CONFIG_CONTRACT['schemaVersion'] == 1
    plugin.plugin_unloaded()
    # Packed Sublime packages load data through the editor resource API; there
    # need not be a corresponding file on disk beside __file__.
    resource = os.path.join(package, 'editor-config-contract.json')
    with open(resource, encoding='utf-8') as handle:
        contract_text = handle.read()
    calls = []

    def load_resource(name):
        calls.append(name)
        return contract_text

    sublime.load_resource = load_resource
    os.unlink(resource)
    importlib.reload(plugin.config)
    assert calls == ['Packages/PairOfCleats/editor-config-contract.json']
    assert plugin.config.EDITOR_CONFIG_CONTRACT == json.loads(contract_text)
    # The installed consumer refuses stale/malformed runtime authority instead
    # of silently inventing defaults from an unsupported contract version.
    valid_contract = json.loads(contract_text)
    invalid_contracts = [dict(valid_contract, schemaVersion=2), dict(valid_contract, schemaVersion=True),
                         dict(valid_contract, search={}), dict(valid_contract, settings={})]
    for invalid in invalid_contracts:
        sublime.load_resource = lambda _name, invalid=invalid: json.dumps(invalid)
        try:
            plugin.config._load_editor_config_contract()
            raise AssertionError('invalid installed runtime contract was admitted')
        except RuntimeError as error:
            assert 'Reinstall the complete' in str(error) and error.__cause__ is not None
    sublime.load_resource = lambda _name: ' ' * 65537
    try:
        plugin.config._load_editor_config_contract()
        raise AssertionError('oversized installed contract was parsed')
    except RuntimeError as error:
        assert '64 KiB' in str(error)
print('relocated plugin registration and packed-resource loading passed')
