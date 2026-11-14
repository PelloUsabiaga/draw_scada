"""Integration tests for the OPC UA data connector."""

from __future__ import annotations

import json
import socket
import tempfile
import threading
import unittest
from pathlib import Path
from urllib.request import Request, urlopen

from dummy_opc_ua_server import create_dummy_server
from scada_backend import (
    ConnectorCommunicationError,
    ScadaHTTPServer,
    ScadaHandler,
    OpcUaConnector,
    load_configuration,
)


class OpcUaConnectorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            opc_port = sock.getsockname()[1]
        cls.opc_endpoint = f"opc.tcp://127.0.0.1:{opc_port}/draw-scada/test/"
        cls.opc_server, cls.root_node_id = create_dummy_server(cls.opc_endpoint)

    @classmethod
    def tearDownClass(cls) -> None:
        cls.opc_server.stop()

    def test_browse_read_write_and_hmi_http_synchronization(self) -> None:
        config = {
            "server": {"host": "127.0.0.1", "port": 8765},
            "data_connectors": [
                {
                    "id": "plant",
                    "type": "opc_ua",
                    "endpoint_url": self.opc_endpoint,
                    "namespace_prefix": "plant",
                    "root_node_id": self.root_node_id,
                }
            ],
        }
        with tempfile.NamedTemporaryFile(
            mode="w",
            suffix=".json",
            encoding="utf-8",
        ) as config_file:
            json.dump(config, config_file)
            config_file.flush()
            registry, _ = load_configuration(Path(config_file.name))

        server = ScadaHTTPServer(("127.0.0.1", 0), ScadaHandler)
        server.registry = registry
        server_thread = threading.Thread(target=server.serve_forever, daemon=True)
        server_thread.start()
        base_url = f"http://127.0.0.1:{server.server_port}"

        try:
            with urlopen(f"{base_url}/api/variables") as response:
                variables = json.load(response)["variables"]
            browsed = {variable["tag"]: variable for variable in variables}
            self.assertEqual(browsed["plant.Temperature"]["type"], "float")
            self.assertEqual(browsed["plant.Running"]["type"], "boolean")
            self.assertFalse(browsed["plant.Status"]["writable"])

            request = Request(
                f"{base_url}/api/write",
                data=json.dumps(
                    {"tag": "plant.Temperature", "value": 24.5}
                ).encode(),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urlopen(request) as response:
                self.assertEqual(json.load(response)["value"], 24.5)

            with urlopen(f"{base_url}/api/read?tags=plant.Temperature") as response:
                self.assertEqual(
                    json.load(response)["values"],
                    {"plant.Temperature": 24.5},
                )
        finally:
            server.shutdown()
            server.server_close()
            server_thread.join(timeout=2)
            registry.close()

    def test_reconnects_after_opc_ua_server_restarts(self) -> None:
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            opc_port = sock.getsockname()[1]
        endpoint = f"opc.tcp://127.0.0.1:{opc_port}/draw-scada/reconnect-test/"
        opc_server, root_node_id = create_dummy_server(endpoint)
        connector = OpcUaConnector(
            "plant",
            {
                "endpoint_url": endpoint,
                "namespace_prefix": "plant",
                "root_node_id": root_node_id,
            },
        )

        try:
            self.assertEqual(connector.read("plant.Temperature"), 20.0)
            opc_server.stop()
            with self.assertRaises(ConnectorCommunicationError):
                connector.read("plant.Temperature")

            opc_server, _ = create_dummy_server(endpoint)
            self.assertEqual(connector.read("plant.Temperature"), 20.0)
        finally:
            connector.close()
            opc_server.stop()


if __name__ == "__main__":
    unittest.main()
