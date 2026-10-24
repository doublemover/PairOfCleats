"""Direct file-save publication shared by reviewed evidence and analysis exports."""
import errno
import os
import tempfile

from . import ui


class PublicationCancelled(RuntimeError):
    pass


def _retain_failure(primary, phase, error):
    failures = list(getattr(primary, 'pairofcleats_cleanup_errors', []))
    failures.append('{0}: {1}'.format(phase, error))
    primary.pairofcleats_cleanup_errors = failures


def stage_text(parent, text, prefix='.pairofcleats-', suffix='.tmp'):
    # Encode before acquiring a destination resource. The bytes are exactly the
    # reviewed text, including Unicode and line endings, on every host.
    encoded = text.encode('utf-8')
    descriptor, staged = tempfile.mkstemp(prefix=prefix, suffix=suffix, dir=parent)
    handle = None
    try:
        handle = os.fdopen(descriptor, 'wb')
        descriptor = None
        written = handle.write(encoded)
        if written != len(encoded):
            raise IOError('The staged export write was incomplete.')
        handle.flush()
        os.fsync(handle.fileno())
        handle.close()
        handle = None
    except Exception as primary:
        if handle is not None:
            try:
                handle.close()
            except Exception as error:
                _retain_failure(primary, 'Staged export close failed', error)
        if descriptor is not None:
            try:
                os.close(descriptor)
            except Exception as error:
                _retain_failure(primary, 'Staged descriptor close failed', error)
        _cleanup_staged(staged, primary)
        raise
    return staged


def _cleanup_staged(staged, primary):
    try:
        os.unlink(staged)
    except OSError as error:
        if error.errno != errno.ENOENT:
            primary.pairofcleats_recovery_path = staged
            _retain_failure(primary, 'Staged export cleanup failed', error)
    except Exception as error:
        primary.pairofcleats_recovery_path = staged
        _retain_failure(primary, 'Staged export cleanup failed', error)


def write_text(destination, text, is_current=None, create_parents=False):
    def check_current():
        if is_current is not None and not is_current():
            raise PublicationCancelled('The original export request is no longer current.')

    check_current()
    parent = os.path.dirname(os.path.abspath(destination))
    if create_parents:
        os.makedirs(parent, exist_ok=True)
    staged = stage_text(parent, text)
    try:
        check_current()
        # Same-directory replacement is the only destination mutation. In
        # particular, never truncate, remove or "restore" the prior destination.
        os.replace(staged, destination)
    except Exception as primary:
        _cleanup_staged(staged, primary)
        raise
    return destination


def describe_failure(prefix, error):
    message = prefix + str(error)
    for failure in getattr(error, 'pairofcleats_cleanup_errors', []):
        message += '\n' + failure
    recovery_path = getattr(error, 'pairofcleats_recovery_path', None)
    if recovery_path:
        message += '\nUnremoved staged export: ' + recovery_path
    return message


def notify_saved(window, destination, label):
    # Publication is already complete. A host display error must not relabel a
    # saved file as failed or prevent the independent status notification.
    failures = []
    try:
        window.open_file(destination)
    except Exception as error:
        failures.append('Open saved export failed: ' + str(error))
    try:
        ui.show_status('PairOfCleats: saved {0}: {1}'.format(label, destination))
    except Exception as error:
        failures.append('Saved-export notification failed: ' + str(error))
    if failures:
        message = 'PairOfCleats saved {0}: {1}\n{2}'.format(label, destination, '\n'.join(failures))
        try:
            ui.show_error(message)
        except Exception as error:
            failures.append('Saved-export error notification failed: ' + str(error))
            print(message + '\n' + failures[-1])
    return failures
