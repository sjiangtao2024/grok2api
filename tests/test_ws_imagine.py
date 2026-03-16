import base64
import importlib.util
import sys
import types
import unittest
from pathlib import Path


def _load_ws_imagine_module():
    repo_root = Path(__file__).resolve().parents[1]
    module_path = repo_root / "app" / "services" / "reverse" / "ws_imagine.py"

    app_pkg = types.ModuleType("app")
    core_pkg = types.ModuleType("app.core")
    services_pkg = types.ModuleType("app.services")
    reverse_pkg = types.ModuleType("app.services.reverse")
    utils_pkg = types.ModuleType("app.services.reverse.utils")

    config_mod = types.ModuleType("app.core.config")
    config_mod.get_config = lambda key, default=None: default

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

    headers_mod = types.ModuleType("app.services.reverse.utils.headers")
    headers_mod.build_ws_headers = lambda token=None: {}

    websocket_mod = types.ModuleType("app.services.reverse.utils.websocket")

    class _WebSocketClient:
        async def connect(self, *args, **kwargs):
            raise NotImplementedError

    websocket_mod.WebSocketClient = _WebSocketClient

    aiohttp_mod = types.ModuleType("aiohttp")
    aiohttp_mod.WSMsgType = types.SimpleNamespace(
        TEXT="TEXT",
        CLOSED="CLOSED",
        ERROR="ERROR",
    )
    aiohttp_mod.ClientError = Exception

    orjson_mod = types.ModuleType("orjson")
    orjson_mod.loads = lambda value: value

    sys.modules.update(
        {
            "app": app_pkg,
            "app.core": core_pkg,
            "app.core.config": config_mod,
            "app.core.logger": logger_mod,
            "app.services": services_pkg,
            "app.services.reverse": reverse_pkg,
            "app.services.reverse.utils": utils_pkg,
            "app.services.reverse.utils.headers": headers_mod,
            "app.services.reverse.utils.websocket": websocket_mod,
            "aiohttp": aiohttp_mod,
            "orjson": orjson_mod,
        }
    )

    spec = importlib.util.spec_from_file_location("test_ws_imagine_module", module_path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class ImagineWebSocketReverseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.module = _load_ws_imagine_module()
        cls.service = cls.module.ImagineWebSocketReverse()

    def test_small_decoded_jpeg_is_not_final_even_if_base64_text_is_large(self):
        raw = b"a" * 75000
        blob = base64.b64encode(raw).decode()

        result = self.service._classify_image(
            "https://example.com/images/abc123.jpg",
            blob,
            final_min_bytes=100000,
            medium_min_bytes=30000,
        )

        self.assertIsNotNone(result)
        self.assertFalse(result["is_final"])
        self.assertEqual("medium", result["stage"])
        self.assertEqual(len(raw), result["blob_size"])

    def test_large_decoded_jpeg_is_final(self):
        raw = b"a" * 140000
        blob = base64.b64encode(raw).decode()

        result = self.service._classify_image(
            "https://example.com/images/def456.jpg",
            blob,
            final_min_bytes=100000,
            medium_min_bytes=30000,
        )

        self.assertIsNotNone(result)
        self.assertTrue(result["is_final"])
        self.assertEqual("final", result["stage"])
        self.assertEqual(len(raw), result["blob_size"])


if __name__ == "__main__":
    unittest.main()
