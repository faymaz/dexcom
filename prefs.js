import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class DexcomPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

       
        const accountPage = new Adw.PreferencesPage({
            title: 'Account',
            icon_name: 'system-users-symbolic',
        });

        const thresholdPage = new Adw.PreferencesPage({
            title: 'Thresholds',
            icon_name: 'preferences-system-symbolic',
        });
        
        const displayPage = new Adw.PreferencesPage({
            title: 'Display',
            icon_name: 'preferences-desktop-display-symbolic',
        });

        const advancedPage = new Adw.PreferencesPage({
            title: 'Advanced',
            icon_name: 'applications-engineering-symbolic',
        });

        window.add(accountPage);
        window.add(thresholdPage);
        window.add(displayPage);
        window.add(advancedPage);


        this._addAccountGroup(accountPage, settings);
        this._addThresholdGroup(thresholdPage, settings);
        this._addColorGroup(thresholdPage, settings);
        this._addDisplayOptionsGroup(displayPage, settings);
        this._addAdvancedOptionsGroup(advancedPage, settings);
    }

    _addAccountGroup(page, settings) {
        const group = new Adw.PreferencesGroup({
            title: 'Dexcom Share Account',
            description: 'Enter your Dexcom Share credentials',
        });

       
        const usernameRow = new Adw.EntryRow({
            title: 'Username',
        });
        usernameRow.connect('changed', () => {
            settings.set_string('username', usernameRow.get_text());
        });
        usernameRow.set_text(settings.get_string('username'));
        group.add(usernameRow);

       
        const passwordRow = new Adw.PasswordEntryRow({
            title: 'Password',
        });
        passwordRow.connect('changed', () => {
            settings.set_string('password', passwordRow.get_text());
        });
        passwordRow.set_text(settings.get_string('password'));
        group.add(passwordRow);

       
        const regionRow = new Adw.ActionRow({ title: 'Region' });
        const regionCombo = new Gtk.ComboBoxText({
            valign: Gtk.Align.CENTER,
        });

        regionCombo.append('US', 'United States');
        regionCombo.append('Non-US', 'Outside US');
        
        regionCombo.set_active_id(settings.get_string('region'));
        regionCombo.connect('changed', () => {
            settings.set_string('region', regionCombo.get_active_id());
        });

        regionRow.add_suffix(regionCombo);
        group.add(regionRow);

       
        const unitRow = new Adw.ActionRow({ title: 'Glucose Unit' });
        const unitCombo = new Gtk.ComboBoxText({
            valign: Gtk.Align.CENTER,
        });

        unitCombo.append('mg/dL', 'mg/dL');
        unitCombo.append('mmol/L', 'mmol/L');
        
        unitCombo.set_active_id(settings.get_string('unit'));
        unitCombo.connect('changed', () => {
            settings.set_string('unit', unitCombo.get_active_id());
        });

        unitRow.add_suffix(unitCombo);
        group.add(unitRow);

       
        this._addSpinButton(group, settings, 'update-interval',
            'Update Interval (seconds)', 60, 600, 30);

        page.add(group);
    }

    _addThresholdGroup(page, settings) {
        const group = new Adw.PreferencesGroup({
            title: 'Glucose Thresholds',
            description: `Set glucose threshold values (${settings.get_string('unit')})`,
        });

       
        const convertValue = (value, toMmol = false) => {
            if (toMmol) {
                return Math.round((value / 18.0) * 10) / 10;
            }
            return Math.round(value * 18.0);
        };

       
        const currentUnit = settings.get_string('unit');
        const isMmol = currentUnit === 'mmol/L';

       
        const ranges = isMmol ? {
            urgentHigh: { min: 10.0, max: 22.2, increment: 0.1 },
            high: { min: 7.8, max: 16.7, increment: 0.1 },
            low: { min: 3.3, max: 6.7, increment: 0.1 },
            urgentLow: { min: 2.2, max: 4.4, increment: 0.1 }
        } : {
            urgentHigh: { min: 180, max: 400, increment: 1 },
            high: { min: 140, max: 300, increment: 1 },
            low: { min: 60, max: 120, increment: 1 },
            urgentLow: { min: 40, max: 80, increment: 1 }
        };

       
        this._addSpinButton(group, settings, 'urgent-high-threshold',
            'Urgent High Threshold',
            ranges.urgentHigh.min,
            ranges.urgentHigh.max,
            ranges.urgentHigh.increment,
            isMmol);

        this._addSpinButton(group, settings, 'high-threshold',
            'High Threshold',
            ranges.high.min,
            ranges.high.max,
            ranges.high.increment,
            isMmol);

        this._addSpinButton(group, settings, 'low-threshold',
            'Low Threshold',
            ranges.low.min,
            ranges.low.max,
            ranges.low.increment,
            isMmol);

        this._addSpinButton(group, settings, 'urgent-low-threshold',
            'Urgent Low Threshold',
            ranges.urgentLow.min,
            ranges.urgentLow.max,
            ranges.urgentLow.increment,
            isMmol);

       
        settings.connect('changed::unit', () => {
            const newUnit = settings.get_string('unit');
            const switchingToMmol = newUnit === 'mmol/L';

           
            group.description = `Set glucose threshold values (${newUnit})`;

           
            ['urgent-high-threshold', 'high-threshold', 'low-threshold', 'urgent-low-threshold'].forEach(key => {
                const currentValue = settings.get_int(key);
                const convertedValue = convertValue(currentValue, switchingToMmol);
                settings.set_int(key, convertedValue);
            });

           
            page.remove(group);
            this._addThresholdGroup(page, settings);
        });

        page.add(group);
    }
    _addColorGroup(page, settings) {
        const group = new Adw.PreferencesGroup({
            title: 'Threshold Colors',
            description: 'Customize colors for different glucose ranges',
        });

        this._addColorButton(group, settings, 'urgent-high-color', 'Urgent High Color');
        this._addColorButton(group, settings, 'high-color', 'High Color');
        this._addColorButton(group, settings, 'normal-color', 'Normal Color');
        this._addColorButton(group, settings, 'low-color', 'Low Color');
        this._addColorButton(group, settings, 'urgent-low-color', 'Urgent Low Color');

        page.add(group);
    }

    _addDisplayOptionsGroup(page, settings) {
        const group = new Adw.PreferencesGroup({
            title: 'Display Options',
            description: 'Configure what information to show in the panel',
        });

        this._addSwitch(group, settings, 'show-delta', 'Show Delta');
        this._addSwitch(group, settings, 'show-trend-arrows', 'Show Trend Arrows');
        this._addSwitch(group, settings, 'show-elapsed-time', 'Show Elapsed Time');
        this._addSwitch(group, settings, 'show-icon', 'Show Icon');

       
        const iconPosRow = new Adw.ActionRow({ title: 'Icon Position' });
        const iconPosCombo = new Gtk.ComboBoxText({
            valign: Gtk.Align.CENTER,
        });

        iconPosCombo.append('left', 'Left');
        iconPosCombo.append('right', 'Right');
        
        iconPosCombo.set_active_id(settings.get_string('icon-position'));
        iconPosCombo.connect('changed', () => {
            settings.set_string('icon-position', iconPosCombo.get_active_id());
        });

        iconPosRow.add_suffix(iconPosCombo);
        group.add(iconPosRow);

        page.add(group);
    }

    _addSpinButton(group, settings, key, title, min, max, increment, isMmol = false) {
        const row = new Adw.ActionRow({ title });
        const spinButton = new Gtk.SpinButton({
            adjustment: new Gtk.Adjustment({
                lower: min,
                upper: max,
                step_increment: increment,
                page_increment: increment * 10,
                page_size: 0
            }),
            valign: Gtk.Align.CENTER,
            digits: isMmol ? 1 : 0,
            numeric: true
        });

       
        const storedValue = settings.get_int(key);
        if (isMmol) {
            spinButton.set_value(storedValue / 18.0);
        } else {
            spinButton.set_value(storedValue);
        }

        spinButton.connect('value-changed', () => {
            let value = spinButton.get_value();
            if (isMmol) {
                value = Math.round(value * 18.0);
            }
            settings.set_int(key, value);

           
            this._validateThresholds(settings, key, value);
        });

        row.add_suffix(spinButton);
        group.add(row);
    }

    _validateThresholds(settings, key, value) {
        const urgentHigh = settings.get_int('urgent-high-threshold');
        const high = settings.get_int('high-threshold');
        const low = settings.get_int('low-threshold');
        const urgentLow = settings.get_int('urgent-low-threshold');

       
        switch (key) {
            case 'urgent-high-threshold':
                if (value <= high) {
                    settings.set_int(key, high + 1);
                }
                break;
            case 'high-threshold':
                if (value >= urgentHigh) {
                    settings.set_int(key, urgentHigh - 1);
                } else if (value <= low) {
                    settings.set_int(key, low + 1);
                }
                break;
            case 'low-threshold':
                if (value >= high) {
                    settings.set_int(key, high - 1);
                } else if (value <= urgentLow) {
                    settings.set_int(key, urgentLow + 1);
                }
                break;
            case 'urgent-low-threshold':
                if (value >= low) {
                    settings.set_int(key, low - 1);
                }
                break;
            }
        }

    _addColorButton(group, settings, key, title) {
        const row = new Adw.ActionRow({ title });
        const button = new Gtk.ColorButton({
            valign: Gtk.Align.CENTER,
        });

        const rgba = new Gdk.RGBA();
        rgba.parse(settings.get_string(key));
        button.set_rgba(rgba);

        button.connect('color-set', () => {
            const color = button.get_rgba().to_string();
            settings.set_string(key, color);
        });

        row.add_suffix(button);
        group.add(row);
    }

    _addSwitch(group, settings, key, title) {
        const row = new Adw.ActionRow({ title });
        const toggle = new Gtk.Switch({
            active: settings.get_boolean(key),
            valign: Gtk.Align.CENTER,
        });

        settings.bind(key, toggle, 'active', Gio.SettingsBindFlags.DEFAULT);
        row.add_suffix(toggle);
        group.add(row);
    }

    _addAdvancedOptionsGroup(page, settings) {
        const group = new Adw.PreferencesGroup({
            title: 'Developer Options',
            description: 'Advanced settings for troubleshooting',
        });

        this._addSwitch(group, settings, 'enable-debug-logs', 'Enable Debug Logs');

        page.add(group);
    }
}