/**
 * The Functions activity: five questions, each written in English and Turkish,
 * owned by a teacher and published.
 *
 *   npm run seed:functions -- teacher@example.com            # create + publish
 *   npm run seed:functions -- teacher@example.com --draft    # create, leave closed
 *
 * Runs against whatever store `config.js` picks — MongoDB when MONGODB_URI is
 * set (in `.env.local` locally), the in-memory store otherwise, which is a dry
 * run that checks the questions validate and then forgets them.
 *
 * **Idempotent.** An activity with this title already owned by the teacher
 * stops the script rather than adding a second copy, so running it twice is
 * harmless. Edit the questions from the teacher console after that: they are
 * ordinary authored content from the moment they exist.
 *
 * Every question goes through `parseQuestionInput`, the validation the
 * authoring API applies, so nothing here can store a shape a teacher could
 * not have typed.
 */
import { pathToFileURL } from 'node:url'
import { config } from './config.js'
import { createStore } from './store/index.js'
import {
  createActivity,
  newQuestion,
  nextPosition,
  parseQuestionInput,
} from './services/activities.js'
import { hasQuestion } from '../shared/activity.js'
import { now } from './lib/http.js'

export const TITLE = 'Fonksiyonlar · Functions'

const BLURB = 'Fonksiyon eşitliği, fonksiyon değerleri ve bileşke fonksiyonlar. · Equal functions, function values and composition.'

/**
 * `prompt` is the fallback for a language left blank; both languages are
 * written out, so it is never actually reached here. `answer` goes to the
 * tutor only — see publicQuestion in shared/activity.js.
 */
const QUESTIONS = [
  {
    kind: 'Compare',
    promptByLang: {
      en: String.raw`Determine whether the given functions are equal.

$$f(x) = \begin{cases} \dfrac{x^2 - 4x + 3}{x - 3} & \text{if } x \neq 3 \\ 2 & \text{if } x = 3 \end{cases} \qquad g(x) = x - 1$$`,
      tr: String.raw`Verilen fonksiyonlar eşit mi?

$$f(x) = \begin{cases} \dfrac{x^2 - 4x + 3}{x - 3} & x \neq 3 \text{ ise} \\ 2 & x = 3 \text{ ise} \end{cases} \qquad g(x) = x - 1$$`,
    },
    answer: String.raw`Yes, f = g. Both are defined for every real number. For $x \neq 3$: $\frac{x^2-4x+3}{x-3} = \frac{(x-1)(x-3)}{x-3} = x - 1 = g(x)$. At $x = 3$: $f(3) = 2$ and $g(3) = 3 - 1 = 2$. Same domain and the same value everywhere, so the functions are equal.`,
  },
  {
    kind: 'Calculate',
    promptByLang: {
      en: String.raw`Find the function values for each function.

$$G(x) = 2 - x^2;\quad G(-8),\; G(u),\; G(u^2)$$`,
      tr: String.raw`Her bir fonksiyon için fonksiyon değerlerini bulun.

$$G(x) = 2 - x^2;\quad G(-8),\; G(u),\; G(u^2)$$`,
    },
    answer: String.raw`$G(-8) = 2 - 64 = -62$; $G(u) = 2 - u^2$; $G(u^2) = 2 - u^4$.`,
  },
  {
    kind: 'Calculate',
    promptByLang: {
      en: String.raw`Find the function values for each function.

$$F(x) = -7x + 1;\quad F(s),\; F(t + 1),\; F(x + 3)$$`,
      tr: String.raw`Her bir fonksiyon için fonksiyon değerlerini bulun.

$$F(x) = -7x + 1;\quad F(s),\; F(t + 1),\; F(x + 3)$$`,
    },
    answer: String.raw`$F(s) = -7s + 1$; $F(t+1) = -7(t+1) + 1 = -7t - 6$; $F(x+3) = -7(x+3) + 1 = -7x - 20$.`,
  },
  {
    kind: 'Calculate',
    promptByLang: {
      en: String.raw`If $f(x) = x^2 - 1$ and $g(x) = x^2 + x$, find $(g \circ f)(-3)$.`,
      tr: String.raw`$f(x) = x^2 - 1$ ve $g(x) = x^2 + x$ ise $(g \circ f)(-3)$ değerini bulun.`,
    },
    answer: String.raw`$(g \circ f)(-3) = g(f(-3))$. $f(-3) = 9 - 1 = 8$, then $g(8) = 64 + 8 = 72$. Answer: 72.`,
  },
  {
    kind: 'Calculate',
    promptByLang: {
      en: String.raw`If $f(x) = 3x^2 + 6$ and $g(x) = 4 - 2x$, find $f(g(2))$ and $g(f(2))$.`,
      tr: String.raw`$f(x) = 3x^2 + 6$ ve $g(x) = 4 - 2x$ ise $f(g(2))$ ve $g(f(2))$ değerlerini bulun.`,
    },
    answer: String.raw`$g(2) = 4 - 4 = 0$, so $f(g(2)) = f(0) = 6$. $f(2) = 12 + 6 = 18$, so $g(f(2)) = g(18) = 4 - 36 = -32$.`,
  },
]

/**
 * Creates the activity for `ownerId` unless they already have one by this
 * title. Exported so the smoke test can run exactly what the command runs.
 *
 * @returns {{ activity: object, questions: object[], created: boolean }}
 */
export async function seedFunctions(store, { ownerId, draft = false }) {
  const existing = (await store.activities.list({ ownerId })).find((activity) => activity.title === TITLE)
  if (existing) {
    return { activity: existing, questions: await store.questions.list({ activityId: existing.id }), created: false }
  }

  // Validated before anything is written, so a bad question cannot leave half an activity.
  const parsed = QUESTIONS.map((fields, index) => {
    const patch = parseQuestionInput({ ...fields, prompt: fields.promptByLang.en }, { forCreate: true })
    if (!hasQuestion(patch)) throw new Error(`Question ${index + 1} asks nothing`)
    return patch
  })

  const activity = await createActivity(store, { title: TITLE, blurb: BLURB, topic: 'functions', ownerId })

  const questions = []
  for (const patch of parsed) {
    questions.push(
      await store.questions.create(
        newQuestion({ activityId: activity.id, position: nextPosition(questions), ...patch }),
      ),
    )
  }

  const final = draft
    ? activity
    : await store.activities.update(activity.id, { status: 'published', updatedAt: now() })

  return { activity: final, questions, created: true }
}

/* The command itself — skipped when imported. */
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = process.argv.slice(2)
  const email = args.find((arg) => !arg.startsWith('--'))
  const draft = args.includes('--draft')

  if (!email) {
    console.error('Usage: npm run seed:functions -- <teacher email> [--draft]')
    process.exit(1)
  }

  console.log(`store: ${config.mongoUri ? `mongodb (${config.mongoDb})` : 'in-memory — a dry run, nothing is kept'}`)

  const store = createStore()

  try {
    const owner = await store.users.findByEmail(email)

    // The in-memory store starts empty, so a dry run has nobody to look up.
    if (!owner && config.mongoUri) throw new Error(`No user has the email ${email}`)
    if (owner && !['teacher', 'manager', 'admin'].includes(owner.role)) {
      throw new Error(`${email} is a ${owner.role} — activities belong to a teacher`)
    }

    const { activity, questions, created } = await seedFunctions(store, {
      ownerId: owner?.id ?? 'usr_dry_run',
      draft,
    })

    console.log(
      created
        ? `Created "${TITLE}" (${activity.id}) with ${questions.length} questions.`
        : `Already there: "${TITLE}" (${activity.id}). Nothing changed.`,
    )
    console.log(`Class code ${activity.code} · ${activity.status}`)
  } catch (error) {
    console.error(`seed failed: ${error.message}`)
    process.exitCode = 1
  } finally {
    await store.close?.()
  }
}
