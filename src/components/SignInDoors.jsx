import { Link } from 'react-router-dom'
import { useT } from '../lib/i18n'

/**
 * Two doors, side by side (3 Nov 2026 doc): students sign in with a username
 * (their student number) on `/`, and everyone else with an account — admin,
 * manager, annotator, teacher — with an email and password on `/signin`.
 * Shown on both screens so either can reach the other.
 */
export default function SignInDoors({ current }) {
  const t = useT()

  return (
    <nav className="en-doors" aria-label={t('entry.doors.label')}>
      <Link className="en-door" to="/" aria-current={current === 'student' ? 'page' : undefined}>
        {t('entry.doors.student')}
      </Link>
      <Link className="en-door" to="/signin" aria-current={current === 'staff' ? 'page' : undefined}>
        {t('entry.doors.staff')}
      </Link>
    </nav>
  )
}
