import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AuthProvider, homeFor, useAuth } from './lib/auth'
import { useT } from './lib/i18n'
import ConsentScreen from './components/ConsentScreen'
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
 *   /            students — pick from a list
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

/**
 * Shown in place of the whole app — every route, student or staff — to any
 * signed-in account that has not yet agreed to the research notice. Admins
 * are the one exception: see shared/roles.js and services/users.js for why
 * consent is a per-account record rather than a per-role one, which is what
 * lets this gate be a single role check rather than a list of routes to wrap.
 *
 * Sitting above <Routes> rather than inside Guard is the point: a teacher who
 * has not consented must not reach /teacher, and a student with an account
 * must not reach / either, without either becoming a special case in two
 * different places. Anonymous visitors (`user` is null) and admins pass
 * straight through, unchanged.
 */
function ConsentGate({ children }) {
  const { user, ready } = useAuth()

  if (ready && user && user.role !== 'admin' && !user.consented) {
    return <ConsentScreen />
  }

  return children
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ConsentGate>
          <Routes>
            {/**
             * **One** StudentLayout over every entry screen. Because these are
             * sibling children of a single parent route, the layout element stays
             * mounted as they navigate between them — so a student who has already
             * given a nickname on the list screen and then presses "Class code" is
             * not asked for one a second time in the same visit.
             *
             * Declaring it twice, once per branch, is what caused exactly that:
             * two elements, two pieces of state.
             *
             * /join has both spellings because a code is read out as often as it
             * is clicked: /join asks for one, /join/ABC234 resolves it.
             */}
            <Route element={<StudentLayout />}>
              <Route path="/" element={<StudentEntry />} />
              <Route path="/join" element={<Join />} />
              <Route path="/join/:code" element={<Join />} />
            </Route>

            {/* Outside the layout on purpose: the workspace itself has nothing to
                do with who is entering the student side, only with the session
                that was already created. */}
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
        </ConsentGate>
      </AuthProvider>
    </BrowserRouter>
  )
}
