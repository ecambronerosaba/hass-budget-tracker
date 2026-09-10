/**
 * Unit tests for the pure helpers behind the auto-bump post-commit hook.
 * The git side effects in bump-version.mjs's main() are exercised by hand on a
 * scratch branch, not here.
 *
 *   node --test scripts/test/bump-version.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bumpLevel, nextVersion, reasonToSkip } from '../bump-version.mjs';

test('bumpLevel: feat is a minor bump', () => {
  assert.equal(bumpLevel('feat: add reconcile screen'), 'minor');
  assert.equal(bumpLevel('feat(ui): add reconcile screen'), 'minor');
});

test('bumpLevel: fix and perf are patch bumps', () => {
  assert.equal(bumpLevel('fix: correct rounding in money.ts'), 'patch');
  assert.equal(bumpLevel('perf(store): memoize selectors'), 'patch');
});

test('bumpLevel: other conventional types still patch-bump', () => {
  for (const type of ['docs', 'chore', 'refactor', 'test', 'ci', 'style', 'build', 'revert']) {
    assert.equal(bumpLevel(`${type}: some change`), 'patch', type);
  }
});

test('bumpLevel: "!" marks a breaking change', () => {
  assert.equal(bumpLevel('feat!: drop the v1 JSON shape'), 'major');
  assert.equal(bumpLevel('refactor(api)!: rename endpoints'), 'major');
});

test('bumpLevel: "BREAKING CHANGE:" footer marks a breaking change', () => {
  const msg = 'fix: adjust storage path\n\nBREAKING CHANGE: /data layout moved';
  assert.equal(bumpLevel(msg), 'major');
});

test('bumpLevel: BREAKING-CHANGE hyphen variant is honored', () => {
  const msg = 'chore: tidy\n\nBREAKING-CHANGE: config keys renamed';
  assert.equal(bumpLevel(msg), 'major');
});

test('bumpLevel: non-conventional messages do not bump', () => {
  assert.equal(bumpLevel('wip'), null);
  assert.equal(bumpLevel('update stuff'), null);
  assert.equal(bumpLevel("Merge branch 'main' into feature/x"), null);
  assert.equal(bumpLevel('Revert "feat: add reconcile screen"'), null);
  assert.equal(bumpLevel('nope: not a real type'), null);
  assert.equal(bumpLevel('feat:missing space after colon'), null);
});

test('bumpLevel: only the subject line decides the type', () => {
  const msg = 'chore: bump deps\n\nfeat: this line in the body must not count';
  assert.equal(bumpLevel(msg), 'patch');
});

test('nextVersion: increments the right field and zeroes lower ones', () => {
  assert.equal(nextVersion('1.2.3', 'patch'), '1.2.4');
  assert.equal(nextVersion('1.2.3', 'minor'), '1.3.0');
  assert.equal(nextVersion('1.2.3', 'major'), '2.0.0');
  assert.equal(nextVersion('1.0.0', 'patch'), '1.0.1');
});

test('nextVersion: tolerates surrounding whitespace', () => {
  assert.equal(nextVersion('  1.0.0\n', 'minor'), '1.1.0');
});

test('nextVersion: rejects a non-x.y.z version', () => {
  assert.throws(() => nextVersion('1.0', 'patch'), /Unparseable/);
  assert.throws(() => nextVersion('v1.0.0', 'patch'), /Unparseable/);
});

const CLEAN = { GIT_REFLOG_ACTION: 'commit' };

test('reasonToSkip: the recursion flag wins over everything', () => {
  assert.ok(reasonToSkip('feat: x', { ...CLEAN, BT_BUMP_IN_PROGRESS: '1' }));
});

test('reasonToSkip: git-driven history rewrites are skipped', () => {
  for (const action of [
    'commit (amend)',
    'rebase -i (pick)',
    'rebase (continue)',
    'rebase (finish)',
    'merge feature/x',
    'cherry-pick',
    'revert',
  ]) {
    assert.ok(reasonToSkip('feat: x', { GIT_REFLOG_ACTION: action }), action);
  }
});

test('reasonToSkip: a plain commit with a non-conventional subject is skipped', () => {
  assert.ok(reasonToSkip('wip', CLEAN));
  assert.ok(reasonToSkip("Merge branch 'main' into feature/x", CLEAN));
  assert.ok(reasonToSkip('deploy: not a real type', CLEAN));
});

test('reasonToSkip: a plain conventional commit is not skipped', () => {
  assert.equal(reasonToSkip('feat: add a thing', CLEAN), null);
  assert.equal(reasonToSkip('fix(scope): correct a thing', CLEAN), null);
  assert.equal(reasonToSkip('chore: housekeeping', CLEAN), null);
});

test('reasonToSkip: a missing GIT_REFLOG_ACTION does not itself skip', () => {
  assert.equal(reasonToSkip('feat: x', {}), null);
});
