import { publicQuestion } from '../../shared/activity.js'
import { withFallbacks } from '../../shared/tutor-scripts.js'
import { displayCode } from './activities.js'
import { notFound } from '../lib/http.js'

/**
 * What a student receives, as opposed to what a teacher authors.
 *
 * This is the read side of an activity and the only path a student's request
 * ever takes to one. It replaces the old services/course.js, which read a
 * hard-coded module; the shape it returns is deliberately the same, so the
 * components that consume it did not have to learn a new one.
 *
 * The important job here is subtraction. A stored question carries the mark
 * scheme (`rubric[].keywords`) and every hint, and neither may reach the
 * browser — the first is the answer key, the second is the thing the student is
 * supposed to earn one at a time. `publicQuestion` in shared/activity.js does
 * the stripping; everything in this file goes through it, and the smoke test
 * asserts that no keyword survives the trip.
 */

/** Stitches the ordinal-derived code on, so Q1/Q2 stay contiguous after a delete. */
const withCodes = (questions) =>
  questions.map((question, index) => ({ ...question, code: displayCode(question, index) }))

/**
 * Full questions, mark scheme included. Server side only — the name is a
 * warning, and nothing that returns this may be handed to a response.
 */
export async function activityQuestions(store, activityId) {
  return withCodes(await store.questions.list({ activityId }))
}

export async function publicActivityById(store, activityId) {
  const activity = await store.activities.findById(activityId)
  if (!activity) throw notFound('No such activity')
  return publicActivity(activity, await activityQuestions(store, activity.id))
}

export function publicActivity(activity, questions) {
  return {
    id: activity.id,
    code: activity.code,
    title: activity.title,
    blurb: activity.blurb,
    status: activity.status,
    questionCount: questions.length,
    questions: questions.map((question) => publicQuestion(question, activity)),
  }
}

/**
 * Resolves a question id to the full stored question plus its activity.
 *
 * Every student route is scoped to a session and a question, and both have to
 * be real before a handler runs. A question the student typed in themselves has
 * no activity and no mark scheme, so it is returned with an empty rubric and
 * the generic script — which is exactly what withFallbacks produces for a
 * teacher-authored question with the tutor fields left blank, so the two cases
 * converge here rather than in every caller.
 */
export async function resolveQuestion(store, session, questionId) {
  const question = await store.questions.findById(questionId)

  if (question) {
    const activity = await store.activities.findById(question.activityId)
    const siblings = await store.questions.list({ activityId: question.activityId })
    const index = siblings.findIndex((entry) => entry.id === question.id)

    return {
      ...question,
      code: displayCode(question, index === -1 ? 0 : index),
      tutor: withFallbacks(question.tutor),
      activityId: question.activityId,
      activityTitle: activity?.title ?? null,
    }
  }

  const own = await store.ownQuestions.findById(questionId)
  if (own && own.sessionId === session.id) {
    return {
      ...own,
      rubric: [],
      tutor: withFallbacks(null),
      activityId: null,
      activityTitle: null,
      isOwnQuestion: true,
    }
  }

  return null
}

/**
 * What a student may start, given who — if anyone — they are.
 *
 * There is no join code any more, so **published is the only gate**. An
 * activity a teacher has published is startable by whoever is looking, and an
 * anonymous visitor sees all of them. That is a deliberate consequence of
 * dropping codes rather than an oversight: with no credential and no code,
 * publishing is the entire access decision, which is why a draft is invisible
 * and unpublishing is the way to close something down.
 *
 * A **signed-in student** is narrowed to their own teacher's work instead,
 * because there is a roster to narrow by and a shorter list is a better list.
 * A student nobody has assigned to a teacher yet falls back to the open list
 * rather than an empty one — otherwise having an account would be worse than
 * not having one.
 */
export async function studentActivities(store, user) {
  const activities = await store.activities.list(
    user?.teacherId
      ? { ownerId: user.teacherId, status: 'published' }
      : { status: 'published' },
  )

  return Promise.all(
    activities.map(async (activity) => ({
      id: activity.id,
      title: activity.title,
      blurb: activity.blurb,
      questionCount: await store.questions.count({ activityId: activity.id }),
    })),
  )
}
