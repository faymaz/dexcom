'use strict';

import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Cairo from 'gi://cairo';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';

export const GraphDialog = GObject.registerClass(
class GraphDialog extends ModalDialog.ModalDialog {
    _init(settings, readings) {
        super._init({ styleClass: 'dexcom-graph-dialog' });

        this._settings = settings;
        this._readings = readings || [];

        this._log = (message, data = null) => {
            if (this._settings.get_boolean('enable-debug-logs')) {
                if (data) {
                    console.log(`[GraphDialog] ${message}`, data);
                } else {
                    console.log(`[GraphDialog] ${message}`);
                }
            }
        };

        this._log('Creating graph dialog with readings:', this._readings.length);

        this._buildDialog();
    }

    _buildDialog() {
       
        const contentBox = new St.BoxLayout({
            style_class: 'dexcom-graph-content',
            vertical: true,
            x_expand: true,
            y_expand: true
        });

       
        const titleBox = new St.BoxLayout({
            vertical: true,
            x_align: Clutter.ActorAlign.CENTER,
            style: 'margin-bottom: 20px;'
        });

       
        if (this._readings.length > 0) {
            const latestReading = this._readings[this._readings.length - 1];
            const unit = this._settings.get_string('unit');
            const isMmol = unit === 'mmol/L';
            let displayValue = parseFloat(latestReading.value);

            if (isMmol) {
                displayValue = displayValue / 18.0;
            }

            const currentValueLabel = new St.Label({
                text: `${displayValue.toFixed(isMmol ? 1 : 0)} ${unit}`,
                style: 'font-size: 48px; font-weight: bold; color: #fff; margin-bottom: 5px;'
            });
            titleBox.add_child(currentValueLabel);
        }

       
        const title = new St.Label({
            text: 'Glucose History (24 Hours)',
            style_class: 'dexcom-graph-title',
            style: 'font-size: 16px; color: #aaa;'
        });
        titleBox.add_child(title);

        contentBox.add_child(titleBox);

       
        const width = 800;
        const height = 400;

       
        const canvas = new St.DrawingArea({
            style_class: 'dexcom-graph-canvas',
            style: 'background-color: #1e1e1e; border-radius: 8px; border: 1px solid #3e3e3e;'
        });
        canvas.set_width(width);
        canvas.set_height(height);

       
        const drawCallback = (area) => {
            const cr = area.get_context();
            const [w, h] = area.get_surface_size();
            this._drawGraph(cr, w, h);
            cr.$dispose();
            return false;
        };

        canvas.connect('repaint', drawCallback);
        contentBox.add_child(canvas);

       
        this._canvas = canvas;

       
        const statsBox = this._createStatsBox();
        contentBox.add_child(statsBox);

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

    open() {
        super.open();
       
        if (this._canvas) {
            GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                this._canvas.queue_repaint();
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    _createStatsBox() {
        const statsBox = new St.BoxLayout({
            style_class: 'dexcom-graph-stats',
            style: 'margin-top: 20px; spacing: 20px;',
            x_align: Clutter.ActorAlign.CENTER
        });

        if (this._readings.length === 0) {
            const noDataLabel = new St.Label({
                text: 'No data available',
                style: 'font-size: 14px; color: #888;'
            });
            statsBox.add_child(noDataLabel);
            return statsBox;
        }

       
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
                style: 'font-size: 16px; font-weight: bold; margin-top: 4px;'
            });

            statBox.add_child(label);
            statBox.add_child(value);
            statsBox.add_child(statBox);
        });

        return statsBox;
    }

    _drawGraph(cr, areaWidth, areaHeight) {
        console.log('[GraphDialog] _drawGraph called');
        console.log('[GraphDialog] Size:', areaWidth, 'x', areaHeight);

        this._log('Drawing graph', { width: areaWidth, height: areaHeight, readings: this._readings.length });

       
        cr.setSourceRGBA(0.12, 0.12, 0.12, 1.0);
        cr.rectangle(0, 0, areaWidth, areaHeight);
        cr.fill();
        console.log('[GraphDialog] Background drawn');

       
        cr.setSourceRGBA(1.0, 1.0, 1.0, 1.0);
        cr.setLineWidth(3);
        cr.moveTo(50, 50);
        cr.lineTo(areaWidth - 50, areaHeight - 50);
        cr.stroke();
        console.log('[GraphDialog] Test line drawn');

       
        cr.setSourceRGBA(1.0, 0.0, 0.0, 1.0);
        cr.arc(areaWidth / 2, areaHeight / 2, 50, 0, 2 * Math.PI);
        cr.fill();
        console.log('[GraphDialog] Test circle drawn');

        if (this._readings.length === 0) {
           
            cr.setSourceRGBA(0.5, 0.5, 0.5, 1.0);
            cr.selectFontFace('Sans', Cairo.FontSlant.NORMAL, Cairo.FontWeight.NORMAL);
            cr.setFontSize(16);
            cr.moveTo(areaWidth / 2 - 50, areaHeight / 2);
            cr.showText('No data available');
            return true;
        }

       
        const padding = {
            left: 60,
            right: 40,
            top: 40,
            bottom: 60
        };

        const graphWidth = areaWidth - padding.left - padding.right;
        const graphHeight = areaHeight - padding.top - padding.bottom;

       
        const values = this._readings.map(r => parseFloat(r.value));
        const maxValue = Math.max(...values);
        const minValue = Math.min(...values);
        const valueRange = maxValue - minValue;
        const yPadding = valueRange * 0.1;

       
        const unit = this._settings.get_string('unit');
        const isMmol = unit === 'mmol/L';

        const thresholds = {
            urgentHigh: this._settings.get_int('urgent-high-threshold'),
            high: this._settings.get_int('high-threshold'),
            low: this._settings.get_int('low-threshold'),
            urgentLow: this._settings.get_int('urgent-low-threshold')
        };

       
        if (isMmol) {
            Object.keys(thresholds).forEach(key => {
                thresholds[key] = thresholds[key] / 18.0;
            });
        }

       
        const colors = {
            urgentHigh: this._hexToRgb(this._settings.get_string('urgent-high-color')),
            high: this._hexToRgb(this._settings.get_string('high-color')),
            normal: this._hexToRgb(this._settings.get_string('normal-color')),
            low: this._hexToRgb(this._settings.get_string('low-color')),
            urgentLow: this._hexToRgb(this._settings.get_string('urgent-low-color'))
        };

       
        this._drawColoredRanges(cr, padding, graphWidth, graphHeight,
            minValue - yPadding, maxValue + yPadding, thresholds, colors);

       
        this._drawGrid(cr, padding, graphWidth, graphHeight,
            minValue - yPadding, maxValue + yPadding, unit);

       
        this._drawDataLine(cr, padding, graphWidth, graphHeight,
            minValue - yPadding, maxValue + yPadding, values, colors, thresholds);

        console.log('[GraphDialog] Graph drawing complete');
        return true;
    }

    _drawColoredRanges(cr, padding, width, height, minValue, maxValue, thresholds, colors) {
        const valueToY = (value) => {
            const ratio = (value - minValue) / (maxValue - minValue);
            return padding.top + height - (ratio * height);
        };

        const ranges = [
            { min: thresholds.urgentHigh, max: maxValue, color: colors.urgentHigh, alpha: 0.15 },
            { min: thresholds.high, max: thresholds.urgentHigh, color: colors.high, alpha: 0.15 },
            { min: thresholds.low, max: thresholds.high, color: colors.normal, alpha: 0.15 },
            { min: thresholds.urgentLow, max: thresholds.low, color: colors.low, alpha: 0.15 },
            { min: minValue, max: thresholds.urgentLow, color: colors.urgentLow, alpha: 0.15 }
        ];

        ranges.forEach(range => {
            const y1 = valueToY(range.max);
            const y2 = valueToY(range.min);

            cr.setSourceRGBA(range.color.r, range.color.g, range.color.b, range.alpha);
            cr.rectangle(padding.left, y1, width, y2 - y1);
            cr.fill();
        });
    }

    _drawGrid(cr, padding, width, height, minValue, maxValue, unit) {
       
        const isMmol = unit === 'mmol/L';
        const gridValues = isMmol
            ? [2.8, 5.6, 8.3, 11.1, 13.9, 16.7, 19.4]
            : [50, 100, 150, 200, 250, 300, 350];    

        cr.setSourceRGBA(0.3, 0.3, 0.3, 0.5);
        cr.setLineWidth(1);

       
        gridValues.forEach(value => {
            if (value >= minValue && value <= maxValue) {
                const ratio = (value - minValue) / (maxValue - minValue);
                const y = padding.top + height - (ratio * height);

               
                cr.moveTo(padding.left, y);
                cr.lineTo(padding.left + width, y);
                cr.stroke();

               
                cr.setSourceRGBA(0.7, 0.7, 0.7, 1.0);
                cr.selectFontFace('Sans', Cairo.FontSlant.NORMAL, Cairo.FontWeight.NORMAL);
                cr.setFontSize(11);

                const text = isMmol ? value.toFixed(1) : value.toFixed(0);
                const extents = cr.textExtents(text);
                cr.moveTo(padding.left - extents.width - 10, y + 4);
                cr.showText(text);
            }
        });

       
        cr.save();
        cr.setSourceRGBA(0.8, 0.8, 0.8, 1.0);
        cr.setFontSize(12);
        cr.moveTo(10, padding.top + height / 2);
        cr.rotate(-Math.PI / 2);
        cr.showText(`Glucose (${unit})`);
        cr.restore();

       
        const numXLines = 6;
        const now = Date.now();

        cr.setSourceRGBA(0.3, 0.3, 0.3, 0.5);
        for (let i = 0; i <= numXLines; i++) {
            const x = padding.left + (i / numXLines) * width;

           
            cr.moveTo(x, padding.top);
            cr.lineTo(x, padding.top + height);
            cr.stroke();

           
            const hoursAgo = 24 - (i / numXLines) * 24;
            const timeText = `${Math.round(hoursAgo)}h ago`;

            cr.setSourceRGBA(0.7, 0.7, 0.7, 1.0);
            cr.setFontSize(11);
            const extents = cr.textExtents(timeText);
            cr.moveTo(x - extents.width / 2, padding.top + height + 20);
            cr.showText(timeText);
        }
    }

    _drawDataLine(cr, padding, width, height, minValue, maxValue, values, colors, thresholds) {
        if (values.length === 0) return;

        const valueToY = (value) => {
            const ratio = (value - minValue) / (maxValue - minValue);
            return padding.top + height - (ratio * height);
        };

        const getColorForValue = (value) => {
            if (value >= thresholds.urgentHigh) return colors.urgentHigh;
            if (value >= thresholds.high) return colors.high;
            if (value > thresholds.low) return colors.normal;
            if (value > thresholds.urgentLow) return colors.low;
            return colors.urgentLow;
        };

       
        cr.setAntialias(Cairo.Antialias.BEST);
        cr.setLineWidth(2.5);
        cr.setLineCap(Cairo.LineCap.ROUND);
        cr.setLineJoin(Cairo.LineJoin.ROUND);

       
        for (let i = 0; i < values.length - 1; i++) {
            const x1 = padding.left + (i / (values.length - 1)) * width;
            const y1 = valueToY(values[i]);
            const x2 = padding.left + ((i + 1) / (values.length - 1)) * width;
            const y2 = valueToY(values[i + 1]);

           
            const avgValue = (values[i] + values[i + 1]) / 2;
            const color = getColorForValue(avgValue);

            cr.setSourceRGBA(color.r, color.g, color.b, 1.0);
            cr.moveTo(x1, y1);
            cr.lineTo(x2, y2);
            cr.stroke();
        }

       
        if (values.length > 0) {
            const lastIndex = values.length - 1;
            const x = padding.left + (lastIndex / (values.length - 1)) * width;
            const y = valueToY(values[lastIndex]);
            const color = getColorForValue(values[lastIndex]);

           
            cr.setSourceRGBA(color.r, color.g, color.b, 1.0);
            cr.arc(x, y, 3.5, 0, 2 * Math.PI);
            cr.fill();

           
            cr.setSourceRGBA(0.12, 0.12, 0.12, 1.0);
            cr.arc(x, y, 1.5, 0, 2 * Math.PI);
            cr.fill();
        }
    }

    _hexToRgb(hex) {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? {
            r: parseInt(result[1], 16) / 255,
            g: parseInt(result[2], 16) / 255,
            b: parseInt(result[3], 16) / 255
        } : { r: 1, g: 1, b: 1 };
    }
});
