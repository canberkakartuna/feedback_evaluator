import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MATH_TOOLS, activityHasMath, isMathTools, mathToolsOpen } from '../../shared/activity.js'

/**
 * Where the maths row starts for a student — mathToolsOpen in
 * shared/activity.js, read by the server into `activity.mathToolsOpen`.
 */

const plain = { prompt: 'Why does 2:4 equal 1:2?', rubric: [{ label: 'Divides both', coach: '' }] }
const withPrompt = { prompt: 'Simplify $\\frac{2}{4}$.' }

test('the three settings, and nothing else', () => {
  assert.deepEqual(MATH_TOOLS, ['auto', 'open', 'closed'])
  assert.equal(isMathTools('open'), true)
  assert.equal(isMathTools('always'), false)
  assert.equal(isMathTools(undefined), false)
})

test('open and closed are what the teacher picked, whatever the questions say', () => {
  assert.equal(mathToolsOpen({ mathTools: 'open' }, [plain]), true)
  assert.equal(mathToolsOpen({ mathTools: 'closed' }, [withPrompt]), false)
})

test('auto, or no setting at all, opens only when a question has maths', () => {
  assert.equal(mathToolsOpen({ mathTools: 'auto' }, [plain, withPrompt]), true)
  assert.equal(mathToolsOpen({ mathTools: 'auto' }, [plain]), false)
  // An activity saved before the setting existed reads as auto.
  assert.equal(mathToolsOpen({}, [withPrompt]), true)
  assert.equal(mathToolsOpen({}, [plain]), false)
  assert.equal(mathToolsOpen({ mathTools: 'bogus' }, [withPrompt]), true)
  assert.equal(mathToolsOpen(null, []), false)
})

test('maths anywhere a teacher typed counts, hidden parts included', () => {
  const cases = [
    { promptByLang: { tr: '$x^{2}$ nedir?' } },
    { answer: 'It is $\\frac{1}{2}$' },
    { rubric: [{ label: 'Writes $x = 2$', coach: '' }] },
    { rubric: [{ label: 'L', coach: 'Try \\(x+1\\)' }] },
    { tutor: { hints: ['Think of $\\sqrt{4}$'] } },
    { tutor: { opening: 'Hi', concept: '', example: '$$a^2$$', misconception: '' } },
    { stimulus: { kind: 'table', caption: '', columns: ['$x$'], rows: [] } },
    { stimulus: { kind: 'table', caption: '', columns: ['x'], rows: [['$2^3$']] } },
  ]
  for (const question of cases) {
    assert.equal(activityHasMath([question]), true, JSON.stringify(question))
  }
})

test('currency is not maths', () => {
  assert.equal(activityHasMath([{ prompt: 'A pen costs $5 and a book costs 10 $.' }]), false)
  assert.equal(activityHasMath([]), false)
  assert.equal(activityHasMath(undefined), false)
})
