import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AuthProvider, homeFor, useAuth } from './lib/auth'
import { useT } from './lib/i18n'
import SignIn from './routes/SignIn'
import StudentLayout from './routes/student/StudentLayout'
import StudentEntry from './routes/student/StudentEntry'
import Join from './routes/student/Join'
import Session from './routes/student/Session'
import TeacherLayout from './routes/teacher/TeacherLayout'
import Activities from './routes/teacher/Activities'
import ActivityEditor from './routes/teacher/ActivityEditor'
import Roster from './routes/teacher/Roster'
import StudentWork from './routes/teacher/StudentWork'
import Labelling from './routes/teacher/Labelling'
import AdminLayout from './routes/admin/AdminLayout'
import People from './routes/admin/People'

/**
 * Three audiences on one deployment, told apart by role.
 *
 *   /            students — consent, then pick from a list
 *   /join        the same, reached by a class code (/join/:code resolves one)
 *   /work/:id    the workspace itself
 *   /teacher     authoring, rosters, transcripts, labelling
 *   /admin       accounts
 *
 * The student half is deliberately reachable with no account at all, which is
 * why the guard below is only ever wrapped around the two consoles. Everything
 * under `/` must keep working for someone who has never signed in.
 */
function Guard({ roles, children }) {
  const { user, ready } = useAuth()
  const location = useLocation()

  // Nothing is decided until the first `me` call settles, or a teacher pressing
  // refresh would be bounced to the sign-in screen and back.
  if (!ready) return <Splash />

  if (!user) return <Navigate to="/signin" replace state={{ from: location.pathname }} />

  // Signed in but wrong console: send them to their own rather than to sign-in,
  // which they would read as "my password stopped working".
  if (!roles.includes(user.role)) return <Navigate to={homeFor(user)} replace />

  return children
}

function Splash() {
  const t = useT()

  return (
    <main className="splash">
      <p className="eyebrow">{t('app.loading')}</p>
    </main>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/**
           * **One** StudentLayout over every entry screen, and that is the whole
           * point of it: the consent notice is shown on the way *into* the
           * student side, not on the way into each screen. Because these are
           * sibling children of a single parent route, the layout element stays
           * mounted as they navigate between them — so a student who agrees on
           * the list screen and then presses "Class code" is not asked a second
           * time for the same visit.
           *
           * Declaring it twice, once per branch, is what caused exactly that:
           * two elements, two pieces of state, two notices.
           *
           * /join has both spellings because a code is read out as often as it
           * is clicked: /join asks for one, /join/ABC234 resolves it.
           */}
          <Route element={<StudentLayout />}>
            <Route path="/" element={<StudentEntry />} />
            <Route path="/join" element={<Join />} />
            <Route path="/join/:code" element={<Join />} />
          </Route>

          {/* Outside the layout on purpose: this session's consent was recorded
              when it was created, so asking again on every reload would be
              asking a question that has an answer. */}
          <Route path="/work/:sessionId" element={<Session />} />
          <Route path="/signin" element={<SignIn />} />

          <Route
            path="/teacher"
            element={
              <Guard roles={['teacher', 'manager', 'admin']}>
                <TeacherLayout />
              </Guard>
            }
          >
            <Route index element={<Activities />} />
            <Route path="activities/:activityId" element={<ActivityEditor />} />
            <Route path="students" element={<Roster />} />
            <Route path="students/:sessionId" element={<StudentWork />} />
            <Route path="labelling" element={<Labelling />} />
          </Route>

          <Route
            path="/admin"
            element={
              <Guard roles={['admin']}>
                <AdminLayout />
              </Guard>
            }
          >
            {/* Accounts only. The AI prompt lives in the teacher console,
                which is where the brief puts it and where an admin can still
                reach it from the sidebar. */}
            <Route index element={<People />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
