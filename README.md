# Drive Photo Auditor (React + TypeScript)

1. `cp .env.example .env` lalu isi `VITE_GOOGLE_CLIENT_ID`
2. Google Cloud Console: aktifkan Drive API; OAuth Client ID tipe Web;
   Authorized JavaScript origins: `http://localhost:5173` (dan domain produksi Anda)
3. `npm install && npm run dev`
4. Deploy: `npm run build` -> folder `dist/` (header COOP sudah disiapkan untuk Netlify `public/_headers` dan Vercel `vercel.json`)

## Catatan fitur
- OCR cap waktu memakai Tesseract.js (bahasa eng+ind); file bahasa diunduh otomatis dari CDN saat pertama dipakai.
- Foto dalam PDF: dihitung per halaman (ikon/logo <100px diabaikan), EXIF dipulihkan bila JPEG asli tertanam utuh, sisanya dibaca lewat OCR dan teks sekitar foto.
- DOCX: keterangan foto diambil dari alt-text dan paragraf caption. DOC biner: best-effort. Google Docs asli diekspor ke DOCX otomatis.
