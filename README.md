# Netlify Deployer

Aplikasi web statis (HTML/CSS/JS vanilla) untuk men-deploy repository GitHub ke Netlify
langsung dari browser, plus menghapus project Netlify.

## Struktur
```
project/
├── index.html          Halaman utama (tanpa <style>/<script> inline)
├── 404.html            Halaman error
├── robots.txt
├── css/style.css       Seluruh styling (+ aksesibilitas & reduced-motion)
├── js/script.js        Seluruh logika (dimuat dengan defer)
└── assets/
    ├── images/         Taruh danuk.jpg (foto profil) di sini
    ├── icons/          favicon.svg
    └── fonts/          (kosong - font masih dari Google Fonts)
```

## Menjalankan lokal
Buka `index.html` di browser, atau jalankan server statis:
```
npx serve .
```

## Deploy
Drag-and-drop folder ini ke Netlify, atau hubungkan repo GitHub (tanpa build command, publish directory `.`).

## Dependensi eksternal (CDN)
- Tailwind CSS (cdn.tailwindcss.com) - **hanya untuk development**, lihat TODO
- Font Awesome 6.4.0 (cdnjs)
- Google Fonts: Plus Jakarta Sans, JetBrains Mono

## Keamanan
- Token Netlify hanya dikirim ke `api.netlify.com`. Tidak ada server perantara.
- "Remember" hanya menyamarkan token dengan base64 - **bukan enkripsi**. Jangan dicentang di perangkat bersama.
- Tombol Disconnect menghapus semua data lokal (pengaturan, riwayat token, cache repo).

## TODO
- [ ] Ganti Tailwind CDN dengan build (Tailwind CLI) -> hemat ~300 KB JS & hilangkan warning produksi
- [ ] Ganti Font Awesome penuh dengan SVG inline untuk ~25 ikon yang dipakai
- [ ] Tambah Content-Security-Policy lewat file `_headers` (uji dulu agar Tailwind CDN tidak terblokir)
- [ ] Pindahkan font ke `assets/fonts/` (self-host) bila ingin bebas dari Google Fonts
- [ ] Isi `canonical` dan `og:image` di `index.html` setelah domain final ada
