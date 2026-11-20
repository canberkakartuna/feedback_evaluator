import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import { homeFor, useAuth } from "./lib/auth";
import { AuthProvider } from "./lib/AuthProvider";
import { useT } from "./lib/i18n";
import ConsentScreen from "./components/ConsentScreen";
import { needsConsent } from "./lib/consentSteps";
import Profile from "./routes/Profile";
import SignIn from "./routes/SignIn";
import Support from "./routes/Support";
import StudentLayout from "./routes/student/StudentLayout";
import StudentEntry from "./routes/student/StudentEntry";
import Join from "./routes/student/Join";
import Session from "./routes/student/Session";
import TeacherLayout from "./routes/teacher/TeacherLayout";
import Activities from "./routes/teacher/Activities";
import ActivityEditor from "./routes/teacher/ActivityEditor";
import Roster from "./routes/teacher/Roster";
import ClassList from "./routes/teacher/ClassList";
import PreviewActivity from "./routes/teacher/PreviewActivity";
import StudentWork from "./routes/teacher/StudentWork";
import Labelling from "./routes/teacher/Labelling";
import Selection from "./routes/teacher/Selection";
import SelectionStudent from "./routes/teacher/SelectionStudent";
import SupportInbox from "./routes/teacher/SupportInbox";
import Teachers from "./routes/teacher/Teachers";
import AnnotatorLayout from "./routes/annotator/AnnotatorLayout";
import AdminLayout from "./routes/admin/AdminLayout";
import People from "./routes/admin/People";
import Datasets from "./routes/admin/Datasets";

/**
 * test
 * Three audiences on one deployment, told apart by role.
 *
 *   /            students — pick from a list
 *   /join        the same, reached by a class code (/join/:code resolves one)
 *   /work/:id    the workspace itself
 *   /signin      everyone else with an account: email and password
 *   /teacher     authoring, rosters, transcripts, labelling
 *   /annotate    an annotator's labelling screen, and nothing else
 *   /admin       accounts
 *
 * The student half is deliberately reachable with no account at all, which is
 * why the guard below is only ever wrapped around the two consoles. Everything
 * under `/` must keep working for someone who has never signed in.
 */
function Guard({ roles, children }) {
  const { user, ready } = useAuth();
  const location = useLocation();

  // Nothing is decided until the first `me` call settles, or a teacher pressing
  // refresh would be bounced to the sign-in screen and back.
  if (!ready) return <Splash />;

  if (!user)
    return (
      <Navigate to="/signin" replace state={{ from: location.pathname }} />
    );

  // Signed in but wrong console: send them to their own rather than to sign-in,
  // which they would read as "my password stopped working".
  if (!roles.includes(user.role))
    return <Navigate to={homeFor(user)} replace />;

  return children;
}

function Splash() {
  const t = useT();

  return (
    <main className="splash">
      <p className="eyebrow">{t("app.loading")}</p>
    </main>
  );
}

/**
 * Shown in place of the whole app — every route — to any signed-in student
 * who has not yet agreed to the research notice. Only students are asked:
 * staff (teacher, manager, annotator, admin) are not subjects of the study and
 * go straight in — see `needsConsent` in lib/consentSteps.js, the one place
 * that rule lives.
 *
 * Sitting above <Routes> rather than inside Guard is the point: a student with
 * an account must not reach any route before agreeing, without that becoming a
 * special case in several places. Anonymous visitors (`user` is null) and staff
 * pass straight through, unchanged.
 */
function ConsentGate({ children }) {
  const { user, ready } = useAuth();

  // A student who withdrew from the profile carries on without being asked
  // again: withdrawing takes them out of the study, not out of the system.
  if (ready && needsConsent(user)) {
    return <ConsentScreen />;
  }

  return children;
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
            <Route path="/profil" element={<Profile />} />
            <Route path="/support" element={<Support />} />

            <Route
              path="/teacher"
              element={
                <Guard roles={["teacher", "manager", "admin"]}>
                  <TeacherLayout />
                </Guard>
              }
            >
              <Route index element={<Activities />} />
              <Route
                path="activities/:activityId"
                element={<ActivityEditor />}
              />
              <Route
                path="activities/:activityId/preview"
                element={<PreviewActivity />}
              />
              <Route path="students" element={<Roster />} />
              <Route path="class-list" element={<ClassList />} />
              <Route path="students/:sessionId" element={<StudentWork />} />
              <Route path="labelling" element={<Labelling />} />
              {/* Picking dialogs into a dataset, student by student. */}
              <Route path="selection" element={<Selection />} />
              <Route
                path="selection/:studentKey"
                element={<SelectionStudent />}
              />
              <Route path="support" element={<SupportInbox />} />
              {/* A manager's or admin's teachers, with the labelling switch and
                  the password reset. Teachers are sent back by the page. */}
              <Route path="teachers" element={<Teachers />} />
            </Route>

            {/* The annotator's console is the labelling screen alone. Its own
                guard, so every other console URL bounces them to here (Guard
                sends a wrong role to homeFor), and its own layout, so no nav
                item leads to a page the server would refuse them. */}
            <Route
              path="/annotate"
              element={
                <Guard roles={["annotator"]}>
                  <AnnotatorLayout />
                </Guard>
              }
            >
              <Route index element={<Labelling />} />
            </Route>

            <Route
              path="/admin"
              element={
                <Guard roles={["admin"]}>
                  <AdminLayout />
                </Guard>
              }
            >
              {/* Accounts only. The AI prompt lives in the teacher console,
                  which is where the brief puts it and where an admin can still
                  reach it from the sidebar. */}
              <Route index element={<People />} />
              <Route path="datasets" element={<Datasets />} />
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </ConsentGate>
      </AuthProvider>
    </BrowserRouter>
  );
}
