/**
 * Auto-bump the add-on version from the last commit's Conventional Commits
 * message, then fold the bump into that same commit.
 *
 * Home Assistant's Supervisor only offers an "Update" button when the repo
 * advertises a `version:` in `budget-server/config.yaml` newer than what's
 * installed (see README). This keeps a human from having to remember the bump:
 * the commit message already says what changed, so derive the SemVer step from
 * it.
 *
 *   feat:            -> minor
 *   fix: / perf:     -> patch
 *   any other type   -> patch   (docs, chore, refactor, test, ci, style, build, revert)
 *   `!` or
 *   `BREAKING CHANGE:` -> major
 *   anything that isn't a conventional commit -> no bump
 *
 * Runs from `.husky/post-commit`. At that point HEAD is the new commit and its
 * message is readable, so we edit the version files, `git add` them, and
 * `git commit --amend --no-edit --no-verify`. The amend re-fires post-commit,
 * which is why there are guards below (env flag + GIT_REFLOG_ACTION); rebase,
 * merge, cherry-pick and revert are skipped for the same reason.
 *
 *   node scripts/bump-version.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_YAML = join(ROOT, 'budget-server', 'config.yaml');
const PACKAGE_JSON = join(ROOT, 'package.json');

const CONVENTIONAL_TYPES = [
  'feat', 'fix', 'perf', 'docs', 'chore',
  'refactor', 'test', 'ci', 'style', 'build', 'revert',
];

/**
 * The SemVer bump implied by a Conventional Commits message: 'major', 'minor'
 * or 'patch', or `null` when the message is not a conventional commit and
 * nothing should change.
 */
export function bumpLevel(message) {
  const firstLine = message.split('\n', 1)[0].trim();
  const header = /^([a-zA-Z]+)(\([^)]*\))?(!)?:\s+\S/.exec(firstLine);
  if (!header) return null;

  const type = header[1].toLowerCase();
  if (!CONVENTIONAL_TYPES.includes(type)) return null;

  const breaking = header[3] === '!' || /^BREAKING[ -]CHANGE:/m.test(message);
  if (breaking) return 'major';
  if (type === 'feat') return 'minor';
  return 'patch';
}

/** Increment a bare "x.y.z" string by the given level. */
export function nextVersion(version, level) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
  if (!m) throw new Error(`Unparseable version: "${version}"`);
  let [major, minor, patch] = m.slice(1).map(Number);
  if (level === 'major') { major += 1; minor = 0; patch = 0; }
  else if (level === 'minor') { minor += 1; patch = 0; }
  else if (level === 'patch') { patch += 1; }
  else throw new Error(`Unknown bump level: "${level}"`);
  return `${major}.${minor}.${patch}`;
}

/**
 * Why this commit should be left alone, or `null` to bump it. `env` is a seam
 * for tests — `main()` passes the real `process.env`.
 */
export function reasonToSkip(message, env = process.env) {
  if (env.BT_BUMP_IN_PROGRESS) return 'bump already in progress';
  const action = env.GIT_REFLOG_ACTION ?? '';
  if (/\b(amend|rebase|merge|cherry-pick|revert)\b/.test(action)) {
    return `git action "${action}"`;
  }
  if (bumpLevel(message) === null) return 'not a conventional commit';
  return null;
}

function readVersion() {
  const text = readFileSync(CONFIG_YAML, 'utf8');
  const m = /^version:\s*"([^"]+)"/m.exec(text);
  if (!m) throw new Error('no `version:` line in budget-server/config.yaml');
  return { text, version: m[1] };
}

function main() {
  let message;
  try {
    message = execFileSync('git', ['log', '-1', '--pretty=%B'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
  } catch {
    return; // no commit to read (e.g. unborn HEAD) — nothing to do
  }

  const skip = reasonToSkip(message);
  if (skip) return; // quiet: this runs on every commit

  const level = bumpLevel(message);
  const { text, version } = readVersion();
  const updated = nextVersion(version, level);

  writeFileSync(
    CONFIG_YAML,
    text.replace(/^version:\s*"[^"]+"/m, `version: "${updated}"`),
  );
  writeFileSync(
    PACKAGE_JSON,
    readFileSync(PACKAGE_JSON, 'utf8')
      .replace(/^(\s*)"version":\s*"[^"]+"/m, `$1"version": "${updated}"`),
  );

  const paths = ['budget-server/config.yaml', 'package.json'];
  const git = (args) => execFileSync('git', args, {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, BT_BUMP_IN_PROGRESS: '1' },
  });
  try {
    // --only: fold ONLY these two files' working-tree changes into the commit.
    // Whatever else the developer had staged (a partial commit, an unrelated
    // `git add`) stays staged and out of the amend.
    git(['commit', '--amend', '--no-edit', '--no-verify', '--only', '--', ...paths]);
  } catch (err) {
    // git ignores a post-commit hook's exit code, so a failed amend (commit
    // signing with no TTY, say) would otherwise leave the bump half-applied
    // and staged with no signal. Put the files back and say what happened.
    try {
      git(['checkout', 'HEAD', '--', ...paths]);
    } catch {
      /* best effort — the message below still tells the developer to look */
    }
    process.stderr.write(
      `bump-version: could not fold the ${version} → ${updated} bump into HEAD ` +
        `(${err instanceof Error ? err.message : String(err)}); files restored. ` +
        `Bump manually if the commit needs it.\n`,
    );
    return;
  }

  process.stderr.write(`↑ version ${version} → ${updated} (${level})\n`);
}

// Only run when invoked directly, so tests can import the pure helpers.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
