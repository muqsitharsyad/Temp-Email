# Temp Email — Self-hosted Temporary Inbox

Aplikasi ringan untuk **menerima email sementara** (OTP, verifikasi, dsb).
Stack: **Node.js 20** + Express + WebSocket. UI murni HTML/CSS/JS (tanpa
build step).

Tersedia **dua mode** — pilih sesuai resource yang Anda punya:

| Mode      | Butuh domain? | Butuh port 25? | Catatan |
|-----------|---------------|----------------|---------|
| `mailtm`  | ❌            | ❌              | UI jadi client `api.mail.tm`. Domain milik mail.tm (mis. `@indigobird.com`). Cocok kalau Anda hanya bisa **deploy container di sub-path** dan tidak punya kontrol DNS. |
| `smtp`    | ✅ + MX       | ✅              | Self-host. Anda bebas memilih local-part & domain sendiri (mis. `apa-saja@tempmail.contoh.id`). Butuh akses ke DNS untuk pasang MX dan port 25 publik di server. |

Mode default: `mailtm` (tanpa konfigurasi tambahan). Ganti via env
`MAIL_PROVIDER=smtp` jika Anda punya domain & port 25.

## Fitur
- Acak / pilih sendiri alamat email (`apa-saja@domain-anda`).
- Inbox realtime via WebSocket (langsung muncul saat email diterima).
- Auto-deteksi & tombol **Salin OTP** (4–8 digit / kode alfanumerik).
- Tampilan HTML email di iframe `sandbox` (aman dari script).
- Multi-domain (set lewat env `MAIL_DOMAINS`).
- TTL inbox & batas pesan per inbox dapat dikonfigurasi.
- Image Docker tunggal, < 200 MB.

## Jalankan cepat (Docker Compose)

```bash
cp .env.example .env
docker compose up -d --build
```

Buka `http://SERVER_IP:3000`. Default langsung pakai mode **mailtm** —
klik tombol **"Baru"** di UI dan Anda langsung dapat alamat email aktif
seperti `r4nd0m@indigobird.com` yang siap dipakai.

> Akun mail.tm dibuat di browser Anda dan **kredensialnya disimpan di
> `localStorage` browser** (bukan di server). Kalau Anda buka di browser
> lain, alamat lama tidak bisa diakses lagi — buat baru saja.

## Deploy di belakang reverse proxy (sub-path)

Jika UI akan diakses di **path**, contoh
`https://prodev.ut.ac.id/dockdock/temp-email/`, set `BASE_PATH`:

```env
BASE_PATH=/dockdock/temp-email
```

Itu hanya mengubah URL **web/UI**. **Domain email** tetap harus berupa
hostname nyata yang punya MX record (lihat bagian DNS). Tidak bisa
`user@prodev.ut.ac.id/dockdock/temp-email` — alamat email tidak mengenal
path URL.

Contoh konfigurasi nginx (di server reverse-proxy `prodev.ut.ac.id`):

```nginx
location /dockdock/temp-email/ {
    proxy_pass         http://APP_SERVER:3000/dockdock/temp-email/;
    proxy_http_version 1.1;
    proxy_set_header   Host              $host;
    proxy_set_header   X-Real-IP         $remote_addr;
    proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header   X-Forwarded-Proto $scheme;
    # WebSocket
    proxy_set_header   Upgrade           $http_upgrade;
    proxy_set_header   Connection        "upgrade";
    proxy_read_timeout 3600s;
}
```

Apache (`mod_proxy`, `mod_proxy_wstunnel`):

```apache
ProxyPreserveHost On
ProxyPass        /dockdock/temp-email/ws  ws://APP_SERVER:3000/dockdock/temp-email/ws
ProxyPassReverse /dockdock/temp-email/ws  ws://APP_SERVER:3000/dockdock/temp-email/ws
ProxyPass        /dockdock/temp-email/    http://APP_SERVER:3000/dockdock/temp-email/
ProxyPassReverse /dockdock/temp-email/    http://APP_SERVER:3000/dockdock/temp-email/
```

> Reverse proxy di atas hanya melayani **HTTP/HTTPS**. Lalu lintas **SMTP
> (port 25)** dari mail server eksternal **tidak lewat** reverse proxy
> tersebut — harus mengenai server SMTP ini secara langsung lewat IP
> publik + record MX.

## Konfigurasi DNS (hanya untuk mode `smtp`)

Lewati bagian ini kalau Anda pakai mode `mailtm`.

Misal Anda punya subdomain `tempmail.ut.ac.id`. Di panel DNS:

| Type | Name                   | Value                       | Prio |
|------|------------------------|-----------------------------|------|
| A    | `tempmail.ut.ac.id`    | `IP_PUBLIK_SERVER_SMTP`     | —    |
| MX   | `tempmail.ut.ac.id`    | `tempmail.ut.ac.id.`        | 10   |

Lalu set di `.env`:

```env
MAIL_DOMAINS=tempmail.ut.ac.id
```

Hasil: alamat email yang dipakai user adalah `apa-saja@tempmail.ut.ac.id`,
sementara UI dibuka di `https://prodev.ut.ac.id/dockdock/temp-email/`.

Bisa multi-domain, pisahkan koma:
```env
MAIL_DOMAINS=mail.example.com,inbox.contoh.id
```

## Variabel lingkungan

| Variabel            | Default         | Keterangan                                        |
|---------------------|-----------------|---------------------------------------------------|
| `MAIL_PROVIDER`     | `mailtm`        | `mailtm` (pakai api.mail.tm) atau `smtp` (self-host). |
| `MAIL_DOMAINS`      | `example.test`  | Domain yang dilayani (mode `smtp` saja).          |
| `MAIL_TTL_MINUTES`  | `60`            | Lama email disimpan sebelum dihapus otomatis (mode `smtp`). |
| `MAX_PER_INBOX`     | `50`            | Maksimum pesan per alamat (mode `smtp`).          |
| `HTTP_PORT`         | `3000`          | Port web UI / API.                                |
| `SMTP_PORT`         | `25`            | Port SMTP inbound (mode `smtp`).                  |
| `HTTP_HOST`         | `0.0.0.0`       | Bind address HTTP.                                |
| `SMTP_HOST`         | `0.0.0.0`       | Bind address SMTP.                                |
| `BASE_PATH`         | *(kosong)*      | Sub-path UI di balik reverse proxy, misal `/dockdock/temp-email`. |

## Catatan port 25
Banyak provider cloud (AWS, GCP, Azure, Oracle) **memblokir port 25 inbound
secara default**. Pastikan firewall/security-group mengizinkan TCP/25 masuk.
ISP rumahan biasanya juga memblokir; gunakan VPS untuk hasil terbaik.

Jika Anda tidak bisa expose port 25, jalankan di belakang reverse SMTP /
mailgun route / Cloudflare Email Routing yang mem-forward ke port custom,
lalu set `SMTP_PORT` sesuai forward target.

## Endpoints API

| Method | Path                              | Keterangan                          |
|--------|-----------------------------------|-------------------------------------|
| GET    | `/api/config`                     | Daftar domain yang dilayani.        |
| GET    | `/api/random`                     | Generate alamat acak.               |
| GET    | `/api/inbox/:address`             | List pesan (tanpa body).            |
| GET    | `/api/inbox/:address/:id`         | Detail satu pesan (text + html).    |
| DELETE | `/api/inbox/:address/:id`         | Hapus satu pesan.                   |
| DELETE | `/api/inbox/:address`             | Kosongkan inbox.                    |
| WS     | `/ws`                             | Subscribe inbox realtime.           |

WebSocket protocol:
```json
// client -> server
{"type":"subscribe","address":"abcd@mail.example.com"}
// server -> client (saat ada mail baru)
{"type":"mail","address":"abcd@mail.example.com","message":{...}}
```

## Uji lokal tanpa DNS

```bash
docker compose up -d --build
# kirim email dummy via swaks (atau curl dengan smtp client lain)
swaks --to test@example.test --from foo@bar.com \
      --server localhost:25 \
      --header "Subject: OTP 123456" --body "Kode Anda: 123456"
```

Atau cepat via `nc`:
```bash
printf "HELO me\r\nMAIL FROM:<a@b>\r\nRCPT TO:<x@example.test>\r\nDATA\r\nSubject: Hi\r\n\r\nKode: 987654\r\n.\r\nQUIT\r\n" | nc localhost 25
```

Lalu buka UI dan ketik `x` di kolom address, pilih domain `example.test`.

## Pengembangan lokal (tanpa Docker)

```bash
npm install
SMTP_PORT=2525 MAIL_DOMAINS=example.test npm start
# port 25 butuh root di Linux/Mac, gunakan 2525 saat dev
```

## Keamanan
- Tidak ada autentikasi — siapapun yang tahu URL bisa membaca semua inbox.
  Pasang reverse proxy (nginx/caddy) + Basic Auth bila perlu, atau batasi
  akses lewat VPN/Tailscale.
- HTML email dirender di `<iframe sandbox>` sehingga script di dalam email
  tidak akan dieksekusi.
- SMTP tanpa AUTH/STARTTLS karena hanya melayani inbound publik.

## Lisensi
MIT
