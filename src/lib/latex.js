/**
 * Finding the LaTeX inside a teacher's text — now in shared/latex.js, so the
 * server can ask the same question (does this activity have maths in it?) that
 * the client does. Re-exported here so every client import keeps working.
 */
export { hasMath, splitMath } from '../../shared/latex.js'
