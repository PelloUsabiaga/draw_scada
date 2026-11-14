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

			if (!isFinite(interval) || interval < 100 || interval > 60000)
			{
				throw new Error('Poll interval must be between 100 and 60000 ms');
			}

			var graph = viewer.graph;
			var model = graph.getModel();
			var widgets = [];
			var tags = Object.create(null);
			var cells = model.getDescendants(model.getRoot());
			var parseSelectOptions = function(raw, tag)
			{
				var options = null;

				try
				{
					options = JSON.parse(raw);
				}
				catch (error)
				{
					throw new Error('Invalid Select value options for "' + tag + '": ' + error.message);
				}

				if (!Array.isArray(options) || options.length == 0)
				{
					throw new Error('Select value options for "' + tag + '" must be a non-empty JSON array');
				}

				var parsed = [];
				var seenValues = Object.create(null);

				for (var i = 0; i < options.length; i++)
				{
					var option = options[i];

					if (option == null || typeof option != 'object' || Array.isArray(option) ||
						typeof option.label != 'string' || option.label.trim().length == 0)
					{
						throw new Error('Each Select value option for "' + tag +
							'" must have a non-empty string label and a scalar value');
					}

					var value = option.value;
					var valueType = typeof value;

					if (valueType != 'string' && valueType != 'number' && valueType != 'boolean')
					{
						throw new Error('Each Select value option for "' + tag +
							'" must have a string, number, or boolean value');
					}

					var valueKey = valueType + ':' + String(value);

					if (Object.prototype.hasOwnProperty.call(seenValues, valueKey))
					{
						throw new Error('Select value options for "' + tag + '" must have unique values');
					}

					seenValues[valueKey] = true;
					parsed.push({label: option.label, value: value});
				}

				return parsed;
			};

			for (var i = 0; i < cells.length; i++)
			{
				var cell = cells[i];
				var type = graph.getAttributeForCell(cell, 'scadaType', null);

				if (type == 'display')
				{
					type = 'outputValue';
				}
				else if (type == 'indicator')
				{
					type = 'booleanLed';
				}
				else if (type == 'valueEditor')
				{
					type = 'inputValue';
				}

				if (type == 'button' || type == 'outputValue' ||
					type == 'selectValue' ||
					type == 'booleanLed' || type == 'booleanSwitch' ||
					type == 'inputValue')
				{
					var tag = graph.getAttributeForCell(cell, 'tag', '');

					if (tag.length == 0)
					{
						continue;
					}

					tags[tag] = true;

					var newWidget = {cell: cell, type: type, tag: tag,
						label: graph.getAttributeForCell(cell, 'label', ''),
						units: graph.getAttributeForCell(cell, 'units', ''),
						precision: graph.getAttributeForCell(cell, 'precision', '1')};

					if (type == 'selectValue')
					{
						newWidget.options = parseSelectOptions(
							graph.getAttributeForCell(cell, 'options', '[]'), tag);
					}

					if (type == 'booleanLed' || type == 'booleanSwitch')
					{
						var onColor = graph.getAttributeForCell(cell, 'onColor', '#d5e8d4');
						var offColor = graph.getAttributeForCell(cell, 'offColor', '#f5f5f5');
						newWidget.onColor = onColor;
						newWidget.offColor = offColor;
					}

					widgets.push(newWidget);
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

			var renderSelectValue = function(widget, value)
			{
				if (widget.select == null || widget.writePending)
				{
					return;
				}

				var selectedValue = '';

				for (var i = 0; i < widget.options.length; i++)
				{
					if (widget.options[i].value === value)
					{
						selectedValue = String(i);
						break;
					}
				}

				widget.select.value = selectedValue;
			};

			var renderValue = function(widget, value)
			{
				if (widget.type == 'selectValue')
				{
					renderSelectValue(widget, value);
					return;
				}

				var displayValue = value;
				var precision = Number(widget.precision);

				if (typeof displayValue == 'number' && isFinite(precision) &&
					precision >= 0 && precision <= 12)
				{
					displayValue = displayValue.toFixed(precision);
				}

				var valueText = (displayValue == null) ? '-' : String(displayValue);

				if (widget.type == 'inputValue')
				{
					if (widget.input != null && !widget.editing)
					{
						widget.input.value = valueText;
					}

					return;
				}

				graph.cellLabelChanged(widget.cell,
					(widget.label ? widget.label + ': ' : '') +
					(valueText) +
					(widget.units ? ' ' + widget.units : ''), false);
			};

			var updateValue = function(widget, value)
			{
				widget.value = value;

				if (widget.type != 'inputValue' || !widget.editing)
				{
					renderValue(widget, value);
				}
			};

			var updateBooleanLed = function(widget, value)
			{
				if (widget.booleanLedInitialized && widget.booleanLedValue === value)
				{
					return;
				}

				widget.booleanLedInitialized = true;
				widget.booleanLedValue = value;
				var stateLabel = (value === true) ? 'ON' : (value === false) ? 'OFF' : '—';
				var fillColor = (value === true) ? widget.onColor :
    				(value === false) ? widget.offColor : '#fff2cc';
				graph.setCellStyles(mxConstants.STYLE_FILLCOLOR, fillColor, [widget.cell]);
				graph.cellLabelChanged(widget.cell,
					(widget.label ? widget.label + ': ' : '') + stateLabel, false);
			};

			var updateBooleanSwitch = function(widget, value)
			{
				widget.value = value;

				if (widget.switchControl == null)
				{
					return;
				}

				var isBoolean = value === true || value === false;
				widget.switchControl.setAttribute('aria-checked',
					isBoolean ? String(value) : 'mixed');
				widget.switchControl.disabled = !isBoolean || !!widget.writePending;
				widget.switchControl.style.cursor = widget.switchControl.disabled ?
					'not-allowed' : 'pointer';
				widget.switchControl.style.opacity = isBoolean ? '1' : '0.55';
				widget.switchTrack.style.backgroundColor = (value === true) ? widget.onColor :
					(value === false) ? widget.offColor : '#bdbdbd';
				widget.switchKnob.style.transform = (value === true) ?
					'translateX(30px)' : 'translateX(0)';
			};

			var bindBooleanSwitchHandlers = function(attempt)
			{
				var pending = false;

				for (var i = 0; i < widgets.length; i++)
				{
					if (widgets[i].type == 'booleanSwitch')
					{
						var state = graph.view.getState(widgets[i].cell);

						if (state != null && state.shape != null && state.shape.node != null)
						{
							var node = state.shape.node;

							if (node.getAttribute('data-scada-boolean-switch') != 'true')
							{
								(function(widget, node, labelNode)
								{
									var bounds = node.getBBox();
									var foreignObject = document.createElementNS(
										'http://www.w3.org/2000/svg', 'foreignObject');
									foreignObject.setAttribute('x', bounds.x);
									foreignObject.setAttribute('y', bounds.y);
									foreignObject.setAttribute('width', bounds.width);
									foreignObject.setAttribute('height', bounds.height);
									foreignObject.style.display = 'block';

									var control = document.createElementNS(
										'http://www.w3.org/1999/xhtml', 'button');
									control.type = 'button';
									control.setAttribute('role', 'switch');
									control.setAttribute('aria-label', widget.label || widget.tag);
									control.style.cssText = 'box-sizing:border-box;display:flex;' +
										'align-items:center;justify-content:center;width:100%;height:100%;' +
										'padding:0;border:0;background:transparent;';

									var track = document.createElementNS(
										'http://www.w3.org/1999/xhtml', 'span');
									track.style.cssText = 'position:relative;display:block;width:64px;' +
										'height:34px;border-radius:999px;transition:background-color 180ms ease;';

									var knob = document.createElementNS(
										'http://www.w3.org/1999/xhtml', 'span');
									knob.style.cssText = 'position:absolute;left:3px;top:3px;width:28px;' +
										'height:28px;border-radius:50%;background:#fff;' +
										'box-shadow:0 1px 3px rgba(0,0,0,0.35);' +
										'transition:transform 180ms ease;';
									track.appendChild(knob);
									control.appendChild(track);
									foreignObject.appendChild(control);
									node.appendChild(foreignObject);

									widget.switchControl = control;
									widget.switchTrack = track;
									widget.switchKnob = knob;
									updateBooleanSwitch(widget, widget.value);

									var stopPropagation = function(evt)
									{
										evt.stopPropagation();
									};

									control.addEventListener('pointerdown', stopPropagation);
									control.addEventListener('mousedown', stopPropagation);
									control.addEventListener('keydown', stopPropagation);
									control.addEventListener('keyup', stopPropagation);
									control.addEventListener('click', function(evt)
									{
										evt.stopPropagation();

										if (typeof widget.value != 'boolean' || widget.writePending)
										{
											return;
										}

										var previousValue = widget.value;
										var nextValue = !previousValue;
										widget.writePending = true;
										updateBooleanSwitch(widget, nextValue);

										writeTag(widget, nextValue).then(function()
										{
											widget.writePending = false;
											updateBooleanSwitch(widget, nextValue);
										}).catch(function(error)
										{
											widget.writePending = false;
											updateBooleanSwitch(widget, previousValue);
											console.error(error);
											updateStatus(error.message, true);
										});
									});

									node.style.cursor = 'pointer';
									node.setAttribute('data-scada-boolean-switch', 'true');
									node.addEventListener('pointerdown', stopPropagation);

									if (labelNode != null)
									{
										labelNode.style.visibility = 'hidden';
									}
								})(widgets[i], node,
									(state.text != null && state.text.node != null) ? state.text.node : null);
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
							bindBooleanSwitchHandlers(attempt + 1);
						}, 50);
					}
					else
					{
						updateStatus('Unable to initialize SCADA switch controls', true);
					}
				}
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
							var labelNode = (state.text != null && state.text.node != null) ?
								state.text.node : null;

							if (node.getAttribute('data-scada-button') != 'true')
							{
								(function(widget, node, labelNode)
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

									var bindPointerTarget = function(target, preventSelection)
									{
										target.style.cursor = 'pointer';
										target.style.userSelect = 'none';
										target.style.webkitUserSelect = 'none';
										target.addEventListener('pointerdown', function(evt)
										{
											if (preventSelection && evt.button == 0)
											{
												evt.preventDefault();
											}

											press(evt);
										});
										target.addEventListener('click', activate);
									};

									document.addEventListener('pointerup', release, true);
									document.addEventListener('pointercancel', release, true);
									bindPointerTarget(node, false);

									if (labelNode != null)
									{
										bindPointerTarget(labelNode, true);
									}

									node.addEventListener('keydown', activate);
									node.addEventListener('keyup', releaseKey);
								})(widgets[i], node, labelNode);
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

			var bindInputValueHandlers = function(attempt)
			{
				var pending = false;

				for (var i = 0; i < widgets.length; i++)
				{
					if (widgets[i].type == 'inputValue')
					{
						var state = graph.view.getState(widgets[i].cell);

						if (state != null && state.shape != null && state.shape.node != null)
						{
							var node = state.shape.node;

							if (node.getAttribute('data-scada-input-value') != 'true')
							{
								(function(widget, node, labelNode)
								{
									var bounds = node.getBBox();
									var foreignObject = document.createElementNS(
										'http://www.w3.org/2000/svg', 'foreignObject');
									foreignObject.setAttribute('x', bounds.x);
									foreignObject.setAttribute('y', bounds.y);
									foreignObject.setAttribute('width', bounds.width);
									foreignObject.setAttribute('height', bounds.height);
									foreignObject.style.display = 'block';

									var input = document.createElementNS(
										'http://www.w3.org/1999/xhtml', 'input');
									input.type = 'text';
									input.setAttribute('aria-label', widget.label || widget.tag);
									input.style.cssText = 'box-sizing:border-box;width:100%;height:100%;' +
										'padding:2px 6px;border:1px solid #6c8ebf;border-radius:3px;' +
										'background:#fff;color:#222;font:14px sans-serif;text-align:center;';
									foreignObject.appendChild(input);
									node.appendChild(foreignObject);
									widget.input = input;
									input.value = (widget.value == null) ? '' : String(widget.value);
									var initialValue = '';

									var closeEditor = function()
									{
										widget.editing = false;
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

									input.addEventListener('pointerdown', function(evt)
									{
										evt.stopPropagation();
									});
									input.addEventListener('click', function(evt)
									{
										evt.stopPropagation();
									});
									input.addEventListener('focus', function()
									{
										initialValue = input.value;
										widget.editing = true;
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
									node.setAttribute('data-scada-input-value', 'true');
									node.addEventListener('pointerdown', function(evt)
									{
										evt.stopPropagation();
									});

									if (labelNode != null)
									{
										labelNode.style.visibility = 'hidden';
									}
								})(widgets[i], node,
									(state.text != null && state.text.node != null) ? state.text.node : null);
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
							bindInputValueHandlers(attempt + 1);
						}, 50);
					}
					else
					{
						updateStatus('Unable to initialize SCADA input value controls', true);
					}
				}
			};

			var bindSelectValueHandlers = function(attempt)
			{
				var pending = false;

				for (var i = 0; i < widgets.length; i++)
				{
					if (widgets[i].type == 'selectValue')
					{
						var state = graph.view.getState(widgets[i].cell);

						if (state != null && state.shape != null && state.shape.node != null)
						{
							var node = state.shape.node;

							if (node.getAttribute('data-scada-select-value') != 'true')
							{
								(function(widget, node, labelNode)
								{
									var bounds = node.getBBox();
									var foreignObject = document.createElementNS(
										'http://www.w3.org/2000/svg', 'foreignObject');
									foreignObject.setAttribute('x', bounds.x);
									foreignObject.setAttribute('y', bounds.y);
									foreignObject.setAttribute('width', bounds.width);
									foreignObject.setAttribute('height', bounds.height);
									foreignObject.style.display = 'block';

									var select = document.createElementNS(
										'http://www.w3.org/1999/xhtml', 'select');
									select.setAttribute('aria-label', widget.label || widget.tag);
									select.style.cssText = 'box-sizing:border-box;width:100%;height:100%;' +
										'padding:2px 6px;border:1px solid #6c8ebf;border-radius:3px;' +
										'background:#fff;color:#222;font:14px sans-serif;text-align:center;';

									var placeholder = document.createElementNS(
										'http://www.w3.org/1999/xhtml', 'option');
									placeholder.value = '';
									placeholder.textContent = 'Select...';
									placeholder.disabled = true;
									placeholder.selected = true;
									select.appendChild(placeholder);

									for (var j = 0; j < widget.options.length; j++)
									{
										var option = document.createElementNS(
											'http://www.w3.org/1999/xhtml', 'option');
										option.value = String(j);
										option.textContent = widget.options[j].label;
										select.appendChild(option);
									}

									foreignObject.appendChild(select);
									node.appendChild(foreignObject);
									widget.select = select;
									renderSelectValue(widget, widget.value);

									select.addEventListener('pointerdown', function(evt)
									{
										evt.stopPropagation();
									});
									select.addEventListener('click', function(evt)
									{
										evt.stopPropagation();
									});
									select.addEventListener('keydown', function(evt)
									{
										evt.stopPropagation();
									});
									select.addEventListener('keyup', function(evt)
									{
										evt.stopPropagation();
									});
									select.addEventListener('change', function(evt)
									{
										evt.stopPropagation();
										var selectedIndex = select.selectedIndex - 1;
										var selectedOption = (selectedIndex >= 0) ?
											widget.options[selectedIndex] : null;

										if (selectedOption == null)
										{
											return;
										}

										widget.writePending = true;
										select.disabled = true;

										writeTag(widget, selectedOption.value).then(function()
										{
											widget.value = selectedOption.value;
											widget.writePending = false;
											select.disabled = false;
											renderSelectValue(widget, widget.value);
										}).catch(function(error)
										{
											widget.writePending = false;
											select.disabled = false;
											renderSelectValue(widget, widget.value);
											console.error(error);
											updateStatus(error.message, true);
										});
									});
									node.style.cursor = 'pointer';
									node.setAttribute('data-scada-select-value', 'true');
									node.addEventListener('pointerdown', function(evt)
									{
										evt.stopPropagation();
									});

									if (labelNode != null)
									{
										labelNode.style.visibility = 'hidden';
									}
								})(widgets[i], node,
									(state.text != null && state.text.node != null) ? state.text.node : null);
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
							bindSelectValueHandlers(attempt + 1);
						}, 50);
					}
					else
					{
						updateStatus('Unable to initialize SCADA select value controls', true);
					}
				}
			};

			window.setTimeout(function()
			{
				bindButtonHandlers(0);
				bindInputValueHandlers(0);
				bindSelectValueHandlers(0);
				bindBooleanSwitchHandlers(0);
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

						if ((widget.type == 'outputValue' || widget.type == 'inputValue' ||
							(widget.type == 'selectValue' && !widget.writePending)) &&
							Object.prototype.hasOwnProperty.call(result.values, widget.tag))
						{
							updateValue(widget, result.values[widget.tag]);
						}
						else if (widget.type == 'booleanLed' &&
							Object.prototype.hasOwnProperty.call(result.values, widget.tag))
						{
							updateBooleanLed(widget, result.values[widget.tag]);
						}
						else if (widget.type == 'booleanSwitch' && !widget.writePending &&
							Object.prototype.hasOwnProperty.call(result.values, widget.tag))
						{
							updateBooleanSwitch(widget, result.values[widget.tag]);
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
