import { createStore } from './server/store/index.js'
import { resolveQuestion } from './server/services/delivery.js'
import { reply } from './server/services/tutor.js'

const store = createStore()
if (store.init) await store.init()

const question = await resolveQuestion(store, { id: 'none' }, 'qst_7065b8a623934e84a077')
console.log('question:', {
  code: question.code,
  prompt: question.prompt || '(empty)',
  image: question.image && { name: question.image.name, type: question.image.type },
})

const generated = await reply({
  question,
  answer: null,
  action: null,
  text: 'Soru tam olarak ne soruyor? Bana sorunun ne hakkında olduğunu söyle.',
  promptVersion: null,
  systemPrompt: null,
  thread: [],
  lang: 'tr',
  store,
})

console.log('\nsource:', generated.source, generated.model ?? '')
console.log('reply:', generated.text)

if (store.close) await store.close()
process.exit(0)
