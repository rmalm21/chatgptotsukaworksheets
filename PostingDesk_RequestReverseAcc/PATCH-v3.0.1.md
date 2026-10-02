# Posting Desk v3.0.1 — Delete Permission Fix

Perubahan:

- Requester dapat melakukan soft-delete untuk request **Pending** yang dibuat oleh UID-nya sendiri.
- Poster tetap dapat menghapus request mana pun.
- Rule soft-delete dibuat eksplisit dan terpisah dari validator umum agar tidak terjadi false `permission-denied`.
- Pesan error penghapusan dibuat lebih spesifik.

## Deploy

Dari folder project:

```bash
firebase deploy --only firestore:rules,hosting
```

Jika hanya rule yang ingin diperbarui:

```bash
firebase deploy --only firestore:rules
```
