import { useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { landingFor, useAuth } from '../lib/auth'
import { useT } from '../lib/i18n'
import Navbar from '../components/Navbar'
import SignInDoors from '../components/SignInDoors'
import './console.css'
import '../components/Entry.css'

/**
 * The staff door: email and password, for an admin, a manager, an annotator or
 * a teacher. Students have their own page (`/`, StudentLayout) and sign in with
 * their student number alone — they have no password, and the server answers
 * a student account here exactly as it answers a wrong password. So this page
 * carries no student-number field, and when what was typed is a student
 * number, or the answer is that 401, it says where students go instead.
 *
 * There is deliberately **no sign-up**. Accounts are created downwards — an
 * admin creates managers and teachers, a teacher creates their own students —
 * so an open registration form would be a hole straight through the hierarchy
 * that services/users.js spends its whole length enforcing. A student who has
 * not been given an account does not need one: they join with a code.
 *
 * The very first admin comes from `POST /api/auth/bootstrap`, which is a
 * one-shot route guarded by BOOTSTRAP_TOKEN and closes for good the moment any
 * user exists. That is a deployment step, not a screen.
 */
export default function SignIn() {
  const { user, ready, signIn } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const t = useT()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  if (ready && user) return <Navigate to={landingFor(user, location.state?.from)} replace />

  const submit = async (event) => {
    event.preventDefault()
    setError(null)

    // Checked here rather than by the browser (the form is noValidate): an
    // 8-digit number in the email box would otherwise get the browser's "add
    // an @" message, which tells a student nothing about where to go.
    if (/^\d+$/.test(email.trim())) {
      setError({ text: t('signin.looksLikeNumber'), toStudent: true })
      return
    }
    if (!email.trim() || !password) {
      setError({ text: t('signin.missing') })
      return
    }

    setBusy(true)
    try {
      const me = await signIn(email, password)
      navigate(landingFor(me, location.state?.from), { replace: true })
    } catch (problem) {
      // 401 covers a wrong password, an unknown address and a student account
      // alike (routes/auth.js), so the student hint goes with every one.
      setError(
        problem.status === 401
          ? { text: t('signin.wrong'), toStudent: true }
          : { text: problem.message },
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="en-page">
      {/* No "My console" here — nobody is signed in yet, and no sign-out for the
          same reason. Home and the language switch are the useful pair. */}
      <Navbar who={false} />
      <div className="en-card">
        <SignInDoors current="staff" />
        <p className="eyebrow">{t('signin.eyebrow')}</p>
        <h1 className="en-title">{t('signin.title')}</h1>
        <p className="en-lede">{t('signin.lede')}</p>

        <form className="cs-form" onSubmit={submit} noValidate>
          <div className="cs-field">
            <label className="cs-label" htmlFor="email">
              {t('signin.email')}
            </label>
            <input
              id="email"
              className="cs-input"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>

          <div className="cs-field">
            <label className="cs-label" htmlFor="password">
              {t('signin.password')}
            </label>
            <input
              id="password"
              className="cs-input"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>

          {error ? (
            <p className="cs-note" data-tone="bad" role="alert">
              {error.text}
              {error.toStudent ? (
                <>
                  {' '}
                  <Link to="/">{t('signin.toStudent')}</Link>
                </>
              ) : null}
            </p>
          ) : null}

          <button type="submit" className="cs-btn cs-btn-primary" disabled={busy}>
            {busy ? t('signin.busy') : t('signin.submit')}
          </button>
        </form>

        <p className="cs-hint" style={{ marginTop: 'var(--s-4)' }}>
          {t('signin.noAccount')} <Link to="/">{t('signin.toStudent')}</Link>
        </p>
        <p className="cs-hint">{t('signin.staffAccounts')}</p>
      </div>
    </main>
  )
}
