import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import '../../components/Entry.css'
import '../console.css'

/**
 * The student's way in: consent, then an activity.
 *
 * Consent is first and cannot be skipped — there is no route into a session
 * that does not create the consent record, on the server as well as here, so
 * the gate holds even against someone calling the API directly.
 *
 * After that there are two ways in, and the first is the common case:
 *
 * - **Anonymously**, with a join code typed off the board. No account, no name,
 *   nothing asked. This is what the study is designed around.
 * - **Signed in**, for a student whose teacher made them an account. They get a
 *   list of their own teacher's published work instead of typing a code.
 *
 * Both end in the same place, and the join code is offered to signed-in
 * students too, since a class may be doing an activity set by someone else.
 *
 * The consent wording is a PLACEHOLDER. Replace it with the text your ethics
 * committee approves before this goes near a real student.
 */
export default function StudentEntry() {
  const { code: codeFromUrl } = useParams()
  const navigate = useNavigate()
  const { user, ready } = useAuth()

  const [step, setStep] = useState('consent')
  const [agreed, setAgreed] = useState(false)
  const [code, setCode] = useState(codeFromUrl ? codeFromUrl.toUpperCase() : '')
  const [preview, setPreview] = useState(null)
  const [available, setAvailable] = useState([])
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const isStudentAccount = ready && user?.role === 'student'

  // Only for a signed-in student; anonymous students have no list to show.
  useEffect(() => {
    if (step !== 'pick' || !isStudentAccount) return
    api
      .availableActivities()
      .then((result) => setAvailable(result.activities))
      .catch(() => setAvailable([]))
  }, [isStudentAccount, step])

  /** Looks the code up before committing, so a typo is caught before consent is recorded. */
  const lookUp = async (event) => {
    event?.preventDefault()
    if (!code.trim()) return

    setBusy(true)
    setError(null)
    try {
      const { activity } = await api.activityByCode(code.trim())
      setPreview(activity)
    } catch (failure) {
      setPreview(null)
      setError(failure.message)
    } finally {
      setBusy(false)
    }
  }

  const begin = async (body) => {
    setBusy(true)
    setError(null)
    try {
      const { session } = await api.startSession({ ...body, device: navigator.userAgent.slice(0, 120) })
      navigate(`/work/${session.id}`, { replace: true })
    } catch (failure) {
      setError(failure.message)
      setBusy(false)
    }
  }

  if (step === 'declined') {
    return (
      <main className="en-page">
        <div className="en-card">
          <p className="eyebrow">Not started</p>
          <h1 className="en-title">Nothing has been recorded</h1>
          <p className="en-lede">
            The workspace only runs with consent, so there is nothing further to do here. You can
            close this tab.
          </p>
          <button type="button" className="en-btn" onClick={() => setStep('consent')}>
            Back to the consent form
          </button>
        </div>
      </main>
    )
  }

  if (step === 'pick') {
    return (
      <main className="en-page">
        <div className="en-card">
          <p className="eyebrow">Step 2 of 2</p>
          <h1 className="en-title">Which activity?</h1>

          {isStudentAccount && available.length > 0 ? (
            <>
              <p className="en-lede">Set by your teacher.</p>
              <div className="en-topics">
                {available.map((activity) => (
                  <button
                    key={activity.id}
                    type="button"
                    className="en-topic"
                    disabled={busy}
                    onClick={() => begin({ activityId: activity.id })}
                  >
                    <span className="en-topic-name">{activity.title}</span>
                    <span className="en-topic-meta mono">{activity.questionCount} questions</span>
                  </button>
                ))}
              </div>
              <p className="eyebrow" style={{ marginTop: 'var(--s-5)' }}>
                Or use a code
              </p>
            </>
          ) : (
            <p className="en-lede">
              Your teacher will have given you a six-character code. Type it in below.
            </p>
          )}

          <form className="cs-form" onSubmit={lookUp}>
            <div className="cs-field">
              <label className="cs-label" htmlFor="join-code">
                Join code
              </label>
              <input
                id="join-code"
                className="cs-input mono"
                style={{ fontSize: 'var(--t-22)', letterSpacing: '0.16em', textAlign: 'center' }}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                maxLength={6}
                placeholder="ABC123"
                value={code}
                onChange={(event) => {
                  setCode(event.target.value.toUpperCase())
                  setPreview(null)
                  setError(null)
                }}
              />
            </div>

            {error ? (
              <p className="cs-note" data-tone="bad" role="alert">
                {error}
              </p>
            ) : null}

            {preview ? (
              <div className="cs-note" data-tone="good">
                <strong>{preview.title}</strong>
                {preview.blurb ? <> — {preview.blurb}</> : null}
                <br />
                {preview.questionCount} {preview.questionCount === 1 ? 'question' : 'questions'}
              </div>
            ) : null}

            <div className="en-actions">
              {preview ? (
                <button
                  type="button"
                  className="en-btn en-btn-primary"
                  disabled={busy}
                  onClick={() => begin({ code: preview.code })}
                >
                  {busy ? 'Starting…' : 'Start working'}
                </button>
              ) : (
                <button
                  type="submit"
                  className="en-btn en-btn-primary"
                  disabled={busy || code.trim().length < 4}
                >
                  {busy ? 'Checking…' : 'Find it'}
                </button>
              )}
              <button type="button" className="en-btn" onClick={() => setStep('consent')}>
                Back
              </button>
            </div>
          </form>
        </div>
      </main>
    )
  }

  return (
    <main className="en-page">
      <div className="en-card">
        <p className="eyebrow">Step 1 of 2 · Consent</p>
        <h1 className="en-title">Before you start</h1>
        <p className="en-lede">
          This workspace is part of a research study on how AI feedback helps students work through
          problems. Please read this before you start.
        </p>

        <div className="en-terms">
          <h2 className="en-terms-head">What gets recorded</h2>
          <ul className="en-list">
            <li>Everything you type to the tutor, and everything it replies.</li>
            <li>Your answers — typed, drawn or uploaded — and the marks on them.</li>
            <li>Which questions you open, how you mark them, and when.</li>
          </ul>

          <h2 className="en-terms-head">How it is used</h2>
          <ul className="en-list">
            <li>To build an anonymous dataset for research on AI feedback in teaching.</li>
            <li>Your teacher may read your conversations and label them for the study.</li>
            <li>You are not asked for your name, your email or your school.</li>
          </ul>

          <p className="en-warn">
            Do not type your name, anyone else&rsquo;s name, or any other personal detail into the
            workspace. You can stop at any time, and delete everything you did, from inside the
            workspace.
          </p>
        </div>

        <label className="en-agree">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(event) => setAgreed(event.target.checked)}
          />
          <span>
            I have read this, and I agree to my answers and conversations being recorded for this
            research.
          </span>
        </label>

        <div className="en-actions">
          <button
            type="button"
            className="en-btn en-btn-primary"
            disabled={!agreed}
            onClick={() => setStep('pick')}
          >
            Agree and continue
          </button>
          <button type="button" className="en-btn" onClick={() => setStep('declined')}>
            I do not agree
          </button>
        </div>

        <p className="cs-hint" style={{ marginTop: 'var(--s-4)' }}>
          Have an account? <Link to="/signin">Sign in</Link>.
        </p>
      </div>
    </main>
  )
}
