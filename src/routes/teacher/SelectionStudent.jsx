import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import MathText from '../../components/MathText'
import DatasetToggle, { TargetPicker } from '../../components/DatasetToggle'
import { api } from '../../lib/api'
import { datasetName, pickTarget, recallTarget, rememberTarget, studentLabel } from '../../lib/datasets'
import { useI18n } from '../../lib/i18n'
import { useAsync } from '../../lib/useAsync'
import { promptFor } from '../../../shared/activity'

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
 * Dialog selection, step two: one student's dialogs, question by question.
 *
 * Each group is one question in one session: the question, what the student
 * handed in for it, then every exchange about it — what they said and the
 * tutor's reply, each with its time — and, per exchange, which datasets it is
 * in and a button to add it to (or take it out of) the dataset being picked
 * into. That dataset is chosen at the top and remembered in this browser, so
 * a sitting of picking goes on into the same one.
 *
 * Who wrote each reply (model, teacher script, fallback) is not shown, as on
 * the labelling screen: the server leaves it out.
 */
export default function SelectionStudent() {
  const { studentKey } = useParams()
  const [params, setParams] = useSearchParams()
  const { lang, t } = useI18n()
  const show = params.get('show') ?? 'all'

  const { data, error, loading, setData } = useAsync(() => api.studentDialogs(studentKey), [studentKey])
  const datasetsState = useAsync(() => api.datasets(), [])
  const datasets = datasetsState.data?.datasets ?? []

  const [chosen, setChosen] = useState(() => recallTarget())
  const target = pickTarget(datasets, chosen)
  const targetDataset = datasets.find((entry) => entry.id === target) ?? null
  const choose = (datasetId) => {
    setChosen(datasetId)
    rememberTarget(datasetId)
  }

  /** `{ state, text }` for the last "add all in this question". */
  const [bulk, setBulk] = useState({})

  /** Folds the server's answer for some dialogs into the page. */
  const applyMemberships = (memberships) =>
    setData(
      (prev) =>
        prev && {
          ...prev,
          questions: prev.questions.map((group) => ({
            ...group,
            dialogs: group.dialogs.map((dialog) =>
              memberships[dialog.id] ? { ...dialog, ...memberships[dialog.id] } : dialog,
            ),
          })),
        },
    )

  const addAll = async (group, dialogs) => {
    if (!targetDataset || !dialogs.length) return
    setBulk((prev) => ({ ...prev, [group.key]: { state: 'saving', text: t('labelling.saving') } }))
    try {
      const result = await api.addToDataset(targetDataset.id, dialogs.map((dialog) => dialog.id))
      applyMemberships(result.memberships)
      setBulk((prev) => ({
        ...prev,
        [group.key]: {
          state: 'saved',
          text: t('selection.addedAll', { count: result.count, name: datasetName(targetDataset, t) }),
        },
      }))
    } catch (failure) {
      setBulk((prev) => ({
        ...prev,
        [group.key]: { state: 'failed', text: t('labelling.saveFailed', { message: failure.message }) },
      }))
    }
  }

  const setShow = (value) => {
    const next = new URLSearchParams(params)
    if (value === 'all') next.delete('show')
    else next.set('show', value)
    setParams(next, { replace: true })
  }

  const back = (
    <Link to="/teacher/selection">{t('selection.back')}</Link>
  )

  if (loading) return <p className="cs-note">{t('common.loading')}</p>
  if (error) {
    return (
      <p className="cs-note" data-tone="bad">
        {error.message} — {back}
      </p>
    )
  }

  const { student, questions } = data
  const { label, code, tone } = studentLabel(student, t)
  const visible = (dialog) =>
    show === 'none'
      ? !(dialog.datasetIds ?? []).length
      : show === 'target'
        ? Boolean(target && (dialog.datasetIds ?? []).includes(target))
        : true
  const groups = questions
    .map((group) => ({ ...group, shown: group.dialogs.filter(visible) }))
    .filter((group) => group.shown.length)

  return (
    <>
      <header className="cs-head">
        <div>
          <p className="eyebrow">
            {back} · {t('selection.eyebrow')}
          </p>
          <h1 className="cs-title">
            {tone ? (
              <span className="cs-pill" data-tone={tone} style={{ verticalAlign: 'middle' }}>
                {student.kind === 'preview' ? t('roster.preview') : t('roster.anonymous')}
              </span>
            ) : null}{' '}
            {student.kind === 'preview' ? null : label} {code ? <span className="mono">{code}</span> : null}
          </h1>
          <p className="cs-lede">
            {t('selection.studentLede', {
              dialogs: student.dialogCount,
              questions: student.questionCount,
              // Counted from the page, so it follows what was just added.
              inDataset: questions.flatMap((group) => group.dialogs).filter((dialog) => (dialog.datasetIds ?? []).length)
                .length,
            })}
            {student.consentWithdrawn ? ` · ${t('transcript.consentWithdrawn')}` : ''}
          </p>
        </div>

        <div className="cs-actions" style={{ alignItems: 'flex-end' }}>
          {datasetsState.error ? (
            <p className="cs-note" data-tone="bad">
              {datasetsState.error.message}
            </p>
          ) : (
            <TargetPicker datasets={datasets} value={target} onChange={choose} t={t} />
          )}
          <div className="cs-field">
            <label className="cs-label" htmlFor="selection-show">
              {t('labelling.show')}
            </label>
            <select id="selection-show" className="cs-select" value={show} onChange={(event) => setShow(event.target.value)}>
              <option value="all">{t('labelling.filterAll')}</option>
              <option value="none">{t('selection.showNone')}</option>
              <option value="target">{t('selection.showTarget')}</option>
            </select>
          </div>
        </div>
      </header>

      {questions.length === 0 ? (
        <p className="cs-empty">{t('selection.noDialogs')}</p>
      ) : groups.length === 0 ? (
        <p className="cs-empty">{t('labelling.emptyOther')}</p>
      ) : (
        groups.map((group) => {
          const { question, answer } = group
          const prompt = question ? promptFor(question, lang) : null
          const notYet = group.shown.filter((dialog) => !(dialog.datasetIds ?? []).includes(target))
          const board = answer?.attachments?.find((file) => file.source === 'whiteboard')
          const photos = answer?.attachments?.filter((file) => file.source !== 'whiteboard') ?? []

          return (
            <section key={group.key} className="cs-card" style={{ marginBottom: 'var(--s-4)' }}>
              <div className="cs-tile-top">
                <span className="cs-q-code">{question?.code ?? '—'}</span>
                {question?.isOwnQuestion ? (
                  <span className="cs-pill" data-tone="draft">
                    {t('transcript.ownQuestion')}
                  </span>
                ) : null}
              </div>

              {prompt ? (
                <p style={{ marginTop: 0 }}>
                  <MathText text={prompt} />
                </p>
              ) : question?.image ? null : (
                <p className="cs-hint">{t('transcript.removedQuestion')}</p>
              )}
              {question?.image ? (
                <a className="cs-context-file" href={question.image.url} target="_blank" rel="noreferrer">
                  {question.image.type?.startsWith('image/') ? (
                    <img src={question.image.url} alt={t('labelling.questionFile')} />
                  ) : (
                    (question.image.name ?? t('labelling.questionFile'))
                  )}
                </a>
              ) : null}

              <div className="cs-turn" data-from="student">
                <p className="cs-turn-who eyebrow">
                  {t('transcript.theirAnswer')}
                  <When iso={answer?.updatedAt} lang={lang} />
                </p>
                {answer ? (
                  <>
                    {answer.draft?.trim() ? <p className="cs-turn-text">{answer.draft}</p> : null}
                    {board ? (
                      <a className="cs-context-file" href={board.url} target="_blank" rel="noreferrer">
                        <img src={board.url} alt={t('labelling.answerBoard')} />
                      </a>
                    ) : answer.strokeCount ? (
                      <p className="cs-hint">
                        {t('labelling.answerBoard')} · {t('common.strokes', { count: answer.strokeCount })}
                      </p>
                    ) : null}
                    {photos.length ? (
                      <div className="cs-context-files">
                        {photos.map((file) => (
                          <a key={file.id ?? file.url} className="cs-context-file" href={file.url} target="_blank" rel="noreferrer">
                            {file.type?.startsWith('image/') ? (
                              <img src={file.url} alt={t('labelling.answerPhoto')} />
                            ) : (
                              (file.name ?? t('labelling.answerPhoto'))
                            )}
                          </a>
                        ))}
                      </div>
                    ) : null}
                  </>
                ) : (
                  <p className="cs-hint">{t('labelling.noAnswer')}</p>
                )}
              </div>

              <div className="cs-thread">
                {group.shown.map((dialog) => (
                  <article key={dialog.id} className="cs-ds-dialog">
                    <div className="cs-msg" data-from="student">
                      <p className="eyebrow">
                        {t('transcript.student')}
                        <When iso={dialog.student.at} lang={lang} />
                      </p>
                      <p className="cs-msg-text">{dialog.student.text}</p>
                    </div>
                    <div className="cs-msg" data-from="tutor">
                      <p className="eyebrow">
                        {dialog.tutor.label ?? t('transcript.tutor')}
                        {dialog.rating ? ` · ${t('transcript.rated', { rating: dialog.rating })}` : ''}
                        <When iso={dialog.tutor.at} lang={lang} />
                      </p>
                      <p className="cs-msg-text">{dialog.tutor.text}</p>
                    </div>
                    <DatasetToggle
                      snippet={dialog}
                      target={target}
                      datasets={datasets}
                      onChange={(snippetId, membership) => applyMemberships({ [snippetId]: membership })}
                      t={t}
                    />
                  </article>
                ))}
              </div>

              {targetDataset && notYet.length > 1 ? (
                <div className="cs-actions" style={{ marginTop: 'var(--s-3)' }}>
                  <button
                    type="button"
                    className="cs-btn cs-btn-sm"
                    disabled={bulk[group.key]?.state === 'saving'}
                    onClick={() => addAll(group, notYet)}
                  >
                    {t('selection.addAll', { count: notYet.length, name: datasetName(targetDataset, t) })}
                  </button>
                  <span className="cs-save" data-state={bulk[group.key]?.state ?? 'idle'} aria-live="polite">
                    {bulk[group.key]?.text ?? ''}
                  </span>
                </div>
              ) : null}
            </section>
          )
        })
      )}
    </>
  )
}
