import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import { datasetName, membershipNames } from '../lib/datasets'

/** How long "Saved" stays up, as on the labelling screen. */
const SAVED_FOR_MS = 2500

/**
 * Which datasets a dialog is in, as pills, read-only. "In no dataset" when it
 * is in none. Used wherever staff see a dialog: the selection screens and the
 * labelling screen.
 */
export function DatasetPills({ datasetIds, datasets, t }) {
  const names = membershipNames(datasetIds, datasets, t)
  return (
    <span className="cs-ds-pills">
      {names.length ? (
        names.map((entry) => (
          <span key={entry.id} className="cs-pill" data-tone={entry.archived ? 'quiet' : 'live'}>
            {entry.archived ? t('datasets.archivedName', { name: entry.name }) : entry.name}
          </span>
        ))
      ) : (
        <span className="cs-pill" data-tone="quiet">
          {t('datasets.inNone')}
        </span>
      )}
    </span>
  )
}

/**
 * Adds one dialog to the dataset being picked into, or takes it out again — the
 * "keep it, and say where" of the selection screens. Saves at once, like
 * everything on the labelling screen, and hands the server's answer to
 * `onChange(snippetId, { datasetIds, included })` so the caller can update its
 * row without reading the list again.
 */
export default function DatasetToggle({ snippet, target, datasets, onChange, t }) {
  const [save, setSave] = useState(null)
  const timer = useRef(null)
  useEffect(() => () => clearTimeout(timer.current), [])

  const dataset = datasets.find((entry) => entry.id === target) ?? null
  const inTarget = Boolean(dataset && (snippet.datasetIds ?? []).includes(dataset.id))

  const flip = async () => {
    if (!dataset) return
    clearTimeout(timer.current)
    setSave({ state: 'saving' })
    try {
      const result = inTarget
        ? await api.removeFromDataset(dataset.id, [snippet.id])
        : await api.addToDataset(dataset.id, [snippet.id])
      onChange?.(snippet.id, result.memberships[snippet.id])
      setSave({ state: 'saved' })
      timer.current = setTimeout(() => setSave(null), SAVED_FOR_MS)
    } catch (failure) {
      setSave({ state: 'failed', message: failure.message })
    }
  }

  return (
    <div className="cs-ds-toggle">
      <DatasetPills datasetIds={snippet.datasetIds} datasets={datasets} t={t} />
      {dataset ? (
        <button
          type="button"
          className={`cs-btn cs-btn-sm ${inTarget ? '' : 'cs-btn-primary'}`}
          aria-pressed={inTarget}
          disabled={save?.state === 'saving'}
          onClick={flip}
        >
          {inTarget
            ? t('datasets.removeFrom', { name: datasetName(dataset, t) })
            : t('datasets.addTo', { name: datasetName(dataset, t) })}
        </button>
      ) : null}
      <span className="cs-save" data-state={save?.state ?? 'idle'} aria-live="polite">
        {save?.state === 'saving'
          ? t('labelling.saving')
          : save?.state === 'saved'
            ? t('labelling.saved')
            : save?.state === 'failed'
              ? t('labelling.saveFailed', { message: save.message })
              : ''}
      </span>
    </div>
  )
}

/**
 * The "pick into" select at the top of a selection screen: the active
 * datasets, the chosen one remembered by the caller.
 */
export function TargetPicker({ id = 'target-dataset', datasets, value, onChange, t }) {
  const open = datasets.filter((entry) => !entry.archived)
  return (
    <div className="cs-field">
      <label className="cs-label" htmlFor={id}>
        {t('datasets.target')}
      </label>
      {open.length ? (
        <select id={id} className="cs-select" value={value} onChange={(event) => onChange(event.target.value)}>
          {open.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {datasetName(entry, t)} ({entry.count ?? 0})
            </option>
          ))}
        </select>
      ) : (
        <p className="cs-hint">{t('datasets.noneToPick')}</p>
      )}
    </div>
  )
}
