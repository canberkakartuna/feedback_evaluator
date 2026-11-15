/**
 * The five kinds of user, and the shape of the hierarchy between them.
 *
 * This file is the single written-down source of that shape. It is in shared/
 * because the client needs the same answers to decide what to render, but the
 * client's copy is a courtesy: every rule here is enforced again server-side in
 * services/users.js, which is the only place it actually holds.
 *
 *   admin      sees and does everything
 *   manager    has many teachers, and through them their students
 *   annotator  labels the snippets assigned to them, and nothing else
 *   teacher    has many students
 *   student    sees only themselves
 *
 * An annotator sits outside the tree: no parent, no roster, nobody under them.
 * They are brought in to label transcripts, so what they can reach is decided
 * per snippet by an assignment (routes/research.js), not by the hierarchy.
 * Only an admin creates or administers one.
 *
 * The hierarchy is stored as a **pointer from child to parent** — a student
 * holds `teacherId`, a teacher holds `managerId`. One source of truth per edge,
 * so moving a student between teachers is a single write that cannot half-fail
 * and leave them on two rosters.
 */

export const ROLES = ['admin', 'manager', 'annotator', 'teacher', 'student']

export const isRole = (value) => ROLES.includes(value)

/**
 * Only used to compare two roles head-to-head. It is not a permission model on
 * its own — outranking someone is necessary to act on them, never sufficient,
 * because scope (see below) still has to put them in reach.
 */
export const ROLE_RANK = { student: 0, annotator: 0, teacher: 1, manager: 2, admin: 3 }

/**
 * Which field on a child points at its parent, and what that parent must be.
 * `null` means the role sits at the top and has no parent.
 *
 * Because a child's parent role is fixed by its own role, a cycle is not
 * expressible: a student can only ever point at a teacher, a teacher only ever
 * at a manager. No cycle check is needed anywhere.
 */
export const PARENT = {
  admin: null,
  manager: null,
  annotator: null,
  teacher: { role: 'manager', field: 'managerId' },
  student: { role: 'teacher', field: 'teacherId' },
}

/** Every parent-pointer field, for stripping them off roles that have none. */
export const PARENT_FIELDS = ['teacherId', 'managerId']

export const parentRole = (role) => PARENT[role]?.role ?? null
export const parentField = (role) => PARENT[role]?.field ?? null

/**
 * Roles each role may create and administer.
 *
 * A manager may create teachers and the students under them, but not another
 * manager: staffing the layer you sit in is an admin decision. A student
 * administers nobody — they can still edit their own name, which is a
 * different path (`isSelf`) and not a permission over anyone. Nor does an
 * annotator; and a manager does not administer annotators either, since an
 * annotator belongs to no manager's branch of the tree.
 */
export const MANAGEABLE = {
  admin: ['admin', 'manager', 'annotator', 'teacher', 'student'],
  manager: ['teacher', 'student'],
  annotator: [],
  teacher: ['student'],
  student: [],
}

export const canManageRole = (actorRole, targetRole) =>
  (MANAGEABLE[actorRole] ?? []).includes(targetRole)

/** Roles that can see more than themselves — i.e. have a roster worth listing. */
export const canListOthers = (role) => (MANAGEABLE[role] ?? []).length > 0

/**
 * Staff: everyone who works *on* the study rather than being a subject of it.
 *
 * The distinction is not another permission level — it is who the research
 * consent notice is addressed to. A teacher opening their own activity to check
 * it is not a participant and is not asked to agree to have their conversations
 * recorded for research; a student is, every time. routes/sessions.js is where
 * that holds, and src/routes/student/StudentEntry.jsx is where it shows. An
 * annotator is staff in exactly the teacher's sense: they read the study's
 * data, they are not a subject of it.
 *
 * Being staff is not a permission to read anything. Every staff endpoint still
 * names the roles it serves, and an annotator is on none of those lists except
 * the labelling routes.
 */
export const STAFF_ROLES = ['teacher', 'manager', 'admin', 'annotator']

export const isStaff = (role) => STAFF_ROLES.includes(role)

/**
 * Whether a teacher may use the labelling screen — `canLabel` on the teacher's
 * account, which an admin or the teacher's manager switches. Absent means yes,
 * so every teacher created before the switch existed keeps labelling without a
 * migration. Only a teacher has the switch: an admin and a manager always
 * label, and an annotator's reach is their assignments, not this flag.
 */
export const teacherCanLabel = (user) => user?.role !== 'teacher' || user.canLabel !== false
