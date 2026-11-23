import { mathEditingTests, undoTest } from './support/math-editing.mjs'

/**
 * Editing in the maths editor on a desktop: where the caret is, moving
 * between boxes and the sentence, and every way of deleting.
 * The same tests run on phones in math-editing.mobile.spec.js.
 */
mathEditingTests()
undoTest()
