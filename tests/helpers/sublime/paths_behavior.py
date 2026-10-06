import importlib
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(__file__))

from runtime_harness import isolated_temp_directory, FakeView, FakeWindow, install_fake_modules


class PathsBehaviorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sublime, _ = install_fake_modules()
        cls.paths = importlib.import_module('PairOfCleats.lib.paths')

    def setUp(self):
        self.sublime.reset()
        self.window = FakeWindow()
        self.sublime.set_active_window(self.window)

    def test_read_only_resolution_prefers_nested_path_hint_repo(self):
        with isolated_temp_directory() as tmp:
            outer = os.path.join(tmp, 'outer')
            inner = os.path.join(outer, 'inner')
            os.makedirs(os.path.join(outer, '.git'))
            os.makedirs(os.path.join(inner, '.git'))
            hinted = os.path.join(inner, 'src', 'app.js')
            os.makedirs(os.path.dirname(hinted))
            with open(hinted, 'w', encoding='utf-8') as handle:
                handle.write('export const ok = true;\n')
            root, reason = self.paths.resolve_repo_root(self.window, return_reason=True, path_hint=hinted)
            self.assertEqual(root, os.path.abspath(inner))
            self.assertIsNone(reason)

    def test_worktree_git_file_prefers_worktree_over_enclosing_repo(self):
        for enclosing_marker in ('.git', '.pairofcleats.json'):
            with self.subTest(enclosing_marker=enclosing_marker), isolated_temp_directory() as tmp:
                outer = os.path.join(tmp, 'outer')
                worktree = os.path.join(outer, 'feature')
                metadata = os.path.join(outer, '.git', 'worktrees', 'feature')
                os.makedirs(os.path.join(worktree, 'src'))
                if enclosing_marker == '.git':
                    os.makedirs(metadata)
                else:
                    with open(os.path.join(outer, enclosing_marker), 'w', encoding='utf-8') as handle:
                        handle.write('{}\n')
                with open(os.path.join(worktree, '.git'), 'w', encoding='utf-8') as handle:
                    handle.write('gitdir: {0}\n'.format(metadata))
                hinted = os.path.join(worktree, 'src', 'app.js')
                with open(hinted, 'w', encoding='utf-8') as handle:
                    handle.write('export const ok = true;\n')
                self.window.set_folders([outer])
                root, reason = self.paths.resolve_repo_root(
                    self.window, return_reason=True, path_hint=hinted, allow_fallback=False,
                )
                self.assertEqual(root, os.path.abspath(worktree))
                self.assertNotEqual(root, os.path.abspath(metadata))
                self.assertIsNone(reason)

    def test_worktree_git_file_resolves_active_file_without_open_folder(self):
        with isolated_temp_directory() as tmp:
            worktree = os.path.join(tmp, 'feature')
            source = os.path.join(worktree, 'src', 'app.py')
            os.makedirs(os.path.dirname(source))
            with open(os.path.join(worktree, '.git'), 'w', encoding='utf-8') as handle:
                handle.write('gitdir: ../main/.git/worktrees/feature\r\n')
            with open(source, 'w', encoding='utf-8') as handle:
                handle.write('value = 1\n')
            self.window.set_active_view(FakeView(source))
            root, reason = self.paths.resolve_repo_root(self.window, return_reason=True, allow_fallback=False)
            self.assertEqual(root, os.path.abspath(worktree))
            self.assertIsNone(reason)

    def test_strict_resolution_prompts_for_multiple_git_file_worktrees(self):
        with isolated_temp_directory() as tmp:
            worktrees = [os.path.join(tmp, name) for name in ('feature-a', 'feature-b')]
            for worktree in worktrees:
                os.makedirs(os.path.join(worktree, 'src'))
                with open(os.path.join(worktree, '.git'), 'w', encoding='utf-8') as handle:
                    handle.write('gitdir: ../main/.git/worktrees/{0}\n'.format(os.path.basename(worktree)))
            self.window.set_folders([os.path.join(root, 'src') for root in worktrees])
            chosen = {}
            self.paths.resolve_repo_root_interactive(
                self.window,
                lambda root, reason: chosen.update({'root': root, 'reason': reason}),
                allow_fallback=False,
            )
            self.assertIsNotNone(self.window.quick_panel_items)
            self.assertEqual(len(self.window.quick_panel_items), 2)
            self.window.quick_panel_callback(1)
            self.assertEqual(chosen['root'], os.path.abspath(worktrees[1]))
            self.assertIn('Using selected repo', chosen['reason'])

    def test_strict_resolution_prompts_for_multiple_repo_roots(self):
        with isolated_temp_directory() as tmp:
            repo_a = os.path.join(tmp, 'repo-a')
            repo_b = os.path.join(tmp, 'repo-b')
            os.makedirs(os.path.join(repo_a, '.git'))
            os.makedirs(os.path.join(repo_b, '.git'))
            self.window.set_folders([repo_a, repo_b])
            chosen = {}
            self.paths.resolve_repo_root_interactive(
                self.window,
                lambda root, reason: chosen.update({'root': root, 'reason': reason}),
                allow_fallback=False,
                prompt='PairOfCleats repo',
            )
            self.assertIsNotNone(self.window.quick_panel_items)
            self.assertEqual(len(self.window.quick_panel_items), 2)
            self.window.quick_panel_callback(1)
            self.assertEqual(chosen['root'], os.path.abspath(repo_b))
            self.assertIn('Using selected repo', chosen['reason'])

    def test_strict_resolution_with_external_hint_keeps_repo_choices(self):
        with isolated_temp_directory() as tmp:
            repo_a = os.path.join(tmp, 'repo-a')
            repo_b = os.path.join(tmp, 'repo-b')
            outside = os.path.join(tmp, 'outside', 'file.txt')
            os.makedirs(os.path.join(repo_a, '.git'))
            os.makedirs(os.path.join(repo_b, '.git'))
            os.makedirs(os.path.dirname(outside))
            with open(outside, 'w', encoding='utf-8') as handle:
                handle.write('outside\n')
            self.window.set_folders([repo_a, repo_b])
            chosen = {}
            self.paths.resolve_repo_root_interactive(
                self.window,
                lambda root, reason: chosen.update({'root': root, 'reason': reason}),
                path_hint=outside,
                allow_fallback=False,
                prompt='PairOfCleats repo',
            )
            self.assertIsNotNone(self.window.quick_panel_items)
            self.assertEqual(len(self.window.quick_panel_items), 2)
            self.window.quick_panel_callback(0)
            self.assertEqual(chosen['root'], os.path.abspath(repo_a))
            self.assertIn('Using selected repo', chosen['reason'])

    def test_strict_resolution_fails_closed_without_repo(self):
        with isolated_temp_directory() as tmp:
            folder = os.path.join(tmp, 'workspace')
            os.makedirs(folder)
            self.window.set_folders([folder])
            root, reason = self.paths.resolve_repo_root(
                self.window,
                return_reason=True,
                allow_fallback=False,
            )
            self.assertIsNone(root)
            self.assertIn('require an explicit repo root', reason)

    def test_read_only_resolution_can_fall_back_to_open_folder(self):
        with isolated_temp_directory() as tmp:
            folder = os.path.join(tmp, 'workspace')
            os.makedirs(folder)
            self.window.set_folders([folder])
            root, reason = self.paths.resolve_repo_root(
                self.window,
                return_reason=True,
                allow_fallback=True,
            )
            self.assertEqual(root, os.path.abspath(folder))
            self.assertIn('using open folder', reason.lower())

    def test_watch_root_override_must_stay_within_repo(self):
        with isolated_temp_directory() as tmp:
            repo = os.path.join(tmp, 'repo')
            inside = os.path.join(repo, 'src')
            outside = os.path.join(tmp, 'outside')
            os.makedirs(os.path.join(repo, '.git'))
            os.makedirs(inside)
            os.makedirs(outside)
            settings = {
                'index_watch_scope': 'folder',
                'index_watch_folder': '../outside',
            }
            watch_root = self.paths.resolve_watch_root(self.window, settings, repo_root=repo)
            self.assertIsNone(watch_root)

            settings['index_watch_folder'] = './src'
            watch_root = self.paths.resolve_watch_root(self.window, settings, repo_root=repo)
            self.assertEqual(watch_root, os.path.abspath(inside))

    def test_watch_root_override_must_stay_within_repo(self):
        with isolated_temp_directory() as tmp:
            repo_root = os.path.join(tmp, 'repo')
            outside = os.path.join(tmp, 'outside')
            os.makedirs(os.path.join(repo_root, '.git'))
            os.makedirs(outside)
            watch_root = self.paths.resolve_watch_root(
                self.window,
                {
                    'index_watch_scope': 'folder',
                    'index_watch_folder': '..\\outside',
                },
                repo_root=repo_root,
            )
            self.assertEqual(watch_root, os.path.abspath(repo_root))


if __name__ == '__main__':
    unittest.main()
