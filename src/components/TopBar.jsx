import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { homeFor, useAuth } from '../lib/auth'
import { useT } from '../lib/i18n'
import LanguageToggle from './LanguageToggle'
import './Chrome.css'

/**
 * The way out, on every screen.
 *
 * Every route used to reach sign-in, sign-out or the way home through a sentence
 * — a link inside a paragraph of hint text, or nothing at all on the workspace,
 * where a student who had finished had only the browser's back button. These are
 * the three things a person wants from a screen they are done with, so they are
 * buttons, they are in the same place every time, and they say what they do.
 *
 * What appears depends only on who is signed in:
 *
 *   nobody          Home · Class code · Sign in
 *   a student       Home · Class code · Sign out
 *   staff           Home · My console · Sign out
 *
 * `layout` picks the arrangement, not the contents: `page` is the centred row
 * above an entry card, `stack` is a console sidebar, `bar` is the tight row at
 * the right of the workspace header. See Chrome.css.
 */
export default function TopBar({
  layout = 'page',
  home = true,
  homeKey = 'nav.home',
  join = false,
  console: showConsole = true,
  who = true,
  signOutTo = '/',
}) {
  const t = useT()
  const { user, ready, signOut } = useAuth()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)

  const consoleHref = user ? homeFor(user) : '/'
  const hasConsole = showConsole && consoleHref !== '/'

  const leave = async () => {
    setBusy(true)
    try {
      await signOut()
      navigate(signOutTo, { replace: true })
    } finally {
      setBusy(false)
    }
  }

  return (
    <nav className="ch-bar" data-layout={layout} aria-label={t('nav.label')}>
      {/* Only once `me` has settled, or the bar would flicker from "Sign in"
          to "Sign out" on every page load for someone already signed in. */}
      {who && ready && layout === 'page' ? (
        <p className="ch-who">
          {user ? t('nav.signedInAs', { name: user.name }) : t('nav.working')}
        </p>
      ) : null}

      {/* "Home" is the student entry screen for everybody. From inside a console
          that is a different journey than it is for a student, so the label is
          the caller's to set — the destination is not. */}
      {home ? (
        <Link className="ch-btn" to="/">
          {t(homeKey)}
        </Link>
      ) : null}

      {join ? (
        <Link className="ch-btn" to="/join">
          {t('nav.joinWithCode')}
        </Link>
      ) : null}

      {hasConsole ? (
        <Link className="ch-btn" to={consoleHref}>
          {t('nav.myConsole')}
        </Link>
      ) : null}

      {ready && user ? (
        <button type="button" className="ch-btn" disabled={busy} onClick={leave}>
          {busy ? t('nav.signingOut') : t('nav.signOut')}
        </button>
      ) : null}

      {ready && !user ? (
        <Link className="ch-btn" to="/signin">
          {t('nav.signIn')}
        </Link>
      ) : null}

      <LanguageToggle />
    </nav>
  )
}
