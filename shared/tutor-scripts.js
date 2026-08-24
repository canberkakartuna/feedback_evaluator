/**
 * Generic tutor lines, used when a question carries no script of its own.
 *
 * Two cases reach these, and neither is a content gap to be filled in later:
 *
 * - a question the **student** typed in themselves, which by definition nobody
 *   wrote hints for;
 * - a question the **teacher** created without filling in the optional tutor
 *   fields, which shared/activity.js allows on purpose.
 *
 * Everything here is deliberately subject-neutral — it has to read sensibly
 * against a question this file has never seen. Anything specific to a topic
 * belongs on the question, authored by the teacher who set it.
 *
 * `fallbackReplies` is what the tutor says when the model cannot: no
 * `GEMINI_API_KEY`, a timeout, a rate limit, a blocked prompt. They are not
 * decoration — a student pressing send is owed a sentence, and an empty bubble
 * or a stack trace is worse than a generic nudge. Keep them answerable against
 * any question, because that is the situation they are read in.
 */

/**
 * No `opening` here, on purpose.
 *
 * The chat's first line is the one tutor field the browser renders itself, so an
 * unauthored one is interface text and belongs with the rest of it — see
 * `tp.opening` in src/lib/strings.js, which exists in both languages. Putting a
 * generic English sentence in this file meant `publicQuestion` shipped it as if
 * a teacher had written it, and nothing downstream could tell the difference or
 * translate it.
 *
 * The rest of these lines are delivered as tutor *replies*, a step at a time,
 * and follow the same rule as the marking summaries: produced server-side, shown
 * as written. **They are the unconfigured and the failed path only.** With
 * `GEMINI_API_KEY` set, a question nobody wrote a script for is answered by the
 * model instead. Both paths follow the interface language now — `ownTutorFor`
 * and `fallbackReplyFor` take it as an argument, since `withFallbacks` below
 * has no `lang` in scope when it merges these onto a question.
 */
/**
 * One tree per language, same shape as `en` — mirrors the `DICTIONARIES`
 * pattern in src/lib/strings.js rather than per-key `{ en, tr }` objects, so a
 * translator can work from one language's tree at a time.
 */
const OWN_TUTOR = {
  en: {
    hints: [
      'Tell me what you have tried so far. The first line that stopped making sense is usually where to start.',
      'Write down what you know and what you are looking for, then find the rule that connects the two.',
      'Try the smallest version of this problem first — smaller numbers, one variable — then scale it back up.',
    ],
    concept:
      'Tell me which topic this belongs to and I will lay out the idea behind it before we touch any numbers.',
    example:
      'Give me the exact question and I will work through a similar one line by line, then you try yours.',
    misconception:
      'Read your working back one line at a time and justify each step out loud. The first line you cannot justify is the line with the mistake in it.',
  },
  tr: {
    hints: [
      'Bana şimdiye kadar ne denediğini anlat. Genelde işin mantığının kaybolduğu ilk satır, başlanması gereken yerdir.',
      'Bildiklerini ve bulmaya çalıştığın şeyi yaz, sonra ikisini birbirine bağlayan kuralı bul.',
      'Önce bu sorunun en küçük halini dene — daha küçük sayılar, tek bir bilinmeyen — sonra yeniden büyüt.',
    ],
    concept:
      'Bunun hangi konuya ait olduğunu söyle, sayılara dokunmadan önce arkasındaki fikri anlatayım.',
    example:
      'Bana sorunun aynısını ver, benzer bir örneği satır satır çözeyim, sonra sırayı sana bırakayım.',
    misconception:
      'Çözümünü satır satır geriye doğru oku ve her adımı sesli olarak gerekçelendir. Gerekçelendiremediğin ilk satır, hatanın olduğu satırdır.',
  },
}

/** English by default, unchanged for existing callers that never see a language. */
export const ownTutor = OWN_TUTOR.en

/** The generic script in a given interface language, English for anything unrecognised. */
export function ownTutorFor(lang) {
  return OWN_TUTOR[lang] ?? OWN_TUTOR.en
}

/**
 * Filled in per field, so a teacher who wrote hints but no worked example gets
 * their hints and a sensible stand-in for the example — not all-or-nothing.
 *
 * `authored` records which fields were real, because once a model is answering
 * that difference decides who speaks: services/tutor.js delivers a teacher's
 * own hint, concept or worked example verbatim, and asks the model only where
 * nobody wrote one. Server-side only, like the rest of this object —
 * `publicQuestion` is an allow-list and does not carry it.
 */
export function withFallbacks(tutor) {
  const script = tutor ?? {}
  return {
    hints: script.hints?.length ? script.hints : ownTutor.hints,
    concept: script.concept?.trim() || ownTutor.concept,
    example: script.example?.trim() || ownTutor.example,
    misconception: script.misconception?.trim() || ownTutor.misconception,
    authored: {
      hints: Boolean(script.hints?.length),
      concept: Boolean(script.concept?.trim()),
      example: Boolean(script.example?.trim()),
      misconception: Boolean(script.misconception?.trim()),
    },
  }
}

const FALLBACK_REPLIES = {
  en: [
    'Good — say more about the second half of that. Which part are you least sure of?',
    'That is the right instinct, but the step in between is missing. What links those two ideas?',
    'Close. One term in there is doing the wrong job — read it back and tell me which one you would swap.',
    'Yes. Now write it as one sentence in your answer box and I will read the phrasing.',
    'Let us test that. If it were true, what would you expect the result to look like instead?',
  ],
  tr: [
    'Güzel — bunun ikinci yarısını biraz daha anlat. En emin olamadığın kısım hangisi?',
    'İçgüdün doğru, ama aradaki adım eksik. Bu iki fikri birbirine bağlayan şey ne?',
    'Yaklaştın. İçindeki bir terim yanlış işi yapıyor — geri oku ve hangisini değiştirirdin, söyle.',
    'Evet. Şimdi bunu cevap kutusuna tek bir cümle olarak yaz, ifadeni okuyayım.',
    'Hadi bunu sınayalım. Bu doğru olsaydı, sonucun nasıl görünmesini beklerdin?',
  ],
}

/** English by default, unchanged for existing callers that never see a language. */
export const fallbackReplies = FALLBACK_REPLIES.en

/** The generic free-text fallback in a given interface language. */
export function fallbackReplyFor(lang, words) {
  const replies = FALLBACK_REPLIES[lang] ?? FALLBACK_REPLIES.en
  return replies[words % replies.length]
}
