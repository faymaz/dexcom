'use strict';
import GObject from 'gi://GObject';
import St from 'gi://St';
import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import { DexcomClient } from '@faymaz/jsdexcom';

const DexcomIndicator = GObject.registerClass(
class DexcomIndicator extends PanelMenu.Button {
    _init(settings) {
        super._init(0.0, 'Dexcom Indicator');
        this._settings = settings;

        // Create UI elements
        this.buttonText = new St.Label({
            text: '---',
            y_align: St.Align.CENTER
        });
        this.add_child(this.buttonText);

        // Add menu items
        this._buildMenu();

        // Initialize DexcomClient
        this._dexcomClient = new DexcomClient();
        
        // Start monitoring
        this._startMonitoring();
    }

    _buildMenu() {
        // Add menu items for showing/hiding elements
        this._addToggleMenuItem('Show Delta', 'show-delta');
        this._addToggleMenuItem('Show Trend Arrows', 'show-trend-arrows');
        this._addToggleMenuItem('Show Elapsed Time', 'show-elapsed-time');
    }

    _addToggleMenuItem(label, settingKey) {
        let toggleItem = new PopupMenu.PopupSwitchMenuItem(label, 
            this._settings.get_boolean(settingKey));
        toggleItem.connect('toggled', (item) => {
            this._settings.set_boolean(settingKey, item.state);
            this._updateDisplay();
        });
        this.menu.addMenuItem(toggleItem);
    }

    _startMonitoring() {
        this._updateReading();
        this._timeout = setInterval(() => {
            this._updateReading();
        }, 300000); // Update every 5 minutes
    }

    async _updateReading() {
        try {
            const reading = await this._dexcomClient.getLatestReading();
            this._updateDisplay(reading);
        } catch (error) {
            console.error('Error fetching Dexcom reading:', error);
            this.buttonText.text = 'Error';
        }
    }

    _getColorForValue(value) {
        const urgentHigh = this._settings.get_int('urgent-high-threshold');
        const high = this._settings.get_int('high-threshold');
        const low = this._settings.get_int('low-threshold');
        const urgentLow = this._settings.get_int('urgent-low-threshold');
        
        const urgentHighColor = this._settings.get_string('urgent-high-color');
        const highColor = this._settings.get_string('high-color');
        const normalColor = this._settings.get_string('normal-color');
        const lowColor = this._settings.get_string('low-color');
        const urgentLowColor = this._settings.get_string('urgent-low-color');

        if (value >= urgentHigh) return urgentHighColor;
        if (value >= high) return highColor;
        if (value > low) return normalColor;
        if (value > urgentLow) return lowColor;
        return urgentLowColor;
    }

    _updateDisplay(reading) {
        if (!reading) {
            this.buttonText.text = '---';
            return;
        }

        let displayText = `${reading.value}`;
        
        if (this._settings.get_boolean('show-trend-arrows')) {
            displayText += ` ${this._getTrendArrow(reading.trend)}`;
        }
        
        if (this._settings.get_boolean('show-delta')) {
            displayText += ` (${reading.delta > 0 ? '+' : ''}${reading.delta})`;
        }
        
        if (this._settings.get_boolean('show-elapsed-time')) {
            const elapsed = Math.floor((Date.now() - reading.timestamp) / 60000);
            displayText += ` ${elapsed}m`;
        }

        this.buttonText.text = displayText;
        this.buttonText.style = `color: ${this._getColorForValue(reading.value)};`;
    }

    _getTrendArrow(trend) {
        const arrows = {
            NONE: '→',
            DOUBLE_UP: '⇈',
            SINGLE_UP: '↑',
            FORTY_FIVE_UP: '↗',
            FLAT: '→',
            FORTY_FIVE_DOWN: '↘',
            SINGLE_DOWN: '↓',
            DOUBLE_DOWN: '⇊',
            NOT_COMPUTABLE: '-',
            RATE_OUT_OF_RANGE: '?'
        };
        return arrows[trend] || arrows.NONE;
    }

    destroy() {
        if (this._timeout) {
            clearInterval(this._timeout);
        }
        super.destroy();
    }
});

export default class DexcomExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._indicator = new DexcomIndicator(this._settings);
        Main.panel.addToStatusArea('dexcom-indicator', this._indicator);
    }

    disable() {
        this._indicator.destroy();
        this._indicator = null;
    }
}