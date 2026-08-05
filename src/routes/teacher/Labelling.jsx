import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../../lib/api'
import { useT } from '../../lib/i18n'
import { useAsync } from '../../lib/useAsync'

/** Three answers, translated by id — see `labelling.*` in src/lib/strings.js. */
const VALUES = ['yes', 'partly', 'no']

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
  const t = useT()
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
          <p className="eyebrow">{t('labelling.eyebrow')}</p>
          <h1 className="cs-title">{t('labelling.title')}</h1>
          <p className="cs-lede">{t('labelling.lede')}</p>
        </div>

        <div className="cs-field">
          <label className="cs-label" htmlFor="show">
            {t('labelling.show')}
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
            <option value="undecided">{t('labelling.filterUndecided')}</option>
            <option value="true">{t('labelling.filterKept')}</option>
            <option value="false">{t('labelling.filterDropped')}</option>
            <option value="all">{t('labelling.filterAll')}</option>
          </select>
        </div>
      </header>

      {sessionId ? (
        <p className="cs-note">
          {t('labelling.oneSession')}{' '}
          <button
            type="button"
            className="cs-btn cs-btn-sm"
            onClick={() => {
              const next = new URLSearchParams(params)
              next.delete('session')
              setParams(next, { replace: true })
            }}
          >
            {t('labelling.showAll')}
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
        <p className="cs-note">{t('common.loading')}</p>
      ) : snippets.length === 0 ? (
        <p className="cs-empty">
          {filter === 'undecided'
            ? t('labelling.emptyUndecided')
            : t('labelling.emptyOther')}
        </p>
      ) : (
        <div style={{ display: 'grid', gap: 'var(--s-4)', marginTop: 'var(--s-4)' }}>
          {snippets.map((snippet) => (
            <article key={snippet.id} className="cs-snip">
              <div>
                <div className="cs-turn" data-from="student">
                  <p className="cs-turn-who eyebrow">{t('labelling.studentAsked')}</p>
                  <p className="cs-turn-text">{snippet.student.text}</p>
                </div>

                <div className="cs-turn" data-from="tutor">
                  <p className="cs-turn-who eyebrow">
                    {snippet.tutor.label ?? t('labelling.feedback')}
                    {snippet.rating
                      ? ` · ${t('labelling.studentRated', { rating: snippet.rating })}`
                      : ''}
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
                    {t('labelling.keep')}
                  </button>
                  <button
                    type="button"
                    className={`cs-btn cs-btn-sm ${snippet.included === false ? 'cs-btn-danger' : ''}`}
                    disabled={saving === snippet.id}
                    onClick={() => save(snippet, { included: false })}
                  >
                    {t('labelling.drop')}
                  </button>
                </div>
              </div>

              <div>
                <p className="eyebrow" style={{ marginBottom: 'var(--s-2)' }}>
                  {t('labelling.criteriaHead')}
                </p>

                <div className="cs-criteria">
                  {criteria.map((criterion) => (
                    <div key={criterion.id} className="cs-criterion">
                      <span className="cs-criterion-label">{criterion.label}</span>
                      <div className="cs-choices">
                        {VALUES.map((value) => (
                          <button
                            key={value}
                            type="button"
                            className="cs-choice"
                            aria-pressed={snippet.labels?.[criterion.id] === value}
                            disabled={saving === snippet.id}
                            onClick={() =>
                              save(snippet, {
                                labels: { ...snippet.labels, [criterion.id]: value },
                              })
                            }
                          >
                            {t(`labelling.${value}`)}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}

                  <div className="cs-field">
                    <label className="cs-label" htmlFor={`note-${snippet.id}`}>
                      {t('labelling.why')}
                    </label>
                    <textarea
                      id={`note-${snippet.id}`}
                      className="cs-textarea"
                      rows={3}
                      defaultValue={snippet.note ?? ''}
                      placeholder={t('labelling.whyPlaceholder')}
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
