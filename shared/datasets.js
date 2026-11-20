/**
 * Datasets: named sets of snippets (tutor dialogs) that staff pick and that
 * teachers and annotators then label.
 *
 * Before datasets existed there was one implicit dataset — every snippet whose
 * label record said `included: true` ("kept"). That set is now the **default
 * dataset**, `DEFAULT_DATASET_ID`, and nothing had to be rewritten for it:
 *
 * - a label record carries the datasets it belongs to as `datasetIds`;
 * - a record written before that field existed has no `datasetIds`, and is
 *   read as belonging to the default dataset when it was kept, and to none
 *   otherwise (`datasetIdsOf`). The first membership change to such a record
 *   writes the field out, starting from that reading, so a kept snippet stays
 *   in the default dataset unless someone takes it out.
 *
 * Reading the old shape this way is the migration: it changes no stored data,
 * so it is safe to run any number of times, on either store.
 *
 * `included` is kept in step for every client and export that reads it:
 * a snippet in at least one dataset is `included: true`; taken out of its last
 * dataset it goes back to undecided (`null`); a dropped one (`false`) stays
 * dropped until it is added somewhere.
 *
 * Shared because the client shows the same membership the server enforces.
 */

export const DEFAULT_DATASET_ID = 'ds_default'

/** What the default dataset is called until an admin renames it. */
export const DEFAULT_DATASET_NAME = 'Default dataset'

export const DATASET_NAME_MAX = 120
export const DATASET_DESCRIPTION_MAX = 1000

/** Who a dataset can be assigned to for labelling. */
export const DATASET_MEMBER_ROLES = ['teacher', 'annotator']

/** The datasets a label record belongs to, reading the pre-dataset shape too. */
export function datasetIdsOf(label) {
  if (Array.isArray(label?.datasetIds)) return label.datasetIds
  return label?.included === true ? [DEFAULT_DATASET_ID] : []
}

/**
 * The `datasetIds` and `included` a record has after adding it to some
 * datasets and removing it from others. Removing wins over adding the same id.
 */
export function changeMembership(label, { add = [], remove = [] } = {}) {
  const drop = new Set(remove)
  const datasetIds = [...new Set([...datasetIdsOf(label), ...add])].filter((id) => !drop.has(id))
  const before = label?.included ?? null

  let included
  if (datasetIds.length) included = true
  else if (before === true) included = null
  else included = before

  return { datasetIds, included }
}

/**
 * What the old keep-or-drop write (`PATCH … { included }`) does to
 * membership, so a client that only knows "keep" keeps working: keeping a
 * snippet that is in no dataset puts it in the default one, keeping one that
 * already is somewhere leaves it where it is, and dropping it or setting it
 * back to undecided takes it out of every dataset.
 */
export function membershipForIncluded(label, included) {
  if (included === true) {
    const current = datasetIdsOf(label)
    return { datasetIds: current.length ? current : [DEFAULT_DATASET_ID], included: true }
  }
  return { datasetIds: [], included }
}

/** Whether a record belongs to any of the given datasets. */
export const inAnyDataset = (label, datasetIds) => {
  const wanted = new Set(datasetIds)
  return datasetIdsOf(label).some((id) => wanted.has(id))
}

/** The datasets one person is assigned to label, archived ones left out. */
export const assignedDatasets = (datasets, userId) =>
  datasets.filter((dataset) => !dataset.archived && (dataset.memberIds ?? []).includes(userId))
