import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../../lib/auth'
import '../console.css'

/**
 * The admin console: accounts, and nothing else.
 *
 * Kept separate from the teacher console because the work is different in kind
 * — this is where the hierarchy itself is built, and it is the only place a
 * manager or teacher can be created. An admin still has the teacher console
 * available from the sidebar, since they can author and read everything too,
 * and that is where the AI prompt is edited. It used to be mirrored here as
 * well; one setting reachable from two places is one setting too many.
 */
export default function AdminLayout() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()

  return (
    <div className="cs">
      <nav className="cs-nav" aria-label="Admin sections">
        <Link className="cs-brand" to="/admin">
          <p className="eyebrow">Administrator</p>
          <h1 className="cs-brand-name">Feedback Evaluator</h1>
        </Link>

        <ul className="cs-links">
          <li>
            <NavLink className="cs-link" to="/admin" end>
              People
            </NavLink>
          </li>
          <li>
            <NavLink className="cs-link" to="/teacher">
              Teacher console →
            </NavLink>
          </li>
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
