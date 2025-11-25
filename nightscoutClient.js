'use strict';

import GLib from 'gi://GLib';
import Soup from 'gi://Soup';
import Gio from 'gi://Gio';

export class NightscoutClient {
    constructor(url, apiSecret, unit = 'mg/dL', settings = null) {
        this._settings = settings;

        this._log = (message, data = null) => {
            if (this._settings && this._settings.get_boolean('enable-debug-logs')) {
                if (data) {
                    console.log(`[NightscoutClient] ${message}`, data);
                } else {
                    console.log(`[NightscoutClient] ${message}`);
                }
            }
        };

        // Clean URL - remove trailing slash
        this._baseUrl = url ? url.replace(/\/$/, '') : '';
        this._apiSecret = apiSecret || '';
        this._unit = unit;

        // Create HTTP session
        this._session = new Soup.Session();
        this._session.timeout = 30;

        // Store previous reading for delta calculation
        this._previousReading = null;
        this._previousDelta = null;

        this._log('NightscoutClient initialized:', {
            baseUrl: this._baseUrl,
            unit: this._unit,
            hasApiSecret: !!this._apiSecret
        });
    }

    async _makeRequest(url, method = 'GET') {
        try {
            const message = new Soup.Message({
                method,
                uri: GLib.Uri.parse(url, GLib.UriFlags.NONE)
            });

            const headers = message.get_request_headers();
            headers.append('Content-Type', 'application/json');
            headers.append('Accept', 'application/json');

            // Add API secret if provided
            if (this._apiSecret) {
                headers.append('api-secret', this._apiSecret);
            }

            this._log(`Making request to: ${url}`);

            const response = await this._session.send_and_read_async(message,
                GLib.PRIORITY_DEFAULT, null);

            const statusCode = message.status_code;
            const responseText = new TextDecoder().decode(response.get_data());

            this._log(`Response status: ${statusCode}`);

            if (statusCode === 200) {
                try {
                    return JSON.parse(responseText);
                } catch {
                    return responseText;
                }
            }

            // Handle specific error codes
            if (statusCode === 401) {
                throw new Error('UNAUTHORIZED: Invalid API secret. Please check your Nightscout API secret.');
            }

            if (statusCode === 429) {
                throw new Error('RATE_LIMITED: Too many requests. Please wait a few minutes before trying again.');
            }

            if (statusCode === 404) {
                throw new Error('NOT_FOUND: Nightscout URL not found. Please check your Nightscout URL.');
            }

            throw new Error(`Request failed with status ${statusCode}: ${responseText}`);

        } catch (error) {
            this._log('Request failed:', error);

            // Handle network/connection errors
            const errorString = error.toString();
            if (errorString.includes('Gio.IOErrorEnum') ||
                errorString.includes('No route to host') ||
                errorString.includes('timed out') ||
                errorString.includes('Could not connect')) {
                throw new Error('NETWORK_ERROR: Connection failed. Please check your internet connection and Nightscout URL.');
            }

            throw error;
        }
    }

    async getLatestGlucose() {
        try {
            if (!this._baseUrl) {
                throw new Error('Nightscout URL is not configured');
            }

            // Fetch current entry from Nightscout
            const url = `${this._baseUrl}/api/v1/entries/current.json`;
            this._log('[DEBUG] Fetching from Nightscout:', url);

            const entries = await this._makeRequest(url, 'GET');
            this._log('[DEBUG] Raw Nightscout response:', JSON.stringify(entries));

            // Handle both array and single object responses
            let entry;
            if (Array.isArray(entries)) {
                if (entries.length === 0) {
                    throw new Error('No readings available');
                }
                entry = entries[0];
            } else if (entries && entries.sgv !== undefined) {
                entry = entries;
            } else {
                throw new Error('Invalid response format from Nightscout');
            }

            this._log('[DEBUG] Processing entry:', JSON.stringify(entry));
            const reading = this._formatReading(entry);
            return reading;

        } catch (error) {
            this._log('[DEBUG] Error in getLatestGlucose:', error.message);
            throw error;
        }
    }

    _formatReading(entry) {
        // Get timestamp - Nightscout uses mills or dateString
        let timestamp;
        if (entry.mills) {
            timestamp = entry.mills;
        } else if (entry.date) {
            timestamp = entry.date;
        } else if (entry.dateString) {
            timestamp = new Date(entry.dateString).getTime();
        } else {
            timestamp = Date.now();
        }

        // Get glucose value
        let value = entry.sgv;
        if (this._unit === 'mmol/L') {
            value = (entry.sgv / 18.0).toFixed(1);
        }

        // Calculate delta
        let delta = 0;
        const trend = this._mapDirection(entry.direction);

        if (this._previousReading) {
            const prevTimestamp = this._previousReading.mills || this._previousReading.date;
            const timeDiff = timestamp - prevTimestamp;

            // Only calculate delta if readings are within 15 minutes
            if (timeDiff <= 900000) {
                const prevValue = this._previousReading.sgv;
                delta = entry.sgv - prevValue;

                if (this._unit === 'mmol/L') {
                    delta = (delta / 18.0);
                }
            }
        }

        // Use previous delta if current is 0
        if (delta === 0 && this._previousDelta) {
            if (Math.abs(this._previousDelta) <= 2.0) {
                delta = this._previousDelta;
                this._log('[DEBUG] Preserving previous delta:', delta);
            }
        }

        // Estimate delta from trend if still 0
        if (delta === 0) {
            const trendDeltas = {
                'DOUBLE_UP': this._unit === 'mmol/L' ? 0.17 : 3.0,
                'SINGLE_UP': this._unit === 'mmol/L' ? 0.11 : 2.0,
                'FORTY_FIVE_UP': this._unit === 'mmol/L' ? 0.06 : 1.0,
                'FLAT': 0.0,
                'FORTY_FIVE_DOWN': this._unit === 'mmol/L' ? -0.06 : -1.0,
                'SINGLE_DOWN': this._unit === 'mmol/L' ? -0.11 : -2.0,
                'DOUBLE_DOWN': this._unit === 'mmol/L' ? -0.17 : -3.0
            };
            delta = trendDeltas[trend] || 0;
        }

        // Correct trend based on delta
        const finalTrend = this._correctTrend(trend, delta);

        // Store for next delta calculation
        this._previousReading = {...entry, mills: timestamp};
        this._previousDelta = delta;

        const formattedReading = {
            value: value,
            unit: this._unit,
            trend: finalTrend,
            timestamp: new Date(timestamp),
            delta: Number(delta).toFixed(1)
        };

        this._log('[DEBUG] Formatted reading:', formattedReading);
        return formattedReading;
    }

    _mapDirection(direction) {
        if (!direction) return 'FLAT';

        // Nightscout direction mapping
        const directionMap = {
            // Standard Nightscout directions
            'DoubleUp': 'DOUBLE_UP',
            'SingleUp': 'SINGLE_UP',
            'FortyFiveUp': 'FORTY_FIVE_UP',
            'Flat': 'FLAT',
            'FortyFiveDown': 'FORTY_FIVE_DOWN',
            'SingleDown': 'SINGLE_DOWN',
            'DoubleDown': 'DOUBLE_DOWN',
            'NOT COMPUTABLE': 'NOT_COMPUTABLE',
            'RATE OUT OF RANGE': 'RATE_OUT_OF_RANGE',
            'None': 'FLAT',

            // Uppercase variants
            'DOUBLE_UP': 'DOUBLE_UP',
            'SINGLE_UP': 'SINGLE_UP',
            'FORTY_FIVE_UP': 'FORTY_FIVE_UP',
            'FLAT': 'FLAT',
            'FORTY_FIVE_DOWN': 'FORTY_FIVE_DOWN',
            'SINGLE_DOWN': 'SINGLE_DOWN',
            'DOUBLE_DOWN': 'DOUBLE_DOWN',

            // Dexcom API style (without underscores)
            'DoubleUp': 'DOUBLE_UP',
            'SingleUp': 'SINGLE_UP',
            'FortyFiveUp': 'FORTY_FIVE_UP',
            'FortyFiveDown': 'FORTY_FIVE_DOWN',
            'SingleDown': 'SINGLE_DOWN',
            'DoubleDown': 'DOUBLE_DOWN'
        };

        return directionMap[direction] || 'FLAT';
    }

    _correctTrend(trend, delta) {
        let correctedTrend = trend;

        if (delta < -3.0 && (trend === 'FLAT' || trend === 'FORTY_FIVE_UP' || trend === 'SINGLE_UP')) {
            correctedTrend = 'SINGLE_DOWN';
            this._log('[DEBUG] Trend corrected: Large negative delta -> SINGLE_DOWN');
        } else if (delta < -1.0 && trend === 'FLAT') {
            correctedTrend = 'FORTY_FIVE_DOWN';
            this._log('[DEBUG] Trend corrected: Small negative delta -> FORTY_FIVE_DOWN');
        } else if (delta > 1.0 && delta < 3.0 && trend === 'FLAT') {
            correctedTrend = 'FORTY_FIVE_UP';
            this._log('[DEBUG] Trend corrected: Small positive delta -> FORTY_FIVE_UP');
        } else if (delta > 3.0 && (trend === 'FLAT' || trend === 'FORTY_FIVE_DOWN' || trend === 'SINGLE_DOWN')) {
            correctedTrend = 'SINGLE_UP';
            this._log('[DEBUG] Trend corrected: Large positive delta -> SINGLE_UP');
        }

        return correctedTrend;
    }
}
