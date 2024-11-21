import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class DexcomPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        // Create pages
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

        window.add(accountPage);
        window.add(thresholdPage);
        window.add(displayPage);

        // Add groups to pages
        this._addDexcomAccountGroup(accountPage, settings);
        this._addThresholdGroup(thresholdPage, settings);
        this._addColorGroup(thresholdPage, settings);
        this._addDisplayOptionsGroup(displayPage, settings);
        this._addAppearanceGroup(displayPage, settings);
    }

    _addDexcomAccountGroup(page, settings) {
        const group = new Adw.PreferencesGroup({
            title: 'Dexcom Share Account',
            description: 'Enter your Dexcom Share credentials',
        });

        // Username
        const usernameRow = new Adw.EntryRow({
            title: 'Username',
        });
        usernameRow.connect('changed', () => {
            settings.set_string('username', usernameRow.get_text());
        });
        usernameRow.set_text(settings.get_string('username'));
        group.add(usernameRow);

        // Password
        const passwordRow = new Adw.PasswordEntryRow({
            title: 'Password',
        });
        passwordRow.connect('changed', () => {
            settings.set_string('password', passwordRow.get_text());
        });
        passwordRow.set_text(settings.get_string('password'));
        group.add(passwordRow);

        // Region
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

        // Update interval
        this._addSpinButton(group, settings, 'update-interval',
            'Update Interval (seconds)', 60, 600, 30);

        page.add(group);
    }
    _addThresholdGroup(page, settings) {
        const group = new Adw.PreferencesGroup({
            title: 'Glucose Thresholds',
            description: 'Set glucose threshold values (mg/dL)',
        });

        // Urgent High Threshold
        this._addSpinButton(group, settings, 'urgent-high-threshold', 
            'Urgent High Threshold', 180, 400, 1);

        // High Threshold
        this._addSpinButton(group, settings, 'high-threshold',
            'High Threshold', 140, 300, 1);

        // Low Threshold
        this._addSpinButton(group, settings, 'low-threshold',
            'Low Threshold', 60, 120, 1);

        // Urgent Low Threshold
        this._addSpinButton(group, settings, 'urgent-low-threshold',
            'Urgent Low Threshold', 40, 80, 1);

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

        page.add(group);
    }

    _addSpinButton(group, settings, key, title, min, max, increment) {
        const row = new Adw.ActionRow({ title });
        const spinButton = new Gtk.SpinButton({
            adjustment: new Gtk.Adjustment({
                lower: min,
                upper: max,
                step_increment: increment,
            }),
            valign: Gtk.Align.CENTER,
        });

        settings.bind(key, spinButton, 'value', Gio.SettingsBindFlags.DEFAULT);
        row.add_suffix(spinButton);
        group.add(row);

        // Add validation
        spinButton.connect('value-changed', () => {
            const value = spinButton.get_value();
            const urgentHigh = settings.get_int('urgent-high-threshold');
            const high = settings.get_int('high-threshold');
            const low = settings.get_int('low-threshold');
            const urgentLow = settings.get_int('urgent-low-threshold');

            if (key === 'urgent-high-threshold' && value <= high) {
                spinButton.set_value(high + 1);
            } else if (key === 'high-threshold' && (value >= urgentHigh || value <= low)) {
                spinButton.set_value(Math.min(urgentHigh - 1, Math.max(low + 1, value)));
            } else if (key === 'low-threshold' && (value >= high || value <= urgentLow)) {
                spinButton.set_value(Math.min(high - 1, Math.max(urgentLow + 1, value)));
            } else if (key === 'urgent-low-threshold' && value >= low) {
                spinButton.set_value(low - 1);
            }
        });
    }

    _addColorButton(group, settings, key, title) {
        const row = new Adw.ActionRow({ title });
        const button = new Gtk.ColorButton({
            valign: Gtk.Align.CENTER,
        });

        // Set initial color from settings
        const rgba = new Gdk.RGBA();
        rgba.parse(settings.get_string(key));
        button.set_rgba(rgba);

        // Connect color change signal
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
}