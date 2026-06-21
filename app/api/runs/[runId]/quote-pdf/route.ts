import { type NextRequest } from 'next/server'
import { getRunById } from '@/lib/db/runs'
import { buildQuotePdf, quoteFilename } from '@/lib/quote/quote-pdf'

export const runtime = 'nodejs'

/**
 * Download the finished quotation as a PDF. Built deterministically from the
 * run's Case File (premium, breakdown, appetite, subjectivities, disclosures),
 * carrying the SIMULATED / reliability caveats through to print.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params
  const run = await getRunById(runId)
  if (!run) return new Response('not found', { status: 404 })

  const pdf = buildQuotePdf(run)
  const filename = quoteFilename(run.case_file, run.slug)

  return new Response(pdf as unknown as BodyInit, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}
