> UI package v3.0.7 · Monthly index + Firestore-lite reads/writes + aligned entity/year.

# Posting Desk — Request Reverse & Cancel Park

Web untuk tim posting, dengan dua kamar: **Request Reverse** dan **Cancel Park**. Masing-masing dipisahkan menurut entitas **AIO / ODI**.

Konfigurasi Firebase sudah terisi untuk project **request-reverse-app**. Target Hosting **requestreverseacc** sudah dipetakan ke site **requestreverseacc** di `.firebaserc`. Alamat setelah deploy: **https://requestreverseacc.web.app**.

Buka **BACA-DULU.html** untuk panduan yang bisa dibaca langsung dari hasil ekstrak ZIP.

## Baru di versi 3.0

- **Request saya** berisi semua request yang dicatat dengan UID akun sendiri. **Antrean tim** tetap tersedia. Dua tab utama tetap Request Reverse / Cancel Park, dengan tombol AIO / ODI.
- Badge bulat menghitung request **open**, untuk kedua jenis dan entitas. Hitungan mengikuti ruang tim/pribadi, **semua tanggal**, sementara tabel mengikuti filter tanggal.
- Angka, nomor dokumen, tanggal, dan badge memakai **DM Sans**; judul memakai Manrope. Tabel memiliki jarak dan hierarki teks lebih rapi, informasi edit, dan tombol tindakan pada setiap baris.
- Sinonim tambahan: **rq rvs**, **req rvs**, **rvs** → Reverse; **cncl**, **cnle**, **park** → Cancel Park.
- Satu input dapat memuat **AIO dan ODI**. Label per baris atau judul blok menentukan tujuan. Setiap dokumen dari input campuran mendapat catatan entitas.
- Kotak dimulai kosong. Rapikan hanya memecah nomor dan merapikan label yang benar-benar diketik; tidak menambahkan jenis/entitas/tahun otomatis ke teks.
- **Enter** mengirim; **Shift+Enter** menambah baris. Pratinjau menampilkan tujuan setiap nomor sebelum disimpan.
- Dropdown dan kalender tanggal dibuat di dalam aplikasi, mendukung keyboard dan tidak memakai menu select/date bawaan browser.
- **Edit** nomor, jenis, entitas, tahun, tanggal, dan catatan; identitas requester tetap. Waktu dan editor terakhir tampil di baris dan detail.
- **Hapus** memindahkan request ke **Sampah** dan bisa dipulihkan. Saat identitas dokumen dikoreksi, catatan lama juga masuk ke Sampah dengan penanda “Diganti saat edit”.
- Login memiliki batas waktu koneksi, pesan kesalahan, tombol sambungkan lagi, dan perlindungan inisialisasi ganda. **Ingat saya** dicentang untuk menyimpan sesi dan masuk otomatis pada kunjungan berikutnya. Jika dimatikan, login hanya berada di memori halaman. Keluar mengakhiri sesi.
- Bulk selesai, copy seluruh hasil filter, filter tanggal, arsip, pulihkan, dan penanda tahun di luar tahun berjalan tetap tersedia.

## Contoh paste

```text
rq rvs
5000043992 aio
3000035398 odi
5000044177 aio
2026
```

Jenis berlaku untuk seluruh input. Entitas di baris dokumen berlaku pada baris tersebut; label sebagai judul blok berlaku ke baris berikutnya. Satu entitas atau tahun yang ditulis sebagai footer dapat mengisi nomor tanpa label, seperti contoh awal berikut:

```text
req reverse
5000043992
3000035398
5000044177
aio 2026
```

Blok campuran juga didukung:

```text
cncl
AIO 2026
5000043992 5000044177
ODI 2025
6300009033
```

Jika hanya nomor dimasukkan, tujuan mengikuti pilihan pada **Detail request**, awalnya tab/tombol aktif dan tahun berjalan. Tujuan hanya muncul pada pratinjau. Box tetap berisi nomor, tanpa template yang disisipkan. Paste langsung dirapikan; teks yang diketik bisa dirapikan dengan tombol **Rapikan**, tanpa perubahan otomatis saat meninggalkan box.

Dua entitas atau tahun yang ditulis pada satu baris dokumen dianggap ambigu. Pisahkan baris dan beri label. Jangan campur Reverse dan Cancel Park dalam satu input. Angka bukan 10 digit dan teks yang tidak dikenali ditampilkan sebagai error; batch belum disimpan. Maksimal 100 dokumen unik per input. Nomor tetap berupa teks agar leading zero aman. Catatan input baru maksimal 420 karakter agar tersedia ruang untuk catatan entitas otomatis.

## 1. Siapkan layanan Firebase

Di Firebase Console, pilih project **request-reverse-app**:

1. Aktifkan **Authentication → Sign-in method → Email/Password**.
2. Buat database **Cloud Firestore**, gunakan database default `(default)` dalam production mode. Rules dan indeks tersedia dalam ZIP.
3. Pastikan Hosting site **requestreverseacc** terdaftar di project ini. Jika belum, buat sekali lewat Hosting → Add another site, atau `firebase hosting:sites:create requestreverseacc` setelah login CLI.

File `public/firebase-config.js`, `firebase.json`, dan `.firebaserc` sudah diisi. Aplikasi menggunakan SDK Firebase dari CDN resmi; folder `public` langsung di-host, tanpa instalasi dependency aplikasi atau langkah build. `firebase init` tidak perlu dijalankan karena konfigurasi proyek sudah tersedia.

## 2. Beri akses akun tim

Di **Authentication → Users → Add user**, buat akun email/password dan copy UID masing-masing.

Di Firestore buat dokumen profil pada path berikut, dengan UID dari Authentication sebagai ID dokumen:

```text
workspaces/posting-team/members/UID_AKUN
```

Contoh profil Ka Nisa:

```json
{
  "displayName": "Nisa",
  "role": "poster",
  "active": true
}
```

Untuk requester, gunakan `role: "requester"` dan nama orang tersebut. `active` bertipe boolean, bukan teks; nama wajib diisi, maksimal 80 karakter.

Anggota aktif bisa membaca dan menambah request. Requester boleh mengedit dan menghapus request open miliknya sendiri, serta memulihkannya dari Sampah. Pemosting (`poster`) bisa menyelesaikan, mengarsip, memulihkan, membuka kembali, mengedit semua request open, serta menghapus/memulihkan request tim. Profil dibuat admin melalui Console. Requester memakai displayName profil akun login. Nama dan UID pencatat tersimpan untuk riwayat.

## 3. Deploy versi 3.0

Upload ZIP baru ke Cloud Shell, lalu jalankan:

```bash
cd ~
unzip -o PostingDesk_RequestReverseAcc_v3.0.zip
cd ~/PostingDesk_RequestReverseAcc
ls firebase.json
firebase deploy --only firestore
firebase deploy --only hosting:requestreverseacc
```

Jalankan deploy dari folder **PostingDesk_RequestReverseAcc** yang memuat `firebase.json`. Login Firebase yang sebelumnya sudah berhasil tetap dapat dipakai. Jika CLI belum terpasang di komputer lain, jalankan `npm install -g firebase-tools` dan `firebase login` terlebih dahulu.

**Pada upgrade ini, deploy Firestore juga diperlukan:** ada rules dan indeks baru untuk ruang pribadi, hitungan open, Sampah, serta edit dan hapus sesuai pemilik akun. Tunggu indeks baru aktif di Firestore → Indexes, lalu muat ulang web. Indeks lama tetap tercantum agar upgrade tidak meminta penghapusan indeks yang dipakai versi sebelumnya. ID tetap berdasarkan jenis + entitas + tahun + nomor, dan data lama tetap bisa dibaca. Field edit dan Sampah diperkenalkan sebagai field opsional pada data lama; tidak perlu migrasi massal.

Untuk perubahan tampilan berikutnya saja, gunakan `firebase deploy --only hosting:requestreverseacc`. Project default dan target sudah tersedia, sehingga `firebase init` tidak perlu dijalankan.

## 4. Tab Website di group chat Teams

Setelah deploy, buka group chat Teams → tambah tab → **Website**, lalu isi:

- Nama tab: **Posting Desk**.
- URL: **https://requestreverseacc.web.app**.

Simpan, kemudian masuk dengan akun tim yang dibuat pada langkah 2. Header Hosting sudah mengizinkan halaman ditampilkan di iframe Teams. Data di tab dan browser menggunakan workspace yang sama. Login memakai akun Firebase tim.

## 5. Alur harian

1. Pilih tab **Request Reverse / Cancel Park** dan tombol **AIO / ODI**.
2. Tempel request di box. Jenis, entitas, tahun, dan jumlah nomor muncul di preview; requester otomatis dari akun login.
3. Tekan **Enter** atau klik **Kirim dokumen**. Halaman membuka tab dan entitas sesuai tujuan request.
4. Ka Nisa memfilter tanggal request lalu **Copy nomor**. Semua hasil filter ikut disalin, termasuk halaman berikutnya; pilihan checkbox membatasi nomor yang disalin.
5. Setelah diproses di sistem posting, pilih dokumen lalu **Bulk selesai**.
6. Pada status **Selesai**, pilih dokumen lalu **Arsipkan**. Arsip bisa dipulihkan ke Selesai, lalu dibuka kembali ke Antrean jika cek keliru.

Copy tidak mengubah cek selesai. Proses reverse/cancel park dilakukan Ka Nisa di sistem posting. Tanggal filter memakai **tanggal request**, dengan tanggal awal WIB (Asia/Jakarta).

Semua tahun tampil bersama. Nomor unik berdasarkan jenis + entitas + tahun dokumen + nomor. Nomor yang sama pada tahun berbeda adalah dokumen berbeda, ditampilkan dan disalin per dokumen; perhatikan badge tahun dan ringkasan copy saat memproses. Nomor yang sudah berada di Arsip pada tahun yang sama perlu dipulihkan dan dibuka kembali bila hendak diproses ulang.

Arsip dan Sampah baru dimuat ketika dibuka, awalnya 100 catatan dan dapat ditambah. Data tetap tersimpan di Firestore. Tabel menampilkan 25 baris per halaman; copy seluruh filter mengambil semua hasil. Query antrean memakai jenis, entitas, status, status arsip, dan rentang tanggal, tanpa pemisahan tahun dokumen. Ruang pribadi menambahkan filter createdByUid. Badge open diperbarui lewat listener untuk request pending; hitungan semua tanggal tidak dibatasi filter tabel.

## Edit dan hapus

Klik nomor dokumen atau tombol **…** pada baris, lalu **Edit** atau **Hapus**. Edit tersedia saat request masih open. Request yang sudah diproses harus dibuka kembali oleh pemosting sebelum diedit, agar riwayat selesai tidak bercampur dengan koreksi data.

Waktu edit, editor, requester, dan pencatat awal tersimpan. Jika data berubah setelah editor dibuka, penyimpanan ditolak sampai pengguna membuka ulang editor. Jika nomor, jenis, entitas, atau tahun diubah, transaksi atomik menyimpan catatan baru dan menandai catatan lama di Sampah. Duplikat identitas yang sudah ada, termasuk di Sampah/Arsip, tidak ditimpa.

Sampah tidak memuat tombol hapus permanen. Pulihkan mengembalikan status sebelum dihapus, termasuk riwayat selesai/arsip. Catatan yang “Diganti saat edit” menunjukkan identitas pengganti pada detail; memulihkannya juga mengaktifkan kembali catatan lama, jadi periksa dahulu agar tidak memproses koreksi dan catatan lama bersamaan.

## Login otomatis

Centang **Ingat saya** saat masuk. Aplikasi memulihkan sesi yang masih valid, memeriksa profil anggota aktif, lalu membuka ruang tanpa mengisi ulang password. Jika checkbox dimatikan, sesi hanya berlaku pada halaman yang sedang terbuka. Klik **Keluar** untuk mengakhiri sesi.

Jika penyimpanan situs dibatasi pada tab Website Teams, matikan Ingat saya untuk masuk sekali atau buka situs di browser yang mengizinkan penyimpanan. Password tidak ditulis oleh aplikasi ke localStorage. Profil yang belum aktif tetap tidak mendapat akses, termasuk saat sesi dipulihkan.

## 6. Preview dan pemeriksaan

Dari root proyek:

```bash
python3 -m http.server 8080 --directory public
```

Buka `http://localhost:8080/?demo=1`. Demo memakai data contoh di perangkat ini dan tidak menulis request produksi. Untuk tes otomatis:

```bash
node --test tests/*.test.mjs
```

Setelah deploy, coba dengan dua akun: requester menambah request; pemosting melihat, copy, bulk selesai, dan arsip. Coba juga membuka tab Website di Teams. Hasil pemeriksaan lokal dan batasnya ada di **VERIFIKASI.md**.

## Jika ada kendala

- **Akses belum aktif:** UID dokumen profil harus sama dengan UID akun, `active` harus boolean true, dan role `requester` atau `poster`.
- **Permission denied:** pastikan `firebase deploy --only firestore` sudah dijalankan serta profil akun tersedia.
- **Indeks belum siap:** tunggu indeks di Firestore → Indexes menjadi aktif.
- **Copy dibatasi:** nomor tetap terlihat dan terpilih dalam dialog; gunakan Ctrl+C atau Cmd+C.
- **Site tidak ditemukan:** pastikan site `requestreverseacc` ada di project `request-reverse-app`.

## Referensi resmi

- [Firebase CDN SDK](https://firebase.google.com/docs/web/alt-setup)
- [Hosting targets](https://firebase.google.com/docs/hosting/multisites)
- [Hosting headers](https://firebase.google.com/docs/hosting/full-config)
- [Firebase Auth persistence](https://firebase.google.com/docs/auth/web/auth-state-persistence)
- [Firebase Email/Password](https://firebase.google.com/docs/auth/web/password-auth)
- [Firestore transactions](https://firebase.google.com/docs/firestore/manage-data/transactions)
- [Firestore Security Rules](https://firebase.google.com/docs/firestore/security/rules-conditions)


## v3.0.7
Default daftar memakai indeks bulan berdasarkan `requestDate`. Gunakan panah bulan untuk berpindah riwayat; opsi Semua tanggal tetap tersedia tetapi sengaja bukan default agar query Firestore tetap kecil. Counter open memakai aggregation count dan bulk mutation tidak membaca ulang setiap dokumen yang sudah terlihat di UI.

## v3.0.8
Perbaikan pembagian lebar kolom tabel desktop setelah pemisahan Entitas dan Tahun. Status tidak lagi terjepit/pecah vertikal dan mode Ringkas kembali padat.
