"""Tests for the configurable SCADA development backend."""

from __future__ import annotations

import json
import tempfile
import threading
import unittest
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from scada_backend import (
    ConfigurationError,
    ScadaHTTPServer,
    ScadaHandler,
    load_configuration,
)


BACKEND_DIR = Path(__file__).parent.parent


class ScadaBackendTests(unittest.TestCase):
    def setUp(self) -> None:
        self.registry, _ = load_configuration(BACKEND_DIR / "config.json")

    def test_metadata_lists_configured_variable_types_and_defaults(self) -> None:
        variables = {variable["tag"]: variable for variable in self.registry.get_variables()}

        self.assertEqual(variables["process.temperature"]["type"], "float")
        self.assertEqual(variables["process.temperature"]["default"], 20.0)
        self.assertEqual(variables["process.temperature"]["unit"], "°C")
        self.assertEqual(variables["process.temperature"]["precision"], 1)
        self.assertFalse(variables["process.running"]["value"])

    def test_unknown_connector_type_is_reported(self) -> None:
        config = {
            "data_connectors": [
                {"id": "opc", "type": "opc_ua", "namespace_prefix": "plant", "variables": {}}
            ]
        }
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8") as config_file:
            json.dump(config, config_file)
            config_file.flush()

            with self.assertRaisesRegex(ConfigurationError, "only local is currently supported"):
                load_configuration(Path(config_file.name))

    def test_http_metadata_read_and_typed_write(self) -> None:
        server = ScadaHTTPServer(("127.0.0.1", 0), ScadaHandler)
        server.registry = self.registry
        server_thread = threading.Thread(target=server.serve_forever, daemon=True)
        server_thread.start()
        base_url = f"http://127.0.0.1:{server.server_port}"

        try:
            with urlopen(f"{base_url}/api/variables") as response:
                metadata = json.load(response)
            self.assertIn(
                "process.running",
                [variable["tag"] for variable in metadata["variables"]],
            )

            request = Request(
                f"{base_url}/api/write",
                data=json.dumps({"tag": "process.running", "value": True}).encode(),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urlopen(request) as response:
                self.assertEqual(json.load(response)["value"], True)

            with urlopen(f"{base_url}/api/read?tags=process.running") as response:
                self.assertEqual(json.load(response)["values"], {"process.running": True})

            invalid_request = Request(
                f"{base_url}/api/write",
                data=json.dumps({"tag": "process.running", "value": 1}).encode(),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with self.assertRaises(HTTPError) as error:
                urlopen(invalid_request)
            self.assertEqual(error.exception.code, 400)
            error.exception.close()
        finally:
            server.shutdown()
            server.server_close()
            server_thread.join(timeout=2)


if __name__ == "__main__":
    unittest.main()
