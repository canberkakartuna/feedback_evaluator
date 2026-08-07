import { config } from '../config.js'

/**
 * The model behind the tutor: Google's Generative Language API, over `fetch`.
 *
 * No SDK, on purpose. The whole surface used here is one POST carrying an API
 * key header, and `@google/genai` would be a dependency — and a supply chain —
 * for less code than this file. Reach for the SDK if streaming, file uploads or
 * the Live API are ever wanted; nothing below is in the way of that.
 *
 * Three things about this API are worth knowing before reading the code, all
 * three found by calling it rather than by reading about it:
 *
 * - **A 200 is not necessarily a reply.** It can carry no candidate at all
 *   (`promptFeedback.blockReason`), or one cut off before it finished
 *   (`finishReason: MAX_TOKENS`, `SAFETY`) — and a truncated candidate still
 *   contains text, ending mid-sentence. All of it is treated as failure here:
 *   the caller's fallback is a whole scripted sentence, which is a better thing
 *   to put in front of a student than half of a better one.
 * - **Thinking is billed to `maxOutputTokens`, and the reply is what gets cut.**
 *   Measured on `gemini-3.6-flash` at `thinkingLevel: low`: a 400-token
 *   allowance went 382 tokens of thinking, 14 tokens of reply, `MAX_TOKENS`.
 *   The allowance therefore has to cover the reasoning *and* the answer; the
 *   length of the answer is controlled by the word cap in the prompt, not by
 *   this number. Do not tighten it to save money — it does not.
 * - **Thinking is configured differently per model generation, and getting it
 *   wrong is a 400, not a warning.** 3.x takes
 *   `thinkingConfig.thinkingLevel: low|high` and cannot be told not to think at
 *   all; 2.5 took `thinkingConfig.thinkingBudget`, a token count, and `0`
 *   turned it off. `gemini-flash-latest` resolves to a 3.x model today, so
 *   `thinkingLevel` is the default here and `thinkingBudget` is what to send if
 *   the model is ever pinned back to a 2.5 — `config.gemini.thinking` carries
 *   whichever, verbatim.
 *
 * Errors are thrown, never swallowed: services/tutor.js is the one place that
 * decides what a student sees when the model is unavailable.
 */

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models'

/**
 * Statuses worth one more go: the provider having a bad minute.
 *
 * **429 is deliberately not here.** A quota rejection names how long to wait,
 * and it is not milliseconds — the free tier answers "retry in 41s" to the sixth
 * request in a minute. Retrying into that spends another request from the same
 * quota to fail the same way while a student watches a typing indicator. Falling
 * back to the scripted line immediately is the better trade, and the log line
 * that says so is how a rate limit gets noticed at all. Anything else — 400 for
 * a malformed request, 403 for a bad key — fails again identically.
 */
const RETRYABLE = new Set([408, 500, 502, 503, 504])

export class GeminiError extends Error {
  constructor(message, { status = null, retryable = false } = {}) {
    super(message)
    this.name = 'GeminiError'
    this.status = status
    this.retryable = retryable
  }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Reads the text out of a response, or says why there is none. */
function readReply(payload) {
  const blocked = payload?.promptFeedback?.blockReason
  if (blocked) throw new GeminiError(`prompt blocked (${blocked})`)

  const candidate = payload?.candidates?.[0]
  if (!candidate) throw new GeminiError('no candidate in the response')

  const text = (candidate.content?.parts ?? [])
    .map((part) => part.text ?? '')
    .join('')
    .trim()

  /**
   * `STOP` means the model finished its sentence. Everything else is a reply
   * that stopped happening — `MAX_TOKENS` for the token accounting described
   * above, `SAFETY` and `RECITATION` for refusals — and the text that came with
   * it, if any, is a fragment. The finish reason is what makes the log line
   * actionable, so it travels in the message.
   */
  const finishReason = candidate.finishReason ?? 'STOP'
  if (finishReason !== 'STOP') throw new GeminiError(`stopped early (${finishReason})`)
  if (!text) throw new GeminiError('finished with no text')

  return {
    text,
    finishReason,
    usage: {
      prompt: payload.usageMetadata?.promptTokenCount ?? null,
      output: payload.usageMetadata?.candidatesTokenCount ?? null,
      thoughts: payload.usageMetadata?.thoughtsTokenCount ?? null,
    },
  }
}

/**
 * One turn of generation.
 *
 * @param {object} options
 * @param {string} [options.system] System instruction — the active prompt plus
 *   whatever context the caller has assembled.
 * @param {Array<{ role: 'user' | 'model', text: string }>} options.turns The
 *   conversation, oldest first, ending with what the student just said.
 * @returns {Promise<{ text: string, model: string, finishReason: string|null, usage: object, ms: number }>}
 */
export async function generate({
  system,
  turns,
  model = config.gemini.model,
  apiKey = config.gemini.apiKey,
  temperature = config.gemini.temperature,
  maxOutputTokens = config.gemini.maxOutputTokens,
  thinking = config.gemini.thinking,
  timeoutMs = config.gemini.timeoutMs,
  attempts = 2,
} = {}) {
  if (!apiKey) throw new GeminiError('GEMINI_API_KEY is not set')
  if (!turns?.length) throw new GeminiError('nothing to send')

  const body = {
    contents: turns.map((turn) => ({ role: turn.role, parts: [{ text: turn.text }] })),
    generationConfig: {
      temperature,
      maxOutputTokens,
      // Passed through as configured, because which key belongs in here depends
      // on the model generation and the wrong one is a 400. Null omits it and
      // lets the model use its own default, which every model has.
      ...(thinking ? { thinkingConfig: thinking } : {}),
    },
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
  }

  const started = Date.now()
  let last = null

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(`${ENDPOINT}/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      })

      const text = await response.text()
      let payload = null
      try {
        payload = text ? JSON.parse(text) : null
      } catch {
        payload = null
      }

      if (!response.ok) {
        // Google's error body is `{ error: { code, message, status } }`. The
        // key itself is never in it, so this is safe to log and to keep.
        const detail = payload?.error?.message ?? text.slice(0, 300) ?? ''
        throw new GeminiError(`${response.status} ${detail}`.trim(), {
          status: response.status,
          retryable: RETRYABLE.has(response.status),
        })
      }

      return { ...readReply(payload), model, ms: Date.now() - started }
    } catch (error) {
      // A timeout or a dropped connection arrives as a DOMException/TypeError
      // rather than a GeminiError, and both are worth one retry.
      const retryable = error instanceof GeminiError ? error.retryable : true
      last =
        error instanceof GeminiError
          ? error
          : new GeminiError(error.name === 'TimeoutError' ? `timed out after ${timeoutMs}ms` : error.message, {
              retryable: true,
            })

      if (!retryable || attempt === attempts) break
      await wait(300 * attempt)
    }
  }

  throw last
}
