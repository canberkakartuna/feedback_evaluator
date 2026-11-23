import { useEffect, useId, useRef, useState } from 'react'
import { canUseMathEditor } from '../lib/mathlive'
import MathEditor from './MathEditor'
import MathTools from './MathTools'

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

/**
 * A student's text box that can hold maths — the tutor's message box and the
 * answer box: the maths row (MathTools) over the editor (MathEditor), plus
 * whatever the parent puts beside the box (`children`, e.g. Send).
 *
 * The value in and out is plain text with `$…$` formulas, as a textarea's was
 * (src/lib/mathDraft.js), so the parent's saving, counting and sending are
 * unchanged.
 *
 * - The row starts open when the student opened it themselves (remembered per
 *   browser under `storageKey`, written only when they press the toggle),
 *   otherwise on the activity's setting, `defaultOpen` — MATH_TOOLS in
 *   shared/activity.js. Opening it loads the formula editor ahead of the first
 *   button press.
 * - If the formula editor cannot run here or fails to load, the box falls back
 *   to a plain textarea showing the same text, so a student can always answer.
 */
export default function MathInput({
  id,
  label,
  className,
  rowClassName,
  toolsClassName,
  value,
  onChange,
  placeholder,
  maxLength,
  onEnter,
  spellCheck,
  storageKey,
  defaultOpen = false,
  children,
}) {
  const [choice, setChoice] = useState(() => readChoice(storageKey))
  const open = choice ?? Boolean(defaultOpen)
  const [plain, setPlain] = useState(() => !canUseMathEditor())
  const [formula, setFormula] = useState(false)
  const editor = useRef(null)
  const labelId = useId()

  useEffect(() => {
    if (open && !plain) editor.current?.preload()
  }, [open, plain])

  const toggle = () => {
    const next = !open
    setChoice(next)
    writeChoice(storageKey, next)
  }

  return (
    <>
      {plain ? null : (
        <div className={toolsClassName}>
          <MathTools
            open={open}
            controls={id}
            onToggle={toggle}
            onInsert={(buttonId) => editor.current?.insert(buttonId)}
            canRemove={formula}
            onRemove={() => editor.current?.removeFormula()}
          />
        </div>
      )}

      <div className={rowClassName}>
        <label className="sr-only" id={labelId} htmlFor={plain ? id : undefined}>
          {label}
        </label>
        {plain ? (
          <textarea
            id={id}
            className={className}
            rows={1}
            value={value}
            placeholder={placeholder}
            spellCheck={spellCheck}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              if (onEnter && event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                onEnter()
              }
            }}
          />
        ) : (
          <MathEditor
            ref={editor}
            id={id}
            labelId={labelId}
            className={className}
            value={value}
            onChange={onChange}
            placeholder={placeholder}
            maxLength={maxLength}
            onEnter={onEnter}
            spellCheck={spellCheck}
            wantMath={open}
            onFormula={setFormula}
            onUnavailable={() => setPlain(true)}
          />
        )}
        {children}
      </div>
    </>
  )
}
