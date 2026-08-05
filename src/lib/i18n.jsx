import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { DICTIONARIES } from './strings'

/**
 * Which language the interface is in.
 *
 * English and Turkish, chosen by the reader and remembered. There is no
 * server-side locale and deliberately so: language is a property of the person
 * looking, not of the account or the data, so a teacher can read their Turkish
 * class's transcripts with English chrome without changing anything anybody else
 * sees. Nothing about the switch touches what is stored.
 *
 * **What is translated is the interface.** Titles, prompts, rubric labels and
 * every tutor reply are content — authored by a teacher or generated against
 * their words — and are shown exactly as written. See ./strings.js.
 */

const STORAGE_KEY = 'dropshot.lang'

export const LANGUAGES = [
  { id: 'en', label: 'English', short: 'EN' },
  { id: 'tr', label: 'Türkçe', short: 'TR' },
]

export const DEFAULT_LANGUAGE = 'en'

const isLanguage = (value) => LANGUAGES.some((language) => language.id === value)

/** `{ 'a.b': 'text' }` from the nested literal, once, at module load. */
function flatten(source, prefix = '', out = {}) {
  for (const [key, value] of Object.entries(source)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (value && typeof value === 'object') flatten(value, path, out)
    else out[path] = value
  }
  return out
}

const FLAT = Object.fromEntries(
  Object.entries(DICTIONARIES).map(([id, dictionary]) => [id, flatten(dictionary)]),
)

/**
 * Stored choice, then the browser's own preference, then English.
 *
 * `navigator.language` is only consulted the first time: once someone has
 * pressed TR on a machine set to English, that is an answer and guessing again
 * would undo it.
 */
function initialLanguage() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (isLanguage(stored)) return stored
  } catch {
    // Private browsing. Fall through to the browser's preference.
  }

  const preferred = (globalThis.navigator?.languages ?? [globalThis.navigator?.language ?? ''])
    .map((tag) => String(tag).slice(0, 2).toLowerCase())
    .find(isLanguage)

  return preferred ?? DEFAULT_LANGUAGE
}

/**
 * Fills `{name}` placeholders and picks a plural form.
 *
 * A missing key returns the key itself rather than an empty string: a screen
 * reading "qp.check" is obviously a bug that someone will fix, where a blank
 * button is a mystery. `npm run check:strings` is what stops it reaching a
 * reader in the first place.
 */
export function translate(lang, key, vars) {
  const dictionary = FLAT[lang] ?? FLAT[DEFAULT_LANGUAGE]

  const plural =
    typeof vars?.count === 'number' ? `${key}_${vars.count === 1 ? 'one' : 'other'}` : null

  const template =
    (plural ? dictionary[plural] : null) ??
    dictionary[key] ??
    (plural ? FLAT[DEFAULT_LANGUAGE][plural] : null) ??
    FLAT[DEFAULT_LANGUAGE][key]

  if (template == null) {
    if (import.meta.env.DEV) console.warn(`[i18n] missing string: ${key}`)
    return key
  }

  if (!vars) return template

  return template.replaceAll(/\{(\w+)\}/g, (match, name) =>
    vars[name] === undefined ? match : String(vars[name]),
  )
}

const I18nContext = createContext(null)

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

export function useI18n() {
  const value = useContext(I18nContext)
  if (!value) throw new Error('useI18n must be used inside <I18nProvider>')
  return value
}

/** Sugar for the common case of wanting only the function. */
export function useT() {
  return useI18n().t
}

/**
 * The key holding a role's name: `'admin'` → `'people.roleAdmin'`.
 *
 * Roles are stored as ids and shown as words, and four screens need the same
 * translation of the same four ids. Built rather than listed so that a role added
 * to shared/roles.js needs one string, not a lookup table in each caller.
 */
export const roleStringKey = (role) =>
  `people.role${String(role ?? '').charAt(0).toUpperCase()}${String(role ?? '').slice(1)}`
