import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../../lib/auth'
import { isNavActive } from '../../lib/navActive'
import { roleStringKey, useT } from '../../lib/i18n'
import { teacherCanLabel } from '../../../shared/roles'
import Navbar from '../../components/Navbar'
import '../console.css'

const LINKS = [
  /**
   * The index tab: `end` so it is not current on every console page, and
   * `also` so editing or previewing an activity still reads as Activities.
   */
  { to: '/teacher', end: true, also: ['/teacher/activities'], key: 'teacher.activities' },
  { to: '/teacher/students', key: 'teacher.studentWork' },
  { to: '/teacher/class-list', key: 'teacher.classList' },
  /** Hidden for a teacher whose labelling an admin or manager switched off. */
  { to: '/teacher/labelling', key: 'teacher.labelling', shown: teacherCanLabel },
  { to: '/teacher/support', key: 'teacher.support' },
  /**
   * Their teachers: the labelling switch and the password reset. A teacher has
   * nobody at this level to manage, so the link is not drawn for them.
   */
  { to: '/teacher/teachers', key: 'teacher.teachers', shown: (user) => user.role !== 'teacher' },
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
  const { pathname } = useLocation()

  return (
    <>
      {/* who: false — the sidebar's own name-and-role block already says who
          this is, and console: false — pointless in the console it names. */}
      <Navbar who={false} console={false} signOutTo="/signin" />

      <div className="cs">
        <nav className="cs-nav" aria-label={t('teacher.sections')}>
          <ul className="cs-links">
            {LINKS.filter((link) => !link.shown || link.shown(user)).map((link) => (
              <li key={link.to}>
                {/* Link rather than NavLink: NavLink cannot mark the /teacher
                    index current on /teacher/activities/… as well. */}
                <Link
                  className="cs-link"
                  to={link.to}
                  aria-current={isNavActive(pathname, link) ? 'page' : undefined}
                >
                  {t(link.key)}
                </Link>
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
