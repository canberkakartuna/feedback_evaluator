import { useState } from 'react'
import { LIMITS, QUESTION_KINDS } from '../../../shared/activity'

/**
 * Writing or editing one question.
 *
 * The shape of this form is the argument the whole feature rests on: **the
 * prompt is the only required field.** A teacher who types a question and
 * presses save gets a working question — the tutor answers from the system
 * prompt and the answer is passed on unmarked. The mark scheme and the hints
 * are two collapsed sections underneath, and filling them in adds automatic
 * marking and staged hints on top.
 *
 * Both extras are folded away by default rather than shown empty, so the
 * common case is a prompt box and a Save button, and the elaborate case is
 * still one click away.
 */

const blankCriterion = () => ({ label: '', points: 1, keywords: '', coach: '' })

/** Keywords are stored as an array and edited as one comma-separated line. */
const splitKeywords = (line) =>
  line
    .split(',')
    .map((keyword) => keyword.trim())
    .filter(Boolean)

function toFormState(question) {
  return {
    prompt: question?.prompt ?? '',
    kind: question?.kind ?? 'Explain',
    workingExpected: question?.workingExpected ?? false,
    criteria: (question?.rubric ?? []).map((criterion) => ({
      id: criterion.id,
      label: criterion.label,
      points: criterion.points,
      keywords: (criterion.keywords ?? []).join(', '),
      coach: criterion.coach ?? '',
    })),
    hints: question?.tutor?.hints ?? [],
    opening: question?.tutor?.opening ?? '',
    concept: question?.tutor?.concept ?? '',
    example: question?.tutor?.example ?? '',
    misconception: question?.tutor?.misconception ?? '',
  }
}

export default function QuestionForm({ question, onSave, onCancel, busy }) {
  const [form, setForm] = useState(() => toFormState(question))
  const [showRubric, setShowRubric] = useState(() => (question?.rubric?.length ?? 0) > 0)
  const [showTutor, setShowTutor] = useState(() => (question?.tutor?.hints?.length ?? 0) > 0)
  const [error, setError] = useState(null)

  const set = (fields) => setForm((prev) => ({ ...prev, ...fields }))

  const setCriterion = (index, fields) =>
    set({
      criteria: form.criteria.map((criterion, i) =>
        i === index ? { ...criterion, ...fields } : criterion,
      ),
    })

  const submit = async (event) => {
    event.preventDefault()
    if (!form.prompt.trim()) return

    const unlabelled = form.criteria.findIndex((criterion) => !criterion.label.trim())
    if (showRubric && unlabelled !== -1) {
      setError(`Criterion ${unlabelled + 1} needs a label, or remove it.`)
      return
    }

    setError(null)

    try {
      await onSave({
        prompt: form.prompt,
        kind: form.kind,
        workingExpected: form.workingExpected,
        // Folded away means "no mark scheme", which is a real state the server
        // understands — not the same as leaving the field out of the patch.
        rubric: showRubric
          ? form.criteria.map((criterion) => ({
              id: criterion.id,
              label: criterion.label,
              points: Number(criterion.points) || 0,
              keywords: splitKeywords(criterion.keywords),
              coach: criterion.coach,
            }))
          : [],
        tutor: showTutor
          ? {
              opening: form.opening,
              hints: form.hints.filter((hint) => hint.trim()),
              concept: form.concept,
              example: form.example,
              misconception: form.misconception,
            }
          : null,
      })
    } catch (failure) {
      setError(failure.message)
    }
  }

  const totalPoints = form.criteria.reduce(
    (sum, criterion) => sum + (Number(criterion.points) || 0),
    0,
  )

  return (
    <form className="cs-form" onSubmit={submit}>
      <div className="cs-field">
        <label className="cs-label" htmlFor="q-prompt">
          Question
        </label>
        <textarea
          id="q-prompt"
          className="cs-textarea"
          rows={4}
          required
          maxLength={LIMITS.prompt}
          placeholder="A red blood cell is placed in distilled water. Explain why it bursts."
          value={form.prompt}
          onChange={(event) => set({ prompt: event.target.value })}
        />
      </div>

      <div className="cs-row">
        <div className="cs-field">
          <label className="cs-label" htmlFor="q-kind">
            Kind
          </label>
          <select
            id="q-kind"
            className="cs-select"
            value={form.kind}
            onChange={(event) => set({ kind: event.target.value })}
          >
            {QUESTION_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {kind}
              </option>
            ))}
          </select>
        </div>

        <div className="cs-field">
          <span className="cs-label">Working</span>
          <label className="cs-check">
            <input
              type="checkbox"
              checked={form.workingExpected}
              onChange={(event) => set({ workingExpected: event.target.checked })}
            />
            <span>
              Normally worked out on paper — prompt for a photo of the working rather than typing.
            </span>
          </label>
        </div>
      </div>

      {/* ── mark scheme ───────────────────────────────────────── */}

      <div className="cs-crit">
        <div className="cs-crit-head">
          <label className="cs-check">
            <input
              type="checkbox"
              checked={showRubric}
              onChange={(event) => {
                setShowRubric(event.target.checked)
                if (event.target.checked && !form.criteria.length) {
                  set({ criteria: [blankCriterion()] })
                }
              }}
            />
            <span>
              <strong>Mark this question automatically</strong>
              <br />
              <span className="cs-hint">
                Leave off and the tutor still helps — the answer just goes to you unmarked.
              </span>
            </span>
          </label>
          {showRubric ? <span className="mono cs-hint">{totalPoints} pts</span> : null}
        </div>

        {showRubric ? (
          <>
            {form.criteria.map((criterion, index) => (
              <div key={index} className="cs-crit">
                <div className="cs-crit-head">
                  <span className="eyebrow">Criterion {index + 1}</span>
                  <button
                    type="button"
                    className="cs-btn cs-btn-sm cs-btn-danger"
                    onClick={() =>
                      set({ criteria: form.criteria.filter((_, i) => i !== index) })
                    }
                  >
                    Remove
                  </button>
                </div>

                <div className="cs-row">
                  <div className="cs-field" style={{ gridColumn: '1 / -1' }}>
                    <label className="cs-label">What earns the mark</label>
                    <input
                      className="cs-input"
                      maxLength={LIMITS.criterionLabel}
                      placeholder="Names the water potential gradient"
                      value={criterion.label}
                      onChange={(event) => setCriterion(index, { label: event.target.value })}
                    />
                  </div>
                </div>

                <div className="cs-row">
                  <div className="cs-field">
                    <label className="cs-label">Points</label>
                    <input
                      className="cs-input"
                      type="number"
                      min={0}
                      max={100}
                      value={criterion.points}
                      onChange={(event) => setCriterion(index, { points: event.target.value })}
                    />
                  </div>

                  <div className="cs-field" style={{ gridColumn: 'span 2' }}>
                    <label className="cs-label">Keywords, comma separated</label>
                    <input
                      className="cs-input"
                      placeholder="water potential, hypotonic, more dilute"
                      value={criterion.keywords}
                      onChange={(event) => setCriterion(index, { keywords: event.target.value })}
                    />
                    <p className="cs-hint">
                      The mark lands if the answer contains any one of these. Never shown to the
                      student.
                    </p>
                  </div>
                </div>

                <div className="cs-field">
                  <label className="cs-label">If they miss it, say</label>
                  <input
                    className="cs-input"
                    maxLength={LIMITS.criterionCoach}
                    placeholder="Say which way water moves and what drives it."
                    value={criterion.coach}
                    onChange={(event) => setCriterion(index, { coach: event.target.value })}
                  />
                </div>
              </div>
            ))}

            <div>
              <button
                type="button"
                className="cs-btn cs-btn-sm"
                disabled={form.criteria.length >= LIMITS.criteria}
                onClick={() => set({ criteria: [...form.criteria, blankCriterion()] })}
              >
                + Add criterion
              </button>
            </div>
          </>
        ) : null}
      </div>

      {/* ── tutor script ──────────────────────────────────────── */}

      <div className="cs-crit">
        <div className="cs-crit-head">
          <label className="cs-check">
            <input
              type="checkbox"
              checked={showTutor}
              onChange={(event) => {
                setShowTutor(event.target.checked)
                if (event.target.checked && !form.hints.length) set({ hints: [''] })
              }}
            />
            <span>
              <strong>Write the hints myself</strong>
              <br />
              <span className="cs-hint">
                Released one at a time, in order. Leave off and the tutor uses generic prompts.
              </span>
            </span>
          </label>
        </div>

        {showTutor ? (
          <>
            <div className="cs-hints">
              {form.hints.map((hint, index) => (
                <div key={index} className="cs-hint-row">
                  <span className="cs-hint-n">{index + 1}</span>
                  <textarea
                    className="cs-textarea"
                    rows={2}
                    maxLength={LIMITS.hint}
                    placeholder="Start outside the cell. Distilled water has no solute in it at all."
                    value={hint}
                    onChange={(event) =>
                      set({
                        hints: form.hints.map((entry, i) =>
                          i === index ? event.target.value : entry,
                        ),
                      })
                    }
                  />
                  <button
                    type="button"
                    className="cs-btn cs-btn-sm cs-btn-danger"
                    onClick={() => set({ hints: form.hints.filter((_, i) => i !== index) })}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>

            <div>
              <button
                type="button"
                className="cs-btn cs-btn-sm"
                disabled={form.hints.length >= LIMITS.hints}
                onClick={() => set({ hints: [...form.hints, ''] })}
              >
                + Add hint
              </button>
            </div>

            <div className="cs-field">
              <label className="cs-label">Opening line</label>
              <textarea
                className="cs-textarea"
                rows={2}
                value={form.opening}
                placeholder="This one is really two questions wearing one coat. Which half feels shakier?"
                onChange={(event) => set({ opening: event.target.value })}
              />
            </div>

            <div className="cs-field">
              <label className="cs-label">The concept behind it</label>
              <textarea
                className="cs-textarea"
                rows={2}
                value={form.concept}
                onChange={(event) => set({ concept: event.target.value })}
              />
            </div>

            <div className="cs-field">
              <label className="cs-label">A worked example</label>
              <textarea
                className="cs-textarea"
                rows={2}
                value={form.example}
                onChange={(event) => set({ example: event.target.value })}
              />
            </div>

            <div className="cs-field">
              <label className="cs-label">The usual mistake</label>
              <textarea
                className="cs-textarea"
                rows={2}
                value={form.misconception}
                onChange={(event) => set({ misconception: event.target.value })}
              />
            </div>
          </>
        ) : null}
      </div>

      {error ? (
        <p className="cs-note" data-tone="bad" role="alert">
          {error}
        </p>
      ) : null}

      <div className="cs-actions">
        <button
          type="submit"
          className="cs-btn cs-btn-primary"
          disabled={busy || !form.prompt.trim()}
        >
          {busy ? 'Saving…' : question ? 'Save changes' : 'Add question'}
        </button>
        <button type="button" className="cs-btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  )
}
