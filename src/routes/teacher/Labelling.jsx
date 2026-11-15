import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import MathText from '../../components/MathText'
import { promptFor } from '../../../shared/activity'
import { api } from '../../lib/api'
import { useI18n } from '../../lib/i18n'
import { useAsync } from '../../lib/useAsync'

/** Three answers, translated by id — see `labelling.*` in src/lib/strings.js. */
const VALUES = ['yes', 'partly', 'no']

/** How long "Saved" stays up before only the standing state is left. */
const SAVED_FOR_MS = 2500

/** Date and time in the reader's language, or nothing for a missing stamp. */
function When({ iso, lang }) {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null

  return (
    <time className="cs-when" dateTime={date.toISOString()}>
      {date.toLocaleString(lang, { dateStyle: 'medium', timeStyle: 'short' })}
    </time>
  )
}

/**
 * The outcome of the last save of one field. Always rendered, empty when
 * there is nothing to say, because a live region has to exist before its
 * content changes for a screen reader to announce the change.
 */
function SaveState({ entry, t }) {
  return (
    <span className="cs-save" data-state={entry?.state ?? 'idle'} aria-live="polite">
      {entry?.state === 'saving'
        ? t('labelling.saving')
        : entry?.state === 'saved'
          ? t('labelling.saved')
          : entry?.state === 'failed'
            ? t('labelling.saveFailed', { message: entry.message })
            : ''}
    </span>
  )
}

/** An uploaded picture as a thumbnail that opens full size; anything else as a link. */
function FileLink({ file, label }) {
  return (
    <a className="cs-context-file" href={file.url} target="_blank" rel="noreferrer">
      {file.type?.startsWith('image/') ? <img src={file.url} alt={label} /> : (file.name ?? label)}
    </a>
  )
}

/**
 * What the student was working on, above the exchange: the question, and what
 * they handed in for it. A reply that reads as vague can be pointed for this
 * particular answer, and the labeller cannot tell without seeing both.
 */
function Context({ snippet, lang, t }) {
  const { question, answer } = snippet
  if (!question) return null

  const prompt = promptFor(question, lang)
  const board = answer?.attachments.find((file) => file.source === 'whiteboard')
  const photos = answer?.attachments.filter((file) => file.source !== 'whiteboard') ?? []

  return (
    <section className="cs-context">
      <div className="cs-tile-top">
        <p className="eyebrow" style={{ margin: 0 }}>
          {t('labelling.question')} <span className="cs-q-code">{question.code}</span>
        </p>
        {question.isOwnQuestion ? (
          <span className="cs-pill" data-tone="draft">
            {t('labelling.ownQuestion')}
          </span>
        ) : null}
      </div>

      <div className="cs-context-body">
        {prompt ? (
          <p className="cs-context-text">
            <MathText text={prompt} />
          </p>
        ) : null}
        {question.image ? <FileLink file={question.image} label={t('labelling.questionFile')} /> : null}
        {!prompt && !question.image ? <p className="cs-hint">{t('labelling.noPrompt')}</p> : null}
      </div>

      <p className="eyebrow cs-context-head">
        {t('labelling.theirAnswer')}
        <When iso={answer?.updatedAt} lang={lang} />
      </p>
      {answer ? (
        <div className="cs-context-body">
          {answer.draft?.trim() ? <p className="cs-context-text cs-turn-text">{answer.draft}</p> : null}
          {board ? (
            <FileLink file={board} label={t('labelling.answerBoard')} />
          ) : answer.strokeCount ? (
            <p className="cs-hint">
              {t('labelling.answerBoard')} · {t('common.strokes', { count: answer.strokeCount })}
            </p>
          ) : null}
          {photos.length ? (
            <div className="cs-context-files">
              {photos.map((file) => (
                <FileLink key={file.id} file={file} label={t('labelling.answerPhoto')} />
              ))}
            </div>
          ) : null}
        </div>
      ) : (
        <p className="cs-hint">{t('labelling.noAnswer')}</p>
      )}
    </section>
  )
}

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
 *    meet: yes, partly, or no, each with its own free-text reason.
 *
 * Everything saves the moment it is pressed rather than behind a Save button.
 * Labelling is a long sitting of small judgements, and a lost batch because a
 * tab was closed is the failure mode that matters.
 */
export default function Labelling() {
  const { lang, t } = useI18n()
  const [params, setParams] = useSearchParams()
  const sessionId = params.get('session') ?? ''
  const filter = params.get('show') ?? 'undecided'

  const { data, error, loading, setData } = useAsync(
    () => api.snippets({ sessionId, included: filter === 'all' ? undefined : filter }),
    [sessionId, filter],
  )

  /** `${snippetId}|${field}` -> { state: saving | saved | failed, message, token } */
  const [status, setStatus] = useState({})

  /**
   * The list as last confirmed, readable from inside a queued save. A save
   * that builds its body from the render it was clicked in would send the
   * labels as they stood before an earlier, still-running save landed.
   */
  const latest = useRef(null)
  useEffect(() => {
    latest.current = data
  })

  /** One chain of saves per snippet, so its writes reach the server in order. */
  const queues = useRef(new Map())

  const snippets = data?.snippets ?? []
  const criteria = data?.criteria ?? []

  /**
   * Patches the row in place rather than refetching.
   *
   * A refetch under the "undecided" filter would make the row vanish the
   * instant it was decided, taking the criteria half of the job with it — so
   * the list is only re-read when the filter itself changes.
   *
   * `makePatch` is given the row as it stands when the save actually runs,
   * after any earlier save of the same snippet has finished. Nothing is
   * disabled while a save is in flight: a box being typed in must not lose its
   * focus, and a press made while another save runs is queued, not dropped.
   */
  const save = (snippetId, field, makePatch) => {
    const key = `${snippetId}|${field}`
    const token = {}
    const mine = (prev) => prev[key]?.token === token
    setStatus((prev) => ({ ...prev, [key]: { state: 'saving', token } }))

    const run = async () => {
      // Missing only if the filter changed and the list was re-read meanwhile;
      // the save still goes ahead, and `makePatch` falls back to what it saw.
      const entry = latest.current?.snippets.find((row) => row.id === snippetId) ?? null

      try {
        const { label } = await api.labelSnippet(snippetId, makePatch(entry))
        const merge = (row) => ({
          ...row,
          included: label.included ?? row.included,
          labels: label.labels ?? row.labels,
          note: label.note ?? row.note,
          notes: label.notes ?? row.notes,
        })
        const apply = (prev) =>
          prev && {
            ...prev,
            snippets: prev.snippets.map((row) => (row.id === snippetId ? merge(row) : row)),
          }
        // Written here as well as through setData: the next queued save can
        // start before React has rendered this one.
        latest.current = apply(latest.current)
        setData(apply)

        setStatus((prev) => (mine(prev) ? { ...prev, [key]: { state: 'saved', token } } : prev))
        setTimeout(() => {
          setStatus((prev) => {
            if (!mine(prev) || prev[key].state !== 'saved') return prev
            const next = { ...prev }
            delete next[key]
            return next
          })
        }, SAVED_FOR_MS)
      } catch (failure) {
        setStatus((prev) =>
          mine(prev) ? { ...prev, [key]: { state: 'failed', message: failure.message, token } } : prev,
        )
      }
    }

    const tail = (queues.current.get(snippetId) ?? Promise.resolve()).then(run)
    queues.current.set(snippetId, tail)
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
        <div style={{ display: 'grid', gap: 'var(--s-5)', marginTop: 'var(--s-4)' }}>
          {snippets.map((snippet) => {
            const decision =
              snippet.included === true ? 'kept' : snippet.included === false ? 'dropped' : 'none'
            const decisionStatus = status[`${snippet.id}|included`]

            return (
              <article key={snippet.id} className="cs-snip">
                <div>
                  <Context snippet={snippet} lang={lang} t={t} />

                  <div className="cs-turn" data-from="student">
                    <p className="cs-turn-who eyebrow">
                      {t('labelling.studentAsked')}
                      <When iso={snippet.student.at} lang={lang} />
                    </p>
                    <p className="cs-turn-text">{snippet.student.text}</p>
                  </div>

                  <div className="cs-turn" data-from="tutor">
                    <p className="cs-turn-who eyebrow">
                      {snippet.tutor.label ?? t('labelling.feedback')}
                      {snippet.rating
                        ? ` · ${t('labelling.studentRated', { rating: snippet.rating })}`
                        : ''}
                      <When iso={snippet.tutor.at} lang={lang} />
                    </p>
                    <p className="cs-turn-text">{snippet.tutor.text}</p>
                  </div>

                  <div className="cs-decision">
                    <div className="cs-actions">
                      <button
                        type="button"
                        className={`cs-btn cs-btn-sm cs-decide ${snippet.included === true ? 'cs-btn-primary' : ''}`}
                        data-kind="keep"
                        aria-pressed={snippet.included === true}
                        onClick={() => save(snippet.id, 'included', () => ({ included: true }))}
                      >
                        {snippet.included === true ? '✓ ' : ''}
                        {t('labelling.keep')}
                      </button>
                      <button
                        type="button"
                        className={`cs-btn cs-btn-sm cs-decide ${snippet.included === false ? 'cs-btn-danger' : ''}`}
                        data-kind="drop"
                        aria-pressed={snippet.included === false}
                        onClick={() => save(snippet.id, 'included', () => ({ included: false }))}
                      >
                        {snippet.included === false ? '✓ ' : ''}
                        {t('labelling.drop')}
                      </button>
                    </div>

                    {/* The standing decision and the save that changed it, read
                        out together so a press is never met with silence. */}
                    <p className="cs-decision-state" data-decision={decision} aria-live="polite">
                      <span>
                        {decision === 'kept'
                          ? t('labelling.decisionKept')
                          : decision === 'dropped'
                            ? t('labelling.decisionDropped')
                            : t('labelling.decisionNone')}
                      </span>
                      {decisionStatus ? (
                        <span className="cs-save" data-state={decisionStatus.state}>
                          {decisionStatus.state === 'saving'
                            ? t('labelling.saving')
                            : decisionStatus.state === 'saved'
                              ? t('labelling.saved')
                              : t('labelling.saveFailed', { message: decisionStatus.message })}
                        </span>
                      ) : null}
                    </p>
                  </div>
                </div>

                <div>
                  <p className="eyebrow" style={{ marginBottom: 'var(--s-2)' }}>
                    {t('labelling.criteriaHead')}
                  </p>

                  <div className="cs-criteria">
                    {criteria.map((criterion) => {
                      const noteId = `note-${snippet.id}-${criterion.id}`
                      const saved = snippet.notes?.[criterion.id] ?? ''

                      return (
                        <div key={criterion.id} className="cs-criterion">
                          <div className="cs-criterion-head">
                            <span className="cs-criterion-label">{criterion.label}</span>
                            <SaveState entry={status[`${snippet.id}|label:${criterion.id}`]} t={t} />
                          </div>
                          <div className="cs-choices">
                            {VALUES.map((value) => (
                              <button
                                key={value}
                                type="button"
                                className="cs-choice"
                                aria-pressed={snippet.labels?.[criterion.id] === value}
                                onClick={() =>
                                  save(snippet.id, `label:${criterion.id}`, (entry) => ({
                                    labels: { ...(entry ?? snippet).labels, [criterion.id]: value },
                                  }))
                                }
                              >
                                {t(`labelling.${value}`)}
                              </button>
                            ))}
                          </div>

                          <div className="cs-field">
                            <div className="cs-criterion-head">
                              <label className="cs-label" htmlFor={noteId}>
                                {t('labelling.why')}
                              </label>
                              <SaveState entry={status[`${snippet.id}|note:${criterion.id}`]} t={t} />
                            </div>
                            <textarea
                              id={noteId}
                              className="cs-textarea"
                              rows={2}
                              defaultValue={saved}
                              placeholder={t('labelling.whyCriterionPlaceholder')}
                              // Saved on blur rather than per keystroke: one row is a
                              // paragraph at most, and a request per character would
                              // make the whole list feel broken. Only this criterion
                              // is sent; the server folds it into the others.
                              onBlur={(event) => {
                                const text = event.target.value
                                if (text !== saved) {
                                  save(snippet.id, `note:${criterion.id}`, () => ({
                                    notes: { [criterion.id]: text },
                                  }))
                                }
                              }}
                            />
                          </div>
                        </div>
                      )
                    })}

                    {/* The single reason the screen asked for before each
                        criterion had one. Shown, not offered: new labelling
                        goes per criterion, and this stays as it was written. */}
                    {snippet.note?.trim() ? (
                      <div className="cs-earlier-note">
                        <p className="eyebrow" style={{ margin: 0 }}>
                          {t('labelling.earlierNote')}
                        </p>
                        <p className="cs-turn-text">{snippet.note}</p>
                        <p className="cs-hint">{t('labelling.earlierNoteHint')}</p>
                      </div>
                    ) : null}
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </>
  )
}
