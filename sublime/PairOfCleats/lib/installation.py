"""Explain incompatible old layouts without modifying editor installations."""
import os
import zipfile


PACKAGE_NAME = 'PairOfCleats'
ARCHIVE_NAME = PACKAGE_NAME + '.sublime-package'


def installation_diagnostics(sublime_api):
    installed_path = getattr(sublime_api, 'installed_packages_path', None)
    packages_path = getattr(sublime_api, 'packages_path', None)
    if not callable(installed_path) or not callable(packages_path):
        return []
    installed = installed_path()
    packages = packages_path()
    diagnostics = []
    archives = []
    if os.path.isdir(installed):
        for name in sorted(os.listdir(installed)):
            if name.lower() != ARCHIVE_NAME.lower():
                continue
            archive_path = os.path.join(installed, name)
            archives.append(archive_path)
            if name != ARCHIVE_NAME:
                diagnostics.append(
                    'Legacy package identity: rename {} to {} after removing the old revision.'.format(
                        name, ARCHIVE_NAME))
            try:
                with zipfile.ZipFile(archive_path) as archive:
                    names = set(archive.namelist())
                if 'plugin.py' not in names:
                    diagnostics.append(
                        '{} lacks plugin.py at archive root; replace the old nested archive.'.format(name))
                if 'editor-config-contract.json' not in names:
                    diagnostics.append(
                        '{} lacks the canonical bundled contract; reinstall the complete package.'.format(name))
            except (OSError, zipfile.BadZipFile) as error:
                diagnostics.append('Cannot inspect {}: {}'.format(name, error))
    loose_root = os.path.join(packages, PACKAGE_NAME)
    if archives and os.path.isdir(loose_root):
        loose_files = [name for name in os.listdir(loose_root) if name != '__pycache__']
        if loose_files:
            diagnostics.append(
                'Loose files in {} override the installed archive. Keep one complete revision; '
                'move intentional overrides aside before updating.'.format(loose_root))
    return diagnostics


def report_installation_diagnostics(sublime_api):
    try:
        diagnostics = installation_diagnostics(sublime_api)
    except OSError as error:
        diagnostics = ['Cannot inspect package installation: {}'.format(error)]
    for message in diagnostics:
        print('[PairOfCleats] ' + message)
    if diagnostics:
        sublime_api.status_message('PairOfCleats package installation needs attention; see the console.')
    return diagnostics
