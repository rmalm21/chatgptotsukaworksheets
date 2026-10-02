# Patch v3.0.7

- Antrean selalu membaca semua request `pending` pada ruang + entitas aktif, tanpa filter periode.
- Filter periode hanya tampil dan diterapkan pada Selesai dan Arsip.
- Query Firestore per tab dipisah berdasarkan status agar read tidak mengambil Pending + Done sekaligus.
- Entitas dan Tahun menjadi kolom tabel terpisah.
- Nomor dokumen mendukung drag vertikal khusus: hanya nomor yang dipilih lalu dicopy, tanpa teks kolom lain.
- Panduan produksi di `/setup.html` diubah menjadi panduan penggunaan umum; instruksi setup/deploy dihapus dari UI produksi.
- Tampilan mobile dan ringkas disesuaikan untuk kolom Entitas/Tahun baru.
