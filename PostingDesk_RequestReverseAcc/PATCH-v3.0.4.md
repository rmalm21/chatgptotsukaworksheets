# Patch v3.0.4 — Bulk Delete Selected

- Menambahkan tombol **Hapus dipilih** pada selection bar.
- Tombol baru hanya muncul ketika ada dokumen terpilih dan tampilan bukan Sampah.
- Poster dapat menghapus banyak dokumen terpilih sekaligus.
- Requester tetap dibatasi: hanya request Pending miliknya sendiri yang dapat dihapus.
- Menggunakan soft-delete yang sama dengan Hapus satuan, sehingga dokumen masuk ke Sampah dan masih dapat dipulihkan.
- Batas bulk tetap mengikuti `MAX_BULK` (250 dokumen per tindakan).
- Layout tombol bulk delete ikut responsif di mobile.
