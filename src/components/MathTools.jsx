import { useId, useLayoutEffect, useRef, useState } from 'react'
import { useI18n } from '../lib/i18n'
import { hasMath } from '../lib/latex'
import { MATH_SNIPPETS, insertMath } from '../lib/mathInsert'
import MathText from './MathText'
import './MathTools.css'

/** The accessible name of each button. */
const NAMES = {
  power: 'math.power',
  subscript: 'math.subscript',
  fraction: 'math.fraction',
  sqrt: 'math.sqrt',
  integral: 'math.integral',
  sum: 'math.sum',
  pi: 'math.pi',
  infinity: 'math.infinity',
  le: 'math.le',
  ge: 'math.ge',
  ne: 'math.ne',
  times: 'math.times',
  divide: 'math.divide',
}

function readOpen(key) {
  try {
    return localStorage.getItem(key) === 'open'
  } catch {
    return false
  }
}

function writeOpen(key, open) {
  try {
    localStorage.setItem(key, open ? 'open' : 'closed')
  } catch {
    // Private mode or blocked storage: the row still works, it just is not remembered.
  }
}

/**
 * A "Maths" toggle, a row of symbol buttons and a rendered preview, for any
 * textarea a student writes maths in — the tutor's message box and the answer
 * box. Render it just before the textarea.
 *
 * The textarea stays the parent's: this only reads its cursor through
 * `inputRef` and hands the new text to `onChange`, exactly as typing would, so
 * whatever the parent does on a change (autosave, counters) still happens.
 * What a button inserts is src/lib/mathInsert.js.
 *
 * - Hidden until the student opens it; open or closed is remembered per
 *   browser under `storageKey`.
 * - One tab stop for the row, arrow keys along it (a toolbar). The buttons
 *   are type="button", so Enter on one presses it and never sends or submits.
 * - `maxLength` is the server's limit for that box (mathInsert.js); a button
 *   that would pass it does nothing. Omitted, it is the tutor message's.
 * - The preview appears only when the text has maths in it, and is not a live
 *   region: a screen reader would otherwise read the formula out again on
 *   every keystroke.
 */
export default function MathTools({ inputRef, value, onChange, inputId, storageKey, maxLength }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(() => readOpen(storageKey))
  const [focus, setFocus] = useState(0)
  const buttons = useRef([])
  // Where the cursor goes once a button's text is in the box.
  const caret = useRef(null)
  const barId = useId()

  useLayoutEffect(() => {
    const node = inputRef.current
    if (!node || !caret.current) return
    const [start, end] = caret.current
    caret.current = null
    node.focus()
    node.setSelectionRange(start, end)
  }, [value, inputRef])

  const toggle = () => {
    const next = !open
    setOpen(next)
    writeOpen(storageKey, next)
  }

  const insert = (id) => {
    const node = inputRef.current
    const result = insertMath(value, node?.selectionStart, node?.selectionEnd, id, maxLength)
    if (!result) {
      node?.focus()
      return
    }
    caret.current = [result.selectionStart, result.selectionEnd]
    onChange(result.text)
  }

  const move = (event) => {
    const last = MATH_SNIPPETS.length - 1
    const to = {
      ArrowRight: Math.min(focus + 1, last),
      ArrowLeft: Math.max(focus - 1, 0),
      Home: 0,
      End: last,
    }[event.key]
    if (to === undefined) return
    event.preventDefault()
    setFocus(to)
    buttons.current[to]?.focus()
  }

  return (
    <>
      <div className="mt-tools">
        <button
          type="button"
          className="mt-toggle"
          aria-expanded={open}
          aria-controls={open ? barId : undefined}
          onClick={toggle}
        >
          {t('math.toggle')}
        </button>
        {open ? (
          <div
            id={barId}
            className="mt-bar"
            role="toolbar"
            aria-label={t('math.bar')}
            aria-controls={inputId}
            onKeyDown={move}
          >
            {MATH_SNIPPETS.map((snippet, index) => (
              <button
                key={snippet.id}
                ref={(node) => {
                  buttons.current[index] = node
                }}
                type="button"
                className="mt-btn"
                tabIndex={index === focus ? 0 : -1}
                aria-label={t(NAMES[snippet.id])}
                title={t(NAMES[snippet.id])}
                onFocus={() => setFocus(index)}
                onClick={() => insert(snippet.id)}
              >
                <span aria-hidden="true">
                  <MathText text={`$${snippet.label}$`} />
                </span>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {hasMath(value) ? (
        <div className="mt-preview" aria-live="off">
          <p className="mt-preview-label mono">{t('math.preview')}</p>
          <p className="mt-preview-text">
            <MathText text={value} />
          </p>
        </div>
      ) : null}
    </>
  )
}
