# WMarket — Minecraft Market Dashboard

Next.js 16 (App Router) + React 19 + Tailwind CSS สำหรับแสดงราคาตลาด Minecraft จาก Price Sync Backend โดยรองรับหลายเซิร์ฟเวอร์, watchlist, price alerts และการอัปเดตราคาผ่าน WebSocket

## Setup

```bash
npm ci
cp .env.local.example .env.local
npm run dev
```

กำหนดค่าใน `.env.local`:

- `NEXT_PUBLIC_API_URL` — URL ของ Price Sync Backend ⚠️ **production ต้องเป็น `https://` เท่านั้น** (`normalizeApiUrl` ใน `lib/api.ts` ปฏิเสธ http:// ตอน NODE_ENV=production โดยตั้งใจ — ถ้าชี้ http ทุกหน้า server-rendered จะ render เป็น error branch ทันที; dev mode ยกเว้นให้ localhost http ได้)
- `NEXT_PUBLIC_SITE_URL` — URL สาธารณะของเว็บไซต์ (จำเป็นใน production สำหรับ `/api/revalidate`)
- `NEXT_PUBLIC_FIREBASE_API_KEY`
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
- `NEXT_PUBLIC_FIREBASE_APP_ID`

จากนั้นตรวจสอบด้วย:

```bash
npm run typecheck
npm run lint
npm run build
```

## Routes

| Route | รายละเอียด | Login |
|---|---|---|
| `/` | เลือกเซิร์ฟเวอร์จาก registry ของ Backend | ไม่ |
| `/<server>` | Dashboard ราคาและสถิติ | ไม่ |
| `/<server>/market` | รายการสินค้าและตัวกรอง | ไม่ |
| `/<server>/categories` | สินค้าแยกตามหมวดหมู่ | ไม่ |
| `/<server>/item/<id>` | รายละเอียดสินค้าและประวัติราคา | ไม่ |
| `/<server>/watchlist` | รายการสินค้าที่ติดตาม | ใช่ |
| `/<server>/alerts` | สร้าง/ดู/ลบ price alerts | ใช่ |
| `/login` | Google Sign-In ผ่าน Firebase | ไม่ |
| `/register` | Redirect ไป `/login` เพื่อรองรับ URL เก่า | ไม่ |

## Data / caching

- ราคา, history และ stats ใช้ Next.js Data Cache พร้อม tag แยกตามเซิร์ฟเวอร์และ safety revalidation 15 วินาที
- Browser ฟัง `price_update` จาก WebSocket แล้วเรียก `/api/revalidate` เพื่อ purge cache ของเซิร์ฟเวอร์นั้น จากนั้น refresh หน้าเว็บทันที
- รายชื่อเซิร์ฟเวอร์ถูกโหลดจาก Backend แบบ dynamic ไม่ hardcode ชื่อเซิร์ฟเวอร์
- Watchlist เป็นข้อมูลเฉพาะผู้ใช้ จึงไม่ใช้ shared Data Cache และถูกยกขึ้นมาไว้ใน `WatchlistProvider` เพื่อไม่ให้แต่ละปุ่มดาวยิง request ซ้ำ
- API response ที่มาจาก Backend มี runtime validation ก่อนนำไปใช้ใน UI

## Security / robustness

- ตรวจสอบและ canonicalize server name ก่อนใช้เป็น route, cache tag หรือ API parameter
- จำกัดขนาด request และตรวจ Origin สำหรับ `/api/revalidate`
- จำกัด request ต่อ IP และ revalidation ต่อเซิร์ฟเวอร์ใน process เดียวกัน
- จำกัดขนาดรูปภาพจากแหล่งภายนอกใน Minecraft icon proxy และตรวจ `Content-Type`
- ไม่เก็บ Firebase ID token เองใน `localStorage`; Firebase SDK จัดการ session ให้
- ตั้ง security headers พื้นฐาน เช่น `nosniff`, `Referrer-Policy`, `Permissions-Policy` และ `frame-ancestors`

## Minecraft icons

`app/icon.png` และ `app/apple-icon.png` ใช้โลโก้ WMarket เดียวกับ BrandLogo และถูกใช้เป็น Next.js special metadata files โดยตรง ส่วน item icons ใช้ local textures ใน `public/mc-textures` ก่อน fallback ไปยังแหล่งภายนอก

## Data quality pipeline (ข้อมูลจาก shop plugin)

ข้อมูลจริงจาก plugin ฝั่งเซิร์ฟเวอร์ไม่สะอาด — ทุกอย่างถูกจัดการที่ `lib/items.ts` และ parser layer ของ `lib/api.ts`:

- **ไอเทมซ้ำ** — plugin ลงทะเบียนรายการเดียวกัน 2 แถว (id ตรงๆ และ twin `#variant-<hash>` ราคาเดียวกัน) → `dedupeBy()` ยุบเป็นแถวเดียวต่อ (base id + ชื่อ) เลือกแถว canonical โดยเอาแบบไม่มี fragment ก่อน ไม่งั้นเอาแถวล่าสุด
- **ชื่อมีขยะ** (`§r`, glyph PUA จาก resource pack) → `sanitizeItemName()` ตัดออกทุก parser ก่อนถึง UI
- **โลโก้หาย** — icon lookup ใช้ base id (ตัด `#fragment`) ทั้งฝั่ง `ItemIcon` และ `app/api/minecraft-icon/route.ts`

## Known quirks

- ⚠️ **Next.js 16 ส่ง dynamic params มาแบบ percent-encoded** (`/play.x%3A25565` → `params.server === "play.x%3A25565"`) ต่างจาก App Router รุ่นก่อน — ทุกจุดที่อ่าน params ต้องผ่าน `decodeServerSegment()` / decode id ก่อนใช้ (ดู comment ใน `lib/api.ts`)
- react-hooks v6 ห้าม setState sync ใน effect body (`set-state-in-effect`) — pattern reset-state-on-prop-change ที่ใช้อยู่คือ "setState ระหว่าง render" ตามที่ React แนะนำ ดู `[server]/alerts/page.tsx`

## Limitations

- การแจ้งเตือนราคาปัจจุบันเป็น in-app price alerts; การส่ง email/push/Discord ต้องทำฝั่ง Backend เพิ่ม
- WebSocket live refresh ต้องมี endpoint `/ws` ที่ Backend/proxy เปิดใช้งาน
- หาก Backend ไม่พร้อม เว็บไซต์ยังแสดงหน้า error ที่เหมาะสมแทน mock data
