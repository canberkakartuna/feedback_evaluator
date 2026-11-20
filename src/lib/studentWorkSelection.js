/**
 * Selecting rows on the Student work page, and reading back what a delete did.
 *
 * Pure, so the rules are unit-tested (test/unit/studentWorkSelection.test.js)
 * without a DOM. The selection is a Set of session ids; only the rows that are
 * **shown** under the current filter count — a row hidden by the filter is
 * never deleted by "Delete selected", even if it was ticked before the filter
 * changed.
 */

/** The ticked rows among the shown ones, and the select-all box's state. */
export function selectionSummary(shownIds, selected) {
  const selectedShown = shownIds.filter((id) => selected.has(id))
  const all = shownIds.length > 0 && selectedShown.length === shownIds.length
  return {
    selectedShown,
    all,
    // The indeterminate state: some, not all.
    some: selectedShown.length > 0 && !all,
  }
}

/** Select-all for the shown rows: ticks them all, or clears them when all were ticked. */
export function toggleAllShown(shownIds, selected) {
  const next = new Set(selected)
  const { all } = selectionSummary(shownIds, selected)
  for (const id of shownIds) {
    if (all) next.delete(id)
    else next.add(id)
  }
  return next
}

export function toggleOne(selected, id) {
  const next = new Set(selected)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

/**
 * The counts a result message needs, from the server's answer to a delete
 * (`{ deleted, protected, failed }`, see shared/sessionDeletion.js).
 */
export function deletionOutcome(result) {
  const protectedRows = result?.protected ?? []
  return {
    deleted: result?.deleted?.length ?? 0,
    protectedIds: protectedRows.map((entry) => entry.sessionId),
    protectedCount: protectedRows.length,
    protectedDialogs: protectedRows.reduce((sum, entry) => sum + (entry.dialogs ?? 0), 0),
    failed: result?.failed?.length ?? 0,
  }
}
