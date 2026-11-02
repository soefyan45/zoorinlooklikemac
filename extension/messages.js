// Notifications for the notch (states 05 and 07).
//
// GNOME decides which notifications deserve a banner (do not disturb, per-app policy, urgency,
// fullscreen) and queues them; MessageTray._showNotification then pops one off the queue to
// show it. We override only that last step: the queued notifications go to the notch instead
// of GNOME's banner. Everything else, including the notification list in GNOME's calendar
// menu, stays untouched. The override is removed in destroy().

import {InjectionManager} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';

import {LOG_PREFIX, trace} from './log.js';


export class NotificationSource {
    /**
     * @param {object} callbacks - {onPopup(notification), onChange()}
     */
    constructor({onPopup, onChange}) {
        this._onPopup = onPopup;
        this._onChange = onChange;

        const source = this;
        this._injections = new InjectionManager();
        this._injections.overrideMethod(MessageTray.MessageTray.prototype, '_showNotification',
            original => function () {
                if (!source._onPopup) {
                    original.call(this);
                    return;
                }
                const queue = this._notificationQueue.splice(0);
                trace(`banner queue -> notch: ${queue.map(n => n.title).join(', ')}`);
                this.emit('queue-changed');
                for (const notification of queue) {
                    try {
                        source._onPopup(notification);
                    } catch (e) {
                        console.error(LOG_PREFIX, 'notification popup failed', e);
                    }
                }
            });

        Main.messageTray.connectObject(
            'source-added', (_tray, s) => this._watchSource(s),
            'source-removed', () => this._onChange(),
            this);
        Main.messageTray.getSources().forEach(s => this._watchSource(s));
    }

    _watchSource(source) {
        source.connectObject(
            'notification-request-banner', (_s, notification) => {
                trace(`banner requested: ${notification.title} urgency=${notification.urgency} ` +
                    `ack=${notification.acknowledged} showBanners=${source.policy?.showBanners}`);
            },
            'notification-added', (_s, notification) => {
                notification.connectObject('notify::acknowledged', () => this._onChange(), this);
                this._onChange();
            },
            'notification-removed', () => this._onChange(),
            this);
        source.notifications.forEach(n =>
            n.connectObject('notify::acknowledged', () => this._onChange(), this));
        this._onChange();
    }

    // All notifications in GNOME's list, newest first
    list() {
        const all = [];
        for (const source of Main.messageTray.getSources())
            all.push(...source.notifications);
        return all.sort((a, b) => (b.datetime?.to_unix() ?? 0) - (a.datetime?.to_unix() ?? 0));
    }

    get unreadCount() {
        return Main.messageTray.getSources().reduce((sum, s) => sum + s.unseenCount, 0);
    }

    markAllRead() {
        for (const notification of this.list())
            notification.acknowledged = true;
    }

    // Same as "Clear" in GNOME's notification list: resident notifications stay
    clearAll() {
        for (const notification of this.list()) {
            if (!notification.resident)
                notification.destroy(MessageTray.NotificationDestroyedReason.DISMISSED);
        }
    }

    destroy() {
        this._injections.clear();
        this._injections = null;
        this._onPopup = null;
        Main.messageTray.disconnectObject(this);
        for (const source of Main.messageTray.getSources()) {
            source.disconnectObject(this);
            source.notifications.forEach(n => n.disconnectObject(this));
        }
    }
}

// "sekarang", "5 mnt", "2 jam", otherwise the date
export function relativeTime(datetime) {
    if (!datetime)
        return '';
    const seconds = Math.max(0, Math.floor(Date.now() / 1000) - datetime.to_unix());
    if (seconds < 60)
        return 'sekarang';
    if (seconds < 3600)
        return `${Math.floor(seconds / 60)} mnt`;
    if (seconds < 86400)
        return `${Math.floor(seconds / 3600)} jam`;
    return datetime.to_local().format('%-d %b');
}
