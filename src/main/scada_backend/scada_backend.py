#!/usr/bin/env python3
"""Configurable local JSON-over-HTTP backend for the SCADA browser runtime."""

from __future__ import annotations

import argparse
import json
import math
import threading
from abc import ABC, abstractmethod
from copy import deepcopy
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse


class ConfigurationError(ValueError):
    """Raised when the backend configuration is invalid."""


class UnknownVariableError(KeyError):
    """Raised when a requested variable is not configured."""


class InvalidVariableValueError(ValueError):
    """Raised when a value does not match the variable's declared type."""


@dataclass
class LocalVariable:
    tag: str
    name: str
    connector_id: str
    type: str
    default: Any
    value: Any
    writable: bool
    unit: str
    description: str


def validate_value(value_type: str, value: Any, tag: str) -> Any:
    if value_type == "float":
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise InvalidVariableValueError(f'"{tag}" requires a float value')
        if not math.isfinite(value):
            raise InvalidVariableValueError(f'"{tag}" requires a finite float value')
        return float(value)
    if value_type == "integer":
        if isinstance(value, bool) or not isinstance(value, int):
            raise InvalidVariableValueError(f'"{tag}" requires an integer value')
        return value
    if value_type == "boolean":
        if not isinstance(value, bool):
            raise InvalidVariableValueError(f'"{tag}" requires a boolean value')
        return value
    if value_type == "string":
        if not isinstance(value, str):
            raise InvalidVariableValueError(f'"{tag}" requires a string value')
        return value
    if value_type == "json":
        try:
            json.dumps(value, allow_nan=False)
        except (TypeError, ValueError) as error:
            raise InvalidVariableValueError(f'"{tag}" requires a JSON-compatible value') from error
        return deepcopy(value)
    raise ConfigurationError(f'Unsupported variable type "{value_type}" for "{tag}"')


class DataConnector(ABC):
    """Interface implemented by local and future protocol-backed connectors."""

    @abstractmethod
    def read(self, tag: str) -> Any:
        raise NotImplementedError

    @abstractmethod
    def write(self, tag: str, value: Any) -> Any:
        raise NotImplementedError

    @abstractmethod
    def get_variables(self) -> list[dict[str, Any]]:
        raise NotImplementedError


class LocalConnector(DataConnector):
    def __init__(self, connector_id: str, config: dict[str, Any]):
        prefix = config.get("namespace_prefix", "")
        definitions = config.get("variables")

        if not isinstance(prefix, str) or not prefix.strip():
            raise ConfigurationError(
                f'Local connector "{connector_id}" requires a non-empty namespace_prefix'
            )
        if not isinstance(definitions, dict) or not definitions:
            raise ConfigurationError(
                f'Local connector "{connector_id}" requires a non-empty variables object'
            )

        self.connector_id = connector_id
        self.prefix = prefix.strip(". ")
        if not self.prefix:
            raise ConfigurationError(
                f'Local connector "{connector_id}" namespace_prefix must contain a name'
            )
        self.variables: dict[str, LocalVariable] = {}
        self.lock = threading.RLock()

        for name, definition in definitions.items():
            if not isinstance(name, str) or not name.strip() or "." in name:
                raise ConfigurationError(
                    f'Local connector "{connector_id}" variable names must be non-empty '
                    "and must not contain dots"
                )
            if not isinstance(definition, dict):
                raise ConfigurationError(f'Variable "{self.prefix}.{name}" must be an object')

            tag = f"{self.prefix}.{name}"
            value_type = definition.get("type")
            if value_type not in {"float", "integer", "boolean", "string", "json"}:
                raise ConfigurationError(
                    f'Variable "{tag}" has an unsupported type; use float, integer, '
                    "boolean, string, or json"
                )
            if "default" not in definition:
                raise ConfigurationError(f'Variable "{tag}" must define a default value')

            default = validate_value(value_type, definition["default"], tag)
            writable = definition.get("writable", True)
            unit = definition.get("unit", "")
            description = definition.get("description", "")
            if not isinstance(writable, bool):
                raise ConfigurationError(f'Variable "{tag}" writable must be a boolean')
            if not isinstance(unit, str) or not isinstance(description, str):
                raise ConfigurationError(f'Variable "{tag}" unit and description must be strings')

            self.variables[tag] = LocalVariable(
                tag=tag,
                name=name,
                connector_id=connector_id,
                type=value_type,
                default=deepcopy(default),
                value=deepcopy(default),
                writable=writable,
                unit=unit,
                description=description,
            )

    def read(self, tag: str) -> Any:
        with self.lock:
            variable = self.variables.get(tag)
            if variable is None:
                raise UnknownVariableError(tag)
            return deepcopy(variable.value)

    def write(self, tag: str, value: Any) -> Any:
        with self.lock:
            variable = self.variables.get(tag)
            if variable is None:
                raise UnknownVariableError(tag)
            if not variable.writable:
                raise InvalidVariableValueError(f'"{tag}" is read-only')
            variable.value = validate_value(variable.type, value, tag)
            return deepcopy(variable.value)

    def increment(self, tag: str, amount: float) -> None:
        with self.lock:
            variable = self.variables.get(tag)
            if variable is None:
                raise UnknownVariableError(tag)
            if variable.type not in {"float", "integer"}:
                raise ConfigurationError(f'Simulation target "{tag}" must be numeric')
            variable.value = validate_value(variable.type, variable.value + amount, tag)

    def get_variables(self) -> list[dict[str, Any]]:
        with self.lock:
            return [
                {
                    "tag": variable.tag,
                    "name": variable.name,
                    "connectorId": variable.connector_id,
                    "type": variable.type,
                    "value": deepcopy(variable.value),
                    "default": deepcopy(variable.default),
                    "writable": variable.writable,
                    "unit": variable.unit,
                    "description": variable.description,
                }
                for variable in self.variables.values()
            ]


class ConnectorRegistry:
    def __init__(self, connectors: list[DataConnector]):
        self.connectors = connectors
        self.tag_connectors: dict[str, DataConnector] = {}

        for connector in connectors:
            for variable in connector.get_variables():
                tag = variable["tag"]
                if tag in self.tag_connectors:
                    raise ConfigurationError(f'Duplicate variable tag "{tag}"')
                self.tag_connectors[tag] = connector

    def read(self, tag: str) -> Any:
        connector = self.tag_connectors.get(tag)
        if connector is None:
            raise UnknownVariableError(tag)
        return connector.read(tag)

    def write(self, tag: str, value: Any) -> Any:
        connector = self.tag_connectors.get(tag)
        if connector is None:
            raise UnknownVariableError(tag)
        return connector.write(tag, value)

    def get_variables(self) -> list[dict[str, Any]]:
        return [
            variable
            for connector in self.connectors
            for variable in connector.get_variables()
        ]


def load_configuration(path: Path) -> tuple[ConnectorRegistry, dict[str, Any]]:
    try:
        with path.open(encoding="utf-8") as config_file:
            config = json.load(config_file)
    except OSError as error:
        raise ConfigurationError(f"Cannot read configuration file {path}: {error}") from error
    except json.JSONDecodeError as error:
        raise ConfigurationError(
            f"Invalid JSON in configuration file {path} at line {error.lineno}: {error.msg}"
        ) from error

    if not isinstance(config, dict):
        raise ConfigurationError("Configuration root must be a JSON object")

    server_config = config.get("server", {})
    connector_configs = config.get("data_connectors")
    if not isinstance(server_config, dict):
        raise ConfigurationError('"server" must be an object')
    if not isinstance(connector_configs, list) or not connector_configs:
        raise ConfigurationError('"data_connectors" must be a non-empty array')

    connectors: list[DataConnector] = []
    connector_ids: set[str] = set()
    for connector_config in connector_configs:
        if not isinstance(connector_config, dict):
            raise ConfigurationError("Each data connector must be an object")

        connector_id = connector_config.get("id")
        connector_type = connector_config.get("type")
        if not isinstance(connector_id, str) or not connector_id.strip():
            raise ConfigurationError("Each data connector requires a non-empty id")
        if connector_id in connector_ids:
            raise ConfigurationError(f'Duplicate data connector id "{connector_id}"')
        connector_ids.add(connector_id)
        if connector_type != "local":
            raise ConfigurationError(
                f'Data connector type "{connector_type}" is not implemented; '
                "only local is currently supported"
            )
        connectors.append(LocalConnector(connector_id, connector_config))

    host = server_config.get("host", "127.0.0.1")
    port = server_config.get("port", 8765)
    if not isinstance(host, str) or not host.strip():
        raise ConfigurationError('"server.host" must be a non-empty string')
    if isinstance(port, bool) or not isinstance(port, int) or not 1 <= port <= 65535:
        raise ConfigurationError('"server.port" must be an integer between 1 and 65535')

    simulations = config.get("simulations", [])
    if not isinstance(simulations, list):
        raise ConfigurationError('"simulations" must be an array')

    for simulation in simulations:
        if not isinstance(simulation, dict):
            raise ConfigurationError("Each simulation must be an object")
        tag = simulation.get("tag")
        step = simulation.get("step")
        interval = simulation.get("interval_seconds")
        if not isinstance(tag, str) or tag not in {
            variable["tag"]
            for connector in connectors
            for variable in connector.get_variables()
        }:
            raise ConfigurationError(f'Simulation references an unknown variable "{tag}"')
        if isinstance(step, bool) or not isinstance(step, (int, float)) or not math.isfinite(step):
            raise ConfigurationError(f'Simulation for "{tag}" requires a finite numeric step')
        if (
            isinstance(interval, bool)
            or not isinstance(interval, (int, float))
            or not math.isfinite(interval)
            or interval <= 0
        ):
            raise ConfigurationError(
                f'Simulation for "{tag}" requires a positive interval_seconds'
            )

    return ConnectorRegistry(connectors), {
        "host": host.strip(),
        "port": port,
        "simulations": simulations,
    }


class ScadaHandler(BaseHTTPRequestHandler):
    def _send_json(self, status: int, value: Any) -> None:
        body = json.dumps(value, allow_nan=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()

    def do_GET(self) -> None:
        request = urlparse(self.path)
        if request.path == "/api/variables":
            self._send_json(200, {"variables": self.server.registry.get_variables()})
            return
        if request.path != "/api/read":
            self._send_json(404, {"error": "Not found"})
            return

        tags = [tag for tag in parse_qs(request.query).get("tags", [""])[0].split(",") if tag]
        try:
            values = {tag: self.server.registry.read(tag) for tag in tags}
        except UnknownVariableError as error:
            self._send_json(404, {"error": f'Unknown variable "{error.args[0]}"'})
            return

        self._send_json(200, {"values": values})

    def do_POST(self) -> None:
        request = urlparse(self.path)
        if request.path != "/api/write":
            self._send_json(404, {"error": "Not found"})
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > 1024 * 1024:
                self._send_json(400, {"error": "Invalid request body size"})
                return

            payload = json.loads(self.rfile.read(length))
            if not isinstance(payload, dict):
                self._send_json(400, {"error": "Write request must be a JSON object"})
                return
            tag = payload.get("tag")
            if not isinstance(tag, str) or not tag:
                self._send_json(400, {"error": "A non-empty tag is required"})
                return

            value = self.server.registry.write(tag, payload.get("value"))
            self._send_json(200, {"tag": tag, "value": value})
        except UnknownVariableError as error:
            self._send_json(404, {"error": f'Unknown variable "{error.args[0]}"'})
        except InvalidVariableValueError as error:
            self._send_json(400, {"error": str(error)})
        except (json.JSONDecodeError, UnicodeDecodeError, ValueError) as error:
            self._send_json(400, {"error": f"Invalid JSON write request: {error}"})


class ScadaHTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True
    registry: ConnectorRegistry


def run_simulation(
    stop_event: threading.Event,
    connector: DataConnector,
    tag: str,
    step: float,
    interval_seconds: float,
) -> None:
    while not stop_event.wait(interval_seconds):
        if not isinstance(connector, LocalConnector):
            raise ConfigurationError(f'Simulation target "{tag}" is not a local variable')
        connector.increment(tag, step)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--config",
        type=Path,
        default=Path(__file__).with_name("config.json"),
        help="Path to the JSON configuration file (default: config.json beside this script)",
    )
    args = parser.parse_args()

    try:
        registry, server_config = load_configuration(args.config)
    except ConfigurationError as error:
        parser.error(str(error))

    server = ScadaHTTPServer(
        (server_config["host"], server_config["port"]),
        ScadaHandler,
    )
    server.registry = registry
    stop_event = threading.Event()
    simulation_threads: list[threading.Thread] = []

    for simulation in server_config["simulations"]:
        tag = simulation["tag"]
        connector = registry.tag_connectors[tag]
        thread = threading.Thread(
            target=run_simulation,
            args=(
                stop_event,
                connector,
                tag,
                simulation["step"],
                simulation["interval_seconds"],
            ),
            daemon=True,
        )
        thread.start()
        simulation_threads.append(thread)

    print(
        f"SCADA backend listening at http://{server_config['host']}:{server_config['port']} "
        f"using {args.config}"
    )

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping SCADA backend")
    finally:
        stop_event.set()
        server.shutdown()
        server.server_close()
        for thread in simulation_threads:
            thread.join(timeout=2)


if __name__ == "__main__":
    main()
