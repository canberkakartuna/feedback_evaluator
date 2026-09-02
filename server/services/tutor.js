import fs from 'node:fs/promises'
import { fallbackReplyFor, ownTutorFor } from '../../shared/tutor-scripts.js'
import { hasAnswer, totalPoints } from '../../shared/activity.js'
import { contentCount, hasContent, uploadedFiles } from '../../shared/answer.js'
import { wordCount } from '../../shared/marking.js'
import { badRequest } from '../lib/http.js'
import { config } from '../config.js'
import { generate } from '../lib/openai.js'
import { storage } from '../lib/storage.js'

/**
 * Where the tutor's replies come from.
 *
 * Two sources, and which one answers is decided per turn rather than per
 * deployment:
 *
 * - **The teacher.** A hint, a concept explanation or a worked example that
 *   somebody authored is delivered exactly as written. It is their teaching,
 *   the study is about the feedback students actually receive, and a model
 *   paraphrasing a carefully staged hint would quietly replace both.
 * - **The model** (OpenAI, `lib/openai.js`). Everything addressed to what the
 *   student actually wrote — free text, "check my reasoning" — plus every turn
 *   nobody authored a script for, which is the whole of a student's own
 *   question and any tutor field a teacher left blank.
 *
 * `scriptedReply` is the third state: no `OPENAI_API_KEY`, or the call failed.
 * It is the function this module used to be, unchanged, and it stays the
 * fallback for every path — so the app runs end to end with no key at all and a
 * student never waits on an empty bubble. `source` on the stored message says
 * which of the two spoke, so the dataset can tell them apart afterwards.
 *
 * **Hint escalation stays here regardless.** The server counts hints and holds
 * their text, so a student cannot read hint three out of the page before asking
 * for hint one, and that is true whether the text was authored or generated:
 * the model is asked for hint *n* and told nothing about what hint *n + 1*
 * would reveal.
 *
 * **The question's own image does travel.** A teacher who photographs a
 * question instead of typing it used to produce a tutor that had never seen
 * the question at all — the system instruction carried an empty prompt and the
 * model deflected. Now the uploaded question (JPG, PNG or WebP) is attached to
 * the conversation as an image the model reads; HEIC and PDF are formats the
 * API refuses, so for those the instruction says honestly that the question is
 * a file it cannot view. See imageForModel below.
 *
 * Still not sent to the model: whiteboard strokes and photographs of the
 * student's *working*. The honest scripted line ("I cannot read a drawing or a
 * photo yet") stands in until they are fetched and attached the same way — the
 * obvious next step for this file.
 */

export const ACTIONS = ['hint', 'concept', 'example', 'review']

const ASKS = {
  hint: (used) => (used === 0 ? 'Give me a hint.' : 'Another hint, please.'),
  concept: () => 'Explain the concept behind this.',
  example: () => 'Show me a worked example.',
  review: () => 'Check my reasoning.',
}

export function studentAsk(action, hintsUsed) {
  if (!ACTIONS.includes(action)) throw badRequest(`Unknown action "${action}"`)
  return ASKS[action](hintsUsed)
}

/** What the interface calls the language, in words a model understands. */
const LANGUAGES = { en: 'English', tr: 'Turkish' }

/** The one the tutor runs on when nobody has written one yet. */
const DEFAULT_SYSTEM_PROMPT = `You are a patient secondary-school tutor helping one student with one question.
Lead them to their own answer: ask what they have tried, name the specific step that
is wrong, and give the smallest push that unblocks them. Never state the final answer.`

/**
 * Rules the platform needs whatever a teacher typed into the system prompt.
 *
 * Deliberately mechanical — format, length, language, and the two things that
 * would break the study if a prompt happened not to mention them. The teaching
 * belongs to the prompt above it, which is the variable the whole study is
 * built to compare; anything opinionated added here would silently apply to
 * every condition of it.
 */
const HOUSE_RULES = `Rules for this reply, which override anything above that conflicts with them:
- Write in {{language}}. The student reads the interface in {{language}}.
- Plain prose, at most 120 words, no markdown, no headings, no bullet points.
- One reply, in the second person, addressed to this student.
- Do not reveal the mark scheme or the teacher's answer, and do not list what either is
  looking for. They are here so you know what "correct" means, not so you can read them out.
- Do not give the complete final answer, even if asked directly.`

/**
 * `store` is optional and only read on the model path: it is what fetches the
 * question's uploaded image, and a caller without one (the check:openai
 * script) simply gets a reply that never saw the picture.
 *
 * @returns {{ text: string, label?: string, hintsUsed: number, source: string }}
 */
export async function reply({
  question,
  answer,
  action,
  text,
  promptVersion,
  systemPrompt = null,
  thread = [],
  lang = 'en',
  store = null,
}) {
  const scripted = scriptedReply({ question, answer, action, text, promptVersion, lang })

  if (!config.openai.configured) return scripted
  if (!modelAnswers({ question, answer, action })) return scripted

  try {
    const image = await imageForModel(store, question)

    const result = await generate({
      system: systemInstruction({ question, answer, action, lang, systemPrompt, image }),
      turns: turnsFor({ thread, text, image }),
    })

    return {
      ...scripted,
      text: result.text,
      // The hint count still comes from the scripted path: which step of the
      // escalation this is is the server's bookkeeping, not the model's.
      //
      // The label does not always survive, though. "Hint 2 of 3", "The concept"
      // and "Worked example" all still describe what the model was asked for —
      // but "Watch for this" belongs to the teacher's misconception line, and a
      // reply that reads this student's own working is not that.
      label: action === 'review' ? null : scripted.label,
      source: 'openai',
      model: result.model,
    }
  } catch (error) {
    // Logged, not raised: the student gets the scripted line, which is the whole
    // reason it still exists.
    //
    // `fallback` rather than `scripted`, though, and the difference is the point.
    // A scripted reply is a teacher's own words working as designed; a fallback
    // is the model having failed on a turn it was supposed to answer, and the two
    // being one value would make a rate-limited lesson indistinguishable from a
    // well-authored one in the dataset. Nothing in the interface shows this
    // happening, so the record and the log are the only places it is visible.
    console.warn(`[tutor] openai failed, using the script: ${error.message}`)
    return { ...scripted, source: 'fallback', reason: error.message }
  }
}

/**
 * Whether this turn is the model's to answer.
 *
 * Everything here is a judgement about *authorship*, not about capability: the
 * model could paraphrase a teacher's hint, and must not.
 */
function modelAnswers({ question, answer, action }) {
  const authored = question.tutor?.authored ?? {}
  const hintsUsed = answer?.hintsUsed ?? 0
  const state = answerShape(answer)

  // Free text. The alternative is five canned lines chosen by word count,
  // which answer nothing the student actually asked.
  if (!action) return true

  if (action === 'hint') {
    // Past the last hint the scripted line is not a hint at all, it is an
    // instruction about what to do next. Leave it alone.
    if (hintsUsed >= question.tutor.hints.length) return false
    return !authored.hints
  }

  if (action === 'concept') return !authored.concept
  if (action === 'example') return !authored.example

  // Review, which is always about what this student wrote — so the authored
  // misconception is context for the model here rather than the reply itself.
  // Only when there is something written to read: a drawing or a photo is not
  // sent to the model, and the scripted line that says so stays true.
  return state.mode === 'write' && wordCount(state.draft) > 0
}

/** The image formats OpenAI's vision input accepts. HEIC and PDF are refused. */
const MODEL_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

/**
 * The uploaded question, in a form the model can fetch.
 *
 * Spaces hands out a short-lived signed URL and the model fetches the bytes
 * itself; local disk has no URL to sign, so the bytes are read and inlined as
 * a data URL instead. `null` when there is no image, no store to read it with,
 * the format is one the API refuses, or the fetch failed — and a failure is a
 * warning, not an error, because a reply that has not seen the picture is
 * still better than no reply.
 */
async function imageForModel(store, question) {
  const image = question.image
  if (!store || !image?.id || !MODEL_IMAGE_TYPES.has(image.type)) return null

  try {
    const upload = await store.uploads.findById(image.id)
    if (!upload) return null

    const files = storage()
    const signed = await files.signedUrl(upload.key)
    if (signed) return { url: signed }

    const bytes = await fs.readFile(upload.path)
    return { url: `data:${upload.type};base64,${bytes.toString('base64')}` }
  } catch (error) {
    console.warn(`[tutor] could not fetch the question image: ${error.message}`)
    return null
  }
}

/**
 * The question as the system instruction states it. Three shapes:
 *
 * - a typed prompt, quoted verbatim (with a note when a picture rides along);
 * - a picture the model can see, pointed at rather than quoted;
 * - a file the model cannot view (HEIC, PDF, or a failed fetch), said
 *   honestly — the model must ask the student to read it out, not guess. The
 *   old version of this block printed an empty string here, and the tutor
 *   spent whole conversations deflecting about a question it had never seen.
 */
function questionBlock(question, image) {
  const marks = totalPoints(question)
  const heading = `The question (${question.code}${marks ? `, ${marks} marks` : ''})`
  const prompt = question.prompt?.trim()

  if (prompt) {
    const alsoImage = image
      ? '\n\nThe question also includes the picture attached to the first message of the conversation.'
      : question.image
        ? `\n\nThe question also includes an uploaded file (${question.image.name}) you cannot view; the student can see it.`
        : ''
    return `${heading}:\n${prompt}${alsoImage}`
  }

  if (image) {
    return `${heading} was uploaded as a picture: it is attached to the first message of the conversation. Read the question from that picture — the student is looking at the same one.`
  }

  return `${heading} was uploaded as a file (${question.image?.name ?? 'unnamed'}) in a format you cannot view. The student can see it. Do not guess what it says — ask the student to read out the part they are working on.`
}

/**
 * Everything the model is told before the conversation itself: the active
 * system prompt, the house rules, the question, the teacher's answer when one
 * was written, and the student's answer as it stands.
 *
 * Assembled per turn rather than cached, because all of it moves — the prompt
 * has versions, and the student's answer changes between one message and the
 * next.
 */
function systemInstruction({ question, answer, action, lang, systemPrompt, image = null }) {
  const language = LANGUAGES[lang] ?? LANGUAGES.en
  const state = answerShape(answer)
  const hintsUsed = answer?.hintsUsed ?? 0

  const blocks = [
    (systemPrompt?.trim() || DEFAULT_SYSTEM_PROMPT),
    HOUSE_RULES.replaceAll('{{language}}', language),
    questionBlock(question, image),
  ]

  if (question.stimulus?.trim()) blocks.push(`Material the question refers to:\n${question.stimulus}`)

  /**
   * The mark scheme, minus the answer key.
   *
   * `label` and `coach` are already student-facing — the marking card shows
   * both — so the model may work from them. `keywords` never leaves the server
   * for anybody, and a tutor writing to the student is the last place to make
   * an exception: it would be one paraphrase away from the browser.
   */
  if (question.rubric?.length) {
    const criteria = question.rubric
      .map((c) => `- ${c.label} (${c.points} mark${c.points === 1 ? '' : 's'})${c.coach ? ` — the teacher's note: ${c.coach}` : ''}`)
      .join('\n')
    blocks.push(`What a full answer has to cover:\n${criteria}`)
  }

  /**
   * The teacher's own answer, when one was written. It is the destination the
   * guidance is steering toward — without it the model judges "close" against
   * its own idea of the answer, which on an ambiguous question may not be the
   * teacher's. The house rules above already forbid reading it out, and the
   * line here says again what it is *for*, because a block of correct answer
   * sitting in the context is exactly what a model reaches for when a student
   * pushes.
   */
  if (hasAnswer(question)) {
    blocks.push(`The teacher's answer to this question, so you know exactly where the student should end up:
${question.answer.trim()}
Use it to judge how close this student is and to choose the next step to point at. Never recite it, and never confirm it wholesale.`)
  }

  blocks.push(
    state.mode === 'write'
      ? state.draft.trim()
        ? `The student's answer so far, verbatim:\n${state.draft.trim()}`
        : 'The student has not written anything in the answer box yet.'
      : `The student is working ${state.mode === 'draw' ? 'on the whiteboard' : 'on paper and photographing it'} (${contentCount(state)} ${state.mode === 'draw' ? 'strokes' : 'images'}), which you cannot see. Do not pretend to have read it — ask them to talk you through it.`,
  )

  if (question.tutor?.authored?.misconception) {
    blocks.push(`Where students usually go wrong here, from the teacher: ${question.tutor.misconception}`)
  }

  blocks.push(taskFor({ action, question, hintsUsed }))

  return blocks.join('\n\n')
}

/** What this particular turn is for. The quick actions are not the same request. */
function taskFor({ action, question, hintsUsed }) {
  if (!action) return 'Reply to the student\'s message below.'

  if (action === 'hint') {
    const total = question.tutor.hints.length
    const step = hintsUsed + 1
    return `The student asked for a hint. This is hint ${step} of ${total}: reveal one step's worth, no more.
${step === 1 ? 'Start with the least revealing nudge you can give — where to look, not what to do.' : `They have already had ${hintsUsed} hint${hintsUsed === 1 ? '' : 's'}, so go one step further than the last one without finishing the problem for them.`}
${step === total ? 'This is the last hint they get, so make it the one that unblocks them.' : ''}`.trim()
  }

  if (action === 'concept') {
    return 'The student asked for the idea behind this question. Explain the concept it tests, without working through this particular question.'
  }

  if (action === 'example') {
    return 'The student asked for a worked example. Work through a similar question — not this one — line by line, then tell them to try theirs.'
  }

  return `The student asked you to check their reasoning. Read what they wrote, say what is right about it, then name the first thing that goes wrong and why. ${question.tutor?.authored?.misconception ? "Use the teacher's note above if this student has made that mistake, and ignore it if they have not." : ''}`.trim()
}

/**
 * The thread, as the API wants it: oldest first, `user` and `model` alternating
 * as well as the real conversation allows, ending on what the student just said.
 *
 * Capped at the last ten turns. A tutor chat about one question does not need
 * more, and an unbounded thread is an unbounded bill.
 *
 * When the question is a picture, it opens the conversation as a synthetic
 * student turn — a system message cannot carry an image, and first is where
 * the question belongs. Re-sent every call because the API is stateless; the
 * system instruction's question block points at it.
 */
function turnsFor({ thread, text, image = null }) {
  const history = thread
    .filter((message) => message.text?.trim())
    .slice(-10)
    .map((message) => ({ role: message.from === 'tutor' ? 'model' : 'user', text: message.text }))

  return [
    ...(image
      ? [{ role: 'user', text: 'Here is the question I am working on.', images: [image.url] }]
      : []),
    ...history,
    { role: 'user', text },
  ]
}

/**
 * The two or three scripted lines that reference this particular question
 * (its code, whether it has a rubric) rather than being subject-neutral like
 * `ownTutor` — kept here rather than shared/tutor-scripts.js for that reason.
 */
const SCRIPT_STRINGS = {
  en: {
    lastHintWithRubric: (code) =>
      `That was the last hint for ${code}. Write what you have and press Check my answer — I will mark it against the rubric and name what is missing.`,
    lastHintNoRubric: (code) =>
      `That was the last hint for ${code}. Write out your reasoning and I will read it back with you.`,
    cannotReadDrawing:
      'I cannot read a drawing or a photo yet, so I cannot check that working directly. Talk me through your reasoning here and I will tell you where it goes wrong.',
    nothingToCheck:
      'There is nothing to check yet. Put something in your answer and I will read it back to you.',
  },
  tr: {
    lastHintWithRubric: (code) =>
      `${code} için son ipucu buydu. Elindekini yaz ve "Cevabımı kontrol et"e bas — puanlama ölçütüne göre değerlendirip neyin eksik olduğunu söyleyeceğim.`,
    lastHintNoRubric: (code) => `${code} için son ipucu buydu. Akıl yürütmeni yaz, birlikte okuyalım.`,
    cannotReadDrawing:
      'Henüz bir çizimi ya da fotoğrafı okuyamıyorum, o yüzden çözümünü doğrudan kontrol edemem. Akıl yürütmeni burada anlat, nerede yanlış gittiğini söyleyeyim.',
    nothingToCheck: 'Kontrol edecek bir şey yok henüz. Cevabına bir şeyler yaz, birlikte okuyalım.',
  },
}

const scriptFor = (lang) => SCRIPT_STRINGS[lang] ?? SCRIPT_STRINGS.en

/**
 * The tutor with no model behind it: teacher-authored text, staged, and generic
 * lines where there is none.
 *
 * This is also the fallback, so it must not depend on anything that can fail.
 * `lang` only changes the *generic* lines — a teacher's own hints, concept,
 * example and misconception note are delivered exactly as they wrote them,
 * whatever language that happens to be, same as the model path.
 */
export function scriptedReply({ question, answer, action, text, promptVersion, lang = 'en' }) {
  const hintsUsed = answer?.hintsUsed ?? 0
  const state = answerShape(answer)
  const base = { hintsUsed, source: 'scripted', promptVersion }
  const own = ownTutorFor(lang)
  const strings = scriptFor(lang)

  if (!action) {
    const words = wordCount(text ?? '')
    return {
      ...base,
      text: fallbackReplyFor(lang, words),
    }
  }

  if (action === 'hint') {
    if (hintsUsed >= question.tutor.hints.length) {
      // What to point them at next depends on whether anybody wrote a mark
      // scheme for this question — promising to mark an unmarkable answer is
      // worse than saying nothing.
      return {
        ...base,
        text: question.rubric?.length
          ? strings.lastHintWithRubric(question.code)
          : strings.lastHintNoRubric(question.code),
      }
    }
    return {
      ...base,
      label: `Hint ${hintsUsed + 1} of ${question.tutor.hints.length}`,
      text: question.tutor.authored.hints ? question.tutor.hints[hintsUsed] : own.hints[hintsUsed],
      hintsUsed: hintsUsed + 1,
    }
  }

  if (action === 'concept') {
    return {
      ...base,
      label: 'The concept',
      text: question.tutor.authored.concept ? question.tutor.concept : own.concept,
    }
  }

  if (action === 'example') {
    return {
      ...base,
      label: 'Worked example',
      text: question.tutor.authored.example ? question.tutor.example : own.example,
    }
  }

  // review
  if (state.mode === 'write' && wordCount(state.draft) >= 4) {
    return {
      ...base,
      label: 'Watch for this',
      text: question.tutor.authored.misconception ? question.tutor.misconception : own.misconception,
    }
  }

  if (hasContent(state)) {
    return {
      ...base,
      text: strings.cannotReadDrawing,
    }
  }

  return {
    ...base,
    text: strings.nothingToCheck,
  }
}

/** The shape shared/answer.js expects, whatever the stored answer looks like. */
export function answerShape(answer) {
  return {
    mode: answer?.mode ?? 'write',
    draft: answer?.draft ?? '',
    strokes: answer?.strokes ?? [],
    attachments: answer?.attachments ?? [],
  }
}

export { uploadedFiles }
