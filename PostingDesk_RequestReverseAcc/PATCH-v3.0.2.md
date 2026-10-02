# PostingDesk v3.0.2 — requester delete fix

Perubahan utama:
- Soft-delete requester memakai UID sebagai sumber otorisasi utama.
- Nama tampilan tidak lagi harus sama persis dengan field member untuk mengizinkan delete.
- Timestamp delete/update menerima timestamp sah <= request.time sehingga kompatibel dengan serverTimestamp SDK.
- Identitas request tetap tidak bisa diubah ketika delete; hanya field status/audit delete yang diizinkan.
- Poster tetap dapat menghapus request mana pun; requester hanya request pending miliknya sendiri.
