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
        
        this.path = null;

        // Create container box
        this.box = new St.BoxLayout({
            style_class: 'panel-status-menu-box'
        });

        // Create label
        this.buttonText = new St.Label({
            text: '---',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'dexcom-label'
        });

        // Add the box to the button
        this.add_child(this.box);
        this.box.add_child(this.buttonText);

        // Initialize DexcomClient with credentials
        this._dexcomClient = new DexcomClient(
            this._settings.get_string('username'),
            this._settings.get_string('password'),
            this._settings.get_string('region'),
            this._settings.get_string('unit')
        );

        // Add menu items
        this._buildMenu();
        // Listen changes
        this._connectSignals();
        // Start monitoring
        this._startMonitoring();
    }
    
    setPath(path) {
        this.path = path;
        // Now that we have the path, initialize the icon
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
            console.log('Error initializing icon:', error);
            // Fallback icon
            this.icon = new St.Icon({
                icon_name: 'utilities-system-monitor-symbolic',
                style_class: 'system-status-icon',
                icon_size: 16
            });
        }
    }

    _connectSignals() {        
        // Function to update display when settings change
        const updateDisplaySettings = () => {
            if (this._currentReading) {
                this._updateDisplay(this._currentReading);
            }
        };
    
        // Listen for display setting changes
        this._settings.connect('changed::show-icon', updateDisplaySettings);
        this._settings.connect('changed::show-trend-arrows', updateDisplaySettings);
        this._settings.connect('changed::show-delta', updateDisplaySettings);
        this._settings.connect('changed::show-elapsed-time', updateDisplaySettings);
        
        // Listen for credential and unit changes
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
        // Add icon position change listener
        this._settings.connect('changed::icon-position', () => {
            this._updateIconVisibility();
        });

        // Add show-icon change listener if not already present
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
            console.warn('Username or password not set');
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

    // Add menu toggle items with immediate update
    _addToggleMenuItem(label, settingKey) {
        const toggleItem = new PopupMenu.PopupSwitchMenuItem(
            label, 
            this._settings.get_boolean(settingKey)
        );
        toggleItem.connect('toggled', (item) => {
            this._settings.set_boolean(settingKey, item.state);
            // Force an immediate reading update
            this._updateReading();
        });
        this.menu.addMenuItem(toggleItem);
    }

    _updateUnit() {
        // Update DexcomClient with new unit
        this._dexcomClient = new DexcomClient(
            this._settings.get_string('username'),
            this._settings.get_string('password'),
            this._settings.get_string('region'),
            this._settings.get_string('unit')
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
    
        // Force an immediate reading update
        this._updateReading();
    }
    
    // Update _startMonitoring function in extension.js
    _startMonitoring() {
        // Initial reading
        this._updateReading();
        
        // Clear any existing interval
        if (this._timeout) {
            clearInterval(this._timeout);
        }
        
        // Set up interval for periodic updates
        this._timeout = setInterval(() => {
            this._updateReading();
        }, this._settings.get_int('update-interval') * 1000);
    }

    // Update the reading from Dexcom
    async _updateReading() {
        // Check if client is properly initialized
        if (!this._dexcomClient) {
            this._updateDisplayError('Setup Required', 'Please configure your Dexcom Share credentials');
            return;
        }
    
        try {
            // Attempt to fetch latest glucose reading
            const reading = await this._dexcomClient.getLatestGlucose();
            
            // Handle case where no reading is available
            if (!reading) {
                this._updateDisplayError('No Data', 'No glucose data available');
                return;
            }
    
            // Update display with new reading
            this._updateDisplay(reading);
            this._updateMenuInfo(reading);
        } catch (error) {
            console.log('Error fetching Dexcom reading:', error);
    
            let errorMessage = 'Error';
            let detailedMessage = error.message;
    
            // Analyze error messages and provide appropriate responses
            if (error.message.includes('AccountPasswordInvalid')) {
                errorMessage = 'Auth Error';
                detailedMessage = 'Invalid username or password';
                
                // Reset credentials and attempt to update
                this._dexcomClient = null;
                await this._updateCredentials();
            } else if (error.message.includes('AccountNotFound')) {
                errorMessage = 'Auth Error';
                detailedMessage = 'Account not found';
            } else if (error.message.includes('SSO_AuthenticatePasswordInvalid')) {
                errorMessage = 'Auth Error';
                detailedMessage = 'Invalid password';
            } else if (error.message.includes('Session')) {
                // Retry on session errors
                await this._updateReading();
                return;
            } else if (error.message.includes('network') || error.message.includes('timeout')) {
                errorMessage = 'Network Error';
                detailedMessage = 'Please check your internet connection';
            }
    
            // Display error message to user
            this._updateDisplayError(errorMessage, detailedMessage);
        }
    }

    // Helper function to update the display with error messages
    _updateDisplayError(errorMessage, detailedMessage) {
        this.buttonText.text = errorMessage;
        this.buttonText.style_class = 'dexcom-label dexcom-error';
        if (this.glucoseInfo) {
            this.glucoseInfo.label.text = detailedMessage;
        }
    }

    _getColorForValue(value) {
        const urgentHigh = this._settings.get_int('urgent-high-threshold');
        const high = this._settings.get_int('high-threshold');
        const low = this._settings.get_int('low-threshold');
        const urgentLow = this._settings.get_int('urgent-low-threshold');

        // Get colors from settings
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
        // First, remove all existing children
        this.box.remove_all_children();
        
        // Reset style class to ensure consistent appearance
        this.box.style_class = '';
        this.box.set_style('spacing: 2px; padding: 0px 1px;');
    
        // Get settings
        const showIcon = this._settings.get_boolean('show-icon');
        const iconPosition = this._settings.get_string('icon-position');
    
        // Add elements in the correct order based on position
        if (showIcon && iconPosition.toLowerCase() === 'left') {
            this.icon && this.box.add_child(this.icon);
        }
    
        // Always add the value container
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
    
            // Add other elements (trend arrows, delta, elapsed time)
            this._addAdditionalElements(this._currentReading, style);
        } else {
            // If no reading, just show "No Data"
            const label = new St.Label({
                text: 'No Data',
                style_class: 'dexcom-value'
            });
            this.box.add_child(label);
        }
    
        // Add icon at the end if position is right
        if (showIcon && iconPosition.toLowerCase() === 'right') {
            this.icon && this.box.add_child(this.icon);
        }
    }
    // Helper function to add additional elements
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
    // Clear the box
    this.box.remove_all_children();
    
    // Explicitly reset any style class to ensure consistent appearance
    this.box.style_class = '';
    this.box.set_style('');
    
    // Apply minimal spacing
    this.box.set_style('spacing: 2px; padding: 0px 1px;');

    // Add icon if enabled
    if (this._settings.get_boolean('show-icon')) {
        this.box.add_child(this.icon);
    }

    // Handle case when no reading is available
    if (!reading) {
        const label = new St.Label({
            text: 'No Data',
            style_class: 'dexcom-value'
        });
        this.box.add_child(label);
        return;
    }

    // Store current reading for future reference
    this._currentReading = reading;

    // Get styling based on glucose value
    const { styleClass, style } = this._getBackgroundClass(reading.value);

    // Create container for glucose value
    const valueContainer = new St.Bin({
        style_class: styleClass,
        style: style,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER
    });

    // Add glucose value
    const valueLabel = new St.Label({
        text: `${reading.value}`,
        y_align: Clutter.ActorAlign.CENTER
    });
    
    valueContainer.set_child(valueLabel);
    this.box.add_child(valueContainer);

    // Add trend arrow if enabled
    if (this._settings.get_boolean('show-trend-arrows')) {
        const trendLabel = new St.Label({
            text: this._getTrendArrow(reading.trend),
            style_class: 'dexcom-trend',
            style: style // Apply same color as value
        });
        this.box.add_child(trendLabel);
    }

    // Add delta if enabled
    if (this._settings.get_boolean('show-delta')) {
        const deltaLabel = new St.Label({
            text: `${reading.delta > 0 ? '+' : ''}${reading.delta}`,
            style_class: 'dexcom-delta',
            style: style // Apply same color as value
        });
        this.box.add_child(deltaLabel);
    }

    // Add elapsed time if enabled
    if (this._settings.get_boolean('show-elapsed-time')) {
        const elapsed = Math.floor((Date.now() - reading.timestamp) / 60000);
        const timeLabel = new St.Label({
            text: `${elapsed}m`,
            style_class: 'dexcom-time',
            style: style // Apply the same color style as other elements
        });
        this.box.add_child(timeLabel);
    }
}
    
    _buildMenu() {
        // Glucose info section
        this.glucoseInfo = new PopupMenu.PopupMenuItem('Loading...', {
            reactive: false,
            style_class: 'dexcom-menu-item'
        });
        this.menu.addMenuItem(this.glucoseInfo);
    
        // Add separator
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
    
        // Display options
        const displayOptionsLabel = new PopupMenu.PopupMenuItem('Display Options:', {
            reactive: false,
            style_class: 'dexcom-menu-header'
        });
        this.menu.addMenuItem(displayOptionsLabel);
    
        this._addToggleMenuItem('Show Delta', 'show-delta');
        this._addToggleMenuItem('Show Trend Arrows', 'show-trend-arrows');
        this._addToggleMenuItem('Show Elapsed Time', 'show-elapsed-time');
        this._addToggleMenuItem('Show Icon', 'show-icon');
    
        // Add separator
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
    
        // Add refresh button
        const refreshButton = new PopupMenu.PopupMenuItem('Refresh Now', {
            style_class: 'dexcom-refresh-button'
        });
        refreshButton.connect('activate', () => {
            // Show loading indicator in menu
            this.glucoseInfo.label.text = 'Refreshing...';
            // Trigger immediate update
            this._updateReading();
        });
        this.menu.addMenuItem(refreshButton);
    
        // Add separator
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
    
        // Add settings button
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
        // Get current unit and convert value to number
        const isMmol = this._settings.get_string('unit') === 'mmol/L';
        const numericValue = parseFloat(value);
        
        // Get threshold values in mg/dL (as stored)
        const thresholdsMgdl = {
            urgentHigh: this._settings.get_int('urgent-high-threshold'),
            high: this._settings.get_int('high-threshold'),
            low: this._settings.get_int('low-threshold'),
            urgentLow: this._settings.get_int('urgent-low-threshold')
        };
        
        // Convert thresholds to the current unit if needed
        const thresholds = {};
        if (isMmol) {
            // Convert mg/dL thresholds to mmol/L for comparison
            Object.keys(thresholdsMgdl).forEach(key => {
                thresholds[key] = parseFloat((thresholdsMgdl[key] / 18.0).toFixed(1));
            });
        } else {
            // Use mg/dL values directly
            Object.assign(thresholds, thresholdsMgdl);
        }
    
        // Get colors from settings
        const colors = {
            urgentHigh: this._settings.get_string('urgent-high-color'),
            high: this._settings.get_string('high-color'),
            normal: this._settings.get_string('normal-color'),
            low: this._settings.get_string('low-color'),
            urgentLow: this._settings.get_string('urgent-low-color')
        };
    
        // Helper function to convert hex to rgba
        const hexToRgba = (hex, alpha) => {
            const r = parseInt(hex.slice(1, 3), 16);
            const g = parseInt(hex.slice(3, 5), 16);
            const b = parseInt(hex.slice(5, 7), 16);
            return `rgba(${r}, ${g}, ${b}, ${alpha})`;
        };
    
        // Log debug information
        console.log('Color threshold check:', {
            unit: isMmol ? 'mmol/L' : 'mg/dL',
            value: numericValue,
            thresholds: thresholds
        });
    
        // Compare and determine color - use floating point comparison with small epsilon for mmol/L
        let styleClass = 'dexcom-value-container';
        let color, borderColor;
        
        const epsilon = isMmol ? 0.05 : 1; // Tolerance for floating-point comparison
        
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
    
        // Create a more minimal style that will work across distributions
        const style = `color: ${color}; border-color: ${borderColor};`;
        return { styleClass, style };
    }

    // Update _updateMenuInfo function in extension.js
    _updateMenuInfo(reading) {
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
    
        // Updated trend mapping with better descriptions
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
        //console.log('Debug - Trend Value:', reading.trend, 'Mapped Description:', trendDescription);
    
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
        this._indicator.setPath(this.path);
        this._indicator.extension = this;
        Main.panel.addToStatusArea('dexcom-indicator', this._indicator);
    }

    disable() {
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
        // Clear settings reference
        if (this._settings) {
            this._settings = null;
        }
    }
}
