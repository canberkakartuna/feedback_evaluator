/**
 * The course content lives in ../../shared so the API server and the client
 * read the same definitions. This re-export keeps component imports stable.
 *
 * Note: the client currently bundles the whole thing, rubric keywords and
 * tutor scripts included. Once the components read from GET /api/course, the
 * server's sanitised payload becomes the client's only source and this file
 * goes away.
 */
export * from '../../shared/course.js'
