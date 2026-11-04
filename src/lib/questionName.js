/**
 * What a student calls a question: "Q2" in English, "Soru 2" in Turkish, by its
 * place in the list (3 Nov 2026 doc). Own questions count separately — "My Q1",
 * "Kendi sorum 1" — because they sit in their own group.
 *
 * Interface text rather than the authored `code`, so it follows the language
 * switch. A question with no `number` (teacher screens, which never set one)
 * falls back to its code.
 */
export function questionName(question, t) {
  if (!question) return '—'
  if (!question.number) return question.code ?? ''
  return question.isOwnQuestion
    ? t('qname.own', { n: question.number })
    : t('qname.authored', { n: question.number })
}

/** Numbers authored and own questions 1…n, each within its own group. */
export function numberQuestions(questions) {
  let authored = 0
  let own = 0
  return questions.map((question) => ({
    ...question,
    number: question.isOwnQuestion ? ++own : ++authored,
  }))
}
