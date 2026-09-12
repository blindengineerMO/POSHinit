import { metrics, SpanStatusCode, trace } from '@opentelemetry/api'
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node'
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { SEMRESATTRS_SERVICE_NAME } from '@opentelemetry/semantic-conventions'
import { NodeSDK } from '@opentelemetry/sdk-node'
import { config } from './config.js'

let sdk
const tracer = trace.getTracer('poshinit.control-plane')
const meter = metrics.getMeter('poshinit.control-plane')
export const operationCounter = meter.createCounter('poshinit_operations_total', { description: 'Control-plane operations by subsystem and outcome' })
export const operationDuration = meter.createHistogram('poshinit_operation_duration_ms', { description: 'Control-plane operation duration in milliseconds', unit: 'ms' })

if (config.observability.enabled) {
  const metricReader = new PrometheusExporter({ port: config.observability.prometheusPort, endpoint: '/metrics' })
  sdk = new NodeSDK({
    resource: resourceFromAttributes({ [SEMRESATTRS_SERVICE_NAME]: config.observability.serviceName }),
    traceExporter: config.observability.otlpEndpoint ? new OTLPTraceExporter({ url: config.observability.otlpEndpoint }) : undefined,
    metricReader,
    instrumentations: [getNodeAutoInstrumentations()],
  })
  sdk.start()
  process.once('SIGTERM', () => sdk?.shutdown())
}

export async function observeOperation(subsystem, operation, attributes = {}, callback) {
  const started = performance.now()
  return tracer.startActiveSpan(`${subsystem}.${operation}`, async (span) => {
    Object.entries(attributes).forEach(([key, value]) => span.setAttribute(`poshinit.${key}`, String(value)))
    try {
      const result = await callback()
      span.setStatus({ code: SpanStatusCode.OK })
      operationCounter.add(1, { subsystem, operation, outcome: 'success' })
      return result
    } catch (error) {
      span.recordException(error)
      span.setStatus({ code: SpanStatusCode.ERROR, message: error.message })
      operationCounter.add(1, { subsystem, operation, outcome: 'error' })
      throw error
    } finally {
      operationDuration.record(performance.now() - started, { subsystem, operation })
      span.end()
    }
  })
}
