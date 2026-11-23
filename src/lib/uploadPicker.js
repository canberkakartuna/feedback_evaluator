import { hasContent } from './answer.js'

/**
 * Should a click on a mode tab also open the file picker?
 *
 * Students took the Upload tab for the upload button itself, so that click
 * now opens the picker — but only when nothing is in the way:
 *
 * - already in Upload with no photo yet → yes;
 * - switching into Upload from an empty answer (the switch happens at once,
 *   no "Discard and switch" warning) → yes;
 * - a switch that has to ask first, a photo already attached (re-clicking the
 *   tab should not prompt a replace), or any other tab → no.
 *
 * In Upload mode "has content" is "has a photo" (shared/answer.js), so both
 * cases come down to an empty answer in the current mode.
 */
export function opensPicker(state, next) {
  return next === 'upload' && !hasContent(state)
}
