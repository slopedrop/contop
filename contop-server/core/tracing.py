"""
OpenTelemetry tracing for the execution agent.

Provides init_tracing(), tool_span(), and agent_span() for structured
observability of tool calls and agent runs.

All tracing is opt-in. If OTel packages are not installed, graceful
no-op fallback is used (no dependency on external services for local dev).
"""
import logging
import os
from contextlib import contextmanager

logger = logging.getLogger(__name__)

# Lazy-loaded OTel references
_tracer = None
_initialized = False


def init_tracing(service_name: str = "contop-agent"):
    """Initialize OpenTelemetry tracing.

    Uses ConsoleSpanExporter for local dev. If OTEL_EXPORTER_OTLP_ENDPOINT
    env var is set, also exports via OTLP.

    Returns the tracer instance, or None if OTel is not installed.
    """
    global _tracer, _initialized
    if _initialized:
        return _tracer

    _initialized = True

    try:
        from opentelemetry import trace
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import (
            BatchSpanProcessor,
            ConsoleSpanExporter,
        )
        from opentelemetry.sdk.resources import Resource

        resource = Resource.create({
            "service.name": service_name,
            "service.version": "1.0.0",
        })
        provider = TracerProvider(resource=resource)

        # Console exporter for local dev (always active)
        provider.add_span_processor(BatchSpanProcessor(ConsoleSpanExporter()))

        # Optional OTLP exporter for cloud
        otlp_endpoint = os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT")
        if otlp_endpoint:
            try:
                from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import (
                    OTLPSpanExporter,
                )
                otlp_exporter = OTLPSpanExporter(endpoint=otlp_endpoint)
                provider.add_span_processor(BatchSpanProcessor(otlp_exporter))
                logger.info("OTLP exporter configured: %s", otlp_endpoint)
            except ImportError:
                logger.info("OTLP exporter not available (opentelemetry-exporter-otlp not installed)")

        trace.set_tracer_provider(provider)
        _tracer = trace.get_tracer(service_name)
        logger.info("OpenTelemetry tracing initialized with ConsoleSpanExporter")
        return _tracer

    except ImportError:
        logger.info("OpenTelemetry not installed - tracing disabled")
        return None


@contextmanager
def tool_span(tool_name: str, args: dict):
    """Context manager that creates an OTel span for a tool call.

    Usage:
        with tool_span("execute_cli", {"command": "ls"}) as span:
            result = await execute_cli(command="ls")
            if span:
                span.set_attribute("tool.status", result.get("status"))

    Yields the span (or None if OTel is not available).
    """
    tracer = _tracer or init_tracing()
    if tracer is None:
        yield None
        return

    span = None
    try:
        from opentelemetry.trace import StatusCode

        span = tracer.start_span(f"tool.{tool_name}")
        span.set_attribute("tool.name", tool_name)
        # Redact sensitive args
        safe_args = {k: v for k, v in args.items() if k not in ("password", "token", "secret", "api_key")}
        span.set_attribute("tool.args", str(safe_args)[:500])

        try:
            yield span
        except GeneratorExit:
            span.set_status(StatusCode.ERROR, "cancelled")
            return
        except Exception as exc:
            span.set_status(StatusCode.ERROR, str(exc))
            span.record_exception(exc)
            raise
    except Exception:
        # OTel failure should never break tool execution
        yield None
    finally:
        if span is not None:
            span.end()


@contextmanager
def agent_span(intent: str):
    """Context manager that creates a parent span for an entire agent run.

    Usage:
        with agent_span("open notepad and type hello") as span:
            await run_intent(...)
            if span:
                span.set_attribute("agent.steps_taken", 5)

    Yields the span (or None if OTel is not available).
    """
    tracer = _tracer or init_tracing()
    if tracer is None:
        yield None
        return

    span = None
    try:
        from opentelemetry.trace import StatusCode

        span = tracer.start_span("agent.run_intent")
        span.set_attribute("agent.intent", intent[:200])

        try:
            yield span
        except GeneratorExit:
            span.set_status(StatusCode.ERROR, "cancelled")
            return
        except Exception as exc:
            span.set_status(StatusCode.ERROR, str(exc))
            span.record_exception(exc)
            raise
    except Exception:
        yield None
    finally:
        if span is not None:
            span.end()
