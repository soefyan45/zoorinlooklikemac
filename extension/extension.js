import GLib from 'gi://GLib';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {DockZoom} from './dockzoom.js';
import {Notch} from './notch.js';

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
        try {
            this._notch = new Notch();
        } catch (e) {
            console.error(LOG_PREFIX, 'failed to create the notch', e);
            this._notch?.destroy();
            this._notch = null;
        }
        try {
            this._dockZoom = new DockZoom();
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

    disable() {
        console.log(LOG_PREFIX, 'disable');
        this._dockZoom?.destroy();
        this._dockZoom = null;
        this._notch?.destroy();
        this._notch = null;
    }
}
