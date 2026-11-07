"""Read-only installation observations through the existing process/HTTP owners."""
import os
import re

from . import api_client, config, operations, runner


def parse_cli_version(stdout, stderr):
    lines = [str(value or '').strip() for value in (stdout, stderr) if str(value or '').strip()]
    if len(lines) != 1 or len(lines[0]) > 256:
        return None
    match = re.match(r'^(?:PairOfCleats\s+)?v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)\Z',
                     lines[0], re.IGNORECASE)
    return match.group(1) if match else None


def render(facts):
    return '\nInstallation / transport observations:\n' + '\n'.join([
        '- CLI version: {0}'.format(facts.get('cliVersion') or 'unobserved'),
        '- External runtime: {0}'.format(facts.get('nodePath') or 'unobserved for this CLI dispatch'),
        '- External runtime version: {0}'.format(facts.get('nodeVersion') or 'unobserved; editor Python is separate'),
        '- Service capabilities: {0}'.format(', '.join(facts.get('capabilities') or []) or 'unobserved'),
        '- {0}'.format(facts.get('message') or 'Only successful identity observations are reported.'),
        'Use PairOfCleats Settings for User runtime/connection values, Project Settings for supported resource values,',
        'and Tooling Doctor / Index Validate for diagnostics. No installation, setup or build is started.']) + '\n'


def inspect(window, settings, root, cli, scope, on_done):
    facts = {}
    prefix = list(cli.get('args_prefix') or [])
    env = config.build_env(settings)
    def current():
        return operations.is_current(scope)
    def finish():
        if current():
            on_done(dict(facts))
    def service():
        if not current():
            return
        execution = config.resolve_execution_mode(settings, 'search')
        if execution.get('error') or execution.get('mode') != 'api':
            facts['message'] = execution.get('error') or 'CLI policy does not contact a service.'
            finish()
            return
        base_url = execution.get('base_url')
        def request():
            return api_client.request_json(api_client.build_url(base_url, '/capabilities'),
                timeout_ms=min(5000, settings.get('api_timeout_ms') or 5000),
                headers=api_client._api_headers(base_url))
        def accepted(response):
            if not current():
                return
            payload = response.payload if isinstance(response.payload, dict) else {}
            manifest = payload.get('runtimeManifest') or {}
            capabilities = (((manifest.get('surfaces') or {}).get('api') or {}).get('workflowCapabilities')
                if isinstance(manifest, dict) else None)
            if not isinstance(capabilities, dict):
                capabilities = payload.get('capabilities')
            if response.error or not isinstance(capabilities, dict):
                facts['message'] = 'Service capability evidence unavailable. Inspect User Settings / Tooling Doctor.'
            else:
                facts['capabilities'] = sorted(str(key)[:128] for key, enabled in capabilities.items() if enabled is True)[:64]
                facts['message'] = 'Capabilities observed from the selected User-owned endpoint; no repository mapping is inferred.'
            finish()
        api_client.run_async(request, accepted, window=window, scope=scope)
    def cli_done(response):
        if not current():
            return
        version = None if response.error or response.returncode != 0 or response.truncated else parse_cli_version(response.stdout, response.stderr)
        if version:
            facts['cliVersion'] = version
        else:
            facts['message'] = 'CLI version unavailable or not a single version identity; raw output is omitted.'
        service()
    def cli_version():
        if current():
            runner.run_process(cli['command'], prefix + ['--version'], cwd=root, env=env,
                window=window, title='PairOfCleats CLI identity observation', stream_output=False,
                timeout_ms=3000, output_cap_chars=8192, show_progress_panel=False,
                operation_scope=scope, on_done=cli_done)
    def node_done(response):
        if not current():
            return
        payload = response.payload
        if (not response.error and response.returncode == 0 and isinstance(payload, dict)
                and re.match(r'^\d+\.\d+\.\d+\Z', str(payload.get('version') or ''))
                and isinstance(payload.get('execPath'), str) and os.path.isabs(payload['execPath'])):
            facts.update({'nodePath': payload['execPath'], 'nodeVersion': payload['version']})
        cli_version()
    if prefix and str(prefix[0]).lower().endswith('.js'):
        runner.run_process(cli['command'], ['-p', 'JSON.stringify({version:process.versions.node,execPath:process.execPath})'],
            cwd=root, env=env, window=window, title='PairOfCleats Node identity observation', capture_json=True,
            stream_output=False, timeout_ms=3000, output_cap_chars=8192, show_progress_panel=False,
            operation_scope=scope, on_done=node_done)
    else:
        cli_version()
