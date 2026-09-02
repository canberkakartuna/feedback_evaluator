import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { TOPICS } from '../../../shared/activity'
import MathText from '../../components/MathText'
import { api } from '../../lib/api'
import { useT } from '../../lib/i18n'
import { useAsync } from '../../lib/useAsync'
import QuestionForm from './QuestionForm'
import ShareActivity from './ShareActivity'

/**
 * One activity: its settings, how students reach it, and its questions.
 *
 * Publishing is the hinge and the whole access decision — a draft is invisible
 * to students and cannot be started, by id or by class code, so a teacher can
 * build at their own pace. The server refuses to publish an activity with no
 * questions. Unpublishing closes it again without touching anything already
 * recorded, which is why it is offered as the answer whenever a delete is
 * refused.
 */
export default function ActivityEditor() {
  const { activityId } = useParams()
  const navigate = useNavigate()
  const t = useT()

  const { data, error, loading, reload } = useAsync(
    () => api.activity(activityId),
    [activityId],
  )

  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(null)

  if (loading) return <p className="cs-note">{t('common.loading')}</p>
  if (error) {
    return (
      <p className="cs-note" data-tone="bad">
        {error.message} — <Link to="/teacher">{t('editor.breadcrumb')}</Link>
      </p>
    )
  }

  const { activity, questions } = data
  const published = activity.status === 'published'

  const act = async (work) => {
    setBusy(true)
    setNotice(null)
    try {
      await work()
      await reload()
    } catch (failure) {
      setNotice({ tone: 'bad', text: failure.message })
      throw failure
    } finally {
      setBusy(false)
    }
  }

  const move = (index, delta) => {
    const next = [...questions]
    const target = index + delta
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    return act(() => api.reorderQuestions(activity.id, next.map((question) => question.id)))
  }

  const remove = async () => {
    try {
      await api.deleteActivity(activity.id)
      navigate('/teacher', { replace: true })
    } catch (failure) {
      setNotice({
        tone: 'warn',
        text: `${failure.message}. ${failure.details?.hint ?? ''}`,
      })
    }
  }

  return (
    <>
      <header className="cs-head">
        <div>
          <p className="eyebrow">
            <Link to="/teacher">{t('editor.breadcrumb')}</Link> ·{' '}
            {published ? t('activities.open') : t('activities.draft')}
          </p>
          <h1 className="cs-title">{activity.title}</h1>
          {activity.blurb ? <p className="cs-lede">{activity.blurb}</p> : null}
        </div>

        <div className="cs-actions">
          <Link className="cs-btn" to={`/teacher/students?activity=${activity.id}`}>
            {t('editor.seeWork')}
          </Link>
          <button
            type="button"
            className={`cs-btn ${published ? '' : 'cs-btn-primary'}`}
            disabled={busy || (!published && questions.length === 0)}
            onClick={() =>
              act(() =>
                api.updateActivity(activity.id, {
                  status: published ? 'draft' : 'published',
                }),
              ).catch(() => {})
            }
          >
            {published ? t('editor.closeToStudents') : t('editor.publish')}
          </button>
        </div>
      </header>

      {notice ? (
        <p className="cs-note" data-tone={notice.tone} role="alert">
          {notice.text}
        </p>
      ) : null}

      <section className="cs-card">
        {published ? (
          <>
            <p className="eyebrow">{t('editor.openHead')}</p>
            <p className="cs-hint" style={{ marginTop: 'var(--s-1)' }}>
              {t('editor.openHint')}
            </p>
          </>
        ) : (
          <>
            <p className="eyebrow">{t('editor.draftHead')}</p>
            <p className="cs-hint" style={{ marginTop: 'var(--s-1)' }}>
              {questions.length === 0 ? t('editor.draftHintEmpty') : t('editor.draftHint')}
            </p>
          </>
        )}

        {/* The topic, saved on change rather than behind a Save button: it is one
            field, and the list a class reads is filtered by it. */}
        <div className="cs-field" style={{ marginTop: 'var(--s-4)', maxWidth: '320px' }}>
          <label className="cs-label" htmlFor="activity-topic">
            {t('editor.topicLabel')}
          </label>
          <select
            id="activity-topic"
            className="cs-select"
            disabled={busy}
            value={activity.topic ?? ''}
            onChange={(event) =>
              act(() =>
                api.updateActivity(activity.id, { topic: event.target.value || null }),
              ).catch(() => {})
            }
          >
            <option value="">{t('topics.unset')}</option>
            {TOPICS.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {t(`topics.${entry.id}`)}
              </option>
            ))}
          </select>
          <p className="cs-hint">{busy ? t('editor.topicSaving') : t('editor.topicHint')}</p>
        </div>
      </section>

      <ShareActivity activity={activity} published={published} />

      <section className="cs-section">
        <div className="cs-head">
          <h2 className="cs-section-head" style={{ margin: 0 }}>
            {t('editor.questions')} <span className="mono cs-hint">({questions.length})</span>
          </h2>
          {!adding ? (
            <button
              type="button"
              className="cs-btn cs-btn-primary"
              onClick={() => {
                setAdding(true)
                setEditingId(null)
              }}
            >
              {t('editor.addQuestion')}
            </button>
          ) : null}
        </div>

        {adding ? (
          <div className="cs-card" style={{ marginBottom: 'var(--s-4)' }}>
            <h3 className="cs-section-head">{t('editor.newQuestion')}</h3>
            <QuestionForm
              busy={busy}
              onCancel={() => setAdding(false)}
              onSave={async (body) => {
                await act(() => api.addQuestion(activity.id, body))
                setAdding(false)
              }}
            />
          </div>
        ) : null}

        {questions.length === 0 && !adding ? (
          <p className="cs-empty">{t('editor.noQuestions')}</p>
        ) : (
          <ul className="cs-qlist">
            {questions.map((question, index) => (
              <li key={question.id} className="cs-q">
                <div className="cs-q-head">
                  <span className="cs-q-code">{question.code}</span>
                  <p className="cs-q-prompt">
                    {question.prompt ? (
                      <MathText text={question.prompt} />
                    ) : (
                      <em>{t('editor.uploadedNoText')}</em>
                    )}
                  </p>

                  {question.image ? (
                    <span className="cs-pill" data-tone="draft">
                      {t('editor.picture')}
                    </span>
                  ) : null}

                  {/* Only when there is one. New questions have no mark
                      scheme, so "unmarked" on every row would be noise. */}
                  {question.rubric?.length ? (
                    <span className="cs-pill" data-tone="live">
                      {t('common.criteria', { count: question.rubric.length })}
                    </span>
                  ) : null}

                  <button
                    type="button"
                    className="cs-btn cs-btn-sm"
                    disabled={busy || index === 0}
                    aria-label={t('editor.moveUp', { code: question.code })}
                    onClick={() => move(index, -1)?.catch(() => {})}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="cs-btn cs-btn-sm"
                    disabled={busy || index === questions.length - 1}
                    aria-label={t('editor.moveDown', { code: question.code })}
                    onClick={() => move(index, 1)?.catch(() => {})}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="cs-btn cs-btn-sm"
                    onClick={() => {
                      setEditingId(editingId === question.id ? null : question.id)
                      setAdding(false)
                    }}
                  >
                    {editingId === question.id ? t('editor.closeEdit') : t('editor.edit')}
                  </button>
                  <button
                    type="button"
                    className="cs-btn cs-btn-sm cs-btn-danger"
                    disabled={busy}
                    onClick={() =>
                      act(() => api.deleteQuestion(activity.id, question.id)).catch(() => {})
                    }
                  >
                    {t('common.delete')}
                  </button>
                </div>

                {editingId === question.id ? (
                  <div className="cs-q-body">
                    <QuestionForm
                      question={question}
                      busy={busy}
                      onCancel={() => setEditingId(null)}
                      onSave={async (body) => {
                        await act(() => api.updateQuestion(activity.id, question.id, body))
                        setEditingId(null)
                      }}
                    />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="cs-section">
        <h2 className="cs-section-head">{t('editor.danger')}</h2>
        <div className="cs-card">
          <p className="cs-hint" style={{ marginBottom: 'var(--s-3)' }}>
            {t('editor.dangerHint')}
          </p>
          <button type="button" className="cs-btn cs-btn-danger" onClick={remove}>
            {t('editor.deleteActivity')}
          </button>
        </div>
      </section>
    </>
  )
}
