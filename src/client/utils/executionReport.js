function asText(value, fallback = 'Not recorded') {
  return value === null || value === undefined || value === '' ? fallback : String(value)
}

function escapeHtml(value) {
  return asText(value).replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  })[character])
}

function formatTimestamp(value) {
  if (!value) return 'Not recorded'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function item(label, value) {
  return `<div class="fact"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`
}

export function downloadExecutionReport(execution) {
  const reportWindow = window.open('', '_blank', 'width=940,height=760')
  if (!reportWindow) {
    throw new Error('Allow pop-ups for POSHinit to create a PDF report.')
  }
  reportWindow.opener = null

  const report = execution.report || {}
  const status = asText(execution.status).toLowerCase()
  const documentTitle = `POSHinit Run Report - ${asText(execution.script_name || report.scriptName)}`
  reportWindow.document.write(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(documentTitle)}</title>
<style>
  @page { size: letter; margin: 0.55in; }
  * { box-sizing: border-box; }
  body { margin: 0; color: #172c3a; background: #fff; font: 11px/1.45 Arial, sans-serif; }
  header { margin: -0.55in -0.55in 28px; padding: 32px 0.55in 24px; background: #0d202d; color: #fff; }
  .eyebrow { margin: 0 0 8px; color: #58d7ff; font: 700 9px/1 'Courier New', monospace; letter-spacing: .14em; }
  h1 { margin: 0; font-size: 25px; letter-spacing: -.03em; }
  .status { display: inline-block; margin-top: 14px; padding: 5px 9px; color: ${status === 'success' ? '#067055' : '#a62e45'}; background: ${status === 'success' ? '#daf7ed' : '#ffe4e9'}; font: 700 9px/1 'Courier New', monospace; letter-spacing: .08em; }
  .facts { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1px; margin-bottom: 24px; border: 1px solid #d6e2e7; background: #d6e2e7; }
  .fact { min-height: 58px; padding: 10px 12px; background: #f9fcfd; }
  dt { color: #617b89; font: 700 8px/1 'Courier New', monospace; letter-spacing: .1em; text-transform: uppercase; }
  dd { margin: 8px 0 0; overflow-wrap: anywhere; font-weight: 600; }
  section { margin: 0 0 20px; break-inside: avoid; }
  h2 { margin: 0; padding: 8px 10px; color: #174155; background: #eff7fa; font: 700 9px/1 'Courier New', monospace; letter-spacing: .1em; text-transform: uppercase; }
  pre { margin: 0; padding: 12px; overflow-wrap: anywhere; white-space: pre-wrap; border: 1px solid #d6e2e7; border-top: 0; background: #fbfdfe; color: #172c3a; font: 9px/1.45 'Courier New', monospace; }
  .error h2 { color: #922b43; background: #fff0f3; }
  footer { margin-top: 30px; padding-top: 10px; border-top: 1px solid #d6e2e7; color: #617b89; font: 8px 'Courier New', monospace; }
  @media print { .print-note { display: none; } }
</style></head><body>
<header><p class="eyebrow">POSHINIT / EXECUTION LEDGER</p><h1>PowerShell Run Report</h1><span class="status">${escapeHtml(status)}</span></header>
<dl class="facts">
  ${item('Runbook', execution.script_name || report.scriptName)}
  ${item('Target node', execution.machine_name || report.machineName)}
  ${item('Trigger', execution.trigger_type)}
  ${item('Exit code', execution.exit_code)}
  ${item('Started', formatTimestamp(execution.started_at))}
  ${item('Finished', formatTimestamp(execution.finished_at))}
</dl>
<section><h2>Execution Summary</h2><pre>${escapeHtml(report.summary || `Execution ${status}.`)}</pre></section>
<section><h2>Standard Output</h2><pre>${escapeHtml(execution.stdout || 'No standard output was captured.')}</pre></section>
<section class="error"><h2>Error Output</h2><pre>${escapeHtml(execution.stderr || 'No error output was captured.')}</pre></section>
<footer>Execution ID: ${escapeHtml(execution.id)} <span class="print-note"> | Select “Save as PDF” in the print dialog to export this report.</span></footer>
<script>window.onload = () => window.print()</script></body></html>`)
  reportWindow.document.close()
}
