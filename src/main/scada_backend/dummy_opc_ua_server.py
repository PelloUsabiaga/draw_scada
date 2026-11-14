#!/usr/bin/env python3
"""Run a small, unauthenticated OPC UA server for local SCADA development."""

from __future__ import annotations

import argparse
import time
from typing import Any

from asyncua import ua
from asyncua.sync import Server


NAMESPACE_URI = "urn:draw-scada:dummy"
DEFAULT_ENDPOINT = "opc.tcp://127.0.0.1:4840/draw-scada/dummy/"


def create_dummy_server(endpoint_url: str = DEFAULT_ENDPOINT) -> tuple[Any, str]:
    server = Server()
    server.set_endpoint(endpoint_url)
    namespace_index = server.register_namespace(NAMESPACE_URI)

    objects = server.nodes.objects
    plant = objects.add_object(
        ua.NodeId("Plant", namespace_index),
        "Plant",
    )
    temperature = plant.add_variable(
        ua.NodeId("Plant.Temperature", namespace_index),
        "Temperature",
        20.0,
    )
    temperature.set_writable()
    running = plant.add_variable(
        ua.NodeId("Plant.Running", namespace_index),
        "Running",
        False,
    )
    running.set_writable()
    batch_count = plant.add_variable(
        ua.NodeId("Plant.BatchCount", namespace_index),
        "BatchCount",
        0,
    )
    batch_count.set_writable()
    status = plant.add_variable(
        ua.NodeId("Plant.Status", namespace_index),
        "Status",
        "ready",
    )
    status.set_writable()


    server.start()
    return server, plant.nodeid.to_string()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--endpoint",
        default=DEFAULT_ENDPOINT,
        help=f"OPC UA endpoint (default: {DEFAULT_ENDPOINT})",
    )
    args = parser.parse_args()

    server, root_node_id = create_dummy_server(args.endpoint)
    print(f"Dummy OPC UA server listening at {args.endpoint}")
    print(f"Browse root_node_id: {root_node_id}")
    print("Press Ctrl+C to stop.")
    try:
        while True:
            time.sleep(1)
            print("----------------------------------------")
            print("Temperature:", server.get_node(f"{root_node_id}.Temperature").get_value())
            print("Running:", server.get_node(f"{root_node_id}.Running").get_value())
            print("Batch Count:", server.get_node(f"{root_node_id}.BatchCount").get_value())
            print("Status:", server.get_node(f"{root_node_id}.Status").get_value())
    except KeyboardInterrupt:
        print("\nStopping dummy OPC UA server")
    finally:
        server.stop()


if __name__ == "__main__":
    main()
