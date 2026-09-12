# POSHinit Observability Reference

Set `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://otel-collector:4318/v1/traces` on POSHinit. Prometheus metrics are exposed at `http://poshinit:9464/metrics` by default; set `OTEL_PROMETHEUS_PORT` to change the port or `OTEL_ENABLED=false` to disable SDK startup.

Start an OpenTelemetry Collector with `otel-collector.yaml`, configure Prometheus with `prometheus.yml`, and import `grafana-dashboard.json`. The dashboard shows control-plane operation rates, p95 duration, and HTTP traffic. Never expose port 9464 or the collector without your network and authentication controls.
