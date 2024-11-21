// dexcomClient.js
'use strict';

import GLib from 'gi://GLib';
import Soup from 'gi://Soup';
import Gio from 'gi://Gio';

export class DexcomClient {
    constructor(username, password, region = 'ous', unit = 'mg/dL') {
        this._username = username;
        this._password = password;
        this._region = region.toLowerCase();
        this._baseUrls = {
            us: 'https://share2.dexcom.com',
            ous: 'https://shareous1.dexcom.com',
            jp: 'https://shareous1.dexcom.com'
        };
        this._baseUrl = this._baseUrls[this._region] || this._baseUrls.ous;
        this._applicationId = 'd89443d2-327c-4a6f-89e5-496bbb0317db';
        this._sessionId = null;
        this._accountId = null;
        this._unit = unit;
        this._session = new Soup.Session();
    }

    // Helper function to encode URI components safely
    _encodeURIComponent(str) {
        return encodeURIComponent(str).replace(/[!'()*]/g, c => 
            '%' + c.charCodeAt(0).toString(16).toUpperCase()
        );
    }

    // Helper function to build query string
    _buildQueryString(params) {
        return Object.keys(params)
            .map(key => `${this._encodeURIComponent(key)}=${this._encodeURIComponent(params[key])}`)
            .join('&');
    }

    async _makeRequest(url, method = 'GET', data = null, params = null) {
        // Add query parameters if provided
        if (params) {
            url = `${url}?${this._buildQueryString(params)}`;
        }

        const message = new Soup.Message({
            method,
            uri: GLib.Uri.parse(url, GLib.UriFlags.NONE)
        });

        // Set headers
        const headers = message.get_request_headers();
        headers.append('Content-Type', 'application/json');
        headers.append('Accept', 'application/json');
        headers.append('User-Agent', 'Dexcom Share/3.0.2.11');

        // Add body data if provided
        if (data) {
            const bytes = new GLib.Bytes(JSON.stringify(data));
            message.set_request_body_from_bytes('application/json', bytes);
        }

        try {
            const bytes = await this._session.send_and_read_async(message, 
                GLib.PRIORITY_DEFAULT, null);
            
            const status = message.get_status();
            
            // Handle different status codes
            if (status === 500) {
                const text = new TextDecoder().decode(bytes.get_data());
                const error = JSON.parse(text);
                if (error.Code === 'SessionIdNotFound') {
                    this._sessionId = null;
                    throw new Error('SessionIdNotFound');
                }
                throw new Error(error.Message || 'Server error');
            }
            
            if (status !== Soup.Status.OK) {
                throw new Error(`Request failed with status ${status}`);
            }

            const text = new TextDecoder().decode(bytes.get_data());
            
            try {
                // Try to parse as JSON first
                return JSON.parse(text);
            } catch {
                // If not JSON, return the raw text with quotes removed
                return text.replace(/^"|"$/g, '');
            }
        } catch (error) {
            throw new Error(`Request error: ${error.message}`);
        }
    }

    async authenticate() {
        // Step 1: Get account ID
        const authUrl = `${this._baseUrl}/ShareWebServices/Services/General/AuthenticatePublisherAccount`;
        const authPayload = {
            accountName: this._username,
            password: this._password,
            applicationId: this._applicationId
        };

        try {
            this._accountId = await this._makeRequest(authUrl, 'POST', authPayload);
            
            // Step 2: Get session ID
            const loginUrl = `${this._baseUrl}/ShareWebServices/Services/General/LoginPublisherAccountById`;
            const loginPayload = {
                accountId: this._accountId,
                password: this._password,
                applicationId: this._applicationId
            };

            this._sessionId = await this._makeRequest(loginUrl, 'POST', loginPayload);

            if (this._sessionId === '00000000-0000-0000-0000-000000000000') {
                throw new Error('Invalid credentials');
            }

            return this._sessionId;
        } catch (error) {
            throw new Error(`Authentication error: ${error.message}`);
        }
    }

    async getLatestGlucose() {
        if (!this._sessionId) {
            await this.authenticate();
        }

        try {
            const url = `${this._baseUrl}/ShareWebServices/Services/Publisher/ReadPublisherLatestGlucoseValues`;
            const params = {
                sessionId: this._sessionId,
                minutes: '10',
                maxCount: '1'
            };

            const readings = await this._makeRequest(url, 'POST', null, params);
            
            if (!Array.isArray(readings) || readings.length === 0) {
                throw new Error('No readings available');
            }

            return this._formatReading(readings[0]);
        } catch (error) {
            if (error.message.includes('SessionIdNotFound')) {
                this._sessionId = null;
                return this.getLatestGlucose();
            }
            throw error;
        }
    }

    _formatReading(reading) {
        const TREND_ARROWS = {
            'None': '→',
            'DoubleUp': '↑↑',
            'SingleUp': '↑',
            'FortyFiveUp': '↗',
            'Flat': '→',
            'FortyFiveDown': '↘',
            'SingleDown': '↓',
            'DoubleDown': '↓↓',
            'NotComputable': '?',
            'RateOutOfRange': '⚠️'
        };

        let value = reading.Value;
        if (this._unit === 'mmol/L') {
            value = (reading.Value / 18.0).toFixed(1);
        }

        let delta = 0;
        if (this._previousReading) {
            const prevValue = this._unit === 'mmol/L' ? 
                (this._previousReading.Value / 18.0) : 
                this._previousReading.Value;
                
            delta = value - prevValue;
        }
        this._previousReading = reading;
    
        return {
            value: value,
            unit: this._unit,
            trend: reading.Trend,
            trendArrow: TREND_ARROWS[reading.Trend] || '?',
            timestamp: new Date(parseInt(reading.WT.match(/\d+/)[0])),
            delta: delta.toFixed(1)
        };
    }
}
