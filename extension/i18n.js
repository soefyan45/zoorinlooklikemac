// Translations. English is the default and also the key: _('Dark mode') returns the English
// text, or its translation for the language chosen in the preferences ("language" key).
// Placeholders are {0}, {1}, ...: _('Battery {0}%', 82).
//
// No GNOME Shell imports here: the preferences window uses this module too.

const STRINGS = {
    id: {
        // Panel
        'On': 'Aktif',
        'Off': 'Mati',
        'Dark mode': 'Mode gelap',
        'Do not disturb': 'Senyap',
        'Brightness': 'Kecerahan',
        'Search': 'Cari',
        'Notifications': 'Notifikasi',
        'Zorin Notch settings': 'Pengaturan Zorin Notch',
        'Settings': 'Pengaturan',
        'Lock screen': 'Kunci layar',
        'Power': 'Daya',
        // Wi-Fi
        'Back': 'Kembali',
        'Connected': 'Tersambung',
        'Secured': 'Aman',
        'Unsecured': 'Terbuka',
        'Locked': 'Terkunci',
        'Other networks': 'Jaringan lain',
        'Wi-Fi is off': 'Wi-Fi mati',
        'More Wi-Fi settings': 'Pengaturan Wi-Fi lainnya',
        // Notifications
        'Open': 'Buka',
        'Clear all': 'Bersihkan semua',
        '{0} new': '{0} baru',
        'No notifications': 'Tidak ada notifikasi',
        'now': 'sekarang',
        '{0} min': '{0} mnt',
        '{0} h': '{0} jam',
        // Power
        'Battery {0}%': 'Baterai {0}%',
        'Suspend': 'Tidur',
        'Log out': 'Keluar',
        'End session': 'Tutup sesi',
        'Restart': 'Mulai ulang',
        'Power off': 'Matikan',
        // Agents
        'working…': 'bekerja…',
        'needs you': 'butuh kamu',
        'done': 'selesai',
        'Needs permission or input': 'Butuh izin atau jawaban',
        'Finished': 'Selesai',
        'Dismiss': 'Abaikan',
        'Allow': 'Izinkan',
        'Hide': 'Sembunyikan',
        'Play or pause': 'Putar atau jeda',
        'Previous': 'Sebelumnya',
        'Next': 'Berikutnya',
        'Unknown title': 'Judul tidak diketahui',
        'Music in the notch': 'Musik di notch',
        'Equalizer on the line while music plays; hover for the title and controls': 'Equalizer di garis saat musik diputar; arahkan kursor untuk judul dan tombol',
        'Deny': 'Tolak',
        '{0} waiting': '{0} menunggu',
        'Processing prompt': 'Memproses prompt',
        'Running {0}': 'Menjalankan {0}',
        'Needs permission': 'Butuh izin',
        'Needs permission for {0}': 'Butuh izin untuk {0}',
        'Waiting for an answer': 'Menunggu jawaban',
        '{0} finished its turn': 'Giliran {0} selesai',
        'Stopped with an error': 'Berhenti karena error',
        // Search
        'Search apps…': 'Cari aplikasi…',
        'Search apps and files…': 'Cari aplikasi dan file…',
        'Applications': 'Aplikasi',
        'Files': 'File',
        'Document contents': 'Isi dokumen',
        'App': 'Aplikasi',
        'No matching apps': 'Tidak ada aplikasi yang cocok',
        'Search “{0}” in Overview': 'Cari “{0}” di Overview',

        // Preferences window
        'General': 'Umum',
        'Theme': 'Tema',
        'Look of the notch and the dock': 'Tampilan notch dan dock',
        'Dark': 'Gelap',
        'Light': 'Terang',
        'Follow system': 'Ikuti sistem',
        'Accent color': 'Warna aksen',
        'Active toggles, switches and highlights': 'Toggle aktif, sakelar dan sorotan',
        'Orange': 'Oranye',
        'Blue': 'Biru',
        'Green': 'Hijau',
        'Purple': 'Ungu',
        'Pink': 'Merah muda',
        'Behavior': 'Perilaku',
        'Search while typing in the overview': 'Cari saat mengetik di overview',
        'Answer permissions on the notch': 'Jawab izin di notch',
        'Claude Code asks Allow or Deny on the notch; no answer in a minute and it asks in the terminal': 'Claude Code bertanya Izinkan atau Tolak di notch; tanpa jawaban dalam semenit, ia bertanya di terminal',
        'Cleanest': 'Paling bersih',
        'Clock and battery always visible': 'Jam dan baterai selalu terlihat',
        'Like macOS': 'Seperti macOS',
        'Clean, the wallpaper shows through': 'Bersih, wallpaper tetap terlihat',
        'Background and chart color of the panel that opens when the system info is clicked': 'Latar dan warna grafik panel yang terbuka saat info sistem diklik',
        'CPU load bars in the bar and the panel': 'Batang beban CPU di bar dan di panel',
        'System info': 'Info sistem',
        'Shown in every top bar mode; click it for the details': 'Tampil di semua mode bar; klik untuk detail',
        'Show system info': 'Tampilkan info sistem',
        'CPU load and temperature in the status row or the top bar': 'Beban dan suhu CPU di baris status atau bar atas',
        'Shown in the top bar': 'Yang tampil di bar atas',
        'The detail panel always shows everything': 'Panel detail selalu menampilkan semuanya',
        'CPU load': 'Beban CPU',
        'CPU temperature': 'Suhu CPU',
        'SSD temperature': 'Suhu SSD',
        'Network speed': 'Kecepatan jaringan',
        'Mini graph': 'Grafik mini',
        'Small bars of the CPU load next to its number': 'Batang kecil beban CPU di samping angkanya',
        'Update every': 'Perbarui setiap',
        'Seconds; less often saves battery': 'Detik; lebih jarang lebih hemat baterai',
        'Temperature warning': 'Peringatan suhu',
        '°C: the dot turns red and the notch tells you once': '°C: titik jadi merah dan notch memberi tahu sekali',
        'Detail panel style': 'Gaya panel detail',
        'Background of the panel that opens on a click': 'Latar panel yang terbuka saat diklik',
        'Solid dark': 'Gelap pekat',
        'Glass (like the dock)': 'Kaca (seperti dock)',
        'Accent glass': 'Kaca warna aksen',
        'Chart color': 'Warna grafik',
        'CPU load bars': 'Batang beban CPU',
        'Teal': 'Teal',
        'Purple': 'Ungu',
        'White': 'Putih',
        'Follow the temperature': 'Ikut suhu',
        'System': 'Sistem',
        'CPU load · {0} threads{1}': 'Beban CPU · {0} thread{1}',
        'Not available': 'Tidak tersedia',
        'Memory': 'Memori',
        'of {0}': 'dari {0}',
        '{0} free of {1}': '{0} kosong dari {1}',
        'Network': 'Jaringan',
        'Updated every {0} s': 'Diperbarui tiap {0} detik',
        'System Monitor ›': 'Monitor Sistem ›',
        'System info needs the zorin-notchd daemon': 'Info sistem butuh daemon zorin-notchd',
        'The CPU is hot': 'CPU panas',
        '{0}°C, above your warning limit': '{0}°C, di atas batas peringatan',
        'Top bar': 'Bar atas',
        'What shows at the top while the notch rests': 'Yang tampil di atas layar saat notch tidak dipakai',
        'Thin line': 'Garis tipis',
        'Status notch': 'Notch status',
        'Full menu bar': 'Menu bar penuh',
        'Glass islands': 'Pulau kaca',
        'Activities': 'Aktivitas',
        'Notch style': 'Gaya notch',
        'Liquid: a lens at rest that drops into a bead toward the pointer': 'Liquid: lensa saat diam yang menetes jadi butiran ke arah kursor',
        'Classic line': 'Garis klasik',
        'Liquid drop': 'Tetesan liquid',
        'Search files': 'Cari file',
        'Spotlight also finds files and folders by name': 'Spotlight juga mencari file dan folder berdasarkan nama',
        'Search document contents': 'Cari isi dokumen',
        'Spotlight also finds text inside documents (indexed by GNOME Tracker)': 'Spotlight juga mencari teks di dalam dokumen (diindeks GNOME Tracker)',
        'Press Super and start typing: the notch search opens instead of the overview search':
            'Tekan Super lalu ketik: pencarian notch terbuka, bukan pencarian overview',
        'Working animation': 'Animasi saat bekerja',
        'On the standby line while an agent works; hover the notch for details':
            'Di garis standby saat agent bekerja; arahkan kursor ke notch untuk detail',
        'Light sweeping along the line': 'Cahaya menyapu sepanjang garis',
        'Two dots trading places': 'Dua titik bertukar tempat',
        'Three pulsing dots': 'Tiga titik berdenyut',
        'Animation color': 'Warna animasi',
        'Color of the working animation': 'Warna animasi saat agent bekerja',
        'Teal': 'Teal',
        'White': 'Putih',
        'Floating notch': 'Notch melayang',
        'A rounded pill below the top edge instead of a notch cut into it':
            'Pil bulat di bawah tepi atas, bukan notch yang menempel di tepi',
        'Distance from the top': 'Jarak dari atas layar',
        'In pixels, for the floating notch': 'Dalam piksel, untuk notch melayang',
        'Appearance': 'Tampilan',
        'Language': 'Bahasa',
        'Language of the notch and this window; the window updates when reopened':
            'Bahasa notch dan jendela ini; jendela ikut berubah saat dibuka lagi',
        'The dock uses zorin-taskbar; these settings are passed on to it.':
            'Dock memakai zorin-taskbar; pengaturan ini diteruskan ke sana.',
        'Auto hide': 'Sembunyikan otomatis',
        'The dock slides off the screen and comes back when the pointer reaches the bottom':
            'Dock turun keluar layar dan muncul lagi saat kursor ke bawah',
        'When windows cover the dock': 'Saat jendela menutupi dock',
        'When the active window covers the dock': 'Saat jendela aktif menutupi dock',
        'Only for maximized windows': 'Hanya saat jendela maksimal',
        'Icon zoom': 'Efek zoom ikon',
        'Icons under the pointer grow, like on macOS': 'Ikon di bawah kursor membesar seperti di macOS',
        'Dock size': 'Ukuran dock',
        'Height in pixels; the icon size follows': 'Tinggi dalam piksel; ukuran ikon ikut berubah',
        'Icon spacing': 'Jarak antar ikon',
        'In pixels, on each side of an icon': 'Dalam piksel, di tiap sisi ikon',
        'Glass padding': 'Ruang tepi kaca',
        'In pixels, between the icons and the edge of the glass':
            'Dalam piksel, antara ikon dan tepi latar kaca',
        'Distance from the bottom': 'Jarak dari bawah layar',
        'In pixels': 'Dalam piksel',
        'Glass opacity': 'Kepekatan kaca',
        'In percent; 0 = no background': 'Dalam persen; 0 = tanpa latar',
        'Notification time': 'Lama notifikasi',
        'Seconds before a notification turns back into the line':
            'Detik sebelum notifikasi kembali jadi garis',
        'Status time': 'Lama status',
        'Seconds before a clicked status closes by itself':
            'Detik sebelum status yang diklik menutup sendiri',
        'AI agents in the notch': 'Agent AI di notch',
        'Claude Code and opencode: working, needs permission, finished':
            'Status Claude Code dan opencode: sedang bekerja, butuh izin, selesai',
        'Standby line width': 'Lebar garis standby',
        'In pixels; it grows by 40 px when the pointer comes near':
            'Dalam piksel; saat kursor mendekat garis melebar 40 px',
        'Standby line thickness': 'Tebal garis standby',
        'Notification width': 'Lebar notifikasi',
        'In pixels; width of the notch when it shows a notification':
            'Dalam piksel; lebar notch saat menampilkan notifikasi',
        'Panel opacity': 'Kepekatan panel',
        'In percent; full panel, Wi-Fi, notifications': 'Dalam persen; panel penuh, Wi-Fi, notifikasi',
        'Animations': 'Animasi',
        'Off = the notch changes size at once, without springs':
            'Mati = notch langsung berubah ukuran tanpa pegas',
    },
};

export const LANGUAGES = [
    ['en', 'English'],
    ['id', 'Bahasa Indonesia'],
];

let current = 'en';

export function setLanguage(language) {
    current = language === 'en' || STRINGS[language] ? language : 'en';
}

export function _(text, ...args) {
    const translated = STRINGS[current]?.[text] ?? text;
    return args.length ? translated.replace(/\{(\d+)\}/g, (match, i) => String(args[i] ?? match)) : translated;
}

// Agent hooks send English messages; translate the ones they use
const AGENT_PATTERNS = [
    [/^Running (.+)$/, 'Running {0}'],
    [/^Needs permission for (.+)$/, 'Needs permission for {0}'],
    [/^(.+) finished its turn$/, '{0} finished its turn'],
];

// A number with the decimal mark of the language: 2.4 or 2,4
export function decimal(value, digits = 1) {
    const text = Number(value).toFixed(digits);
    return current === 'id' ? text.replace('.', ',') : text;
}

export function agentMessage(message) {
    for (const [pattern, key] of AGENT_PATTERNS) {
        const match = pattern.exec(message);
        if (match)
            return _(key, match[1]);
    }
    return _(message);
}
