import { useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { homeFor, useAuth } from '../lib/auth'
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

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  if (ready && user) return <Navigate to={location.state?.from ?? homeFor(user)} replace />

  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setError(null)

    try {
      const me = await signIn(email, password)
      navigate(location.state?.from ?? homeFor(me), { replace: true })
    } catch (problem) {
      setError(problem.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="en-page">
      <div className="en-card">
        <p className="eyebrow">Staff and students with an account</p>
        <h1 className="en-title">Sign in</h1>

        <form className="cs-form" onSubmit={submit}>
          <div className="cs-field">
            <label className="cs-label" htmlFor="email">
              Email
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
              Password
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
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="cs-hint" style={{ marginTop: 'var(--s-4)' }}>
          No account? Students join with a code from their teacher —{' '}
          <Link to="/">start here</Link>. Teacher accounts are created by an administrator.
        </p>
      </div>
    </main>
  )
}
