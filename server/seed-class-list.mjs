/**
 * Puts a class's student numbers on a teacher's class list, the same way the
 * console's Class list paste box does (services/users.js `addToClassList`).
 *
 *   npm run seed:class-list -- teacher@example.com numbers.txt          # a class
 *   npm run seed:class-list -- teacher@example.com --test               # test numbers only
 *   npm run seed:class-list -- teacher@example.com numbers.txt --test   # both
 *
 * The file holds the numbers, one per line or separated by commas or spaces —
 * a column copied out of the school's spreadsheet is fine. **Keep it outside
 * the repository**: the repo is public, and a number is all it takes to sign
 * in as that student.
 *
 * `--test` adds TEST_NUMBERS, made-up numbers for trying the student side
 * without using a real student's account. They are plainly fake (one digit
 * eight times), so their sessions are easy to spot and leave out of the data.
 *
 * Runs against whatever store `config.js` picks: MongoDB when MONGODB_URI is
 * set (in `.env.local` locally), otherwise the in-memory store, which is a dry
 * run that checks the numbers and then forgets them.
 *
 * **Safe to run twice.** A number already on this teacher's list is reported as
 * `already` and left alone. One on another teacher's list is reported as `taken`
 * and not moved.
 */
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { config } from './config.js'
import { createStore } from './store/index.js'
import { addToClassList } from './services/users.js'
import { splitStudentNumbers } from '../shared/student-number.js'

export const TEST_NUMBERS = ['11111111', '22222222', '33333333', '44444444', '55555555']

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = process.argv.slice(2)
  const [email, file] = args.filter((arg) => !arg.startsWith('--'))
  const withTest = args.includes('--test')

  if (!email || (!file && !withTest)) {
    console.error('Usage: npm run seed:class-list -- <teacher email> [numbers file] [--test]')
    process.exit(1)
  }

  console.log(`store: ${config.mongoUri ? `mongodb (${config.mongoDb})` : 'in-memory — a dry run, nothing is kept'}`)

  const store = createStore()

  try {
    const fromFile = file ? splitStudentNumbers(await readFile(file, 'utf8')) : []
    const studentNumbers = [...fromFile, ...(withTest ? TEST_NUMBERS : [])]

    const teacher = await store.users.findByEmail(email)

    // The in-memory store starts empty, so a dry run has nobody to look up.
    if (!teacher && config.mongoUri) throw new Error(`No user has the email ${email}`)
    if (teacher && teacher.role !== 'teacher') {
      throw new Error(`${email} is a ${teacher.role}. A class list belongs to a teacher`)
    }
    if (teacher && !teacher.active) throw new Error(`${email} is deactivated`)

    const teacherId = teacher?.id ?? 'usr_dry_run'
    const result = await addToClassList(store, { studentNumbers, teacherId, byUserId: teacherId })

    console.log(`${fromFile.length} from file${withTest ? `, ${TEST_NUMBERS.length} test numbers` : ''}`)
    console.log(`added    ${result.added.length}`)
    console.log(`already  ${result.already.length}`)
    if (result.taken.length) console.log(`taken    ${result.taken.length}  (on another teacher's list): ${result.taken.join(', ')}`)
    if (result.invalid.length) console.log(`invalid  ${result.invalid.length}  (not 8 digits): ${result.invalid.join(', ')}`)
  } catch (error) {
    console.error(`seed failed: ${error.message}`)
    process.exitCode = 1
  } finally {
    await store.close?.()
  }
}
