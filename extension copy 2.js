'use strict';
import GObject from 'gi://GObject';
import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import { DexcomClient } from './dexcomClient.js';

const DexcomIndicator = GObject.registerClass(
class DexcomIndicator extends PanelMenu.Button {
    _init(settings) {
        super._init(0.0, 'Dexcom Indicator');
        this._settings = settings;

        // Create container box
        this.box = new St.BoxLayout({
            style_class: 'panel-status-menu-box'
        });

        // this.icon = new St.Icon({
        //     style_class: 'dexcom-icon',
        //     icon_name: 'diabetes-symbolic', // default fallback icon
        //     gicon: Gio.icon_new_for_string(`${this.path}/icons/icon.svg`),
        //     icon_size: 16
        // });

        // Extension.js'de icon tanımlaması:
        // this.icon = new St.Icon({
        //     style_class: 'dexcom-icon',
        //     gicon: Gio.icon_new_for_string(`${this.path}/icons/icon.svg`),
        //     icon_size: 16
        // });

        // Add icon
        try {
            const iconPath = GLib.build_filenamev([extension.path, 'icons', 'icon.svg']);
            this.icon = new St.Icon({
                gicon: Gio.Icon.new_for_string(iconPath),
                style_class: 'system-status-icon dexcom-icon',
                icon_size: 20
            });
        } catch (error) {
            log(`[Dexcom] Failed to load icon: ${error}. Using fallback.`);
            this.icon = new St.Icon({
                icon_name: 'utilities-system-monitor-symbolic',
                style_class: 'system-status-icon',
                icon_size: 20
            });
        }

// icon_set_style satırını kaldır, bunun yerine stylesheet.css'deki tanımları kullan
        // Create label
        this.buttonText = new St.Label({
            text: '---',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'dexcom-label'
        });

        // Add elements based on settings
        this._loadIcon();
        this._updateIconVisibility();

        // Add the box to the button
        this.add_child(this.box);

        // Initialize DexcomClient with credentials
        this._dexcomClient = new DexcomClient(
            this._settings.get_string('username'),
            this._settings.get_string('password'),
            this._settings.get_string('region'),
            this._settings.get_string('unit')
        );

        // Add menu items
        this._buildMenu();

        // Connect to settings changes
        this._settings.connect('changed::show-icon', this._updateIconVisibility.bind(this));
        this._settings.connect('changed::icon-position', this._updateIconVisibility.bind(this));
        this._settings.connect('changed::username', this._updateCredentials.bind(this));
        this._settings.connect('changed::password', this._updateCredentials.bind(this));
        this._settings.connect('changed::region', this._updateCredentials.bind(this));

        // Start monitoring
        this._startMonitoring();
    }

    // _updateCredentials metodunda değişiklik
    _updateCredentials() {
    this._dexcomClient = new DexcomClient(
        this._settings.get_string('username'),
        this._settings.get_string('password'),
        this._settings.get_string('region'),
        this._settings.get_string('unit')
    );
    this._updateReading();
    }

    // Icon yükleme metodunu ekleyelim
    _loadIcon() {
        try {
            const iconPath = `${this.path}/icons/icon.svg`;
            const file = Gio.File.new_for_path(iconPath);
            if (file.query_exists(null)) {
                this.icon.gicon = Gio.icon_new_for_string(iconPath);
            }
        } catch (error) {
            console.error('Error loading icon:', error);
        }
    }

    _buildMenu() {
        // Add glucose info section
        this.glucoseInfo = new PopupMenu.PopupMenuItem('Loading...', {
            reactive: false,
            style_class: 'dexcom-menu-item'
        });
        this.menu.addMenuItem(this.glucoseInfo);

        // Add separator
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Add display options
        this._addToggleMenuItem('Show Delta', 'show-delta');
        this._addToggleMenuItem('Show Trend Arrows', 'show-trend-arrows');
        this._addToggleMenuItem('Show Elapsed Time', 'show-elapsed-time');

        // Add separator
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Add settings button
        const settingsItem = new PopupMenu.PopupMenuItem('Settings');
        settingsItem.connect('activate', () => {
            if (this.extension) {
                this.extension.openPreferences();
            }
        });
        this.menu.addMenuItem(settingsItem);
    }

    _addToggleMenuItem(label, settingKey) {
        let toggleItem = new PopupMenu.PopupSwitchMenuItem(
            label, 
            this._settings.get_boolean(settingKey)
        );
        toggleItem.connect('toggled', (item) => {
            this._settings.set_boolean(settingKey, item.state);
            // Use stored reading to update display
            if (this._currentReading) {
                this._updateDisplay(this._currentReading);
            }
        });
        this.menu.addMenuItem(toggleItem);
    }
    
    // _reloadIcon() {
    //     try {
    //         const iconPath = `${this.path}/icons/icon.svg`;
    //         if (this.icon) {
    //             this.icon.gicon = Gio.icon_new_for_string(iconPath);
    //         } else {
    //             this.icon = new St.Icon({
    //                 style_class: 'dexcom-icon',
    //                 gicon: Gio.icon_new_for_string(iconPath)
    //             });
    //         }
    //         this._updateIconVisibility();
    //     } catch (error) {
    //         console.error('Error loading icon:', error);
    //     }
    // }
    
    _startMonitoring() {
        this._updateReading();
        this._timeout = setInterval(() => {
            this._updateReading();
        }, this._settings.get_int('update-interval') * 1000);
    }

    // _updateReading metodunda değişiklik
    async _updateReading() {
    try {
        const reading = await this._dexcomClient.getLatestGlucose();
        this._updateDisplay(reading);
        this._updateMenuInfo(reading);
    } catch (error) {
        console.error('Error fetching Dexcom reading:', error);
        this.buttonText.text = 'Error';
        this.buttonText.style_class = 'dexcom-label dexcom-error';
        this.glucoseInfo.label.text = 'Failed to fetch glucose data';
    }
}

    _getColorForValue(value) {
        const urgentHigh = this._settings.get_int('urgent-high-threshold');
        const high = this._settings.get_int('high-threshold');
        const low = this._settings.get_int('low-threshold');
        const urgentLow = this._settings.get_int('urgent-low-threshold');

        let styleClass = 'dexcom-label ';
        
        if (value >= urgentHigh) {
            styleClass += 'dexcom-urgent-high';
        } else if (value >= high) {
            styleClass += 'dexcom-high';
        } else if (value > low) {
            styleClass += 'dexcom-normal';
        } else if (value > urgentLow) {
            styleClass += 'dexcom-low';
        } else {
            styleClass += 'dexcom-urgent-low';
        }
        
        return styleClass;
    }

    _updateIconVisibility() {
        // Clear existing children
        this.box.remove_all_children();

        const showIcon = this._settings.get_boolean('show-icon');
        const iconPosition = this._settings.get_string('icon-position');

        // Add elements in the correct order
        if (showIcon && iconPosition === 'left') {
            this.box.add_child(this.icon);
        }

        this.box.add_child(this.buttonText);

        if (showIcon && iconPosition === 'right') {
            this.box.add_child(this.icon);
        }
    }

    _updateDisplay(reading) {
        if (!reading) {
            this.buttonText.text = '---';
            this.buttonText.style_class = 'dexcom-label';
            return;
        }
    
        // Store current values
        this._currentReading = reading;
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
        this.buttonText.style_class = this._getColorForValue(reading.value);
    }

    _updateMenuInfo(reading) {
        if (!reading) {
            this.glucoseInfo.label.text = 'No data available';
            return;
        }

        const unit = this._settings.get_string('unit');
        const timestamp = new Date(reading.timestamp).toLocaleTimeString();
        
        let info = `Last Reading: ${reading.value} ${unit}\n`;
        info += `Time: ${timestamp}\n`;
        info += `Trend: ${reading.trend}\n`;
        info += `Delta: ${reading.delta > 0 ? '+' : ''}${reading.delta} ${unit}`;

        this.glucoseInfo.label.text = info;
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
        this._indicator.path = this.path;
        this._indicator.extension = this;
        Main.panel.addToStatusArea('dexcom-indicator', this._indicator);
    }

    disable() {
        this._indicator.destroy();
        this._indicator = null;
    }
}