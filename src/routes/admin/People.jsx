import { useMemo, useState } from 'react'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { roleStringKey, useI18n } from '../../lib/i18n'
import { useAsync } from '../../lib/useAsync'
import { MANAGEABLE, PARENT } from '../../../shared/roles'
import { MIN_PASSWORD_LENGTH } from '../../../shared/password'

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
 * get an account at all and start an activity anonymously instead.
 */

/** `'admin'` → `people.blurbAdmin`, the line under the role picker. */
const blurbKey = (role) => `people.blurb${role.charAt(0).toUpperCase()}${role.slice(1)}`

export default function People() {
  const { user: actor } = useAuth()
  const { lang, t } = useI18n()
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
      setNotice({ tone: 'good', text: t('people.created', { name: made.name }) })
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
    const next = window.prompt(t('people.resetPrompt', { name: target.name }))
    if (!next) return
    await act(
      () => api.resetPassword(target.id, next),
      t('people.resetDone', { name: target.name }),
    )
  }

  return (
    <>
      <header className="cs-head">
        <div>
          <p className="eyebrow">{t('people.eyebrow')}</p>
          <h1 className="cs-title">{t('people.title')}</h1>
          <p className="cs-lede">{t('people.lede')}</p>
        </div>
      </header>

      {notice ? (
        <p className="cs-note" data-tone={notice.tone} role="alert">
          {notice.text}
        </p>
      ) : null}

      <section className="cs-card" style={{ marginTop: 'var(--s-4)' }}>
        <h2 className="cs-section-head">{t('people.add')}</h2>

        <form className="cs-form" onSubmit={create}>
          <div className="cs-row">
            <div className="cs-field">
              <label className="cs-label" htmlFor="role">
                {t('people.role')}
              </label>
              <select
                id="role"
                className="cs-select"
                value={form.role}
                onChange={(event) => set({ role: event.target.value, parentId: '' })}
              >
                {creatable.map((role) => (
                  <option key={role} value={role}>
                    {t(roleStringKey(role))}
                  </option>
                ))}
              </select>
              <p className="cs-hint">{t(blurbKey(form.role))}</p>
            </div>

            {parentSpec ? (
              <div className="cs-field">
                <label className="cs-label" htmlFor="parent">
                  {t(roleStringKey(parentSpec.role))}
                </label>
                <select
                  id="parent"
                  className="cs-select"
                  value={form.parentId}
                  onChange={(event) => set({ parentId: event.target.value })}
                >
                  <option value="">
                    {actor.role === 'admin'
                      ? t('people.unassigned')
                      : t('people.pickParent', { role: t(roleStringKey(parentSpec.role)) })}
                  </option>
                  {parentOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                </select>
                <p className="cs-hint">
                  {actor.role === 'admin'
                    ? t('people.parentHintAdmin')
                    : t('people.parentHint', {
                        parent: t(roleStringKey(parentSpec.role)),
                        role: t(roleStringKey(form.role)),
                      })}
                </p>
              </div>
            ) : null}
          </div>

          <div className="cs-row">
            <div className="cs-field">
              <label className="cs-label" htmlFor="name">
                {t('people.name')}
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
                {t('people.email')}
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
                {t('people.password')}
              </label>
              <input
                id="new-password"
                className="cs-input"
                type="text"
                required
                minLength={MIN_PASSWORD_LENGTH}
                value={form.password}
                onChange={(event) => set({ password: event.target.value })}
              />
              <p className="cs-hint">
                {t('people.passwordHint', { min: MIN_PASSWORD_LENGTH })}
              </p>
            </div>
          </div>

          <div>
            <button type="submit" className="cs-btn cs-btn-primary" disabled={busy}>
              {busy
                ? t('people.creating')
                : t('people.create', { role: t(roleStringKey(form.role)) })}
            </button>
          </div>
        </form>
      </section>

      <section className="cs-section">
        <h2 className="cs-section-head">
          {t('people.everyone')} <span className="mono cs-hint">({users.length})</span>
        </h2>

        {error ? (
          <p className="cs-note" data-tone="bad">
            {error.message}
          </p>
        ) : loading ? (
          <p className="cs-note">{t('common.loading')}</p>
        ) : (
          <div className="cs-scroll-x">
            <table className="cs-table">
              <thead>
                <tr>
                  <th>{t('people.thName')}</th>
                  <th>{t('people.thRole')}</th>
                  <th>{t('people.thEmail')}</th>
                  <th>{t('people.thReportsTo')}</th>
                  <th>{t('people.thLastSeen')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {users.map((entry) => (
                  <tr key={entry.id}>
                    <td>
                      {entry.name}
                      {entry.id === actor.id ? (
                        <span className="cs-hint"> · {t('people.you')}</span>
                      ) : null}
                      {!entry.active ? (
                        <>
                          {' '}
                          <span className="cs-pill" data-tone="quiet">
                            {t('people.inactive')}
                          </span>
                        </>
                      ) : null}
                    </td>
                    <td>
                      <span className="cs-pill" data-tone={entry.role === 'admin' ? 'live' : 'quiet'}>
                        {t(roleStringKey(entry.role))}
                      </span>
                    </td>
                    <td className="mono">{entry.email}</td>
                    <td>{nameOf(entry.managerId ?? entry.teacherId)}</td>
                    <td className="mono">
                      {entry.lastLoginAt
                        ? new Date(entry.lastLoginAt).toLocaleDateString(lang)
                        : t('people.never')}
                    </td>
                    <td>
                      <div className="cs-actions">
                        <button
                          type="button"
                          className="cs-btn cs-btn-sm"
                          onClick={() => resetFor(entry)}
                        >
                          {t('people.reset')}
                        </button>
                        <button
                          type="button"
                          className="cs-btn cs-btn-sm"
                          disabled={entry.id === actor.id}
                          onClick={() =>
                            act(
                              () => api.updateUser(entry.id, { active: !entry.active }),
                              entry.active
                                ? t('people.nowInactive', { name: entry.name })
                                : t('people.nowActive', { name: entry.name }),
                            )
                          }
                        >
                          {entry.active ? t('people.deactivate') : t('people.reactivate')}
                        </button>
                        <button
                          type="button"
                          className="cs-btn cs-btn-sm cs-btn-danger"
                          disabled={entry.id === actor.id}
                          onClick={() =>
                            act(() => api.deleteUser(entry.id), t('people.deleted', { name: entry.name }))
                          }
                        >
                          {t('people.delete')}
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
