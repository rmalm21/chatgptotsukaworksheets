# Patch v3.0.3 — Soft Delete Isolation

Perubahan utama:
- Soft-delete (`deleteKind: user`) dipindah ke `allow update` yang berdiri sendiri.
- Jalur Hapus tidak lagi bergantung pada `validRecord`, `updateActor`, validasi nama audit, atau validasi timestamp audit.
- Otorisasi tetap dijaga di Rules:
  - `poster`: boleh soft-delete request non-deleted mana pun.
  - `requester`: hanya request miliknya (`createdByUid == auth.uid`) yang `pending` dan belum archived.
- Field yang boleh berubah saat Hapus tetap dibatasi dengan `diff().affectedKeys().hasOnly(...)`.
- `deletedByUid` dan `updatedByUid` wajib sama dengan UID akun login.
- Jika server masih menolak, UI menampilkan role/UID/owner/status/archived yang benar-benar dibaca aplikasi untuk diagnosis.

Deploy:
`firebase deploy --project request-reverse-app --only "firestore:rules,hosting"`
