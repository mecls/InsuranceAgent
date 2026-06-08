import type { AttachmentManifestItem } from '@/lib/underwriting/case-file'
import { uploadAttachment } from '@/lib/db/runs'
import { makeTextPdf } from './make-pdf'
import { rowsToXlsx } from '@/lib/services/doc-parser'
import { getPacket, type Packet } from './packets'

/**
 * Materialize a synthetic packet into real files in Supabase Storage and return
 * the attachment manifest. The intake agent calls this for scenario runs; the
 * extraction agent later downloads + parses these exact files, so the full
 * storage → download → parse path runs on genuine PDFs / xlsx.
 */
export async function buildAndUploadPacket(
  runSlug: string,
  scenario: string,
): Promise<{ packet: Packet; manifest: AttachmentManifestItem[] }> {
  const packet = getPacket(scenario)

  const acordPdf = makeTextPdf('ACORD 125 — Commercial Insurance Application', packet.acord125Lines)
  const supplementPdf = makeTextPdf('GL Supplemental Application', packet.glSupplementalLines)
  const lossXlsx = rowsToXlsx('Loss Runs', packet.lossRows)
  const coverTxt = new TextEncoder().encode(packet.coverLetter)

  const files: {
    filename: string
    kind: AttachmentManifestItem['kind']
    mime: string
    bytes: Uint8Array
  }[] = [
    { filename: 'acord_125.pdf', kind: 'acord_125', mime: 'application/pdf', bytes: acordPdf },
    {
      filename: 'gl_supplemental.pdf',
      kind: 'gl_supplemental',
      mime: 'application/pdf',
      bytes: supplementPdf,
    },
    {
      filename: 'loss_run.xlsx',
      kind: 'loss_run',
      mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      bytes: lossXlsx,
    },
    { filename: 'cover_letter.txt', kind: 'cover_letter', mime: 'text/plain', bytes: coverTxt },
  ]

  const manifest: AttachmentManifestItem[] = []
  for (const f of files) {
    const storagePath = await uploadAttachment({
      runSlug,
      filename: f.filename,
      bytes: f.bytes,
      contentType: f.mime,
    })
    manifest.push({
      filename: f.filename,
      kind: f.kind,
      mime: f.mime,
      storagePath,
      sizeBytes: f.bytes.length,
    })
  }

  return { packet, manifest }
}
