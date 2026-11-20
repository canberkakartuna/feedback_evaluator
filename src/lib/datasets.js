import { DEFAULT_DATASET_NAME } from '../../shared/datasets.js'

/**
 * Small client helpers for datasets (shared/datasets.js holds the rules).
 * Pure, so test/unit can reach them; the one side effect — remembering the
 * last dataset picked into — is kept to `rememberTarget` / `recallTarget`.
 */

/** Where the last dataset picked into is remembered, per browser. */
export const TARGET_KEY = 'feedback-evaluator.selectionDataset'

/**
 * Which dataset to pick dialogs into, out of the ones offered: the one used
 * last if it is still there, otherwise the only one, otherwise the default
 * one, otherwise the first. `''` when there is nothing to offer.
 */
export function pickTarget(datasets, lastUsedId) {
  const open = (datasets ?? []).filter((dataset) => !dataset.archived)
  if (!open.length) return ''
  if (lastUsedId && open.some((dataset) => dataset.id === lastUsedId)) return lastUsedId
  if (open.length === 1) return open[0].id
  return (open.find((dataset) => dataset.isDefault) ?? open[0]).id
}

/**
 * Which dataset the labelling screen opens on: the one in the URL if it is
 * offered, otherwise the first offered, otherwise `''` (none — the screen
 * says so, or shows its "all dialogs" view).
 */
export function pickLabellingDataset(datasets, wanted) {
  const offered = datasets ?? []
  if (wanted && offered.some((dataset) => dataset.id === wanted)) return wanted
  return offered[0]?.id ?? ''
}

/**
 * A dataset's name as shown: the default dataset's own name in the reader's
 * language until an admin renames it, any other name as it was typed.
 */
export function datasetName(dataset, t) {
  if (!dataset) return ''
  if (dataset.isDefault && dataset.name === DEFAULT_DATASET_NAME) return t('datasets.defaultName')
  return dataset.name
}

/** The names of the datasets a dialog is in, for its pills; unknown ids are skipped. */
export function membershipNames(datasetIds, datasets, t) {
  const byId = new Map((datasets ?? []).map((dataset) => [dataset.id, dataset]))
  return (datasetIds ?? [])
    .map((id) => byId.get(id))
    .filter(Boolean)
    .map((dataset) => ({ id: dataset.id, name: datasetName(dataset, t), archived: Boolean(dataset.archived) }))
}

export function recallTarget() {
  try {
    return localStorage.getItem(TARGET_KEY) ?? ''
  } catch {
    return ''
  }
}

export function rememberTarget(datasetId) {
  try {
    if (datasetId) localStorage.setItem(TARGET_KEY, datasetId)
  } catch {
    // Private browsing: the default choice next time is good enough.
  }
}

/**
 * What a student is called on the selection screen, the way the roster names
 * them: their name when the caller may see it, otherwise "signed-in student";
 * an anonymous student's nickname and session code; a staff walkthrough as one.
 * Returns `{ label, code, tone }` for the screen to lay out.
 */
export function studentLabel(student, t) {
  if (student.kind === 'preview') return { label: t('roster.preview'), code: student.code, tone: 'draft' }
  if (student.kind === 'account') return { label: student.name ?? t('roster.signedInStudent'), code: null, tone: null }
  return { label: student.nickname || t('roster.anonymous'), code: student.code, tone: 'quiet' }
}
