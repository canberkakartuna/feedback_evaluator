/**
 * A student answers one way per question. The mode decides which input is
 * shown, which content counts, and what the marker receives — so exactly one
 * answer exists at any time and there is never doubt about what was handed in.
 *
 * **Ids only, no labels.** The words "Write", "Draw" and "Upload" are interface
 * text and live in src/lib/strings.js under `modes.*`, keyed by the ids below —
 * this file is shared with the server, which has no language to render them in
 * and no business choosing one. Same reasoning as shared/marks.js.
 */

export const MODES = [{ id: 'write' }, { id: 'draw' }, { id: 'upload' }]

export const MODE_IDS = MODES.map((mode) => mode.id)

export const DEFAULT_MODE = 'write'

export function boardFile(state) {
  return state.attachments.find((item) => item.source === 'whiteboard') ?? null
}

export function uploadedFiles(state) {
  return state.attachments.filter((item) => item.source !== 'whiteboard')
}

/** Is there anything in the given mode that a marker would receive? */
export function hasContent(state, mode = state.mode) {
  if (mode === 'write') return state.draft.trim().length > 0
  if (mode === 'draw') return state.strokes.length > 0
  return uploadedFiles(state).length > 0
}

/**
 * How much is in an answer: words, strokes or files, depending on the mode.
 *
 * A number rather than a phrase. This used to return "3 words" and "your
 * whiteboard (12 strokes)" ready to print, which put English in a file the API
 * imports and made the same sentence impossible to say in Turkish. The counting
 * is the shared part; the wording belongs to whoever is showing it — see
 * `common.words`, `common.strokes`, `common.files` and `qp.discard*` in
 * src/lib/strings.js.
 */
export function contentCount(state, mode = state.mode) {
  if (mode === 'write') return state.draft.trim().split(/\s+/).filter(Boolean).length
  if (mode === 'draw') return state.strokes.length
  return uploadedFiles(state).length
}
