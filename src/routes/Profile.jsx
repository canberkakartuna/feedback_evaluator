import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useI18n } from '../lib/i18n'
import Navbar from '../components/Navbar'
import './console.css'
import '../components/Entry.css'
import './Profile.css'

/**
 * A signed-in account's own record: who the interface thinks they are, and
 * the research notice they agreed to — see ConsentScreen.jsx, which is the
 * only other place that notice's text appears.
 *
 * One thing can be done here (3 Nov 2026 doc): **withdrawing from the study**,
 * but only during the sign-in the agreement was given in. The server decides
 * that (`canWithdrawConsent`); after signing out and back in it is false, and
 * the profile says why instead of offering the button.
 */
export default function Profile() {
  const { t, lang } = useI18n()
  const { user, ready, setUser } = useAuth()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const withdraw = async () => {
    setBusy(true)
    setError(null)
    try {
      // The updated user has `consented: false`, so the consent gate in App.jsx
      // shows the notice again straight away.
      const { user: updated } = await api.withdrawConsent()
      setUser(updated)
    } catch (failure) {
      setError(failure.message)
      setBusy(false)
    }
  }

  if (!ready) {
    return (
      <main className="splash">
        <p className="eyebrow">{t('app.loading')}</p>
      </main>
    )
  }

  // Reached with no account, most likely by a bookmark or a shared link:
  // there is nothing to show, so the entry screen decides where they go next.
  if (!user) return <Navigate to="/" replace />

  const consent = user.consent
  const consentDate = consent?.at
    ? new Date(consent.at).toLocaleString(lang, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : null

  return (
    <main className="en-page">
      <Navbar profile={false} />
      <div className="en-card">
        <p className="eyebrow">{t('profile.eyebrow')}</p>
        <h1 className="en-title">{t('profile.title')}</h1>

        <div className="en-terms">
          <p className="en-terms-head">{t('profile.accountHead')}</p>
          <dl className="pf-list">
            {/* A class-list student is shown their username and nothing else
                (3 Nov 2026 doc); staff keep their name and email. */}
            {user.studentNumber ? (
              <div className="pf-row">
                <dt>{t('profile.username')}</dt>
                <dd className="mono">{user.studentNumber}</dd>
              </div>
            ) : (
              <>
                <div className="pf-row">
                  <dt>{t('profile.name')}</dt>
                  <dd>{user.name}</dd>
                </div>
                <div className="pf-row">
                  <dt>{t('profile.email')}</dt>
                  <dd>{user.email}</dd>
                </div>
              </>
            )}
          </dl>
        </div>

        <div className="en-terms">
          {/* The participant information form, readable again at any time. */}
          <p className="en-terms-head">{t('profile.consentHead')}</p>
          <p className="en-lede">{t('consent.lede')}</p>
          {consent?.given ? (
            <p className="pf-consent-note">{t('profile.consentGiven', { date: consentDate })}</p>
          ) : (
            <p className="pf-consent-note">{t('profile.consentNone')}</p>
          )}

          {consent?.given && user.canWithdrawConsent ? (
            <div className="pf-withdraw">
              {confirming ? (
                <>
                  <p className="en-warn" role="alert">
                    {t('profile.withdrawWarn')}
                  </p>
                  <div className="en-actions">
                    <button
                      type="button"
                      className="cs-btn cs-btn-danger"
                      disabled={busy}
                      onClick={withdraw}
                    >
                      {busy ? t('profile.withdrawing') : t('profile.withdrawConfirm')}
                    </button>
                    <button
                      type="button"
                      className="cs-btn"
                      disabled={busy}
                      onClick={() => setConfirming(false)}
                    >
                      {t('common.cancel')}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p className="cs-hint">{t('profile.withdrawHint')}</p>
                  <button type="button" className="cs-btn" onClick={() => setConfirming(true)}>
                    {t('profile.withdraw')}
                  </button>
                </>
              )}
              {error ? (
                <p className="cs-note" data-tone="bad" role="alert">
                  {error}
                </p>
              ) : null}
            </div>
          ) : consent?.given ? (
            <p className="cs-hint pf-withdraw">{t('profile.withdrawClosed')}</p>
          ) : null}
        </div>
      </div>
    </main>
  )
}
