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
			createWidget('button', 'Write', 130, 50,
				'rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;',
				{tag: 'process.temperature', writeValue: '20'}),
			createWidget('display', 'Value', 150, 55,
				'rounded=0;whiteSpace=wrap;html=1;fillColor=#ffffff;strokeColor=#666666;',
				{tag: 'process.temperature', units: '', precision: '1'}),
			createWidget('indicator', 'Status', 130, 50,
				'rounded=1;whiteSpace=wrap;html=1;fillColor=#f5f5f5;strokeColor=#666666;',
				{tag: 'process.running'}),
			createWidget('valueEditor', 'Setpoint', 150, 50,
				'rounded=1;whiteSpace=wrap;html=1;fillColor=#ffffff;strokeColor=#6c8ebf;',
				{tag: 'process.temperature', units: '', precision: '1'})
		]);
		this.setCurrentSearchEntryLibrary();
	};
})();
