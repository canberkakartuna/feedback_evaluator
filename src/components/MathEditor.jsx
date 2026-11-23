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
 *   holding a MathLive field (src/lib/mathlive.js). Tap it to edit; its empty
 *   boxes are MathLive placeholders. Before MathLive has loaded, a chip is a
 *   still KaTeX rendering of the same source.
 * - **The value** that leaves is plain text with `$…$` formulas, exactly what
 *   a textarea held — src/lib/mathDraft.js. A formula nobody edited keeps its
 *   source byte for byte, so loading a draft saves nothing.
 *
 * Keys, inside a formula: Tab / Shift+Tab go to the next / previous box and,
 * past the last, out into the sentence (MathLive's `move-out`); the arrows do
 * the same at the edges; Enter and Escape leave the formula (Enter never sends
 * from inside one — a half-filled formula is not sent by accident); Backspace
 * in an emptied formula removes it. In prose: Enter calls `onEnter` (the chat
 * sends) or, without one, starts a new line; Shift+Enter is always a new line.
 *
 * `ref` exposes `insert(id)`, `nextBlank()` and `focus()` for the maths row.
 * `onUnavailable` is called if MathLive cannot load; the parent then falls
 * back to a plain textarea.
 */

const ZWSP = '​'
const isChip = (node) => node?.nodeType === 1 && node.classList.contains('mi-chip')
const fieldOf = (chip) => chip?.querySelector('math-field') ?? null

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
  // The latest props, for listeners attached once.
  const props = useRef({})
  useEffect(() => {
    props.current = { onChange, maxLength, onEnter, onUnavailable }
  })

  /* ── building the DOM from text ─────────────────────────── */

  const staticChip = (chip, latex) => {
    const face = document.createElement('span')
    face.className = 'mi-static'
    face.innerHTML = katex.renderToString(latex, { throwOnError: false })
    chip.append(face)
  }

  const fieldChip = (chip, latex) => {
    const field = createField(Field.current, latex)
    field.addEventListener('focusin', () => {
      const left = leaving.current
      if (left?.chip === chip && performance.now() < left.until) {
        setTimeout(() => leave(chip, left.side))
        return
      }
      place.current = { chip }
    })
    // A tap or click on the formula is the student choosing it: no guard.
    field.addEventListener(
      'pointerdown',
      () => {
        leaving.current = null
      },
      { capture: true },
    )
    field.addEventListener('input', () => {
      chip.dataset.latex = field.value
      chip.dataset.fresh = '1'
      emit()
    })
    field.addEventListener('move-out', (event) => {
      event.preventDefault()
      const side = { backward: 'before', forward: 'after' }[event.detail?.direction]
      if (side) leave(chip, side)
    })
    field.addEventListener(
      'keydown',
      (event) => {
        if (event.ctrlKey || event.metaKey || event.altKey) return
        const handled = {
          Tab: () => field.executeCommand(event.shiftKey ? 'moveToPreviousPlaceholder' : 'moveToNextPlaceholder'),
          Enter: () => leave(chip, 'after'),
          Escape: () => leave(chip, 'after'),
          Backspace: () => {
            if (cleanLatex(field.value)) return false
            remove(chip)
          },
        }[event.key]
        if (!handled || handled() === false) return
        event.preventDefault()
        event.stopPropagation()
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
   * somewhere to stand — a browser will not put it in an empty one (which is
   * what splitting a text node to insert a chip leaves behind).
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

  const read = () => {
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
    walk(root.current)
    flush()
    // The browser's own trailing <br> (what makes an empty last line visible)
    // is not a line of its own.
    const last = [...root.current.childNodes].reverse().find((n) => n.nodeType !== 3 || n.nodeValue.replaceAll(ZWSP, ''))
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
   * tap for is sent straight back out.
   */
  function leave(chip, side) {
    if (!chip.isConnected) return
    leaving.current = { chip, side, until: performance.now() + 250 }
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

  function remove(chip) {
    const previous = chip.previousSibling
    const offset = previous?.nodeType === 3 ? previous.nodeValue.length : 0
    chip.remove()
    root.current.normalize()
    if (previous?.isConnected) caretAt(previous, offset)
    else caretAt(root.current, 0)
    anchor()
    emit()
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
      if (event.inputType.startsWith('format')) event.preventDefault()
    }
    const onInput = () => emit()
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
    const onSelectionChange = () => {
      const selection = window.getSelection()
      if (document.activeElement !== node || !selection.rangeCount) return
      const range = selection.getRangeAt(0)
      if (node.contains(range.startContainer)) place.current = { range: range.cloneRange() }
    }

    node.addEventListener('keydown', onKeyDown)
    node.addEventListener('beforeinput', onBeforeInput)
    node.addEventListener('input', onInput)
    node.addEventListener('paste', onPaste)
    node.addEventListener('drop', onDrop)
    node.addEventListener('compositionstart', onCompositionStart)
    node.addEventListener('compositionend', onCompositionEnd)
    document.addEventListener('selectionchange', onSelectionChange)
    return () => {
      node.removeEventListener('keydown', onKeyDown)
      node.removeEventListener('beforeinput', onBeforeInput)
      node.removeEventListener('input', onInput)
      node.removeEventListener('paste', onPaste)
      node.removeEventListener('drop', onDrop)
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
      if (!boxes || !field.value.includes('\\placeholder')) leave(created, 'after')
      emit()
    },

    /** "Next blank →": the next box in this formula, then out; from prose, the next formula with a box. */
    nextBlank() {
      const chip = place.current?.chip
      if (chip?.isConnected && fieldOf(chip)) {
        fieldOf(chip).executeCommand('moveToNextPlaceholder')
        return
      }
      const range = proseRange()
      const target = [...root.current.querySelectorAll('.mi-chip')].find(
        (each) =>
          fieldOf(each)?.value.includes('\\placeholder') &&
          range.comparePoint(each, 0) >= 0,
      )
      if (!target) {
        root.current.focus({ preventScroll: true })
        return
      }
      const field = fieldOf(target)
      field.focus()
      field.position = 0
      field.executeCommand('moveToNextPlaceholder')
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
