import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../../lib/auth'
import '../console.css'

const LINKS = [
  { to: '/teacher', end: true, label: 'Activities' },
  { to: '/teacher/students', label: 'Student work' },
  { to: '/teacher/labelling', label: 'Labelling' },
  { to: '/teacher/prompt', label: 'AI prompt' },
]

/**
 * The teacher console: build the work, watch it being done, then read it back.
 *
 * Managers land here too rather than getting a console of their own — their job
 * is the same job over a wider roster, and every screen inside is already
 * scoped by the server. An admin can reach it as well, which is how they check
 * a teacher's setup without needing a second account.
 */
export default function TeacherLayout() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()

  return (
    <div className="cs">
      <nav className="cs-nav" aria-label="Teacher sections">
        <Link className="cs-brand" to="/teacher">
          <p className="eyebrow">Teacher</p>
          <h1 className="cs-brand-name">Dropshot</h1>
        </Link>

        <ul className="cs-links">
          {LINKS.map((link) => (
            <li key={link.to}>
              <NavLink className="cs-link" to={link.to} end={link.end}>
                {link.label}
              </NavLink>
            </li>
          ))}
          {user.role === 'admin' ? (
            <li>
              <NavLink className="cs-link" to="/admin">
                Accounts →
              </NavLink>
            </li>
          ) : null}
        </ul>

        <div className="cs-who">
          <p className="cs-who-name">{user.name}</p>
          <p className="cs-who-role eyebrow">{user.role}</p>
          <button
            type="button"
            className="cs-btn cs-btn-sm"
            onClick={async () => {
              await signOut()
              navigate('/signin', { replace: true })
            }}
          >
            Sign out
          </button>
        </div>
      </nav>

      <main className="cs-main">
        <div className="cs-wrap">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
