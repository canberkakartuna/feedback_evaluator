/**
 * The four kinds of user, and the shape of the hierarchy between them.
 *
 * This file is the single written-down source of that shape. It is in shared/
 * because the client needs the same answers to decide what to render, but the
 * client's copy is a courtesy: every rule here is enforced again server-side in
 * services/users.js, which is the only place it actually holds.
 *
 *   admin    sees and does everything
 *   manager  has many teachers, and through them their students
 *   teacher  has many students
 *   student  sees only themselves
 *
 * The hierarchy is stored as a **pointer from child to parent** — a student
 * holds `teacherId`, a teacher holds `managerId`. One source of truth per edge,
 * so moving a student between teachers is a single write that cannot half-fail
 * and leave them on two rosters.
 */

export const ROLES = ['admin', 'manager', 'teacher', 'student']

export const isRole = (value) => ROLES.includes(value)

/**
 * Only used to compare two roles head-to-head. It is not a permission model on
 * its own — outranking someone is necessary to act on them, never sufficient,
 * because scope (see below) still has to put them in reach.
 */
export const ROLE_RANK = { student: 0, teacher: 1, manager: 2, admin: 3 }

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
 * administers nobody — they can still edit their own name and password, which
 * is a different path (`isSelf`) and not a permission over anyone.
 */
export const MANAGEABLE = {
  admin: ['admin', 'manager', 'teacher', 'student'],
  manager: ['teacher', 'student'],
  teacher: ['student'],
  student: [],
}

export const canManageRole = (actorRole, targetRole) =>
  (MANAGEABLE[actorRole] ?? []).includes(targetRole)

/** Roles that can see more than themselves — i.e. have a roster worth listing. */
export const canListOthers = (role) => (MANAGEABLE[role] ?? []).length > 0
