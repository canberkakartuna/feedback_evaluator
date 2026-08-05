/**
 * Activities and the questions inside them.
 *
 * An **activity** is what a teacher builds and hands to a class: a title and an
 * ordered list of questions. It replaces the hard-coded course that used to
 * live in shared/course.js — nothing here is content, only the shape content
 * has to take.
 *
 *   activity  { id, code, title, blurb, topic, ownerId, status,
 *               createdAt, updatedAt }
 *   question  { id, activityId, code, kind, prompt, image, stimulus,
 *               workingExpected, rubric[], tutor{}, position, ... }
 *
 * **An activity carries a class code.** Six characters, generated once, shown to
 * the teacher so a class can be pointed straight at one activity — typed into
 * /join, or followed as a link. It is a shortcut, not a credential: a code only
 * opens an activity that is already published, so publishing is still the whole
 * access decision. See services/activities.js.
 *
 * **A question is a typed prompt, an uploaded image, or both.** Retyping a
 * question out of a textbook is the slowest part of setting work, so a teacher
 * can photograph it instead. `hasQuestion` below is the one place that decides
 * whether a question actually asks anything; everything else asks it rather
 * than testing the two fields itself.
 *
 * **The rubric and the tutor script are optional.** A teacher who types only a
 * prompt gets a question that still works: the chat answers from the
 * system-wide AI prompt, and the answer is handed on unmarked rather than
 * scored against criteria that were never written. A teacher who fills them in
 * gets per-criterion marking and scripted hint escalation on top. Everything
 * downstream — marking, the tutor, the student payload — reads the helpers here
 * rather than testing for empty arrays itself, so "no rubric" means the same
 * thing everywhere.
 *
 * This file is in shared/ because the teacher's authoring form and the server's
 * validation have to agree on the same limits. The client's copy is a courtesy:
 * services/activities.js validates every one of these again, and that is the
 * copy that holds.
 */

export const ACTIVITY_STATUSES = ['draft', 'published']

export const isActivityStatus = (value) => ACTIVITY_STATUSES.includes(value)

/**
 * The label above a question. Free text would fragment into "Explain",
 * "explain" and "Explanation" across three teachers, and it is a filter in the
 * researcher export, so it is a fixed list.
 */
export const QUESTION_KINDS = [
  'Explain',
  'Calculate',
  'Read the data',
  'Compare',
  'Evaluate',
  'Define',
  'Diagram',
  'Other',
]

export const isQuestionKind = (value) => QUESTION_KINDS.includes(value)

/**
 * What an activity is *about*, so a class of thirty is not handed a list of
 * twenty activities to read through.
 *
 * A fixed list for the same reason QUESTION_KINDS is one: it is a filter, and a
 * filter over free text fragments into "Ratio", "ratio" and "Ratios" across
 * three teachers. Adding a topic is one line here — the client's labels are
 * keyed by `id` in src/lib/strings.js, so a new id needs a translation there
 * too or it will show its own id.
 *
 * `null` is a first-class value and means "no topic set". Every activity
 * authored before this existed is in that state, and so is any a teacher simply
 * has not classified, so both lists treat it as a bucket rather than a gap.
 *
 * Ids only — the words are in src/lib/strings.js under `topics.*`, for the same
 * reason shared/marks.js holds no words: this file is imported by the API, which
 * has no language to say them in.
 */
export const TOPICS = [{ id: 'ratio' }, { id: 'whole-numbers' }]

export const TOPIC_IDS = TOPICS.map((topic) => topic.id)

export const isTopic = (value) => TOPIC_IDS.includes(value)

export const LIMITS = {
  title: 200,
  blurb: 500,
  prompt: 5000,
  code: 24, // a question's own label, e.g. "BIO-101". An activity's class code
  //           is generated rather than typed — see services/activities.js
  criterionLabel: 300,
  criterionCoach: 1000,
  keyword: 100,
  keywordsPerCriterion: 30,
  criteria: 20,
  hint: 2000,
  hints: 10,
  tutorField: 4000,
  questionsPerActivity: 200,
}

/** Every tutor field present and empty, so no reader has to guard for absence. */
export function blankTutor() {
  return { opening: '', hints: [], concept: '', example: '', misconception: '' }
}

export function normaliseTutor(tutor) {
  return { ...blankTutor(), ...(tutor ?? {}) }
}

/**
 * Whether a question can be marked at all.
 *
 * A rubric with no criteria is not a question worth zero — it is a question
 * nobody wrote a mark scheme for, and the difference matters: the first would
 * show a student 0/0 and call it feedback.
 */
export const hasRubric = (question) => (question?.rubric?.length ?? 0) > 0

export const totalPoints = (question) =>
  (question?.rubric ?? []).reduce((sum, criterion) => sum + (criterion.points ?? 0), 0)

export const hintCount = (question) => question?.tutor?.hints?.length ?? 0

/**
 * Whether this question puts a question to the student at all.
 *
 * Either half is enough. Requiring the prompt when there is a legible photo of
 * the question would make a teacher transcribe something the class can already
 * read, and requiring neither would let an empty card reach a student.
 */
export const hasQuestion = (question) =>
  Boolean(question?.prompt?.trim() || question?.image)

/**
 * What a student is allowed to receive.
 *
 * Rubric keywords and tutor scripts stay on the server. Shipping them would put
 * the mark scheme and every hint in the page source — the client sees a
 * criterion label only once its own answer has been marked against it, and
 * `criteriaCount` is a count precisely so the labels themselves stay back.
 */
export function publicQuestion(question, activity) {
  return {
    id: question.id,
    code: question.code,
    kind: question.kind,
    points: totalPoints(question),
    prompt: question.prompt,
    /**
     * The uploaded question, when there is one. Only the fields needed to
     * render it — the storage key and path stay on the server, the same way
     * they do for a student's own upload.
     */
    image: question.image
      ? {
          id: question.image.id,
          name: question.image.name,
          type: question.image.type,
          url: question.image.url,
        }
      : null,
    stimulus: question.stimulus ?? null,
    workingExpected: Boolean(question.workingExpected),
    markable: hasRubric(question),
    criteriaCount: question.rubric?.length ?? 0,
    hintCount: hintCount(question),
    /**
     * The one tutor field that does travel, and **only if a teacher wrote it**.
     *
     * It is the line the chat opens on, so it is shown before the student has
     * done anything — there is nothing to earn by withholding it, and holding
     * it back would mean an empty chat pane on every question. The hints,
     * concept, worked example and misconception all stay on the server, where
     * they are released a step at a time through the tutor route.
     *
     * `null` when the field was left blank, rather than the generic English line
     * this used to substitute here. That substitution put interface text into a
     * content field: a Turkish class working on an activity with no authored
     * opening was greeted in English, and no language switch could reach it,
     * because by the time the browser saw the sentence it was indistinguishable
     * from something a teacher had typed. The generic greeting is chrome, so the
     * client says it — see TutorPanel and `tp.opening`.
     */
    opening: question.tutor?.opening?.trim() || null,
    position: question.position,
    activityId: question.activityId,
    activityTitle: activity?.title ?? null,
  }
}
