"""Terminal UI derives from owned settlement, not a requested stop or exit alone."""


def describe_process_outcome(result, title, stop_requested=False):
    state = getattr(result, 'state', None)
    error = getattr(result, 'error', None)
    code = getattr(result, 'returncode', None)
    if state == 'cleanup_unconfirmed':
        return {'status': 'failed', 'summary': title + ': owned process-tree stop remains unconfirmed.'}
    if getattr(result, 'timed_out', False) or state == 'timed_out':
        return {'status': 'failed', 'summary': title + ': timeout is not a confirmed successful stop.'}
    if error or state in ('spawn_failed', 'parse_failed', 'failed'):
        return {'status': 'failed', 'summary': (title + ': ' + str(error or 'operation failed'))[:2048]}
    if getattr(result, 'cancelled', False) or state == 'cancelled' or stop_requested and code == 0:
        return {'status': 'cancelled', 'summary': title + ': cancelled after owned settlement.'}
    if code != 0:
        return {'status': 'failed', 'summary': title + ': process exited without success ({0}).'.format(code)}
    return {'status': 'done', 'summary': title + ': completed after owned settlement.'}
