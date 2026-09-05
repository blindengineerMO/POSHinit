function asText(value, fallback = 'Not recorded') {
  return value === null || value === undefined || value === '' ? fallback : String(value)
}

function formatTimestamp(value) {
  if (!value) return 'Not recorded'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function safeFilename(value) {
  return asText(value, 'execution').replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase()
}

export async function downloadExecutionReport(execution) {
  const { jsPDF } = await import('jspdf')
  const pdf = new jsPDF({ unit: 'pt', format: 'letter' })
  const page = { width: 612, height: 792, margin: 48 }
  const report = execution.report || {}
  let cursor = page.margin

  const addPage = () => {
    pdf.addPage()
    cursor = page.margin
  }
  const ensureRoom = (height) => {
    if (cursor + height > page.height - page.margin) addPage()
  }
  const writeLabelValue = (label, value, x, y) => {
    pdf.setFont('courier', 'bold')
    pdf.setFontSize(8)
    pdf.setTextColor(62, 97, 119)
    pdf.text(label.toUpperCase(), x, y)
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(10)
    pdf.setTextColor(24, 40, 52)
    pdf.text(asText(value), x, y + 15)
  }
  const writeSection = (title, content, color = [24, 40, 52]) => {
    const text = asText(content)
    const lines = pdf.splitTextToSize(text, page.width - page.margin * 2)
    const height = 26 + lines.length * 11 + 18
    ensureRoom(Math.min(height, page.height - page.margin * 2))
    pdf.setFillColor(239, 246, 249)
    pdf.rect(page.margin, cursor, page.width - page.margin * 2, 22, 'F')
    pdf.setFont('courier', 'bold')
    pdf.setFontSize(8)
    pdf.setTextColor(...color)
    pdf.text(title.toUpperCase(), page.margin + 10, cursor + 14)
    cursor += 38
    pdf.setFont('courier', 'normal')
    pdf.setFontSize(8)
    pdf.setTextColor(27, 45, 57)
    for (const line of lines) {
      ensureRoom(12)
      pdf.text(line, page.margin + 2, cursor)
      cursor += 11
    }
    cursor += 18
  }

  pdf.setFillColor(14, 28, 39)
  pdf.rect(0, 0, page.width, 94, 'F')
  pdf.setFont('courier', 'bold')
  pdf.setFontSize(10)
  pdf.setTextColor(88, 215, 255)
  pdf.text('POSHINIT / EXECUTION LEDGER', page.margin, 38)
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(22)
  pdf.setTextColor(255, 255, 255)
  pdf.text('PowerShell Run Report', page.margin, 66)
  cursor = 122

  writeLabelValue('Runbook', execution.script_name || report.scriptName, page.margin, cursor)
  writeLabelValue('Target node', execution.machine_name || report.machineName, 300, cursor)
  cursor += 49
  writeLabelValue('Status', execution.status, page.margin, cursor)
  writeLabelValue('Exit code', execution.exit_code, 180, cursor)
  writeLabelValue('Trigger', execution.trigger_type, 300, cursor)
  cursor += 49
  writeLabelValue('Started', formatTimestamp(execution.started_at), page.margin, cursor)
  writeLabelValue('Finished', formatTimestamp(execution.finished_at), 300, cursor)
  cursor += 58

  writeSection('Execution Summary', report.summary || `Execution ${asText(execution.status).toLowerCase()}.`)
  writeSection('Standard Output', execution.stdout || 'No standard output was captured.', [15, 112, 88])
  writeSection('Error Output', execution.stderr || 'No error output was captured.', [165, 50, 75])

  const totalPages = pdf.getNumberOfPages()
  for (let pageNumber = 1; pageNumber <= totalPages; pageNumber += 1) {
    pdf.setPage(pageNumber)
    pdf.setDrawColor(192, 211, 220)
    pdf.line(page.margin, page.height - 31, page.width - page.margin, page.height - 31)
    pdf.setFont('courier', 'normal')
    pdf.setFontSize(7)
    pdf.setTextColor(82, 105, 118)
    pdf.text(`Execution ID: ${asText(execution.id)}`, page.margin, page.height - 18)
    pdf.text(`Page ${pageNumber} of ${totalPages}`, page.width - page.margin, page.height - 18, { align: 'right' })
  }

  pdf.save(`poshinit-run-${safeFilename(execution.script_name)}-${safeFilename(execution.id)}.pdf`)
}
