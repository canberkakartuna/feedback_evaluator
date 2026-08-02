import { Link, useParams } from 'react-router-dom'
import { api } from '../../lib/api'
import { useAsync } from '../../lib/useAsync'

const clock = (iso) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })

/**
 * One session, question by question.
 *
 * Grouped by question rather than shown as one long thread, because the thing
 * being judged is the exchange about a particular problem — which is also the
 * unit the labelling screen works in. Questions with no conversation are simply
 * absent: the transcript is built from messages, so a question the student
 * skipped never appears.
 */
export default function StudentWork() {
  const { sessionId } = useParams()
  const { data, error, loading } = useAsync(() => api.transcript(sessionId), [sessionId])

  if (loading) return <p className="cs-note">Loading…</p>
  if (error) {
    return (
      <p className="cs-note" data-tone="bad">
        {error.message} — <Link to="/teacher/students">back to student work</Link>
      </p>
    )
  }

  const { session, questions, events } = data

  return (
    <>
      <header className="cs-head">
        <div>
          <p className="eyebrow">
            <Link to="/teacher/students">Student work</Link> · session{' '}
            <span className="mono">{session.code}</span>
          </p>
          <h1 className="cs-title">
            {session.userId ? 'Signed-in student' : 'Anonymous student'}
          </h1>
          <p className="cs-lede">
            Started {new Date(session.createdAt).toLocaleString()} · {events.length} events ·
            consent v{session.consent?.version ?? '—'} · prompt{' '}
            {session.promptVersion ?? 'none recorded'}
          </p>
        </div>

        <Link className="cs-btn" to={`/teacher/labelling?session=${session.id}`}>
          Label these exchanges
        </Link>
      </header>

      {questions.length === 0 ? (
        <p className="cs-empty">
          This student opened the activity but never spoke to the tutor, so there is nothing to
          read.
        </p>
      ) : (
        questions.map((question) => (
          <section key={question.questionId} className="cs-card" style={{ marginBottom: 'var(--s-4)' }}>
            <div className="cs-tile-top">
              <span className="cs-q-code">{question.code}</span>
              {question.isOwnQuestion ? (
                <span className="cs-pill" data-tone="draft">
                  their own question
                </span>
              ) : null}
            </div>

            {question.prompt ? (
              <p style={{ marginTop: 0 }}>{question.prompt}</p>
            ) : (
              <p className="cs-hint">This question has since been removed from the activity.</p>
            )}

            {question.answer?.draft ? (
              <div className="cs-turn" data-from="student">
                <p className="cs-turn-who eyebrow">Their answer</p>
                <p className="cs-turn-text">{question.answer.draft}</p>
              </div>
            ) : null}

            {question.answer?.feedback?.markable ? (
              <p className="cs-hint">
                Marked {question.answer.feedback.earned}/{question.answer.feedback.total}
                {question.answer.selfMark ? ` · they marked it "${question.answer.selfMark}"` : ''}
              </p>
            ) : null}

            <div className="cs-thread">
              {question.messages.map((message) => (
                <div key={message.id} className="cs-msg" data-from={message.from}>
                  <p className="eyebrow">
                    {message.from === 'student' ? 'Student' : (message.label ?? 'Tutor')} ·{' '}
                    {clock(message.createdAt)}
                    {message.rating ? ` · rated ${message.rating}` : ''}
                  </p>
                  <p className="cs-msg-text">{message.text}</p>
                </div>
              ))}
            </div>
          </section>
        ))
      )}
    </>
  )
}
