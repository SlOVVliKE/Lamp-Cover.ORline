# LINE Webhook Logger

โปรเจกต์ Node.js Express สำหรับรับ Webhook จาก LINE Messaging API และบันทึก log ลงไฟล์ `logs.json` โดยไม่ต้องใช้ database ภายนอก เหมาะสำหรับ deploy เป็น Web Service บน Render

## Features

- รับ webhook event จาก LINE OA ที่ `POST /webhook`
- เก็บ `userId`, `groupId`, `roomId`, `sourceType`, `message`, `eventType`, `timestamp`
- รองรับ text, image, sticker, audio, video, file และ message type อื่น ๆ
- แสดง log ผ่านหน้าเว็บที่ `GET /logs`
- ดู log แบบ JSON ที่ `GET /api/logs`
- ล้าง log ด้วย `DELETE /api/logs`
- ตรวจสอบ LINE signature ด้วย `LINE_CHANNEL_SECRET`
- จำกัด log สูงสุด 1000 รายการล่าสุด

## Local Development

ติดตั้ง dependency

```bash
npm install
```

สร้างไฟล์ `.env`

```bash
cp .env.example .env
```

รัน server

```bash
npm start
```

เปิดเว็บ

```text
http://localhost:3000
```

Webhook endpoint สำหรับทดสอบ local

```text
http://localhost:3000/webhook
```

ถ้าไม่ได้ตั้งค่า `LINE_CHANNEL_SECRET` ระบบจะข้ามการตรวจ signature เพื่อให้ทดสอบง่ายขึ้น เมื่อใช้งานจริงควรตั้งค่านี้ให้ตรงกับ Channel secret ใน LINE Developers Console

## Routes

| Method | Path | Description |
| --- | --- | --- |
| GET | `/` | หน้าแรก แสดง Webhook URL และลิงก์ |
| POST | `/webhook` | รับ LINE webhook events |
| GET | `/logs` | แสดง log เป็นตาราง HTML |
| GET | `/api/logs` | ส่ง log เป็น JSON |
| DELETE | `/api/logs` | ล้าง log ทั้งหมด |

## Deploy to Render

1. Push โปรเจกต์นี้ขึ้น GitHub, GitLab หรือ Bitbucket
2. เข้า Render Dashboard แล้วเลือก **New +** > **Web Service**
3. เลือก repository ของโปรเจกต์นี้
4. ตั้งค่า service:

```text
Runtime: Node
Build Command: npm install
Start Command: npm start
```

5. ตั้ง Environment Variable:

```text
LINE_CHANNEL_SECRET=your_line_channel_secret
```

6. Deploy service แล้วจด URL ของ Render เช่น:

```text
https://your-render-app.onrender.com
```

Webhook URL ที่ต้องนำไปใช้กับ LINE คือ:

```text
https://your-render-app.onrender.com/webhook
```

หน้าเว็บสำหรับดู log:

```text
https://your-render-app.onrender.com/logs
```

JSON API:

```text
https://your-render-app.onrender.com/api/logs
```

## ตั้งค่า LINE Developers Console

1. เข้า [LINE Developers Console](https://developers.line.biz/console/)
2. เลือก Provider และ Messaging API Channel ของ LINE OA
3. ไปที่แท็บ **Messaging API**
4. เปิด **Use webhook**
5. ใส่ Webhook URL:

```text
https://your-render-app.onrender.com/webhook
```

6. กด **Verify**
7. เพิ่ม LINE OA เข้ากลุ่มหรือส่งข้อความหา OA เพื่อทดสอบ
8. เปิดหน้า `/logs` บน Render เพื่อดูข้อมูลที่บันทึก

## Admin Keyword

Send this command to the LINE OA in a private chat:

```text
I AM ADMIN : group name1
I AM ADMIN : group name2
```

The bot stores the sender's `userId` as an admin for that group name in `admins.json`.
The trailing number is the priority, so `group name1` is priority 1 and `group name2` is priority 2.
The command is accepted only from a private chat source.

You can change the keyword with this environment variable:

```text
ADMIN_KEYWORD=I AM ADMIN
```

Admin registrations can be viewed at:

```text
https://your-render-app.onrender.com/admins
```

## Wounds / Bonds

In a group chat, the app creates an active wound when a user replies to another user's tracked message with an accept keyword.
LINE sends the quoted message ID as `message.quotedMessageId`, so the original message must already have been received by the webhook.

Tracked opening keywords:

```text
ซล, ล, ไล่, +5ซล, +5ล
ซย, ซถ, ย, ถ.ยัง, ถอย, +5ซย, +5ซถ, +5ย, +5ถ
```

Accepted reply keywords:

```text
ต, ติด, ครับ, เค, จ้า
```

Examples:

```text
ซล1000
ซย500
230-250a200
```

A registered admin can close all active wounds in the current LINE group with:

```text
แจ้งผล 50
แจ้งผล40
```

Wounds can be viewed at:

```text
https://your-render-app.onrender.com/wounds
https://your-render-app.onrender.com/api/wounds
```

## Notes

- `logs.json` จะถูกสร้างอัตโนมัติเมื่อ server เริ่มทำงาน
- ถ้า `logs.json` เสียหรืออ่านไม่ได้ ระบบจะถือว่า log ว่างและยังทำงานต่อ
- บน Render แบบ free filesystem ไม่เหมาะกับการเก็บข้อมูลถาวรระยะยาว เพราะไฟล์อาจหายเมื่อ service restart หรือ redeploy
- Webhook จะตอบกลับเร็วด้วย HTTP 200 เมื่อรับ payload ได้ แม้ไม่มี event ใน request
- ถ้าตั้ง `LINE_CHANNEL_SECRET` แล้ว signature ไม่ถูกต้อง ระบบจะตอบ HTTP 401
