# SCADA browser runtime

The editor adds a **More Shapes → Other → SCADA Widgets** library with a write
button, a variable display, a boolean indicator, and an editable value field.
Select a widget and use the **SCADA** format tab to configure its label, tag,
write value, display units, or precision. The indicator shows `ON`/green for
`true`, `OFF`/gray for `false`, and an unknown state for non-boolean values.
The value editor commits its value on Enter or when focus leaves the field;
Escape cancels the edit.
The **Diagram** format tab has a **SCADA Connection** section for file-level
settings.

The first runtime uses JSON over HTTP:

- `GET {backendUrl}{readPath}?tags=tag1,tag2` returns
  `{"values":{"tag1":42,"tag2":true}}`.
- `POST {backendUrl}{writePath}` accepts `{"tag":"tag1","value":42}` and
  should return a JSON response.

Runtime buttons darken while the pointer is held down or while Enter/Space is
held on the focused button. Releasing or cancelling the press restores the
normal appearance; activation still sends the configured write.

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
