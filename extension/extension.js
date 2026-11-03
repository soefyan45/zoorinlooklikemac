import GLib from 'gi://GLib';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {DockZoom} from './dockzoom.js';
import {setLanguage} from './i18n.js';
import {Notch} from './notch.js';
import {ThemeManager} from './theme.js';

const LOG_PREFIX = '[zorin-notch]';

// Power actions only log when this is set (always on in the nested test session)
const DRY_RUN = !!GLib.getenv('ZORIN_NOTCH_DRY_RUN');
const SELFTEST = !!GLib.getenv('ZORIN_NOTCH_SELFTEST');

let selfTestStarted = false;

export default class ZorinNotchExtension extends Extension {
    get notch() {
        return this._notch;
    }

    enable() {
        console.log(LOG_PREFIX, `enable (dry-run: ${DRY_RUN})`);
        this._settings = this.getSettings();
        setLanguage(this._settings.get_string('language'));
        // The notch builds its texts once; a new language rebuilds it
        this._settings.connectObject('changed::language', () => {
            setLanguage(this._settings.get_string('language'));
            this._destroyNotch();
            this._createNotch();
        }, this);

        // Dark, light or following GNOME's dark mode, plus the accent color
        try {
            this._theme = new ThemeManager(this._settings, () => {
                this._notch?.onThemeChanged();
                this._dockZoom?.onThemeChanged();
            });
        } catch (e) {
            console.error(LOG_PREFIX, 'failed to set up the theme', e);
            this._theme = null;
        }

        this._createNotch();
        try {
            this._dockZoom = new DockZoom(this._settings, this._theme);
        } catch (e) {
            console.error(LOG_PREFIX, 'failed to set up dock zoom', e);
            this._dockZoom = null;
        }

        if (SELFTEST && !selfTestStarted) {
            selfTestStarted = true;
            import('./devtools.js')
                .then(devtools => devtools.runSelfTest(this))
                .catch(e => console.error(LOG_PREFIX, 'self test failed to load', e));
        }
    }

    _createNotch() {
        try {
            this._notch = new Notch({
                settings: this._settings,
                theme: this._theme,
                openPreferences: () => this.openPreferences(),
            });
        } catch (e) {
            console.error(LOG_PREFIX, 'failed to create the notch', e);
            this._destroyNotch();
        }
    }

    _destroyNotch() {
        this._notch?.destroy();
        this._notch = null;
    }

    disable() {
        console.log(LOG_PREFIX, 'disable');
        this._settings?.disconnectObject(this);
        this._dockZoom?.destroy();
        this._dockZoom = null;
        this._destroyNotch();
        this._theme?.destroy();
        this._theme = null;
        this._settings = null;
    }
}
