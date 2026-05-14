import 'server-only'

import PDFDocument from 'pdfkit'
import type { AnalysisResult } from '@/lib/types'

// Builds a Stayful Intelligence PDF summary of one analysis result and
// returns the raw bytes as a Node Buffer. Designed to be uploaded to the
// user's enquiry item on Monday (column file_mm3aevrs).

const GREEN = '#5d8156'
const MUTED = '#666666'
const FG = '#222222'
const BORDER = '#dddddd'

function gbp(value: number): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value)
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`
}

export async function generateAnalysisPDF(
  result: AnalysisResult,
  userEmail: string | null,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48 })
    const chunks: Buffer[] = []

    doc.on('data', (chunk) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    const r = result
    const f = r.financials
    const grossSTL = f.shortLetGrossAnnual
    const netSTL = Math.round(grossSTL * 0.52)
    const grossLTL = f.longLetGrossAnnual
    const netLTL = Math.round(grossLTL * 0.9)
    const diff = netSTL - netLTL

    // ── Header ────────────────────────────────────────────────────────────────
    doc
      .fontSize(18)
      .fillColor(GREEN)
      .text('Stayful Intelligence', { continued: false })
      .moveDown(0.2)
    doc
      .fontSize(11)
      .fillColor(MUTED)
      .text('Short-term rental analysis report')
      .moveDown(0.8)

    // Meta line
    const generated = new Date().toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })
    doc.fillColor(FG).fontSize(10).text(`Generated: ${generated}`)
    if (userEmail) doc.text(`Requested by: ${userEmail}`)
    doc.moveDown(0.8)

    // Property block
    doc
      .fontSize(13)
      .fillColor(FG)
      .text(r.property.address, { underline: false })
      .fontSize(10)
      .fillColor(MUTED)
      .text(
        `${r.property.postcode}  ·  ${r.property.bedrooms} bed  ·  sleeps ${r.property.guests}`,
      )
      .moveDown(0.8)

    // ── Headline numbers ──────────────────────────────────────────────────────
    doc
      .moveTo(48, doc.y)
      .lineTo(547, doc.y)
      .strokeColor(BORDER)
      .stroke()
      .moveDown(0.6)

    doc.fontSize(11).fillColor(MUTED).text('Annual revenue', 48, doc.y)
    doc
      .fontSize(20)
      .fillColor(GREEN)
      .text(gbp(grossSTL), { continued: false })
      .moveDown(0.1)
    doc.fontSize(9).fillColor(MUTED).text(`Net of platform/management/cleaning fees: ${gbp(netSTL)}`)
    doc.moveDown(0.8)

    // ── Short vs long table ─────────────────────────────────────────────────
    doc.fontSize(12).fillColor(FG).text('Short-term vs long-term let').moveDown(0.4)

    const rows: Array<[string, string, string]> = [
      ['Gross annual', gbp(grossSTL), gbp(grossLTL)],
      ['Operating costs', gbp(grossSTL - netSTL), gbp(grossLTL - netLTL)],
      ['Net annual', gbp(netSTL), gbp(netLTL)],
      ['Net monthly', gbp(Math.round(netSTL / 12)), gbp(Math.round(netLTL / 12))],
    ]

    const tableTop = doc.y
    const col1 = 48
    const col2 = 240
    const col3 = 380
    const rowH = 22

    doc
      .fontSize(10)
      .fillColor(MUTED)
      .text('Line item', col1, tableTop)
      .text('Short-term', col2, tableTop)
      .text('Long-term', col3, tableTop)

    doc
      .moveTo(48, tableTop + 16)
      .lineTo(547, tableTop + 16)
      .strokeColor(BORDER)
      .stroke()

    rows.forEach((row, i) => {
      const y = tableTop + 22 + i * rowH
      doc
        .fontSize(11)
        .fillColor(FG)
        .text(row[0], col1, y)
        .text(row[1], col2, y)
        .text(row[2], col3, y)
    })

    doc.y = tableTop + 22 + rows.length * rowH + 8

    // Difference highlight
    const diffColor = diff >= 0 ? GREEN : '#b45050'
    doc
      .fontSize(11)
      .fillColor(MUTED)
      .text(`Short-term advantage: `, 48, doc.y, { continued: true })
      .fillColor(diffColor)
      .text(
        `${diff >= 0 ? '+' : ''}${gbp(diff)} / year  (${diff >= 0 ? '+' : ''}${gbp(Math.round(diff / 12))} / month)`,
      )
      .moveDown(1)

    // ── Verdict + risk ──────────────────────────────────────────────────────────
    doc.fontSize(12).fillColor(FG).text('Verdict').moveDown(0.3)
    doc.fontSize(11).fillColor(FG).text(
      `Fit: ${r.verdict.fit}  ·  Risk: ${r.verdict.riskLevel}  ·  Overall score: ${r.risk.overallScore}/10`,
    )
    if (r.verdict.recommendation) {
      doc.moveDown(0.3).fontSize(10).fillColor(MUTED).text(r.verdict.recommendation, {
        width: 499,
        align: 'left',
      })
    }
    doc.moveDown(0.8)

    // ── Comparables ──────────────────────────────────────────────────────────────
    const comps = r.shortLet.comparables ?? []
    if (comps.length > 0) {
      doc.fontSize(12).fillColor(FG).text(`Top comparables (showing ${Math.min(5, comps.length)} of ${comps.length})`).moveDown(0.4)

      const sorted = [...comps].sort((a, b) => b.annualRevenue - a.annualRevenue).slice(0, 5)
      const cTop = doc.y
      const cCol1 = 48
      const cCol2 = 280
      const cCol3 = 360
      const cCol4 = 460

      doc
        .fontSize(9)
        .fillColor(MUTED)
        .text('Listing', cCol1, cTop)
        .text('Nightly', cCol2, cTop)
        .text('Occupancy', cCol3, cTop)
        .text('Annual', cCol4, cTop)
      doc
        .moveTo(48, cTop + 12)
        .lineTo(547, cTop + 12)
        .strokeColor(BORDER)
        .stroke()

      sorted.forEach((c, i) => {
        const y = cTop + 18 + i * 18
        const title = (c.title || `Listing ${i + 1}`).slice(0, 36)
        doc
          .fontSize(10)
          .fillColor(FG)
          .text(title, cCol1, y, { width: cCol2 - cCol1 - 8, ellipsis: true })
          .text(gbp(c.averageDailyRate), cCol2, y)
          .text(pct(c.occupancyRate), cCol3, y)
          .text(gbp(c.annualRevenue), cCol4, y)
      })

      doc.y = cTop + 18 + sorted.length * 18 + 12
    }

    // ── Footer ─────────────────────────────────────────────────────────────────────────
    const footerY = 800
    doc
      .moveTo(48, footerY - 8)
      .lineTo(547, footerY - 8)
      .strokeColor(BORDER)
      .stroke()
    doc
      .fontSize(8)
      .fillColor(MUTED)
      .text(
        'Estimates only. Based on current market data; actual results vary with property condition, pricing strategy and regulation. © Stayful Intelligence.',
        48,
        footerY,
        { width: 499, align: 'left' },
      )

    doc.end()
  })
}

export function pdfFilenameFor(result: AnalysisResult): string {
  const date = new Date().toISOString().slice(0, 10)
  const safePostcode = result.property.postcode.replace(/\s+/g, '').toUpperCase()
  return `stayful-analysis-${safePostcode}-${date}.pdf`
}
