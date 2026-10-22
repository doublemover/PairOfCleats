"""Consumer of canonical index-watch-progress; no prose or readiness inference."""
from datetime import datetime


def read_watch_progress(event, previous=None):
    if (not isinstance(event, dict) or event.get('proto') != 'poc.progress@2'
            or event.get('taskId') != 'watch:monitor' or event.get('stage') != 'watch'
            or event.get('event') not in ('task:start', 'task:progress', 'task:end')
            or event.get('phase') not in ('starting', 'monitoring', 'updating', 'degraded', 'stopping', 'stopped')):
        return None
    timestamp = event.get('ts')
    if not isinstance(timestamp, str):
        return None
    valid_time = False
    for pattern in ('%Y-%m-%dT%H:%M:%S.%fZ', '%Y-%m-%dT%H:%M:%SZ'):
        try:
            datetime.strptime(timestamp, pattern)
            valid_time = True
            break
        except ValueError:
            pass
    if not valid_time:
        return None
    ready = event.get('readiness')
    if (not isinstance(ready, dict) or not isinstance(event.get('watchReady'), bool)
            or ready.get('watcher') is not event['watchReady']
            or not isinstance(event.get('publicationCommitted'), bool)
            or ready.get('publishedGeneration') is not event['publicationCommitted']
            or 'searchReady' not in ready or ready['searchReady'] is not None
            or not isinstance(event.get('quiescent'), bool)):
        return None
    terminal = event['event'] == 'task:end'
    backlog = event.get('backlogDepth')
    if not terminal and (not isinstance(event.get('pendingReplay'), bool)
            or not isinstance(backlog, int) or isinstance(backlog, bool) or backlog < 0 or backlog > 9007199254740991):
        return None
    if event['phase'] == 'monitoring' and (event.get('state') != 'idle' or not event['watchReady']
            or not event['quiescent'] or event.get('pendingReplay') is not False or backlog != 0):
        return None
    if event['phase'] in ('starting', 'degraded', 'stopping', 'stopped') and event['watchReady']:
        return None
    if event['phase'] == 'stopped' and (not terminal or event.get('status') == 'failed' or event.get('ownershipPending') is True):
        return None
    if terminal and (event.get('status') not in ('failed', 'cancelled', 'done')
            or event['phase'] != ('degraded' if event.get('status') == 'failed' else 'stopped')):
        return None
    generation = event.get('lastConsistentGeneration') or {}
    build_id = generation.get('buildId') if isinstance(generation, dict) and generation.get('publicationCommitted') is True else None
    if not isinstance(build_id, str) or not 0 < len(build_id) <= 256:
        build_id = None
    if not build_id and terminal and event['publicationCommitted']:
        build_id = (previous or {}).get('publishedBuildId')
    return {'phase': {'monitoring': 'idle-watch', 'updating': 'indexing'}.get(event['phase'], event['phase']),
        'watcherReady': event['watchReady'], 'publicationCommitted': event['publicationCommitted'],
        'publishedBuildId': build_id if event['publicationCommitted'] else None, 'searchReady': None,
        'quiescent': event['quiescent'], 'backlogDepth': None if terminal else backlog,
        'pendingReplay': None if terminal else event['pendingReplay'],
        'degradedReason': str(event.get('degradedReason') or '')[:256],
        'errorCode': str(event.get('errorCode') or '')[:80], 'ownershipPending': event.get('ownershipPending') is True}


def describe_watch_progress(observation):
    if not observation:
        return []
    return ['canonical watch lifecycle: {0}; owned process settlement is separate'.format(observation['phase']),
        'watcher admission: {0}'.format('observed' if observation['watcherReady'] else 'not observed / degraded / stopping'),
        'watch backlog: {0}; replay pending: {1}; quiescent: {2}'.format(observation['backlogDepth'], observation['pendingReplay'], observation['quiescent']),
        'publication committed by this watch: {0}; generation: {1}'.format(observation['publicationCommitted'], observation['publishedBuildId'] or 'unobserved'),
        'search/backend readiness: unknown; watcher admission and publication do not qualify search'] + (
        ['degraded reason: {0}; code: {1}'.format(observation['degradedReason'], observation['errorCode'] or 'unknown')]
        if observation['degradedReason'] else []) + (
        ['watch teardown ownership remains pending; this event does not release the owned process'] if observation['ownershipPending'] else [])
