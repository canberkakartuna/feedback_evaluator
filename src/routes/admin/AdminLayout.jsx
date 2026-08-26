import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../../lib/auth'
import { roleStringKey, useT } from '../../lib/i18n'
import Navbar from '../../components/Navbar'
import '../console.css'

/**
 * The admin console: accounts, and nothing else.
 *
 * Kept separate from the teacher console because the work is different in kind
 * — this is where the hierarchy itself is built, and it is the only place a
 * manager or teacher can be created. An admin still has the teacher console
 * available from the sidebar, since they can author and read everything too.
 *
 * The AI prompt is not edited from either console. It is versioned server-side
 * and set outside the app, so no teacher can quietly change the feedback every
 * other teacher's students receive.
 */
export default function AdminLayout() {
  const { user } = useAuth()
  const t = useT()

  return (
    <>
      {/* who: false — the sidebar's own name-and-role block already says who
          this is, and console: false — pointless in the console it names. */}
      <Navbar who={false} console={false} signOutTo="/signin" />

      <div className="cs">
        <nav className="cs-nav" aria-label={t('admin.sections')}>
          <ul className="cs-links">
            <li>
              <NavLink className="cs-link" to="/admin" end>
                {t('admin.people')}
              </NavLink>
            </li>
            <li>
              <NavLink className="cs-link" to="/teacher">
                {t('admin.teacherConsole')}
              </NavLink>
            </li>
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
