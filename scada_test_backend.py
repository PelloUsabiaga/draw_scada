#!/usr/bin/env python3
"""Local JSON-over-HTTP backend for exercising the SCADA HTML runtime."""

from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Event, Lock, Thread
from urllib.parse import parse_qs, urlparse


VALUES: dict[str, object] = {
    "process.temperature": 20.0,
    "process.running": False,
    "process.temperature_setpoint": 25.0,
}
VALUES_LOCK = Lock()
TEMPERATURE_STEP = 1.0
TEMPERATURE_INTERVAL_SECONDS = 1.0


class ScadaHandler(BaseHTTPRequestHandler):
    def _send_json(self, status: int, value: object) -> None:
        body = json.dumps(value).encode("utf-8")
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
        if request.path != "/api/read":
            self._send_json(404, {"error": "Not found"})
            return

        tags = parse_qs(request.query).get("tags", [""])[0].split(",")
        with VALUES_LOCK:
            values = {tag: VALUES.get(tag) for tag in tags if tag}

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
            tag = payload.get("tag")
            if not isinstance(tag, str) or not tag:
                self._send_json(400, {"error": "A non-empty tag is required"})
                return

            with VALUES_LOCK:
                VALUES[tag] = payload.get("value")

            self._send_json(200, {"tag": tag, "value": VALUES[tag]})
        except (json.JSONDecodeError, UnicodeDecodeError, AttributeError, ValueError):
            self._send_json(400, {"error": "Invalid JSON write request"})


def increase_temperature(stop_event: Event) -> None:
    while not stop_event.wait(TEMPERATURE_INTERVAL_SECONDS):
        with VALUES_LOCK:
            temperature = VALUES["process.temperature"]
            if isinstance(temperature, (int, float)) and not isinstance(temperature, bool):
                VALUES["process.temperature"] = temperature + TEMPERATURE_STEP


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", 8765), ScadaHandler)
    print("SCADA test backend listening at http://127.0.0.1:8765")
    stop_event = Event()
    temperature_thread = Thread(target=increase_temperature, args=(stop_event,), daemon=True)

    try:
        temperature_thread.start()
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping SCADA test backend")
    finally:
        stop_event.set()
        server.server_close()
        temperature_thread.join(timeout=2)
