import asyncio
import base64
import importlib.util
import json
import sys
import tempfile
import types
import unittest
from pathlib import Path


def _load_image_module():
    repo_root = Path(__file__).resolve().parents[1]
    module_path = repo_root / "app" / "services" / "grok" / "services" / "image.py"

    app_pkg = types.ModuleType("app")
    core_pkg = types.ModuleType("app.core")
    services_pkg = types.ModuleType("app.services")
    grok_pkg = types.ModuleType("app.services.grok")
    grok_services_pkg = types.ModuleType("app.services.grok.services")
    grok_utils_pkg = types.ModuleType("app.services.grok.utils")
    reverse_pkg = types.ModuleType("app.services.reverse")

    config_mod = types.ModuleType("app.core.config")
    config_values = {
        "image.blocked_parallel_attempts": 0,
        "image.blocked_parallel_enabled": True,
        "app.app_url": "http://example.com",
    }
    config_mod.get_config = lambda key, default=None: config_values.get(key, default)

    class _Logger:
        def info(self, *args, **kwargs):
            return None

        def warning(self, *args, **kwargs):
            return None

        def error(self, *args, **kwargs):
            return None

        def debug(self, *args, **kwargs):
            return None

    logger_mod = types.ModuleType("app.core.logger")
    logger_mod.logger = _Logger()

    storage_mod = types.ModuleType("app.core.storage")
    storage_mod.DATA_DIR = Path(tempfile.gettempdir()) / "grok2api-test-data"

    exceptions_mod = types.ModuleType("app.core.exceptions")

    class AppException(Exception):
        pass

    class UpstreamException(Exception):
        def __init__(self, message, details=None):
            super().__init__(message)
            self.details = details or {}

    class ErrorType:
        RATE_LIMIT = types.SimpleNamespace(value="rate_limit")

    exceptions_mod.AppException = AppException
    exceptions_mod.UpstreamException = UpstreamException
    exceptions_mod.ErrorType = ErrorType

    process_mod = types.ModuleType("app.services.grok.utils.process")

    class BaseProcessor:
        def __init__(self, model, token=""):
            self.model = model
            self.token = token

    process_mod.BaseProcessor = BaseProcessor

    retry_mod = types.ModuleType("app.services.grok.utils.retry")

    async def pick_token(*args, **kwargs):
        return None

    retry_mod.pick_token = pick_token
    retry_mod.rate_limited = lambda exc: False

    response_mod = types.ModuleType("app.services.grok.utils.response")
    response_mod.make_response_id = lambda: "resp-id"
    response_mod.make_chat_chunk = lambda *args, **kwargs: {}
    response_mod.wrap_image_content = lambda data, response_format: data

    stream_mod = types.ModuleType("app.services.grok.utils.stream")
    stream_mod.wrap_stream_with_usage = lambda stream, *args, **kwargs: stream

    token_mod = types.ModuleType("app.services.token")
    token_mod.EffortType = types.SimpleNamespace(HIGH="high", LOW="low")

    reverse_ws_mod = types.ModuleType("app.services.reverse.ws_imagine")

    class ImagineWebSocketReverse:
        def stream(self, **kwargs):
            raise NotImplementedError

    reverse_ws_mod.ImagineWebSocketReverse = ImagineWebSocketReverse

    orjson_mod = types.ModuleType("orjson")
    orjson_mod.dumps = lambda value: json.dumps(value).encode()

    sys.modules.update(
        {
            "app": app_pkg,
            "app.core": core_pkg,
            "app.core.config": config_mod,
            "app.core.logger": logger_mod,
            "app.core.storage": storage_mod,
            "app.core.exceptions": exceptions_mod,
            "app.services": services_pkg,
            "app.services.grok": grok_pkg,
            "app.services.grok.services": grok_services_pkg,
            "app.services.grok.utils": grok_utils_pkg,
            "app.services.grok.utils.process": process_mod,
            "app.services.grok.utils.retry": retry_mod,
            "app.services.grok.utils.response": response_mod,
            "app.services.grok.utils.stream": stream_mod,
            "app.services.token": token_mod,
            "app.services.reverse": reverse_pkg,
            "app.services.reverse.ws_imagine": reverse_ws_mod,
            "orjson": orjson_mod,
        }
    )

    spec = importlib.util.spec_from_file_location("test_image_module", module_path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class ImageCollectProcessorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.module = _load_image_module()

    def test_collect_processor_returns_best_available_image_after_upstream_error(self):
        raw = b"a" * 75000
        blob = base64.b64encode(raw).decode()
        processor = self.module.ImageWSCollectProcessor(
            "grok-imagine-1.0",
            response_format="b64_json",
        )

        async def response():
            yield {
                "type": "image",
                "image_id": "img-1",
                "blob": blob,
                "blob_size": len(raw),
                "stage": "medium",
                "is_final": False,
                "width": 720,
                "height": 1280,
            }
            yield {
                "type": "error",
                "error_code": "blocked",
                "error": "blocked_no_final_image",
            }

        results, metadata = asyncio.run(processor.process(response()))

        self.assertEqual([blob], results)
        self.assertEqual("medium", metadata[0]["stage"])
        self.assertFalse(metadata[0]["is_final"])
        self.assertEqual(720, metadata[0]["width"])
        self.assertEqual(1280, metadata[0]["height"])

    def test_collect_ws_returns_partial_results_when_only_medium_image_exists(self):
        raw = b"a" * 75000
        blob = base64.b64encode(raw).decode()

        async def fake_stream(**kwargs):
            yield {
                "type": "image",
                "image_id": "img-1",
                "blob": blob,
                "blob_size": len(raw),
                "stage": "medium",
                "is_final": False,
                "width": 720,
                "height": 1280,
            }
            yield {
                "type": "error",
                "error_code": "blocked",
                "error": "blocked_no_final_image",
            }

        self.module.image_service = types.SimpleNamespace(stream=fake_stream)
        service = self.module.ImageGenerationService()

        class _TokenMgr:
            async def consume(self, *args, **kwargs):
                return None

        model_info = types.SimpleNamespace(
            model_id="grok-imagine-1.0",
            cost=types.SimpleNamespace(value="low"),
        )

        result = asyncio.run(
            service._collect_ws(
                token_mgr=_TokenMgr(),
                token="tok",
                model_info=model_info,
                tried_tokens={"tok"},
                prompt="test prompt",
                n=2,
                response_format="b64_json",
                aspect_ratio="9:16",
                enable_nsfw=True,
            )
        )

        self.assertEqual([blob], result.data)
        self.assertEqual("medium", result.metadata[0]["stage"])
        self.assertFalse(result.metadata[0]["is_final"])


if __name__ == "__main__":
    unittest.main()
