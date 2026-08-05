/**
 * Checks the two dictionaries against the code that reads them.
 *
 *   npm run check:strings
 *
 * Three failures, all of them the kind that ships silently otherwise:
 *
 * 1. **Used but missing** — a `t('foo.bar')` with no `foo.bar` in a dictionary.
 *    The screen would print `foo.bar` at a reader.
 * 2. **In one language only** — the commonest way a translation rots. English
 *    gains a line, Turkish does not, and the Turkish interface quietly falls back
 *    to English for that one sentence.
 * 3. **Defined but unused** — dead words. Not a failure, only a list, since a key
 *    can be reached through a computed name.
 *
 * Computed keys — `t(`topics.${id}`)` — cannot be resolved by reading the source,
 * so they are skipped by (1) and their prefixes are exempted from (3) below.
 * Every one of them is a family whose members are enumerated somewhere in
 * shared/, and that enumeration is what keeps them honest.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const { DICTIONARIES } = await import(path.join(root, 'src/lib/strings.js'))

function flatten(source, prefix = '', out = {}) {
  for (const [key, value] of Object.entries(source)) {
    const at = prefix ? `${prefix}.${key}` : key
    if (value && typeof value === 'object') flatten(value, at, out)
    else out[at] = value
  }
  return out
}

const flat = Object.fromEntries(
  Object.entries(DICTIONARIES).map(([lang, dictionary]) => [lang, flatten(dictionary)]),
)
const languages = Object.keys(flat)

/**
 * Prefixes reached by a computed key. Anything under one of these is assumed
 * used; anything else that is defined and never mentioned is reported.
 */
const COMPUTED = [
  'topics.',
  'marks.',
  'modes.',
  'people.role',
  'people.blurb',
  'wb.ink',
  'tp.',
  'qp.discard',
  // Read as `labelling.${value}` from a three-element list of ids.
  'labelling.yes',
  'labelling.partly',
  'labelling.no',
]

async function sources(dir) {
  const found = []
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) found.push(...(await sources(full)))
    else if (/\.jsx?$/.test(entry.name) && entry.name !== 'strings.js') found.push(full)
  }
  return found
}

const files = await sources(path.join(root, 'src'))

/** `t('a.b')` and `t("a.b")`, but never a template literal. */
const USE = /\bt\(\s*['"]([\w.-]+)['"]/g

/**
 * Any quoted dotted-lowercase string, wherever it appears.
 *
 * A key does not have to be written inside the call that reads it: the console
 * nav holds `{ key: 'teacher.activities' }` in a table, TopBar takes
 * `homeKey="nav.studentView"` as a prop, and QuestionPanel keeps a `{ write:
 * 'common.words' }` lookup. None of those are a `t(...)` and all of them are
 * real uses, so they count towards "is this key read anywhere" — but not
 * towards "does this key exist", which only a literal call can be sure of.
 */
const MENTION = /['"]([a-z][\w-]*(?:\.[\w-]+)+)['"]/g

const used = new Map() // key -> where it was seen first
const mentioned = new Set()

for (const file of files) {
  const text = await fs.readFile(file, 'utf8')
  for (const match of text.matchAll(USE)) {
    if (!used.has(match[1])) used.set(match[1], path.relative(root, file))
  }
  for (const match of text.matchAll(MENTION)) mentioned.add(match[1])
}

const problems = []

// (1) and (2), together: a key is wanted in every language or in none.
for (const [key, where] of used) {
  for (const lang of languages) {
    const has =
      flat[lang][key] !== undefined ||
      (flat[lang][`${key}_one`] !== undefined && flat[lang][`${key}_other`] !== undefined)

    if (!has) problems.push(`missing [${lang}] ${key}  (${where})`)
  }
}

// (2) again, from the other side: a string one language has and another does not.
const everyKey = new Set(languages.flatMap((lang) => Object.keys(flat[lang])))
for (const key of everyKey) {
  const absent = languages.filter((lang) => flat[lang][key] === undefined)
  if (absent.length) problems.push(`untranslated: ${key} is missing from ${absent.join(', ')}`)
}

// (3) — reported, never fatal.
const plural = (key) => key.replace(/_(one|other)$/, '')
const unused = [...everyKey]
  .filter((key) => !used.has(key) && !used.has(plural(key)))
  .filter((key) => !mentioned.has(key) && !mentioned.has(plural(key)))
  .filter((key) => !COMPUTED.some((prefix) => key.startsWith(prefix)))
  .sort()

console.log(`${used.size} keys used across ${files.length} files`)
console.log(`${Object.keys(flat[languages[0]]).length} defined per language (${languages.join(', ')})`)

if (unused.length) {
  console.log(`\n${unused.length} defined but never read:`)
  for (const key of unused) console.log(`  · ${key}`)
}

if (problems.length) {
  console.error(`\n${problems.length} problem${problems.length === 1 ? '' : 's'}:`)
  for (const problem of problems) console.error(`  ✗ ${problem}`)
  process.exit(1)
}

console.log('\nevery key used is present in every language ✓')
