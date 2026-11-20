import { useMemo, useState } from 'react'
import { api } from '../../lib/api'
import { datasetName } from '../../lib/datasets'
import { roleStringKey, useI18n } from '../../lib/i18n'
import { useAsync } from '../../lib/useAsync'

/**
 * Datasets, and who labels each one.
 *
 * An admin makes as many datasets as the study needs, names and describes
 * them, and assigns each to any number of teachers and annotators — who then
 * see that dataset, and only the datasets assigned to them, on their labelling
 * screen. Dialogs are put into a dataset from the selection screen in the
 * teacher console, by whoever picks them.
 *
 * Nothing here destroys research data. Taking someone off a dataset keeps the
 * labels they made. A dataset with dialogs in it is archived rather than
 * deleted — the server refuses to delete it — and only an empty one can go.
 * The default dataset (everything kept before datasets existed) can be renamed
 * but neither archived nor deleted. Deleting asks first, on the page.
 */
export default function Datasets() {
  const { lang, t } = useI18n()
  const { data, error, loading, setData } = useAsync(() => api.datasets(), [])
  const people = useAsync(
    () => Promise.all([api.users({ role: 'teacher' }), api.users({ role: 'annotator' })]),
    [],
  )

  const [form, setForm] = useState({ name: '', description: '' })
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(null)
  /** The dataset being renamed: `{ id, name, description }`. */
  const [editing, setEditing] = useState(null)
  /** The dataset whose delete is waiting for a second press. */
  const [confirming, setConfirming] = useState(null)
  /** Per dataset, the account picked in its "assign" select. */
  const [picked, setPicked] = useState({})

  const datasets = data?.datasets ?? []
  const labellers = useMemo(
    () =>
      (people.data ?? [])
        .flatMap((result) => result.users ?? [])
        .filter((entry) => entry.active)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [people.data],
  )

  const replace = (dataset) =>
    setData((prev) => prev && { ...prev, datasets: prev.datasets.map((row) => (row.id === dataset.id ? dataset : row)) })

  /** Runs one change, says how it went, and folds the answer in with `then`. */
  const act = async (work, success, then) => {
    setBusy(true)
    setNotice(null)
    try {
      const result = await work()
      then?.(result)
      if (success) setNotice({ tone: 'good', text: success })
    } catch (failure) {
      setNotice({ tone: 'bad', text: failure.message })
    } finally {
      setBusy(false)
    }
  }

  const create = (event) => {
    event.preventDefault()
    act(
      () => api.createDataset({ name: form.name, description: form.description }),
      t('datasets.created', { name: form.name.trim() }),
      (result) => {
        setData((prev) => prev && { ...prev, datasets: [...prev.datasets, result.dataset] })
        setForm({ name: '', description: '' })
      },
    )
  }

  const saveEdit = (event) => {
    event.preventDefault()
    act(
      () => api.updateDataset(editing.id, { name: editing.name, description: editing.description }),
      t('datasets.saved'),
      (result) => {
        replace(result.dataset)
        setEditing(null)
      },
    )
  }

  const roleOf = (role) => (role ? t(roleStringKey(role)) : '')

  return (
    <>
      <header className="cs-head">
        <div>
          <p className="eyebrow">{t('datasets.eyebrow')}</p>
          <h1 className="cs-title">{t('datasets.title')}</h1>
          <p className="cs-lede">{t('datasets.lede')}</p>
        </div>
      </header>

      {notice ? (
        <p className="cs-note" data-tone={notice.tone} role="alert">
          {notice.text}
        </p>
      ) : null}

      <section className="cs-card" style={{ marginTop: 'var(--s-4)' }}>
        <h2 className="cs-section-head">{t('datasets.add')}</h2>
        <form className="cs-form" onSubmit={create}>
          <div className="cs-row">
            <div className="cs-field">
              <label className="cs-label" htmlFor="dataset-name">
                {t('datasets.name')}
              </label>
              <input
                id="dataset-name"
                className="cs-input"
                value={form.name}
                maxLength={120}
                required
                onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
              />
            </div>
            <div className="cs-field">
              <label className="cs-label" htmlFor="dataset-description">
                {t('datasets.description')}
              </label>
              <input
                id="dataset-description"
                className="cs-input"
                value={form.description}
                maxLength={1000}
                onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
              />
            </div>
          </div>
          <div>
            <button type="submit" className="cs-btn cs-btn-primary" disabled={busy || !form.name.trim()}>
              {t('datasets.create')}
            </button>
          </div>
        </form>
      </section>

      <section className="cs-section">
        <h2 className="cs-section-head">
          {t('datasets.all')} <span className="mono cs-hint">({datasets.length})</span>
        </h2>

        {error ? (
          <p className="cs-note" data-tone="bad">
            {error.message}
          </p>
        ) : loading ? (
          <p className="cs-note">{t('common.loading')}</p>
        ) : (
          <div style={{ display: 'grid', gap: 'var(--s-4)' }}>
            {datasets.map((dataset) => {
              const memberIds = new Set(dataset.memberIds ?? [])
              const assignable = labellers.filter((entry) => !memberIds.has(entry.id))
              const isEditing = editing?.id === dataset.id

              return (
                <article key={dataset.id} className="cs-card" data-archived={dataset.archived || undefined}>
                  <div className="cs-tile-top">
                    <h3 className="cs-tile-name" style={{ margin: 0 }}>
                      {datasetName(dataset, t)}
                    </h3>
                    <span className="cs-actions">
                      {dataset.isDefault ? (
                        <span className="cs-pill" data-tone="draft">
                          {t('datasets.default')}
                        </span>
                      ) : null}
                      {dataset.archived ? (
                        <span className="cs-pill" data-tone="quiet">
                          {t('datasets.archived')}
                        </span>
                      ) : null}
                      <span className="cs-pill" data-tone="live">
                        {t('datasets.dialogCount', { count: dataset.count ?? 0 })}
                      </span>
                    </span>
                  </div>

                  {isEditing ? (
                    <form className="cs-form" onSubmit={saveEdit}>
                      <div className="cs-row">
                        <div className="cs-field">
                          <label className="cs-label" htmlFor={`edit-name-${dataset.id}`}>
                            {t('datasets.name')}
                          </label>
                          <input
                            id={`edit-name-${dataset.id}`}
                            className="cs-input"
                            value={editing.name}
                            maxLength={120}
                            required
                            onChange={(event) => setEditing((prev) => ({ ...prev, name: event.target.value }))}
                          />
                        </div>
                        <div className="cs-field">
                          <label className="cs-label" htmlFor={`edit-description-${dataset.id}`}>
                            {t('datasets.description')}
                          </label>
                          <input
                            id={`edit-description-${dataset.id}`}
                            className="cs-input"
                            value={editing.description}
                            maxLength={1000}
                            onChange={(event) => setEditing((prev) => ({ ...prev, description: event.target.value }))}
                          />
                        </div>
                      </div>
                      <div className="cs-actions">
                        <button type="submit" className="cs-btn cs-btn-sm cs-btn-primary" disabled={busy || !editing.name.trim()}>
                          {t('datasets.save')}
                        </button>
                        <button type="button" className="cs-btn cs-btn-sm" onClick={() => setEditing(null)}>
                          {t('datasets.cancel')}
                        </button>
                      </div>
                    </form>
                  ) : dataset.description ? (
                    <p className="cs-hint" style={{ marginTop: 0 }}>
                      {dataset.description}
                    </p>
                  ) : null}

                  <p className="eyebrow" style={{ marginBottom: 'var(--s-2)' }}>
                    {t('datasets.assignedTo')}
                  </p>
                  {dataset.members?.length ? (
                    <ul className="cs-ds-members">
                      {dataset.members.map((member) => (
                        <li key={member.id}>
                          <span>
                            {member.name ?? t('datasets.removedAccount')}
                            {member.role ? <span className="cs-hint"> · {roleOf(member.role)}</span> : null}
                            {member.name && !member.active ? (
                              <>
                                {' '}
                                <span className="cs-pill" data-tone="quiet">
                                  {t('people.inactive')}
                                </span>
                              </>
                            ) : null}
                          </span>
                          <button
                            type="button"
                            className="cs-btn cs-btn-sm"
                            disabled={busy}
                            onClick={() =>
                              act(
                                () => api.unassignDataset(dataset.id, member.id),
                                t('datasets.unassigned', {
                                  name: member.name ?? t('datasets.removedAccount'),
                                  dataset: datasetName(dataset, t),
                                }),
                                (result) => replace(result.dataset),
                              )
                            }
                          >
                            {t('datasets.unassign')}
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="cs-hint" style={{ marginBottom: 'var(--s-3)' }}>
                      {t('datasets.nobody')}
                    </p>
                  )}

                  {dataset.archived ? null : (
                    <div className="cs-row" style={{ alignItems: 'flex-end' }}>
                      <div className="cs-field">
                        <label className="cs-label" htmlFor={`assign-${dataset.id}`}>
                          {t('datasets.assign')}
                        </label>
                        <select
                          id={`assign-${dataset.id}`}
                          className="cs-select"
                          value={picked[dataset.id] ?? ''}
                          onChange={(event) => setPicked((prev) => ({ ...prev, [dataset.id]: event.target.value }))}
                        >
                          <option value="">{t('datasets.pickPerson')}</option>
                          {assignable.map((entry) => (
                            <option key={entry.id} value={entry.id}>
                              {entry.name} · {roleOf(entry.role)}
                            </option>
                          ))}
                        </select>
                        {people.error ? <p className="cs-hint">{people.error.message}</p> : null}
                      </div>
                      <div>
                        <button
                          type="button"
                          className="cs-btn cs-btn-sm cs-btn-primary"
                          disabled={busy || !picked[dataset.id]}
                          onClick={() => {
                            const person = labellers.find((entry) => entry.id === picked[dataset.id])
                            act(
                              () => api.assignDataset(dataset.id, picked[dataset.id]),
                              t('datasets.assignedDone', { name: person?.name ?? '', dataset: datasetName(dataset, t) }),
                              (result) => {
                                replace(result.dataset)
                                setPicked((prev) => ({ ...prev, [dataset.id]: '' }))
                              },
                            )
                          }}
                        >
                          {t('datasets.assignButton')}
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="cs-actions" style={{ marginTop: 'var(--s-3)' }}>
                    {isEditing ? null : (
                      <button
                        type="button"
                        className="cs-btn cs-btn-sm"
                        onClick={() =>
                          setEditing({ id: dataset.id, name: dataset.name, description: dataset.description ?? '' })
                        }
                      >
                        {t('datasets.rename')}
                      </button>
                    )}
                    {dataset.isDefault ? null : (
                      <button
                        type="button"
                        className="cs-btn cs-btn-sm"
                        disabled={busy}
                        onClick={() =>
                          act(
                            () => api.updateDataset(dataset.id, { archived: !dataset.archived }),
                            dataset.archived
                              ? t('datasets.restored', { name: datasetName(dataset, t) })
                              : t('datasets.archivedDone', { name: datasetName(dataset, t) }),
                            (result) => replace(result.dataset),
                          )
                        }
                      >
                        {dataset.archived ? t('datasets.restore') : t('datasets.archive')}
                      </button>
                    )}
                    {dataset.isDefault ? null : confirming === dataset.id ? (
                      <span className="cs-actions" role="group" aria-label={t('datasets.confirmDelete')}>
                        <span className="cs-hint">
                          {dataset.count
                            ? t('datasets.confirmDeleteFull', { count: dataset.count })
                            : t('datasets.confirmDelete')}
                        </span>
                        <button
                          type="button"
                          className="cs-btn cs-btn-sm cs-btn-danger"
                          disabled={busy}
                          onClick={() =>
                            act(
                              () => api.deleteDataset(dataset.id),
                              t('datasets.deleted', { name: datasetName(dataset, t) }),
                              () => {
                                setConfirming(null)
                                setData(
                                  (prev) => prev && { ...prev, datasets: prev.datasets.filter((row) => row.id !== dataset.id) },
                                )
                              },
                            ).finally(() => setConfirming(null))
                          }
                        >
                          {t('datasets.deleteYes')}
                        </button>
                        <button type="button" className="cs-btn cs-btn-sm" onClick={() => setConfirming(null)}>
                          {t('datasets.cancel')}
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="cs-btn cs-btn-sm cs-btn-danger"
                        onClick={() => setConfirming(dataset.id)}
                      >
                        {t('datasets.delete')}
                      </button>
                    )}
                    {dataset.updatedAt ? (
                      <span className="cs-hint">
                        {t('datasets.updated', { when: new Date(dataset.updatedAt).toLocaleDateString(lang) })}
                      </span>
                    ) : null}
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </section>
    </>
  )
}
