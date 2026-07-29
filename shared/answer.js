/**
 * A student answers one way per question. The mode decides which input is
 * shown, which content counts, and what the marker receives — so exactly one
 * answer exists at any time and there is never doubt about what was handed in.
 */

export const MODES = [
  { id: 'write', label: 'Write', hint: 'Type your answer' },
  { id: 'draw', label: 'Draw', hint: 'Whiteboard' },
  { id: 'upload', label: 'Upload', hint: 'Photo or PDF' },
]

export const DEFAULT_MODE = 'write'

export function modeLabel(mode) {
  return MODES.find((entry) => entry.id === mode)?.label ?? mode
}

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

/** Names what a mode switch would throw away, for the confirmation line. */
export function describeContent(state, mode = state.mode) {
  if (mode === 'write') {
    const words = state.draft.trim().split(/\s+/).filter(Boolean).length
    return `your typed answer (${words} ${words === 1 ? 'word' : 'words'})`
  }

  if (mode === 'draw') {
    const count = state.strokes.length
    return `your whiteboard (${count} ${count === 1 ? 'stroke' : 'strokes'})`
  }

  const count = uploadedFiles(state).length
  return `${count} uploaded ${count === 1 ? 'file' : 'files'}`
}

/** The one-line count shown beside the answer label. */
export function contentSummary(state) {
  if (state.mode === 'write') {
    const words = state.draft.trim().split(/\s+/).filter(Boolean).length
    return `${words} ${words === 1 ? 'word' : 'words'}`
  }

  if (state.mode === 'draw') {
    const count = state.strokes.length
    return `${count} ${count === 1 ? 'stroke' : 'strokes'}`
  }

  const count = uploadedFiles(state).length
  return `${count} ${count === 1 ? 'file' : 'files'}`
}
