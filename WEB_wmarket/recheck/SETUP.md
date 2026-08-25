# WMarket — Local setup

## Install dependencies

โปรเจกต์ใช้ Next.js 16, React 19 และ ESLint 9 และมี `package-lock.json` สำหรับติดตั้งแบบ reproducible

```bash
npm ci
```

หากยังไม่มีไฟล์ environment:

```bash
cp .env.local.example .env.local
```

ตั้งค่าอย่างน้อย:

- `NEXT_PUBLIC_API_URL` — URL ของ Price Sync Backend
- `NEXT_PUBLIC_SITE_URL` — URL สาธารณะของเว็บไซต์ (production ต้องตั้งค่านี้)
- ค่า `NEXT_PUBLIC_FIREBASE_*` ตาม Firebase Web App

ไม่ต้อง hardcode รายชื่อเซิร์ฟเวอร์ใน `.env` เพราะเว็บโหลดจาก Backend แบบ dynamic

## Validate

```bash
npm run typecheck
npm run lint
npm run build
```

## Development

```bash
npm run dev
```

## Production

```bash
npm run build
npm run start
```

ห้าม commit secret หรือไฟล์ `.env.local` เข้า repository
