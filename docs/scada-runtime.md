# SCADA browser runtime

The editor adds a **More Shapes → Other → SCADA Widgets** library with eight
controls: **Button**, **Input value**, **Output value**, **Boolean LED**,
**Select value**, **Switch**, **Bar gauge**, and **Slider**. Select a widget and use the
**SCADA** format tab to configure its label, tag, write value, units, precision,
LED/switch colors, dropdown options, or numeric ranges.
The Boolean LED shows `ON` for `true` and `OFF` for `false`, using its
configured state colors; non-boolean values show an unknown state.
Input value is an always-visible text field; its label is used for
accessibility. It commits its value on Enter or when focus leaves the field;
Escape cancels the edit.
Select value displays a native dropdown inside the diagram. Configure its
options as a JSON array of unique scalar values with display labels, for example:

```json
[
  {"label": "Stopped", "value": false},
  {"label": "Running", "value": true},
  {"label": "Automatic", "value": "auto"},
  {"label": "Manual", "value": "manual"}
]
```

Changing the selection immediately writes that typed JSON value to the bound
tag. The dropdown reflects the value returned by polling; malformed option JSON
is reported in the runtime status.
Switch is an animated oval track with a circular knob. It writes the opposite
boolean value immediately when toggled; its ON and OFF colors are configurable.
The switch stays disabled until polling returns a boolean for its tag.
Bar gauge is a pair of editable rectangles. Its **SCADA** tab configures the
numeric tag and its minimum and maximum values. The fill tracks the tag value
from the bottom of the gauge, clamped to that range; style the outer and inner
rectangles with the regular draw.io shape controls. Rotating the gauge also
rotates the fill direction.
Slider is a draggable horizontal track with a central knob. Dragging and
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

For a local demo, run `python3 scada_test_backend.py` from the repository root.
It listens only on `127.0.0.1:8765`. The `process.temperature` value starts at
20 and increases by 1 every second; the default SCADA button writes 20 to that
tag, and the `process.running` boolean starts as `false`. This backend is for
development only; it has no authentication,
authorization, or safety interlocks. Do not expose it to a network or use it to
control equipment.

The external override file and diagram are client-visible. Do not put
credentials or secrets in either file. A production backend must enforce
authentication, authorization, input validation, and all process interlocks.
