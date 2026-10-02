# Verifikasi versi 3.1.0 — RequestReverseAcc

Pemeriksaan lokal pada 2 Oktober 2026:

- **54 tes otomatis** (`node --test tests/*.test.mjs`) lulus: 46 tes lama + tes baru untuk parser cari nomor, filter lokal, trail per transisi, ringkasan edit, jejak data lama, field-path update trail, lacak nomor di demo store, dan alur cari/lacak di controller.
- **10 tes rules di Firestore Emulator** (`npm run test:rules`, emulator v1.22.0, SDK firebase 12.19.0 yang sama dengan CDN) lulus, memakai `firestore-repository.js` asli: create dengan trail; create tanpa/dengan trail palsu ditolak; selesai → buka kembali → selesai → arsip → pulihkan; update tanpa trail, aksi salah, lompat nomor, atau mengubah entri lama ditolak; requester tidak bisa memproses atau menghapus milik orang lain; hapus/pulihkan milik sendiri; edit biasa dan koreksi identitas (transaksi) dengan riwayat pindah; pesan duplikat; lacak nomor oleh anggota dan ditolak untuk non-anggota; dokumen lama tanpa trail tetap bisa diproses; count agregasi; batch create 100 dokumen dan bulk 250 dokumen.
- Rules 3.0.8 juga dicek di emulator (selesai dan hapus requester berhasil) sebagai pembanding.
- Browser (Chromium headless, mode demo): filter lokal via `/`, lacak 4 nomor (1 tidak ditemukan), riwayat dokumen arsip, Buka di daftar, centang + bulk selesai, tanpa error JavaScript. Mobile 390px tanpa scroll horizontal; tabel desktop muat tanpa scroll mulai lebar layar 1280px.

Batas verifikasi:

- Index komposit tidak ditegakkan oleh emulator. Versi ini tidak menambah index; lacak nomor memakai index single-field bawaan `documentNumber`.
- Belum diuji di project Firebase produksi, tab Teams, akun tim nyata, atau clipboard kantor.
- Font Google tidak termuat di lingkungan uji (jaringan dibatasi); tampilan memakai font fallback.

---

# Verifikasi versi 3.0 — RequestReverseAcc

Pemeriksaan lokal lulus pada 1 Oktober 2026:

- **44 tes otomatis**: parser contoh pengguna dan sinonim tambahan, leading zero, input campuran per baris/blok, tahun campuran, duplikat per identitas, input ambigu, input tidak valid, dan batas batch.
- Ruang pribadi dan hitungan open menggunakan **createdByUid**, termasuk kasus dua pengguna memiliki nama tampilan yang sama. Badge menghitung semua tanggal, mengikuti ruang yang dipilih.
- Controller demo: ruang pribadi → tim → copy lintas tahun → bulk selesai → arsip → pulihkan → paste Cancel Park → Enter/Shift+Enter → edit → hapus → Sampah → pulihkan. Audit edit tampil di tabel/detail dan requester tetap dari akun.
- Transaksi simulasi: input campuran atomik, duplicate membatalkan seluruh batch, edit dengan data basi ditolak, edit identitas memindahkan sumber ke Sampah dan menjaga pencatat awal, konflik identitas tidak ditimpa, requester lain tidak bisa mengedit/menghapus.
- Auth dengan SDK simulasi: Ingat saya memilih persistence lokal, tanpa Ingat saya memilih memori; sesi dipulihkan otomatis setelah pemeriksaan profil; hasil lama tidak mengaktifkan kembali akun yang sudah keluar; koneksi gagal menjadi error yang bisa dicoba ulang; inisialisasi Firebase ganda memakai instance yang sudah tersedia.
- Kalender memiliki grid Senin–Minggu dan tanggal kabisat. Enter mengirim; Shift+Enter dan input IME tetap di box.
- Dua tab utama tetap tersedia. Tidak ada select/date picker native di aplikasi. Nomor memakai DM Sans. Referensi file/modul, ID DOM, pemetaan Firebase project/site, serta header framing Teams diperiksa.
- Semua JavaScript lulus pemeriksaan sintaks, seluruh konfigurasi JSON valid, dan semua 13 aset di folder public berhasil dibaca melalui server HTTP lokal.

Konfigurasi: project `request-reverse-app`, target/site `requestreverseacc`.

Pengamatan halaman yang sedang terpasang:

- Halaman login menampilkan “Menghubungkan workspace…” lalu tombol Masuk aktif. Kesalahan aplikasi yang menyebabkan crash tidak teramati; log yang ditemukan berasal dari ekstensi browser.
- Versi baru menambahkan batas waktu, tombol coba lagi, penanganan hasil auth terlambat, dan reuse instance. Ini memperkuat alur login; penyebab crash spesifik pengguna belum dapat dipastikan.

Batas verifikasi:

- Tes memakai adapter Firebase/Auth dan DOM simulasi. Tidak menggunakan kredensial pengguna dan tidak mengubah database produksi.
- Rules Firestore belum dikompilasi atau dijalankan melalui emulator/layanan produksi. Rules membatasi pemilik/pemosting, menjaga audit dan identitas, menggunakan link transaksi untuk koreksi identitas, serta melarang hapus permanen. Efektivitasnya perlu diperiksa setelah deploy.
- Tampilan versi baru diperiksa dari HTML/CSS dan alur controller; belum diperiksa dengan screenshot browser versi baru.
- Penyimpanan sesi pada browser/iframe Teams, akun tim nyata, sinkronisasi antar akun, dan clipboard tenant kantor belum diuji langsung.
- Versi 3.0 belum dideploy ke akun Firebase pengguna.

Untuk upgrade, jalankan `firebase deploy --only firestore`, tunggu indeks baru aktif, lalu `firebase deploy --only hosting:requestreverseacc`. Dokumen lama tetap dibaca; field edit dan Sampah bersifat opsional pada data lama.

Sesudah deploy, verifikasi dengan requester dan pemosting: masuk dengan Ingat saya lalu buka ulang, submit campuran AIO/ODI, cek Request saya dan badge, edit request open, hapus/pulihkan, lalu copy/bulk selesai/arsip. Pastikan request pengguna lain tidak bisa diedit atau dihapus oleh requester biasa.
