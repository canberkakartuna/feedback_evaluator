import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
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
 * After that there are exactly two ways to be here, and the screen asks which:
 *
 * - **Anonymously.** No account, no name, nothing asked. The list shows every
 *   published activity, because with no code and no credential, publishing is
 *   the whole access decision. This is what the study is designed around.
 * - **Signed in**, with an account their teacher made. Same screens, but the
 *   list is narrowed to their own teacher's work and the session carries their
 *   name so it can be followed across visits.
 *
 * There is deliberately **no join code**. It was a third identifier for
 * something that already had one, and it put a typing task between a student
 * and the work.
 *
 * The consent wording is a PLACEHOLDER. Replace it with the text your ethics
 * committee approves before this goes near a real student.
 */
export default function StudentEntry() {
  const navigate = useNavigate()
  const { user, ready } = useAuth()

  const [step, setStep] = useState('consent')
  const [activities, setActivities] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [agreed, setAgreed] = useState(false)

  const signedIn = ready && Boolean(user)

  useEffect(() => {
    if (step !== 'pick') return

    let alive = true
    api
      .availableActivities()
      .then((result) => alive && setActivities(result.activities))
      .catch((failure) => {
        if (!alive) return
        setActivities([])
        setError(failure.message)
      })

    return () => {
      alive = false
    }
  }, [step])

  const begin = async (activityId) => {
    setBusy(true)
    setError(null)
    try {
      const { session } = await api.startSession({
        activityId,
        device: navigator.userAgent.slice(0, 120),
      })
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
          <p className="eyebrow">Step 3 of 3</p>
          <h1 className="en-title">What are you working on?</h1>
          <p className="en-lede">
            {signedIn
              ? `Set by your teacher, and saved to your account.`
              : 'Pick the one your teacher told you to open. You are working anonymously.'}
          </p>

          {error ? (
            <p className="cs-note" data-tone="bad" role="alert">
              {error}
            </p>
          ) : null}

          {signedIn ? (
            <p className="cs-hint" style={{ marginBottom: 'var(--s-4)' }}>
              Signed in as <strong>{user.name}</strong>. To work anonymously instead,{' '}
              <Link to="/signin">sign out first</Link> — while you are signed in, everything you do
              is saved to your account.
            </p>
          ) : null}

          {activities === null ? (
            <p className="cs-note">Loading…</p>
          ) : activities.length === 0 ? (
            <p className="cs-empty">
              Nothing is open yet. Your teacher has to publish an activity before it appears here.
            </p>
          ) : (
            <div className="en-topics">
              {activities.map((activity) => (
                <button
                  key={activity.id}
                  type="button"
                  className="en-topic"
                  disabled={busy}
                  onClick={() => begin(activity.id)}
                >
                  <span className="en-topic-name">{activity.title}</span>
                  <span className="en-topic-meta mono">
                    {activity.questionCount} {activity.questionCount === 1 ? 'question' : 'questions'}
                  </span>
                </button>
              ))}
            </div>
          )}

          <div className="en-actions">
            <button
              type="button"
              className="en-btn"
              onClick={() => setStep(signedIn ? 'consent' : 'who')}
            >
              Back
            </button>
          </div>
        </div>
      </main>
    )
  }

  if (step === 'who') {
    return (
      <main className="en-page">
        <div className="en-card">
          <p className="eyebrow">Step 2 of 3</p>
          <h1 className="en-title">How are you working today?</h1>
          <p className="en-lede">
            Either is fine. Anonymous is the normal way in — you only need an account if your
            teacher set one up for you.
          </p>

          <div className="en-topics">
            <button
              type="button"
              className="en-topic"
              onClick={() => {
                setActivities(null)
                setStep('pick')
              }}
            >
              <span className="en-topic-name">Continue anonymously</span>
              <span className="en-topic-meta">No account. Nothing is asked for.</span>
            </button>

            <Link className="en-topic" to="/signin" state={{ from: '/' }}>
              <span className="en-topic-name">Sign in</span>
              <span className="en-topic-meta">
                If your teacher gave you an email and password.
              </span>
            </Link>
          </div>

          <div className="en-actions">
            <button type="button" className="en-btn" onClick={() => setStep('consent')}>
              Back
            </button>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="en-page">
      <div className="en-card">
        <p className="eyebrow">Step 1 of 3 · Consent</p>
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
            onClick={() => setStep(signedIn ? 'pick' : 'who')}
          >
            Agree and continue
          </button>
          <button type="button" className="en-btn" onClick={() => setStep('declined')}>
            I do not agree
          </button>
        </div>
      </div>
    </main>
  )
}
