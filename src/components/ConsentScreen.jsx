import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useI18n, useT } from '../lib/i18n'
import { CONSENT_STATEMENT_COUNT, consentFormFor } from '../lib/consentForm'
import { CONSENT_STEPS, CONSENT_STEP_COUNT, canLeaveStep } from '../lib/consentSteps'
import { personalInfoNoticeFor } from '../lib/personalInfoNotice'
import Navbar from './Navbar'
import ParticipantInfoSheet from './ParticipantInfoSheet'
import './Entry.css'

/**
 * The one-time research notice, shown to signed-in students only — see the
 * gate in App.jsx and `needsConsent` in lib/consentSteps.js, which decide
 * *whether* this renders. Once on screen it walks the person through three pages
 * (lib/consentSteps.js): the participant information sheet, the consent form,
 * and the notice not to share personal information in the chat. Only the last
 * page's button sends the one call that means "recorded, for good".
 *
 * The pages are local state, not routes: nothing is recorded until the end, so
 * leaving or reloading part-way simply starts again from page 1 next time.
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
  const { lang } = useI18n()
  const { setUser } = useAuth()
  const [step, setStep] = useState(1)
  // Page 1: the one box confirming the sheet has been read.
  const [sheetRead, setSheetRead] = useState(false)
  // Page 2, the consent form (lib/consentForm.js): one "Yes" box per statement,
  // and every one of them is needed to go on. Ticks are kept by position, so
  // switching EN/TR keeps them — the statements match. All ticks live here, on
  // the screen, so going back and forth between pages keeps them too.
  const form = consentFormFor(lang)
  const notice = personalInfoNoticeFor(lang)
  const [ticks, setTicks] = useState(() => Array(CONSENT_STATEMENT_COUNT).fill(false))
  const tick = (index, checked) =>
    setTicks((current) => current.map((value, at) => (at === index ? checked : value)))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  // On every page change, start the new page at its top and put focus on its
  // heading, so keyboard and screen-reader users land on the new page. Not on
  // first render: the screen opens like any other page.
  const pageRef = useRef(null)
  const headingRef = useRef(null)
  // Compared with the previous page rather than a "first run" flag, so the
  // doubled effect of React's StrictMode in development does not count as a move.
  const shownStep = useRef(step)
  useEffect(() => {
    if (shownStep.current === step) return
    shownStep.current = step
    window.scrollTo(0, 0)
    if (pageRef.current) pageRef.current.scrollTop = 0
    headingRef.current?.focus()
  }, [step])

  const canContinue = canLeaveStep(step, { sheetRead, ticks })
  const goTo = (next) => {
    setError(null)
    setStep(next)
  }

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

  const page = CONSENT_STEPS[step - 1]

  return (
    <main className="en-page" ref={pageRef}>
      <Navbar home={false} join={false} console={false} profile={false} />
      <div className="en-card">
        <p className="eyebrow">
          {t('entry.step', { current: step, total: CONSENT_STEP_COUNT })} · {t('consent.eyebrow')}
        </p>

        {page === 'sheet' ? (
          <>
            <h1 className="en-title" ref={headingRef} tabIndex={-1}>
              {t('consent.title')}
            </h1>
            <p className="en-lede">{t('consent.lede')}</p>

            {/* The sheet, in the interface language — so the EN/TR switch in
                the navbar changes it. Shown open, not folded (design doc), in
                its own scrolling box so the box below stays within reach. */}
            <div className="pis-open">
              <ParticipantInfoSheet />
            </div>

            <label className="en-agree">
              <input
                type="checkbox"
                checked={sheetRead}
                onChange={(event) => setSheetRead(event.target.checked)}
              />
              <span>{t('consent.readSheet')}</span>
            </label>

            <div className="en-actions">
              <button
                type="button"
                className="en-btn en-btn-primary"
                disabled={!canContinue}
                onClick={() => goTo(2)}
              >
                {t('consent.continue')}
              </button>
            </div>
          </>
        ) : null}

        {page === 'form' ? (
          <>
            <h1 className="en-title" id="consent-form-title" ref={headingRef} tabIndex={-1}>
              {form.title}
            </h1>

            {/* Each statement and its "Yes" box are one <label>, so the whole
                row is clickable and the box is announced with its statement. */}
            <fieldset className="en-consent" lang={lang} aria-labelledby="consent-form-title">
              <p className="en-consent-instruction">{form.instruction}</p>
              {form.statements.map((statement, index) => (
                <label key={index} className={index === 0 ? 'en-agree' : 'en-agree en-agree-next'}>
                  <span className="en-consent-text">
                    {index + 1}. {statement}
                  </span>
                  <span className="en-consent-yes">
                    <input
                      type="checkbox"
                      checked={ticks[index]}
                      onChange={(event) => tick(index, event.target.checked)}
                    />
                    {form.yes}
                  </span>
                </label>
              ))}
            </fieldset>

            <div className="en-actions">
              <button type="button" className="en-btn" onClick={() => goTo(1)}>
                {t('common.back')}
              </button>
              <button
                type="button"
                className="en-btn en-btn-primary"
                disabled={!canContinue}
                onClick={() => goTo(3)}
              >
                {t('consent.continue')}
              </button>
            </div>
          </>
        ) : null}

        {page === 'notice' ? (
          <>
            <h1 className="en-title" lang={lang} ref={headingRef} tabIndex={-1}>
              {notice.title}
            </h1>
            <p className="en-lede" lang={lang}>
              {notice.body}
            </p>

            {error ? (
              <p className="en-warn" role="alert" style={{ marginTop: 'var(--s-4)' }}>
                {error}
              </p>
            ) : null}

            {/* Pressing this is the acceptance — no box of its own — and it is
                what records consent and lets the person in. */}
            <div className="en-actions">
              <button type="button" className="en-btn" disabled={busy} onClick={() => goTo(2)}>
                {t('common.back')}
              </button>
              <button
                type="button"
                className="en-btn en-btn-primary"
                disabled={!canContinue || busy}
                onClick={submit}
              >
                {busy ? t('consent.submitting') : notice.accept}
              </button>
            </div>
          </>
        ) : null}
      </div>
    </main>
  )
}
