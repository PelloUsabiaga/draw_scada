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
		var graph = viewer.graph;
		var model = graph.getModel();
		var cells = model.getDescendants(model.getRoot());
		var widgets = [];
		var tags = Object.create(null);
		var diagnosticsWidgets = [];
		var diagnosticsState = {
			connected: false,
			lastLog: 'Waiting for SCADA connection',
			isError: false
		};
		var updateDiagnosticsWidget = function(widget)
		{
			var fillColor = diagnosticsState.connected ? widget.onColor : widget.offColor;
			var ledStyle = graph.getCellStyle(widget.ledCell);

			if (ledStyle[mxConstants.STYLE_FILLCOLOR] != fillColor)
			{
				graph.setCellStyles(mxConstants.STYLE_FILLCOLOR, fillColor, [widget.ledCell]);
			}

			var logStyle = graph.getCellStyle(widget.logCell);
			var fontColor = diagnosticsState.isError ? '#b00020' :
				widget.defaultFontColor;

			if (logStyle[mxConstants.STYLE_FONTCOLOR] != fontColor)
			{
				graph.setCellStyles(mxConstants.STYLE_FONTCOLOR, fontColor, [widget.logCell]);
			}

			if (widget.lastLog != diagnosticsState.lastLog)
			{
				graph.cellLabelChanged(widget.logCell, diagnosticsState.lastLog, false);
				widget.lastLog = diagnosticsState.lastLog;
			}
		};
		var refreshDiagnostics = function()
		{
			for (var i = 0; i < diagnosticsWidgets.length; i++)
			{
				updateDiagnosticsWidget(diagnosticsWidgets[i]);
			}
		};
		var updateStatus = function(message, isError, connected)
		{
			diagnosticsState.lastLog = message;
			diagnosticsState.isError = !!isError;

			if (connected != null)
			{
				diagnosticsState.connected = connected;
			}

			refreshDiagnostics();
		};
		var updateConnection = function(connected)
		{
			if (diagnosticsState.connected != connected)
			{
				diagnosticsState.connected = connected;
				diagnosticsState.lastLog = connected ? 'Connected' : 'Disconnected';
				diagnosticsState.isError = false;
				refreshDiagnostics();
			}
		};

		try
		{
			for (var i = 0; i < cells.length; i++)
			{
				if (graph.getAttributeForCell(cells[i], 'scadaType', null) == 'diagnostics')
				{
					var diagnosticsLedCell = null;
					var diagnosticsLogCell = null;

					for (var childIndex = 0; childIndex < model.getChildCount(cells[i]); childIndex++)
					{
						var child = model.getChildAt(cells[i], childIndex);
						var part = graph.getAttributeForCell(child, 'scadaDiagnosticsPart', null);

						if (part == 'led')
						{
							if (diagnosticsLedCell != null)
							{
								throw new Error('Diagnostics widget has more than one LED');
							}

							diagnosticsLedCell = child;
						}
						else if (part == 'log')
						{
							if (diagnosticsLogCell != null)
							{
								throw new Error('Diagnostics widget has more than one log textbox');
							}

							diagnosticsLogCell = child;
						}
					}

					if (diagnosticsLedCell == null || diagnosticsLogCell == null)
					{
						throw new Error('Diagnostics widget must contain an LED and a log textbox');
					}

					var logStyle = graph.getCellStyle(diagnosticsLogCell);
					diagnosticsWidgets.push({
						ledCell: diagnosticsLedCell,
						logCell: diagnosticsLogCell,
						onColor: graph.getAttributeForCell(cells[i], 'onColor', '#85ee80'),
						offColor: graph.getAttributeForCell(cells[i], 'offColor', '#f09898'),
						defaultFontColor: logStyle[mxConstants.STYLE_FONTCOLOR] || '#333333',
						lastLog: null
					});
				}
			}

			refreshDiagnostics();

			if (!config.enabled)
			{
				updateStatus('SCADA runtime disabled', false, false);
				return;
			}

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

			var parseSelectOptions = function(raw, tag)
			{
				var options = null;
				var trimmed = raw.trim();

				if (trimmed.charAt(0) == '[')
				{
					try
					{
						options = JSON.parse(trimmed);
					}
					catch (error)
					{
						throw new Error('Invalid Select value options for "' + tag + '": ' + error.message);
					}
				}
				else
				{
					options = [];
					var lines = raw.split(/\r?\n/);

					for (var lineIndex = 0; lineIndex < lines.length; lineIndex++)
					{
						var line = lines[lineIndex];

						if (line.trim().length == 0)
						{
							continue;
						}

						var separator = line.indexOf(':');

						if (separator < 0)
						{
							throw new Error('Select value options for "' + tag +
								'" must use "label: JSON value" on line ' + (lineIndex + 1));
						}

						var label = line.substring(0, separator).trim();
						var rawValue = line.substring(separator + 1).trim();

						if (label.length == 0 || rawValue.length == 0)
						{
							throw new Error('Select value options for "' + tag +
								'" need a label and JSON value on line ' + (lineIndex + 1));
						}

						var value = null;

						try
						{
							value = JSON.parse(rawValue);
						}
						catch (error)
						{
							throw new Error('Invalid JSON value for Select value "' + tag +
								'" on line ' + (lineIndex + 1) + ': ' + error.message);
						}

						options.push({label: label, value: value});
					}
				}

				if (!Array.isArray(options) || options.length == 0)
				{
					throw new Error('Select value options for "' + tag +
						'" must contain at least one option');
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

					if (valueType != 'string' && valueType != 'number' && valueType != 'boolean' ||
						(valueType == 'number' && !isFinite(value)))
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
					type == 'booleanCheckbox' ||
					type == 'barGauge' || type == 'slider' ||
					type == 'inputValue')
				{
					var tag = graph.getAttributeForCell(cell, 'tag', '');

					if (type == 'booleanLed')
					{
						graph.setCellStyles(mxConstants.STYLE_NOLABEL, '1', [cell]);
					}

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
						var selectTextCell = null;
						var selectArrowCell = null;

						for (var childIndex = 0; childIndex < model.getChildCount(cell); childIndex++)
						{
							var child = model.getChildAt(cell, childIndex);
							var part = graph.getAttributeForCell(child, 'scadaSelectPart', null);

							if (part == 'text')
							{
								if (selectTextCell != null)
								{
									throw new Error('Select value "' + tag + '" has more than one text element');
								}

								selectTextCell = child;
							}
							else if (part == 'arrow')
							{
								if (selectArrowCell != null)
								{
									throw new Error('Select value "' + tag + '" has more than one dropdown arrow');
								}

								selectArrowCell = child;
							}
						}

						if ((selectTextCell == null) != (selectArrowCell == null))
						{
							throw new Error('Select value "' + tag +
								'" must contain both its text element and dropdown arrow');
						}

						newWidget.selectTextCell = selectTextCell;
						newWidget.selectArrowCell = selectArrowCell;
					}

					if (type == 'inputValue')
					{
						var inputFieldCell = null;

						for (var childIndex = 0; childIndex < model.getChildCount(cell); childIndex++)
						{
							var child = model.getChildAt(cell, childIndex);

							if (graph.getAttributeForCell(child, 'scadaInputPart', null) == 'field')
							{
								if (inputFieldCell != null)
								{
									throw new Error('Input value "' + tag + '" has more than one editable field');
								}

								inputFieldCell = child;
							}
						}

						newWidget.inputFieldCell = inputFieldCell;
					}

					if (type == 'barGauge')
					{
						var minValue = Number(graph.getAttributeForCell(cell, 'min', '0'));
						var maxValue = Number(graph.getAttributeForCell(cell, 'max', '100'));

						if (!isFinite(minValue) || !isFinite(maxValue) || maxValue <= minValue ||
							!isFinite(maxValue - minValue))
						{
							throw new Error('Bar gauge "' + tag +
								'" requires finite minimum and maximum values with max greater than min');
						}

						var fillCell = null;

						for (var childIndex = 0; childIndex < model.getChildCount(cell); childIndex++)
						{
							var child = model.getChildAt(cell, childIndex);

							if (graph.getAttributeForCell(child, 'scadaGaugePart', null) == 'fill')
							{
								if (fillCell != null)
								{
									throw new Error('Bar gauge "' + tag + '" has more than one fill rectangle');
								}

								fillCell = child;
							}
						}

						if (fillCell == null)
						{
							throw new Error('Bar gauge "' + tag + '" is missing its fill rectangle');
						}

						var fillGeometry = model.getGeometry(fillCell);
						var gaugeGeometry = model.getGeometry(cell);
						var gaugeRotation = Number(graph.getCellStyle(cell)[
							mxConstants.STYLE_ROTATION] || 0);

						if (fillGeometry == null || !isFinite(fillGeometry.width) ||
							!isFinite(fillGeometry.height) || fillGeometry.width <= 0 ||
							fillGeometry.height <= 0 || gaugeGeometry == null ||
							!isFinite(gaugeGeometry.width) || !isFinite(gaugeGeometry.height) ||
							!isFinite(gaugeRotation))
						{
							throw new Error('Bar gauge "' + tag + '" has invalid geometry or rotation');
						}

						var gaugeCenter = new mxPoint(gaugeGeometry.width / 2,
							gaugeGeometry.height / 2);
						fillGeometry = fillGeometry.clone();
						fillGeometry.rotate(-gaugeRotation, gaugeCenter);
						newWidget.minValue = minValue;
						newWidget.maxValue = maxValue;
						newWidget.fillCell = fillCell;
						newWidget.fillGeometry = fillGeometry;
						newWidget.gaugeCenter = gaugeCenter;
						newWidget.rotation = gaugeRotation;
					}

					if (type == 'slider')
					{
						var sliderMin = Number(graph.getAttributeForCell(cell, 'min', '0'));
						var sliderMax = Number(graph.getAttributeForCell(cell, 'max', '100'));

						if (!isFinite(sliderMin) || !isFinite(sliderMax) ||
							sliderMax <= sliderMin || !isFinite(sliderMax - sliderMin))
						{
							throw new Error('Slider "' + tag +
								'" requires finite minimum and maximum values with max greater than min');
						}

						var orientation = graph.getAttributeForCell(cell, 'orientation', 'horizontal');

						if (orientation != 'horizontal' && orientation != 'vertical')
						{
							throw new Error('Slider "' + tag + '" orientation must be horizontal or vertical');
						}

						var knobCell = null;

						for (var childIndex = 0; childIndex < model.getChildCount(cell); childIndex++)
						{
							var child = model.getChildAt(cell, childIndex);

							if (graph.getAttributeForCell(child, 'scadaSliderPart', null) == 'knob')
							{
								if (knobCell != null)
								{
									throw new Error('Slider "' + tag + '" has more than one knob');
								}

								knobCell = child;
							}
						}

						if (knobCell == null)
						{
							throw new Error('Slider "' + tag + '" is missing its knob');
						}

						var sliderGeometry = model.getGeometry(cell);
						var knobGeometry = model.getGeometry(knobCell);
						var sliderRotation = Number(graph.getCellStyle(cell)[
							mxConstants.STYLE_ROTATION] || 0);

						if (sliderGeometry == null || !isFinite(sliderGeometry.width) ||
							!isFinite(sliderGeometry.height) || sliderGeometry.width <= 0 ||
							sliderGeometry.height <= 0 || knobGeometry == null ||
							!isFinite(knobGeometry.width) || !isFinite(knobGeometry.height) ||
							knobGeometry.width <= 0 || knobGeometry.height <= 0 ||
							!isFinite(sliderRotation))
						{
							throw new Error('Slider "' + tag + '" has invalid geometry or rotation');
						}

						var sliderTravel = (orientation == 'horizontal') ?
							sliderGeometry.width - knobGeometry.width :
							sliderGeometry.height - knobGeometry.height;

						if (sliderTravel <= 0)
						{
							throw new Error('Slider "' + tag + '" track must be larger than its knob');
						}

						var sliderCenter = new mxPoint(sliderGeometry.width / 2,
							sliderGeometry.height / 2);
						knobGeometry = knobGeometry.clone();
						knobGeometry.rotate(-sliderRotation, sliderCenter);
						newWidget.minValue = sliderMin;
						newWidget.maxValue = sliderMax;
						newWidget.orientation = orientation;
						newWidget.knobCell = knobCell;
						newWidget.knobGeometry = knobGeometry;
						newWidget.sliderGeometry = sliderGeometry.clone();
						newWidget.sliderCenter = sliderCenter;
						newWidget.rotation = sliderRotation;
						newWidget.value = sliderMin;
					}

					if (type == 'booleanLed' || type == 'booleanSwitch')
					{
						var onColor = graph.getAttributeForCell(cell, 'onColor', '#d5e8d4');
						var offColor = graph.getAttributeForCell(cell, 'offColor', '#f5f5f5');
						newWidget.onColor = onColor;
						newWidget.offColor = offColor;
					}

					if (type == 'booleanSwitch')
					{
						newWidget.accessibleLabel = graph.getAttributeForCell(cell,
							'ariaLabel', newWidget.label || '');
						var switchKnobCell = null;

						for (var childIndex = 0; childIndex < model.getChildCount(cell); childIndex++)
						{
							var child = model.getChildAt(cell, childIndex);

							if (graph.getAttributeForCell(child, 'scadaSwitchPart', null) == 'knob')
							{
								if (switchKnobCell != null)
								{
									throw new Error('Switch "' + tag + '" has more than one knob');
								}

								switchKnobCell = child;
							}
						}

						if (switchKnobCell != null)
						{
							var switchGeometry = model.getGeometry(cell);
							var switchKnobGeometry = model.getGeometry(switchKnobCell);
							var switchRotation = Number(graph.getCellStyle(cell)[
								mxConstants.STYLE_ROTATION] || 0);

							if (switchGeometry == null || !isFinite(switchGeometry.width) ||
								!isFinite(switchGeometry.height) || switchGeometry.width <= 0 ||
								switchGeometry.height <= 0 || switchKnobGeometry == null ||
								!isFinite(switchKnobGeometry.width) ||
								!isFinite(switchKnobGeometry.height) ||
								switchKnobGeometry.width <= 0 || switchKnobGeometry.height <= 0 ||
								!isFinite(switchRotation))
							{
								throw new Error('Switch "' + tag + '" has invalid geometry or rotation');
							}

							var switchCenter = new mxPoint(switchGeometry.width / 2,
								switchGeometry.height / 2);
							switchKnobGeometry = switchKnobGeometry.clone();
							switchKnobGeometry.rotate(-switchRotation, switchCenter);
							newWidget.switchKnobCell = switchKnobCell;
							newWidget.switchKnobGeometry = switchKnobGeometry;
							newWidget.switchGeometry = switchGeometry.clone();
							newWidget.switchCenter = switchCenter;
							newWidget.switchRotation = switchRotation;
						}
					}

					if (type == 'booleanCheckbox')
					{
						newWidget.accessibleLabel = graph.getAttributeForCell(cell,
							'ariaLabel', newWidget.label || '');
						var checkboxTickCell = null;

						for (var childIndex = 0; childIndex < model.getChildCount(cell); childIndex++)
						{
							var child = model.getChildAt(cell, childIndex);

							if (graph.getAttributeForCell(child, 'scadaCheckboxPart', null) == 'tick')
							{
								if (checkboxTickCell != null)
								{
									throw new Error('Checkbox "' + tag + '" has more than one tick shape');
								}

								checkboxTickCell = child;
							}
						}

						if (checkboxTickCell == null)
						{
							throw new Error('Checkbox "' + tag + '" is missing its tick shape');
						}

						newWidget.checkboxTickCell = checkboxTickCell;
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
				updateStatus('Connected · wrote ' + widget.tag, false, true);
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

				var selectedIndex = -1;

				for (var i = 0; i < widget.options.length; i++)
				{
					if (widget.options[i].value === value)
					{
						selectedIndex = i;
						break;
					}
				}

				widget.select.value = (selectedIndex >= 0) ? String(selectedIndex) : '';

				if (widget.selectTextCell != null)
				{
					var displayLabel = (selectedIndex >= 0) ?
						widget.options[selectedIndex].label : 'Select...';

					if (widget.displayedOption != displayLabel)
					{
						graph.cellLabelChanged(widget.selectTextCell, displayLabel, false);
						widget.displayedOption = displayLabel;
					}

					var textState = graph.view.getState(widget.selectTextCell);

					if (textState != null)
					{
						if (textState.shape != null && textState.shape.node != null)
						{
							textState.shape.node.style.pointerEvents = 'none';
						}

						if (textState.text != null && textState.text.node != null)
						{
							textState.text.node.style.pointerEvents = 'none';
						}
					}
				}
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

			var updateBarGauge = function(widget, value)
			{
				if (typeof value != 'number' || !isFinite(value))
				{
					throw new Error('Bar gauge tag "' + widget.tag + '" must return a finite number');
				}

				widget.value = value;
				var ratio = Math.max(0,
					Math.min(1, (value - widget.minValue) / (widget.maxValue - widget.minValue)));
				var geometry = model.getGeometry(widget.fillCell);
				var fillGeometry = widget.fillGeometry.clone();
				fillGeometry.height = widget.fillGeometry.height * ratio;
				fillGeometry.y = widget.fillGeometry.y + widget.fillGeometry.height -
					fillGeometry.height;
				fillGeometry.rotate(widget.rotation, widget.gaugeCenter);

				if (geometry.x != fillGeometry.x || geometry.y != fillGeometry.y ||
					geometry.width != fillGeometry.width || geometry.height != fillGeometry.height)
				{
					model.setGeometry(widget.fillCell, fillGeometry);
				}
			};

			var updateSlider = function(widget, value)
			{
				if (typeof value != 'number' || !isFinite(value))
				{
					throw new Error('Slider tag "' + widget.tag + '" must return a finite number');
				}

				value = Math.max(widget.minValue, Math.min(widget.maxValue, value));
				var ratio = (value - widget.minValue) / (widget.maxValue - widget.minValue);
				var geometry = widget.knobGeometry.clone();

				if (widget.orientation == 'horizontal')
				{
					geometry.x = geometry.width / 2 +
						(widget.sliderGeometry.width - geometry.width) * ratio - geometry.width / 2;
					geometry.y = (widget.sliderGeometry.height - geometry.height) / 2;
				}
				else
				{
					geometry.x = (widget.sliderGeometry.width - geometry.width) / 2;
					geometry.y = widget.sliderGeometry.height - geometry.height / 2 -
						(widget.sliderGeometry.height - geometry.height) * ratio - geometry.height / 2;
				}

				geometry.rotate(widget.rotation, widget.sliderCenter);
				var currentGeometry = model.getGeometry(widget.knobCell);

				if (currentGeometry.x != geometry.x || currentGeometry.y != geometry.y ||
					currentGeometry.width != geometry.width ||
					currentGeometry.height != geometry.height)
				{
					model.setGeometry(widget.knobCell, geometry);
				}

				widget.value = value;

				if (widget.sliderNode != null)
				{
					var radians = mxUtils.toRadians(widget.rotation);
					var isVertical = (widget.orientation == 'vertical') ?
						Math.abs(Math.cos(radians)) > Math.abs(Math.sin(radians)) :
						Math.abs(Math.sin(radians)) > Math.abs(Math.cos(radians));
					widget.sliderNode.setAttribute('aria-orientation',
						isVertical ? 'vertical' : 'horizontal');
					widget.sliderNode.setAttribute('aria-valuenow', String(value));
					widget.sliderNode.style.cursor = isVertical ? 'ns-resize' : 'ew-resize';

					if (widget.sliderKnobNode != null)
					{
						widget.sliderKnobNode.style.cursor = widget.sliderNode.style.cursor;
					}
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
				var fillColor = (value === true) ? widget.onColor :
					(value === false) ? widget.offColor : '#fff2cc';
				graph.setCellStyles(mxConstants.STYLE_FILLCOLOR, fillColor, [widget.cell]);
			};

			var toggleBooleanCheckbox = function(widget, evt)
			{
				evt.preventDefault();
				evt.stopPropagation();

				if (typeof widget.value != 'boolean' || widget.writePending)
				{
					return;
				}

				var previousValue = widget.value;
				var nextValue = !previousValue;
				widget.writePending = true;
				updateBooleanCheckbox(widget, nextValue);

				writeTag(widget, nextValue).then(function()
				{
					widget.writePending = false;
					updateBooleanCheckbox(widget, nextValue);
				}).catch(function(error)
				{
					widget.writePending = false;
					updateBooleanCheckbox(widget, previousValue);
					console.error(error);
					updateStatus(error.message, true, false);
				});
			};

			var bindBooleanCheckboxTick = function(widget)
			{
				var tickState = graph.view.getState(widget.checkboxTickCell);

				if (tickState != null && tickState.shape != null && tickState.shape.node != null)
				{
					var tickNode = tickState.shape.node;
					tickNode.style.cursor =
						(typeof widget.value == 'boolean' && !widget.writePending) ?
							'pointer' : 'not-allowed';

					if (tickNode.getAttribute('data-scada-checkbox-tick') != 'true')
					{
						tickNode.setAttribute('data-scada-checkbox-tick', 'true');
						tickNode.addEventListener('pointerdown', function(evt)
						{
							evt.stopPropagation();
						});
						tickNode.addEventListener('mousedown', function(evt)
						{
							evt.stopPropagation();
						});
						tickNode.addEventListener('click', function(evt)
						{
							toggleBooleanCheckbox(widget, evt);
						});
					}
				}
			};

			var updateBooleanCheckbox = function(widget, value)
			{
				widget.value = value;
				var isBoolean = value === true || value === false;
				var checked = value === true;

				if (model.isVisible(widget.checkboxTickCell) != checked)
				{
					model.setVisible(widget.checkboxTickCell, checked);
				}

				bindBooleanCheckboxTick(widget);

				if (widget.checkboxNode != null)
				{
					var disabled = !isBoolean || !!widget.writePending;
					widget.checkboxNode.setAttribute('aria-checked',
						isBoolean ? String(value) : 'mixed');
					widget.checkboxNode.setAttribute('aria-disabled', String(disabled));
					widget.checkboxNode.style.cursor = disabled ? 'not-allowed' : 'pointer';
					widget.checkboxNode.style.opacity = isBoolean ? '1' : '0.55';
				}
			};

			var updateBooleanSwitch = function(widget, value)
			{
				widget.value = value;

				if (widget.switchKnobCell != null)
				{
					var isBoolean = value === true || value === false;
					var disabled = !isBoolean || !!widget.writePending;
					var trackColor = (value === true) ? widget.onColor :
						(value === false) ? widget.offColor : '#bdbdbd';

					if (graph.getCellStyle(widget.cell)[mxConstants.STYLE_FILLCOLOR] != trackColor)
					{
						graph.setCellStyles(mxConstants.STYLE_FILLCOLOR, trackColor, [widget.cell]);
					}

					if (isBoolean)
					{
						var geometry = widget.switchKnobGeometry.clone();
						var offX = widget.switchKnobGeometry.x;
						geometry.x = (value === true) ?
							widget.switchGeometry.width - geometry.width - offX : offX;
						geometry.y = (widget.switchGeometry.height - geometry.height) / 2;
						geometry.rotate(widget.switchRotation, widget.switchCenter);
						var currentGeometry = model.getGeometry(widget.switchKnobCell);

						if (currentGeometry.x != geometry.x || currentGeometry.y != geometry.y ||
							currentGeometry.width != geometry.width ||
							currentGeometry.height != geometry.height)
						{
							model.setGeometry(widget.switchKnobCell, geometry);
						}
					}

					if (widget.switchNode != null)
					{
						widget.switchNode.setAttribute('aria-checked',
							isBoolean ? String(value) : 'mixed');
						widget.switchNode.setAttribute('aria-disabled', String(disabled));
						widget.switchNode.style.cursor = disabled ? 'not-allowed' : 'pointer';
						widget.switchNode.style.pointerEvents = disabled ? 'none' : '';
						widget.switchNode.style.opacity = isBoolean ? '1' : '0.55';
					}

					if (widget.switchKnobNode != null)
					{
						widget.switchKnobNode.style.cursor = disabled ? 'not-allowed' : 'pointer';
						widget.switchKnobNode.style.pointerEvents = disabled ? 'none' : '';
						widget.switchKnobNode.style.opacity = isBoolean ? '1' : '0.55';
					}

					return;
				}

				if (widget.switchControl == null)
				{
					return;
				}

				isBoolean = value === true || value === false;
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

			var bindBooleanCheckboxHandlers = function(attempt)
			{
				var pending = false;

				for (var i = 0; i < widgets.length; i++)
				{
					if (widgets[i].type == 'booleanCheckbox')
					{
						var widget = widgets[i];
						var state = graph.view.getState(widget.cell);

						if (state != null && state.shape != null && state.shape.node != null)
						{
							var node = state.shape.node;

							if (node.getAttribute('data-scada-boolean-checkbox') != 'true')
							{
								(function(widget, node)
								{
									widget.checkboxNode = node;
									node.setAttribute('role', 'checkbox');
									node.setAttribute('tabindex', '0');
									node.setAttribute('aria-label',
										widget.accessibleLabel || widget.tag);
									node.setAttribute('data-scada-boolean-checkbox', 'true');

									var stopPropagation = function(evt)
									{
										evt.stopPropagation();
									};

									node.addEventListener('pointerdown', stopPropagation);
									node.addEventListener('mousedown', stopPropagation);
									node.addEventListener('click', function(evt)
									{
										toggleBooleanCheckbox(widget, evt);
									});
									node.addEventListener('keydown', function(evt)
									{
										if (evt.key == 'Enter' || evt.key == ' ')
										{
											if (!evt.repeat)
											{
												toggleBooleanCheckbox(widget, evt);
											}
											else
											{
												evt.preventDefault();
												evt.stopPropagation();
											}
										}
									});
									node.addEventListener('keyup', function(evt)
									{
										if (evt.key == 'Enter' || evt.key == ' ')
										{
											evt.preventDefault();
											evt.stopPropagation();
										}
									});

									updateBooleanCheckbox(widget, widget.value);
								})(widget, node);
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
							bindBooleanCheckboxHandlers(attempt + 1);
						}, 50);
					}
					else
					{
						updateStatus('Unable to initialize SCADA checkbox controls', true);
					}
				}
			};

			var bindBooleanSwitchHandlers = function(attempt)
			{
				var pending = false;

				for (var i = 0; i < widgets.length; i++)
				{
					if (widgets[i].type == 'booleanSwitch')
					{
						var widget = widgets[i];
						var state = graph.view.getState(widgets[i].cell);

						if (widget.switchKnobCell != null)
						{
							var knobState = graph.view.getState(widget.switchKnobCell);

							if (state != null && state.shape != null && state.shape.node != null &&
								knobState != null && knobState.shape != null &&
								knobState.shape.node != null)
							{
								var node = state.shape.node;
								var knobNode = knobState.shape.node;

								if (node.getAttribute('data-scada-boolean-switch') != 'true')
								{
									(function(widget, node, knobNode)
									{
										widget.switchNode = node;
										widget.switchKnobNode = knobNode;
										node.setAttribute('role', 'switch');
										node.setAttribute('tabindex', '0');
										node.setAttribute('aria-label',
											widget.accessibleLabel || widget.tag);
										node.setAttribute('data-scada-boolean-switch', 'true');
										knobNode.setAttribute('data-scada-switch-knob', 'true');

										var stopPropagation = function(evt)
										{
											evt.stopPropagation();
										};

										var toggleSwitch = function(evt)
										{
											evt.preventDefault();
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
												updateStatus(error.message, true, false);
											});
										};

										node.addEventListener('pointerdown', stopPropagation);
										knobNode.addEventListener('pointerdown', stopPropagation);
										node.addEventListener('mousedown', stopPropagation);
										knobNode.addEventListener('mousedown', stopPropagation);
										node.addEventListener('click', toggleSwitch);
										knobNode.addEventListener('click', toggleSwitch);
										node.addEventListener('keydown', function(evt)
										{
											if (evt.key == 'Enter' || evt.key == ' ')
											{
												if (!evt.repeat)
												{
													toggleSwitch(evt);
												}
												else
												{
													evt.preventDefault();
													evt.stopPropagation();
												}
											}
										});
										node.addEventListener('keyup', function(evt)
										{
											if (evt.key == 'Enter' || evt.key == ' ')
											{
												evt.preventDefault();
												evt.stopPropagation();
											}
										});

										updateBooleanSwitch(widget, widget.value);
									})(widget, node, knobNode);
								}
							}
							else
							{
								pending = true;
							}

							continue;
						}

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
									control.setAttribute('aria-label',
										widget.accessibleLabel || widget.label || widget.tag);
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
											updateStatus(error.message, true, false);
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
											updateStatus(error.message, true, false);
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
						var fieldState = (widgets[i].inputFieldCell != null) ?
							graph.view.getState(widgets[i].inputFieldCell) : null;

						if (state != null && state.shape != null && state.shape.node != null &&
							(widgets[i].inputFieldCell == null ||
								(fieldState != null && fieldState.shape != null &&
									fieldState.shape.node != null)))
						{
							var node = state.shape.node;
							var fieldNode = (fieldState != null && fieldState.shape != null) ?
								fieldState.shape.node : null;

							if (node.getAttribute('data-scada-input-value') != 'true')
							{
								(function(widget, node, labelNode, fieldNode, fieldLabelNode)
								{
									var overlayNode = (fieldNode != null) ? fieldNode : node;
									var bounds = overlayNode.getBBox();
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
										'padding:2px 6px;border:1px solid #b3b3b3;border-radius:10px;' +
										'background:#fff;color:#222;font:14px sans-serif;text-align:center;';
									foreignObject.appendChild(input);
									overlayNode.appendChild(foreignObject);
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
											updateStatus(error.message, true, false);
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
									overlayNode.style.cursor = 'text';
									node.setAttribute('data-scada-input-value', 'true');
									node.addEventListener('pointerdown', function(evt)
									{
										evt.stopPropagation();
									});

									if (labelNode != null)
									{
										labelNode.style.visibility = 'hidden';
									}

									if (fieldLabelNode != null)
									{
										fieldLabelNode.style.visibility = 'hidden';
									}
								})(widgets[i], node,
									(state.text != null && state.text.node != null) ?
										state.text.node : null,
									fieldNode,
									(fieldState != null && fieldState.text != null &&
										fieldState.text.node != null) ? fieldState.text.node : null);
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
						var textState = (widgets[i].selectTextCell != null) ?
							graph.view.getState(widgets[i].selectTextCell) : null;
						var arrowState = (widgets[i].selectArrowCell != null) ?
							graph.view.getState(widgets[i].selectArrowCell) : null;

						if (state != null && state.shape != null && state.shape.node != null &&
							(widgets[i].selectTextCell == null ||
								(textState != null && textState.shape != null &&
									textState.shape.node != null && arrowState != null &&
									arrowState.shape != null && arrowState.shape.node != null)))
						{
							var node = state.shape.node;
							var arrowNode = (arrowState != null && arrowState.shape != null) ?
								arrowState.shape.node : null;

							if (node.getAttribute('data-scada-select-value') != 'true')
							{
								(function(widget, node, labelNode, arrowNode)
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
									select.style.cssText = (widget.selectTextCell != null) ?
										'box-sizing:border-box;width:100%;height:100%;' +
										'padding:0;border:0;opacity:0;cursor:pointer;' :
										'box-sizing:border-box;width:100%;height:100%;' +
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
											updateStatus(error.message, true, false);
										});
									});
									node.style.cursor = 'pointer';
									node.setAttribute('data-scada-select-value', 'true');
									if (arrowNode != null)
									{
										arrowNode.style.pointerEvents = 'none';
									}

									node.addEventListener('pointerdown', function(evt)
									{
										evt.stopPropagation();
									});

									if (labelNode != null)
									{
										labelNode.style.visibility = 'hidden';
									}
								})(widgets[i], node,
									(state.text != null && state.text.node != null) ?
										state.text.node : null,
									arrowNode);
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

			var sliderValueFromEvent = function(widget, evt)
			{
				var trackShape = widget.sliderTrackShape;
				var ctm = trackShape.getScreenCTM();
				var svg = trackShape.ownerSVGElement;

				if (ctm == null || svg == null)
				{
					throw new Error('Unable to map slider pointer to diagram coordinates');
				}

				var point = svg.createSVGPoint();
				point.x = mxEvent.getClientX(evt);
				point.y = mxEvent.getClientY(evt);
				point = point.matrixTransform(ctm.inverse());

				var bounds = trackShape.getBBox();
				var horizontal = widget.orientation == 'horizontal';
				var axis = horizontal ? point.x : point.y;
				var boundsStart = horizontal ? bounds.x : bounds.y;
				var trackSize = horizontal ? bounds.width : bounds.height;
				var modelTrackSize = horizontal ?
					widget.sliderGeometry.width : widget.sliderGeometry.height;
				var modelKnobSize = horizontal ?
					widget.knobGeometry.width : widget.knobGeometry.height;
				var knobSize = trackSize * modelKnobSize / modelTrackSize;
				var travel = trackSize - knobSize;
				var ratio = (axis - boundsStart - knobSize / 2) / travel;

				if (!isFinite(ratio))
				{
					throw new Error('Slider "' + widget.tag + '" has invalid pointer geometry');
				}

				if (!horizontal)
				{
					ratio = 1 - ratio;
				}

				ratio = Math.max(0, Math.min(1, ratio));

				return widget.minValue + ratio * (widget.maxValue - widget.minValue);
			};

			var commitSlider = function(widget, previousValue)
			{
				if (widget.value === previousValue || widget.writePending)
				{
					return;
				}

				var value = widget.value;
				widget.writePending = true;

				writeTag(widget, value).then(function()
				{
					widget.writePending = false;
				}).catch(function(error)
				{
					widget.writePending = false;
					updateSlider(widget, previousValue);
					console.error(error);
					updateStatus(error.message, true, false);
				});
			};

			var bindSliderHandlers = function(attempt)
			{
				var pending = false;

				for (var i = 0; i < widgets.length; i++)
				{
					if (widgets[i].type == 'slider')
					{
						var state = graph.view.getState(widgets[i].cell);
						var knobState = graph.view.getState(widgets[i].knobCell);

						if (state != null && state.shape != null && state.shape.node != null &&
							knobState != null && knobState.shape != null &&
							knobState.shape.node != null)
						{
							var node = state.shape.node;
							var knobNode = knobState.shape.node;

							if (node.getAttribute('data-scada-slider') != 'true')
							{
								(function(widget, node, knobNode)
								{
									widget.sliderNode = node;
									widget.sliderKnobNode = knobNode;
									widget.sliderTrackShape = node.querySelector(
										'rect,ellipse,path,polygon,polyline,line') || node;
									node.style.cursor = 'ew-resize';
									knobNode.style.cursor = 'ew-resize';
									node.style.touchAction = 'none';
									knobNode.style.touchAction = 'none';
									node.style.userSelect = 'none';
									knobNode.style.userSelect = 'none';
									node.setAttribute('role', 'slider');
									node.setAttribute('tabindex', '0');
									node.setAttribute('aria-label', widget.label || widget.tag);
									node.setAttribute('aria-valuemin', String(widget.minValue));
									node.setAttribute('aria-valuemax', String(widget.maxValue));
									node.setAttribute('data-scada-slider', 'true');
									knobNode.setAttribute('data-scada-slider-knob', 'true');
									updateSlider(widget, widget.value);

									var stopPropagation = function(evt)
									{
										evt.stopPropagation();
									};

									var relevantKey = function(key)
									{
										return key == 'ArrowLeft' || key == 'ArrowDown' ||
											key == 'ArrowRight' || key == 'ArrowUp' ||
											key == 'Home' || key == 'End';
									};

									var setValueFromPointer = function(evt)
									{
										try
										{
											updateSlider(widget, sliderValueFromEvent(widget, evt));
										}
										catch (error)
										{
											widget.dragging = false;
											widget.pointerId = null;
											console.error(error);
											updateStatus(error.message, true);
										}
									};

									var finishKeyboardChange = function()
									{
										if (widget.keyboardChanging)
										{
											widget.keyboardChanging = false;
											commitSlider(widget, widget.keyboardPreviousValue);
										}
									};

									node.addEventListener('keydown', function(evt)
									{
										if (!relevantKey(evt.key) || widget.writePending ||
											widget.dragging)
										{
											return;
										}

										evt.preventDefault();
										evt.stopPropagation();

										if (!widget.keyboardChanging)
										{
											widget.keyboardPreviousValue = widget.value;
											widget.keyboardChanging = true;
										}

										var nextValue = widget.value;
										var step = (widget.maxValue - widget.minValue) / 100;

										if (evt.key == 'Home')
										{
											nextValue = widget.minValue;
										}
										else if (evt.key == 'End')
										{
											nextValue = widget.maxValue;
										}
										else if (evt.key == 'ArrowRight' || evt.key == 'ArrowUp')
										{
											nextValue += step;
										}
										else
										{
											nextValue -= step;
										}

										updateSlider(widget, nextValue);
									});

									node.addEventListener('keyup', function(evt)
									{
										if (relevantKey(evt.key))
										{
											evt.stopPropagation();
											finishKeyboardChange();
										}
									});
									node.addEventListener('blur', finishKeyboardChange);
									node.addEventListener('click', stopPropagation);
									var startDrag = function(evt)
									{
										if (evt.button != 0 || widget.writePending ||
											widget.dragging || widget.keyboardChanging)
										{
											return;
										}

										evt.preventDefault();
										evt.stopPropagation();
										widget.dragging = true;
										widget.pointerId = evt.pointerId;
										widget.dragPreviousValue = widget.value;
										setValueFromPointer(evt);
									};
									node.addEventListener('pointerdown', startDrag);
									knobNode.addEventListener('pointerdown', startDrag);
									knobNode.addEventListener('click', stopPropagation);

									document.addEventListener('pointermove', function(evt)
									{
										if (widget.dragging && widget.pointerId == evt.pointerId)
										{
											evt.preventDefault();
											evt.stopPropagation();
											setValueFromPointer(evt);
										}
									}, true);

									var endDrag = function(evt, cancelled)
									{
										if (!widget.dragging || widget.pointerId != evt.pointerId)
										{
											return;
										}

										evt.preventDefault();
										evt.stopPropagation();
										widget.dragging = false;
										widget.pointerId = null;

										if (cancelled)
										{
											updateSlider(widget, widget.dragPreviousValue);
										}
										else
										{
											commitSlider(widget, widget.dragPreviousValue);
										}
									};

									document.addEventListener('pointerup', function(evt)
									{
										endDrag(evt, false);
									}, true);
									document.addEventListener('pointercancel', function(evt)
									{
										endDrag(evt, true);
									}, true);
								})(widgets[i], node, knobNode);
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
							bindSliderHandlers(attempt + 1);
						}, 50);
					}
					else
					{
						updateStatus('Unable to initialize SCADA slider controls', true);
					}
				}
			};

			window.setTimeout(function()
			{
				bindButtonHandlers(0);
				bindInputValueHandlers(0);
				bindSelectValueHandlers(0);
				bindBooleanCheckboxHandlers(0);
				bindBooleanSwitchHandlers(0);
				bindSliderHandlers(0);
			}, 0);

			var tagList = Object.keys(tags);

			if (tagList.length == 0 && diagnosticsWidgets.length == 0)
			{
				updateStatus('SCADA runtime ready · no bound variables', false, false);
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
						else if (widget.type == 'slider' && !widget.dragging &&
							!widget.keyboardChanging && !widget.writePending &&
							Object.prototype.hasOwnProperty.call(result.values, widget.tag))
						{
							updateSlider(widget, result.values[widget.tag]);
						}
						else if (widget.type == 'barGauge' &&
							Object.prototype.hasOwnProperty.call(result.values, widget.tag))
						{
							updateBarGauge(widget, result.values[widget.tag]);
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
						else if (widget.type == 'booleanCheckbox' && !widget.writePending &&
							Object.prototype.hasOwnProperty.call(result.values, widget.tag))
						{
							updateBooleanCheckbox(widget, result.values[widget.tag]);
						}
					}

					updateConnection(true);
				}
				catch (error)
				{
					console.error(error);
					updateStatus(error.message, true, false);
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
			updateStatus(error.message, true, false);
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
