"""Discover only typed, source-scoped semantic generation witnesses."""
import json
import re
import copy

from . import api_client, config, operations, paths, runner, service_repository


def pinned_generation(value):
    if (not isinstance(value, dict) or not isinstance(value.get('baseBuildId'), str)
            or not value['baseBuildId'] or len(value['baseBuildId']) > 512
            or value.get('semanticRevision') != 0 or isinstance(value.get('semanticRevision'), bool)
            or value['baseBuildId'] in ('.', '..') or re.search(r'[\\/:\x00]', value['baseBuildId'])):
        return None
    return {'baseBuildId': value['baseBuildId'], 'semanticRevision': 0}


def generation_from_context_pack(payload, expected_root):
    section = payload.get('semantic') if isinstance(payload, dict) else None
    if not isinstance(section, dict) or section.get('schemaVersion') != 1 or section.get('repoRoot') != expected_root:
        return None
    generation = pinned_generation(section.get('generation'))
    if not generation:
        return None
    for key in ('discovery', 'detail', 'trace'):
        page = section.get(key)
        if page is not None and (not isinstance(page, dict) or page.get('generation') != generation):
            raise ValueError('Canonical semantic context contains conflicting generation evidence.')
    for item in section.get('followUps') or []:
        request = item.get('request') if isinstance(item, dict) else None
        if not isinstance(request, dict) or request.get('repoRoot') != expected_root or request.get('generation') != generation:
            raise ValueError('Canonical semantic follow-up scope differs from discovery.')
    return {'generation': generation, 'status': section.get('status'), 'selector': section.get('selector'),
            'warnings': list(section.get('warnings') or []), 'source': 'canonical-context-pack-semantic-section'}


def context_discovery_request(root, seed):
    if not root or not isinstance(seed, str) or not seed or len(seed) > 4096:
        raise ValueError('Select a repository and bounded file/chunk seed for semantic generation discovery.')
    return {'repo': root, 'seed': seed, 'hops': 0, 'includeSemantic': True, 'includeGraph': False,
            'includeTypes': False, 'includeRisk': False, 'includeImports': False, 'includeUsages': False,
            'includeCallersCallees': False, 'maxBytes': 8192, 'maxNodes': 8, 'maxEdges': 0,
            'maxCandidates': 8, 'maxWorkUnits': 64, 'maxWallClockMs': 250}


def context_discovery_cli_args(root, seed):
    request = context_discovery_request(root, seed)
    args = ['context-pack', '--json']
    for key in sorted(request):
        value = request[key]
        args.extend(['--' + key, str(value).lower() if isinstance(value, bool) else str(value)])
    return args


def discover_generation(window, context, seed, on_done, on_error):
    context = dict(context, settings=copy.deepcopy(context['settings']), scope=dict(context['scope']))
    scope, settings = context['scope'], context['settings']
    if not operations.is_current(scope):
        return
    execution = config.resolve_execution_mode(settings, 'semantic-find')
    if execution.get('error'):
        on_error(execution['error'])
        return
    root = context['root']
    def accept(payload, expected_root):
        if not operations.is_current(scope):
            return
        try:
            if len(json.dumps(payload, ensure_ascii=False).encode('utf-8')) > 131072:
                raise ValueError('Generation discovery response exceeded its 128 KiB editor bound.')
            witness = generation_from_context_pack(payload, expected_root)
            if not witness:
                raise ValueError('No authoritative semantic generation was returned for this selected source. Choose an explicit immutable generation or another source.')
            on_done(copy.deepcopy(witness))
        except (ValueError, TypeError) as error:
            on_error(str(error))
    if execution.get('mode') == 'api':
        if not context.get('serviceRoot'):
            def selected(service_root):
                if operations.is_current(scope):
                    context['serviceRoot'] = service_root
                    discover_generation(window, context, seed, on_done, on_error)
            service_repository.resolve(window, settings, root, selected, operation_scope=scope)
            return
        service_root, base = context['serviceRoot'], execution['base_url']
        def request():
            capabilities, _headers = api_client.request_json(api_client.build_url(base, '/capabilities'),
                timeout_ms=settings.get('api_timeout_ms', 5000), headers=api_client._api_headers(base))
            context['capabilities'] = api_client.read_workflow_capabilities(capabilities)
            if context['capabilities'].get('context-pack') is not True:
                raise ValueError('The selected service does not advertise canonical context-pack discovery.')
            response, headers = api_client.request_json(api_client.build_url(base, '/analysis/context-pack'),
                timeout_ms=settings.get('api_timeout_ms', 5000), method='POST',
                payload=context_discovery_request(service_root, seed), headers=api_client._api_headers(base))
            if not isinstance(response, dict):
                raise ValueError('Canonical generation discovery returned an invalid response object.')
            if response.get('ok') is False:
                raise ValueError(response.get('message') or 'Canonical semantic generation discovery failed.')
            return response.get('result'), headers
        def completed(response):
            if not operations.is_current(scope):
                return
            if response.error:
                on_error(response.error)
            else:
                accept(response.payload, service_root)
        api_client.run_async(request, completed, window=window, scope=scope)
        return
    cli = paths.resolve_cli(settings, root)
    def completed(response):
        if not operations.is_current(scope):
            return
        if response.error or response.returncode != 0:
            on_error(response.error or 'Canonical generation discovery did not complete. Inspect task diagnostics.')
        else:
            accept(response.payload, root)
    runner.run_process(cli['command'], list(cli.get('args_prefix') or []) + context_discovery_cli_args(root, seed),
        cwd=root, env=config.build_env(settings), window=window, title='PairOfCleats semantic generation discovery',
        capture_json=True, on_done=completed, stream_output=False, timeout_ms=5000,
        output_cap_chars=131072, operation_scope=scope)
