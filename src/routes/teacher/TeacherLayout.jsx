import { Link, NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../../lib/auth'
import { roleStringKey, useT } from '../../lib/i18n'
import TopBar from '../../components/TopBar'
import '../console.css'

const LINKS = [
  { to: '/teacher', end: true, key: 'teacher.activities' },
  { to: '/teacher/students', key: 'teacher.studentWork' },
  { to: '/teacher/labelling', key: 'teacher.labelling' },
]

/**
 * The teacher console: build the work, watch it being done, then read it back.
 *
 * Managers land here too rather than getting a console of their own — their job
 * is the same job over a wider roster, and every screen inside is already
 * scoped by the server. An admin can reach it as well, which is how they check
 * a teacher's setup without needing a second account.
 *
 * The bar at the foot of the sidebar is the same component the student screens
 * carry, so "home", "sign out" and the language switch are in one place and
 * behave the same way everywhere. Home is the *student* view — a teacher's most
 * common reason to leave this console is to look at what their class sees.
 */
export default function TeacherLayout() {
  const { user } = useAuth()
  const t = useT()

  return (
    <div className="cs">
      <nav className="cs-nav" aria-label={t('teacher.sections')}>
        <Link className="cs-brand" to="/teacher">
          <p className="eyebrow">{t('teacher.eyebrow')}</p>
          <h1 className="cs-brand-name">Dropshot</h1>
        </Link>

        <ul className="cs-links">
          {LINKS.map((link) => (
            <li key={link.to}>
              <NavLink className="cs-link" to={link.to} end={link.end}>
                {t(link.key)}
              </NavLink>
            </li>
          ))}
          {user.role === 'admin' ? (
            <li>
              <NavLink className="cs-link" to="/admin">
                {t('teacher.accounts')}
              </NavLink>
            </li>
          ) : null}
        </ul>

        <div className="cs-who">
          <p className="cs-who-name">{user.name}</p>
          <p className="cs-who-role eyebrow">{t(roleStringKey(user.role))}</p>
          {/* No "Student view" button any more: / is not a place staff can go,
              and TopBar leaves Home out for them. */}
          <TopBar layout="stack" who={false} console={false} signOutTo="/signin" />
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
