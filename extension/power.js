// Power actions for the notch, all through GNOME's SystemActions (the same code as the
// power menu in GNOME's quick settings). Logout, restart and power off go to gnome-session,
// which shows GNOME's confirmation dialog with its countdown and the list of apps that have
// unsaved work. Nothing here calls systemctl or logind directly.
//
// With dryRun set (always in the nested test session) actions are only logged.

import * as SystemActions from 'resource:///org/gnome/shell/misc/systemActions.js';

const LOG_PREFIX = '[zorin-notch]';

const ACTIONS = {
    lock: {can: 'canLockScreen', run: 'activateLockScreen'},
    suspend: {can: 'canSuspend', run: 'activateSuspend'},
    logout: {can: 'canLogout', run: 'activateLogout'},
    restart: {can: 'canRestart', run: 'activateRestart'},
    poweroff: {can: 'canPowerOff', run: 'activatePowerOff'},
};

export class PowerActions {
    constructor({dryRun = false} = {}) {
        this._dryRun = dryRun;
        this._system = SystemActions.getDefault();
    }

    can(id) {
        const action = ACTIONS[id];
        return !!action && !!this._system[action.can];
    }

    run(id) {
        const action = ACTIONS[id];
        if (!action || !this.can(id)) {
            console.warn(LOG_PREFIX, `power action ${id} is not available`);
            return false;
        }
        if (this._dryRun) {
            console.log(LOG_PREFIX, `dry-run: would ${action.run}()`);
            return true;
        }
        try {
            this._system[action.run]();
            return true;
        } catch (e) {
            console.error(LOG_PREFIX, `power action ${id} failed`, e);
            return false;
        }
    }
}
