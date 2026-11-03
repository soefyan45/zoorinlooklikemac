// Builds the preferences window with GNOME's own prefs module, shows it for two seconds and
// lists its rows; exits with an error if anything throws. Run it with scripts/prefs-check.sh.
import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
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
GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
    window.close();
    loop.quit();
    return GLib.SOURCE_REMOVE;
});
loop.run();
System.exit(0);
