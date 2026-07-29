import { MARKS } from '../lib/status'

/** A pencil mark, not a badge: hollow square → half-filled → check or flag. */
export default function StatusMark({ status, size = 14 }) {
  const mark = MARKS[status] ?? MARKS.new

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 14 14"
      fill="none"
      aria-hidden="true"
      style={{ color: mark.tone, display: 'block', flex: 'none' }}
    >
      {mark.shape === 'check' ? (
        <path
          d="M2 7.6 5.2 10.8 12 3.6"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="square"
        />
      ) : mark.shape === 'flag' ? (
        <>
          <rect x="2.5" y="2.5" width="9" height="9" stroke="currentColor" strokeWidth="1.1" />
          <path d="M7 4.6v3.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="square" />
          <rect x="6.3" y="9.1" width="1.4" height="1.4" fill="currentColor" />
        </>
      ) : mark.shape === 'half' ? (
        <>
          <rect x="2.5" y="2.5" width="9" height="9" stroke="currentColor" strokeWidth="1.1" />
          <rect x="3" y="7" width="8" height="4" fill="currentColor" />
        </>
      ) : (
        <rect x="2.5" y="2.5" width="9" height="9" stroke="currentColor" strokeWidth="1.1" />
      )}
    </svg>
  )
}
