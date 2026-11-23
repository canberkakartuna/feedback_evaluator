import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { useI18n } from '../lib/i18n'
import { hasMath } from '../lib/latex'
import { MATH_SNIPPETS, insertMath, nextBlank, previousBlank, showBlanks } from '../lib/mathInsert'
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

/** The short guide, one step at a time, each with what is typed and what is seen. */
const GUIDE = [
  { title: 'math.tutorial.fractionTitle', text: 'math.tutorial.fractionText', example: '$\\frac{3}{4}$' },
  { title: 'math.tutorial.powerTitle', text: 'math.tutorial.powerText', example: '$x^{2}$' },
  { title: 'math.tutorial.blanksTitle', text: 'math.tutorial.blanksText', example: '$\\int_{0}^{1}{}\\,dx$' },
  { title: 'math.tutorial.previewTitle', text: 'math.tutorial.previewText', example: '$\\sqrt{x^{2}+1}$' },
]

/** Set once the guide has been closed, in any box; it then opens only from "?". */
const GUIDE_SEEN_KEY = 'feedback-evaluator.mathGuideSeen'

/**
 * Which box is showing the guide by itself right now. With the answer box and
 * the chat both on screen, only the first to open shows it.
 */
let guideOwner = null

/** The student's own choice: true / false, or null when they never made one. */
function readChoice(key) {
  try {
    const stored = localStorage.getItem(key)
    return stored === 'open' ? true : stored === 'closed' ? false : null
  } catch {
    return null
  }
}

function writeChoice(key, open) {
  try {
    localStorage.setItem(key, open ? 'open' : 'closed')
  } catch {
    // Private mode or blocked storage: the row still works, it just is not remembered.
  }
}

function readGuideSeen() {
  try {
    return localStorage.getItem(GUIDE_SEEN_KEY) === 'yes'
  } catch {
    // No storage, no memory: better to show the guide than to never show it.
    return false
  }
}

function writeGuideSeen() {
  try {
    localStorage.setItem(GUIDE_SEEN_KEY, 'yes')
  } catch {
    // As above.
  }
}

/**
 * A "Maths" toggle, a row of symbol buttons, a short guide and a rendered
 * preview, for any textarea a student writes maths in — the tutor's message
 * box and the answer box. Render it just before the textarea.
 *
 * The textarea stays the parent's: this only reads its cursor through
 * `inputRef` and hands the new text to `onChange`, exactly as typing would, so
 * whatever the parent does on a change (autosave, counters) still happens.
 * What a button inserts, and where Tab goes, is src/lib/mathInsert.js.
 *
 * - Open or closed: the student's own choice when they made one (remembered
 *   per browser under `storageKey`, written only when they press the toggle),
 *   otherwise `defaultOpen` — the activity's setting, see MATH_TOOLS in
 *   shared/activity.js.
 * - Tab inside a formula goes to its next empty blank and then out past it;
 *   Shift+Tab goes back. Anywhere else Tab is left alone, so focus is never
 *   trapped. "Next blank" does the same for touch screens, which have no Tab.
 * - One tab stop for the symbol row, arrow keys along it (a toolbar). Every
 *   button is type="button", so Enter on one presses it and never sends.
 * - The guide opens by itself the first time a student sees the row, and from
 *   "?" after that. It sits in the page, not over it: nothing is blocked, and
 *   Escape or its buttons close it.
 * - `maxLength` is the server's limit for that box (mathInsert.js); a button
 *   that would pass it does nothing. Omitted, it is the tutor message's.
 * - The preview appears only when the text has maths in it, draws empty
 *   blanks as boxes, and is not a live region: a screen reader would
 *   otherwise read the formula out again on every keystroke.
 */
export default function MathTools({
  inputRef,
  value,
  onChange,
  inputId,
  storageKey,
  maxLength,
  defaultOpen = false,
}) {
  const { t } = useI18n()
  const [choice, setChoice] = useState(() => readChoice(storageKey))
  const open = choice ?? Boolean(defaultOpen)
  const [focus, setFocus] = useState(0)
  const [named, setNamed] = useState(null)
  const [guide, setGuide] = useState(null) // null, or the step shown
  const [edges, setEdges] = useState({ left: false, right: false })
  const buttons = useRef([])
  const bar = useRef(null)
  const helpButton = useRef(null)
  const guideBox = useRef(null)
  const guideTitle = useRef(null)
  const focusGuide = useRef(false)
  // Where the cursor goes once a button's text is in the box.
  const caret = useRef(null)
  const barId = useId()
  const guideId = useId()

  useLayoutEffect(() => {
    const node = inputRef.current
    if (!node || !caret.current) return
    const [start, end] = caret.current
    caret.current = null
    node.focus()
    node.setSelectionRange(start, end)
  }, [value, inputRef])

  // The guide, by itself, the first time the row is seen open.
  useEffect(() => {
    if (!open || guide !== null || readGuideSeen()) return
    if (guideOwner && guideOwner !== guideId) return
    guideOwner = guideId
    setGuide(0)
  }, [open, guide, guideId])

  useEffect(
    () => () => {
      if (guideOwner === guideId) guideOwner = null
    },
    [guideId],
  )

  // Opened from "?": move focus into it, so a keyboard user lands on the words.
  useLayoutEffect(() => {
    if (guide === null || !focusGuide.current) return
    focusGuide.current = false
    guideTitle.current?.focus()
  }, [guide])

  const closeGuide = () => {
    writeGuideSeen()
    if (guideOwner === guideId) guideOwner = null
    const hadFocus = guideBox.current?.contains(document.activeElement)
    setGuide(null)
    if (hadFocus) helpButton.current?.focus()
  }

  // Latest closeGuide for the textarea's own key listener below.
  const guideState = useRef({ open: false, close: closeGuide })
  useEffect(() => {
    guideState.current = { open: guide !== null, close: closeGuide }
  })

  // Tab between blanks, and Escape for the guide, on the parent's textarea.
  useEffect(() => {
    const node = inputRef.current
    if (!node) return undefined
    const onKey = (event) => {
      if (event.key === 'Escape' && guideState.current.open) {
        guideState.current.close()
        return
      }
      if (event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey) return
      const move = (event.shiftKey ? previousBlank : nextBlank)(
        node.value,
        node.selectionStart,
        node.selectionEnd,
      )
      if (!move) return
      event.preventDefault()
      node.setSelectionRange(move.selectionStart, move.selectionEnd)
    }
    node.addEventListener('keydown', onKey)
    return () => node.removeEventListener('keydown', onKey)
  }, [inputRef])

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

  const toggle = () => {
    const next = !open
    setChoice(next)
    writeChoice(storageKey, next)
    if (!next && guide !== null) closeGuide()
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

  const jump = () => {
    const node = inputRef.current
    if (!node) return
    const move = nextBlank(node.value, node.selectionStart, node.selectionEnd)
    node.focus()
    if (move) node.setSelectionRange(move.selectionStart, move.selectionEnd)
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

  const step = guide === null ? null : GUIDE[guide]

  return (
    <>
      <div className="mt-tools">
        <div className="mt-head">
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
            <>
              {/* The hovered or focused button's name, in words. The buttons
                  carry the same name as their label for screen readers. */}
              <span className="mt-name" aria-hidden="true">
                {named ? t(NAMES[named]) : ''}
              </span>
              <button type="button" className="mt-next" title={t('math.nextBlankHint')} onClick={jump}>
                {t('math.nextBlank')} <span aria-hidden="true">→</span>
              </button>
              <button
                type="button"
                ref={helpButton}
                className="mt-help"
                aria-label={t('math.help')}
                title={t('math.help')}
                aria-expanded={guide !== null}
                aria-controls={guide !== null ? guideId : undefined}
                onClick={() => {
                  if (guide !== null) {
                    closeGuide()
                    return
                  }
                  focusGuide.current = true
                  setGuide(0)
                }}
              >
                ?
              </button>
            </>
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
                  onFocus={() => {
                    setFocus(index)
                    setNamed(snippet.id)
                  }}
                  onBlur={() => setNamed(null)}
                  onMouseEnter={() => setNamed(snippet.id)}
                  onMouseLeave={() => setNamed(null)}
                  onClick={() => insert(snippet.id)}
                >
                  <span aria-hidden="true">
                    <MathText text={`$${snippet.label}$`} />
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      {step ? (
        <section
          id={guideId}
          ref={guideBox}
          className="mt-guide"
          aria-label={t('math.tutorial.title')}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation()
              closeGuide()
            }
          }}
        >
          <div className="mt-guide-top">
            <p className="mt-guide-step mono">
              {t('math.tutorial.step', { current: guide + 1, total: GUIDE.length })}
            </p>
            <button type="button" className="mt-guide-x" aria-label={t('math.tutorial.close')} onClick={closeGuide}>
              <span aria-hidden="true">×</span>
            </button>
          </div>
          <h3 ref={guideTitle} className="mt-guide-title" tabIndex={-1}>
            {t(step.title)}
          </h3>
          <p className="mt-guide-text">{t(step.text)}</p>
          <div className="mt-guide-example">
            <div>
              <p className="mt-guide-label mono">{t('math.tutorial.youType')}</p>
              <code className="mt-guide-code">{step.example}</code>
            </div>
            <div>
              <p className="mt-guide-label mono">{t('math.tutorial.theySee')}</p>
              <p className="mt-guide-seen">
                <MathText text={showBlanks(step.example)} />
              </p>
            </div>
          </div>
          <div className="mt-guide-nav">
            {guide > 0 ? (
              <button type="button" className="mt-guide-btn" onClick={() => setGuide(guide - 1)}>
                {t('math.tutorial.back')}
              </button>
            ) : null}
            {guide < GUIDE.length - 1 ? (
              <button type="button" className="mt-guide-btn mt-guide-primary" onClick={() => setGuide(guide + 1)}>
                {t('math.tutorial.next')}
              </button>
            ) : (
              <button type="button" className="mt-guide-btn mt-guide-primary" onClick={closeGuide}>
                {t('math.tutorial.done')}
              </button>
            )}
          </div>
        </section>
      ) : null}

      {hasMath(value) ? (
        <div className="mt-preview" aria-live="off">
          <p className="mt-preview-label mono">{t('math.preview')}</p>
          <p className="mt-preview-text">
            <MathText text={showBlanks(value)} />
          </p>
        </div>
      ) : null}
    </>
  )
}
