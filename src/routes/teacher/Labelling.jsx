import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../../lib/api'
import { useAsync } from '../../lib/useAsync'

const VALUES = [
  { id: 'yes', label: 'Yes' },
  { id: 'partly', label: 'Partly' },
  { id: 'no', label: 'No' },
]

/**
 * The labelling loop the study is actually for.
 *
 * A **snippet** is one thing the student said and the one reply that answered
 * it. Not every exchange is worth keeping, so there are two separate decisions
 * here and the screen keeps them apart:
 *
 * 1. **Keep or drop** — does this belong in the dataset at all? Only kept
 *    snippets are exported.
 * 2. **Label** — for a kept snippet, which of the criteria does the feedback
 *    meet: yes, partly, or no, plus a free-text reason.
 *
 * Everything saves the moment it is pressed rather than behind a Save button.
 * Labelling is a long sitting of small judgements, and a lost batch because a
 * tab was closed is the failure mode that matters.
 */
export default function Labelling() {
  const [params, setParams] = useSearchParams()
  const sessionId = params.get('session') ?? ''
  const filter = params.get('show') ?? 'undecided'

  const { data, error, loading, setData } = useAsync(
    () => api.snippets({ sessionId, included: filter === 'all' ? undefined : filter }),
    [sessionId, filter],
  )

  const [saving, setSaving] = useState(null)
  const [problem, setProblem] = useState(null)

  const snippets = data?.snippets ?? []
  const criteria = data?.criteria ?? []

  /**
   * Patches the row in place rather than refetching.
   *
   * A refetch under the "undecided" filter would make the row vanish the
   * instant it was decided, taking the criteria half of the job with it — so
   * the list is only re-read when the filter itself changes.
   */
  const save = async (snippet, patch) => {
    setSaving(snippet.id)
    setProblem(null)

    try {
      const { label } = await api.labelSnippet(snippet.id, patch)
      setData((prev) => ({
        ...prev,
        snippets: prev.snippets.map((entry) =>
          entry.id === snippet.id
            ? {
                ...entry,
                included: label.included ?? entry.included,
                labels: label.labels ?? entry.labels,
                note: label.note ?? entry.note,
              }
            : entry,
        ),
      }))
    } catch (failure) {
      setProblem(failure.message)
    } finally {
      setSaving(null)
    }
  }

  return (
    <>
      <header className="cs-head">
        <div>
          <p className="eyebrow">Building the dataset</p>
          <h1 className="cs-title">Labelling</h1>
          <p className="cs-lede">
            Each card is one thing a student said and the reply that answered it. Keep the ones
            worth studying, then say which criteria the feedback meets and why.
          </p>
        </div>

        <div className="cs-field">
          <label className="cs-label" htmlFor="show">
            Show
          </label>
          <select
            id="show"
            className="cs-select"
            value={filter}
            onChange={(event) => {
              const next = new URLSearchParams(params)
              next.set('show', event.target.value)
              setParams(next, { replace: true })
            }}
          >
            <option value="undecided">Not yet decided</option>
            <option value="true">Kept</option>
            <option value="false">Dropped</option>
            <option value="all">Everything</option>
          </select>
        </div>
      </header>

      {sessionId ? (
        <p className="cs-note">
          Filtered to one session.{' '}
          <button
            type="button"
            className="cs-btn cs-btn-sm"
            onClick={() => {
              const next = new URLSearchParams(params)
              next.delete('session')
              setParams(next, { replace: true })
            }}
          >
            Show every session
          </button>
        </p>
      ) : null}

      {problem ? (
        <p className="cs-note" data-tone="bad" role="alert">
          {problem}
        </p>
      ) : null}

      {error ? (
        <p className="cs-note" data-tone="bad">
          {error.message}
        </p>
      ) : loading ? (
        <p className="cs-note">Loading…</p>
      ) : snippets.length === 0 ? (
        <p className="cs-empty">
          {filter === 'undecided'
            ? 'Nothing left to decide. Switch the filter to review what you kept.'
            : 'No snippets match that filter.'}
        </p>
      ) : (
        <div style={{ display: 'grid', gap: 'var(--s-4)', marginTop: 'var(--s-4)' }}>
          {snippets.map((snippet) => (
            <article key={snippet.id} className="cs-snip">
              <div>
                <div className="cs-turn" data-from="student">
                  <p className="cs-turn-who eyebrow">Student asked</p>
                  <p className="cs-turn-text">{snippet.student.text}</p>
                </div>

                <div className="cs-turn" data-from="tutor">
                  <p className="cs-turn-who eyebrow">
                    {snippet.tutor.label ?? 'Feedback'}
                    {snippet.rating ? ` · student rated it ${snippet.rating}` : ''}
                  </p>
                  <p className="cs-turn-text">{snippet.tutor.text}</p>
                </div>

                <div className="cs-actions">
                  <button
                    type="button"
                    className={`cs-btn cs-btn-sm ${snippet.included === true ? 'cs-btn-primary' : ''}`}
                    disabled={saving === snippet.id}
                    onClick={() => save(snippet, { included: true })}
                  >
                    Keep for the dataset
                  </button>
                  <button
                    type="button"
                    className={`cs-btn cs-btn-sm ${snippet.included === false ? 'cs-btn-danger' : ''}`}
                    disabled={saving === snippet.id}
                    onClick={() => save(snippet, { included: false })}
                  >
                    Drop
                  </button>
                </div>
              </div>

              <div>
                <p className="eyebrow" style={{ marginBottom: 'var(--s-2)' }}>
                  Does this feedback…
                </p>

                <div className="cs-criteria">
                  {criteria.map((criterion) => (
                    <div key={criterion.id} className="cs-criterion">
                      <span className="cs-criterion-label">{criterion.label}</span>
                      <div className="cs-choices">
                        {VALUES.map((value) => (
                          <button
                            key={value.id}
                            type="button"
                            className="cs-choice"
                            aria-pressed={snippet.labels?.[criterion.id] === value.id}
                            disabled={saving === snippet.id}
                            onClick={() =>
                              save(snippet, {
                                labels: { ...snippet.labels, [criterion.id]: value.id },
                              })
                            }
                          >
                            {value.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}

                  <div className="cs-field">
                    <label className="cs-label" htmlFor={`note-${snippet.id}`}>
                      Why
                    </label>
                    <textarea
                      id={`note-${snippet.id}`}
                      className="cs-textarea"
                      rows={3}
                      defaultValue={snippet.note ?? ''}
                      placeholder="Good nudge, stops short of the answer."
                      // Saved on blur rather than per keystroke: one row is a
                      // paragraph at most, and a request per character would
                      // make the whole list feel broken.
                      onBlur={(event) => {
                        if (event.target.value !== (snippet.note ?? '')) {
                          save(snippet, { note: event.target.value })
                        }
                      }}
                    />
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  )
}
