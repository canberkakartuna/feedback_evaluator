import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../../lib/api'
import { useAsync } from '../../lib/useAsync'
import QuestionForm from './QuestionForm'

/**
 * One activity: its settings and its questions.
 *
 * Publishing is the hinge, and with no join code it is the *whole* access
 * decision — a draft is invisible to students and cannot be started, so a
 * teacher can build at their own pace. The server refuses to publish an
 * activity with no questions. Unpublishing closes it again without touching
 * anything already recorded, which is why it is offered as the answer whenever
 * a delete is refused.
 */
export default function ActivityEditor() {
  const { activityId } = useParams()
  const navigate = useNavigate()

  const { data, error, loading, reload } = useAsync(
    () => api.activity(activityId),
    [activityId],
  )

  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(null)

  if (loading) return <p className="cs-note">Loading…</p>
  if (error) {
    return (
      <p className="cs-note" data-tone="bad">
        {error.message} — <Link to="/teacher">back to activities</Link>
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
            <Link to="/teacher">Activities</Link> · {published ? 'Open' : 'Draft'}
          </p>
          <h1 className="cs-title">{activity.title}</h1>
          {activity.blurb ? <p className="cs-lede">{activity.blurb}</p> : null}
        </div>

        <div className="cs-actions">
          <Link className="cs-btn" to={`/teacher/students?activity=${activity.id}`}>
            See their work
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
            {published ? 'Close to students' : 'Publish'}
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
            <p className="eyebrow">Open to students</p>
            <p className="cs-hint" style={{ marginTop: 'var(--s-1)' }}>
              It appears in the list students see when they open the site and agree to the consent
              notice. No code and no account needed — <strong>publishing is what opens it</strong>,
              so close it again when the lesson is over.
            </p>
          </>
        ) : (
          <>
            <p className="eyebrow">Not open yet</p>
            <p className="cs-hint" style={{ marginTop: 'var(--s-1)' }}>
              {questions.length === 0
                ? 'Students cannot see this. Add at least one question, then publish it.'
                : 'Students cannot see this yet. Publish it and it appears in their list.'}
            </p>
          </>
        )}
      </section>

      <section className="cs-section">
        <div className="cs-head">
          <h2 className="cs-section-head" style={{ margin: 0 }}>
            Questions <span className="mono cs-hint">({questions.length})</span>
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
              + Add question
            </button>
          ) : null}
        </div>

        {adding ? (
          <div className="cs-card" style={{ marginBottom: 'var(--s-4)' }}>
            <h3 className="cs-section-head">New question</h3>
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
          <p className="cs-empty">
            No questions yet. The only thing a question needs is the question itself — the mark
            scheme and the hints are optional.
          </p>
        ) : (
          <ul className="cs-qlist">
            {questions.map((question, index) => (
              <li key={question.id} className="cs-q">
                <div className="cs-q-head">
                  <span className="cs-q-code">{question.code}</span>
                  <p className="cs-q-prompt">{question.prompt}</p>

                  <span className="cs-pill" data-tone={question.rubric.length ? 'live' : 'quiet'}>
                    {question.rubric.length ? `${question.rubric.length} criteria` : 'unmarked'}
                  </span>

                  <button
                    type="button"
                    className="cs-btn cs-btn-sm"
                    disabled={busy || index === 0}
                    aria-label={`Move ${question.code} up`}
                    onClick={() => move(index, -1)?.catch(() => {})}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="cs-btn cs-btn-sm"
                    disabled={busy || index === questions.length - 1}
                    aria-label={`Move ${question.code} down`}
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
                    {editingId === question.id ? 'Close' : 'Edit'}
                  </button>
                  <button
                    type="button"
                    className="cs-btn cs-btn-sm cs-btn-danger"
                    disabled={busy}
                    onClick={() =>
                      act(() => api.deleteQuestion(activity.id, question.id)).catch(() => {})
                    }
                  >
                    Delete
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
        <h2 className="cs-section-head">Danger zone</h2>
        <div className="cs-card">
          <p className="cs-hint" style={{ marginBottom: 'var(--s-3)' }}>
            Deleting is refused once any student has worked on this. Close it to students instead —
            that stops new sessions and keeps every transcript readable.
          </p>
          <button type="button" className="cs-btn cs-btn-danger" onClick={remove}>
            Delete this activity
          </button>
        </div>
      </section>
    </>
  )
}
