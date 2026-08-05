import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import { isStaff } from '../../../shared/roles'
import { useAuth } from '../../lib/auth'
import { useT } from '../../lib/i18n'
import ConsentCard from '../../components/ConsentCard'
import TopBar from '../../components/TopBar'
import '../../components/Entry.css'
import '../console.css'

/**
 * Everything before a session starts: the consent notice, and then the screen
 * that picks what to work on.
 *
 * **Consent lives here and only here.** It used to be a step inside each entry
 * screen, which meant two screens each deciding who gets asked, what the wording
 * is, and what happens to someone who declines — for one question that has one
 * answer. Now a student route cannot render at all until the question has been
 * answered: the `<Outlet />` below is unreachable otherwise, so a new entry
 * screen inherits the gate instead of having to remember it.
 *
 *   /            pick from the list        (three steps: consent, who, what)
 *   /join        arrive with a class code  (two: consent, then the code)
 *
 * `/work/:sessionId` is deliberately **not** inside this layout. Its consent was
 * recorded when the session was created and lives on the session itself, so
 * gating it again would ask a student to re-consent every time they reloaded the
 * page they were working on.
 *
 * **Staff pass straight through.** The notice asks a research participant to
 * agree to their answers and conversations being kept for the study; a teacher
 * looking at what their class will see is not one. What they start is stamped as
 * a preview rather than carrying an agreement nobody gave — see
 * routes/sessions.js — and `consent` below is what tells the child which of the
 * two it is about to create.
 *
 * Because the gate is derived from `staff` and `consented` rather than stored as
 * a step, signing out from the bar above puts it straight back: whoever is left
 * behind is an anonymous visitor who has agreed to nothing, and there is no
 * correcting effect to run late.
 */
export default function StudentLayout({ totalSteps = 3 }) {
  const t = useT()
  const { user, ready } = useAuth()

  const [consented, setConsented] = useState(false)
  const [declined, setDeclined] = useState(false)

  const staff = ready && isStaff(user?.role)

  // Nothing renders before `me` settles. Whether the notice applies depends on
  // who is asking, and guessing for one frame means showing a teacher a form
  // addressed to a research subject.
  if (!ready) {
    return (
      <main className="splash">
        <p className="eyebrow">{t('app.loading')}</p>
      </main>
    )
  }

  if (declined) {
    return (
      <main className="en-page">
        <TopBar join />
        <div className="en-card">
          <p className="eyebrow">{t('entry.declined.eyebrow')}</p>
          <h1 className="en-title">{t('entry.declined.title')}</h1>
          <p className="en-lede">{t('entry.declined.lede')}</p>
          <button type="button" className="en-btn" onClick={() => setDeclined(false)}>
            {t('entry.declined.back')}
          </button>
        </div>
      </main>
    )
  }

  if (!staff && !consented) {
    return (
      <main className="en-page">
        {/* The class-code button is offered here too. Following it does not skip
            anything — /join is behind this same gate — and a student who was
            given a code should not have to read a list first to use it. */}
        <TopBar join />
        <ConsentCard
          eyebrow={`${t('entry.step', { current: 1, total: totalSteps })} · ${t(
            'entry.consent.eyebrow',
          )}`}
          onAgree={() => setConsented(true)}
          onDecline={() => setDeclined(true)}
        />
      </main>
    )
  }

  return (
    <main className="en-page">
      <TopBar join />
      {/**
       * `consent` is the value the child sends to `POST /api/sessions`: true for
       * someone who has just ticked the box, false for staff who were never
       * shown it. It is passed rather than recomputed so that "did this person
       * consent?" is answered in one place — this one.
       */}
      <Outlet context={{ staff, consent: !staff, totalSteps }} />
    </main>
  )
}
