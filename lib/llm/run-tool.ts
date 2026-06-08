import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import type { z } from 'zod'

// Forked from miraside/lib/llm/run-tool.ts. Forces a single named tool call,
// Zod-validates the tool input, attaches PDFs natively to Claude (vision — no
// separate OCR engine needed), uses ephemeral prompt caching, and supports an
// OpenAI-compatible fallback with a bounded repair loop. Reuse this; never call
// the SDKs directly.

const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-4-6'
const MAX_TOKENS = 16_000
const DEFAULT_OPENAI_MAX_TOKENS = 32_000
const MAX_OPENAI_REPAIRS = 2
const REQUEST_TIMEOUT_MS = 60 * 60 * 1000

function openAIMaxTokens(): number {
  const raw = process.env.LLM_MAX_TOKENS
  const n = raw ? Number(raw) : NaN
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_OPENAI_MAX_TOKENS
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

export type CachedTextBlock = Anthropic.TextBlockParam & {
  cache_control?: { type: 'ephemeral' }
}

export interface PdfAttachment {
  base64: string
  label?: string
}

type Provider = 'anthropic' | 'openai-compatible'

function provider(): Provider {
  const raw = (process.env.LLM_PROVIDER ?? 'anthropic').toLowerCase()
  if (raw === 'openai-compatible' || raw === 'openai') return 'openai-compatible'
  return 'anthropic'
}

let anthropicClient: Anthropic | null = null
function getAnthropic(): Anthropic {
  if (anthropicClient) return anthropicClient
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set')
  anthropicClient = new Anthropic({ apiKey, timeout: REQUEST_TIMEOUT_MS })
  return anthropicClient
}

let openaiClient: OpenAI | null = null
function getOpenAI(): OpenAI {
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
  systemBlocks: CachedTextBlock[]
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
  /**
   * Optional Anthropic model override (e.g. a faster model for high-volume
   * extraction). Falls back to ANTHROPIC_MODEL then the default.
   */
  model?: string
}

export async function runTool<T>(params: RunToolParams<T>): Promise<T> {
  return provider() === 'openai-compatible'
    ? runViaOpenAICompatible(params)
    : runViaAnthropic(params)
}

async function runViaAnthropic<T>(params: RunToolParams<T>): Promise<T> {
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
  const model =
    modelOverride ?? process.env.ANTHROPIC_MODEL ?? DEFAULT_ANTHROPIC_MODEL
  const allPdfs = [...(pdf ? [pdf] : []), ...(pdfs ?? [])]
  const startedAt = Date.now()
  console.log(
    `[llm-timing] ${callLabel} anthropic call started model=${model}${allPdfs.length ? ` pdfs=${allPdfs.length}` : ''}`,
  )

  const userContent: Anthropic.MessageCreateParams['messages'][number]['content'] =
    allPdfs.length > 0
      ? ([
          ...allPdfs.map(
            (p) =>
              ({
                type: 'document',
                source: {
                  type: 'base64',
                  media_type: 'application/pdf',
                  data: p.base64,
                },
                // Cache each document so parallel calls reuse it.
                cache_control: { type: 'ephemeral' },
              }) as unknown as Anthropic.MessageCreateParams['messages'][number]['content'][number],
          ),
          { type: 'text', text: userPrompt },
        ] as Anthropic.MessageCreateParams['messages'][number]['content'])
      : userPrompt

  const response = await getAnthropic().messages.create({
    model,
    max_tokens: MAX_TOKENS,
    system: systemBlocks as unknown as Anthropic.TextBlockParam[],
    tools: [
      {
        name: toolName,
        description: toolDescription,
        input_schema: toolInputSchema as unknown as Anthropic.Tool['input_schema'],
      },
    ],
    tool_choice: { type: 'tool', name: toolName },
    messages: [{ role: 'user', content: userContent }],
  })

  const elapsedMs = Date.now() - startedAt
  const usage = response.usage as Anthropic.Usage & {
    cache_read_input_tokens?: number
    cache_creation_input_tokens?: number
  }
  console.log(
    `[llm-timing] ${callLabel} ms=${elapsedMs} stop=${response.stop_reason} in=${usage.input_tokens} out=${usage.output_tokens} cache_read=${usage.cache_read_input_tokens ?? 0} cache_create=${usage.cache_creation_input_tokens ?? 0}`,
  )

  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
  )
  if (!toolUse) {
    const textBlocks = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
    throw new Error(
      `[${callLabel}] no tool_use block. stop_reason=${response.stop_reason} text=${textBlocks.join(' | ').slice(0, 400)}`,
    )
  }
  if (toolUse.name !== toolName) {
    throw new Error(`[${callLabel}] unexpected tool name: ${toolUse.name}`)
  }
  const parsed = schema.safeParse(toolUse.input)
  if (!parsed.success) {
    const inputPreview = JSON.stringify(toolUse.input).slice(0, 600)
    throw new Error(
      `[${callLabel}] schema validation failed: ${JSON.stringify(parsed.error.issues).slice(0, 800)} | input=${inputPreview}`,
    )
  }
  return parsed.data
}

async function runViaOpenAICompatible<T>(params: RunToolParams<T>): Promise<T> {
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
  } = params
  if (pdf || (pdfs && pdfs.length > 0)) {
    throw new Error(
      `[${callLabel}] PDF attachments are only supported on the Anthropic provider. Set LLM_PROVIDER=anthropic.`,
    )
  }
  const envModel = process.env.LLM_MODEL
  if (!envModel) throw new Error('LLM_MODEL not set')
  const model: string = envModel

  const maxTokens = openAIMaxTokens()
  const systemText = systemBlocks.map((b) => b.text).join('\n\n')
  const client = getOpenAI()

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
    { role: 'user', content: userPrompt },
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
    `[llm-timing] ${callLabel} openai-compatible call started model=${model} maxTokens=${maxTokens} baseURL=${process.env.LLM_BASE_URL}`,
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

  for (let attempt = 1; attempt <= MAX_OPENAI_REPAIRS && !outcome.ok; attempt++) {
    console.log(
      `[${callLabel}] output unusable (source=${candidate.source}); repair ${attempt}/${MAX_OPENAI_REPAIRS}. err=${outcome.error.slice(0, 300)}`,
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
    ? ` (hit max_tokens=${maxTokens} before completing output; raise LLM_MAX_TOKENS or set LLM_PROVIDER=anthropic)`
    : ''
  throw new Error(
    `[${callLabel}] failed after ${MAX_OPENAI_REPAIRS} repair attempts${lengthHint}. firstErr=${firstError.slice(0, 250)} | lastErr=${outcome.error.slice(0, 250)}`,
  )
}
