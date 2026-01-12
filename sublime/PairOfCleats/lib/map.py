import os
import time


MAP_TYPES = {
    'imports': 'imports',
    'calls': 'calls',
    'usages': 'usages',
    'dataflow': 'dataflow,aliases',
    'combined': 'imports,calls,usages,dataflow,exports'
}

MAP_FORMATS = {
    'json': '.json',
    'dot': '.dot',
    'svg': '.svg',
    'html': '.html',
    'html-iso': '.iso.html'
}


def resolve_output_dir(repo_root, settings):
    output_dir = settings.get('map_output_dir') or '.pairofcleats/maps'
    if os.path.isabs(output_dir):
        return output_dir
    return os.path.normpath(os.path.join(repo_root, output_dir))


def build_output_paths(repo_root, settings, scope, map_type, map_format):
    output_dir = resolve_output_dir(repo_root, settings)
    timestamp = time.strftime('%Y%m%d-%H%M%S')
    safe_scope = (scope or 'repo').replace(' ', '_')
    safe_type = (map_type or 'combined').replace(' ', '_')
    base = 'map_{0}_{1}_{2}'.format(safe_scope, safe_type, timestamp)

    extension = MAP_FORMATS.get(map_format, '.json')
    output_path = os.path.join(output_dir, base + extension)
    model_path = os.path.join(output_dir, base + '.model.json')
    node_list_path = os.path.join(output_dir, base + '.nodes.json')
    return output_path, model_path, node_list_path


def resolve_map_type(settings, override=None):
    if override:
        return override
    return settings.get('map_type_default') or 'combined'


def resolve_map_format(settings, override=None):
    if override:
        return override
    return settings.get('map_format_default') or 'html-iso'


def build_map_args(
        repo_root,
        settings,
        scope,
        focus,
        map_type,
        map_format,
        output_path,
        model_path,
        node_list_path):
    args = ['report', 'map', '--repo', repo_root]

    mode = settings.get('map_index_mode') or 'code'
    args += ['--mode', mode]

    args += ['--scope', scope]
    if focus:
        args += ['--focus', focus]

    include = MAP_TYPES.get(map_type)
    if include:
        args += ['--include', include]

    if settings.get('map_only_exported'):
        args.append('--only-exported')

    collapse = settings.get('map_collapse_default')
    if collapse:
        args += ['--collapse', collapse]

    max_files = settings.get('map_max_files')
    if isinstance(max_files, int) and max_files > 0:
        args += ['--max-files', str(max_files)]

    max_members = settings.get('map_max_members_per_file')
    if isinstance(max_members, int) and max_members > 0:
        args += ['--max-members-per-file', str(max_members)]

    max_edges = settings.get('map_max_edges')
    if isinstance(max_edges, int) and max_edges > 0:
        args += ['--max-edges', str(max_edges)]

    if settings.get('map_top_k_by_degree') is True:
        args.append('--top-k-by-degree')

    if map_format:
        args += ['--format', map_format]

    if output_path:
        args += ['--out', output_path]

    if model_path:
        args += ['--model-out', model_path]

    if node_list_path:
        args += ['--node-list-out', node_list_path]

    open_uri = settings.get('map_open_uri_template')
    if open_uri:
        args += ['--open-uri-template', open_uri]

    three_url = settings.get('map_three_url')
    if three_url:
        args += ['--three-url', three_url]

    _append_number(args, settings, 'map_wasd_sensitivity', '--wasd-sensitivity')
    _append_number(args, settings, 'map_wasd_acceleration', '--wasd-acceleration')
    _append_number(args, settings, 'map_wasd_max_speed', '--wasd-max-speed')
    _append_number(args, settings, 'map_wasd_drag', '--wasd-drag')
    _append_number(args, settings, 'map_zoom_sensitivity', '--zoom-sensitivity')

    args.append('--json')
    return args


def _append_number(args, settings, key, flag):
    value = settings.get(key)
    if isinstance(value, (int, float)):
        args += [flag, str(value)]
