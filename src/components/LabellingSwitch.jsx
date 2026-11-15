import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import { useT } from '../lib/i18n'

/** How long "Saved" stays up, as on the labelling screen. */
const SAVED_FOR_MS = 2500

/**
 * Whether one teacher may use the labelling screen — `canLabel` on their
 * account (shared/roles.js `teacherCanLabel`), switched by an admin or the
 * teacher's own manager. Used on People and on Teachers.
 *
 * A toggle button like keep-or-drop on the labelling screen: the label stays
 * "Can label", and the tick, the colour and `aria-pressed` carry whether it is
 * on; "off" is also said in words, since that is the state worth noticing in
 * a long list. It takes effect the next time the teacher's console loads `me`;
 * nothing is pushed to a teacher who already has it open.
 *
 * `onChange` is given the updated user the server answered with, so the
 * caller can fold it into its list instead of refetching everything.
 */
export default function LabellingSwitch({ teacher, onChange }) {
  const t = useT()
  const [save, setSave] = useState(null)
  const timer = useRef(null)
  const on = teacher.canLabel !== false

  useEffect(() => () => clearTimeout(timer.current), [])

  const flip = async () => {
    clearTimeout(timer.current)
    setSave({ state: 'saving' })
    try {
      const { user } = await api.updateUser(teacher.id, { canLabel: !on })
      onChange?.(user)
      setSave({ state: 'saved' })
      timer.current = setTimeout(() => setSave(null), SAVED_FOR_MS)
    } catch (failure) {
      setSave({ state: 'failed', message: failure.message })
    }
  }

  return (
    <span className="cs-switch">
      <button
        type="button"
        className="cs-btn cs-btn-sm cs-switch-btn"
        aria-pressed={on}
        disabled={save?.state === 'saving'}
        onClick={flip}
      >
        {on ? '✓ ' : ''}
        {t('teachers.canLabel')}
      </button>
      {on ? null : (
        <span className="cs-pill" data-tone="quiet">
          {t('teachers.labellingOff')}
        </span>
      )}
      <span className="cs-save" data-state={save?.state ?? 'idle'} aria-live="polite">
        {save?.state === 'saving'
          ? t('labelling.saving')
          : save?.state === 'saved'
            ? t('labelling.saved')
            : save?.state === 'failed'
              ? t('labelling.saveFailed', { message: save.message })
              : ''}
      </span>
    </span>
  )
}
