import { events } from '@/lib/events/emit'
import type { CaseFile } from '@/lib/underwriting/case-file'
import { buildAndUploadPacket } from '@/lib/demo/build-packet'

/**
 * Intake Agent — receive the broker submission, inventory + classify the
 * attachments, and open the case.
 *
 * Demo: scenario runs materialize a synthetic packet into real files (PDFs +
 * xlsx) in Storage and build the manifest from them. A real upload path parses
 * the forwarded `.eml` instead; either way the extraction agent downloads and
 * parses the exact files listed here.
 */
export async function runIntake(
  runId: string,
  runSlug: string,
  scenario: string,
  caseFile: CaseFile,
): Promise<CaseFile> {
  await events.entered(runId, 'intake', 'Receiving broker submission')
  await events.activity(runId, 'intake', 'Reading broker email', 0.2)

  const { packet, manifest } = await buildAndUploadPacket(runSlug, scenario)

  await events.activity(
    runId,
    'intake',
    `Classifying ${manifest.length} attachments`,
    0.6,
  )
  for (const a of manifest) {
    await events.activity(runId, 'intake', `${a.filename} → ${a.kind}`, 0.8)
  }

  caseFile.submission.broker = {
    name: packet.broker.name,
    email: packet.broker.email,
  }
  caseFile.attachments = manifest
  caseFile.status = 'extracting'

  await events.output(runId, 'intake', `Case opened — ${manifest.length} documents`, {
    broker: caseFile.submission.broker,
    attachments: manifest.map((m) => ({ filename: m.filename, kind: m.kind })),
  })
  await events.completed(
    runId,
    'intake',
    `${manifest.length} documents classified`,
    `${manifest.length} docs`,
  )
  return caseFile
}
