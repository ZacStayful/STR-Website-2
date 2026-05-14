import 'server-only'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import type { AnalysisResult } from '@/lib/types'

/**
 * Generate a one-page A4 PDF summary of an analysis result. Uses pdf-lib
 * (pure JS, no native deps) so it works in Vercel's serverless runtime.
 * Returns Uint8Array (what pdf-lib's save() produces natively).
 */
export async function generateAnalysisPDF(result: AnalysisResult): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create()
  const page = pdfDoc.addPage([595.28, 841.89]) // A4 portrait
  const { height } = page.getSize()
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold)

  let y = height - 50

  const drawLine = (
    text: string,
    opts: { size?: number; bold?: boolean; color?: [number, number, number]; gap?: number } = {},
  ) => {
    const { size = 11, bold = false, color = [0.2, 0.2, 0.2], gap = 4 } = opts
    page.drawText(text, {
      x: 50,
      y,
      size,
      font: bold ? boldFont : font,
      color: rgb(color[0], color[1], color[2]),
    })
    y -= size + gap
  }

  // Title block
  drawLine('Stayful Intelligence Analysis', { size: 20, bold: true, color: [0.18, 0.29, 0.18] })
  drawLine(new Date(result.createdAt).toLocaleString('en-GB'), { size: 9, color: [0.45, 0.45, 0.45], gap: 16 })

  // Property
  drawLine(result.property.address, { size: 14, bold: true, color: [0, 0, 0] })
  drawLine(
    `${result.property.postcode} · ${result.property.bedrooms} bed · sleeps ${result.property.guests}`,
    { size: 10, gap: 14 },
  )

  // Verdict
  drawLine('Verdict', { size: 13, bold: true, color: [0, 0, 0] })
  drawLine(`Fit: ${result.verdict.fit}`)
  drawLine(`Risk level: ${result.verdict.riskLevel}`)
  drawLine(`Risk score: ${result.risk.overallScore}/10`, { gap: 14 })

  // Revenue
  const f = result.financials
  const stlNet = Math.round(f.shortLetGrossAnnual * 0.52)
  const ltlNet = Math.round(f.longLetGrossAnnual * 0.9)
  drawLine('Revenue (annual)', { size: 13, bold: true, color: [0, 0, 0] })
  drawLine(`Short-let gross:  £${f.shortLetGrossAnnual.toLocaleString('en-GB')}`)
  drawLine(`Short-let net:    £${stlNet.toLocaleString('en-GB')}`)
  drawLine(`Long-let gross:   £${f.longLetGrossAnnual.toLocaleString('en-GB')}`)
  drawLine(`Long-let net:     £${ltlNet.toLocaleString('en-GB')}`, { gap: 14 })

  // Top comparables
  if (result.shortLet.comparables.length > 0) {
    drawLine('Top comparables', { size: 13, bold: true, color: [0, 0, 0] })
    result.shortLet.comparables.slice(0, 5).forEach((c, i) => {
      const title = (c.title || `Listing ${i + 1}`).slice(0, 55)
      const occPct = Math.round(c.occupancyRate * 100)
      drawLine(
        `${i + 1}. ${title} — £${c.averageDailyRate}/night · ${occPct}% occ · £${c.annualRevenue.toLocaleString('en-GB')}/yr`,
        { size: 9 },
      )
    })
  }

  return await pdfDoc.save()
}
