import { useState } from 'react'
import { LIMITS } from '../../../shared/activity'
import { api } from '../../lib/api'
import { useI18n } from '../../lib/i18n'
import { TUTOR_PRESETS, withPreset } from '../../lib/tutorGuide'

/**
 * The activity's own guidance for the AI tutor (`activity.tutorPrompt`).
 *
 * One field rather than one per language: it is read by the model, not by a
 * student, and the model follows it whatever language it is written in. It is
 * added to the system-wide AI prompt for this activity's questions — never in
 * place of it — and no student payload carries it (see services/tutor.js and
 * services/delivery.js).
 *
 * Two helpers, and neither may overwrite what the teacher wrote without them
 * choosing to:
 *
 * - **Templates** fill an empty box, or go on the end of a written one (see
 *   withPreset in src/lib/tutorGuide.js), in the interface language.
 * - **Improve with AI** asks the server for a rewrite and shows it beside the
 *   teacher's text, to use or to keep their own. Nothing is saved until Save.
 *
 * Keyed by the stored text where it is used, so a save starts it afresh from
 * what the server kept, and saving any other setting does not wipe a draft.
 */
export default function TutorGuidance({ activity, busy, onSave }) {
  const { lang, t } = useI18n()
  const stored = activity.tutorPrompt ?? ''
  const max = LIMITS.tutorPrompt

  const [text, setText] = useState(stored)
  const [notice, setNotice] = useState(null)
  const [enhancing, setEnhancing] = useState(false)
  const [suggestion, setSuggestion] = useState(null)

  const changed = text.trim() !== stored.trim()

  const pick = (preset) => {
    const result = withPreset(text, t(preset.text), max)
    if (!result) {
      setNotice({ tone: 'warn', text: t('tutorGuide.presetTooLong', { max }) })
      return
    }
    setText(result.text)
    setNotice(result.appended ? { tone: 'good', text: t('tutorGuide.presetAppended') } : null)
  }

  const enhance = async () => {
    if (!text.trim() || enhancing) return
    setEnhancing(true)
    setNotice(null)
    setSuggestion(null)
    try {
      const result = await api.enhanceTutorPrompt({ text, lang })
      setSuggestion(result.text)
    } catch (failure) {
      setNotice({ tone: 'bad', text: t('tutorGuide.enhanceFailed', { message: failure.message }) })
    } finally {
      setEnhancing(false)
    }
  }

  const reset = () => {
    setText(stored)
    setSuggestion(null)
    setNotice(null)
  }

  return (
    <div className="cs-form" style={{ marginTop: 'var(--s-4)' }}>
      <div className="cs-field">
        <label className="cs-label" htmlFor="activity-tutor-prompt">
          {t('tutorGuide.head')} <span style={{ textTransform: 'none' }}>{t('common.optional')}</span>
        </label>
        <p className="cs-hint">{t('tutorGuide.hint')}</p>

        <div className="cs-actions" style={{ flexWrap: 'wrap' }} role="group" aria-label={t('tutorGuide.presetsLabel')}>
          <span className="cs-hint">{t('tutorGuide.presetsLabel')}:</span>
          {TUTOR_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className="cs-btn cs-btn-sm"
              disabled={busy || enhancing}
              title={t(preset.text)}
              onClick={() => pick(preset)}
            >
              {t(preset.label)}
            </button>
          ))}
        </div>

        <textarea
          id="activity-tutor-prompt"
          className="cs-textarea"
          rows={5}
          maxLength={max}
          disabled={busy}
          placeholder={t('tutorGuide.placeholder')}
          value={text}
          onChange={(event) => {
            setText(event.target.value)
            setNotice(null)
          }}
        />
        <p className="cs-hint mono">{t('tutorGuide.count', { count: text.length, max })}</p>
      </div>

      {notice ? (
        <p className="cs-note" data-tone={notice.tone} role={notice.tone === 'bad' ? 'alert' : 'status'}>
          {notice.text}
        </p>
      ) : null}

      {suggestion ? (
        <div className="cs-note" role="region" aria-label={t('tutorGuide.suggestionHead')}>
          <p className="eyebrow" style={{ margin: 0 }}>
            <span aria-hidden="true">✦</span> {t('tutorGuide.suggestionHead')}
          </p>
          <p style={{ whiteSpace: 'pre-wrap', color: 'var(--ink)' }}>{suggestion}</p>
          <p className="cs-hint">{t('tutorGuide.suggestionHint')}</p>
          <div className="cs-actions">
            <button
              type="button"
              className="cs-btn cs-btn-primary cs-btn-sm"
              onClick={() => {
                setText(suggestion)
                setSuggestion(null)
              }}
            >
              {t('tutorGuide.useSuggestion')}
            </button>
            <button type="button" className="cs-btn cs-btn-sm" onClick={() => setSuggestion(null)}>
              {t('tutorGuide.keepMine')}
            </button>
          </div>
        </div>
      ) : null}

      <div className="cs-actions" style={{ flexWrap: 'wrap' }}>
        <button
          type="button"
          className="cs-btn cs-btn-sm"
          disabled={busy || enhancing || !text.trim()}
          onClick={enhance}
        >
          <span aria-hidden="true">✦</span> {enhancing ? t('tutorGuide.enhancing') : t('tutorGuide.enhance')}
        </button>
        {changed ? (
          <>
            <button
              type="button"
              className="cs-btn cs-btn-primary cs-btn-sm"
              disabled={busy || enhancing}
              onClick={() => onSave({ tutorPrompt: text })}
            >
              {busy ? t('common.saving') : t('tutorGuide.save')}
            </button>
            <button type="button" className="cs-btn cs-btn-sm" disabled={busy} onClick={reset}>
              {t('common.cancel')}
            </button>
          </>
        ) : null}
      </div>
    </div>
  )
}
