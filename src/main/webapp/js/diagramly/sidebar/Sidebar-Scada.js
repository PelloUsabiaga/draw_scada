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
				'rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;',
				{tag: 'process.temperature', writeValue: '20'}),
			createWidget('outputValue', 'Output value', 150, 55,
				'rounded=0;whiteSpace=wrap;html=1;fillColor=#ffffff;strokeColor=#666666;',
				{tag: 'process.temperature', units: '', precision: '1'}),
			createWidget('booleanLed', 'Boolean LED', 130, 50,
				'rounded=1;whiteSpace=wrap;html=1;fillColor=#f5f5f5;strokeColor=#666666;',
				{tag: 'process.running', onColor: '#85ee80', offColor: '#f09898'}),
			createWidget('inputValue', 'Input value', 150, 50,
				'rounded=1;whiteSpace=wrap;html=1;fillColor=#ffffff;strokeColor=#6c8ebf;',
				{tag: 'process.temperature', units: '', precision: '1'}),
			createWidget('selectValue', 'Select value', 160, 50,
				'rounded=1;whiteSpace=wrap;html=1;fillColor=#ffffff;strokeColor=#6c8ebf;',
				{tag: 'process.running',
					options: '[{"label":"Off","value":false},{"label":"On","value":true}]'}),
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
