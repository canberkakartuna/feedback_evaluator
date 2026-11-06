import { useState } from 'react'
import { PROMPT_LANGS } from '../../shared/activity'
import { api } from '../lib/api'
import { useT } from '../lib/i18n'
import './BilingualField.css'

/**
 * One piece of a teacher's text written in both interface languages, side by
 * side — an activity's name, a question's wording.
 *
 * Side by side rather than behind tabs, because the job is keeping two
 * versions in step, and that means reading one while writing the other.
 *
 * Each language says where it stands: written, or blank and falling back to
 * the other (see textFor in shared/activity.js — a blank language is never a
 * blank card for a student, it shows the version that *was* written). When
 * the other language has text, an AI button drafts this one from it. The
 * draft lands in the box and is marked as one; nothing is saved until the
 * teacher saves the form, so a bad translation is caught by the person who
 * knows what the question meant.
 *
 * `onChange(lang, text)` rather than a whole object, so a translation that
 * comes back while the teacher is typing in the other box cannot overwrite
 * what they typed with a stale copy.
 */
/** Each language's own name, as a lookup so the string check can see both keys. */
const LANG_NAME = { en: 'bilingual.en', tr: 'bilingual.tr' }

export default function BilingualField({
  id,
  label,
  hint,
  values,
  onChange,
  multiline = false,
  rows = 3,
  maxLength,
  placeholder,
  disabled = false,
  renderExtra,
}) {
  const t = useT()
  const [translating, setTranslating] = useState(null)
  const [drafted, setDrafted] = useState({})
  const [error, setError] = useState(null)

  const name = (lang) => t(LANG_NAME[lang])
  const otherOf = (lang) => PROMPT_LANGS.find((other) => other !== lang)
  const filled = (lang) => Boolean(values[lang]?.trim())

  const edit = (lang, text) => {
    setDrafted((prior) => ({ ...prior, [lang]: false }))
    setError(null)
    onChange(lang, text)
  }

  const translateInto = async (lang) => {
    const from = otherOf(lang)
    if (!filled(from)) return
    if (filled(lang) && !window.confirm(t('bilingual.overwrite', { lang: name(lang) }))) return

    setTranslating(lang)
    setError(null)
    try {
      const { text } = await api.translate({ text: values[from], from, to: lang })
      onChange(lang, text)
      setDrafted((prior) => ({ ...prior, [lang]: true }))
    } catch (failure) {
      setError(failure.message)
    } finally {
      setTranslating(null)
    }
  }

  return (
    <fieldset className="bl" disabled={disabled}>
      <legend className="cs-label">{label}</legend>

      <div className="bl-cols">
        {PROMPT_LANGS.map((lang) => {
          const other = otherOf(lang)
          const inputId = `${id}-${lang}`
          const Input = multiline ? 'textarea' : 'input'

          return (
            <div key={lang} className="bl-col" lang={lang}>
              <div className="bl-head">
                <label className="bl-lang" htmlFor={inputId}>
                  {name(lang)}
                </label>
                {filled(lang) ? (
                  <span className="cs-pill" data-tone="live" aria-label={t('bilingual.written')}>
                    ✓
                  </span>
                ) : filled(other) ? (
                  <span className="cs-pill" data-tone="draft">
                    {t('bilingual.blank')}
                  </span>
                ) : null}

                {filled(other) ? (
                  <button
                    type="button"
                    className="cs-btn cs-btn-sm bl-ai"
                    disabled={Boolean(translating)}
                    onClick={() => translateInto(lang)}
                  >
                    <span aria-hidden="true">✦</span>{' '}
                    {translating === lang
                      ? t('bilingual.translating')
                      : t('bilingual.translateFrom', { lang: name(other) })}
                  </button>
                ) : null}
              </div>

              <Input
                id={inputId}
                className={multiline ? 'cs-textarea' : 'cs-input'}
                rows={multiline ? rows : undefined}
                maxLength={maxLength}
                placeholder={placeholder?.[lang]}
                value={values[lang] ?? ''}
                readOnly={translating === lang}
                onChange={(event) => edit(lang, event.target.value)}
              />

              {drafted[lang] ? (
                <p className="cs-hint bl-drafted">{t('bilingual.drafted')}</p>
              ) : !filled(lang) && filled(other) ? (
                <p className="cs-hint">{t('bilingual.fallsBack', { lang: name(other) })}</p>
              ) : null}

              {renderExtra?.(lang, values[lang] ?? '')}
            </div>
          )
        })}
      </div>

      {/* Not once both boxes are empty again — the form was reset, and an
          error about a translation of nothing would be about nothing. */}
      {error && PROMPT_LANGS.some(filled) ? (
        <p className="cs-note" data-tone="bad" role="alert">
          {error}
        </p>
      ) : null}
      {hint ? <p className="cs-hint">{hint}</p> : null}
    </fieldset>
  )
}
