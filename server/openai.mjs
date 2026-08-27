/**
 * Check that the tutor's model is reachable, and see what it sounds like.
 *
 *   npm run check:openai
 *   npm run check:openai -- "your own question here"
 *
 * One real request against one real question, with the same system instruction
 * a student's turn would get — which is the point: an API key that authenticates
 * proves nothing about whether the model comes back with text inside the token
 * budget, and that is the failure this catches. The smoke test deliberately runs
 * the tutor scripted, so this is the only place the live path is exercised.
 *
 * Costs a fraction of a cent per run — nothing at all inside the free tier's
 * daily allowance — and writes nothing anywhere.
 */
import { config } from './config.js'
import { reply } from './services/tutor.js'
import { withFallbacks } from '../shared/tutor-scripts.js'

if (!config.openai.configured) {
  console.error(`
OPENAI_API_KEY is not set, so the tutor is answering from the scripted lines in
shared/tutor-scripts.js and no model runs.

Create a key at
  https://platform.openai.com/api-keys

then put it in .env.local, which is gitignored:

  OPENAI_API_KEY=...

Never in .env — that file is committed, so a key in it is shared with everyone
who can read the repository, permanently. The model name and the rest of the
knobs do belong there and are already set.
`)
  process.exit(1)
}

const question = {
  id: 'check',
  code: 'CHK-01',
  kind: 'Short answer',
  points: 3,
  prompt:
    process.argv[2] ??
    'A car travels 150 m in 12 s, then brakes to rest in another 8 s. Find its average speed for the whole journey.',
  rubric: [
    { id: 'c1', label: 'Uses total distance over total time', points: 2, coach: 'Not the average of two speeds.', keywords: ['total'] },
    { id: 'c2', label: 'States the unit', points: 1, coach: 'Metres per second.', keywords: ['m/s'] },
  ],
  tutor: withFallbacks(null),
}

const answer = { mode: 'write', draft: 'I did 150 divided by 12 which is 12.5 and then halved it.', hintsUsed: 0 }

console.log(`\nmodel    ${config.openai.model}`)
console.log(`timeout  ${config.openai.timeoutMs}ms`)
console.log(
  `effort   ${config.openai.reasoningEffort ?? 'not a reasoning model'} · temperature ${config.openai.temperature ?? "the model's own default"} · ${config.openai.maxOutputTokens} output tokens for reasoning and reply together`,
)
console.log(`\nquestion ${question.prompt}`)
console.log(`answer   ${answer.draft}\n`)

/**
 * Both halves of the split in services/tutor.js: a turn the model answers, and
 * one where a teacher's own words win. The second must come back `scripted`
 * even with a working key — if it does not, authored teaching is being
 * paraphrased and that is a bug, not a preference.
 */
const turns = [
  { label: 'review', action: 'review', lang: 'en' },
  { label: 'hint 1 (no script)', action: 'hint', lang: 'en' },
  { label: 'free text (Turkish)', text: 'Ortalama hız nedir, tam olarak anlamadım.', lang: 'tr' },
  { label: 'hint 1 (teacher wrote one)', action: 'hint', lang: 'en', authored: true },
]

let failed = 0

for (const turn of turns) {
  const scripted = turn.authored
    ? { ...question, tutor: withFallbacks({ hints: ['Start with the definition: total distance over total time.'] }) }
    : question

  const generated = await reply({
    question: scripted,
    answer,
    action: turn.action ?? null,
    text: turn.text ?? 'Give me a hint.',
    promptVersion: null,
    systemPrompt: null,
    thread: [],
    lang: turn.lang,
  })

  const expected = turn.authored ? 'scripted' : 'openai'
  const ok = generated.source === expected

  if (!ok) failed += 1

  console.log(`${ok ? '✓' : '✗'} ${turn.label} → ${generated.source}${generated.model ? ` (${generated.model})` : ''}`)
  console.log(`  ${generated.label ? `[${generated.label}] ` : ''}${generated.text.replaceAll('\n', '\n  ')}\n`)
}

if (failed) {
  console.error(
    `${failed} of ${turns.length} turns did not come from where they should. A "fallback" where "openai" was expected is a failed call — the reason is on the line above it, logged by services/tutor.js.\n`,
  )
  process.exit(1)
}

console.log(`All ${turns.length} turns came from where they should.\n`)
