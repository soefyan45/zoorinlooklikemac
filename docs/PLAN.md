# Rencana implementasi — Zorin Notch

> Acuan: [PRD.md](PRD.md). Tiap fase berdiri sendiri, diuji di nested shell, dan bisa di-rollback.
> Logout ke desktop asli hanya di akhir fase yang ditandai **[uji asli]**.

## Struktur repo (usulan)

```
zoorinlooklikemac/
├── docs/                    PRD, rencana, catatan uji
├── extension/               sumber extension (disalin/di-link ke ~/.local/share/gnome-shell/extensions/<uuid>)
│   ├── metadata.json        shell-version ["46"]
│   ├── extension.js         enable/disable, rakit modul
│   ├── tokens.js            token desain dari Pego (warna, radius, ukuran state)
│   ├── shape.js             gambar bentuk notch (Cairo) + kamera
│   ├── notch.js             actor utama, state machine, animasi pegas
│   ├── sources.js           jam, baterai, jaringan (read-only); fase 2+ menambah quicksettings, pesan, sistem
│   ├── devtools.js          self-test nested (aktif hanya dengan SELFTEST=1)
│   ├── states/              panel.js, notifications.js, wifi.js, power.js (fase 2+)
│   └── stylesheet.css       kelas St (teks, tombol, tile, baris)
├── scripts/
│   ├── nested-test.sh       nested shell terisolasi
│   ├── install-dev.sh       link extension ke folder user
│   ├── backup.sh            dconf dump
│   └── rollback.sh          disable + dconf load
└── dock/zorin-taskbar.dconf preset dock
```

## Fase 0 — Persiapan & pengaman (tanpa mengubah tampilan)

1. `scripts/backup.sh`: `dconf dump /org/gnome/shell/ > backups/shell-<tanggal>.dconf`.
2. `scripts/rollback.sh`: disable extension, `dconf load` backup terakhir, enable lagi `notchline` jika sebelumnya aktif.
3. `scripts/nested-test.sh` (sudah dibuat): nested 1440×900, dconf **terisolasi** (`XDG_CONFIG_HOME` sementara), hanya `zorin-taskbar` + extension ini yang aktif, log ke `logs/nested-*.log`. Desktop utama tidak tersentuh.
4. Kerangka extension: `metadata.json`, `enable()`/`disable()` kosong, `tokens.js` berisi semua token §5 PRD.

**Selesai jika:** nested jalan dengan extension kosong, log bersih, `rollback.sh` teruji (dry-run).

## Fase 1 — Notch dasar: bentuk + state 01 → 02 → 03

1. `shape.js`: path telinga cekung (kompak 6 px & melebar 10 px), gradien, stroke, bayangan, kamera.
2. `notch.js`: actor `addTopChrome`, posisi tengah monitor utama, state machine (`idle`, `hover`, `status`, …), animasi pegas lebar/tinggi.
3. Hover dengan polling kursor (`global.get_pointer()`), bukan pointer barrier (tidak jalan di nested).
4. `sources/clock.js` (WallClock), `sources/battery.js` (UPower D-Bus), `sources/network.js` (baca ikon/status dari `quickSettings._network`, read-only).
5. State 03: jam kiri, Wi-Fi + baterai kanan, auto-tutup 5 dtk; klik luar / Esc → idle.

**Uji:** screenshot nested vs `get_screenshot` Pego untuk 01, 02, 03 (ukuran ±2 px).
**Selesai jika:** K2 untuk 01–03, disable/enable 10× bersih.

## Fase 2 — Panel penuh (06) + Wi-Fi (09)

1. `states/panel.js`: baris status, 4 tile, 2 slider, tombol Apps/Cari, ikon Pengaturan/Kunci/Daya.
2. `sources/quicksettings.js`: adaptor ber-*guard* ke `_network`, `_bluetooth`, `_darkMode`, `_volumeOutput`, `_brightness`; Senyap via `org.gnome.desktop.notifications show-banners`.
   - Klik ikon tile = toggle; klik nama = detail (09 untuk Wi-Fi).
   - Field tidak ada → tile disembunyikan (S4).
3. `states/wifi.js`: daftar jaringan dari `network.js`, sakelar, "Pengaturan Wi-Fi lainnya" → buka `gnome-control-center wifi`.
4. Apps → `Main.overview.showApps()`, Cari → `Main.overview.show()` + fokus pencarian.

**Uji:** di nested (toggle dark mode & volume harus berfungsi; Wi-Fi/kecerahan bisa terbatas di nested → dicatat).
**Selesai jika:** K2 untuk 06 & 09, tidak ada error saat field privat sengaja di-*mock* hilang.

## Fase 3 — Notifikasi (05, 07)

1. `sources/messages.js`: dengar `Main.messageTray` `source-added` / `notification-added`.
2. State 05: muncul otomatis, tombol aksi pertama notifikasi, kembali ke idle setelah timeout.
3. Titik oranye "belum dibaca" di garis idle.
4. State 07: daftar notifikasi terbaru, "Bersihkan semua", geser kanan = tutup.
5. Banner GNOME bawaan disembunyikan **hanya** saat extension aktif (dikembalikan di `disable()`).

**Uji:** `notify-send` di dalam nested (`WAYLAND_DISPLAY` nested).
**Selesai jika:** K2 untuk 05 & 07, notifikasi tidak hilang (tetap ada di daftar GNOME).

## Fase 4 — Menu daya (10, 11) + sembunyikan bar  **[uji asli]**

1. `states/power.js`: Kunci/Tidur/Keluar → `systemActions`; Mulai ulang/Matikan → `org.gnome.SessionManager` (dialog konfirmasi GNOME = state 11 versi aman).
2. `DRY_RUN` aktif otomatis di nested (SessionManager memang tidak ada di nested) → hanya log.
3. Preset dock `dock/zorin-taskbar.dconf`: dock tengah bawah, sembunyikan `dateMenu`, `systemMenu`, `rightBox`, `activitiesButton`.
4. Logout → login sekali di desktop asli; uji Kunci layar dan **Batal** di dialog Matikan.

**Selesai jika:** semua alur §8 PRD jalan di desktop asli, rollback teruji di desktop asli.

## Fase 5 — Kemiripan visual & dock

1. Bandingkan screenshot desktop asli dengan frame `g4ltumsb` / `vusx1gzo`.
2. Daftar selisih dock (kaca, ikon 56 r13, titik 5 px, tooltip) → putuskan: terima, atur CSS `zorin-taskbar`, atau gambar dock sendiri (PRD §11.3).
3. Rapikan selisih notch (font, ikon, bayangan).

## Fase 6 (opsional) — Daemon Rust: 04 & 08

1. Crate `notchd` (zbus), service systemd user, antarmuka D-Bus `…ZorinNotch1`.
2. State 04: progres unduhan/rekam layar.
3. State 08 + ringkasan AI di 07: draf saja, tidak ada aksi tanpa klik.
4. Extension tetap jalan normal jika daemon mati (state 04/08 tidak tampil).

## Alur kerja harian

```
ubah kode → scripts/nested-test.sh → coba → tutup jendela → baca logs/ → ulangi
```

## Hal yang tidak bisa diuji di nested

| Hal | Alasan | Diuji di |
|---|---|---|
| Matikan / Mulai ulang / Keluar | tidak ada `org.gnome.SessionManager` | fase 4, desktop asli (klik Batal) |
| Hover tepi layar via barrier | `meta-barrier` gagal di nested | desktop asli |
| Kecerahan, sebagian Wi-Fi | tergantung hardware/sesi | desktop asli |
| Performa animasi | nested lebih lambat | desktop asli |
