import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../../lib/auth'
import { roleStringKey, useT } from '../../lib/i18n'
import Navbar from '../../components/Navbar'
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
 * The navbar above is the same component every screen in the app carries, so
 * "home", "sign out" and the language switch are in one place and behave the
 * same way everywhere. Home is the *student* view — a teacher's most common
 * reason to leave this console is to look at what their class sees. The
 * sidebar underneath it is this console's own: section links, and who is
 * signed in.
 */
export default function TeacherLayout() {
  const { user } = useAuth()
  const t = useT()

  return (
    <>
      {/* who: false — the sidebar's own name-and-role block already says who
          this is, and console: false — pointless in the console it names. */}
      <Navbar who={false} console={false} signOutTo="/signin" />

      <div className="cs">
        <nav className="cs-nav" aria-label={t('teacher.sections')}>
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
          </div>
        </nav>

        <main className="cs-main">
          <div className="cs-wrap">
            <Outlet />
          </div>
        </main>
      </div>
    </>
  )
}
