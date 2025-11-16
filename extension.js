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
        this._destroyed = false;

        this.path = null;
        this._lastLoggedValue = null; // Track last logged value to avoid duplicate logs

        this._log = (message, data = null) => {
            if (this._settings.get_boolean('enable-debug-logs')) {
                if (data) {
                    console.log(`[Dexcom] ${message}`, data);
                } else {
                    console.log(`[Dexcom] ${message}`);
                }
            }
        };

       
        this.box = new St.BoxLayout({
            style_class: 'panel-status-menu-box'
        });

       
        this.buttonText = new St.Label({
            text: '---',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'dexcom-label'
        });

       
        this.add_child(this.box);
        this.box.add_child(this.buttonText);

       
        this._dexcomClient = new DexcomClient(
            this._settings.get_string('username'),
            this._settings.get_string('password'),
            this._settings.get_string('region'),
            this._settings.get_string('unit'),
            this._settings
        );

       
        this._buildMenu();
       
        this._connectSignals();
       
        this._startMonitoring();
    }
    
    setPath(path) {
        this.path = path;
       
        this._initIcon();
        this._updateIconVisibility();
    }

    _loadIcon() {
        if (!this.path) {
            throw new Error('Extension path not set');
        }

        const iconPath = `${this.path}/icons/dexcom-icon.svg`;
        const file = Gio.File.new_for_path(iconPath);
        
        if (file.query_exists(null)) {
            if (this.icon) {
                this.icon.gicon = Gio.icon_new_for_string(iconPath);
            } else {
                this.icon = new St.Icon({
                    style_class: 'dexcom-icon',
                    gicon: Gio.icon_new_for_string(iconPath),
                    icon_size: 16
                });
            }
        } else {
            throw new Error(`Icon file not found: ${iconPath}`);
        }
    }    

    _initIcon() {
        try {
            this._loadIcon();
        } catch (error) {
            this._log('Error initializing icon:', error);

            this.icon = new St.Icon({
                icon_name: 'utilities-system-monitor-symbolic',
                style_class: 'system-status-icon',
                icon_size: 16
            });
        }
    }

    _connectSignals() {        
       
        const updateDisplaySettings = () => {
            if (this._currentReading) {
                this._updateDisplay(this._currentReading);
            }
        };
    
       
        this._settings.connect('changed::show-icon', updateDisplaySettings);
        this._settings.connect('changed::show-trend-arrows', updateDisplaySettings);
        this._settings.connect('changed::show-delta', updateDisplaySettings);
        this._settings.connect('changed::show-elapsed-time', updateDisplaySettings);
        
       
        this._settings.connect('changed::username', () => {
            this._updateCredentials();
            this._updateReading();
        });
        this._settings.connect('changed::password', () => {
            this._updateCredentials();
            this._updateReading();
        });
        this._settings.connect('changed::region', () => {
            this._updateCredentials();
            this._updateReading();
        });
        this._settings.connect('changed::unit', () => {
            this._updateUnit();
            this._updateReading();
        });
       
        this._settings.connect('changed::icon-position', () => {
            this._updateIconVisibility();
        });

       
        this._settings.connect('changed::show-icon', () => {
            this._updateIconVisibility();
        });
    }

    _updateCredentials() {
        const username = this._settings.get_string('username');
        const password = this._settings.get_string('password');
        const region = this._settings.get_string('region');
        const unit = this._settings.get_string('unit');
    
        if (!username || !password) {
            this._log('Username or password not set');
            this._updateDisplayError('Auth Error', 'Please enter your Dexcom Share credentials');
            return;
        }
    
        this._dexcomClient = new DexcomClient(
            username,
            password,
            region,
            unit
        );
    }

   
    _addToggleMenuItem(label, settingKey) {
        const toggleItem = new PopupMenu.PopupSwitchMenuItem(
            label, 
            this._settings.get_boolean(settingKey)
        );
        toggleItem.connect('toggled', (item) => {
            this._settings.set_boolean(settingKey, item.state);
           
            this._updateReading();
        });
        this.menu.addMenuItem(toggleItem);
    }

    _updateUnit() {
       
        this._dexcomClient = new DexcomClient(
            this._settings.get_string('username'),
            this._settings.get_string('password'),
            this._settings.get_string('region'),
            this._settings.get_string('unit'),
            this._settings
        );
    

        if (this._currentReading) {
            const value = this._settings.get_string('unit') === 'mmol/L' 
                ? (this._currentReading.value / 18.0).toFixed(1) 
                : this._currentReading.value;
            
            const delta = this._settings.get_string('unit') === 'mmol/L'
                ? (this._currentReading.delta / 18.0).toFixed(1)
                : this._currentReading.delta;
    
            const updatedReading = {
                ...this._currentReading,
                value: value,
                delta: delta,
                unit: this._settings.get_string('unit')
            };
    
            this._updateDisplay(updatedReading);
            this._updateMenuInfo(updatedReading);
        }
    
       
        this._updateReading();
    }
    
   
    _startMonitoring() {
       
        this._updateReading();
        
       
        if (this._timeout) {
            clearInterval(this._timeout);
        }
        
       
        this._timeout = setInterval(() => {
            this._updateReading();
        }, this._settings.get_int('update-interval') * 1000);
    }


    async _updateReading() {
      
        if (this._destroyed) {
            return;
        }

        if (!this._dexcomClient) {
            this._updateDisplayError('Setup Required', 'Please configure your Dexcom Share credentials');
            return;
        }

        try {

            const reading = await this._dexcomClient.getLatestGlucose();

          
            if (this._destroyed) {
                return;
            }
            
           
            if (!reading) {
                this._updateDisplayError('No Data', 'No glucose data available');
                return;
            }
    
           
            this._updateDisplay(reading);
            this._updateMenuInfo(reading);
        } catch (error) {
            this._log('Error fetching Dexcom reading:', error);

            let errorMessage = 'Error';
            let detailedMessage = error.message;

            // Handle network/connection errors first (most common transient error)
            if (error.message.includes('NETWORK_ERROR') ||
                error.message.includes('Gio.IOErrorEnum') ||
                error.message.includes('No route to host') ||
                error.message.includes('timed out') ||
                error.message.includes('Could not connect')) {
                errorMessage = 'Network Error';
                detailedMessage = 'Connection failed. Please check your internet connection.';
            }
            // Handle rate limiting (429)
            else if (error.message.includes('RATE_LIMITED')) {
                errorMessage = 'Rate Limited';
                detailedMessage = 'Too many requests to Dexcom API. Please wait 5-10 minutes before the next update.';
            }
            // Handle session expiration
            else if (error.message.includes('SESSION_EXPIRED') || error.message.includes('Session renewal failed')) {
                errorMessage = 'Session Error';
                detailedMessage = 'Session expired and renewal failed. Please verify your credentials in settings.';
            }
            // Handle API locked (423)
            else if (error.message.includes('423')) {
                errorMessage = 'API Locked';
                detailedMessage = 'Dexcom API temporarily locked. This usually resolves automatically. Try refreshing or wait a few minutes.';
            }
            // Handle authentication errors
            else if (error.message.includes('AccountPasswordInvalid')) {
                errorMessage = 'Auth Error';
                detailedMessage = 'Invalid username or password';
                this._dexcomClient = null;
                await this._updateCredentials();
            } else if (error.message.includes('AccountNotFound')) {
                errorMessage = 'Auth Error';
                detailedMessage = 'Account not found';
            } else if (error.message.includes('SSO_AuthenticatePasswordInvalid')) {
                errorMessage = 'Auth Error';
                detailedMessage = 'Invalid password';
            }

            this._updateDisplayError(errorMessage, detailedMessage);
        }
    }


    _updateDisplayError(errorMessage, detailedMessage) {

        if (this._destroyed || !this.box) {
            return;
        }

        // Clear the current reading to prevent showing stale data
        this._currentReading = null;

        // Clear the display
        this.box.remove_all_children();
        this.box.style_class = '';
        this.box.set_style('spacing: 2px; padding: 0px 1px;');

        // Show icon if enabled
        if (this._settings.get_boolean('show-icon') && this.icon) {
            this.box.add_child(this.icon);
        }

        // Create error container with red styling
        const errorContainer = new St.Bin({
            style_class: 'dexcom-value-container',
            style: 'color: #ff0000; border-color: rgba(255, 0, 0, 0.6);',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER
        });

        const errorLabel = new St.Label({
            text: errorMessage,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'dexcom-error'
        });

        errorContainer.set_child(errorLabel);
        this.box.add_child(errorContainer);

        // Update menu with detailed error message
        if (this.glucoseInfo && this.glucoseInfo.label) {
            this.glucoseInfo.label.text = `Error: ${detailedMessage}`;
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

        let styleClass = 'dexcom-label ';
        let color = '';
        
        if (value >= urgentHigh) {
            styleClass += 'dexcom-urgent-high';
            color = urgentHighColor;
        } else if (value >= high) {
            styleClass += 'dexcom-high';
            color = highColor;
        } else if (value > low) {
            styleClass += 'dexcom-normal';
            color = normalColor;
        } else if (value > urgentLow) {
            styleClass += 'dexcom-low';
            color = lowColor;
        } else {
            styleClass += 'dexcom-urgent-low';
            color = urgentLowColor;
        }
        
        
        this.buttonText.style = `color: ${color};`;
        return styleClass;
    }

    _updateIconVisibility() {
      
        if (this._destroyed || !this.box) {
            return;
        }

        this.box.remove_all_children();

        this.box.style_class = '';
        this.box.set_style('spacing: 2px; padding: 0px 1px;');
    
       
        const showIcon = this._settings.get_boolean('show-icon');
        const iconPosition = this._settings.get_string('icon-position');
    
       
        if (showIcon && iconPosition.toLowerCase() === 'left') {
            this.icon && this.box.add_child(this.icon);
        }
    
       
        if (this._currentReading) {
            const { styleClass, style } = this._getBackgroundClass(this._currentReading.value);
            
            const valueContainer = new St.Bin({
                style_class: styleClass,
                style: style,
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER
            });
    
            const valueLabel = new St.Label({
                text: `${this._currentReading.value}`,
                y_align: Clutter.ActorAlign.CENTER
            });
            
            valueContainer.set_child(valueLabel);
            this.box.add_child(valueContainer);
    
           
            this._addAdditionalElements(this._currentReading, style);
        } else {
           
            const label = new St.Label({
                text: 'No Data',
                style_class: 'dexcom-value'
            });
            this.box.add_child(label);
        }
    
       
        if (showIcon && iconPosition.toLowerCase() === 'right') {
            this.icon && this.box.add_child(this.icon);
        }
    }
   
_addAdditionalElements(reading, style) {
    if (this._settings.get_boolean('show-trend-arrows')) {
        const trendLabel = new St.Label({
            text: this._getTrendArrow(reading.trend),
            style_class: 'dexcom-trend',
            style: style
        });
        this.box.add_child(trendLabel);
    }

    if (this._settings.get_boolean('show-delta')) {
        const deltaLabel = new St.Label({
            text: `${reading.delta > 0 ? '+' : ''}${reading.delta}`,
            style_class: 'dexcom-delta',
            style: style
        });
        this.box.add_child(deltaLabel);
    }

    if (this._settings.get_boolean('show-elapsed-time')) {
        const elapsed = Math.floor((Date.now() - reading.timestamp) / 60000);
        const timeLabel = new St.Label({
            text: `${elapsed}m`,
            style_class: 'dexcom-time',
            style: style
        });
        this.box.add_child(timeLabel);
    }
}

_updateDisplay(reading) {
  
    if (this._destroyed || !this.box) {
        return;
    }

    this.box.remove_all_children();

    this.box.style_class = '';
    this.box.set_style('');

    this.box.set_style('spacing: 2px; padding: 0px 1px;');

   
    if (this._settings.get_boolean('show-icon')) {
        this.box.add_child(this.icon);
    }

   
    if (!reading) {
        const label = new St.Label({
            text: 'No Data',
            style_class: 'dexcom-value'
        });
        this.box.add_child(label);
        return;
    }

   
    this._currentReading = reading;

   
    const { styleClass, style } = this._getBackgroundClass(reading.value);

   
    const valueContainer = new St.Bin({
        style_class: styleClass,
        style: style,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER
    });

   
    const valueLabel = new St.Label({
        text: `${reading.value}`,
        y_align: Clutter.ActorAlign.CENTER
    });
    
    valueContainer.set_child(valueLabel);
    this.box.add_child(valueContainer);

   
    if (this._settings.get_boolean('show-trend-arrows')) {
        const trendLabel = new St.Label({
            text: this._getTrendArrow(reading.trend),
            style_class: 'dexcom-trend',
            style: style
        });
        this.box.add_child(trendLabel);
    }

   
    if (this._settings.get_boolean('show-delta')) {
        const deltaLabel = new St.Label({
            text: `${reading.delta > 0 ? '+' : ''}${reading.delta}`,
            style_class: 'dexcom-delta',
            style: style
        });
        this.box.add_child(deltaLabel);
    }

   
    if (this._settings.get_boolean('show-elapsed-time')) {
        const elapsed = Math.floor((Date.now() - reading.timestamp) / 60000);
        const timeLabel = new St.Label({
            text: `${elapsed}m`,
            style_class: 'dexcom-time',
            style: style
        });
        this.box.add_child(timeLabel);
    }
}
    
    _buildMenu() {
       
        this.glucoseInfo = new PopupMenu.PopupMenuItem('Loading...', {
            reactive: false,
            style_class: 'dexcom-menu-item'
        });
        this.menu.addMenuItem(this.glucoseInfo);
    
       
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
    
       
        const displayOptionsLabel = new PopupMenu.PopupMenuItem('Display Options:', {
            reactive: false,
            style_class: 'dexcom-menu-header'
        });
        this.menu.addMenuItem(displayOptionsLabel);
    
        this._addToggleMenuItem('Show Delta', 'show-delta');
        this._addToggleMenuItem('Show Trend Arrows', 'show-trend-arrows');
        this._addToggleMenuItem('Show Elapsed Time', 'show-elapsed-time');
        this._addToggleMenuItem('Show Icon', 'show-icon');
    
       
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
    
       
        const refreshButton = new PopupMenu.PopupMenuItem('Refresh Now', {
            style_class: 'dexcom-refresh-button'
        });
        refreshButton.connect('activate', () => {
           
            this.glucoseInfo.label.text = 'Refreshing...';
           
            this._updateReading();
        });
        this.menu.addMenuItem(refreshButton);
    
       
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
    
       
        const settingsButton = new PopupMenu.PopupMenuItem('Open Settings', {
            style_class: 'dexcom-settings-button'
        });
        settingsButton.connect('activate', () => {
            if (this.extension) {
                this.extension.openPreferences();
            }
        });
        this.menu.addMenuItem(settingsButton);
    }

    _getBackgroundClass(value) {

        const isMmol = this._settings.get_string('unit') === 'mmol/L';
        const numericValue = parseFloat(value);


        const thresholdsMgdl = {
            urgentHigh: this._settings.get_int('urgent-high-threshold'),
            high: this._settings.get_int('high-threshold'),
            low: this._settings.get_int('low-threshold'),
            urgentLow: this._settings.get_int('urgent-low-threshold')
        };


        const thresholds = {};
        if (isMmol) {

            Object.keys(thresholdsMgdl).forEach(key => {
                thresholds[key] = parseFloat((thresholdsMgdl[key] / 18.0).toFixed(1));
            });
        } else {

            Object.assign(thresholds, thresholdsMgdl);
        }


        const colors = {
            urgentHigh: this._settings.get_string('urgent-high-color'),
            high: this._settings.get_string('high-color'),
            normal: this._settings.get_string('normal-color'),
            low: this._settings.get_string('low-color'),
            urgentLow: this._settings.get_string('urgent-low-color')
        };


        const hexToRgba = (hex, alpha) => {
            const r = parseInt(hex.slice(1, 3), 16);
            const g = parseInt(hex.slice(3, 5), 16);
            const b = parseInt(hex.slice(5, 7), 16);
            return `rgba(${r}, ${g}, ${b}, ${alpha})`;
        };

        // Only log when value changes
        if (this._lastLoggedValue !== numericValue) {
            this._log('Color threshold check:', {
                unit: isMmol ? 'mmol/L' : 'mg/dL',
                value: numericValue,
                thresholds: thresholds
            });
            this._lastLoggedValue = numericValue;
        }
    
       
        let styleClass = 'dexcom-value-container';
        let color, borderColor;
        
        const epsilon = isMmol ? 0.05 : 1;
        
        if (numericValue >= (thresholds.urgentHigh - epsilon)) {
            color = colors.urgentHigh;
            borderColor = hexToRgba(colors.urgentHigh, 0.6);
        } else if (numericValue >= (thresholds.high - epsilon)) {
            color = colors.high;
            borderColor = hexToRgba(colors.high, 0.6);
        } else if (numericValue > (thresholds.low + epsilon)) {
            color = colors.normal;
            borderColor = hexToRgba(colors.normal, 0.6);
        } else if (numericValue > (thresholds.urgentLow + epsilon)) {
            color = colors.low;
            borderColor = hexToRgba(colors.low, 0.6);
        } else {
            color = colors.urgentLow;
            borderColor = hexToRgba(colors.urgentLow, 0.6);
        }
    
       
        const style = `color: ${color}; border-color: ${borderColor};`;
        return { styleClass, style };
    }


    _updateMenuInfo(reading) {
      
        if (this._destroyed || !this.glucoseInfo || !this.glucoseInfo.label) {
            return;
        }

        if (!reading) {
            this.glucoseInfo.label.text = 'No data available';
            return;
        }
    
        const unit = this._settings.get_string('unit');
        const time = new Date(reading.timestamp).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        });
    
       
        const trendMap = {
            'NONE': 'Stable',
            'DOUBLE_UP': 'Rising Rapidly',
            'SINGLE_UP': 'Rising',
            'FORTY_FIVE_UP': 'Rising Slowly',
            'FLAT': 'Stable',
            'FORTY_FIVE_DOWN': 'Falling Slowly',
            'SINGLE_DOWN': 'Falling',
            'DOUBLE_DOWN': 'Falling Rapidly',
            'NOT_COMPUTABLE': 'Unable to Determine',
            'RATE_OUT_OF_RANGE': 'Out of Range'
        };
    
        const trendDescription = trendMap[reading.trend] || 'Unknown';
       
    
        const info = [
            `Last Reading: ${reading.value} ${unit}`,
            `Time: ${time}`,
            `Trend: ${trendDescription}`,
            `Delta: ${reading.delta > 0 ? '+' : ''}${reading.delta} ${unit}`
        ].join('\n');
    
        this.glucoseInfo.label.text = info;
    }

   
    _getTrendArrow(trend) {
        const arrows = {
            'NONE': '→',
            'DOUBLE_UP': '⇈',
            'SINGLE_UP': '↑',
            'FORTY_FIVE_UP': '↗',
            'FLAT': '→',
            'FORTY_FIVE_DOWN': '↘',
            'SINGLE_DOWN': '↓',
            'DOUBLE_DOWN': '⇊',
            'NOT_COMPUTABLE': '-',
            'RATE_OUT_OF_RANGE': '?'
        };
        return arrows[trend] || '-';
    }

    destroy() {
      
        this._destroyed = true;

      
        if (this._timeout) {
            clearInterval(this._timeout);
            this._timeout = null;
        }

      
        if (this._dexcomClient) {
            this._dexcomClient = null;
        }

      
        super.destroy();
    }
});
export default class DexcomExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._indicator = new DexcomIndicator(this._settings);
        this._indicator.setPath(this.path);
        this._indicator.extension = this;
        Main.panel.addToStatusArea('dexcom-indicator', this._indicator);
    }

    disable() {
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
       
        if (this._settings) {
            this._settings = null;
        }
    }
}
