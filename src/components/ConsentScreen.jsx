import { useState } from 'react'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useT } from '../lib/i18n'
import Navbar from './Navbar'
import './Entry.css'

/**
 * The one-time research notice, shown to every signed-in account except an
 * admin — see the gate in App.jsx, which is what decides *whether* this
 * renders. This component only ever has one job once it is on screen: hold
 * the checkbox, and send the one call that means "recorded, for good".
 *
 * Nothing here reads `user.consented` — the gate in App.jsx already checked
 * it before rendering this at all — so there is nothing to get out of sync.
 * `api.recordConsent()` returns the updated user; handing it to `setUser`
 * flips the gate closed without a reload.
 *
 * The only way off this screen without agreeing is signing out, via the
 * navbar — there is no decline button, because there is nothing to decline
 * *into*: every account in this system is a participant.
 */
export default function ConsentScreen() {
  const t = useT()
  const { setUser } = useAuth()
  const [agreed, setAgreed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const { user } = await api.recordConsent()
      setUser(user)
    } catch (failure) {
      setError(failure.message)
      setBusy(false)
    }
  }

  return (
    <main className="en-page">
      <Navbar home={false} join={false} console={false} profile={false} />
      <div className="en-card">
        <p className="eyebrow">{t('consent.eyebrow')}</p>
        <h1 className="en-title">{t('consent.title')}</h1>
        <p className="en-lede">{t('consent.lede')}</p>

        <label className="en-agree">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(event) => setAgreed(event.target.checked)}
          />
          <span>{t('consent.agree')}</span>
        </label>

        {error ? (
          <p className="en-warn" role="alert">
            {error}
          </p>
        ) : null}

        <div className="en-actions">
          <button
            type="button"
            className="en-btn en-btn-primary"
            disabled={!agreed || busy}
            onClick={submit}
          >
            {busy ? t('consent.submitting') : t('consent.submit')}
          </button>
        </div>
      </div>
    </main>
  )
}
