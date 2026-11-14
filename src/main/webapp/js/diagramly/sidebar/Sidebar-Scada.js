/**
 * Copyright (c) 2026, SCADA fork contributors
 */
(function()
{
	Sidebar.prototype.addScadaPalette = function()
	{
		var createWidget = mxUtils.bind(this, function(type, label, width, height, style, attributes)
		{
			return this.addEntry('scada ' + type + ' ' + label, mxUtils.bind(this, function()
			{
				var value = mxUtils.createXmlDocument().createElement('object');
				value.setAttribute('label', label);
				value.setAttribute('scadaType', type);

				for (var key in attributes)
				{
					value.setAttribute(key, attributes[key]);
				}

				var cell = new mxCell(value, new mxGeometry(0, 0, width, height), style);
				cell.vertex = true;

				return this.createVertexTemplateFromCells([cell], width, height, label);
			}));
		});

		this.setCurrentSearchEntryLibrary('scada', 'scadaWidgets');
		this.addPaletteFunctions('scadaWidgets', 'SCADA / Widgets', false,
		[
			createWidget('button', 'Button', 130, 50,
				'rounded=1;arcSize=50;whiteSpace=wrap;html=1;' +
				'fillColor=#d9d9d9;strokeColor=#666666;',
				{tag: 'process.temperature', writeValue: '20'}),
			createWidget('outputValue', 'Output value', 150, 55,
				'rounded=0;whiteSpace=wrap;html=1;fillColor=#ffffff;strokeColor=#666666;',
				{tag: 'process.temperature', units: '', precision: '1'}),
			createWidget('booleanLed', 'Boolean LED', 36, 36,
				'shape=ellipse;noLabel=1;whiteSpace=wrap;html=1;' +
				'fillColor=#f5f5f5;strokeColor=#666666;',
				{label: '', tag: 'process.running', onColor: '#85ee80', offColor: '#f09898'}),
			this.addEntry('scada diagnostics status log', mxUtils.bind(this, function()
			{
				var xmlDoc = mxUtils.createXmlDocument();
				var value = xmlDoc.createElement('object');
				value.setAttribute('label', '');
				value.setAttribute('scadaType', 'diagnostics');
				value.setAttribute('onColor', '#85ee80');
				value.setAttribute('offColor', '#f09898');

				var diagnostics = new mxCell(value, new mxGeometry(0, 0, 280, 64),
					'shape=rect;rounded=1;arcSize=20;container=1;collapsible=0;' +
					'recursiveResize=1;fillColor=#f5f5f5;strokeColor=#666666;' +
					'strokeWidth=1;html=1;whiteSpace=wrap;');
				diagnostics.vertex = true;

				var ledValue = xmlDoc.createElement('object');
				ledValue.setAttribute('label', '');
				ledValue.setAttribute('scadaDiagnosticsPart', 'led');
				var led = new mxCell(ledValue, new mxGeometry(10, 20, 24, 24),
					'shape=ellipse;fillColor=#f09898;strokeColor=#666666;strokeWidth=1;');
				led.vertex = true;
				diagnostics.insert(led);

				var logValue = xmlDoc.createElement('object');
				logValue.setAttribute('label', 'Waiting for SCADA connection');
				logValue.setAttribute('scadaDiagnosticsPart', 'log');
				var log = new mxCell(logValue, new mxGeometry(44, 8, 228, 48),
					'shape=rect;rounded=1;whiteSpace=wrap;html=0;fillColor=#ffffff;' +
					'strokeColor=none;fontColor=#333333;align=left;verticalAlign=middle;' +
					'spacingLeft=8;fontSize=12;');
				log.vertex = true;
				diagnostics.insert(log);

				return this.createVertexTemplateFromCells([diagnostics], 280, 64, 'Diagnostics');
			})),
			this.addEntry('scada input value editable text', mxUtils.bind(this, function()
			{
				var xmlDoc = mxUtils.createXmlDocument();
				var value = xmlDoc.createElement('object');
				value.setAttribute('label', 'Input value');
				value.setAttribute('scadaType', 'inputValue');
				value.setAttribute('tag', 'process.temperature');
				value.setAttribute('units', '');
				value.setAttribute('precision', '1');

				var input = new mxCell(value, new mxGeometry(0, 0, 170, 54),
					'shape=rect;rounded=1;arcSize=20;container=1;collapsible=0;' +
					'recursiveResize=1;fillColor=#d9d9d9;strokeColor=#666666;' +
					'strokeWidth=1;html=1;whiteSpace=wrap;noLabel=1;');
				input.vertex = true;

				var fieldValue = xmlDoc.createElement('object');
				fieldValue.setAttribute('label', '');
				fieldValue.setAttribute('scadaInputPart', 'field');
				var field = new mxCell(fieldValue, new mxGeometry(8, 8, 154, 38),
					'shape=rect;rounded=1;arcSize=12;fillColor=#ffffff;' +
					'strokeColor=#b3b3b3;strokeWidth=1;html=1;whiteSpace=wrap;noLabel=1;');
				field.vertex = true;
				input.insert(field);

				return this.createVertexTemplateFromCells([input], 170, 54, 'Input value');
			})),
			this.addEntry('scada select value dropdown', mxUtils.bind(this, function()
			{
				var xmlDoc = mxUtils.createXmlDocument();
				var value = xmlDoc.createElement('object');
				value.setAttribute('label', 'Select value');
				value.setAttribute('scadaType', 'selectValue');
				value.setAttribute('tag', 'process.running');
				value.setAttribute('options',
					'[{"label":"Off","value":false},{"label":"On","value":true}]');

				var select = new mxCell(value, new mxGeometry(0, 0, 180, 48),
					'shape=rect;rounded=1;arcSize=12;container=1;collapsible=0;' +
					'recursiveResize=1;fillColor=#f5f5f5;strokeColor=#6c8ebf;' +
					'strokeWidth=1;html=1;whiteSpace=wrap;noLabel=1;');
				select.vertex = true;

				var textValue = xmlDoc.createElement('object');
				textValue.setAttribute('label', 'Select...');
				textValue.setAttribute('scadaSelectPart', 'text');
				var text = new mxCell(textValue, new mxGeometry(10, 4, 140, 40),
					'shape=rect;fillColor=none;strokeColor=none;html=0;pointerEvents=0;' +
					'whiteSpace=wrap;align=left;verticalAlign=middle;fontColor=#222222;');
				text.vertex = true;
				select.insert(text);

				var arrowValue = xmlDoc.createElement('object');
				arrowValue.setAttribute('label', '');
				arrowValue.setAttribute('scadaSelectPart', 'arrow');
				var arrow = new mxCell(arrowValue, new mxGeometry(158, 20, 10, 6),
					'shape=triangle;direction=south;fillColor=#666666;strokeColor=none;' +
					'noLabel=1;pointerEvents=0;');
				arrow.vertex = true;
				select.insert(arrow);

				return this.createVertexTemplateFromCells([select], 180, 48, 'Select value');
			})),
			this.addEntry('scada boolean switch', mxUtils.bind(this, function()
			{
				var xmlDoc = mxUtils.createXmlDocument();
				var value = xmlDoc.createElement('object');
				value.setAttribute('label', '');
				value.setAttribute('scadaType', 'booleanSwitch');
				value.setAttribute('tag', 'process.running');
				value.setAttribute('ariaLabel', 'process.running');
				value.setAttribute('onColor', '#4caf50');
				value.setAttribute('offColor', '#9e9e9e');

				var switchCell = new mxCell(value, new mxGeometry(0, 0, 80, 44),
					'shape=rect;rounded=1;arcSize=50;container=1;collapsible=0;' +
					'recursiveResize=1;fillColor=#9e9e9e;strokeColor=#666666;' +
					'strokeWidth=1;html=1;whiteSpace=wrap;');
				switchCell.vertex = true;

				var knobValue = xmlDoc.createElement('object');
				knobValue.setAttribute('label', '');
				knobValue.setAttribute('scadaSwitchPart', 'knob');
				var knob = new mxCell(knobValue, new mxGeometry(8, 8, 28, 28),
					'shape=ellipse;fillColor=#ffffff;strokeColor=#666666;strokeWidth=1;');
				knob.vertex = true;
				switchCell.insert(knob);

				return this.createVertexTemplateFromCells([switchCell], 80, 44, 'Switch');
			})),
			this.addEntry('bar gauge process value measurement', mxUtils.bind(this, function()
			{
				var xmlDoc = mxUtils.createXmlDocument();
				var value = xmlDoc.createElement('object');
				value.setAttribute('label', '');
				value.setAttribute('scadaType', 'barGauge');
				value.setAttribute('tag', 'process.temperature');
				value.setAttribute('min', '0');
				value.setAttribute('max', '100');

				var gauge = new mxCell(value, new mxGeometry(0, 0, 80, 200),
					'shape=rect;rounded=1;arcSize=20;container=1;collapsible=0;recursiveResize=1;' +
					'fillColor=#f5f5f5;strokeColor=#666666;strokeWidth=2;html=1;whiteSpace=wrap;');
				gauge.vertex = true;

				var fillValue = xmlDoc.createElement('object');
				fillValue.setAttribute('label', '');
				fillValue.setAttribute('scadaGaugePart', 'fill');
				var fill = new mxCell(fillValue, new mxGeometry(8, 8, 64, 184),
					'shape=rect;rounded=1;arcSize=20;fillColor=#4caf50;' +
					'strokeColor=none;html=1;whiteSpace=wrap;');
				fill.vertex = true;
				gauge.insert(fill);

				return this.createVertexTemplateFromCells([gauge], 80, 200, 'Bar gauge');
			})),
			this.addEntry('slider numeric value control', mxUtils.bind(this, function()
			{
				var xmlDoc = mxUtils.createXmlDocument();
				var value = xmlDoc.createElement('object');
				value.setAttribute('label', '');
				value.setAttribute('scadaType', 'slider');
				value.setAttribute('tag', 'process.temperature');
				value.setAttribute('min', '0');
				value.setAttribute('max', '100');
				value.setAttribute('orientation', 'horizontal');

				var slider = new mxCell(value, new mxGeometry(0, 0, 200, 44),
					'shape=rect;rounded=1;container=1;collapsible=0;recursiveResize=1;' +
					'fillColor=#e6e6e6;strokeColor=#666666;strokeWidth=1;html=1;whiteSpace=wrap;');
				slider.vertex = true;

				var knobValue = xmlDoc.createElement('object');
				knobValue.setAttribute('label', '');
				knobValue.setAttribute('scadaSliderPart', 'knob');
				var knob = new mxCell(knobValue, new mxGeometry(0, 4, 24, 36),
					'shape=rect;rounded=1;arcSize=50;fillColor=#4caf50;' +
					'strokeColor=#ffffff;strokeWidth=2;');
				knob.vertex = true;
				slider.insert(knob);

				return this.createVertexTemplateFromCells([slider], 200, 44, 'Slider');
			}))
		]);
		this.setCurrentSearchEntryLibrary();
	};
})();
