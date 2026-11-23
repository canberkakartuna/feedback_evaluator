import { useEffect, useImperativeHandle, useLayoutEffect, useRef } from 'react'
import katex from 'katex'
import { MATH_BUTTONS, cleanLatex, hasBoxes, parseDraft, serialiseDraft } from '../lib/mathDraft'
import { createField, loadMathLive } from '../lib/mathlive'
import './MathEditor.css'

/**
 * The student's text box when it can hold maths: ordinary prose, typed with
 * the device's own keyboard, with formulas in it already rendered and
 * editable in place. No `$`, braces or backslashes ever show.
 *
 * - **Prose** is a plain `contenteditable` the browser edits by itself, so
 *   autocorrect, IME composition and the phone keyboard behave as in any text
 *   box. React renders the element and never its children: the DOM is the
 *   working copy, read back into text on every change.
 * - **A formula** is a chip the prose cannot edit into (`contenteditable=false`)
 *   holding a MathLive field (src/lib/mathlive.js). Tap it — any box in it —
 *   to edit; the box being filled in is ringed in the pen colour. Before
 *   MathLive has loaded, a chip is a still KaTeX rendering of the same source.
 * - **The value** that leaves is plain text with `$…$` formulas, exactly what
 *   a textarea held — src/lib/mathDraft.js. A formula nobody edited keeps its
 *   source byte for byte, so loading a draft saves nothing.
 *
 * Moving: Tab / Shift+Tab and the arrows go from box to box and, past the
 * last, out into the sentence; Enter and Escape leave the formula (Enter
 * never sends from inside one); tapping the sentence, or anywhere after a
 * formula, puts the caret back in the sentence.
 *
 * Deleting — every path also works from `beforeinput`, which is how phone
 * keyboards send Backspace, not only from the key:
 * - in the sentence, Backspace (or Delete) next to a formula first marks the
 *   whole formula, and a second press removes it; it never drops into the
 *   formula and starts eating its last box;
 * - inside a formula, Backspace deletes in the current box; in an empty box it
 *   goes back to the previous box; from the first box it marks the whole
 *   formula, and once the formula is empty or marked the next press removes
 *   it and the caret returns to the sentence where it was;
 * - "Remove formula" on the maths row (`removeFormula()`) removes the formula
 *   being edited or marked with a tap — on the row, not on the formula, where
 *   it would cover the exponent or the upper limit a student is aiming for;
 * - a formula left with every box empty disappears when the student leaves it;
 * - Ctrl/Cmd+Z right after removing a formula puts it back.
 *
 * `ref` exposes `insert(id)`, `removeFormula()`, `preload()` and `focus()`
 * for the maths row; `onFormula(true | false)` says whether there is a formula
 * being edited or marked, for the row's "Remove formula".
 * `onUnavailable` is called if MathLive cannot load; the parent then falls
 * back to a plain textarea.
 */

const ZWSP = '​'
const isChip = (node) => node?.nodeType === 1 && node.classList.contains('mi-chip')
const fieldOf = (chip) => chip?.querySelector('math-field') ?? null
const PLACEHOLDER = /^\\placeholder(?:\[[^\]]*\])?\{\}$/

/** Nothing typed in it: no content at all, or every box as empty as when it was inserted. */
const isBlank = (chip, field) => !cleanLatex(field.value) || field.value === chip.dataset.blank

/** The deletions a keyboard can ask for, and which way each goes. */
const DELETIONS = {
  deleteContentBackward: 'backward',
  deleteWordBackward: 'backward',
  deleteContentForward: 'forward',
  deleteWordForward: 'forward',
}

export default function MathEditor({
  ref,
  id,
  labelId,
  className,
  value,
  onChange,
  placeholder,
  maxLength,
  onEnter,
  spellCheck,
  wantMath,
  onFormula,
  onUnavailable,
}) {
  const root = useRef(null)
  const emitted = useRef(null)
  const Field = useRef(null)
  // Where the student last was: a formula chip, or a range in the prose.
  const place = useRef(null)
  const composing = useRef(false)
  // The formula just left, briefly: see leave().
  const leaving = useRef(null)
  // The formula marked for removal by a first Backspace.
  const armed = useRef(null)
  // The formula removed last, for Ctrl/Cmd+Z.
  const removed = useRef(null)
  // The latest props, for listeners attached once.
  const props = useRef({})
  useEffect(() => {
    props.current = { onChange, maxLength, onEnter, onUnavailable, onFormula }
  })

  /* ── marking a formula for removal ──────────────────────── */

  /** The formula "Remove formula" would take: the marked one, or the one being edited. */
  const target = () =>
    root.current?.querySelector('.mi-chip.mi-armed') ?? root.current?.querySelector('.mi-chip.mi-active') ?? null

  /** Tells the row whether there is a formula to remove. */
  const report = () => props.current.onFormula?.(Boolean(target()))

  function disarm() {
    armed.current?.chip.classList.remove('mi-armed')
    armed.current = null
    report()
  }

  function arm(chip) {
    disarm()
    armed.current = { chip }
    chip.classList.add('mi-armed')
    report()
  }

  /* ── building the DOM from text ─────────────────────────── */

  const staticChip = (chip, latex) => {
    const face = document.createElement('span')
    face.className = 'mi-static'
    face.innerHTML = katex.renderToString(latex, { throwOnError: false })
    chip.append(face)
  }

  const fieldChip = (chip, latex) => {
    const field = createField(Field.current, latex)
    // While Backspace walks back out of the first box: see the move-out handler.
    let backingOut = false
    let deleteKeyAt = 0

    /** A deletion inside the formula; true when handled here, not by MathLive. */
    const deleteIn = (direction) => {
      const [start, end] = field.selection.ranges[0] ?? [0, 0]
      const wholeSelected = Math.min(start, end) === 0 && Math.max(start, end) >= field.lastOffset && start !== end
      if (isBlank(chip, field) || wholeSelected) {
        removeChip(chip)
        return true
      }
      if (direction === 'backward' && start === end && start === 0) {
        // At the very start there is nothing to delete inside: mark the whole
        // formula, and the next Backspace removes it.
        field.select()
        chip.classList.add('mi-armed')
        report()
        return true
      }
      if (direction === 'backward' && PLACEHOLDER.test(field.getValue(field.selection))) {
        // An empty box: go back to the previous one, not unwrap the structure.
        backingOut = true
        field.executeCommand(['moveToPreviousPlaceholder'])
        backingOut = false
        return true
      }
      chip.classList.remove('mi-armed')
      return false
    }

    field.addEventListener('focusin', () => {
      const left = leaving.current
      if ((left?.chip === chip || left?.prose) && performance.now() < left.until) {
        // Back to the sentence, where the caret was last put there.
        setTimeout(() => {
          const range = place.current?.range
          if (range && root.current.contains(range.startContainer)) caretAt(range.startContainer, range.startOffset)
          else if (left.chip === chip) leave(chip, left.side)
        })
        return
      }
      disarm()
      chip.classList.add('mi-active')
      report()
      place.current = { chip }
    })
    field.addEventListener('focusout', () => {
      chip.classList.remove('mi-active')
      // A mark made inside the formula ends with it; one made from the
      // sentence (a first Backspace there) is the sentence's to clear.
      if (armed.current?.chip !== chip) chip.classList.remove('mi-armed')
      report()
      // A formula left with nothing in it is nothing: it goes. MathLive can
      // blur and refocus itself in passing, so judge a moment later.
      setTimeout(() => {
        if (chip.isConnected && document.activeElement !== field && isBlank(chip, field)) prune(chip)
      }, 300)
    })
    // A tap or click on the formula is the student choosing it: no guard.
    field.addEventListener(
      'pointerdown',
      () => {
        leaving.current = null
      },
      { capture: true },
    )
    const sync = () => {
      chip.dataset.latex = field.value
      chip.dataset.fresh = '1'
      emit()
    }
    field.addEventListener('input', sync)
    field.addEventListener('move-out', (event) => {
      event.preventDefault()
      if (backingOut) {
        // Backspace from the first box: mark the whole formula; the next
        // Backspace removes it.
        field.select()
        chip.classList.add('mi-armed')
        report()
        return
      }
      const side = { backward: 'before', forward: 'after' }[event.detail?.direction]
      if (side) leave(chip, side)
    })
    field.addEventListener(
      'keydown',
      (event) => {
        if (event.ctrlKey || event.metaKey || event.altKey) return
        if (event.key === 'Backspace' || event.key === 'Delete') deleteKeyAt = performance.now()
        const handled = {
          Tab: () => field.executeCommand([event.shiftKey ? 'moveToPreviousPlaceholder' : 'moveToNextPlaceholder']),
          Enter: () => leave(chip, 'after'),
          Escape: () => leave(chip, 'after'),
          Backspace: () => deleteIn('backward'),
          Delete: () => deleteIn('forward'),
        }[event.key]
        if (!handled || handled() === false) return
        event.preventDefault()
        event.stopPropagation()
      },
      { capture: true },
    )
    // A phone keyboard's Backspace often arrives only as `beforeinput`, which
    // MathLive does not act on. A real key press already went through keydown.
    field.addEventListener(
      'beforeinput',
      (event) => {
        const direction = DELETIONS[event.inputType]
        if (!direction || performance.now() - deleteKeyAt < 100) return
        event.preventDefault()
        event.stopPropagation()
        if (deleteIn(direction)) return
        // (The array form: MathLive runs the bare string form as a no-op here.)
        field.executeCommand([direction === 'backward' ? 'deleteBackward' : 'deleteForward'])
        // A command run from here sends no input event of its own.
        sync()
      },
      { capture: true },
    )

    chip.append(field)
    return field
  }

  const makeChip = ({ latex, open, close, fresh }) => {
    const chip = document.createElement('span')
    chip.className = 'mi-chip'
    chip.contentEditable = 'false'
    chip.dataset.latex = latex
    chip.dataset.open = open
    chip.dataset.close = close
    if (fresh) chip.dataset.fresh = '1'
    if (Field.current) fieldChip(chip, latex)
    else staticChip(chip, latex)
    return chip
  }

  /**
   * A non-empty text node either side of every chip, so the caret has
   * somewhere to stand — before a first formula, between two, and after a
   * last one — since a browser will not put it in an empty one.
   */
  const anchor = () => {
    for (const chip of root.current.querySelectorAll('.mi-chip')) {
      for (const [neighbour, add] of [
        [chip.previousSibling, () => chip.before(ZWSP)],
        [chip.nextSibling, () => chip.after(ZWSP)],
      ]) {
        if (neighbour?.nodeType !== 3) add()
        else if (!neighbour.nodeValue) neighbour.nodeValue = ZWSP
      }
    }
  }

  const render = (text) => {
    const node = root.current
    disarm()
    node.replaceChildren()
    for (const segment of parseDraft(text)) {
      if (segment.kind === 'math') {
        node.append(makeChip(segment))
        continue
      }
      segment.value.split('\n').forEach((line, index) => {
        if (index) node.append(document.createElement('br'))
        if (line) node.append(line)
      })
    }
    // A last line break only shows with a second one after it.
    if (text.endsWith('\n')) node.append(document.createElement('br'))
    anchor()
    mark(text)
  }

  /* ── reading the DOM back into text ─────────────────────── */

  /** Plain text with `$…$` formulas, for the whole box or a copied piece of it. */
  const read = (from = root.current) => {
    const segments = []
    let text = ''
    const flush = () => {
      if (text) segments.push({ kind: 'text', value: text.replaceAll(ZWSP, '').replaceAll(' ', ' ') })
      text = ''
    }
    const walk = (parent) => {
      for (const child of parent.childNodes) {
        if (child.nodeType === 3) text += child.nodeValue
        else if (isChip(child)) {
          flush()
          const { latex = '', open = '', close = '', fresh } = child.dataset
          segments.push({ kind: 'math', latex, open, close, fresh: fresh === '1' })
        } else if (child.nodeName === 'BR') text += '\n'
        else if (child.nodeType === 1) {
          // A pasted or browser-made block starts a new line.
          const block = /^(DIV|P|LI|H\d)$/.test(child.nodeName)
          if (block && (text || segments.length) && !text.endsWith('\n')) text += '\n'
          walk(child)
        }
      }
    }
    walk(from)
    flush()
    // The browser's own trailing <br> (what makes an empty last line visible)
    // is not a line of its own.
    const last = [...from.childNodes].reverse().find((n) => n.nodeType !== 3 || n.nodeValue.replaceAll(ZWSP, ''))
    const tail = segments[segments.length - 1]
    if (last?.nodeName === 'BR' && tail?.kind === 'text' && tail.value.endsWith('\n')) {
      tail.value = tail.value.slice(0, -1)
    }
    return serialiseDraft(segments.filter((segment) => segment.kind !== 'text' || segment.value))
  }

  const mark = (text) => {
    const node = root.current
    node.dataset.value = text
    node.dataset.empty = String(!text && !node.querySelector('.mi-chip'))
  }

  function emit() {
    const text = read()
    if (text.length > (props.current.maxLength ?? Infinity) && !composing.current) {
      // Over the server's limit: undo the change rather than send what it refuses.
      render(emitted.current ?? '')
      caretAt(root.current, root.current.childNodes.length)
      return
    }
    mark(text)
    if (text === emitted.current) return
    emitted.current = text
    props.current.onChange?.(text)
  }

  /* ── the caret ──────────────────────────────────────────── */

  const caretAt = (node, offset) => {
    root.current.focus({ preventScroll: true })
    const selection = window.getSelection()
    selection.collapse(node, offset)
    place.current = { range: selection.getRangeAt(0).cloneRange() }
  }

  /**
   * Out of a formula, into the sentence beside it. MathLive can take the focus
   * back a moment later (its own focus bookkeeping runs on a timer), so for a
   * quarter of a second a return into this formula that the student did not
   * tap for is sent straight back to the sentence — to the caret's latest
   * place there, which may have moved since.
   */
  function leave(chip, side) {
    if (!chip.isConnected) return
    leaving.current = { chip, side, until: performance.now() + 250 }
    chip.classList.remove('mi-active', 'mi-armed')
    report()
    fieldOf(chip)?.blur()
    anchor()
    if (side === 'after') {
      const next = chip.nextSibling
      caretAt(next, next.nodeValue.startsWith(ZWSP) ? 1 : 0)
    } else {
      const previous = chip.previousSibling
      caretAt(previous, previous.nodeValue.length)
    }
  }

  /** Takes a formula out, leaving the caret in the sentence where it stood. */
  function removeChip(chip) {
    if (!chip.isConnected) return
    disarm()
    // A live range at the formula's spot: it follows the text nodes merging
    // around it, where a remembered node and offset would not.
    const spot = document.createRange()
    spot.setStartBefore(chip)
    spot.collapse(true)
    const { latex, open, close, fresh } = chip.dataset
    chip.remove()
    root.current.normalize()
    removed.current = {
      segment: { latex, open, close, fresh: fresh === '1' },
      previous: spot.startContainer,
      offset: spot.startOffset,
    }
    caretAt(spot.startContainer, spot.startOffset)
    anchor()
    report()
    emit()
  }

  /** An emptied formula the student has left: gone, without moving their caret. */
  function prune(chip) {
    chip.remove()
    anchor()
    report()
    emit()
  }

  /** Ctrl/Cmd+Z straight after removing a formula: it comes back where it was. */
  function restore() {
    const { segment, previous, offset } = removed.current
    removed.current = null
    const chip = makeChip(segment)
    if (previous?.isConnected && previous.nodeType === 3) {
      previous.splitText(Math.min(offset, previous.nodeValue.length))
      previous.after(chip)
    } else root.current.prepend(chip)
    anchor()
    leave(chip, 'after')
    emit()
  }

  /**
   * What stands next to the prose caret, `backward` or `forward`, past the
   * invisible anchors: `{ chip }`, `{ char: { node, index } }`, `{ other }` (a
   * line break — the browser's to delete) or `{ none }`; `skipped` says
   * whether anchors were passed on the way.
   */
  const besideCaret = (direction) => {
    const selection = window.getSelection()
    if (!selection.rangeCount || !selection.isCollapsed) return null
    const back = direction === 'backward'
    const step = (node) => (back ? node.previousSibling : node.nextSibling)
    let skipped = false
    const scan = (node, from) => {
      const text = node.nodeValue
      for (let index = from; index >= 0 && index < text.length; index += back ? -1 : 1) {
        if (text[index] !== ZWSP) return { char: { node, index }, skipped }
        skipped = true
      }
      return null
    }
    let { anchorNode: node, anchorOffset: offset } = selection
    let current
    if (node.nodeType === 3) {
      const found = scan(node, back ? offset - 1 : offset)
      if (found) return found
      current = step(node)
    } else {
      current = back ? node.childNodes[offset - 1] : node.childNodes[offset]
    }
    for (; current; current = step(current)) {
      if (current.nodeType === 3) {
        const found = scan(current, back ? current.nodeValue.length - 1 : 0)
        if (found) return found
      } else if (isChip(current)) return { chip: current, skipped }
      else return { other: current, skipped }
    }
    return { none: true, skipped }
  }

  /** Where prose insertion goes: the saved caret, or the end of the text. */
  const proseRange = () => {
    const saved = place.current?.range
    if (saved && root.current.contains(saved.startContainer)) return saved
    const range = document.createRange()
    range.selectNodeContents(root.current)
    range.collapse(false)
    return range
  }

  /* ── MathLive ───────────────────────────────────────────── */

  const upgrade = (MathfieldElement) => {
    Field.current = MathfieldElement
    for (const chip of root.current?.querySelectorAll('.mi-chip') ?? []) {
      if (fieldOf(chip)) continue
      chip.replaceChildren()
      fieldChip(chip, chip.dataset.latex)
    }
  }

  const needsMath = wantMath || /\$|\\\(|\\\[/.test(value ?? '')
  useEffect(() => {
    if (!needsMath || Field.current) return
    let live = true
    loadMathLive().then(
      (MathfieldElement) => live && upgrade(MathfieldElement),
      () => live && props.current.onUnavailable?.(),
    )
    return () => {
      live = false
    }
  }, [needsMath])

  /* ── the value from outside ─────────────────────────────── */

  // Rebuilt only when the text changes from outside — a send clearing it,
  // another question's draft — never for the student's own typing.
  useLayoutEffect(() => {
    const text = value ?? ''
    if (text === emitted.current) return
    const focused = root.current.contains(document.activeElement)
    render(text)
    emitted.current = text
    removed.current = null
    if (focused) caretAt(root.current, 0)
  })

  /* ── prose events ───────────────────────────────────────── */

  useEffect(() => {
    const node = root.current
    const insideChip = (event) => event.composedPath().some(isChip)

    const onKeyDown = (event) => {
      if (insideChip(event) || event.isComposing || event.key !== 'Enter') return
      event.preventDefault()
      if (!event.shiftKey && props.current.onEnter) props.current.onEnter()
      else document.execCommand('insertLineBreak')
    }

    const onBeforeInput = (event) => {
      if (insideChip(event)) return
      // No bold, italic or other formatting: this is plain text.
      if (event.inputType.startsWith('format')) {
        event.preventDefault()
        return
      }
      if (event.inputType === 'historyUndo' && removed.current) {
        event.preventDefault()
        restore()
        return
      }
      const direction = DELETIONS[event.inputType]
      if (!direction) {
        disarm()
        removed.current = null
        return
      }
      const near = besideCaret(direction)
      if (!near) {
        // A selection: the browser deletes it, formulas in it included.
        disarm()
        return
      }
      if (near.chip) {
        // First press marks the formula, the second removes it.
        event.preventDefault()
        if (armed.current?.chip === near.chip) removeChip(near.chip)
        else arm(near.chip)
        return
      }
      disarm()
      if (!near.skipped) return
      // Only invisible anchors before the next real character: delete that
      // character, so the press is never swallowed.
      event.preventDefault()
      if (!near.char) return
      const selection = window.getSelection()
      const range = document.createRange()
      if (direction === 'backward') {
        range.setStart(near.char.node, near.char.index)
        range.setEnd(selection.anchorNode, selection.anchorOffset)
      } else {
        range.setStart(selection.anchorNode, selection.anchorOffset)
        range.setEnd(near.char.node, near.char.index + 1)
      }
      range.deleteContents()
      caretAt(range.startContainer, range.startOffset)
      anchor()
      emit()
    }

    const onInput = () => emit()

    /** Copy and cut give the same `$…$` text a paste turns back into formulas. */
    const onCopy = (event) => {
      if (insideChip(event)) return
      const selection = window.getSelection()
      if (!selection.rangeCount || selection.isCollapsed) return
      const holder = document.createElement('div')
      holder.append(selection.getRangeAt(0).cloneContents())
      event.clipboardData?.setData('text/plain', read(holder))
      event.preventDefault()
      if (event.type === 'cut') {
        selection.getRangeAt(0).deleteContents()
        anchor()
        emit()
      }
    }

    const onPaste = (event) => {
      if (insideChip(event)) return
      event.preventDefault()
      const text = event.clipboardData?.getData('text/plain') ?? ''
      if (!text) return
      if (!/\$|\\\(|\\\[/.test(text)) {
        document.execCommand('insertText', false, text)
        return
      }
      // Pasted maths arrives as formulas, not as dollar signs.
      const range = proseRange()
      range.deleteContents()
      const fragment = document.createDocumentFragment()
      for (const segment of parseDraft(text)) {
        if (segment.kind === 'math') fragment.append(makeChip({ ...segment, fresh: true }))
        else fragment.append(segment.value)
      }
      const last = fragment.lastChild
      range.insertNode(fragment)
      anchor()
      if (last?.isConnected) caretAt(last.parentNode, [...last.parentNode.childNodes].indexOf(last) + 1)
      emit()
    }
    const onDrop = (event) => {
      if (!insideChip(event)) event.preventDefault()
    }
    const onCompositionStart = () => {
      composing.current = true
    }
    const onCompositionEnd = () => {
      composing.current = false
      emit()
    }
    // Only while the prose itself has focus: inside a formula the document's
    // selection points at the chip, and must not be taken for a prose caret.
    // Moving the caret away also takes back a formula's "marked" state.
    const onSelectionChange = () => {
      const selection = window.getSelection()
      if (document.activeElement !== node || !selection.rangeCount) return
      const range = selection.getRangeAt(0)
      if (node.contains(range.startContainer)) place.current = { range: range.cloneRange() }
      // The same spot can be written several ways, so ask whether the caret
      // is still beside the marked formula, not whether it is the same node.
      const mark = armed.current
      if (mark && besideCaret('backward')?.chip !== mark.chip && besideCaret('forward')?.chip !== mark.chip) disarm()
    }
    // A tap on the sentence is the student leaving any formula; MathLive's
    // own focus timer must not pull them back into it (see leave()).
    const onPointerDown = (event) => {
      if (insideChip(event)) return
      disarm()
      leaving.current = { prose: true, until: performance.now() + 250 }
    }

    node.addEventListener('keydown', onKeyDown)
    node.addEventListener('beforeinput', onBeforeInput)
    node.addEventListener('input', onInput)
    node.addEventListener('copy', onCopy)
    node.addEventListener('cut', onCopy)
    node.addEventListener('paste', onPaste)
    node.addEventListener('drop', onDrop)
    node.addEventListener('pointerdown', onPointerDown)
    node.addEventListener('compositionstart', onCompositionStart)
    node.addEventListener('compositionend', onCompositionEnd)
    document.addEventListener('selectionchange', onSelectionChange)
    return () => {
      node.removeEventListener('keydown', onKeyDown)
      node.removeEventListener('beforeinput', onBeforeInput)
      node.removeEventListener('input', onInput)
      node.removeEventListener('copy', onCopy)
      node.removeEventListener('cut', onCopy)
      node.removeEventListener('paste', onPaste)
      node.removeEventListener('drop', onDrop)
      node.removeEventListener('pointerdown', onPointerDown)
      node.removeEventListener('compositionstart', onCompositionStart)
      node.removeEventListener('compositionend', onCompositionEnd)
      document.removeEventListener('selectionchange', onSelectionChange)
    }
    // The handlers read everything through refs; attach once.
  }, [])

  /* ── the maths row's handle ─────────────────────────────── */

  useImperativeHandle(ref, () => ({
    /** Starts loading MathLive, so a button press finds it ready. */
    preload: () => loadMathLive().then(upgrade, () => props.current.onUnavailable?.()),

    /**
     * A maths button. Synchronous when MathLive is loaded (the row preloads
     * it), so a phone keeps the tap as the gesture that moves focus and the
     * keyboard stays up.
     */
    insert(buttonId) {
      const button = MATH_BUTTONS.find((entry) => entry.id === buttonId)
      if (!button || !Field.current) return
      disarm()
      // A button is the student choosing the formula: no guard against focus.
      leaving.current = null
      const boxes = hasBoxes(button)
      const chip = place.current?.chip
      if (chip?.isConnected && fieldOf(chip)) {
        fieldOf(chip).insert(button.insert, {
          format: 'latex',
          focus: true,
          selectionMode: boxes ? 'placeholder' : 'after',
        })
        return
      }
      const range = proseRange()
      // With nothing selected, a power, subscript or fraction takes the
      // letters or digits typed just before it: "x" then the power button is
      // x with an empty exponent, not an x outside the formula.
      const before = range.startContainer
      if (range.collapsed && button.insert.includes('#@') && before.nodeType === 3) {
        const typed = /[\p{L}\p{N}]+$/u.exec(before.nodeValue.slice(0, range.startOffset).replaceAll(ZWSP, ''))
        if (typed) range.setStart(before, before.nodeValue.slice(0, range.startOffset).lastIndexOf(typed[0]))
      }
      const selected = range.toString().replaceAll(ZWSP, '').trim()
      range.deleteContents()
      const created = makeChip({ latex: '', open: '', close: '', fresh: true })
      range.insertNode(created)
      anchor()
      const field = fieldOf(created)
      place.current = { chip: created }
      field.insert(selected ? button.insert.replace(/#[@0]/, selected) : button.insert, {
        format: 'latex',
        focus: true,
        selectionMode: 'placeholder',
      })
      // How it looks with nothing filled in, to know later whether it still is.
      if (!selected) created.dataset.blank = field.value
      if (!boxes || !field.value.includes('\\placeholder')) leave(created, 'after')
      emit()
    },

    /** "Remove formula" on the row: the formula being edited or marked goes. */
    removeFormula() {
      const chip = target()
      if (chip) removeChip(chip)
    },

    focus: () => root.current?.focus(),
  }))

  return (
    <div
      ref={root}
      id={id}
      className={`mi-editor ${className ?? ''}`}
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-multiline="true"
      aria-labelledby={labelId}
      aria-placeholder={placeholder}
      data-placeholder={placeholder}
      spellCheck={spellCheck}
    />
  )
}
