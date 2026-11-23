import { useEffect, useId, useRef, useState } from 'react'
import { useI18n } from '../lib/i18n'
import { MATH_BUTTONS } from '../lib/mathDraft'
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

/**
 * Pressing a button must not take focus from the text box: on a phone that
 * would close the keyboard. The press still counts as a click.
 */
const keepFocus = (event) => event.preventDefault()

/**
 * The "Maths" toggle and the row of structure and symbol buttons over a
 * student's text box — MathInput.jsx owns where they start and what they do.
 *
 * - "Remove formula" shows on the top line while a formula is being edited or
 *   marked (by a first Backspace), and takes it out with one tap.
 * - One tab stop for the symbol row, arrow keys along it (a toolbar).
 * - The row is one line that scrolls sideways; the edge with more buttons
 *   beyond it fades. The hovered or focused button's name shows in words.
 */
export default function MathTools({ open, onToggle, onInsert, canRemove, onRemove, controls }) {
  const { t } = useI18n()
  const [focus, setFocus] = useState(0)
  const [named, setNamed] = useState(null)
  const [edges, setEdges] = useState({ left: false, right: false })
  const buttons = useRef([])
  const bar = useRef(null)
  const barId = useId()

  // Fade whichever edge of the row still has buttons beyond it.
  useEffect(() => {
    const node = bar.current
    if (!node) return undefined
    const measure = () => {
      const left = node.scrollLeft > 1
      const right = node.scrollLeft + node.clientWidth < node.scrollWidth - 1
      setEdges((was) => (was.left === left && was.right === right ? was : { left, right }))
    }
    measure()
    node.addEventListener('scroll', measure, { passive: true })
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null
    observer?.observe(node)
    return () => {
      node.removeEventListener('scroll', measure)
      observer?.disconnect()
    }
  }, [open])

  const move = (event) => {
    const last = MATH_BUTTONS.length - 1
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
    <div className="mt-tools">
      <div className="mt-head">
        <button
          type="button"
          className="mt-toggle"
          aria-expanded={open}
          aria-controls={open ? barId : undefined}
          onPointerDown={keepFocus}
          onMouseDown={keepFocus}
          onClick={onToggle}
        >
          {t('math.toggle')}
        </button>
        {canRemove ? (
          <button
            type="button"
            className="mt-remove"
            onPointerDown={keepFocus}
            onMouseDown={keepFocus}
            onClick={onRemove}
          >
            <span aria-hidden="true">×</span> {t('math.remove')}
          </button>
        ) : null}
        {/* The hovered or focused button's name, in words. The buttons carry
            the same name as their label for screen readers. */}
        {open ? (
          <span className="mt-name" aria-hidden="true">
            {named ? t(NAMES[named]) : ''}
          </span>
        ) : null}
      </div>

      {open ? (
        <div className="mt-bar-wrap" data-more-left={edges.left} data-more-right={edges.right}>
          <div
            id={barId}
            ref={bar}
            className="mt-bar"
            role="toolbar"
            aria-label={t('math.bar')}
            aria-controls={controls}
            onKeyDown={move}
          >
            {MATH_BUTTONS.map((button, index) => (
              <button
                key={button.id}
                ref={(node) => {
                  buttons.current[index] = node
                }}
                type="button"
                className="mt-btn"
                tabIndex={index === focus ? 0 : -1}
                aria-label={t(NAMES[button.id])}
                title={t(NAMES[button.id])}
                onPointerDown={keepFocus}
                onMouseDown={keepFocus}
                onFocus={() => {
                  setFocus(index)
                  setNamed(button.id)
                }}
                onBlur={() => setNamed(null)}
                onMouseEnter={() => setNamed(button.id)}
                onMouseLeave={() => setNamed(null)}
                onClick={() => {
                  // A finger never "leaves" the button, so its name goes now.
                  setNamed(null)
                  onInsert(button.id)
                }}
              >
                <span aria-hidden="true">
                  <MathText text={`$${button.label}$`} />
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
