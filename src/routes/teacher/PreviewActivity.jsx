import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../../lib/api'
import { DEFAULT_MODE } from '../../lib/answer'
import { useT } from '../../lib/i18n'
import { numberQuestions } from '../../lib/questionName'
import { useAsync } from '../../lib/useAsync'
import QuestionPanel from '../../components/QuestionPanel'
import '../../components/Workspace.css'

const blank = () => ({
  mode: DEFAULT_MODE,
  status: 'new',
  selfMark: null,
  draft: '',
  attachments: [],
  strokes: [],
  feedback: null,
  feedbackFor: null,
  hintsUsed: 0,
})

/**
 * An activity as a student sees it, for the teacher who wrote it.
 *
 * The "Open" button next to the class link used to open `/join/CODE`, which
 * sends a signed-in teacher straight back to their console — staff cannot start
 * a session (routes/sessions.js) — so the button appeared to reload the page.
 * This is what it opens instead: the same question panel a student works in,
 * fed from `GET /api/activities/:id/preview`, which strips exactly what the
 * student payload strips. The EN/TR switch changes the questions as it would for
 * a student.
 *
 * Nothing here reaches the server. Typing, switching between Write, Draw and
 * Upload, and marking a question are kept in this page and forgotten on leaving
 * it — a teacher's clicking must not land in the study's data.
 */
export default function PreviewActivity() {
  const { activityId } = useParams()
  const t = useT()
  const { data, error, loading } = useAsync(() => api.activityPreview(activityId), [activityId])

  const [index, setIndex] = useState(0)
  const [states, setStates] = useState({})

  if (loading) return <p className="cs-note">{t('common.loading')}</p>
  if (error) {
    return (
      <p className="cs-note" data-tone="bad">
        {error.message}
      </p>
    )
  }

  const { activity } = data
  // Numbered as the student workspace numbers them, so the panel says "Q1".
  const questions = numberQuestions(activity.questions)
  const question = questions[index]
  const state = (question && states[question.id]) ?? blank()
  const patch = (changes) =>
    setStates((prior) => ({ ...prior, [question.id]: { ...state, ...changes } }))

  return (
    <>
      <header className="cs-head">
        <div>
          <p className="eyebrow">
            <Link to={`/teacher/activities/${activity.id}`}>{t('editor.breadcrumb')}</Link> ·{' '}
            {t('preview.eyebrow')}
          </p>
          <h1 className="cs-title">{activity.title}</h1>
          <p className="cs-lede">{t('preview.lede')}</p>
        </div>
      </header>

      {!question ? (
        <p className="cs-empty">{t('editor.noQuestions')}</p>
      ) : (
        <>
          <div className="cs-actions" style={{ flexWrap: 'wrap', marginBottom: 'var(--s-3)' }}>
            {questions.map((entry, at) => (
              <button
                key={entry.id}
                type="button"
                className={at === index ? 'cs-btn cs-btn-sm cs-btn-primary' : 'cs-btn cs-btn-sm'}
                aria-current={at === index}
                onClick={() => setIndex(at)}
              >
                {entry.code}
              </button>
            ))}
          </div>

          <div className="pv-frame">
            <QuestionPanel
              question={question}
              state={state}
              position={{ current: index + 1, total: questions.length }}
              previous={questions[index - 1]}
              next={questions[index + 1]}
              onSelfMark={(selfMark) => patch({ selfMark })}
              onDraftChange={(draft) => patch({ draft })}
              onModeChange={(mode) => patch({ mode, draft: '', strokes: [], attachments: [] })}
              onAttach={() => {}}
              onDetach={() => {}}
              onSaveBoard={(strokes) => patch({ strokes })}
              onCheck={() => {}}
              onStep={(delta) => setIndex((at) => Math.min(questions.length - 1, Math.max(0, at + delta)))}
              onOpenTutor={() => {}}
            />
          </div>
        </>
      )}
    </>
  )
}
