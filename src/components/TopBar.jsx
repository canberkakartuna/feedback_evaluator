import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { Link, useNavigate } from 'react-router-dom'
import { isStaff } from '../../shared/roles'
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
 *   a student       Home · Class code · Profile · Sign out
 *   staff           My console · Profile · Sign out
 *
 * `layout` picks the arrangement, not the contents: `nav` is the fixed navbar
 * every screen sits under (see Navbar.jsx), `stack` is a console sidebar,
 * `bar` is the tight row at the right of the workspace header. `page` is what
 * `nav` replaced and stays only for a screen that renders TopBar without one.
 * See Chrome.css.
 */
export default function TopBar({
  layout = 'page',
  home = true,
  homeKey = 'nav.home',
  join = false,
  console: showConsole = true,
  profile = true,
  who = true,
  signOutTo = '/',
}) {
  const t = useT()
  const { user, ready, signOut } = useAuth()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  // Replies waiting on the support channel, for the dot on its button.
  const [supportUnread, setSupportUnread] = useState(0)

  useEffect(() => {
    if (!ready || !user) return undefined
    let alive = true
    api
      .supportUnread()
      .then((result) => alive && setSupportUnread(result.unread))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [ready, user])

  const consoleHref = user ? homeFor(user) : '/'
  const hasConsole = showConsole && consoleHref !== '/'

  /**
   * Staff are not offered Home, wherever this bar is drawn.
   *
   * Home is `/`, the student entry screen, and StudentLayout sends a teacher,
   * manager or admin straight back out of it — so for them the button's only
   * effect would be a round trip to the console they were already in. "My
   * console" is the way home for staff, and it sits in the same row.
   *
   * Waited on `ready` rather than guessed: showing it and then taking it away a
   * moment later moves everything beside it under whoever was aiming at it.
   */
  const hasHome = home && ready && !isStaff(user?.role)

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
      {who && ready && (layout === 'page' || layout === 'nav') ? (
        <p className="ch-who">
          {user ? t('nav.signedInAs', { name: user.name }) : t('nav.working')}
        </p>
      ) : null}

      {/* "Home" is the student entry screen, and the label is the caller's to
          set — the destination is not. */}
      {hasHome ? (
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

      {profile && ready && user ? (
        <Link className="ch-btn" to="/profil">
          {t('nav.profile')}
        </Link>
      ) : null}

      {/* The support / suggestion channel, for anyone signed in (3 Nov 2026 doc). */}
      {ready && user ? (
        <Link className="ch-btn" to="/support">
          {t('nav.support')}
          {supportUnread > 0 ? (
            <span className="ch-dot" aria-label={t('nav.supportUnread')} />
          ) : null}
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
