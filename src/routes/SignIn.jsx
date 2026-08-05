import { useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { landingFor, useAuth } from '../lib/auth'
import { useT } from '../lib/i18n'
import TopBar from '../components/TopBar'
import './console.css'
import '../components/Entry.css'

/**
 * The only way in for anyone with an account.
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
    setBusy(true)
    setError(null)

    try {
      const me = await signIn(email, password)
      navigate(landingFor(me, location.state?.from), { replace: true })
    } catch (problem) {
      setError(problem.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="en-page">
      {/* No "My console" here — nobody is signed in yet, and no sign-out for the
          same reason. Home and the language switch are the useful pair. */}
      <TopBar who={false} join />
      <div className="en-card">
        <p className="eyebrow">{t('signin.eyebrow')}</p>
        <h1 className="en-title">{t('signin.title')}</h1>

        <form className="cs-form" onSubmit={submit}>
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
              {error}
            </p>
          ) : null}

          <button type="submit" className="cs-btn cs-btn-primary" disabled={busy}>
            {busy ? t('signin.busy') : t('signin.submit')}
          </button>
        </form>

        <p className="cs-hint" style={{ marginTop: 'var(--s-4)' }}>
          {t('signin.noAccount')} {t('signin.staffAccounts')}
        </p>

        <div className="en-actions">
          <Link className="en-btn" to="/">
            {t('signin.startHere')}
          </Link>
          <Link className="en-btn" to="/join">
            {t('entry.pick.enterCode')}
          </Link>
        </div>
      </div>
    </main>
  )
}
