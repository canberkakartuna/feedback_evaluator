/**
 * Points git at the tracked hooks in .githooks/ (see .githooks/pre-commit).
 * Runs as npm's `prepare` step, so it must never fail an install: the Docker
 * build and other checkouts without .git simply skip it.
 */
import { execFileSync } from 'node:child_process'

try {
  execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { stdio: 'ignore' })
  execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { stdio: 'ignore' })
  console.log('git hooks: core.hooksPath -> .githooks')
} catch {
  // Not a git checkout, or git is not installed — nothing to install into.
}
