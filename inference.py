"""Inference boundary for the grounded pipeline; no retrieval or book policy.

Every stage uses the same structured-completion contract. A future provider
implements this method rather than copying the answering or evidence pipeline.
Ollama is the only shipped implementation; no hosted service is contacted.
"""
import json
import time
import urllib.request
from typing import Protocol


class CompletionError(ValueError):
    """A provider response did not satisfy the structured-output contract."""


class InferenceProvider(Protocol):
    def complete(self, stage: str, system: str, user: str, schema: dict,
                 max_tokens: int) -> dict:
        """Return one JSON object or raise; never silently substitute prose."""


class OllamaProvider:
    def __init__(self, url: str, model: str, context_tokens: int = 8192):
        self.url = url.rstrip("/")
        self.model = model
        self.context_tokens = context_tokens
        self.calls = []

    def complete(self, stage, system, user, schema, max_tokens):
        started = time.perf_counter()
        record = {"stage": stage, "model": self.model,
                  "context_tokens": self.context_tokens,
                  "input_characters": len(system) + len(user)}
        self.calls.append(record)
        try:
            body = {"model": self.model, "stream": False, "think": False,
                    "messages": [{"role": "system", "content": system},
                                 {"role": "user", "content": user}],
                    "format": schema,
                    "options": {"temperature": 0, "num_ctx": self.context_tokens,
                                "num_predict": max_tokens}}
            request = urllib.request.Request(
                self.url + "/api/chat", data=json.dumps(body).encode("utf-8"),
                headers={"Content-Type": "application/json"}, method="POST")
            with urllib.request.urlopen(request, timeout=240) as response:
                result = json.loads(response.read().decode("utf-8"))
            content = result.get("message", {}).get("content", "")
            value = json.loads(content)
            if not isinstance(value, dict):
                raise CompletionError("Expected a structured object")
            record.update({"status": "complete",
                           "input_tokens": result.get("prompt_eval_count"),
                           "output_tokens": result.get("eval_count"),
                           "done_reason": result.get("done_reason")})
            return value
        except (ValueError, TypeError, AttributeError) as error:
            record["status"] = "invalid_output"
            raise CompletionError("Invalid structured response at " + stage) from error
        except Exception:
            record["status"] = "provider_error"
            raise
        finally:
            record["elapsed_ms"] = round((time.perf_counter() - started) * 1000)
