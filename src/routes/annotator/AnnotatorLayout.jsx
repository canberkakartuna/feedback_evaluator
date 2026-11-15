import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../../lib/auth'
import { roleStringKey, useT } from '../../lib/i18n'
import Navbar from '../../components/Navbar'
import '../console.css'

/**
 * The annotator console: the snippets assigned to them, and nothing else.
 *
 * Not TeacherLayout with links hidden. An annotator is outside the teacher
 * tree (shared/roles.js) and the server refuses them every other staff screen,
 * so the sidebar here has exactly one destination and there is no list of
 * conditions to keep in step with that refusal. The navbar above is the usual
 * one — language, profile, support, sign out — which is all the rest they get.
 */
export default function AnnotatorLayout() {
  const { user } = useAuth()
  const t = useT()

  return (
    <>
      {/* Same choices as the other consoles: the sidebar says who this is, and
          "My console" would point at the page already open. */}
      <Navbar who={false} console={false} signOutTo="/signin" />

      <div className="cs">
        <nav className="cs-nav" aria-label={t('annotator.sections')}>
          <ul className="cs-links">
            <li>
              <NavLink className="cs-link" to="/annotate" end>
                {t('teacher.labelling')}
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
