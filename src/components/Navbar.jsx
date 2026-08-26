import { Link } from 'react-router-dom'
import { homeFor, useAuth } from '../lib/auth'
import TopBar from './TopBar'
import './Chrome.css'

/**
 * The one navbar, fixed to the top of the viewport on every screen that has
 * one — the student entry flow, sign-in, the profile, the consent notice, and
 * both consoles. It replaced a bare `TopBar` that used to scroll away with
 * the page it sat on, which meant the way out was gone exactly when a long
 * screen made you want it most.
 *
 * The brand is the one thing `TopBar` never carried: a link back to wherever
 * this person's screen actually starts, which is `homeFor` for anyone signed
 * in and `/` — the student entry screen — for everybody else. Everything to
 * its right is `TopBar` itself, unchanged, so every prop it takes still
 * works here.
 */
export default function Navbar(props) {
  const { user } = useAuth()
  const brandHref = user ? homeFor(user) : '/'

  return (
    <header className="nb-bar">
      <Link className="nb-brand" to={brandHref}>
        <span className="nb-brand-name">Dropshot</span>
      </Link>
      <TopBar layout="nav" {...props} />
    </header>
  )
}
