'use strict';

import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';

export const SimpleGraphDialog = GObject.registerClass(
class SimpleGraphDialog extends ModalDialog.ModalDialog {
    _init(settings, readings) {
        super._init({ styleClass: 'dexcom-graph-dialog' });

        this._settings = settings;
        this._readings = readings || [];

        this._buildDialog();
    }

    _buildDialog() {
        const contentBox = new St.BoxLayout({
            style_class: 'dexcom-graph-content',
            vertical: true,
            x_expand: true,
            y_expand: true,
            style: 'padding: 20px;'
        });

       
        const title = new St.Label({
            text: 'Glucose History (24 Hours)',
            style: 'font-size: 18px; font-weight: bold; margin-bottom: 20px; color: #fff;'
        });
        contentBox.add_child(title);

        if (this._readings.length === 0) {
            const noDataLabel = new St.Label({
                text: 'No data available',
                style: 'font-size: 14px; color: #888; margin: 50px;'
            });
            contentBox.add_child(noDataLabel);
        } else {
           
            const graphWidget = this._createSimpleGraph();
            contentBox.add_child(graphWidget);

           
            const statsBox = this._createStatsBox();
            contentBox.add_child(statsBox);
        }

        this.contentLayout.add_child(contentBox);

       
        this.setButtons([
            {
                label: 'Close',
                action: () => {
                    this.close();
                },
                key: Clutter.KEY_Escape
            }
        ]);
    }

    _createSimpleGraph() {
        const graphBox = new St.BoxLayout({
            vertical: true,
            style: 'background-color: #2a2a2a; border-radius: 8px; padding: 30px; margin-bottom: 20px; min-width: 900px;'
        });

       
        const values = this._readings.map(r => parseFloat(r.value));
        const dataMax = Math.max(...values);
        const dataMin = Math.min(...values);
        const dataRange = dataMax - dataMin;

       
        const maxValue = dataMax + (dataRange * 0.1);
        const minValue = Math.max(0, dataMin - (dataRange * 0.1));

       
        const unit = this._settings.get_string('unit');
        const isMmol = unit === 'mmol/L';

        let urgentHigh = this._settings.get_int('urgent-high-threshold');
        let high = this._settings.get_int('high-threshold');
        let low = this._settings.get_int('low-threshold');
        let urgentLow = this._settings.get_int('urgent-low-threshold');

        if (isMmol) {
            urgentHigh = urgentHigh / 18.0;
            high = high / 18.0;
            low = low / 18.0;
            urgentLow = urgentLow / 18.0;
        }

       
        const urgentHighColor = this._settings.get_string('urgent-high-color');
        const highColor = this._settings.get_string('high-color');
        const normalColor = this._settings.get_string('normal-color');
        const lowColor = this._settings.get_string('low-color');
        const urgentLowColor = this._settings.get_string('urgent-low-color');

       
        const maxPoints = 40;
        const step = Math.max(1, Math.floor(this._readings.length / maxPoints));
        const sampledReadings = this._readings.filter((_, i) => i % step === 0);

       
        const chartHeight = 20;

       
        const range = maxValue - minValue;
        const valuePerRow = range / chartHeight;

       
        const getColorForValue = (val) => {
            if (val >= urgentHigh) return urgentHighColor;
            if (val >= high) return highColor;
            if (val > low) return normalColor;
            if (val > urgentLow) return lowColor;
            return urgentLowColor;
        };

       
        for (let row = chartHeight; row >= 0; row--) {
            const rowValue = minValue + (row * valuePerRow);
            const rowBox = new St.BoxLayout({
                style: 'spacing: 4px;'
            });

           
            const yLabel = new St.Label({
                text: rowValue.toFixed(0).padStart(4, ' '),
                style: 'font-family: monospace; font-size: 11px; color: #aaa; width: 50px;'
            });
            rowBox.add_child(yLabel);

           
            let thresholdLine = null;
            let thresholdColor = '#555';
            const epsilon = valuePerRow / 2;

            if (Math.abs(rowValue - urgentHigh) < epsilon) {
                thresholdLine = urgentHighColor;
            } else if (Math.abs(rowValue - high) < epsilon) {
                thresholdLine = highColor;
            } else if (Math.abs(rowValue - low) < epsilon) {
                thresholdLine = lowColor;
            } else if (Math.abs(rowValue - urgentLow) < epsilon) {
                thresholdLine = urgentLowColor;
            }

           
            const dataBox = new St.BoxLayout({
                style: 'spacing: 0px;'
            });

           
            sampledReadings.forEach((reading, colIndex) => {
                const val = parseFloat(reading.value);
                const color = getColorForValue(val);

               
                const diff = Math.abs(val - rowValue);

               
                if (diff < (valuePerRow * 0.7)) {
                   
                    const point = new St.Label({
                        text: '●',
                        style: `font-size: 14px; color: ${color}; width: 18px; text-align: center;`
                    });
                    dataBox.add_child(point);
                } else if (thresholdLine) {
                   
                    const line = new St.Label({
                        text: '─',
                        style: `font-size: 11px; color: ${thresholdLine}; width: 18px; text-align: center; opacity: 0.4;`
                    });
                    dataBox.add_child(line);
                } else {
                   
                    const space = new St.Label({
                        text: ' ',
                        style: 'width: 18px;'
                    });
                    dataBox.add_child(space);
                }
            });

            rowBox.add_child(dataBox);
            graphBox.add_child(rowBox);
        }

       
        const xAxisBox = new St.BoxLayout({
            style: 'margin-top: 15px; spacing: 4px;'
        });

        const xLabel = new St.Label({
            text: '     ',
            style: 'font-family: monospace; font-size: 11px; width: 50px;'
        });
        xAxisBox.add_child(xLabel);

       
        const now = new Date();
        const oldest = this._readings.length > 0 ? this._readings[0].timestamp : now;

        const timeLabel = new St.Label({
            text: '← 24 hours ago                                           Now →',
            style: 'font-family: monospace; font-size: 11px; color: #888; letter-spacing: 1px;'
        });
        xAxisBox.add_child(timeLabel);

        graphBox.add_child(xAxisBox);

        return graphBox;
    }

    _createStatsBox() {
        const statsBox = new St.BoxLayout({
            style: 'spacing: 20px; margin-top: 10px;',
            x_align: Clutter.ActorAlign.CENTER
        });

        const values = this._readings.map(r => parseFloat(r.value));
        const avg = (values.reduce((a, b) => a + b, 0) / values.length).toFixed(1);
        const max = Math.max(...values).toFixed(1);
        const min = Math.min(...values).toFixed(1);
        const unit = this._settings.get_string('unit');

        const stats = [
            { label: 'Average', value: `${avg} ${unit}` },
            { label: 'Maximum', value: `${max} ${unit}` },
            { label: 'Minimum', value: `${min} ${unit}` },
            { label: 'Readings', value: String(this._readings.length) }
        ];

        stats.forEach(stat => {
            const statBox = new St.BoxLayout({
                vertical: true,
                style: 'padding: 10px; background-color: rgba(255,255,255,0.05); border-radius: 6px;'
            });

            const label = new St.Label({
                text: stat.label,
                style: 'font-size: 12px; color: #888;'
            });

            const value = new St.Label({
                text: stat.value,
                style: 'font-size: 16px; font-weight: bold; margin-top: 4px; color: #fff;'
            });

            statBox.add_child(label);
            statBox.add_child(value);
            statsBox.add_child(statBox);
        });

        return statsBox;
    }
});
