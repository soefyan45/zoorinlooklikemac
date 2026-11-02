# PRD — Zorin Notch (tampilan ala Mac, arah C)

> Status: draf 1 · 2026-11-02
> Sumber desain: Pego project `zoorinlooklikemac` (id `smo9dehb`), file `/home/soefyan/Pego/zoorinlooklikemac/project.pego`
> Frame acuan utama: `4wqm80lv` "Notch · semua tampilan (state)" + frame desktop `g4ltumsb`, `vusx1gzo`, `z3ln6qre`, `nq00cgxh` (dock)

## 1. Ringkasan

Membuat desktop Zorin OS 18 tampil seperti macOS **tanpa bar atas**: semua status dan kontrol sistem pindah ke **notch** di tengah atas layar, aplikasi ada di **dock** bawah. Targetnya tampilan sedekat mungkin dengan desain Pego, dengan prinsip **main aman**: semua aksi sistem lewat komponen GNOME yang sudah teruji, tanpa sudo, tanpa menyentuh file sistem, dan bisa dikembalikan dengan satu perintah.

## 2. Tujuan & non-tujuan

**Tujuan**
- G1. Notch dengan 11 state sesuai `4wqm80lv` (ukuran, bentuk, warna, tipografi).
- G2. Bar atas hilang; jam, Wi-Fi, baterai, pengaturan cepat dan menu daya bisa diakses dari notch.
- G3. Dock bawah di tengah, gaya kaca, titik penanda aplikasi berjalan.
- G4. Semua bisa diuji di nested shell tanpa logout.
- G5. Rollback penuh: matikan extension + `dconf load` backup.

**Non-tujuan (versi ini)**
- Tema WhiteSur / GTK / GDM / ikon (dibahas terpisah).
- Logika AI (state 08) dan pemantau unduhan (state 04) → fase Rust, setelah inti stabil.
- Efek magnifikasi dock (`nlpkptsf`) → backlog.
- Mendukung GNOME selain 46.

## 3. Lingkungan target

| Item | Nilai (terverifikasi) |
|---|---|
| OS | Zorin OS 18.1 (basis Ubuntu noble) |
| Shell | GNOME Shell 46.0, mutter 46.2, Wayland |
| Extension aktif yang relevan | `zorin-taskbar` (fork Dash to Panel), `user-theme`, `zorin-tiling-shell`, `notchline` |
| Font | Inter terpasang |
| Nested shell | `dbus-run-session -- gnome-shell --nested --wayland` jalan |

## 4. Arsitektur

Satu extension GJS (usulan UUID: `zorin-notch@soefyan45.github.io`, belum final) yang **menggambar UI** dan **memanggil komponen GNOME**. Daemon Rust hanya ditambahkan di fase akhir untuk state 04 dan 08.

Jalur akses per fitur:
- **A** = panggil modul internal GNOME Shell 46 langsung.
- **B** = D-Bus publik dari GJS (`Gio.DBusProxy`).
- **C** = daemon Rust via D-Bus (fase akhir).

| Fitur | Jalur | Sumber (terverifikasi di `libshell-14.so`) |
|---|---|---|
| Jam & tanggal | A | `GnomeDesktop.WallClock` (dipakai `dateMenu.js`) |
| Baterai | B | UPower `org.freedesktop.UPower` `/devices/DisplayDevice` (pola sama dengan `status/system.js`) |
| Status & daftar Wi-Fi | A | `Main.panel.statusArea.quickSettings._network` (`status/network.js`, `NM.Client`) |
| Toggle Bluetooth | A | `quickSettings._bluetooth` |
| Toggle Mode gelap | A | `quickSettings._darkMode` |
| Toggle Senyap | A | setting `org.gnome.desktop.notifications show-banners` (sama seperti tombol DND GNOME) |
| Slider volume | A | `quickSettings._volumeOutput` |
| Slider kecerahan | A | `quickSettings._brightness` |
| Notifikasi | A | `Main.messageTray` sinyal `source-added` / `notification-added` |
| Apps / Cari | A | `Main.overview` |
| Kunci layar, Tidur, Keluar | A | `misc/systemActions.js`: `activateLockScreen`, `activateSuspend`, `activateLogout` |
| Mulai ulang, Matikan | B | `org.gnome.SessionManager.Reboot/Shutdown` → dialog konfirmasi bawaan GNOME |
| Aktivitas berjalan (04) | C | daemon Rust (fase akhir) |
| Notifikasi AI (08) | C | daemon Rust (fase akhir) |

> Catatan: `_network`, `_bluetooth` dst. adalah field privat. Wajib di-*guard* (`?.`) dan dicek ulang saat upgrade GNOME.

## 5. Design token (dari Pego → CSS)

Semua nilai diambil dari variabel dokumen Pego, dipetakan 1:1 ke `stylesheet.css` (sebagai komentar token) dan konstanta JS.

| Token | Nilai | Dipakai untuk |
|---|---|---|
| `$notch` | `#000000` | bentuk notch bagian atas |
| `$notch-panel` | `#06080FC7` | badan panel melebar (gradien bawah) |
| `$notch-glass` | `#0B0F1A94` | badan notifikasi (state 05) |
| `$notch-glass-edge` | `#FFFFFF2E` | garis tepi notch melebar |
| `$notch-idle-edge` | `#FFFFFF1F` | cincin garis idle |
| `$notch-control` | `#FFFFFF24` | tombol/trek slider |
| `$notch-tile` / `-edge` | `#FFFFFF12` / `#FFFFFF0F` | tile pengaturan cepat, baris notif |
| `$notch-label` | `#FFFFFFB8` | teks sekunder |
| `$menu-text` / `-muted` | `#FFFFFF` / `#FFFFFFD9` | teks utama / isi |
| `$accent` / `$on-accent` | `#F05A24` / `#0F0E12` | toggle aktif, sakelar, progres |
| `$danger` | `#B81D13` | Matikan, konfirmasi |
| `$ai` / `$ai-soft` / `$ai-edge` / `$on-ai` | `#4FD1C5` / `#4FD1C51F` / `#4FD1C573` / `#06201D` | elemen AI |
| `$dock-glass` / `$dock-edge` / `$dock-ring` | `#18233599` / `#FFFFFF47` / `#00000033` | dock |
| `$dock-dot` / `$dock-divider` | `#FFFFFFD9` / `#FFFFFF3D` | titik berjalan, pemisah |
| `$tooltip-bg` / `$tooltip-edge` | `#1C1D22F0` / `#FFFFFF2E` | tooltip dock |
| `$radius-row` / `$radius-row-icon` / `$radius-sm` | 18 / 8 / 4 | baris menu, ikon baris, badge |
| `$radius-dock` / `$radius-icon` | 20 / 13 | dock, ikon dock |
| `$dock-gap` / `$dock-pad` | 8 / 7 | dock |
| `$space-xs/sm/md/lg` | 4 / 8 / 12 / 24 | jarak |

Tipografi: **Inter**. Judul 15/600, teks utama 13/600, isi 13/400 lh 1.3–1.4, label 12/500, badge 11/700, label grup 11/500 letter-spacing 0.3.

Ikon: desain memakai Lucide. Implementasi memakai **ikon simbolik GNOME/Adwaita** yang paling mirip (mis. `network-wireless-symbolic`, `battery-full-symbolic`), atau SVG Lucide yang dibundel di extension (keputusan di §11).

## 6. Bentuk notch

Semua state melebar memakai bentuk yang sama: atas rata menempel tepi layar, **telinga cekung 10 px** di kiri-kanan atas, sudut bawah radius ~28 px. Contoh path (lebar `W`, tinggi `H`):

```
M0 0 H{W} Q{W-10} 0 {W-10} 10 V{H-28} C{W-10} {H-12.5} {W-22.5} {H} {W-38} {H}
H38 C22.5 {H} 10 {H-12.5} 10 {H-28} V10 Q10 0 0 0 Z
```

Notch kompak (03/04, 300×32) memakai telinga 6 px dan sudut bawah 11 px:
`M0 0 H300 Q294 0 294 6 V21 Q294 32 283 32 H17 Q6 32 6 21 V6 Q6 0 0 0 Z`

Isi notch melebar: gradien vertikal `$notch` (0 → ~0.1–0.26) ke `$notch-panel`/`$notch-glass`, stroke 1 px `$notch-glass-edge` (AI: `$ai-edge`), bayangan `0 16 40 #00000052`. Titik kamera 6×6 `#101018` stroke `#1F2030` di tengah, y=13.

Digambar dengan `St.DrawingArea` + Cairo (pola yang sama sudah terbukti di notchline).

## 7. Spesifikasi state

| # | State | Ukuran | Pemicu | Isi | Data |
|---|---|---|---|---|---|
| 01 | Idle | 120×4, radius 2, cincin 1 px `$notch-idle-edge` | default | garis hitam; area klik 200×12 | — |
| 02 | Hover | 160×6, cincin `$notch-glass-edge` | kursor mendekat | garis menebal | posisi kursor |
| 03 | Klik · status | 300×32 | klik garis | kiri: jam 13/600; kanan: Wi-Fi 16, baterai `82%` 12/500 + ikon 22; auto-tutup 5 dtk | WallClock, UPower, network |
| 04 | Aktivitas berjalan | 300×32 | proses berjalan | kiri: ikon `$accent` + label; kanan: progres 44×4 + persen | Rust (fase akhir) |
| 05 | Notifikasi | 420×104 | notifikasi masuk | ikon app 40 r10, judul+waktu, isi, tombol aksi pil | messageTray |
| 06 | Panel penuh | 680×228 | klik notch yang terbuka | baris status (tanggal+jam, Wi-Fi, baterai); 4 tile r26 (Wi-Fi, Bluetooth, Mode gelap, Senyap; lingkaran 32 `$accent` jika aktif); slider volume & kecerahan (trek 6 px); tombol Apps, Cari; ikon Pengaturan, Kunci, Daya (32, pil) | quickSettings, overview, systemActions |
| 07 | Daftar notifikasi | 560×354 | klik saat ada notif belum dibaca (titik oranye) | kepala "Notifikasi · N baru · Bersihkan semua"; (ringkasan AI = fase Rust); baris notif `notifRow` (r18, ikon gradien 40); geser kanan = tutup | messageTray |
| 08 | Notifikasi AI | 460×192 | saran dari daemon | badge AI, sumber, judul, draf, tombol Kirim/Ubah/Abaikan; tidak ada aksi tanpa klik | Rust (fase akhir) |
| 09 | Konfig Wi-Fi | 440×282 | klik nama tile Wi-Fi | tombol kembali 28, judul, sakelar 36×20; grup "Tersambung" / "Jaringan lain" (`notchMenuItem`); "Pengaturan Wi-Fi lainnya" | network.js |
| 10 | Menu daya | 340×274 | ikon daya di 06 | kepala "Daya · Baterai N%"; Kunci layar (meta `Super + L`), Tidur, Keluar; pemisah; Mulai ulang; Matikan (ikon `$danger`) | systemActions, SessionManager |
| 11 | Konfirmasi | 400×186 | Keluar/Mulai ulang/Matikan | **Versi aman:** dialog bawaan GNOME (`endSessionDialog`): hitung mundur + app belum disimpan. Versi dalam notch = backlog | gnome-session |

Penyimpangan desain yang **disengaja** (alasan keamanan):
- **11**: memakai dialog GNOME di tengah layar, bukan di dalam notch. Logika *inhibitor* dan hitung mundur tidak diduplikasi.
- **09**: memilih jaringan berpassword membuka dialog password bawaan GNOME/NetworkManager.

## 8. Interaksi & animasi

Alur (dari legenda Pego):
- 01 Idle —klik garis→ 03 Status —klik lagi→ 06 Panel penuh
- 06 —klik nama tile→ 09 Konfig
- 06 —ikon daya→ 10 Menu daya —pilih→ 11 Konfirmasi
- 05 Notif / 08 AI —klik notch bertitik→ 07 Daftar
- Klik di luar notch atau **Esc** dari state mana pun → 01 Idle.

Animasi (dari `z3ln6qre`):
- 0 dtk: garis idle 120×4 → 0,45 dtk: 160×6 efek pegas → 0,82 dtk: notch 212×32 turun dari tepi.
- Transisi antar ukuran memakai pegas (spring) lebar dan tinggi terpisah; notifikasi `slide_down` ~700 ms spring.
- Hormati setting `org.gnome.desktop.interface enable-animations`.

Fokus & aksesibilitas: notch yang terbuka menangkap keyboard (Esc, Tab antar tombol); semua tombol punya `accessible_name`.

## 9. Dock

Implementasi **tahap 1**: `zorin-taskbar` diatur sebagai dock (tanpa kode):
- `panel-position` BOTTOM, panjang dipendekkan & di tengah (`panel-lengths`, `panel-anchors` MIDDLE), ukuran ikon ~56.
- Elemen `dateMenu`, `systemMenu`, `rightBox`, `activitiesButton` disembunyikan **setelah** notch menggantikannya (fase 4).
- Alasan: selama `zorin-taskbar` aktif, panel GNOME tetap tersembunyi tapi komponennya (quickSettings, dateMenu) tetap hidup → bisa dipakai notch, dan jadi cadangan jika notch error.

Selisih dengan desain (gaya kaca, ikon 56 r13, tooltip, titik 5 px) diukur di fase 5. Jika selisih tidak bisa diterima, opsi lanjutan: dock digambar extension ini sendiri (keputusan terbuka, §11).

## 10. Syarat keamanan

- S1. Tanpa sudo; semua file di `~/.local/share/gnome-shell/extensions/` dan repo ini.
- S2. Backup `dconf dump /org/gnome/shell/` sebelum mengubah setting apa pun.
- S3. Tidak ada pemanggilan `systemctl poweroff/reboot` langsung; daya lewat `systemActions`/`SessionManager`.
- S4. Semua akses field privat GNOME di-*guard*; jika tidak ada → fitur itu disembunyikan, extension tetap jalan.
- S5. Semua error tertangkap dan di-log dengan prefiks `[zorin-notch]`; tidak ada exception yang lolos ke shell.
- S6. `disable()` membersihkan semua actor, sinyal, timer, dan mengembalikan setting yang diubah.
- S7. Mode `DRY_RUN` untuk aksi daya saat uji di nested.
- S8. `notchline` dimatikan saat extension ini aktif (dua notch di posisi sama akan bertumpuk).

## 11. Keputusan terbuka

1. UUID / nama extension final.
2. Ikon: simbolik GNOME (lebih konsisten sistem) vs SVG Lucide dibundel (lebih mirip desain).
3. Dock: tetap `zorin-taskbar` atau digambar sendiri (setelah evaluasi fase 5).
4. State 11 versi dalam notch: tetap dialog GNOME, atau dibuat belakangan.
5. Kapan fase Rust (04, 08) dimulai.

## 12. Kriteria sukses

- K1. 11 state (01–03, 05–07, 09–11 di fase inti) tampil dan bisa dinavigasi sesuai alur §8.
- K2. **Kemiripan visual**: screenshot nested 1440×900 dibandingkan dengan `get_screenshot` Pego per state; ukuran ±2 px, warna sama dengan token, tipografi sama.
- K3. Tidak ada error `[zorin-notch]` di log selama 30 menit pemakaian normal.
- K4. Disable → enable 10× tanpa actor/sinyal bocor.
- K5. Rollback mengembalikan desktop persis seperti sebelum (dibandingkan dengan backup dconf).

## 13. Risiko

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Field privat quickSettings berubah saat upgrade GNOME | fitur tile/slider mati | guard + cek ulang tiap upgrade; jalur B sebagai cadangan |
| Error JS di extension | extension dinonaktifkan GNOME; di kasus parah shell restart (= logout di Wayland) | uji di nested dulu; try/catch di semua handler |
| Bentrok dengan `notchline` / `zorin-taskbar` | dua notch, panel muncul lagi | S8; `zorin-taskbar` tidak dimatikan |
| Pointer barrier tidak jalan di nested | hover/tepi layar tidak bisa diuji akurat di nested | uji hover pakai polling kursor; verifikasi akhir di desktop asli |
| Jam/tray disembunyikan tapi notch error | tidak ada jam/menu daya | sembunyikan jam/tray hanya di fase 4, dengan perintah rollback siap |
