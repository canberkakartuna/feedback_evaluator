import { expect, test } from '@playwright/test'
import { seedClass } from './seed.mjs'
import { openActivity, signInFirstTime, tutorPane } from './student.mjs'

/**
 * Editing in the maths editor — where the caret is, moving by touch, and
 * deleting — shared by math-editing.spec.js (desktop Chromium) and
 * math-editing.mobile.spec.js (the Android and iPhone projects).
 */

const QUESTIONS = [{ kind: 'Calculate', prompt: 'Work out $\\int_{0}^{1} x\\,dx$.' }]
const PEN = 'rgb(14, 117, 102)'

const isAnswerSave = (response) =>
  response.request().method() === 'PUT' && /\/api\/sessions\/[^/]+\/answers\//.test(response.url())

/** Signs in on an activity with maths (so the row is open) and returns one box. */
async function open(page, where = 'answer') {
  const { studentNumber } = await seedClass({ title: 'Areas', questions: QUESTIONS })
  await signInFirstTime(page, studentNumber)
  await openActivity(page, 'Areas')
  const touch = page.viewportSize().width < 760
  let scope = page.getByRole('main')
  let id = 'answer'
  if (where === 'chat') {
    if (touch) await page.getByRole('button', { name: /^Tutor/ }).last().tap()
    scope = tutorPane(page)
    id = 'tutor-message'
  }
  const box = scope.getByRole('textbox').first()
  const row = scope.getByRole('toolbar', { name: 'Maths symbols' })
  const press = (locator) => (touch ? locator.tap() : locator.click())
  const button = (name) => press(row.getByRole('button', { name, exact: true }))
  return { scope, box, id, press, button, touch }
}

/** Where focus is and what the student can see of it. */
function caret(page, id) {
  return page.evaluate((boxId) => {
    const root = document.getElementById(boxId)
    const active = document.activeElement
    const field = active?.tagName === 'MATH-FIELD' && root.contains(active) ? active : null
    const result = {
      where: active === root ? 'prose' : field ? 'formula' : 'elsewhere',
      proseCaret: getComputedStyle(root).caretColor,
      proseBg: getComputedStyle(root).backgroundColor,
      activeChips: root.querySelectorAll('.mi-chip.mi-active').length,
    }
    if (field) {
      const shadow = field.shadowRoot
      const mark = shadow.querySelector('.ML__caret, .ML__text-caret')
      const after = mark && getComputedStyle(mark, '::after')
      const box = shadow.querySelector('.ML__selection')
      const boxStyle = box && getComputedStyle(box)
      result.fieldBg = getComputedStyle(field).backgroundColor
      result.caret = mark
        ? { visible: after.visibility, color: after.borderRightColor, height: parseFloat(after.height) || parseFloat(after.minHeight), animation: after.animationName }
        : null
      result.box = boxStyle && boxStyle.boxShadow !== 'none'
        ? { fill: boxStyle.backgroundColor, ring: boxStyle.boxShadow, animation: boxStyle.animationName }
        : null
    }
    return result
  }, id)
}

/** In a formula, typing goes somewhere visible: a ringed empty box, or a caret. */
async function expectVisibleInFormula(page, id) {
  await expect.poll(async () => (await caret(page, id)).where).toBe('formula')
  const state = await caret(page, id)
  expect(state.activeChips).toBe(1)
  if (state.caret) {
    expect(state.caret.visible).toBe('visible')
    expect(state.caret.color).toBe(PEN)
    expect(state.caret.color).not.toBe(state.fieldBg)
    expect(state.caret.height).toBeGreaterThanOrEqual(14)
  } else {
    expect(state.box, 'an empty box being filled is ringed').toBeTruthy()
    expect(state.box.ring).toContain(PEN)
    expect(state.box.fill).not.toBe(state.fieldBg)
    expect(state.box.fill).not.toBe('rgba(0, 0, 0, 0)')
  }
}

async function expectInProse(page, id) {
  await expect.poll(async () => (await caret(page, id)).where).toBe('prose')
  const state = await caret(page, id)
  expect(state.activeChips, 'no formula looks active').toBe(0)
  expect(state.proseCaret).toBe(PEN)
  expect(state.proseCaret).not.toBe(state.proseBg)
}

const value = (box) => box.getAttribute('data-value')

/** Builds "Half is ½" with the caret after the formula, in the sentence. */
async function halfIs(page, ui) {
  await ui.press(ui.box)
  await page.keyboard.type('Half is ')
  await ui.button('Fraction')
  await page.keyboard.type('1')
  await page.keyboard.press('Tab')
  await page.keyboard.type('2')
  await page.keyboard.press('Tab')
  await expect(ui.box).toHaveAttribute('data-value', 'Half is $\\frac{1}{2}$')
  await expectInProse(page, ui.id)
  // MathLive settles its own focus on a timer just after a formula is left;
  // a person is never this fast, so let it settle before the next step.
  await expect
    .poll(async () => {
      const first = (await caret(page, ui.id)).where
      await page.waitForTimeout(150)
      return first === (await caret(page, ui.id)).where ? first : 'moving'
    })
    .toBe('prose')
}

/** Synthetic phone-keyboard deletion: `beforeinput` only, no key event. */
const keyboardDelete = (page, target, inputType = 'deleteContentBackward') =>
  page.evaluate(
    ({ boxId, into, type }) => {
      const root = document.getElementById(boxId)
      const element =
        into === 'formula' ? document.activeElement.shadowRoot.querySelector('[part=keyboard-sink]') : root
      element.dispatchEvent(new InputEvent('beforeinput', { inputType: type, bubbles: true, composed: true, cancelable: true }))
    },
    { boxId: target.id, into: target.into, type: inputType },
  )

export function mathEditingTests() {
  for (const where of ['answer', 'chat']) {
    test(`${where}: it is always clear where typing goes`, async ({ page }) => {
      const ui = await open(page, where)
      expect((await caret(page, ui.id)).where).toBe('elsewhere')
      await ui.press(ui.box)
      await expectInProse(page, ui.id)
      await page.keyboard.type('Area ')
      await ui.button('Integral')
      await expectVisibleInFormula(page, ui.id) // empty lower limit, ringed
      await page.keyboard.type('0')
      await expectVisibleInFormula(page, ui.id) // caret after the 0
      await page.keyboard.press('Tab')
      await expectVisibleInFormula(page, ui.id) // empty upper limit
      await page.keyboard.type('1')
      await page.keyboard.press('Tab')
      await expectVisibleInFormula(page, ui.id) // empty body
      await page.keyboard.type('x')
      await page.keyboard.press('Tab')
      await expectInProse(page, ui.id)
      await page.keyboard.type(' and ')
      await ui.button('Power')
      await expectVisibleInFormula(page, ui.id)
      await page.keyboard.type('2')
      await page.keyboard.press('Tab')
      await expectVisibleInFormula(page, ui.id) // empty exponent
      await page.keyboard.type('3')
      await expectVisibleInFormula(page, ui.id)
      await page.keyboard.press('Tab')
      await expectInProse(page, ui.id)
    })
  }

  test('reduced motion: the caret and the ringed box stay still', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const ui = await open(page)
    await ui.press(ui.box)
    await ui.button('Fraction')
    await expectVisibleInFormula(page, ui.id)
    expect((await caret(page, ui.id)).box.animation).toBe('none')
    await page.keyboard.type('1')
    expect((await caret(page, ui.id)).caret.animation).toBe('none')
  })

  test('tapping: into a box of a formula, and back out into the sentence, also after a last formula', async ({ page }) => {
    const ui = await open(page)
    await halfIs(page, ui)
    // Into the formula by tapping it.
    await ui.press(ui.box.locator('math-field'))
    await expectVisibleInFormula(page, ui.id)
    // Out by tapping the sentence.
    await ui.press(ui.box.getByText('Half is'))
    await expectInProse(page, ui.id)
    // The formula is the last thing in the box: tapping the space after it
    // puts the caret after it, in the sentence.
    const field = await ui.box.locator('math-field').boundingBox()
    const area = await ui.box.boundingBox()
    const spot = { x: Math.min(area.x + area.width - 12, field.x + field.width + 30), y: field.y + field.height / 2 }
    if (ui.touch) await page.touchscreen.tap(spot.x, spot.y)
    else await page.mouse.click(spot.x, spot.y)
    await expectInProse(page, ui.id)
    await page.keyboard.type(' ok')
    await expect(ui.box).toHaveAttribute('data-value', 'Half is $\\frac{1}{2}$ ok')
  })

  test('deleting from the sentence: the first Backspace marks the formula, the second removes it', async ({ page }) => {
    const ui = await open(page)
    await halfIs(page, ui)
    await page.keyboard.press('Backspace')
    await expect(ui.box.locator('.mi-chip.mi-armed')).toHaveCount(1)
    expect(await value(ui.box)).toBe('Half is $\\frac{1}{2}$')
    await page.keyboard.press('Backspace')
    await expect(ui.box.locator('.mi-chip')).toHaveCount(0)
    await expect(ui.box).toHaveAttribute('data-value', 'Half is ')
    await expectInProse(page, ui.id)
    // Moving away instead takes the mark back.
    await ui.button('Power')
    await page.keyboard.type('2')
    await page.keyboard.press('Tab')
    await page.keyboard.type('3')
    await page.keyboard.press('Tab')
    await page.keyboard.press('Backspace')
    await expect(ui.box.locator('.mi-chip.mi-armed')).toHaveCount(1)
    await page.keyboard.type('!')
    await expect(ui.box.locator('.mi-chip.mi-armed')).toHaveCount(0)
    await expect(ui.box).toHaveAttribute('data-value', 'Half is $2^3$!')
  })

  test('Delete before a formula works the same way forwards', async ({ page }) => {
    const ui = await open(page)
    await halfIs(page, ui)
    // The caret just before the formula, in the sentence.
    await page.evaluate((boxId) => {
      const root = document.getElementById(boxId)
      const before = root.querySelector('.mi-chip').previousSibling
      root.focus()
      window.getSelection().collapse(before, before.nodeValue.length)
    }, ui.id)
    await expectInProse(page, ui.id)
    await page.keyboard.press('Delete')
    await expect(ui.box.locator('.mi-chip.mi-armed')).toHaveCount(1)
    await page.keyboard.press('Delete')
    await expect(ui.box.locator('.mi-chip')).toHaveCount(0)
    await expect(ui.box).toHaveAttribute('data-value', 'Half is ')
  })

  test('deleting inside a formula: characters, then back a box, then the whole formula; never a dead press', async ({ page }) => {
    const ui = await open(page)
    await ui.press(ui.box)
    await page.keyboard.type('Area ')
    await ui.button('Integral')
    await page.keyboard.type('0')
    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab') // upper limit left empty
    await page.keyboard.type('x')
    await expect(ui.box).toHaveAttribute('data-value', /^Area \$\\int_\{?0\}?\^\{\}x\\,dx\$$/)

    const snapshot = () =>
      page.evaluate((boxId) => {
        const root = document.getElementById(boxId)
        const field = root.querySelector('math-field')
        return JSON.stringify([root.dataset.value, field?.value, field?.position, field?.selection?.ranges, root.querySelector('.mi-armed') !== null])
      }, ui.id)
    let before = await snapshot()
    let presses = 0
    while ((await ui.box.locator('.mi-chip').count()) && presses < 12) {
      await page.keyboard.press('Backspace')
      presses += 1
      await expect.poll(snapshot, { message: `press ${presses} changed something` }).not.toBe(before)
      before = await snapshot()
    }
    await expect(ui.box.locator('.mi-chip')).toHaveCount(0)
    await expect(ui.box).toHaveAttribute('data-value', 'Area ')
    await expectInProse(page, ui.id)
  })

  test('a fraction inside a power is backspaced away completely', async ({ page }) => {
    const ui = await open(page)
    await ui.press(ui.box)
    await page.keyboard.type('x')
    await ui.button('Power')
    await ui.button('Fraction')
    await page.keyboard.type('1')
    await page.keyboard.press('Tab')
    await page.keyboard.type('2')
    await expect(ui.box).toHaveAttribute('data-value', '$x^{\\frac{1}{2}}$')
    for (let presses = 0; presses < 14 && (await ui.box.locator('.mi-chip').count()); presses += 1) {
      await page.keyboard.press('Backspace')
    }
    await expect(ui.box.locator('.mi-chip')).toHaveCount(0)
    await expect(ui.box).toHaveAttribute('data-value', '')
  })

  test('a formula inserted and left empty disappears; holding Backspace clears formulas too', async ({ page }) => {
    const ui = await open(page)
    await ui.press(ui.box)
    await page.keyboard.type('So ')
    await ui.button('Fraction')
    await ui.press(ui.box.getByText('So'))
    await expect(ui.box.locator('.mi-chip')).toHaveCount(0)
    await expect(ui.box).toHaveAttribute('data-value', 'So ')

    await page.keyboard.press('End')
    await ui.button('Power')
    await page.keyboard.type('2')
    await page.keyboard.press('Tab')
    await page.keyboard.type('3')
    await page.keyboard.press('Tab')
    await page.keyboard.type(' and done')
    for (let presses = 0; presses < 30; presses += 1) await page.keyboard.press('Backspace')
    await expect(ui.box).toHaveAttribute('data-value', '')
    await expect(ui.box.locator('.mi-chip')).toHaveCount(0)
  })

  test('select all then Backspace, or cut, empties the box completely, and that is saved', async ({ page }) => {
    const ui = await open(page)
    await halfIs(page, ui)
    await page.keyboard.type(' exactly')
    await page.waitForResponse((response) => isAnswerSave(response) && response.request().postData()?.includes('exactly'))
    const saved = page.waitForResponse((response) => isAnswerSave(response) && JSON.parse(response.request().postData()).draft === '')
    await page.keyboard.press('ControlOrMeta+a')
    await page.keyboard.press('Backspace')
    await expect(ui.box).toHaveAttribute('data-value', '')
    await expect(ui.box).toHaveAttribute('data-empty', 'true')
    expect((await saved).ok()).toBe(true)
    await expectInProse(page, ui.id)

    // Cut by keyboard shortcut: a desktop thing (a phone has no shortcut, and
    // WebKit's emulation hangs on it).
    if (ui.touch) return
    await halfIs(page, ui)
    await page.keyboard.press('ControlOrMeta+a')
    await page.keyboard.press('ControlOrMeta+x')
    await expect(ui.box).toHaveAttribute('data-value', '')
  })

  test('a selection across a sentence and a formula deletes both', async ({ page }) => {
    const ui = await open(page)
    await halfIs(page, ui)
    await page.keyboard.type(' exactly')
    await page.evaluate((boxId) => {
      const root = document.getElementById(boxId)
      const texts = [...root.childNodes].filter((node) => node.nodeType === 3 && node.nodeValue.replaceAll('​', ''))
      const range = document.createRange()
      range.setStart(texts[0], 5) // "Half |is "
      range.setEnd(texts[texts.length - 1], texts[texts.length - 1].nodeValue.indexOf('exactly'))
      root.focus()
      const selection = window.getSelection()
      selection.removeAllRanges()
      selection.addRange(range)
    }, ui.id)
    await page.keyboard.press('Backspace')
    await expect(ui.box).toHaveAttribute('data-value', 'Half exactly')
    await expect(ui.box.locator('.mi-chip')).toHaveCount(0)
  })

  test("a phone keyboard's Backspace (beforeinput only) deletes next to and inside a formula", async ({ page }) => {
    const ui = await open(page)
    await halfIs(page, ui)
    await keyboardDelete(page, { id: ui.id, into: 'prose' })
    await expect(ui.box.locator('.mi-chip.mi-armed')).toHaveCount(1)
    await keyboardDelete(page, { id: ui.id, into: 'prose' })
    await expect(ui.box.locator('.mi-chip')).toHaveCount(0)
    await expect(ui.box).toHaveAttribute('data-value', 'Half is ')

    await ui.button('Power')
    await page.keyboard.type('2')
    await page.keyboard.press('Tab')
    await page.keyboard.type('3')
    // Keep pressing: into the exponent, the 3, back a box, the whole formula —
    // every press does something, and the formula is gone at the end.
    const snapshot = () =>
      page.evaluate((boxId) => {
        const root = document.getElementById(boxId)
        const field = root.querySelector('math-field')
        return JSON.stringify([root.dataset.value, field?.value, field?.selection?.ranges, root.querySelector('.mi-armed') !== null])
      }, ui.id)
    let before = await snapshot()
    for (let presses = 0; presses < 10 && (await ui.box.locator('.mi-chip').count()); presses += 1) {
      await keyboardDelete(page, { id: ui.id, into: (await caret(page, ui.id)).where })
      await expect.poll(snapshot).not.toBe(before)
      before = await snapshot()
    }
    await expect(ui.box.locator('.mi-chip')).toHaveCount(0)
    await expect(ui.box).toHaveAttribute('data-value', 'Half is ')
  })

  test('"Remove formula" on the row takes out the formula being edited, or the marked one, with one tap', async ({ page }) => {
    const ui = await open(page)
    const remove = ui.scope.getByRole('button', { name: 'Remove formula' })
    await halfIs(page, ui)
    await expect(remove).toBeHidden() // nothing being edited
    await ui.press(ui.box.locator('math-field'))
    await expectVisibleInFormula(page, ui.id)
    await expect(remove).toBeVisible()
    expect((await remove.boundingBox()).height).toBeGreaterThanOrEqual(ui.touch ? 40 : 30)
    await ui.press(remove)
    await expect(ui.box.locator('.mi-chip')).toHaveCount(0)
    await expect(ui.box).toHaveAttribute('data-value', 'Half is ')
    await expectInProse(page, ui.id)
    await expect(remove).toBeHidden()

    // Marked by a first Backspace from the sentence: the row offers it too.
    await ui.button('Power')
    await page.keyboard.type('2')
    await page.keyboard.press('Tab')
    await page.keyboard.type('3')
    await page.keyboard.press('Tab')
    await page.keyboard.press('Backspace')
    await expect(ui.box.locator('.mi-chip.mi-armed')).toHaveCount(1)
    await ui.press(remove)
    await expect(ui.box).toHaveAttribute('data-value', 'Half is ')
  })

  test('clearing the chat box disables Send', async ({ page }) => {
    const ui = await open(page, 'chat')
    await halfIs(page, ui)
    const send = ui.scope.getByRole('button', { name: 'Send' })
    await expect(send).toBeEnabled()
    await page.keyboard.press('ControlOrMeta+a')
    await page.keyboard.press('Backspace')
    await expect(ui.box).toHaveAttribute('data-value', '')
    await expect(send).toBeDisabled()
  })
}

/** Desktop only: Ctrl/Cmd+Z after removing a formula brings it back. */
export function undoTest() {
  test('undo straight after removing a formula puts it back', async ({ page }) => {
    const ui = await open(page)
    await halfIs(page, ui)
    await page.keyboard.press('Backspace')
    await page.keyboard.press('Backspace')
    await expect(ui.box).toHaveAttribute('data-value', 'Half is ')
    await page.keyboard.press('ControlOrMeta+z')
    await expect(ui.box).toHaveAttribute('data-value', 'Half is $\\frac{1}{2}$')
    await expect(ui.box.locator('math-field')).toHaveCount(1)
    await expectInProse(page, ui.id)
  })
}

/**
 * Taps an empty box (a MathLive placeholder, drawn as ▢) of the formula
 * `field`, picked by where it sits: 'lowest', 'highest' or 'rightmost'.
 */
export async function tapEmptyBox(page, field, which) {
  const spot = await field.evaluate((element, pick) => {
    const boxes = [...element.shadowRoot.querySelectorAll('.ML__content span')]
      .filter((span) => span.childElementCount === 0 && span.textContent === '▢')
      .map((span) => span.getBoundingClientRect())
    const by = {
      lowest: (a, b) => b.bottom - a.bottom,
      highest: (a, b) => a.top - b.top,
      rightmost: (a, b) => b.right - a.right,
    }[pick]
    const box = boxes.sort(by)[0]
    return box && { x: box.left + box.width / 2, y: box.top + box.height / 2 }
  }, which)
  if (!spot) throw new Error(`no empty box to tap (${which})`)
  await page.touchscreen.tap(spot.x, spot.y)
}

/** Taps just to the right of a formula, in the sentence. */
export async function tapAfter(page, box, field) {
  const formula = await field.boundingBox()
  const area = await box.boundingBox()
  await page.touchscreen.tap(Math.min(area.x + area.width - 12, formula.x + formula.width + 30), formula.y + formula.height / 2)
}
