import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup';

export default class DexcomExtension extends Extension {
    enable() {
        this._indicator = new PanelMenu.Button(0.0, 'Dexcom Monitor', false);
        this._label = new St.Label({ text: 'Dexcom Monitor', y_align: Clutter.ActorAlign.CENTER });
        this._indicator.add_child(this._label);
        Main.panel.addToStatusArea(this.uuid, this._indicator);

        let settings = new Gio.Settings({ schema_id: 'org.gnome.shell.extensions.dexcom' });
        this._username = settings.get_string('username');
        this._password = settings.get_string('password');

        this._updateGlucose().catch(e => logError(`Error in updateGlucose: ${e}`));

        this._timeout = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 180, () => {
            this._updateGlucose().catch(e => logError(`Error in updateGlucose: ${e}`));
            return GLib.SOURCE_CONTINUE;
        });
    }

    disable() {
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }

        if (this._timeout) {
            GLib.source_remove(this._timeout);
            this._timeout = null;
        }

        if (this._label) {
            this._label.destroy();
            this._label = null;
        }
    }

    async _updateGlucose() {
        try {
            log("Updating glucose data...");
            let glucoseData = await this._fetchGlucoseData(this._username, this._password, true);
            
            if (glucoseData) {
                let glucoseValue = glucoseData.Value;
                log(`Glucose value: ${glucoseValue}`);
                if (glucoseValue >= 210) {
                    this._label.set_style("color: yellow;");
                } else if (glucoseValue < 90) {
                    this._label.set_style("color: red;");
                } else {
                    this._label.set_style("color: green;");
                }
                this._label.set_text(`${glucoseValue} mg/dL`);
            } else {
                log("No glucose data available.");
                this._label.set_text("No Data");
            }
        } catch (error) {
            logError(`Error fetching or processing glucose data: ${error}`);
        }
    }

    _fetchGlucoseData(username, password, ous = false) {
        return new Promise((resolve, reject) => {
            try {
                const dexcomLoginUrl = ous
                    ? 'https://shareous1.dexcom.com/ShareWebServices/Services/General/LoginPublisherAccount'
                    : 'https://share2.dexcom.com/ShareWebServices/Services/General/LoginPublisherAccount';
                
                const dexcomGlucoseUrl = ous
                    ? 'https://shareous1.dexcom.com/ShareWebServices/Services/Publisher/ReadPublisherLatestGlucoseValues?sessionId=SESSION_ID&minutes=1440&maxCount=1'
                    : 'https://share2.dexcom.com/ShareWebServices/Services/Publisher/ReadPublisherLatestGlucoseValues?sessionId=SESSION_ID&minutes=1440&maxCount=1';

                const session = new Soup.Session();
                let loginMessage = Soup.Message.new('POST', dexcomLoginUrl);

                let requestBody = JSON.stringify({
                    "accountName": username,
                    "password": password,
                    "applicationId": "d89443d2-327c-4a6f-89e5-496bbb0317db"
                });

                loginMessage.set_request_body_from_bytes('application/json', new GLib.Bytes(requestBody));

                session.send_async(loginMessage, null, null, (session, result) => {
                    let response = session.send_finish(result);
                    if (response.status_code !== 200) {
                        reject(new Error(`Login failed with status ${response.status_code}`));
                        return;
                    }
                    let sessionId = response.response_body.data.trim();
                    log(`Session ID retrieved: ${sessionId}`);

                    let glucoseMessage = Soup.Message.new('GET', dexcomGlucoseUrl.replace('SESSION_ID', sessionId));
                    session.send_async(glucoseMessage, null, null, (session, result) => {
                        let glucoseResponse = session.send_finish(result);
                        if (glucoseResponse.status_code !== 200) {
                            reject(new Error(`Glucose data fetch failed with status ${glucoseResponse.status_code}`));
                            return;
                        }

                        let glucoseData = JSON.parse(glucoseResponse.response_body.data);
                        log(`Glucose data received: ${glucoseResponse.response_body.data}`);
                        resolve(glucoseData[0]);
                    }, null);
                }, null);
            } catch (error) {
                reject(error);
            }
        });
    }
}
