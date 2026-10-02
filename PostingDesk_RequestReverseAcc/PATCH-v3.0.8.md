# Patch v3.0.8

- Memperbaiki layout tabel desktop yang melebar/berantakan setelah Entitas dan Tahun dipisah menjadi kolom sendiri.
- Lebar kolom desktop sekarang dikontrol per kelas kolom, bukan `nth-child`, sehingga penambahan kolom tidak menggeser pembagian lebar secara salah.
- Kolom `Cek` memiliki lebar minimum yang stabil; badge `Menunggu`, `Selesai`, dan status lain tidak lagi pecah per huruf.
- Baris tampilan Ringkas kembali pendek dan konsisten.
- Nomor dokumen, Entitas, Tahun, Tanggal, Status, dan tombol tindakan dijaga satu baris pada desktop.
- Layar menengah memakai horizontal scroll jika ruang tidak cukup daripada memaksa kolom menjadi terlalu sempit.
- Layout kartu mobile <=680px tidak diubah oleh patch ini.
