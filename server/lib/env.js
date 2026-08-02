import fs from 'node:fs'

/**
 * Minimal .env loader — no dependency, and deliberate about precedence.
 *
 * Variables already present in the real environment WIN. That matters in two
 * places: a host that injects its own config must not be overridden by a file
 * baked into the deployment, and the smoke test sets its own values before
 * importing config.js and expects them to stick.
 *
 * Supports `KEY=value`, comments, blank lines, quoted values and `export`
 * prefixes. Anything more exotic belongs in a real dotenv package.
 *
 * **Inline comments are stripped**, which they were not until a pasted
 * credential arrived as `SPACES_KEY=DO00… # DigitalOcean Spaces Access Key` and
 * the whole trailing label became part of the key. Nothing reported a problem:
 * the value was set, `configured` went true, and the only symptom was every
 * request to Spaces failing to authenticate.
 *
 * A `#` only starts a comment when whitespace precedes it, so a value may still
 * contain one — `PASSWORD=hunter2#4` keeps its hash. To keep a value with a
 * space before a hash, quote it.
 */

/** Cuts an unquoted value at the first ` #`, and returns quoted values whole. */
function parseValue(raw) {
  const value = raw.trim()

  const quote = value[0]
  if (quote === '"' || quote === "'") {
    const end = value.indexOf(quote, 1)
    // Unterminated: hand back what is there rather than silently truncating.
    if (end === -1) return value.slice(1)
    return value.slice(1, end)
  }

  const comment = value.search(/\s#/)
  return (comment === -1 ? value : value.slice(0, comment)).trim()
}
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
    const value = parseValue(line.slice(eq + 1))

    if (process.env[key] === undefined) {
      process.env[key] = value
      applied += 1
    } else {
      skipped += 1
    }
  }

  return { loaded: true, applied, skipped }
}
