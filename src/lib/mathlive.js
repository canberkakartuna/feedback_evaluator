/**
 * MathLive — the formula editor inside the student's text boxes — loaded only
 * when a box first needs it (a formula in the text, or the maths row open), so
 * an activity with no maths never downloads it. See MathEditor.jsx.
 *
 * Self-hosted, nothing from a CDN:
 * - fonts: MathLive draws with the same KaTeX font families that
 *   katex.min.css (imported by MathText) already declares and Vite already
 *   serves, so `fontsDirectory = null` stops it fetching its own copies;
 * - sounds: off (`soundsDirectory = null`), a classroom does not want clicks.
 */
let loading = null

/** Whether this browser can run the rich editor at all. */
export function canUseMathEditor() {
  return (
    typeof window !== 'undefined' &&
    typeof window.customElements !== 'undefined' &&
    typeof document.execCommand === 'function' &&
    typeof window.getSelection === 'function'
  )
}

/** Resolves to MathLive's `MathfieldElement`; rejects if it cannot be loaded. */
export function loadMathLive() {
  if (!loading) {
    loading = import('mathlive').then(({ MathfieldElement }) => {
      MathfieldElement.fontsDirectory = null
      MathfieldElement.soundsDirectory = null
      MathfieldElement.keypressVibration = false
      return MathfieldElement
    })
    // A failed load may be a dropped connection: let the next attempt retry.
    loading.catch(() => {
      loading = null
    })
  }
  return loading
}

/**
 * A formula field set up for a school student:
 *
 * - the phone's own keyboard, never MathLive's on-screen one: the policy is
 *   "manual" (no virtual keyboard), and its input sink — which MathLive
 *   creates with inputmode="none" — is switched back to text, so moving from
 *   a sentence into a formula keeps the same keyboard up instead of swapping
 *   it, and the page does not jump;
 * - no typing shortcuts ("pi" staying p·i, not turning into π mid-word), no
 *   suggestion popovers and no context menu: the row above is the one way to
 *   make a structure, so nothing happens that the student did not ask for.
 */
export function createField(MathfieldElement, latex) {
  const field = new MathfieldElement()
  field.mathVirtualKeyboardPolicy = 'manual'
  field.popoverPolicy = 'off'
  field.smartMode = false
  const nativeKeyboard = () =>
    field.shadowRoot?.querySelector('[part=keyboard-sink]')?.setAttribute('inputmode', 'text')
  // Shortcuts and the menu can only be set once the field is in the page.
  field.addEventListener('mount', () => {
    field.inlineShortcuts = {}
    field.menuItems = []
    nativeKeyboard()
  })
  field.addEventListener('focusin', nativeKeyboard)
  if (latex) field.setValue(latex, { silenceNotifications: true })
  return field
}
