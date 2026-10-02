# Patch v3.1.0

## Cari & lacak nomor
- Kotak **Cari nomor dokumen** di atas daftar (shortcut `/`). Mengetik menyaring daftar aktif (cocok sebagian nomor); tanpa read Firestore tambahan. Copy dan Pilih semua mengikuti hasil saringan.
- **Enter / Lacak di semua data** mencari di seluruh workspace: semua jenis, entitas, tahun, dan status (Antrean, Selesai, Arsip, Sampah).
  - Nomor lengkap 10 digit, boleh banyak sekaligus (maks. 100, bisa paste dari Excel) → `where documentNumber in` per 30 nomor.
  - 4–9 digit → nomor berawalan digit tersebut (maks. 50 hasil).
  - Memakai index single-field bawaan `documentNumber`; **tidak ada index komposit baru**. Read hanya sebanyak dokumen yang ditemukan.
- Hasil menampilkan status, jenis, entitas, tahun, requester, tanggal, dan aktivitas terakhir; nomor yang belum pernah tercatat disebutkan terpisah.
- **Riwayat** membuka detail; **Buka di daftar** pindah ke ruang, entitas, status, dan bulan dokumen dengan filter nomor aktif.

## Riwayat aktivitas (traceability)
- Field baru `trail` (map `e1`, `e2`, …) dan `trailCount`. Setiap tulis menambah satu entri `{a, at, uid, name, info?}`: `create`, `edit`, `done`, `reopen`, `archive`, `restore`, `delete`, `undelete`.
- Sebelumnya, Buka kembali menghapus nama penyelesai, Pulihkan arsip menghapus nama pengarsip, dan Edit menimpa data lama tanpa jejak. Sekarang semuanya tetap tercatat; edit menyimpan ringkasan perubahan (mis. `Nomor … → … · Entitas AIO → ODI · Catatan diubah`).
- Rules menegakkan: tepat satu entri baru per tulis, `at == request.time`, `uid`/`name` = akun yang login, aksi sesuai transisi, entri lama tidak boleh diubah/dihapus.
- Map dipakai (bukan array) karena `serverTimestamp()` tidak didukung di dalam array Firestore. Update hanya menulis `trail.eN` (field path), bukan seluruh map.
- Koreksi identitas (nomor/jenis/entitas/tahun) menyalin riwayat ke dokumen baru dan menambah entri `edit`; dokumen lama mendapat entri `delete` "Diganti saat edit → …".
- Dokumen lama tanpa `trail` tetap tampil dengan jejak yang diturunkan dari field audit (berlabel *data lama*).
- Detail dokumen kini ringkas: identitas + Riwayat aktivitas + catatan.

## Rules lebih ringan
- Profil anggota dibaca sekali per evaluasi dan diteruskan ke fungsi; jenis transisi dihitung sekali. Tanpa ini validasi trail melewati batas 1000 ekspresi rules.
- Jalur soft-delete terpisah digabung ke jalur update tunggal yang sudah diuji (hapus requester pemilik, hapus pemosting, hapus karena koreksi).
- Teruji di Firestore Emulator: 10 skenario termasuk create 100 dokumen per batch dan bulk 250 dokumen (selesai → arsip → hapus).

## Lain-lain
- Cek duplikat saat kirim menyebut lokasi nomor yang sudah ada, contoh `5000043992 (Request Reverse AIO 2026 · Selesai)`, dan memberi peringatan bila nomor yang sama tercatat di jenis/entitas/tahun lain (tidak memblokir).
- Pesan error Hapus tidak lagi menampilkan UID/role/debug internal.
- Render lebih ringan: centang checkbox tidak membangun ulang seluruh tabel; preview paste tidak di-parse ulang di setiap render.
- Tag tahun lain tidak lagi menabrak kolom Requester di desktop.
- Mobile: tidak ada scroll horizontal (caption scope bisa turun baris); tombol Selesaikan tidak terpotong dan tombol … tidak menimpa.
- Ringkasan Copy di Antrean tidak lagi menampilkan rentang bulan yang tidak dipakai.
- Versi di header: 3.1.0. Preconnect ke gstatic untuk mempercepat muat SDK Firebase.

## Deploy
```bash
firebase deploy --only firestore
firebase deploy --only hosting:requestreverseacc
```
Jalankan berurutan tanpa jeda, lalu minta semua pengguna memuat ulang tab. Rules 3.1 menolak tulis dari aplikasi 3.0.x (tanpa riwayat). Tidak ada index baru.
