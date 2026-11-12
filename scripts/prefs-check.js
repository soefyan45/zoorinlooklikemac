// Builds the preferences window with GNOME's own prefs module, shows it for two seconds and
// lists its rows; exits with an error if anything throws. Run it with scripts/prefs-check.sh.
import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';
import System from 'system';

Gio.Resource.load('/usr/share/gnome-shell/org.gnome.Shell.Extensions.src.gresource')._register();

const dir = Gio.File.new_for_path(ARGV[0]);
const metadata = JSON.parse(new TextDecoder().decode(dir.get_child('metadata.json').load_contents(null)[1]));
metadata.path = dir.get_path();
metadata.dir = dir;

Adw.init();
const {default: Prefs} = await import(`file://${dir.get_path()}/prefs.js`);
const prefs = new Prefs(metadata);
const window = new Adw.PreferencesWindow();
prefs.fillPreferencesWindow(window);

const titles = [];
const walk = widget => {
    for (let child = widget.get_first_child(); child; child = child.get_next_sibling()) {
        if (child instanceof Adw.ActionRow || child instanceof Adw.ComboRow)
            titles.push(child.title);
        walk(child);
    }
};
walk(window);
print(`rows: ${titles.length}: ${titles.join(' | ')}`);

window.present();
const loop = new GLib.MainLoop(null, false);
// PREFS_SHOT=<file.png> [PREFS_PAGE=<title>]: also save a picture of that page
const shot = GLib.getenv('PREFS_SHOT');
const pageTitle = GLib.getenv('PREFS_PAGE');
const findPage = widget => {
    for (let child = widget.get_first_child(); child; child = child.get_next_sibling()) {
        if (child instanceof Adw.PreferencesPage && child.title === pageTitle)
            return child;
        const found = findPage(child);
        if (found)
            return found;
    }
    return null;
};
const page = pageTitle ? findPage(window) : null;
if (page)
    window.set_visible_page(page);
GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
    if (shot) {
        const paintable = new Gtk.WidgetPaintable({widget: window});
        const [w, h] = [window.get_width(), window.get_height()];
        const snapshot = new Gtk.Snapshot();
        paintable.snapshot(snapshot, w, h);
        const node = snapshot.to_node();
        const texture = window.get_renderer().render_texture(node, null);
        texture.save_to_png(shot);
        print(`saved ${shot}`);
    }
    window.close();
    loop.quit();
    return GLib.SOURCE_REMOVE;
});
loop.run();
System.exit(0);
