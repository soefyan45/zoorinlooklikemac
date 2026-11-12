// System info on screen (Pego "Bar sistem"):
//   SystemChip  - CPU load and temperature (and what else is picked) in the status row or the bar
//   SystemPanel - the detail that drops below it when clicked: CPU with its chart and the busiest
//                 apps, GPU, memory, SSD and network, in the style picked in the preferences
// The numbers come from SystemStats (sysinfo.js).

import Clutter from 'gi://Clutter';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {_, decimal} from './i18n.js';
import {LOG_PREFIX} from './log.js';
import {parseColor} from './shape.js';
import {SystemItem, SystemStats, TEMP_COLORS, degrees, formatBytes, formatSpeed, tempLevel} from './sysinfo.js';

const PANEL_WIDTH = 360;
const MINI_BARS = 6;
const ANIMATION_MS = 160;
const MONITOR_APPS = ['org.gnome.SystemMonitor.desktop', 'gnome-system-monitor.desktop'];
export const CHART_COLORS = {teal: '#4FD1C5', blue: '#0A84FF', purple: '#BF5AF2', white: '#FFFFFF'};

function label(text, styleClass) {
    return new St.Label({text, style_class: styleClass, y_align: Clutter.ActorAlign.CENTER});
}

function icon(name, styleClass = 'zorin-notch-sys-icon') {
    return new St.Icon({icon_name: name, fallback_icon_name: 'computer-symbolic', style_class: styleClass});
}

function dot() {
    return new St.Widget({style_class: 'zorin-notch-sys-dot', y_align: Clutter.ActorAlign.CENTER});
}

function setDotColor(widget, temp, warning) {
    widget.style = `background-color: ${TEMP_COLORS[tempLevel(temp, warning)]};`;
}

// Bars of the last loads, drawn with Cairo (the mini graph in the bar, the chart in the panel)
function barChart(widthPx, heightPx, count, gapPx, getState) {
    const area = new St.DrawingArea({width: widthPx, height: heightPx, y_align: Clutter.ActorAlign.CENTER});
    area.connect('repaint', drawing => {
        const cr = drawing.get_context();
        try {
            const [w, h] = drawing.get_surface_size();
            const {values, color, dim = 0.45} = getState();
            const [r, g, b] = parseColor(color);
            const scale = w / widthPx;
            const gap = gapPx * scale;
            const barW = (w - gap * (count - 1)) / count;
            const recent = values.slice(-count);
            const offset = count - recent.length;
            const radius = barW / 2;
            const pill = (x, barH) => {
                cr.newPath();
                cr.arc(x + radius, h - barH + radius, radius, Math.PI, 0);
                cr.arc(x + radius, h - radius, radius, 0, Math.PI);
                cr.closePath();
            };
            // A faint track for every slot, so a quiet CPU still reads as a chart
            for (let i = 0; i < count; i++) {
                pill(i * (barW + gap), h);
                cr.setSourceRGBA(1, 1, 1, 0.08);
                cr.fill();
            }
            recent.forEach((value, i) => {
                // Small loads still show as a short bar, not a dot
                const barH = Math.max(barW * 1.6, h * Math.min(100, Math.max(6, value)) / 100);
                pill((offset + i) * (barW + gap), barH);
                // The newest two are full color, the older ones softer
                cr.setSourceRGBA(r, g, b, i >= recent.length - 2 ? 1 : dim);
                cr.fill();
            });
        } finally {
            cr.$dispose();
        }
    });
    return area;
}

/**
 * CPU load and temperature, plus the other picked items, in one row.
 * compact: only CPU load and temperature (the status row has little room)
 */
export class SystemChip {
    constructor({compact = false} = {}) {
        this._compact = compact;
        this.actor = new St.BoxLayout({style_class: 'zorin-notch-sys-chip'});
        this._state = {values: [], color: '#FFFFFF', dim: 0.55};

        this._cpuIcon = icon('cpu-symbolic');
        this._load = label('', 'zorin-notch-sys-value');
        this._graph = barChart(20, 14, MINI_BARS, 2, () => this._state);
        this._sep = new St.Widget({style_class: 'zorin-notch-sys-sep', y_align: Clutter.ActorAlign.CENTER});
        this._tempIcon = icon('temperature-symbolic');
        this._temp = label('', 'zorin-notch-sys-value');
        this._dot = dot();
        this._extra = new St.BoxLayout({style_class: 'zorin-notch-sys-chip'});
        for (const child of [this._cpuIcon, this._load, this._graph, this._sep, this._tempIcon, this._temp, this._dot, this._extra])
            this.actor.add_child(child);
    }

    /** @param {object} o - {stats, history, items, graph, warning} */
    update({stats, history, items, graph, warning}) {
        this.actor.visible = !!stats?.cpu;
        if (!stats?.cpu)
            return;
        const has = item => items.includes(item);
        const showLoad = has(SystemItem.CPU_LOAD) || this._compact;
        const showTemp = (has(SystemItem.CPU_TEMP) || this._compact) && typeof stats.cpu.temp === 'number';
        this._cpuIcon.visible = this._load.visible = showLoad;
        this._graph.visible = showLoad && graph && !this._compact;
        this._sep.visible = showLoad && showTemp;
        this._tempIcon.visible = this._temp.visible = this._dot.visible = showTemp;
        this._load.text = `${Math.round(stats.cpu.load)}%`;
        this._temp.text = degrees(stats.cpu.temp);
        setDotColor(this._dot, stats.cpu.temp, warning);
        this._state = {values: history, color: '#FFFFFF', dim: 0.55};
        this._graph.queue_repaint();

        this._extra.destroy_all_children();
        this._extra.visible = !this._compact;
        if (this._compact)
            return;
        if (has(SystemItem.GPU) && typeof stats.gpu?.load === 'number') {
            this._extra.add_child(icon('video-display-symbolic'));
            this._extra.add_child(label(`${Math.round(stats.gpu.load)}%`, 'zorin-notch-sys-value'));
        }
        if (has(SystemItem.MEMORY) && stats.mem) {
            this._extra.add_child(icon('memory-symbolic'));
            this._extra.add_child(label(formatBytes(stats.mem.used), 'zorin-notch-sys-value'));
        }
        if (has(SystemItem.SSD_TEMP) && typeof stats.ssd?.temp === 'number') {
            this._extra.add_child(icon('drive-harddisk-solidstate-symbolic'));
            this._extra.add_child(label(degrees(stats.ssd.temp), 'zorin-notch-sys-value'));
        }
        if (has(SystemItem.NETWORK) && stats.net) {
            this._extra.add_child(icon('network-transmit-receive-symbolic'));
            this._extra.add_child(label(`↓ ${formatSpeed(stats.net.rx)}`, 'zorin-notch-sys-value'));
        }
        this._extra.visible = this._extra.get_n_children() > 0;
    }
}

function card(styleClass = 'zorin-notch-sys-card') {
    return new St.BoxLayout({style_class: styleClass, vertical: true, x_expand: true});
}

function cardLabel(iconName, text) {
    const row = new St.BoxLayout({style_class: 'zorin-notch-sys-card-label'});
    row.add_child(icon(iconName, 'zorin-notch-sys-card-icon'));
    row.add_child(label(text, 'zorin-notch-sys-muted'));
    return row;
}

function bar(fraction) {
    const track = new St.Widget({style_class: 'zorin-notch-sys-bar', x_expand: true, layout_manager: new Clutter.BinLayout()});
    const fill = new St.Widget({style_class: 'zorin-notch-sys-bar-fill', x_align: Clutter.ActorAlign.START, y_expand: true});
    track.add_child(fill);
    track.connect('notify::width', () => {
        fill.width = Math.round(track.width * Math.max(0, Math.min(1, fraction)));
    });
    return track;
}

/**
 * The detail panel's content.
 * actions: {openPreferences(), openMonitor()}
 */
class SystemView {
    constructor(actions) {
        this._actions = actions;
        this.actor = new St.BoxLayout({style_class: 'zorin-notch-sys-view', vertical: true});
        this._chartState = {values: [], color: '#F05A24'};
    }

    update({stats, history, warning, chartColor, interval}) {
        this.actor.destroy_all_children();
        if (!stats?.cpu) {
            this.actor.add_child(label(_('System info needs the zorin-notchd daemon'), 'zorin-notch-sys-muted'));
            return;
        }

        const head = new St.BoxLayout({style_class: 'zorin-notch-sys-head'});
        const titles = new St.BoxLayout({vertical: true, x_expand: true});
        titles.add_child(label(_('System'), 'zorin-notch-sys-title'));
        titles.add_child(label(stats.cpu.model, 'zorin-notch-sys-muted'));
        head.add_child(titles);
        const prefs = new St.Button({
            style_class: 'zorin-notch-sys-icon-button',
            child: icon('emblem-system-symbolic'),
            accessible_name: _('Zorin Notch settings'),
            y_align: Clutter.ActorAlign.START,
        });
        prefs.connect('clicked', () => this._actions.openPreferences());
        head.add_child(prefs);
        this.actor.add_child(head);

        // CPU: load, temperature, chart and the busiest apps
        const cpu = card('zorin-notch-sys-card zorin-notch-sys-cpu');
        const top = new St.BoxLayout();
        const load = new St.BoxLayout({vertical: true, x_expand: true});
        const number = new St.BoxLayout({style_class: 'zorin-notch-sys-number'});
        number.add_child(label(`${Math.round(stats.cpu.load)}`, 'zorin-notch-sys-big'));
        number.add_child(label('%', 'zorin-notch-sys-unit'));
        load.add_child(number);
        const ghz = typeof stats.cpu.mhz === 'number' ? `, ${decimal(stats.cpu.mhz / 1000)} GHz` : '';
        load.add_child(label(_('CPU load · {0} threads{1}', stats.cpu.cores, ghz), 'zorin-notch-sys-muted'));
        top.add_child(load);
        if (typeof stats.cpu.temp === 'number') {
            const level = tempLevel(stats.cpu.temp, warning);
            const pill = new St.BoxLayout({style_class: 'zorin-notch-sys-temp-pill', y_align: Clutter.ActorAlign.START});
            pill.style = `color: ${TEMP_COLORS[level]}; background-color: ${TEMP_COLORS[level]}26;`;
            pill.add_child(new St.Icon({icon_name: 'temperature-symbolic', style_class: 'zorin-notch-sys-pill-icon'}));
            pill.add_child(label(`${Math.round(stats.cpu.temp)}°C`, 'zorin-notch-sys-pill-text'));
            top.add_child(pill);
        }
        cpu.add_child(top);
        this._chartState = {values: history, color: chartColor, dim: 0.4};
        const chart = barChart(PANEL_WIDTH - 56, 44, 28, 3, () => this._chartState);
        cpu.add_child(chart);
        if (stats.top?.length) {
            const apps = new St.BoxLayout({style_class: 'zorin-notch-sys-apps'});
            for (const app of stats.top) {
                const pill = new St.BoxLayout({style_class: 'zorin-notch-sys-app', x_expand: true});
                pill.add_child(label(app.name, 'zorin-notch-sys-app-name'));
                pill.add_child(new St.Widget({x_expand: true}));
                pill.add_child(label(`${decimal(app.cpu)}%`, 'zorin-notch-sys-muted'));
                apps.add_child(pill);
            }
            cpu.add_child(apps);
        }
        this.actor.add_child(cpu);

        // GPU and memory
        const row1 = new St.BoxLayout({style_class: 'zorin-notch-sys-row'});
        row1.layout_manager.homogeneous = true;
        const gpu = card();
        gpu.add_child(cardLabel('video-display-symbolic', 'GPU'));
        const gpuLoad = typeof stats.gpu?.load === 'number' ? `${Math.round(stats.gpu.load)}%` : '–';
        gpu.add_child(label(gpuLoad, 'zorin-notch-sys-mid'));
        const gpuNote = [];
        if (typeof stats.gpu?.temp === 'number')
            gpuNote.push(`${Math.round(stats.gpu.temp)}°C`);
        if (typeof stats.gpu?.mhz === 'number' && stats.gpu.mhz > 0)
            gpuNote.push(`${Math.round(stats.gpu.mhz)} MHz`);
        gpuNote.push(stats.gpu?.name ?? _('Not available'));
        gpu.add_child(label(gpuNote.join(' · '), 'zorin-notch-sys-muted'));
        row1.add_child(gpu);

        const mem = card();
        mem.add_child(cardLabel('memory-symbolic', _('Memory')));
        mem.add_child(label(formatBytes(stats.mem.used), 'zorin-notch-sys-mid'));
        mem.add_child(bar(stats.mem.used / Math.max(1, stats.mem.total)));
        mem.add_child(label(_('of {0}', formatBytes(stats.mem.total)), 'zorin-notch-sys-muted'));
        row1.add_child(mem);
        this.actor.add_child(row1);

        // SSD and network
        const row2 = new St.BoxLayout({style_class: 'zorin-notch-sys-row'});
        row2.layout_manager.homogeneous = true;
        const ssd = card();
        ssd.add_child(cardLabel('drive-harddisk-solidstate-symbolic', 'SSD'));
        const ssdValue = new St.BoxLayout({style_class: 'zorin-notch-sys-number'});
        ssdValue.add_child(label(degrees(stats.ssd?.temp).replace('°', '°C'), 'zorin-notch-sys-mid'));
        if (typeof stats.ssd?.temp === 'number') {
            const ssdDot = dot();
            setDotColor(ssdDot, stats.ssd.temp, warning);
            ssdValue.add_child(ssdDot);
        }
        ssd.add_child(ssdValue);
        const disk = SystemStats.disk();
        if (disk) {
            ssd.add_child(bar(1 - disk.free / Math.max(1, disk.size)));
            ssd.add_child(label(_('{0} free of {1}', formatBytes(disk.free), formatBytes(disk.size)), 'zorin-notch-sys-muted'));
        }
        row2.add_child(ssd);

        const net = card();
        net.add_child(cardLabel('network-transmit-receive-symbolic', _('Network')));
        const down = new St.BoxLayout({style_class: 'zorin-notch-sys-number'});
        down.add_child(label('↓', 'zorin-notch-sys-down'));
        down.add_child(label(formatSpeed(stats.net.rx), 'zorin-notch-sys-speed'));
        const up = new St.BoxLayout({style_class: 'zorin-notch-sys-number'});
        up.add_child(label('↑', 'zorin-notch-sys-up'));
        up.add_child(label(formatSpeed(stats.net.tx), 'zorin-notch-sys-speed'));
        net.add_child(down);
        net.add_child(up);
        row2.add_child(net);
        this.actor.add_child(row2);

        const foot = new St.BoxLayout({style_class: 'zorin-notch-sys-foot'});
        foot.add_child(label(_('Updated every {0} s', interval), 'zorin-notch-sys-muted'));
        foot.add_child(new St.Widget({x_expand: true}));
        const monitor = new St.Button({style_class: 'zorin-notch-sys-link', label: _('System Monitor ›')});
        monitor.connect('clicked', () => this._actions.openMonitor());
        foot.add_child(monitor);
        this.actor.add_child(foot);
    }
}

/**
 * The detail panel, below whatever opened it, holding the keyboard while open (Esc or a click
 * outside closes it). Styles: dark, glass (blurred wallpaper behind, like the dock), glass-accent.
 */
export class SystemPanel {
    constructor({stats, settings, theme, openPreferences}) {
        this._stats = stats;
        this._settings = settings;
        this._theme = theme;
        this._grab = null;
        this._view = new SystemView({
            openPreferences: () => this.close(() => openPreferences?.()),
            openMonitor: () => this.close(() => {
                const app = MONITOR_APPS.map(id => Shell.AppSystem.get_default().lookup_app(id)).find(Boolean);
                app?.activate();
            }),
        });
        this.actor = new St.Bin({
            style_class: 'zorin-notch-sys-panel',
            child: this._view.actor,
            reactive: true,
            visible: false,
            opacity: 0,
        });
        this.actor.connect('captured-event', (_a, event) => this._onEvent(event));
        Main.layoutManager.uiGroup.add_child(this.actor);
    }

    get isOpen() {
        return this.actor.visible;
    }

    // Repaint with the latest numbers while open
    update() {
        if (!this.isOpen)
            return;
        const settings = this._settings;
        const stats = this._stats.latest;
        const warning = settings.get_int('system-temp-warning');
        this._view.update({
            stats,
            history: this._stats.history,
            warning,
            chartColor: this._chartColor(stats, warning),
            interval: this._stats.interval,
        });
    }

    _chartColor(stats, warning) {
        const choice = this._settings.get_string('system-chart-color');
        if (choice === 'temperature')
            return TEMP_COLORS[tempLevel(stats?.cpu?.temp, warning)];
        return CHART_COLORS[choice] ?? this._theme?.accent.color ?? '#F05A24';
    }

    _syncStyle() {
        const style = this._settings.get_string('system-panel-style');
        for (const name of ['dark', 'glass', 'glass-accent']) {
            if (name === style)
                this.actor.add_style_class_name(name);
            else
                this.actor.remove_style_class_name(name);
        }
        // The accent glass: the theme's accent fading into the dark glass
        const accent = this._theme?.accent.color ?? '#F05A24';
        const [r, g, b] = parseColor(accent).map(c => Math.round(c * 255));
        this.actor.style = style === 'glass-accent'
            ? `background-gradient-direction: vertical; background-gradient-start: rgba(${r}, ${g}, ${b}, 0.42); ` +
              'background-gradient-end: rgba(11, 15, 26, 0.82);'
            : '';
        const glass = style !== 'dark';
        const blur = this.actor.get_effect('blur');
        if (glass && !blur) {
            try {
                const effect = new Shell.BlurEffect({mode: Shell.BlurMode.BACKGROUND, brightness: 0.85});
                if ('radius' in effect)
                    effect.radius = 36;
                else
                    effect.sigma = 18;
                this.actor.add_effect_with_name('blur', effect);
            } catch (e) {
                console.warn(LOG_PREFIX, 'no blur for the system panel', e.message);
            }
        } else if (!glass && blur) {
            this.actor.remove_effect_by_name('blur');
        }
    }

    /** Open below anchor (an actor); centered below it, kept on the monitor */
    open(anchor) {
        if (this.isOpen) {
            this.close();
            return;
        }
        this._stats.watch(true);
        this._syncStyle();
        this.actor.show();
        this.update();
        Main.layoutManager.uiGroup.set_child_above_sibling(this.actor, null);
        this._place(anchor);
        const grab = Main.pushModal(this.actor, {actionMode: Shell.ActionMode.POPUP});
        if ((grab.get_seat_state() & Clutter.GrabState.KEYBOARD) === 0)
            Main.popModal(grab);
        else
            this._grab = grab;
        this.actor.remove_all_transitions();
        this.actor.set_pivot_point(0.5, 0);
        this.actor.translation_y = -8;
        this.actor.ease({opacity: 255, translation_y: 0, duration: ANIMATION_MS, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
    }

    _place(anchor) {
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor)
            return;
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const width = PANEL_WIDTH * scale;
        this.actor.set_width(width);
        const [ax, ay] = anchor?.get_transformed_position() ?? [monitor.x + monitor.width / 2, monitor.y];
        const [aw, ah] = anchor?.get_transformed_size() ?? [0, 32 * scale];
        const x = Math.min(monitor.x + monitor.width - width - 8 * scale,
            Math.max(monitor.x + 8 * scale, ax + aw / 2 - width / 2));
        this.actor.set_position(Math.round(x), Math.round(ay + ah + 8 * scale));
    }

    close(then = null) {
        if (!this.isOpen)
            return;
        if (this._grab) {
            Main.popModal(this._grab);
            this._grab = null;
        }
        this._stats.watch(false);
        this.actor.remove_all_transitions();
        this.actor.ease({opacity: 0, duration: ANIMATION_MS, mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onStopped: () => this.actor.hide()});
        try {
            then?.();
        } catch (e) {
            console.error(LOG_PREFIX, 'system panel action failed', e);
        }
    }

    _onEvent(event) {
        if (!this._grab)
            return Clutter.EVENT_PROPAGATE;
        const type = event.type();
        if (type === Clutter.EventType.KEY_PRESS && event.get_key_symbol() === Clutter.KEY_Escape) {
            this.close();
            return Clutter.EVENT_STOP;
        }
        if (type === Clutter.EventType.BUTTON_PRESS || type === Clutter.EventType.TOUCH_BEGIN) {
            const [x, y] = event.get_coords();
            const target = global.stage.get_actor_at_pos(Clutter.PickMode.REACTIVE, x, y);
            if (!this.actor.contains(target)) {
                this.close();
                return Clutter.EVENT_STOP;
            }
        }
        return Clutter.EVENT_PROPAGATE;
    }

    destroy() {
        if (this._grab) {
            Main.popModal(this._grab);
            this._grab = null;
        }
        this.actor.destroy();
    }
}

