# Rencana — daemon Rust + pencarian file untuk Spotlight

> Status: draf 1 · 2026-11-04
> Acuan pola: Notchline (`SOEFPROCJ/Notchline`, daemon Rust 1.079 baris + extension GJS)

## 1. Tujuan

Tampilan (notch, dock, Spotlight, panel) **tetap** di extension GJS: di GNOME Wayland hanya
GNOME Shell yang bisa menggambar di atas layar. Rust mengambil pekerjaan di luar tampilan:

| # | Tujuan | Manfaat |
|---|---|---|
| G1 | Hook agent dalam satu binary Rust | Ganti `claude-hook.sh` (bash + jq ×2–6 + gdbus per tool call) dengan 1 proses kecil |
| G2 | Izin dua arah Allow/Deny dari notch | Jawab permintaan izin Claude Code/opencode langsung dari notch |
| G3 | Pencarian **file** dan **isi dokumen** di Spotlight | Seperti Spotlight macOS: aplikasi, file, dan teks di dalam dokumen |
| G4 | Isolasi | Logika berat di proses terpisah; kalau daemon bermasalah, GNOME Shell tetap aman |

Bukan tujuan: memindahkan tampilan ke Rust, mengganti Tracker/LocalSearch GNOME.

## 2. Kondisi sistem (terverifikasi)

| Item | Nilai |
|---|---|
| Rust | rustc / cargo 1.99.1 |
| Indexer GNOME | Tracker 3 (LocalSearch) aktif: 1.695 file, 57 folder, "indexing complete" |
| Folder terindeks | Desktop, Documents, Music, Pictures, Videos (Downloads ikut terindeks lewat recent/aktivitas) |
| Isi dokumen | Sudah: `tracker3 search laporan` menemukan teks di dalam PDF |
| `pdftotext` | Ada (`/usr/bin/pdftotext`) |
| 19 file gagal diindeks | Mis. `.pptx` rusak — dilewati Tracker |

**Keputusan utama:** daemon **memakai Tracker lewat D-Bus (SPARQL)**, bukan membangun indeks
sendiri. Tracker sudah berjalan, sudah mengindeks isi PDF/DOCX/ODT/TXT, dan dipakai GNOME
Files. Indeks sendiri hanya opsional (fase R5) untuk folder yang tidak diindeks Tracker,
misalnya folder project di drive `D`.

## 3. Arsitektur

```
┌──────────────────────────────┐   D-Bus (session)    ┌───────────────────────────────┐
│ Extension GJS (tampilan)     │ ◄──────────────────► │ zorin-notchd (Rust)           │
│ - notch, dock, Spotlight     │  AgentChanged        │ - status sesi agent           │
│ - pemilik objek GNOME Shell  │  PermissionAsked     │ - antrean izin (menunggu)     │
│   (quick settings, notif,    │  Search(q) → hasil   │ - pencarian file & isi        │
│    tray, daya)               │  Answer(id, allow)   │ - config, CLI                 │
└──────────────────────────────┘                      └──────┬──────────────┬─────────┘
                                                             │ SPARQL       │ stdin/stdout
                                                   Tracker/LocalSearch   hook Claude / opencode
                                                   (indeks GNOME)        (`zorin-notchd hook …`)
```

- Satu binary `zorin-notchd` dengan subperintah: `daemon`, `hook claude`, `hook opencode`,
  `search <q>` (uji), `install-service`, `install-hooks`, `uninstall`.
- Daemon diaktifkan otomatis oleh D-Bus (`~/.local/share/dbus-1/services/…service`) — tidak
  perlu systemd, mulai saat pertama dipanggil.
- Bus name daemon: `io.github.soefyan45.ZorinNotchd`. Layanan extension yang ada
  (`io.github.soefyan45.ZorinNotch`) tetap, supaya hook lama tidak putus saat transisi.

### Antarmuka D-Bus (`io.github.soefyan45.ZorinNotchd1`)

| Anggota | Arah | Isi |
|---|---|---|
| `Search(s query, u limit) → a(sssssd)` | ext → daemon | `kind` (file/document/folder), `title`, `uri`, `snippet`, `mime`, `score` |
| `CancelSearch(u id)` | ext → daemon | Batalkan pencarian lama saat user terus mengetik |
| `Answer(s request_id, b allow)` | ext → daemon | Jawaban izin dari notch |
| signal `AgentChanged(s agent, s session, s state, s project, s message)` | daemon → ext | Pengganti panggilan `AgentEvent` saat ini |
| signal `PermissionAsked(s id, s agent, s project, s tool, s detail, u timeout_s)` | daemon → ext | Notch menampilkan Allow/Deny |
| signal `PermissionClosed(s id, s outcome)` | daemon → ext | Dijawab di terminal / timeout |

## 4. Fase

### R0 — Kerangka daemon (tanpa mengubah perilaku)
1. Workspace `daemon/` (crate `zorin-notchd`, edition 2024).
2. Daemon D-Bus kosong + `install-service` + `uninstall`.
3. Extension: klien D-Bus yang **opsional** — kalau daemon tidak ada, semua fitur lama jalan.
4. `scripts/install.sh` menambah `cargo build --release` + pasang binary ke `~/.local/bin`.

Selesai jika: `gdbus introspect` menampilkan antarmuka; nested test tetap lolos tanpa daemon.

### R1 — Hook agent di Rust (G1)
1. `zorin-notchd hook claude`: baca JSON hook dari stdin, kirim ke daemon, keluar < 10 ms.
   Tidak pernah memblokir: kalau daemon tidak menjawab dalam 1 s → keluar 0.
2. `zorin-notchd hook opencode` + plugin opencode memanggil binary ini.
3. `install-hooks` mengganti entri `claude-hook.sh` di `~/.claude/settings.json` (backup dulu,
   entri lain dibiarkan) — sama dengan `install-agent-hooks.sh` sekarang.
4. Daemon memegang daftar sesi (pindahan `AgentTracker` dari `agents.js`), extension cukup
   mendengar `AgentChanged`.

Ukur: waktu hook (`hyperfine`) bash vs Rust; target ≥ 5× lebih cepat.

### R2 — Izin dua arah (G2)
1. Hook `PermissionRequest` **menunggu** jawaban daemon (maks `permission_timeout_s`, default 60).
2. Notch menampilkan state baru: nama tool, detail perintah, tombol **Allow** / **Deny**.
3. Tidak dijawab → hook mengembalikan "tanya di terminal" (perilaku bawaan Claude), bukan
   allow. Tidak ada auto-allow selain daftar `safe_commands` yang ditulis user sendiri.
4. Dijawab di terminal lebih dulu → `PermissionClosed` menutup notch.

### R3 — Pencarian file & isi dokumen (G3)
1. Daemon menjalankan SPARQL ke Tracker (`org.freedesktop.Tracker3.Miner.Files` endpoint):
   - nama file (`nfo:fileName`) cocok sebagian,
   - isi (`fts:match`) dengan potongan teks (`fts:snippet`).
2. Peringkat: kecocokan nama > isi; dokumen yang baru dibuka/diubah naik; batas 8 hasil.
3. Batal otomatis bila user mengetik lagi (debounce 120 ms di extension + `CancelSearch`).
4. Spotlight: grup **Aplikasi** (seperti sekarang, dari GNOME) lalu **Dokumen** dan **File**.
   Baris dokumen menampilkan potongan teks dengan kata yang cocok ditebalkan. Enter membuka
   dengan aplikasi bawaan (`Gio.AppInfo.launch_default_for_uri`); ⌘/Ctrl+Enter membuka foldernya.
5. Tanpa daemon atau tanpa Tracker → Spotlight tetap hanya aplikasi (seperti sekarang).

Target: hasil pertama < 150 ms untuk 1.700 file terindeks.

### R4 — Pengaturan & privasi
- Pengaturan: **Cari file** (on/off), **Cari isi dokumen** (on/off), folder yang dikecualikan.
- Daemon tidak menyimpan riwayat pencarian, tidak mengirim apa pun keluar komputer.
- Folder yang diindeks diatur di GNOME Settings → Search (milik Tracker), ditautkan dari
  pengaturan Zorin Notch.

### R5 (opsional) — Indeks sendiri untuk folder di luar Tracker
Hanya kalau dibutuhkan (mis. folder project di drive `D` yang baru di-mount setelah login):
indeks nama file + isi teks dengan `tantivy`, dipantau `notify`, berjalan dengan
`nice`/`ionice` dan berhenti saat baterai < 20%.

### R6 — Pengujian & rilis
- Uji unit Rust: parsing hook, peringkat, pemetaan SPARQL.
- Nested test: daemon dijalankan di bus nested, hook diuji ke daemon, Spotlight menampilkan
  hasil file dari Tracker tiruan (fixture).
- `scripts/uninstall.sh` mengembalikan hook bash + mencabut binary dan service.

## 5. Dependensi baru (perlu persetujuan)

| Crate | Untuk | Fase |
|---|---|---|
| `zbus` | D-Bus (sama seperti Notchline) | R0 |
| `tokio` | async runtime | R0 |
| `serde`, `serde_json` | JSON hook | R1 |
| `toml` | config | R0 |
| `tantivy`, `notify` | indeks sendiri | R5 (opsional) |

Tidak ada paket sistem baru: Tracker dan `pdftotext` sudah terpasang.

## 6. Risiko

| Risiko | Mitigasi |
|---|---|
| Hook yang menunggu izin (R2) memperlambat Claude | Timeout, dan jatuh ke prompt terminal bawaan |
| Tracker mati / belum selesai mengindeks | Spotlight tetap menampilkan aplikasi; status "indexing" ditampilkan |
| Isi dokumen pribadi muncul di Spotlight | Opsi mati/hidup, folder pengecualian, tidak ada riwayat |
| Dua layanan D-Bus selama transisi | Extension mendengar keduanya sampai R1 selesai, lalu `AgentEvent` lama dihapus |
| Binary di drive `D` tidak ada saat boot | Dipasang ke `~/.local/bin` (drive sistem), sama seperti extension |

## 7. Batas tampilan (keputusan 2026-11-04)

Tampilan **tidak diubah** sampai disetujui terpisah. Urutan kerja:

| Fase | Mengubah tampilan? | Status |
|---|---|---|
| R0 kerangka daemon | Tidak | boleh dikerjakan |
| R1 hook Rust | Tidak (notch tetap sama, hanya sumber event berganti) | boleh dikerjakan |
| R2 izin Allow/Deny | **Ya** — state baru di notch | ditunda, perlu persetujuan |
| R3 pencarian file & isi | **Ya** — grup baru di Spotlight | ditunda, perlu persetujuan |
| R4 pengaturan | **Ya** — baris baru di Pengaturan | ditunda, perlu persetujuan |
| R5 indeks sendiri | Tidak | opsional |

Daemon untuk R3 boleh disiapkan lebih dulu tanpa tampilan (diuji lewat
`zorin-notchd search <q>`), lalu disambungkan ke Spotlight setelah disetujui.

## 8. Keputusan terbuka

1. Persetujuan dependensi (§5).
2. Urutan fase: R1 → R2 → R3, atau R3 (pencarian file) lebih dulu?
3. R2: perlu daftar `safe_commands` (auto-allow) atau selalu tanya?
4. R5 perlu atau cukup Tracker?
