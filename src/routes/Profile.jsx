import { Navigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { useI18n } from '../lib/i18n'
import Navbar from '../components/Navbar'
import '../components/Entry.css'
import './Profile.css'

/**
 * A signed-in account's own record: who the interface thinks they are, and
 * the research notice they agreed to — see ConsentScreen.jsx, which is the
 * only other place that notice's text appears. Nothing here is editable;
 * this is a mirror, not a settings screen.
 */
export default function Profile() {
  const { t, lang } = useI18n()
  const { user, ready } = useAuth()

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
            <div className="pf-row">
              <dt>{t('profile.name')}</dt>
              <dd>{user.name}</dd>
            </div>
            <div className="pf-row">
              <dt>{t('profile.email')}</dt>
              <dd>{user.email}</dd>
            </div>
          </dl>
        </div>

        <div className="en-terms">
          <p className="en-terms-head">{t('profile.consentHead')}</p>
          {consent?.given ? (
            <>
              <p className="en-lede">{t('consent.lede')}</p>
              <p className="pf-consent-note">
                {t('profile.consentGiven', { date: consentDate })}
              </p>
            </>
          ) : (
            <p className="en-lede">{t('profile.consentNone')}</p>
          )}
        </div>
      </div>
    </main>
  )
}
