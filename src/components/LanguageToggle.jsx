import { LANGUAGES, useI18n } from '../lib/i18n'
import './Chrome.css'

/**
 * EN | TR, as two buttons rather than a dropdown.
 *
 * Two options do not need a menu, and the pressed state doubles as the answer to
 * "which language am I in?" — which a `<select>` collapsed to one line cannot
 * tell you at a glance. `aria-pressed` is what carries that to a screen reader,
 * so the labels stay as short as they look.
 */
export default function LanguageToggle() {
  const { lang, setLang, t } = useI18n()

  return (
    <div className="ch-lang" role="group" aria-label={t('nav.language')}>
      {LANGUAGES.map((language) => (
        <button
          key={language.id}
          type="button"
          className="ch-lang-btn"
          lang={language.id}
          aria-pressed={lang === language.id}
          title={language.label}
          onClick={() => setLang(language.id)}
        >
          {language.short}
        </button>
      ))}
    </div>
  )
}
