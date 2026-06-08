import { env } from '@/lib/env'

/**
 * WebResearch — real web search + fetch behind a clean interface. Uses Tavily
 * when TAVILY_API_KEY is set; otherwise degrades to an empty result set with a
 * documented note (the research agent then reasons from the Case File + data
 * feeds only and says so). Production can swap in any search provider here.
 */

export interface SearchResult {
  title: string
  url: string
  content: string
}

export interface SearchResponse {
  query: string
  answer?: string
  results: SearchResult[]
  /** Set when no provider is configured, so the agent can be honest on screen. */
  degraded?: boolean
}

export async function webSearch(
  query: string,
  maxResults = 5,
): Promise<SearchResponse> {
  const key = env.tavilyApiKey()
  if (!key) {
    return { query, results: [], degraded: true }
  }
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: key,
        query,
        search_depth: 'basic',
        max_results: maxResults,
        include_answer: true,
      }),
    })
    if (!res.ok) {
      return { query, results: [], degraded: true }
    }
    const data = (await res.json()) as {
      answer?: string
      results?: { title?: string; url?: string; content?: string }[]
    }
    return {
      query,
      answer: data.answer,
      results: (data.results ?? []).map((r) => ({
        title: r.title ?? '',
        url: r.url ?? '',
        content: (r.content ?? '').slice(0, 1200),
      })),
    }
  } catch {
    return { query, results: [], degraded: true }
  }
}
