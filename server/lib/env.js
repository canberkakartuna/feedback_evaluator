import fs from 'node:fs'

/**
 * Minimal .env loader — no dependency, and deliberate about precedence.
 *
 * Variables already present in the real environment WIN. That matters in two
 * places: a host that injects its own config must not be overridden by a file
 * baked into the deployment, and the smoke test sets its own values before
 * importing config.js and expects them to stick.
 *
 * Supports `KEY=value`, `#` comments, blank lines, quoted values and `export`
 * prefixes. Anything more exotic belongs in a real dotenv package.
 */
export function loadEnvFile(path) {
  if (!fs.existsSync(path)) return { loaded: false, applied: 0, skipped: 0 }

  let applied = 0
  let skipped = 0

  for (const rawLine of fs.readFileSync(path, 'utf8').split('\n')) {
    const line = rawLine.trim().replace(/^export\s+/, '')
    if (!line || line.startsWith('#')) continue

    const eq = line.indexOf('=')
    if (eq < 1) continue

    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()

    const quoted =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    if (quoted && value.length > 1) value = value.slice(1, -1)

    if (process.env[key] === undefined) {
      process.env[key] = value
      applied += 1
    } else {
      skipped += 1
    }
  }

  return { loaded: true, applied, skipped }
}
