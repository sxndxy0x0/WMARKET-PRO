# Price Sync — Backend

Architecture: **Game/mod API → Express Backend → Firestore → Next.js Frontend**

Node.js + Express + **Cloud Firestore** (Firebase's NoSQL database, accessed via `firebase-admin`). Rewritten from an earlier SQLite version (Aug 2026) — see "ทำไมเปลี่ยนมาเป็น Firestore" below for why.

## ทำไมเปลี่ยนมาเป็น Firestore

โปรเจกต์นี้เคยใช้ SQLite (`better-sqlite3` → `node:sqlite` → `libsql`) มาก่อน แต่เจอปัญหาเรื่อง **persistent disk** ตอน deploy ขึ้น free-tier hosting (Render free web service ไม่มี persistent disk ให้ฟรี ไฟล์ SQLite หายทุกครั้งที่ restart) เปลี่ยนมาใช้ **Firestore** เพราะ:
- **Firebase Spark plan ฟรีถาวร ไม่ต้องใส่บัตรเครดิต** ข้อมูลไม่หายเพราะเป็น managed database แยกจาก compute
- Backend เป็น Express ธรรมดา รันบน host ฟรีไหนก็ได้ (Render free tier ก็พอ) เพราะไม่ต้องพึ่ง disk ของ host เลย — state ทั้งหมดอยู่ใน Firestore

⚠️ **Spark plan มี quota จำกัด** (50K reads/day, 20K writes/day, 20K deletes/day) — ดูหัวข้อ "In-memory caching" ด้านล่างว่าโปรเจกต์นี้จัดการเรื่องนี้ยังไง

## Setup

### 1. สร้าง Firebase project

1. ไปที่ [console.firebase.google.com](https://console.firebase.google.com) → Add project (ฟรี ไม่ต้องใส่บัตร สำหรับ Spark plan)
2. เปิดใช้ **Firestore Database** (Build → Firestore Database → Create database → เลือก production mode)
3. เปิดใช้ **Authentication** (Build → Authentication → Get started → เลือก **Google** เป็น sign-in provider แล้ว Enable) — เว็บนี้ใช้ Google Sign-In เท่านั้น ไม่มี email/password
4. ไปที่ Project Settings (⚙️) → Service Accounts → **Generate new private key** จะได้ไฟล์ `.json` โหลดลงมา (ใช้ credential เดียวกันนี้สำหรับทั้ง Firestore และตรวจสอบ Google sign-in token — ไม่ต้องสร้างแยก)

### 2. ตั้งค่า credentials

```bash
cd backend
cp .env.example .env
```

แก้ `.env`:
- `API_KEYS` — ให้ตรงกับ `apiKey` ใน mod's config.json
- **Firebase credentials** — เลือกวิธีใดวิธีหนึ่ง:
  - **`FIREBASE_SERVICE_ACCOUNT_JSON`** — เปิดไฟล์ `.json` ที่โหลดมา, copy เนื้อหาทั้งหมดวางเป็นบรรทัดเดียวใน `.env` (เหมาะกับ deploy ขึ้น host ที่ mount ไฟล์ไม่สะดวก เช่น Render/Railway)
  - **`GOOGLE_APPLICATION_CREDENTIALS`** — ใส่ path ไปที่ไฟล์ `.json` แทน (เหมาะกับรันในเครื่องตัวเอง)

ไม่มี `JWT_SECRET` หรือ password secret อะไรให้ตั้งอีกแล้ว — auth ทั้งหมดพึ่ง Firebase Auth ยืนยันตัวตนให้ (ดูหัวข้อ Auth ด้านล่าง)

⚠️ **ไฟล์ service account key ห้ามขึ้น git เด็ดขาด** (เป็น credential เต็มรูปแบบของ Firebase project) `.gitignore` กันไว้แล้ว แต่เช็คให้ชัวร์ก่อน commit ทุกครั้ง

### 3. สร้าง composite index ที่จำเป็น

Query 3 แบบต้องมี composite index ก่อนถึงจะรันได้:
- `GET /api/stats`, `GET /api/stats/timeseries` — `where('server','==',...).where('createdAt','>=',...)`
- `GET /api/history` — `where('server','in',...).where('itemId','==',...).orderBy('createdAt','desc').limit(...)`
- Alert trigger — `where('server','in',...).where('triggeredAt','==',null)`

ทั้งสามอยู่ใน `firestore.indexes.json` แล้ว มี 2 ทางเลือก:
- **ทางง่าย**: เรียก endpoint นั้นครั้งแรก จะเจอ error `FAILED_PRECONDITION` พร้อมลิงก์ให้กดสร้าง index อัตโนมัติ (รอ 1-2 นาทีแล้ว retry) — ไม่ใช่ bug เป็นขั้นตอนปกติของ Firestore
- **ทางที่ดีกว่า (ทำล่วงหน้า)**: รัน `firebase deploy --only firestore:indexes` (ต้องมี [Firebase CLI](https://firebase.google.com/docs/cli) และ login ก่อน)

### 4. รัน

```bash
npm install
npm run dev
```

### 5. รัน tests

```bash
npm test
```

Smoke suite (`tests/`, Node built-in `node:test` — ไม่เพิ่ม dependency) ตรวจ cache semantics, WebSocket hub (routing / backpressure / shutdown), boot ของ server.js, /health, JSON error surface และ graceful shutdown — **โดย stub Firestore + server identity ผ่าน require.cache** (ดู `tests/helpers/stubs.js`) จึงไม่แตะ Firebase project จริงและไม่เปลือง quota แม้แต่ read เดียว

## Stability (เช็คลิสต์ที่ทำแล้ว)

- **Graceful shutdown บน SIGTERM/SIGINT** (`server.js`) — หยุดรับ connection ใหม่ → ปิด WebSocket clients ด้วย close code 1001 ("going away" — browser reconnect ได้สวยไม่งอม) → `closeIdleConnections()` + รอ in-flight requests drain ภายใน 10 วิ (timeout บังคับ เพื่อไม่ให้ socket ค้าง block การ restart ของ host เช่นตอน Render deploy)
- **Process-level handlers** — `unhandledRejection`: log แล้วอยู่ต่อ (background work เช่น alert check พัง ไม่ควรฆ่าทั้ง process); `uncaughtException`: drain gracefully แล้ว exit 1 เพื่อให้ host restart เป็น state สะอาด
- **WebSocket backpressure guard** (`websocket/hub.js`) — client ที่ buffer ล้น (>1MB `bufferedAmount`, เช่น tab ค้างที่เลิกอ่านข้อมูล) จะโดน terminate ตอน broadcast แทนการเขียนต่อ กัน memory โตไม่จำกัดจาก client เดียว; ทุก send มี try/catch + error callback และมี `wss.on('error')` กัน crash จาก event ไร้ listener
- **Alert check อยู่นอก critical path ของ ingest** (`controllers/pricesController.js`) — mod ได้รับ 201 ทันทีที่ราคาถูกเขียนลง Firestore เสร็จ (เดิม comment บอกว่าไม่ block แต่จริง ๆ await inline อยู่); alert check รันหลัง response พร้อม `.catch` ของตัวเอง ถ้า Firestore พังชั่วคราว sync ถัดไป retry ให้เอง
- **Cache periodic sweep** (`services/cache.js:pruneExpired` + interval 60s ใน server.js, unref'd) — เก็บ entry หมดอายุทิ้งแม้ช่วง traffic เงียบ memory จึงผูกกับข้อมูลที่ยังใช้จริง
- **/health มี context เพิ่ม** — `{ok, uptimeSeconds, wsClients}` (ok:true เหมือนเดิมสำหรับ health check; ไม่ ping Firestore เพราะ host poll ถี่และทุก read กิน Spark quota)
- **JSON error surface กรณี body มีปัญหา** — JSON พัง → `Invalid JSON body`, เกิน 1MB → `Request body too large`, ตอบกลับไปแล้ว headers sent → delegate ให้ Express จบเอง

## In-memory caching (สำคัญ — อ่านก่อน deploy)

`services/cache.js` เป็น TTL cache ธรรมดาใน memory (ไม่ใช่ Redis) ที่ endpoint อ่านข้อมูลแทบทุกจุดใช้ร่วมกัน (`priceService.js`, `statsService.js`) เพื่อกัน Firestore read quota หมดจาก:
- Frontend ที่ทุกหน้า/ทุก refresh ยิง `/api/prices`, `/api/stats`, `/api/stats/timeseries`, `/api/items`, `/api/history` — cache ไว้ 15-60 วิแล้วแต่ endpoint ให้หลายๆ request รวมกันเป็น Firestore read ครั้งเดียว
- `applyPriceUpdate` (ตอน POST sync เข้ามา) invalidate cache ที่เกี่ยวข้องทันที ไม่ต้องรอ TTL หมดอายุ ข้อมูลใหม่จึงเห็นได้ทันทีหลัง sync แม้จะ cache ไว้ก็ตาม

**ข้อจำกัด**: cache เป็น per-process ถ้า deploy เป็นหลาย instance พร้อมกัน (เช่น serverless หลาย region) แต่ละ instance จะ cache แยกกันเอง ไม่ share — ยังปลอดภัย (ไม่ error) แค่ effectiveness ลดลง ถ้าจะสเกลใหญ่ระดับนั้นควรเปลี่ยนไปใช้ Redis แทน

Frontend (Next.js) เองก็มี ISR (`revalidate = 15`) + on-demand `revalidateTag` ผ่าน WebSocket push อีกชั้นหนึ่ง เป็นสองชั้น cache ที่ทำงานร่วมกัน (Next.js Data Cache ชั้นนอก + backend in-memory cache ชั้นใน) — ดู `website/README` หรือ `lib/api.ts` comment ฝั่ง frontend สำหรับรายละเอียด

## API

### ราคา (public)

| Method | Path | Auth | คำอธิบาย |
|---|---|---|---|
| POST | `/api/prices` | Bearer API key (mod) | รับ payload จาก mod (server, timestamp, prices[] สูงสุด 250 รายการ) |
| GET | `/api/prices?server=` | ไม่ต้อง | ราคาปัจจุบันทั้งหมดของเซิร์ฟเวอร์ |
| GET | `/api/history?server=&item=&limit=` | ไม่ต้อง | ประวัติราคาของไอเทมเดียว (newest-first, จำกัดที่ `limit` ตั้งแต่ระดับ Firestore query (สูงสุด 200 รายการต่อคำขอ)) |
| GET | `/api/items?server=` | ไม่ต้อง | รายชื่อไอเทมทั้งหมดที่เคยเห็น |
| GET | `/api/stats?server=` | ไม่ต้อง | สรุปสำหรับ dashboard: total items, new today, avg 24h change %, top gainers, recent updates |
| GET | `/api/stats/timeseries?server=` | ไม่ต้อง | ค่าเฉลี่ยราคารายวัน 7 วันล่าสุด (สำหรับกราฟ) — หน้าต่างเวลาตายตัวที่ 7 วัน ไม่รับ `days` param แล้ว |
| GET | `/api/servers` | ไม่ต้อง | รายชื่อเซิร์ฟเวอร์ที่ Mod เคยส่งเข้ามา โดย Server Identity ถูก canonicalize และ case-insensitive |
| WS | `/ws?server=<server>` | ไม่ต้อง | `price_update` แบบ real-time เฉพาะเซิร์ฟเวอร์ที่ subscribe |

### Auth (ผู้ใช้เว็บ) — Google Sign-In เท่านั้น

ไม่มี email/password, ไม่มี register endpoint — sign-in เกิดขึ้นฝั่ง frontend ผ่าน Firebase Auth (`signInWithPopup` + Google) โดยตรง แล้วส่ง Firebase ID token มาที่ backend เป็น `Authorization: Bearer <idToken>`; backend แค่ verify token นั้น (`services/userAuth.js`) ไม่เคยเห็นรหัสผ่านเลย

| Method | Path | Auth | คำอธิบาย |
|---|---|---|---|
| GET | `/api/auth/me` | Bearer Firebase ID token | ข้อมูล user ปัจจุบัน (`{id, email, name, picture}` — จาก Google account) |

**หมายเหตุ**: `user.id` คือ **Firebase Auth uid** (string) ไม่ใช่ Firestore auto doc ID และไม่ใช่ SQL integer แบบเวอร์ชันเก่าๆ — ไม่มี `users` collection แยกใน Firestore อีกต่อไป เพราะ Firebase Auth เป็น user store อยู่แล้วในตัว ไม่ต้องทำสำเนาซ้ำ

### Watchlist / Price Alerts (ต้อง login ด้วย Google)

เหมือนเดิมทุกจุด (endpoint, request/response shape) — เปลี่ยนแค่วิธี auth ด้านบน `userId` ที่เก็บในทั้งสอง collection นี้ตอนนี้คือ Firebase uid

## โครงสร้าง Firestore (collections)

ไม่มี schema ตายตัวแบบ SQL แต่ field ที่แต่ละ document ใช้จริงมีดังนี้:

| Collection | Doc ID | Fields |
|---|---|---|
| `prices` | `${server}__${itemId}` (deterministic → upsert ง่าย) | `server, itemId, itemName, buyPrice, sellPrice, sellPriceHigh, stackPrice, updatedAt, firstSeenAt` |
| `priceHistory` | `v2_<sha256 logical key>` | `server, itemId, itemName, buyPrice, sellPrice, sellPriceHigh, stackPrice, createdAt` |
| `watchlist` | deterministic legacy ID when unambiguous; `v2_<sha256>` when `__` could collide | `userId, server, itemId, createdAt` |
| `priceAlerts` | auto | `userId, server, itemId, itemName, thresholdType, thresholdValue, createdAt, triggeredAt` |
| `servers` | SHA-256 ของ server identity | `name, identityKey, aliases, createdAt, lastSeenAt` |
| `userQuotas` | SHA-256 ของ Firebase uid | `userId, watchlistCount, alertCount, updatedAt` |
| `metadata/serverRegistryMigration` | fixed | `completedAt, version` |

(ไม่มี `users` collection — ดูหัวข้อ Auth ด้านบน)

### `sellPriceHigh` (running max ราคาขายสูงสุด)

หน้าเว็บ (คอลัมน์ "ราคาสูงสุด" ในตาราง + side panel) ต้องการราคาสูงสุดที่เคยขึ้นของแต่ละไอเทม แต่ก่อนหน้านี้ backend ไม่เคยเก็บค่านี้ไว้เลย (`PriceItem` มีแค่ราคาปัจจุบัน) — เพิ่ม field `sellPriceHigh` ใน `applyPriceUpdate()` (`services/priceService.js`) ให้ track ค่าสูงสุดแบบสะสมทุกครั้งที่ sync

**ข้อจำกัดที่ควรรู้:** ค่านี้เริ่มนับจากตอนที่ deploy field นี้เป็นต้นไปเท่านั้น ไม่ใช่ราคาสูงสุด "ตลอดกาล" จริงๆ สำหรับไอเทมที่มีอยู่ก่อนหน้านั้น (sync แรกหลัง deploy จะตั้ง `sellPriceHigh = sellPrice` ปัจจุบันเป็นค่าเริ่มต้น เพราะไม่มีประวัติเก่าให้ backfill) — ฝั่งเว็บใช้คำว่า "ราคาสูงสุดที่เคยบันทึกไว้" ไม่ใช้คำว่า "ตลอดกาล" เพื่อไม่ให้เข้าใจผิด

**ต้นทุนเพิ่ม:** ต้องอ่าน `prices` collection ทั้งหมดของ server นั้น 1 ครั้งก่อน build batch (เพื่อรู้ค่า high เดิมของแต่ละไอเทมมาเทียบ) — เป็น query เดียว ไม่ใช่ 1 read ต่อ item ดังนั้นต้นทุนยังคุมได้ (เดิม sync คือ 1 batch write, ตอนนี้เป็น 1 read + 1 batch write)

## งานต่อยอดที่ยังไม่ได้ทำ

- ✅ **Central error handler** — ยังอยู่ใน `server.js`, คืน JSON แทน HTML default
- ✅ **In-memory caching** — ทำแล้ว, ดูหัวข้อด้านบน
- ✅ **Alert checking เป็น batch query เดียวต่อ sync** — ไม่ใช่ query ต่อ item แล้ว (`alertsService.checkAndTriggerBatch`)
- **Per-server API keys** — ยังเป็น list เดียวใช้ร่วมกันทุกเซิร์ฟเวอร์
- **Server Identity** — ชื่อที่ Mod ส่งเข้ามาเท่านั้นที่มีสิทธิ์สร้าง/อัปเดต `servers` registry; ชื่อถูก normalize แบบ NFC + case-insensitive เพื่อให้ `siam`, `Siam`, `SIAM` เป็น Server เดียวกัน. `/api/servers` อ่านจาก registry และ WebSocket ต้องระบุ `?server=` เพื่อรับเฉพาะ event ของ Server นั้น. Public/user requests ที่ส่งชื่อ Server ใหม่จะไม่สร้าง Registry entry
- **Discord bot notification hook** — ยังไม่ได้เชื่อมต่อโดยตรง; สามารถให้บอทฟัง server-scoped WebSocket ได้
- **Rate limiting — ทำแล้ว** (`services/rateLimit.js`, wire เข้า `server.js` แบบ global + เข้ม route ที่อ่อนไหวกว่า เช่น `POST /api/prices`, `/api/auth`, `/api/watchlist`, `/api/alerts`)
- ✅ **API key comparison เป็น constant-time** — `services/auth.js` ใช้ `crypto.timingSafeEqual` แทน `.includes()` ธรรมดา กัน timing attack
- ✅ **Firestore doc-ID path injection ป้องกันแล้ว** — `services/validation.js`: `server`/`itemId` ที่ใช้ประกอบเป็น deterministic doc ID (`watchlistService`, `priceService`) ถูกตรวจว่าไม่มี `/`, `..`, NUL byte หรือรูปแบบสงวนของ Firestore ก่อนใช้เสมอ (มิเช่นนั้น `/` ที่หลุดเข้ามาจะถูก Firestore ตีความเป็น subcollection path แทนที่จะเป็นอักขระในชื่อ doc)
- **Price alerts เป็น polling-on-write ไม่ใช่ push จริง** — ดู comment ใน `services/alertsService.js`
- **`volume24h` เป็น `null` เสมอ** — mod ไม่มีข้อมูล trading volume ให้ใช้ (เจตนา ไม่ใช่ bug)
- **ยังไม่ได้ทดสอบกับ Firebase project จริง (ทั้ง Firestore และ Auth)** — ต้อง deploy indexes และทดสอบ transaction/query กับ project จริงก่อน production แต่ sandbox นี้ไม่มี Firebase project จริงให้เชื่อมทดสอบ end-to-end ทดสอบเองอีกทีตอน deploy จริงด้วยนะครับ (โดยเฉพาะเปิด Google provider ใน Firebase Console ตามข้อ 3 ในหัวข้อ Setup) ถ้าเจอ error ส่ง log มาดูได้
- ✅ **Graceful shutdown + process handlers + WS backpressure + cache sweep** — ทำแล้ว ดูหัวข้อ "Stability" ด้านบน (เดิม SIGTERM จะฆ่า process ทันทีกลาง in-flight write, WS client ที่ค้างกิน memory ไม่มีตัวจบ, และ alert check ดึง response ของ ingest ให้ช้าลงโดยไม่จำเป็น)
- ✅ **Smoke test suite (`npm test`) แบบ stub Firestore** — regression กันพื้นฐานเสถียรภาพ (cache/hub/HTTP/shutdown) โดยไม่ต้องมี credentials
