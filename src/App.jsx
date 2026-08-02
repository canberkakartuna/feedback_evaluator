import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AuthProvider, homeFor, useAuth } from './lib/auth'
import SignIn from './routes/SignIn'
import StudentEntry from './routes/student/StudentEntry'
import Session from './routes/student/Session'
import TeacherLayout from './routes/teacher/TeacherLayout'
import Activities from './routes/teacher/Activities'
import ActivityEditor from './routes/teacher/ActivityEditor'
import Roster from './routes/teacher/Roster'
import StudentWork from './routes/teacher/StudentWork'
import Labelling from './routes/teacher/Labelling'
import SystemPrompt from './routes/teacher/SystemPrompt'
import AdminLayout from './routes/admin/AdminLayout'
import People from './routes/admin/People'

/**
 * Three audiences on one deployment, told apart by role.
 *
 *   /            students — consent, then join a code or pick from a list
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
  return (
    <main className="splash">
      <p className="eyebrow">Loading</p>
    </main>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<StudentEntry />} />
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
            <Route path="prompt" element={<SystemPrompt />} />
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
