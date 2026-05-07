# LINE Webhook Logger

โปรเจกต์ Node.js Express สำหรับรับ Webhook จาก LINE Messaging API โดยรองรับการเก็บข้อมูลด้วย MongoDB Atlas ผ่าน `MONGODB_URI` และ fallback เป็นไฟล์ JSON เมื่อต้องการรันแบบง่าย

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
| GET | `/api/storage` | Show active storage driver |
| GET | `/rounds` | Show queue rounds |
| GET | `/api/rounds` | Return queue rounds as JSON |
| DELETE | `/api/rounds` | Clear queue rounds and related wound data |
| GET | `/queue-lists` | Show saved queue lists |
| GET | `/api/queue-lists` | Return saved queue lists as JSON |
| DELETE | `/api/queue-lists` | Clear saved queue lists |
| GET | `/wounds` | Show active and closed wounds |
| GET | `/api/wounds` | Return wounds as JSON |
| DELETE | `/api/wounds` | Clear wounds and tracked group messages |
| GET | `/credits` | Show user credit balances |
| GET | `/api/credits` | Return credit balances as JSON |
| DELETE | `/api/credits` | Clear credit balances |

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
LINE_CHANNEL_ACCESS_TOKEN=your_line_channel_access_token
LINE_OFFICIAL_ACCOUNT_URL=https://line.me/R/ti/p/your_line_oa_id
LINE_OFFICIAL_ACCOUNT_NAME=Lamp cover.OR
LINE_OFFICIAL_ACCOUNT_IMAGE_URL=
EASYSLIP_API_KEY=your_easyslip_api_key
EASYSLIP_MATCH_ACCOUNT=false
EASYSLIP_CHECK_DUPLICATE=true
MONGODB_URI=mongodb+srv://user:password@cluster.mongodb.net/lamp_cover?retryWrites=true&w=majority
MONGODB_DB_NAME=lamp_cover
PAYMENT_ACCOUNT_NUMBER=9160581964
PAYMENT_ACCOUNT_BANK=กรุงเทพ
PAYMENT_ACCOUNT_NAME=ภาณุเดช กุมแก้ว
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

After registering in private chat, bind the actual LINE group by sending this command in that group:

```text
ผูกกลุ่ม : group name
```

Group admin commands only work after the registered `userId` is bound to the current LINE `groupId`.

Anyone in the bound group can ask for the current admins by sending one of:

```text
แอดมิน
แอด
admin
Admin
```

The bot replies in the group with LINE mentions for the bound admins, ordered by admin priority.

Bound admins can open black-account or white-account contact collection in the group with:

```text
เปิดบช.ดำ
เปิดดำ
เปิดบัญชีดำ

เปิดขาว
เปิดบช.ขาว
เปิดบัญชีขาว
```

The bot can announce and log these flows, but LINE Messaging API does not allow a bot to kick members out of a group or change the group permission to "admin invite only". Those actions must be handled by a LINE group admin in the LINE app.

You can change the keyword with this environment variable:

```text
ADMIN_KEYWORD=I AM ADMIN
```

Admin registrations can be viewed at:

```text
https://your-render-app.onrender.com/admins
```

To remove yourself as an admin, send this command to the LINE OA in a private chat:

```text
IAMNOTADMIN : group name
```

## Wounds / Bonds

In a group chat, the app creates an active wound only while a queue round is open.
LINE sends the quoted message ID as `message.quotedMessageId`, so the original message must already have been received by the webhook.

The bot can reply to group commands when `LINE_CHANNEL_ACCESS_TOKEN` is set.

## EasySlip Slip Credit

To let users top up credit by sending a bank slip image in a private chat with the LINE OA, set these Environment Variables on Render:

```text
LINE_CHANNEL_ACCESS_TOKEN=your_line_channel_access_token
EASYSLIP_API_KEY=your_easyslip_api_key
EASYSLIP_CHECK_DUPLICATE=true
```

Flow:

```text
User sends slip image in private chat
Bot downloads the image from LINE
Bot sends Base64 to EasySlip POST /verify/bank
Bot checks duplicate status and slip transRef
Bot adds credit equal to the verified slip amount
```

Optional account matching:

```text
EASYSLIP_MATCH_ACCOUNT=true
```

Enable this only after registering your receiver bank account inside EasySlip.

## MongoDB Storage

When `MONGODB_URI` is set, the app loads and writes these collections in MongoDB:

```text
lamp_logs
lamp_admins
lamp_messages
lamp_wounds
lamp_rounds
lamp_queue_lists
lamp_credits
lamp_slips
```

The app still writes JSON files as a local backup. If a collection is empty on first startup, the app seeds MongoDB from the existing JSON file so current data can be migrated automatically.

Check the active storage driver:

```text
https://your-render-app.onrender.com/api/storage
```

## Payment Channel Reply

When someone sends this keyword in a group:

```text
หลังบ้าน
```

The bot replies with payment account details and the LINE OA profile card.

In a group or private chat with the LINE OA, users can also request the payment account by sending one of:

```text
บช
เลข
เลขบัญชี
บัญชี
ลบช
เลขบช
```

For these payment account keywords in a group, the bot replies with the payment account text only. The `หลังบ้าน` keyword still sends both the payment account text and the LINE OA profile card.

You can change the payment account with:

```text
PAYMENT_ACCOUNT_NUMBER=9160581964
PAYMENT_ACCOUNT_BANK=กรุงเทพ
PAYMENT_ACCOUNT_NAME=ภาณุเดช กุมแก้ว
```

Save a queue list by sending a multi-line admin message in the group:

```text
จุดรายการ
🚀จรวดอีสาน๙๙🚀
📍 คิวจุด บ้านคุ้ม

น้องบอม(20-60) 380✅✅
ฟ้าสีทอง(30-80) 313❌❌
กุ้งเจริญทรัพย์(40-70) 355⛔⛔
เบริดอาค้า
ส.กวินท์
หนุ่ม ก.ท.ม.

หมายเหตุคิวจุดอาจมีการเปลี่ยนแปลง
```

Saved queue lists can be viewed at:

After the queue list is saved, the bot replies in the group:

```text
คิวจุด✅

น้องบอม(20-60) 380✅✅
ฟ้าสีทอง(30-80) 313❌❌
กุ้งเจริญทรัพย์(40-70) 355⛔⛔
เบริดอาค้า
ส.กวินท์
หนุ่ม ก.ท.ม.
```

```text
https://your-render-app.onrender.com/queue-lists
https://your-render-app.onrender.com/api/queue-lists
```

Open a queue round:

```text
เปิด กอดก้อนเมฆ
เปิด กอดก้อนเมฆ 300-320
เปิด น้องเหมียว ช่างไม่ตี
รอราคาช่าง, เบริดอาค้า
```

`รอราคาช่าง, ชื่อคิว` opens the queue without a builder price and replies like:

```text
เบริดอาค้า

ช่าง ⛔️

🚀🚀🚀🚀🚀
```

If the group announces no builder during the current round, a registered admin can send:

```text
ช่างไม่ตี
ช่างบ่ตี @All
```

The bot replies with the no-builder play rules, marks the latest unfinished round as no builder, and clears the builder price until an admin sends `ราคาช่าง ...`.

Close the current queue round:

```text
ปิด
```

If the builder price is known after close, send:

```text
ราคาช่าง 300-320
```

The bot will reply in the same queue-card format:

```text
ศราช

ช่าง 350-380 ⛔️

🚀🚀🚀🚀🚀
```

If a group member sends:

```text
หลังบ้าน
```

the bot replies with the LINE OA link from `LINE_OFFICIAL_ACCOUNT_URL`.

To manually close the last queue of the day and show the played queue summary plus the thank-you message, an admin can send either:

```text
ปิดคิวสุดท้าย
สิ้นสุด
```

Tracked opening keywords:

```text
ชล, ล, ไล่
ชย, ชถ, ย, ถ, ถ.ยั่ง, ถอย
+1 ถึง +30 และ -1 ถึง -30 ใช้นำหน้า ชล, ล, ชย, ชถ, ย, ถ ได้
```

Accepted reply keywords:

```text
ต, ติด, ครับ, เค, จ้า
ชตย, ช่างตีไม่ติด, ช่างตียก
```

Examples:

```text
ชล170
ชย 300
ถ 650
+10ชย 300
-30ชล 400
300-340ล500
300-340ถ500
400ถ100
345-385ล500 ชตย
360-390ถ ชตย
8-25 มา2000 ช่างตียก
```

Custom price keywords use Thai sides only: `ชล`, `ชย`, `ชถ`, `ล`, `ถ`, `ย`, `ไล่`, `ถอย`, `ยั่ง`, `มา`, `ช่างไล่`, `ช่างยั่ง`, `ช่างถอย`.
Use `-` for ranges only, for example `300-340ล500`; `/` is not accepted.
`ชตย`, `ช่างตีไม่ติด`, and `ช่างตียก` are no-builder fallback markers. They can be placed after a custom price or used as the accepter reply keyword.
If a custom price has a stake and a no-builder fallback marker, the user must have reserve credit for 2x the stake, for example `330-350ล1000ชตย` requires 2000 available credit.
If the admin later sets a builder price for that round, marked wounds are automatically cancelled and no credit is deducted.

Pairing flow:

```text
A: ชล170
B replies to A: ต
A replies to B: ต
```

The first reply only marks a pending pair. The wound is created only when the original opener confirms by replying to the accepter's message. Before creating the wound, the bot checks both users' available credit. Active wounds reserve credit, so users can pair multiple times only while their available credit is still enough. If either side has insufficient credit, that pending pair is rejected and the next accepter can still pair with the same opening message.

When a wound is created, the bot sends a private Flex card to both users if `LINE_CHANNEL_ACCESS_TOKEN` is set.
The card includes `แตะเพื่อยกเลิก`. If one user taps it, the bot sends an approval card to the paired opponent with `ยกเลิก` and `ไม่ยกเลิก` buttons. If the opponent approves, the wound is marked `cancelled` and will not be settled by the queue result.

Settlement rules:
- `ชล`, `ล`, `ไล่`, and `ช่างไล่` are `ทายชนะ`.
- `ชย`, `ชถ`, `ย`, `ถ`, `ถอย`, `ยั่ง`, `ช่างยั่ง`, and `ช่างถอย` are `ทายแพ้`.
- `มา` means the opener predicts the result will be inside the custom range, for example `8-25 มา2000`.
- `ทายแพ้` means the user predicts the result will be lower than the builder price. It is not the losing status. If that prediction is correct, that user receives the payout.
- The play rate is 1:1. The payout is 0.95 of the stake, and 5% is kept by the admin/system.
- If the result is inside the builder price range, the wound is a draw and both sides keep their credit.
- After the admin confirms the result, the bot pushes private result cards to both users. For example, the loser sees `-100.00`, and the winner sees `+100.00 -5% = +95.00`.

A registered admin confirms the result with a two-step command:

```text
แจ้งผล 50
แจ้งผล40
แจ้งผล จาวทุกแผล
```

The first result command asks for confirmation. Send the same `แจ้งผล ...` again within 5 minutes to close active wounds and mark the queue round result.
If an admin tries to open the next queue round before the latest round has a confirmed result, the bot will warn the group and keep the new round from opening.
When every item in the saved queue list has a confirmed result, the bot sends a final closing report message:

```text
❌จบการรายงาน
สำหรับวันนี้ทางทีมงานขอขอบคุณ
และสวัสดีครับบบ 🙏
**ส่งเลขบัญชีไว้หลังบ้านได้เลยนะครับ
✅✅✅
```

Wounds can be viewed at:

```text
https://your-render-app.onrender.com/wounds
https://your-render-app.onrender.com/api/wounds
https://your-render-app.onrender.com/rounds
https://your-render-app.onrender.com/api/rounds
```

## Credits

Credit data is stored in MongoDB when `MONGODB_URI` is set, otherwise it falls back to `credits.json`.

Users can add credit only by sending a bank slip image in a private chat with the LINE OA. The bot verifies the slip with EasySlip before adding credit. Text commands like `C+100` are ignored.

User menu keywords:

```text
เช็คยอดเงิน
แผลที่กำลังติด
ถอนยอดเงิน
```

The bot replies with LINE Flex Message cards when `LINE_CHANNEL_ACCESS_TOKEN` is set. If the token is not set, the webhook still records credit data and logs, but it cannot send cards back to LINE.

Credit balances can be viewed at:

```text
https://your-render-app.onrender.com/credits
https://your-render-app.onrender.com/api/credits
```

## Unsend Detection

In group chats, the app detects LINE `unsend` events and pushes a warning back to that group when `LINE_CHANNEL_ACCESS_TOKEN` is set.
The warning uses the original message stored from webhook message events.

Example warning:

```text
❌ พบการยกเลิกข้อความ ❌

• ผู้ยกเลิก: display name
• ยกเลิกเมื่อ: 19.24 seconds ที่แล้ว
• ข้อความ: ล1500
• เวลา: 15:17:52 ที่ยกเลิก

❌❌❌❌❌❌❌❌
```

## Notes

- ไฟล์ JSON จะถูกสร้างอัตโนมัติเมื่อ server เริ่มทำงาน
- ถ้าไฟล์ JSON เสียหรืออ่านไม่ได้ ระบบจะถือว่าข้อมูลส่วนนั้นว่างและยังทำงานต่อ
- ถ้าตั้ง `MONGODB_URI` แล้ว ระบบจะใช้ MongoDB เป็น storage หลัก และเขียน JSON เป็น backup
- บน Render แบบ free filesystem ไม่เหมาะกับการเก็บข้อมูลถาวรระยะยาว ถ้าใช้งานจริงให้ตั้ง `MONGODB_URI`
- Webhook จะตอบกลับเร็วด้วย HTTP 200 เมื่อรับ payload ได้ แม้ไม่มี event ใน request
- ถ้าตั้ง `LINE_CHANNEL_SECRET` แล้ว signature ไม่ถูกต้อง ระบบจะตอบ HTTP 401
