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
			createWidget('booleanSwitch', 'Switch', 80, 44,
				'rounded=1;whiteSpace=wrap;html=1;fillColor=#f5f5f5;strokeColor=#666666;',
				{tag: 'process.running', onColor: '#4caf50', offColor: '#9e9e9e'}),
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
					'shape=rect;container=1;collapsible=0;recursiveResize=1;' +
					'fillColor=#f5f5f5;strokeColor=#666666;strokeWidth=2;html=1;whiteSpace=wrap;');
				gauge.vertex = true;

				var fillValue = xmlDoc.createElement('object');
				fillValue.setAttribute('label', '');
				fillValue.setAttribute('scadaGaugePart', 'fill');
				var fill = new mxCell(fillValue, new mxGeometry(8, 8, 64, 184),
					'shape=rect;fillColor=#4caf50;strokeColor=none;html=1;whiteSpace=wrap;');
				fill.vertex = true;
				gauge.insert(fill);

				return this.createVertexTemplateFromCells([gauge], 80, 200, 'Bar gauge');
			}))
		]);
		this.setCurrentSearchEntryLibrary();
	};
})();
