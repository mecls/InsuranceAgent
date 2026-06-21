import OpenAI from 'openai'
import type { z } from 'zod'
import { pdfToImages } from '@/lib/services/doc-parser'

// Single, fully open-source LLM path: an OpenAI-compatible endpoint (DeepSeek via
// Ollama Cloud for text/reasoning, an open VLM such as Qwen2.5-VL for vision).
// Forces a single named tool call, Zod-validates the tool input, and runs a
// bounded repair loop for models that wobble on structured output. PDFs are read
// by rasterizing each page to an image and sending it to the vision model (open
// models can't ingest PDF files directly). Reuse this; never call the SDK directly.

const DEFAULT_MAX_TOKENS = 32_000
const MAX_REPAIRS = 2
const REQUEST_TIMEOUT_MS = 60 * 60 * 1000
const DEFAULT_VISION_MAX_PAGES = 10

function maxTokensEnv(): number {
  const raw = process.env.LLM_MAX_TOKENS
  const n = raw ? Number(raw) : NaN
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_MAX_TOKENS
}

function visionMaxPages(): number {
  const raw = process.env.LLM_VISION_MAX_PAGES
  const n = raw ? Number(raw) : NaN
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_VISION_MAX_PAGES
}

function extractJsonObject(text: string | null | undefined): string | null {
  if (!text) return null
  let s = text.trim()
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) s = fence[1].trim()
  const start = s.indexOf('{')
  if (start === -1) return null
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < s.length; i++) {
    const ch = s[i]
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
    } else if (ch === '"') {
      inStr = true
    } else if (ch === '{') {
      depth++
    } else if (ch === '}') {
      depth--
      if (depth === 0) return s.slice(start, i + 1)
    }
  }
  return null
}

function deepParseJsonStrings(value: unknown, depth = 0): unknown {
  if (depth > 6) return value
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed)
        if (parsed !== null && typeof parsed === 'object') {
          return deepParseJsonStrings(parsed, depth + 1)
        }
      } catch {
        // not JSON; leave the string as-is
      }
    }
    return value
  }
  if (Array.isArray(value)) {
    return value.map((v) => deepParseJsonStrings(v, depth + 1))
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
      out[k] = deepParseJsonStrings(v, depth + 1)
    }
    return out
  }
  return value
}

type ParseOutcome<T> = { ok: true; data: T } | { ok: false; error: string }

function parseToSchema<T>(
  json: string | null,
  schema: z.ZodSchema<T>,
): ParseOutcome<T> {
  if (!json) return { ok: false, error: 'no JSON object found in model output' }
  let raw: unknown
  try {
    raw = deepParseJsonStrings(JSON.parse(json))
  } catch (err) {
    return {
      ok: false,
      error: `invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      error: `schema validation: ${JSON.stringify(parsed.error.issues).slice(0, 600)}`,
    }
  }
  return { ok: true, data: parsed.data }
}

function extractCandidate(
  response: OpenAI.Chat.Completions.ChatCompletion,
  toolName: string,
): { json: string | null; raw: string; source: string } {
  const choice = response.choices[0]
  if (!choice) return { json: null, raw: '', source: 'no-choice' }
  const toolCall = choice.message.tool_calls?.[0]
  if (toolCall && toolCall.type === 'function') {
    const args = toolCall.function.arguments
    const source = toolCall.function.name === toolName ? 'tool' : 'tool-wrong-name'
    return { json: args, raw: args, source }
  }
  const content = choice.message.content ?? ''
  const extracted = extractJsonObject(content)
  const source = extracted
    ? 'content'
    : choice.finish_reason === 'length'
      ? 'length'
      : 'none'
  return { json: extracted, raw: content, source }
}

function isClientError(err: unknown): boolean {
  const status = (err as { status?: number } | null)?.status
  return typeof status === 'number' && status >= 400 && status < 500
}

/** A system prompt block. (Plain text; the provider is OpenAI-compatible.) */
export interface SystemTextBlock {
  type: 'text'
  text: string
}

export interface PdfAttachment {
  /** Base64 of the PDF bytes. Rasterized to page images for the vision model. */
  base64: string
  label?: string
}

let openaiClient: OpenAI | null = null
function getClient(): OpenAI {
  if (openaiClient) return openaiClient
  const apiKey = process.env.LLM_API_KEY
  const baseURL = process.env.LLM_BASE_URL
  if (!apiKey) throw new Error('LLM_API_KEY not set')
  if (!baseURL) throw new Error('LLM_BASE_URL not set')
  openaiClient = new OpenAI({
    apiKey,
    baseURL,
    timeout: REQUEST_TIMEOUT_MS,
    maxRetries: 0,
  })
  return openaiClient
}

export interface RunToolParams<T> {
  systemBlocks: SystemTextBlock[]
  userPrompt: string
  toolName: string
  toolDescription: string
  toolInputSchema: object
  schema: z.ZodSchema<T>
  callLabel: string
  /** A single PDF to attach (convenience). */
  pdf?: PdfAttachment
  /** Multiple PDFs to attach (e.g. ACORD + supplemental). Merged with `pdf`. */
  pdfs?: PdfAttachment[]
  /** Optional model override. Falls back to LLM_VISION_MODEL (vision) / LLM_MODEL. */
  model?: string
}

/** Rasterize attached PDFs to base64 PNG pages (capped) for the vision model. */
async function pdfsToImageParts(
  pdfs: PdfAttachment[],
  callLabel: string,
): Promise<OpenAI.Chat.Completions.ChatCompletionContentPart[]> {
  const parts: OpenAI.Chat.Completions.ChatCompletionContentPart[] = []
  let budget = visionMaxPages()
  for (const p of pdfs) {
    if (budget <= 0) break
    const bytes = new Uint8Array(Buffer.from(p.base64, 'base64'))
    const pages = await pdfToImages(bytes, { maxPages: budget })
    budget -= pages.length
    for (const b64 of pages) {
      parts.push({
        type: 'image_url',
        image_url: { url: `data:image/png;base64,${b64}` },
      })
    }
  }
  console.log(
    `[llm-timing] ${callLabel} rasterized ${pdfs.length} pdf(s) -> ${parts.length} page image(s)`,
  )
  return parts
}

export async function runTool<T>(params: RunToolParams<T>): Promise<T> {
  const {
    systemBlocks,
    userPrompt,
    toolName,
    toolDescription,
    toolInputSchema,
    schema,
    callLabel,
    pdf,
    pdfs,
    model: modelOverride,
  } = params

  const allPdfs = [...(pdf ? [pdf] : []), ...(pdfs ?? [])]
  const visionCall = allPdfs.length > 0

  if (visionCall && !modelOverride && !process.env.LLM_VISION_MODEL) {
    throw new Error(
      `[${callLabel}] PDF input requires a vision model. Set LLM_VISION_MODEL (e.g. qwen2.5vl:7b) on your OpenAI-compatible endpoint.`,
    )
  }
  const envModel = visionCall
    ? process.env.LLM_VISION_MODEL ?? process.env.LLM_MODEL
    : process.env.LLM_MODEL
  const model: string = modelOverride ?? envModel ?? ''
  if (!model) throw new Error('LLM_MODEL not set')

  const maxTokens = maxTokensEnv()
  const systemText = systemBlocks.map((b) => b.text).join('\n\n')
  const client = getClient()

  const imageParts = visionCall ? await pdfsToImageParts(allPdfs, callLabel) : []
  const userContent: OpenAI.Chat.Completions.ChatCompletionUserMessageParam['content'] =
    imageParts.length > 0
      ? [...imageParts, { type: 'text', text: userPrompt }]
      : userPrompt

  const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
    {
      type: 'function',
      function: {
        name: toolName,
        description: toolDescription,
        parameters: toolInputSchema as Record<string, unknown>,
      },
    },
  ]

  const baseMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemText },
    { role: 'user', content: userContent },
  ]

  async function complete(
    messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
    force: boolean,
  ): Promise<{ response: OpenAI.Chat.Completions.ChatCompletion; forced: boolean }> {
    try {
      const response = await client.chat.completions.create({
        model,
        max_tokens: maxTokens,
        messages,
        tools,
        tool_choice: force
          ? { type: 'function', function: { name: toolName } }
          : 'auto',
      })
      return { response, forced: force }
    } catch (err) {
      if (force && isClientError(err)) {
        console.log(
          `[${callLabel}] forced tool_choice rejected (status=${(err as { status?: number }).status}); retrying with tool_choice=auto`,
        )
        const response = await client.chat.completions.create({
          model,
          max_tokens: maxTokens,
          messages,
          tools,
          tool_choice: 'auto',
        })
        return { response, forced: false }
      }
      throw err
    }
  }

  const startedAt = Date.now()
  console.log(
    `[llm-timing] ${callLabel} call started model=${model} maxTokens=${maxTokens}${imageParts.length ? ` images=${imageParts.length}` : ''} baseURL=${process.env.LLM_BASE_URL}`,
  )

  const { response, forced } = await complete(baseMessages, true)
  const elapsedMs = Date.now() - startedAt
  console.log(
    `[llm-timing] ${callLabel} ms=${elapsedMs} finish=${response.choices[0]?.finish_reason} forced=${forced} usage=${JSON.stringify(response.usage)}`,
  )

  let candidate = extractCandidate(response, toolName)
  let outcome = parseToSchema(candidate.json, schema)
  if (outcome.ok) return outcome.data

  let messages = baseMessages
  let forcedNow = forced
  let sawLength = candidate.source === 'length'
  const firstError = outcome.error

  for (let attempt = 1; attempt <= MAX_REPAIRS && !outcome.ok; attempt++) {
    console.log(
      `[${callLabel}] output unusable (source=${candidate.source}); repair ${attempt}/${MAX_REPAIRS}. err=${outcome.error.slice(0, 300)}`,
    )
    messages = [
      ...messages,
      { role: 'assistant', content: candidate.raw || '(no output)' },
      {
        role: 'user',
        content: `Your previous output could not be used: ${outcome.error}\n\nRe-emit the COMPLETE \`${toolName}\` input as a single JSON object, fixing only those issues. Emit every nested value as a real JSON object/array, NOT as a quoted string. Respect every length and item-count constraint. Output JSON only, no other text.`,
      },
    ]
    const repair = await complete(messages, forcedNow)
    forcedNow = repair.forced
    console.log(
      `[llm-timing] ${callLabel} repair ${attempt} finish=${repair.response.choices[0]?.finish_reason} forced=${forcedNow}`,
    )
    candidate = extractCandidate(repair.response, toolName)
    sawLength = sawLength || candidate.source === 'length'
    outcome = parseToSchema(candidate.json, schema)
  }

  if (outcome.ok) return outcome.data

  const lengthHint = sawLength
    ? ` (hit max_tokens=${maxTokens} before completing output; raise LLM_MAX_TOKENS)`
    : ''
  throw new Error(
    `[${callLabel}] failed after ${MAX_REPAIRS} repair attempts${lengthHint}. firstErr=${firstError.slice(0, 250)} | lastErr=${outcome.error.slice(0, 250)}`,
  )
}
