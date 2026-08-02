/**
 * How long a password has to be.
 *
 * In shared/ because the admin form and the server both enforce it, and a form
 * that refuses what the server would accept is worse than no form validation at
 * all — it makes a legitimate password look broken with no way to find out why.
 * That is exactly what happened when these numbers lived in two places.
 *
 * The server's copy in lib/password.js is the one that holds; the form only
 * avoids submitting something it already knows will be refused.
 */
export const MIN_PASSWORD_LENGTH = 8
export const MAX_PASSWORD_LENGTH = 200
