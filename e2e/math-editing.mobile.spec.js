import { mathEditingTests } from './support/math-editing.mjs'

/**
 * Editing in the maths editor on a phone (the `android` and `iphone`
 * projects): taps instead of clicks. Emulation has no on-screen keyboard, so
 * a phone keyboard's Backspace is also sent as the `beforeinput` event it
 * really arrives as.
 */
mathEditingTests()
