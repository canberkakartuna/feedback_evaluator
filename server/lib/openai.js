import { config } from '../config.js'

/**
 * The model behind the tutor: OpenAI's Chat Completions API, over `fetch`.
 *
 * No SDK, on purpose. The whole surface used here is one POST carrying a
 * bearer token, and the `openai` package would be a dependency — and a supply
 * chain — for less code than this file. Reach for the SDK if streaming, file
 * uploads or the Realtime API are ever wanted; nothing below is in the way of
 * that.
 *
 * Three things about this API are worth knowing before reading the code:
 *
 * - **A 200 is not necessarily a reply.** The choice can end with
 *   `finish_reason: "length"` (the token budget ran out mid-sentence) or
 *   `"content_filter"` (a refusal), and a truncated choice still contains
 *   text, ending mid-sentence. All of it is treated as failure here: the
 *   caller's fallback is a whole scripted sentence, which is a better thing
 *   to put in front of a student than half of a better one.
 * - **Reasoning is billed to `max_completion_tokens`, and the reply is what
 *   gets cut.** On the reasoning models (o-series, gpt-5-*), the hidden
 *   reasoning tokens come out of the same allowance as the visible answer and
 *   are spent first — a tight budget produces `finish_reason: "length"` with
 *   little or no text, not a shorter reply. The length of the answer is
 *   controlled by the word cap in the prompt, not by this number. Do not
 *   tighten it to save money — it does not.
 * - **The knobs are not accepted uniformly across model families.** The
 *   reasoning models reject `temperature` (only the default is allowed) and
 *   take `reasoning_effort` instead; the non-reasoning models (gpt-4o-mini
 *   and friends) accept `temperature` and reject `reasoning_effort`. Sending
 *   the wrong one is a 400, not a warning — so both are omitted when their
 *   config value is null, and config.js decides which to carry.
 *   `max_completion_tokens` is the one name both families take (`max_tokens`
 *   is the deprecated spelling the reasoning models refuse).
 *
 * Errors are thrown, never swallowed: services/tutor.js is the one place that
 * decides what a student sees when the model is unavailable.
 */

const ENDPOINT = 'https://api.openai.com/v1/chat/completions'

/**
 * Statuses worth one more go: the provider having a bad minute.
 *
 * **429 is deliberately not here.** On the free tier the rate and daily-token
 * limits are tight, and a quota rejection names how long to wait — it is not
 * milliseconds. Retrying into that spends another request from the same quota
 * to fail the same way while a student watches a typing indicator. Falling
 * back to the scripted line immediately is the better trade, and the log line
 * that says so is how a rate limit gets noticed at all. Anything else — 400
 * for a malformed request, 401 for a bad key — fails again identically.
 */
const RETRYABLE = new Set([408, 500, 502, 503, 504])

export class OpenAIError extends Error {
  constructor(message, { status = null, retryable = false } = {}) {
    super(message)
    this.name = 'OpenAIError'
    this.status = status
    this.retryable = retryable
  }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Reads the text out of a response, or says why there is none. */
function readReply(payload) {
  const choice = payload?.choices?.[0]
  if (!choice) throw new OpenAIError('no choice in the response')

  const text = (choice.message?.content ?? '').trim()

  /**
   * `stop` means the model finished its sentence. Everything else is a reply
   * that stopped happening — `length` for the token accounting described
   * above, `content_filter` for refusals — and the text that came with it, if
   * any, is a fragment. The finish reason is what makes the log line
   * actionable, so it travels in the message.
   */
  const finishReason = choice.finish_reason ?? 'stop'
  if (finishReason !== 'stop') throw new OpenAIError(`stopped early (${finishReason})`)
  if (!text) throw new OpenAIError('finished with no text')

  return {
    text,
    finishReason,
    usage: {
      prompt: payload.usage?.prompt_tokens ?? null,
      output: payload.usage?.completion_tokens ?? null,
      thoughts: payload.usage?.completion_tokens_details?.reasoning_tokens ?? null,
    },
  }
}

/**
 * One turn of generation.
 *
 * @param {object} options
 * @param {string} [options.system] System instruction — the active prompt plus
 *   whatever context the caller has assembled.
 * @param {Array<{ role: 'user' | 'model', text: string, images?: string[] }>} options.turns The
 *   conversation, oldest first, ending with what the student just said. A turn
 *   may carry `images` — https or data URLs the model can view (JPG, PNG,
 *   WebP) — which become image parts alongside the text. User turns only: the
 *   API takes images from the user, not the assistant.
 * @returns {Promise<{ text: string, model: string, finishReason: string|null, usage: object, ms: number }>}
 */
export async function generate({
  system,
  turns,
  model = config.openai.model,
  apiKey = config.openai.apiKey,
  temperature = config.openai.temperature,
  maxOutputTokens = config.openai.maxOutputTokens,
  reasoningEffort = config.openai.reasoningEffort,
  timeoutMs = config.openai.timeoutMs,
  attempts = 2,
} = {}) {
  if (!apiKey) throw new OpenAIError('OPENAI_API_KEY is not set')
  if (!turns?.length) throw new OpenAIError('nothing to send')

  const body = {
    model,
    messages: [
      ...(system ? [{ role: 'system', content: system }] : []),
      // The tutor's turn shape says `model`; this API says `assistant`. A turn
      // with images becomes content parts; a plain one stays a plain string.
      ...turns.map((turn) => ({
        role: turn.role === 'model' ? 'assistant' : 'user',
        content: turn.images?.length
          ? [
              { type: 'text', text: turn.text },
              ...turn.images.map((url) => ({ type: 'image_url', image_url: { url } })),
            ]
          : turn.text,
      })),
    ],
    max_completion_tokens: maxOutputTokens,
    // Both omitted when null, because each is a 400 on the model family that
    // does not take it — see the header comment. config.js carries the right
    // one for the configured model.
    ...(temperature == null ? {} : { temperature }),
    ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
  }

  const started = Date.now()
  let last = null

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
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
        // OpenAI's error body is `{ error: { message, type, code } }`. The
        // key itself is never in it, so this is safe to log and to keep.
        const detail = payload?.error?.message ?? text.slice(0, 300) ?? ''
        throw new OpenAIError(`${response.status} ${detail}`.trim(), {
          status: response.status,
          retryable: RETRYABLE.has(response.status),
        })
      }

      return { ...readReply(payload), model: payload?.model ?? model, ms: Date.now() - started }
    } catch (error) {
      // A timeout or a dropped connection arrives as a DOMException/TypeError
      // rather than an OpenAIError, and both are worth one retry.
      const retryable = error instanceof OpenAIError ? error.retryable : true
      last =
        error instanceof OpenAIError
          ? error
          : new OpenAIError(error.name === 'TimeoutError' ? `timed out after ${timeoutMs}ms` : error.message, {
              retryable: true,
            })

      if (!retryable || attempt === attempts) break
      await wait(300 * attempt)
    }
  }

  throw last
}
