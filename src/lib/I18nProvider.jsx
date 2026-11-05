import { useCallback, useEffect, useMemo, useState } from 'react'
import { I18nContext, STORAGE_KEY, initialLanguage, translate } from './i18n'

/** Provides the interface language; see ./i18n.js for what is and is not translated. */
export function I18nProvider({ children }) {
  const [lang, setLang] = useState(initialLanguage)

  // The document has to agree, or a screen reader announces Turkish in an
  // English voice and `:lang()` rules in CSS never match.
  useEffect(() => {
    document.documentElement.lang = lang
    try {
      localStorage.setItem(STORAGE_KEY, lang)
    } catch {
      // As above: an unwritable store is not a reason to refuse the switch.
    }
  }, [lang])

  const t = useCallback((key, vars) => translate(lang, key, vars), [lang])

  const value = useMemo(() => ({ lang, setLang, t }), [lang, t])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}
