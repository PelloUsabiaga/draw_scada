(function()
{
	var defaults = {
		enabled: true,
		endpointUrl: 'http://localhost:8765',
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

				if (type == 'button' || type == 'display')
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

			var writeValue = async function(widget)
			{
				var raw = graph.getAttributeForCell(widget.cell, 'writeValue', 'true');
				var value = raw;

				try
				{
					value = JSON.parse(raw);
				}
				catch (e)
				{
					// Non-JSON input is treated as a string value.
				}

				var url = apiUrl(config.writePath);
				await requestJson(url, {
					method: 'POST',
					headers: {'Content-Type': 'application/json'},
					body: JSON.stringify({tag: widget.tag, value: value})
				});
				updateStatus('Connected · wrote ' + widget.tag, false);
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

			window.setTimeout(function()
			{
				bindButtonHandlers(0);
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

						if (widget.type == 'display' && Object.prototype.hasOwnProperty.call(result.values, widget.tag))
						{
							var value = result.values[widget.tag];
							var precision = Number(widget.precision);

							if (typeof value == 'number' && isFinite(precision) && precision >= 0 && precision <= 12)
							{
								value = value.toFixed(precision);
							}

							graph.cellLabelChanged(widget.cell,
								(widget.label ? widget.label + ': ' : '') +
								((value == null) ? '—' : String(value)) +
								(widget.units ? ' ' + widget.units : ''), false);
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
