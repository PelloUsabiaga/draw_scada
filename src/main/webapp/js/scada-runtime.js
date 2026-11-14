(function()
{
	var defaults = {
		enabled: true,
		endpointUrl: 'http://127.0.0.1:8765',
		readPath: '/api/read',
		writePath: '/api/write',
		pollIntervalMs: 1000,
		externalConfigUrl: ''
	};

	var statusElement = null;
	var updateStatus = function(message, isError)
	{
		if (statusElement == null)
		{
			statusElement = document.createElement('div');
			statusElement.style.cssText = 'position:fixed;right:8px;top:8px;padding:6px 10px;' +
				'font:12px sans-serif;background:#f3f3f3;color:#333;border:1px solid #bbb;' +
				'z-index:10000;max-width:60vw;';
			document.body.appendChild(statusElement);
		}

		statusElement.textContent = message;
		statusElement.style.color = isError ? '#b00020' : '#333';
	};

	var mergeConfig = function(base, override)
	{
		var merged = Object.create(null);

		for (var key in base)
		{
			merged[key] = base[key];
		}

		for (var key in override)
		{
			merged[key] = override[key];
		}

		return merged;
	};

	var requestJson = async function(url, options)
	{
		var response = await fetch(url, options);

		if (!response.ok)
		{
			throw new Error('Backend request failed (' + response.status + ')');
		}

		return await response.json();
	};

	var initRuntime = async function(viewer)
	{
		var config = mergeConfig(defaults, viewer.graphConfig.scada || {});

		if (!config.enabled)
		{
			return;
		}

		try
		{
			if (config.externalConfigUrl)
			{
				var overrideUrl = new URL(config.externalConfigUrl, document.baseURI);
				var override = await requestJson(overrideUrl);

				if (override == null || typeof override != 'object' || Array.isArray(override))
				{
					throw new Error('External SCADA configuration must be a JSON object');
				}

				config = mergeConfig(config, override);
			}

			var endpoint = new URL(config.endpointUrl, document.baseURI);

			if (endpoint.protocol != 'http:' && endpoint.protocol != 'https:')
			{
				throw new Error('Backend URL must use HTTP or HTTPS');
			}

			var interval = Number(config.pollIntervalMs);

			if (!isFinite(interval) || interval < 250 || interval > 60000)
			{
				throw new Error('Poll interval must be between 250 and 60000 ms');
			}

			var graph = viewer.graph;
			var model = graph.getModel();
			var widgets = [];
			var tags = Object.create(null);
			var cells = model.getDescendants(model.getRoot());

			for (var i = 0; i < cells.length; i++)
			{
				var cell = cells[i];
				var type = graph.getAttributeForCell(cell, 'scadaType', null);

				if (type == 'button' || type == 'display' || type == 'indicator' ||
					type == 'valueEditor')
				{
					var tag = graph.getAttributeForCell(cell, 'tag', '');

					if (tag.length == 0)
					{
						continue;
					}

					tags[tag] = true;
					widgets.push({cell: cell, type: type, tag: tag,
						label: graph.getAttributeForCell(cell, 'label', ''),
						units: graph.getAttributeForCell(cell, 'units', ''),
						precision: graph.getAttributeForCell(cell, 'precision', '1')});
				}
			}

			var apiUrl = function(path)
			{
				return new URL(path, endpoint.href.replace(/\/?$/, '/'));
			};

			var parseValue = function(raw)
			{
				try
				{
					return JSON.parse(raw);
				}
				catch (e)
				{
					return raw;
				}
			};

			var writeTag = async function(widget, value)
			{
				var url = apiUrl(config.writePath);
				await requestJson(url, {
					method: 'POST',
					headers: {'Content-Type': 'application/json'},
					body: JSON.stringify({tag: widget.tag, value: value})
				});
				updateStatus('Connected · wrote ' + widget.tag, false);
			};

			var writeValue = function(widget)
			{
				var raw = graph.getAttributeForCell(widget.cell, 'writeValue', 'true');
				return writeTag(widget, parseValue(raw));
			};

			var renderValue = function(widget, value)
			{
				var displayValue = value;
				var precision = Number(widget.precision);

				if (typeof displayValue == 'number' && isFinite(precision) &&
					precision >= 0 && precision <= 12)
				{
					displayValue = displayValue.toFixed(precision);
				}

				graph.cellLabelChanged(widget.cell,
					(widget.label ? widget.label + ': ' : '') +
					((displayValue == null) ? '—' : String(displayValue)) +
					(widget.units ? ' ' + widget.units : ''), false);
			};

			var updateValue = function(widget, value)
			{
				widget.value = value;

				if (widget.type != 'valueEditor' || !widget.editing)
				{
					renderValue(widget, value);
				}
			};

			var updateIndicator = function(widget, value)
			{
				if (widget.indicatorInitialized && widget.indicatorValue === value)
				{
					return;
				}

				widget.indicatorInitialized = true;
				widget.indicatorValue = value;
				var stateLabel = (value === true) ? 'ON' : (value === false) ? 'OFF' : '—';
				var fillColor = (value === true) ? '#d5e8d4' :
					(value === false) ? '#f5f5f5' : '#fff2cc';
				graph.setCellStyles(mxConstants.STYLE_FILLCOLOR, fillColor, [widget.cell]);
				graph.cellLabelChanged(widget.cell,
					(widget.label ? widget.label + ': ' : '') + stateLabel, false);
			};

			var bindButtonHandlers = function(attempt)
			{
				var pending = false;

				for (var i = 0; i < widgets.length; i++)
				{
					if (widgets[i].type == 'button')
					{
						var state = graph.view.getState(widgets[i].cell);

						if (state != null && state.shape != null && state.shape.node != null)
						{
							var node = state.shape.node;

							if (node.getAttribute('data-scada-button') != 'true')
							{
								(function(widget)
								{
									var originalFilter = node.style.filter;
									var pointerId = null;
									node.style.cursor = 'pointer';
									node.setAttribute('role', 'button');
									node.setAttribute('tabindex', '0');
									node.setAttribute('data-scada-button', 'true');
									var setPressed = function(pressed)
									{
										node.setAttribute('data-scada-pressed', pressed ? 'true' : 'false');
										node.style.filter = pressed ? 'brightness(0.82)' : originalFilter;
									};
									var press = function(evt)
									{
										if (evt.button != 0 || pointerId != null)
										{
											return;
										}

										pointerId = evt.pointerId;
										setPressed(true);
										evt.stopPropagation();
									};
									var release = function(evt)
									{
										if (pointerId != evt.pointerId)
										{
											return;
										}

										pointerId = null;
										setPressed(false);
									};
									var activate = function(evt)
									{
										if (evt.type == 'keydown' && evt.key != 'Enter' && evt.key != ' ')
										{
											return;
										}

										evt.preventDefault();
										evt.stopPropagation();

										if (evt.type == 'keydown')
										{
											if (evt.repeat)
											{
												return;
											}

											setPressed(true);
										}

										writeValue(widget).catch(function(error)
										{
											console.error(error);
											updateStatus(error.message, true);
										});
									};
									var releaseKey = function(evt)
									{
										if (evt.key == 'Enter' || evt.key == ' ')
										{
											setPressed(false);
											evt.preventDefault();
											evt.stopPropagation();
										}
									};
									node.addEventListener('pointerdown', press);
									document.addEventListener('pointerup', release, true);
									document.addEventListener('pointercancel', release, true);
									node.addEventListener('click', activate);
									node.addEventListener('keydown', activate);
									node.addEventListener('keyup', releaseKey);
								})(widgets[i]);
							}
						}
						else
						{
							pending = true;
						}
					}
				}

				if (pending)
				{
					if (attempt < 40)
					{
						window.setTimeout(function()
						{
							bindButtonHandlers(attempt + 1);
						}, 50);
					}
					else
					{
						updateStatus('Unable to initialize SCADA button controls', true);
					}
				}
			};

			var bindValueEditorHandlers = function(attempt)
			{
				var pending = false;

				for (var i = 0; i < widgets.length; i++)
				{
					if (widgets[i].type == 'valueEditor')
					{
						var state = graph.view.getState(widgets[i].cell);

						if (state != null && state.shape != null && state.shape.node != null)
						{
							var node = state.shape.node;

							if (node.getAttribute('data-scada-value-editor') != 'true')
							{
								(function(widget)
								{
									var bounds = node.getBBox();
									var foreignObject = document.createElementNS(
										'http://www.w3.org/2000/svg', 'foreignObject');
									foreignObject.setAttribute('x', bounds.x);
									foreignObject.setAttribute('y', bounds.y);
									foreignObject.setAttribute('width', bounds.width);
									foreignObject.setAttribute('height', bounds.height);
									foreignObject.style.display = 'none';

									var input = document.createElementNS(
										'http://www.w3.org/1999/xhtml', 'input');
									input.type = 'text';
									input.setAttribute('aria-label', 'Edit ' + (widget.label || widget.tag));
									input.style.cssText = 'box-sizing:border-box;width:100%;height:100%;' +
										'padding:2px 6px;border:1px solid #6c8ebf;border-radius:3px;' +
										'background:#fff;color:#222;font:14px sans-serif;text-align:center;';
									foreignObject.appendChild(input);
									node.appendChild(foreignObject);
									var initialValue = '';

									var closeEditor = function()
									{
										widget.editing = false;
										foreignObject.style.display = 'none';
									};

									var commitEdit = function()
									{
										if (!widget.editing)
										{
											return;
										}

										var raw = input.value;
										closeEditor();
										input.blur();

										if (raw == initialValue)
										{
											renderValue(widget, widget.value);
											return;
										}

										var value = parseValue(raw);
										writeTag(widget, value).then(function()
										{
											updateValue(widget, value);
										}).catch(function(error)
										{
											console.error(error);
											updateStatus(error.message, true);
										});
									};

									var cancelEdit = function()
									{
										if (widget.editing)
										{
											closeEditor();
											input.blur();
											renderValue(widget, widget.value);
										}
									};

									var startEdit = function(evt)
									{
										if (widget.editing)
										{
											evt.stopPropagation();
											return;
										}

										evt.preventDefault();
										evt.stopPropagation();
										widget.editing = true;
										initialValue = (widget.value == null) ? '' : String(widget.value);
										input.value = initialValue;
										foreignObject.style.display = 'block';
										input.focus();
										input.select();
									};

									input.addEventListener('pointerdown', function(evt)
									{
										evt.stopPropagation();
									});
									input.addEventListener('click', function(evt)
									{
										evt.stopPropagation();
									});
									input.addEventListener('keydown', function(evt)
									{
										evt.stopPropagation();

										if (evt.key == 'Enter' && !evt.isComposing)
										{
											evt.preventDefault();
											commitEdit();
										}
										else if (evt.key == 'Escape')
										{
											evt.preventDefault();
											cancelEdit();
										}
									});
									input.addEventListener('keyup', function(evt)
									{
										evt.stopPropagation();
									});
									input.addEventListener('blur', commitEdit);
									node.style.cursor = 'text';
									node.setAttribute('role', 'button');
									node.setAttribute('tabindex', '0');
									node.setAttribute('aria-label', 'Edit ' + (widget.label || widget.tag));
									node.setAttribute('data-scada-value-editor', 'true');
									node.addEventListener('pointerdown', function(evt)
									{
										evt.stopPropagation();
									});
									node.addEventListener('click', startEdit);
									node.addEventListener('keydown', function(evt)
									{
										if (evt.key == 'Enter' || evt.key == ' ')
										{
											startEdit(evt);
										}
									});
								})(widgets[i]);
							}
						}
						else
						{
							pending = true;
						}
					}
				}

				if (pending)
				{
					if (attempt < 40)
					{
						window.setTimeout(function()
						{
							bindValueEditorHandlers(attempt + 1);
						}, 50);
					}
					else
					{
						updateStatus('Unable to initialize SCADA value editor controls', true);
					}
				}
			};

			window.setTimeout(function()
			{
				bindButtonHandlers(0);
				bindValueEditorHandlers(0);
			}, 0);

			var tagList = Object.keys(tags);

			if (tagList.length == 0)
			{
				updateStatus('SCADA runtime ready · no bound variables', false);
				return;
			}

			var poll = async function()
			{
				try
				{
					var url = apiUrl(config.readPath);
					url.searchParams.set('tags', tagList.join(','));
					var result = await requestJson(url);

					if (result.values == null || typeof result.values != 'object')
					{
						throw new Error('Backend read response must contain a values object');
					}

					for (var i = 0; i < widgets.length; i++)
					{
						var widget = widgets[i];

						if ((widget.type == 'display' || widget.type == 'valueEditor') &&
							Object.prototype.hasOwnProperty.call(result.values, widget.tag))
						{
							updateValue(widget, result.values[widget.tag]);
						}
						else if (widget.type == 'indicator' &&
							Object.prototype.hasOwnProperty.call(result.values, widget.tag))
						{
							updateIndicator(widget, result.values[widget.tag]);
						}
					}

					updateStatus('Connected', false);
				}
				catch (error)
				{
					console.error(error);
					updateStatus(error.message, true);
				}
				finally
				{
					window.setTimeout(poll, interval);
				}
			};

			poll();
		}
		catch (error)
		{
			console.error(error);
			updateStatus(error.message, true);
		}
	};

	window.onDrawioViewerLoad = function()
	{
		var previousInitialized = GraphViewer.viewerInitialized;
		GraphViewer.viewerInitialized = function(viewer)
		{
			previousInitialized.apply(this, arguments);

			if (viewer.graphConfig.scada != null)
			{
				initRuntime(viewer);
			}
		};

		GraphViewer.processElements();
	};
})();
