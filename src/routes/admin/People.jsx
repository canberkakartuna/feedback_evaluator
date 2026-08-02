import { useMemo, useState } from 'react'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { useAsync } from '../../lib/useAsync'
import { MANAGEABLE, PARENT } from '../../../shared/roles'

/**
 * Accounts, and the hierarchy between them.
 *
 * There is no sign-up anywhere in this application, so this screen is the only
 * way a manager or a teacher comes into existence. Accounts are created
 * downwards — an admin makes managers and teachers, a teacher makes their own
 * students — and the form reflects that by offering only the roles the signed-in
 * user may actually create. Every one of those rules is enforced again in
 * services/users.js, which is the copy that holds; this just avoids offering
 * something that would be refused.
 *
 * Students can be created here too, but usually are not: most students never
 * get an account at all and join an activity with a code instead.
 */

const ROLE_BLURB = {
  admin: 'Everything, everywhere, including the dataset export.',
  manager: 'Their teachers, and those teachers’ students and activities.',
  teacher: 'Their own students, their own activities, their own transcripts.',
  student: 'Only themselves. Most students need no account — they join by code.',
}

export default function People() {
  const { user: actor } = useAuth()
  const { data, error, loading, reload } = useAsync(() => api.users(), [])

  const [form, setForm] = useState({
    role: 'teacher',
    name: '',
    email: '',
    password: '',
    parentId: '',
  })
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(null)

  // Memoised so the lookups below actually cache — see the same note in
  // routes/student/Session.jsx.
  const users = useMemo(() => data?.users ?? [], [data])
  const creatable = MANAGEABLE[actor.role] ?? []
  const parentSpec = PARENT[form.role]

  const parentOptions = useMemo(
    () => users.filter((entry) => entry.role === parentSpec?.role && entry.active),
    [parentSpec, users],
  )

  const nameOf = useMemo(() => {
    const map = new Map(users.map((entry) => [entry.id, entry.name]))
    return (id) => (id ? (map.get(id) ?? '—') : '—')
  }, [users])

  const set = (fields) => setForm((prev) => ({ ...prev, ...fields }))

  const create = async (event) => {
    event.preventDefault()
    setBusy(true)
    setNotice(null)

    try {
      const body = {
        role: form.role,
        name: form.name,
        email: form.email,
        password: form.password,
      }
      if (parentSpec && form.parentId) body[parentSpec.field] = form.parentId

      const { user: made } = await api.createUser(body)
      setForm({ role: form.role, name: '', email: '', password: '', parentId: '' })
      setNotice({ tone: 'good', text: `Created ${made.name}. Give them the password you just set.` })
      await reload()
    } catch (failure) {
      setNotice({ tone: 'bad', text: failure.message })
    } finally {
      setBusy(false)
    }
  }

  const act = async (work, success) => {
    setNotice(null)
    try {
      await work()
      if (success) setNotice({ tone: 'good', text: success })
      await reload()
    } catch (failure) {
      setNotice({
        tone: 'bad',
        text: failure.details?.children
          ? `${failure.message}: ${failure.details.children.map((child) => child.name ?? child.id).join(', ')}`
          : failure.message,
      })
    }
  }

  const resetFor = async (target) => {
    const next = window.prompt(`New password for ${target.name}`)
    if (!next) return
    await act(
      () => api.resetPassword(target.id, next),
      `Password reset for ${target.name}. They have been signed out everywhere.`,
    )
  }

  return (
    <>
      <header className="cs-head">
        <div>
          <p className="eyebrow">Accounts</p>
          <h1 className="cs-title">People</h1>
          <p className="cs-lede">
            There is no public sign-up. Accounts are created here, downwards through the hierarchy —
            an administrator adds managers and teachers, and a teacher adds their own students.
          </p>
        </div>
      </header>

      {notice ? (
        <p className="cs-note" data-tone={notice.tone} role="alert">
          {notice.text}
        </p>
      ) : null}

      <section className="cs-card" style={{ marginTop: 'var(--s-4)' }}>
        <h2 className="cs-section-head">Add someone</h2>

        <form className="cs-form" onSubmit={create}>
          <div className="cs-row">
            <div className="cs-field">
              <label className="cs-label" htmlFor="role">
                Role
              </label>
              <select
                id="role"
                className="cs-select"
                value={form.role}
                onChange={(event) => set({ role: event.target.value, parentId: '' })}
              >
                {creatable.map((role) => (
                  <option key={role} value={role}>
                    {role}
                  </option>
                ))}
              </select>
              <p className="cs-hint">{ROLE_BLURB[form.role]}</p>
            </div>

            {parentSpec ? (
              <div className="cs-field">
                <label className="cs-label" htmlFor="parent">
                  {parentSpec.role}
                </label>
                <select
                  id="parent"
                  className="cs-select"
                  value={form.parentId}
                  onChange={(event) => set({ parentId: event.target.value })}
                >
                  <option value="">
                    {actor.role === 'admin' ? 'Unassigned' : `— pick a ${parentSpec.role} —`}
                  </option>
                  {parentOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                </select>
                <p className="cs-hint">
                  {actor.role === 'admin'
                    ? 'May be left unassigned and set later.'
                    : `Which ${parentSpec.role} this ${form.role} belongs to.`}
                </p>
              </div>
            ) : null}
          </div>

          <div className="cs-row">
            <div className="cs-field">
              <label className="cs-label" htmlFor="name">
                Name
              </label>
              <input
                id="name"
                className="cs-input"
                required
                value={form.name}
                onChange={(event) => set({ name: event.target.value })}
              />
            </div>

            <div className="cs-field">
              <label className="cs-label" htmlFor="new-email">
                Email
              </label>
              <input
                id="new-email"
                className="cs-input"
                type="email"
                required
                value={form.email}
                onChange={(event) => set({ email: event.target.value })}
              />
            </div>

            <div className="cs-field">
              <label className="cs-label" htmlFor="new-password">
                Password
              </label>
              <input
                id="new-password"
                className="cs-input"
                type="text"
                required
                minLength={12}
                value={form.password}
                onChange={(event) => set({ password: event.target.value })}
              />
              <p className="cs-hint">At least 12 characters. Shown so you can pass it on.</p>
            </div>
          </div>

          <div>
            <button type="submit" className="cs-btn cs-btn-primary" disabled={busy}>
              {busy ? 'Creating…' : `Create ${form.role}`}
            </button>
          </div>
        </form>
      </section>

      <section className="cs-section">
        <h2 className="cs-section-head">
          Everyone <span className="mono cs-hint">({users.length})</span>
        </h2>

        {error ? (
          <p className="cs-note" data-tone="bad">
            {error.message}
          </p>
        ) : loading ? (
          <p className="cs-note">Loading…</p>
        ) : (
          <div className="cs-scroll-x">
            <table className="cs-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Role</th>
                  <th>Email</th>
                  <th>Reports to</th>
                  <th>Last seen</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {users.map((entry) => (
                  <tr key={entry.id}>
                    <td>
                      {entry.name}
                      {entry.id === actor.id ? <span className="cs-hint"> · you</span> : null}
                      {!entry.active ? (
                        <>
                          {' '}
                          <span className="cs-pill" data-tone="quiet">
                            inactive
                          </span>
                        </>
                      ) : null}
                    </td>
                    <td>
                      <span className="cs-pill" data-tone={entry.role === 'admin' ? 'live' : 'quiet'}>
                        {entry.role}
                      </span>
                    </td>
                    <td className="mono">{entry.email}</td>
                    <td>{nameOf(entry.managerId ?? entry.teacherId)}</td>
                    <td className="mono">
                      {entry.lastLoginAt
                        ? new Date(entry.lastLoginAt).toLocaleDateString()
                        : 'never'}
                    </td>
                    <td>
                      <div className="cs-actions">
                        <button
                          type="button"
                          className="cs-btn cs-btn-sm"
                          onClick={() => resetFor(entry)}
                        >
                          Reset password
                        </button>
                        <button
                          type="button"
                          className="cs-btn cs-btn-sm"
                          disabled={entry.id === actor.id}
                          onClick={() =>
                            act(
                              () => api.updateUser(entry.id, { active: !entry.active }),
                              `${entry.name} is now ${entry.active ? 'inactive' : 'active'}.`,
                            )
                          }
                        >
                          {entry.active ? 'Deactivate' : 'Reactivate'}
                        </button>
                        <button
                          type="button"
                          className="cs-btn cs-btn-sm cs-btn-danger"
                          disabled={entry.id === actor.id}
                          onClick={() =>
                            act(() => api.deleteUser(entry.id), `${entry.name} deleted.`)
                          }
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  )
}
