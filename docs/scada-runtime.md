# SCADA browser runtime

The standard sidebar includes an expanded-by-default **SCADA / Widgets** palette
below **General** and above **Basic**. It contains ten controls: **Button**,
**Input value**, **Output value**, **Switch**, **Checkbox**, **Boolean LED**,
**Select value**, **Slider**, **Bar gauge**, and **Diagnostics**.
Select a widget and use the **SCADA** format tab to configure its label, tag,
write value, units, precision, LED/switch/diagnostics colors, dropdown options,
or numeric ranges.
Tag fields remain editable and include a picker button that loads variables
from the configured backend, groups them by namespace, and searches their
metadata. Selecting a variable also fills any matching unit and precision
fields exposed by the backend.
The Boolean LED is a small, round indicator with no text; its color shows the
boolean state. Non-boolean values show an unknown state.
Diagnostics is a placeable widget with a connection LED and a textbox showing
the latest SCADA runtime status or operation/error message. Every Diagnostics
widget on the diagram displays the same information. The fixed status message
previously shown at the top of the screen is no longer used.
Input value is an always-visible text field; its label is used for
accessibility. It commits its value on Enter or when focus leaves the field;
Escape cancels the edit.
Select value is a composed rounded selector with a current-value label and a
down arrow. Clicking anywhere on it opens the native dropdown. Configure its
options with one display label and JSON scalar value per line, separated by a
colon. String values must be quoted:

```text
Stopped: false
Running: true
Error: "error"
5: 5
```

Changing the selection immediately writes that typed JSON value to the bound
tag. The dropdown reflects the value returned by polling. Existing JSON-array
option definitions remain supported. Invalid option lines or JSON values are
reported in the runtime log.
Input value uses a gray rounded outer container and an inset white editable
field. The default Button is gray with a more rounded shape.
Switch is a composed, rounded track with a separately editable knob. It writes
the opposite boolean value immediately when toggled; its ON and OFF track colors
are configurable. The switch stays disabled until polling returns a boolean for
its tag. Both parts can be styled with the regular draw.io shape controls.
Checkbox is composed from an editable square and a separate Basic-library tick
shape. The tick is shown only while its boolean tag is true. Clicking the
checkbox or pressing Enter/Space toggles and writes the value; it stays disabled
until polling returns a boolean.
Bar gauge is a pair of rounded, editable rectangles. Its **SCADA** tab configures
the numeric tag and its minimum and maximum values. The fill tracks the tag value
from the bottom of the gauge, clamped to that range; style the outer and inner
rectangles with the regular draw.io shape controls. Rotating the gauge also
rotates the fill direction.
Slider is a draggable horizontal track with a rounded-rectangle knob. Dragging and
releasing writes a floating-point value within its configured range; keyboard
arrows adjust it, and Home/End select the range limits. Rotate the slider by 90
degrees to use it vertically. Slider and gauge tags must return finite JSON
numbers.
The **Diagram** format tab has a **SCADA Connection** section for file-level
settings.

The first runtime uses JSON over HTTP:

- `GET {backendUrl}{readPath}?tags=tag1,tag2` returns
  `{"values":{"tag1":42,"tag2":true}}`.
- `POST {backendUrl}{writePath}` accepts `{"tag":"tag1","value":42}` and
  should return a JSON response.

Runtime buttons darken while the pointer is held down or while Enter/Space is
held on the focused button. Releasing or cancelling the press restores the
normal appearance; clicking the button label also activates it without
selecting the text. Activation sends the configured write.

The diagram stores connection settings in the `scada` attribute on its
`<mxfile>` element. `externalConfigUrl` may point to a JSON file served beside
the exported HTML. Its fields override the diagram settings, for example:

```json
{
  "endpointUrl": "http://127.0.0.1:8765",
  "readPath": "/api/read",
  "writePath": "/api/write",
  "pollIntervalMs": 1000
}
```

For HTML export, the generated page references `js/viewer-static.min.js` and
`js/scada-runtime.js` relative to the page. Put the exported HTML in a directory
served with those files under its `js/` subdirectory. Build the viewer with
`ant app` from `etc/build`, then copy `src/main/webapp/js/viewer-static.min.js`
and `src/main/webapp/js/scada-runtime.js` into that `js/` directory. Serve the
page over HTTP(S); browsers generally block `fetch()` from `file://` pages.

For a ready-to-unpack package, choose **File → Export as → Export HMI Runtime
(.zip)**. The ZIP contains the generated HTML file and both runtime scripts in
the `js/` directory. Extract the files while preserving that layout, then
serve them over HTTP(S). The backend is not included.

Install the backend's Python dependencies, then run it:

```sh
python3 -m pip install -r src/main/scada_backend/requirements.txt
python3 src/main/scada_backend/scada_backend.py
```

By default, the backend loads `src/main/scada_backend/config.json` and listens
only on `127.0.0.1:8765`. Pass `--config path/to/config.json` to select another
configuration. The configuration declares local variables, their types and
defaults, metadata, plus optional value simulations:

```json
{
  "server": {"host": "127.0.0.1", "port": 8765},
  "data_connectors": [
    {
      "id": "local",
      "type": "local",
      "namespace_prefix": "process",
      "variables": {
        "temperature": {
          "type": "float",
          "default": 20,
          "unit": "°C",
          "description": "Process temperature"
        },
        "running": {"type": "boolean", "default": false}
      }
    }
  ],
  "simulations": [
    {"tag": "process.temperature", "step": 1, "interval_seconds": 1}
  ]
}
```

Supported local types are `float`, `integer`, `boolean`, `string`, and `json`.
Variable tags are formed from `namespace_prefix` plus the variable name.
Writes are type-checked, and variables can be marked `"writable": false`.
`GET /api/variables` returns each configured tag's type, current and default
values, writable flag, connector ID, unit, description, and optional precision
(`0`-`15` decimal places). The existing
`GET /api/read` and `POST /api/write` endpoints continue to serve HMI widgets.
Query `http://127.0.0.1:8765/api/variables` to retrieve the inventory:

```json
{
  "variables": [
    {
      "tag": "process.temperature",
      "name": "temperature",
      "connectorId": "local",
      "type": "float",
      "value": 20.0,
      "default": 20.0,
      "writable": true,
      "unit": "°C",
      "precision": 1,
      "description": "Simulated process temperature"
    }
  ]
}
```

OPC UA connectors use the `asyncua` package. The backend connects to the
configured server at startup and browses scalar variables under the configured
`root_node_id` (default: the OPC UA Objects folder, `i=85`). Tags are built from
`namespace_prefix` and the variable's browse path, separated with dots.
Boolean, integer, float/double, and string variables are supported; unsupported
types are skipped and logged. OPC UA access-level metadata controls the
variable's `writable` flag. HMI polling reads the current OPC UA value, and HMI
writes are sent to the server immediately. The OPC UA client connection is
shared and serialized across HTTP requests.

Connector configuration:

```json
{
  "id": "plant",
  "type": "opc_ua",
  "endpoint_url": "opc.tcp://127.0.0.1:4840/draw-scada/dummy/",
  "namespace_prefix": "plant",
  "root_node_id": "ns=2;s=Plant",
  "timeout_seconds": 5
}
```

`endpoint_url` and `namespace_prefix` are required. `root_node_id` is optional;
set it to an object/folder node to restrict browsing to that subtree. The
backend must be able to connect to the OPC UA server when it starts; connection
or browse failures are reported and prevent startup. If a connection drops
later, the HTTP API reports the failed operation and retries the connection on
the next request.

An unauthenticated, unencrypted test server and an example backend config are
included:

```sh
# Terminal 1
python3 src/main/scada_backend/dummy_opc_ua_server.py

# Terminal 2
python3 src/main/scada_backend/scada_backend.py \
  --config src/main/scada_backend/config.opcua.example.json
```

The dummy server exposes writable `Temperature`, `Running`, and `BatchCount`
variables and a read-only `Status` variable under `Plant`. The example config
maps these to `plant.Temperature`, `plant.Running`, `plant.BatchCount`, and
`plant.Status`. The original `config.json` remains local-only, so it can still
be run without an OPC UA server.

This initial OPC UA setup deliberately does not configure authentication or
encryption. The dummy server binds to loopback by default and is for development
only; do not expose it or the unauthenticated SCADA HTTP backend to a network or
use either to control equipment. Configure server-side authentication,
authorization, encryption, and process interlocks before any production use.

Run the backend's tests from its directory with
`python3 -m unittest discover -s tests -v`.

The `process.temperature` value starts at 20 and increases by 1 every second;
the default SCADA button writes 20 to that tag, and `process.running` starts as
`false`. This backend is for development only; it has no authentication,
authorization, or safety interlocks. Do not expose it to a network or use it to
control equipment.

The external override file and diagram are client-visible. Do not put
credentials or secrets in either file. A production backend must enforce
authentication, authorization, input validation, and all process interlocks.
