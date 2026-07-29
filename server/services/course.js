import { course } from '../../shared/course.js'
import { notFound } from '../lib/http.js'

/**
 * What a student is allowed to receive.
 *
 * Rubric keywords and tutor scripts stay on the server. Shipping them would
 * put the mark scheme and every hint in the page source — the client only ever
 * sees a criterion label once its own answer has been marked against it.
 */
function publicQuestion(question, group) {
  return {
    id: question.id,
    code: question.code,
    kind: question.kind,
    points: question.points,
    prompt: question.prompt,
    stimulus: question.stimulus ?? null,
    workingExpected: Boolean(question.workingExpected),
    criteriaCount: question.rubric.length,
    hintCount: question.tutor.hints.length,
    groupId: group.id,
    groupTitle: group.title,
  }
}

export function publicCourse(topicId = 'all') {
  const groups =
    topicId === 'all' ? course.groups : course.groups.filter((group) => group.id === topicId)

  if (!groups.length) throw notFound(`No topic "${topicId}"`)

  return {
    title: course.title,
    subtitle: course.subtitle,
    topicId,
    groups: groups.map((group) => ({
      id: group.id,
      title: group.title,
      blurb: group.blurb,
      questions: group.questions.map((question) => publicQuestion(question, group)),
    })),
  }
}

export function topics() {
  return course.groups.map((group) => ({
    id: group.id,
    title: group.title,
    blurb: group.blurb,
    questionCount: group.questions.length,
  }))
}

/** Full question, rubric and scripts included. Server side only. */
export function findQuestion(questionId) {
  for (const group of course.groups) {
    const question = group.questions.find((entry) => entry.id === questionId)
    if (question) return { ...question, groupId: group.id, groupTitle: group.title }
  }
  return null
}
