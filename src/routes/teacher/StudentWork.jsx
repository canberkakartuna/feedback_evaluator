import { Link, useParams } from 'react-router-dom'
import { api } from '../../lib/api'
import { useI18n } from '../../lib/i18n'
import { useAsync } from '../../lib/useAsync'

const clock = (iso, lang) =>
  new Date(iso).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' })

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
  const { lang, t } = useI18n()
  const { data, error, loading } = useAsync(() => api.transcript(sessionId), [sessionId])

  if (loading) return <p className="cs-note">{t('common.loading')}</p>
  if (error) {
    return (
      <p className="cs-note" data-tone="bad">
        {error.message} — <Link to="/teacher/students">{t('transcript.back')}</Link>
      </p>
    )
  }

  const { session, questions, events } = data

  /**
   * The three facts worth knowing before reading a word of it: when, how much,
   * and under which consent and prompt. Assembled from parts rather than one
   * sentence, since a staff preview has no consent version to name.
   */
  const meta = [
    t('transcript.started', { when: new Date(session.createdAt).toLocaleString(lang) }),
    t('common.events', { count: events.length }),
    session.staffPreview
      ? t('transcript.consentWaived')
      : t('transcript.consentVersion', { version: session.consent?.version ?? '—' }),
    session.promptVersion
      ? t('transcript.prompt', { version: session.promptVersion })
      : t('transcript.noPrompt'),
  ].join(' · ')

  const whose = session.staffPreview
    ? t('transcript.preview')
    : session.userId
      ? t('transcript.signedIn')
      : t('transcript.anon')

  return (
    <>
      <header className="cs-head">
        <div>
          <p className="eyebrow">
            <Link to="/teacher/students">{t('transcript.studentWork')}</Link> ·{' '}
            {t('transcript.session')} <span className="mono">{session.code}</span>
          </p>
          <h1 className="cs-title">{whose}</h1>
          <p className="cs-lede">{meta}</p>
        </div>

        <Link className="cs-btn" to={`/teacher/labelling?session=${session.id}`}>
          {t('transcript.label')}
        </Link>
      </header>

      {questions.length === 0 ? (
        <p className="cs-empty">{t('transcript.empty')}</p>
      ) : (
        questions.map((question) => (
          <section key={question.questionId} className="cs-card" style={{ marginBottom: 'var(--s-4)' }}>
            <div className="cs-tile-top">
              <span className="cs-q-code">{question.code}</span>
              {question.isOwnQuestion ? (
                <span className="cs-pill" data-tone="draft">
                  {t('transcript.ownQuestion')}
                </span>
              ) : null}
            </div>

            {question.prompt ? (
              <p style={{ marginTop: 0 }}>{question.prompt}</p>
            ) : (
              <p className="cs-hint">{t('transcript.removedQuestion')}</p>
            )}

            {question.answer?.draft ? (
              <div className="cs-turn" data-from="student">
                <p className="cs-turn-who eyebrow">{t('transcript.theirAnswer')}</p>
                <p className="cs-turn-text">{question.answer.draft}</p>
              </div>
            ) : null}

            {question.answer?.feedback?.markable ? (
              <p className="cs-hint">
                {t('transcript.marked', {
                  earned: question.answer.feedback.earned,
                  total: question.answer.feedback.total,
                })}
                {question.answer.selfMark
                  ? ` · ${t('transcript.selfMarked', {
                      mark: t(`marks.${question.answer.selfMark}Label`),
                    })}`
                  : ''}
              </p>
            ) : null}

            <div className="cs-thread">
              {question.messages.map((message) => (
                <div key={message.id} className="cs-msg" data-from={message.from}>
                  <p className="eyebrow">
                    {message.from === 'student'
                      ? t('transcript.student')
                      : (message.label ?? t('transcript.tutor'))}{' '}
                    · {clock(message.createdAt, lang)}
                    {message.rating ? ` · ${t('transcript.rated', { rating: message.rating })}` : ''}
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
