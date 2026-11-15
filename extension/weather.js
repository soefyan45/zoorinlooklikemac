// Weather for the desktop widgets (Pego "Widget Cuaca"), from Open-Meteo: free, no key or account;
// only the coordinates are sent. Where: the device's location from GNOME (Geoclue, when location
// services are on and Preferences > Widget > Automatic location is set), else the city typed in
// the preferences, found with Open-Meteo's geocoding. Fetched again every 15 minutes while a
// weather widget is shown.

import Geoclue from 'gi://Geoclue';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GWeather from 'gi://GWeather?version=4.0';
import Soup from 'gi://Soup?version=3.0';

import {_} from './i18n.js';
import {LOG_PREFIX} from './log.js';

Gio._promisify(Geoclue.Simple, 'new');
Gio._promisify(Soup.Session.prototype, 'send_and_read_async');

const REFRESH_SECONDS = 15 * 60;
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search';
// Rain this likely within the next hours gets a line of its own
const RAIN_CHANCE = 50;
const RAIN_HOURS = 12;

// WMO weather codes: [icon kind, description]
const CODES = [
    [[0], 'clear', 'Clear sky'],
    [[1], 'few-clouds', 'Mostly clear'],
    [[2], 'few-clouds', 'Partly cloudy'],
    [[3], 'overcast', 'Cloudy'],
    [[45, 48], 'fog', 'Fog'],
    [[51, 53, 55, 56, 57], 'drizzle', 'Drizzle'],
    [[61, 63, 80, 81], 'rain', 'Rain'],
    [[65, 66, 67, 82], 'heavy-rain', 'Heavy rain'],
    [[71, 73, 75, 77, 85, 86], 'snow', 'Snow'],
    [[95, 96, 99], 'storm', 'Thunderstorm'],
];

const ICONS = {
    'clear': ['weather-clear-symbolic', 'weather-clear-night-symbolic', 'sun'],
    'few-clouds': ['weather-few-clouds-symbolic', 'weather-few-clouds-night-symbolic', 'sun'],
    'overcast': ['weather-overcast-symbolic', 'weather-overcast-symbolic', 'cloud'],
    'fog': ['weather-fog-symbolic', 'weather-fog-symbolic', 'cloud'],
    'drizzle': ['weather-showers-scattered-symbolic', 'weather-showers-scattered-symbolic', 'rain'],
    'rain': ['weather-showers-symbolic', 'weather-showers-symbolic', 'rain'],
    'heavy-rain': ['weather-showers-symbolic', 'weather-showers-symbolic', 'rain'],
    'snow': ['weather-snow-symbolic', 'weather-snow-symbolic', 'cloud'],
    'storm': ['weather-storm-symbolic', 'weather-storm-symbolic', 'rain'],
};

/**
 * Icon and words for a WMO code.
 * @returns {{icon: string, tone: string, text: string}} tone: sun, cloud or rain (its color)
 */
export function describe(code, isDay = true) {
    const [, kind, text] = CODES.find(([codes]) => codes.includes(code)) ?? [null, 'overcast', 'Cloudy'];
    const [day, night, tone] = ICONS[kind];
    return {icon: isDay ? day : night, tone: isDay ? tone : tone === 'sun' ? 'cloud' : tone, text: _(text)};
}

// "17.00" from an Open-Meteo local time "2026-11-12T17:00"
export function hourText(iso) {
    return iso?.slice(11, 16).replace(':', '.') ?? '';
}

export class Weather {
    /**
     * @param {Gio.Settings} settings - weather-unit, weather-auto-location, weather-city
     * @param {Function} onChange - called when new weather (or an error) is in
     */
    constructor(settings, onChange) {
        this._settings = settings;
        this._onChange = onChange;
        this._session = new Soup.Session({user_agent: 'Zoorinlooklikemac (GNOME Shell extension)', timeout: 20});
        this._cancellable = new Gio.Cancellable();
        this._timerId = 0;
        this._active = false;
        this._place = null;
        this.data = null;
        this.error = null;
        this._settings.connectObject(
            'changed::weather-unit', () => this.refresh(),
            'changed::weather-auto-location', () => this._relocate(),
            'changed::weather-city', () => this._relocate(), this);
    }

    get placeName() {
        return this._place?.name ?? '';
    }

    // Fetch only while a weather widget is on the desktop
    setActive(active) {
        if (active === this._active)
            return;
        this._active = active;
        if (this._timerId) {
            GLib.source_remove(this._timerId);
            this._timerId = 0;
        }
        if (!active)
            return;
        this.refresh();
        this._timerId = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, REFRESH_SECONDS, () => {
            this.refresh();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _relocate() {
        this._place = null;
        this.refresh();
    }

    async _getJson(url, params) {
        const query = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
        const message = Soup.Message.new('GET', `${url}?${query}`);
        const bytes = await this._session.send_and_read_async(message, GLib.PRIORITY_LOW, this._cancellable);
        if (message.get_status() !== Soup.Status.OK)
            throw new Error(`HTTP ${message.get_status()}`);
        return JSON.parse(new TextDecoder().decode(bytes.get_data()));
    }

    // Device location (Geoclue) or the typed city
    async _locate() {
        if (this._place)
            return this._place;
        if (this._settings.get_boolean('weather-auto-location')) {
            try {
                this._clue ??= await Geoclue.Simple.new('org.gnome.Shell', Geoclue.AccuracyLevel.CITY, this._cancellable);
                const {latitude, longitude} = this._clue.get_location();
                const city = GWeather.Location.get_world()?.find_nearest_city(latitude, longitude);
                this._place = {latitude, longitude, name: city?.get_city_name() ?? city?.get_name() ?? ''};
                return this._place;
            } catch (e) {
                if (this._cancellable.is_cancelled())
                    throw e;
                // Location services off: the typed city
            }
        }
        const city = this._settings.get_string('weather-city').trim();
        if (!city)
            throw new Error(_('Turn on location services or set a city in Preferences › Widget'));
        const found = await this._getJson(GEOCODING_URL, {name: city, count: 1, language: 'id', format: 'json'});
        const result = found.results?.[0];
        if (!result)
            throw new Error(_('City not found: {0}', city));
        this._place = {latitude: result.latitude, longitude: result.longitude, name: result.name};
        return this._place;
    }

    async refresh() {
        if (!this._active)
            return;
        try {
            const place = await this._locate();
            const json = await this._getJson(FORECAST_URL, {
                latitude: place.latitude.toFixed(3),
                longitude: place.longitude.toFixed(3),
                current: 'temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,is_day',
                hourly: 'temperature_2m,weather_code,precipitation_probability,is_day',
                daily: 'weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,uv_index_max',
                timezone: 'auto',
                forecast_days: 6,
                temperature_unit: this._settings.get_string('weather-unit') === 'f' ? 'fahrenheit' : 'celsius',
                wind_speed_unit: 'kmh',
            });
            this.data = this._shape(json, place);
            this.error = null;
        } catch (e) {
            if (this._cancellable.is_cancelled())
                return;
            console.warn(LOG_PREFIX, 'weather not updated:', e.message);
            this.error = e.message;
        }
        this._onChange();
    }

    // The numbers the widgets show
    _shape(json, place) {
        const {current, hourly, daily} = json;
        const now = current.time;
        let start = hourly.time.findIndex(time => time >= now.slice(0, 13));
        start = Math.max(0, start);
        const hours = [];
        for (let i = start; i < Math.min(hourly.time.length, start + 24); i++) {
            hours.push({
                time: hourly.time[i],
                temp: hourly.temperature_2m[i],
                code: hourly.weather_code[i],
                rain: hourly.precipitation_probability[i] ?? 0,
                isDay: !!hourly.is_day[i],
            });
        }
        const rainHour = hours.slice(0, RAIN_HOURS).find(hour => hour.rain >= RAIN_CHANCE);
        const days = daily.time.map((date, i) => ({
            date,
            code: daily.weather_code[i],
            max: daily.temperature_2m_max[i],
            min: daily.temperature_2m_min[i],
            sunrise: daily.sunrise[i],
            sunset: daily.sunset[i],
            uv: daily.uv_index_max[i],
        }));
        return {
            place: place.name,
            time: now,
            temp: current.temperature_2m,
            feels: current.apparent_temperature,
            humidity: current.relative_humidity_2m,
            wind: current.wind_speed_10m,
            code: current.weather_code,
            isDay: !!current.is_day,
            unit: this._settings.get_string('weather-unit') === 'f' ? '°F' : '°C',
            hours,
            days,
            rain: rainHour ? {time: rainHour.time, chance: rainHour.rain} : null,
        };
    }

    destroy() {
        this._cancellable.cancel();
        this.setActive(false);
        this._settings.disconnectObject(this);
        this._session.abort();
        this._clue = null;
    }
}
