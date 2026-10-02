# PostingDesk v3.0.6 — Monthly Index & Firestore Lite

Perubahan utama:
- Indeks bulan dengan tombol bulan sebelumnya/berikutnya dan kembali ke bulan ini.
- Default query hanya membaca bulan aktif; opsi Semua tanggal tetap tersedia tetapi diberi label lebih berat.
- Tidak menambah field `monthKey`, jadi tidak perlu backfill data lama dan tidak menambah write per dokumen.
- Counter open memakai Firestore aggregation `count()` alih-alih listener yang membaca seluruh dokumen pending.
- Bulk status/delete/archive memakai `writeBatch` dari data yang sudah ada di layar, sehingga tidak melakukan transaction read ulang untuk setiap dokumen.
- Submit massal mengecek duplicate via query `documentId in (...)` per chunk lalu melakukan batch write; jauh lebih hemat daripada membaca 1 dokumen per nomor sebelum create.
- Setelah bulk action, UI mengandalkan listener aktif dan tidak unsubscribe/resubscribe paksa, sehingga hasil query bulanan tidak dibaca ulang tanpa perlu.
- Edit tetap transaction untuk menjaga deteksi konflik dan perubahan document ID.
- Entitas + tahun pada row dibuat rapat satu baris. Di form mobile, Entitas dan Tahun ditempatkan berdampingan pada baris yang sama.

Security Rules tidak diubah dari v3.0.5/v3.0.4 delete fix.
