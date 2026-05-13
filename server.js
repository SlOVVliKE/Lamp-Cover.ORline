require('dotenv').config();

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const { MongoClient } = require('mongodb');

const app = express();
app.set('trust proxy', true);
const PORT = process.env.PORT || 3000;
const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const LINE_MESSAGING_API_BASE_URL = process.env.LINE_MESSAGING_API_BASE_URL || 'https://api.line.me';
const LINE_MESSAGING_API_URL = LINE_MESSAGING_API_BASE_URL.replace(/\/+$/, '');
const LINE_CONTENT_API_BASE_URL = process.env.LINE_CONTENT_API_BASE_URL || 'https://api-data.line.me';
const LINE_OFFICIAL_ACCOUNT_URL = process.env.LINE_OFFICIAL_ACCOUNT_URL || process.env.LINE_OA_URL || '';
const LINE_OFFICIAL_ACCOUNT_NAME = process.env.LINE_OFFICIAL_ACCOUNT_NAME || 'Lamp cover.OR';
const LINE_OFFICIAL_ACCOUNT_IMAGE_URL = process.env.LINE_OFFICIAL_ACCOUNT_IMAGE_URL || '';
const DEFAULT_BET_GROUP_INVITE_TEXT = [
  'เปิดฤดูกาลบั้งไฟแสน',
  'เข้ากลุ่มชมฟรี ส.กวิน',
  'มีกิจกรรมสำหรับพี่ๆที่มียอดการเล่น',
  '',
  'กลุ่ม1 คำผักหนาม',
  'https://line.me/ti/g/m4YA7PzmsE',
  '',
  'กลุ่ม2 หัวตะพาน',
  'https://line.me/ti/g/V79ffVz_7P'
].join('\n');
const BET_GROUP_INVITE_TEXT =
  parseMultilineEnv(process.env.BET_GROUP_INVITE_TEXT) || DEFAULT_BET_GROUP_INVITE_TEXT;
const BROADCAST_TIMEZONE = process.env.BROADCAST_TIMEZONE || 'Asia/Bangkok';
const BROADCAST_SCHEDULER_INTERVAL_MS = Number(process.env.BROADCAST_SCHEDULER_INTERVAL_MS) > 0
  ? Number(process.env.BROADCAST_SCHEDULER_INTERVAL_MS)
  : 30000;
const EASYSLIP_API_KEY = process.env.EASYSLIP_API_KEY || '';
const EASYSLIP_API_BASE_URL = process.env.EASYSLIP_API_BASE_URL || 'https://api.easyslip.com/v2';
const EASYSLIP_MATCH_ACCOUNT = process.env.EASYSLIP_MATCH_ACCOUNT === 'true';
const EASYSLIP_CHECK_DUPLICATE = process.env.EASYSLIP_CHECK_DUPLICATE !== 'false';
const MONGODB_URI = process.env.MONGODB_URI || '';
const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME || 'lamp_cover';
const PAYMENT_ACCOUNT_NUMBER = process.env.PAYMENT_ACCOUNT_NUMBER || '9160581964';
const PAYMENT_ACCOUNT_BANK = process.env.PAYMENT_ACCOUNT_BANK || 'กรุงเทพ';
const PAYMENT_ACCOUNT_NAME = process.env.PAYMENT_ACCOUNT_NAME || 'ภาณุเดช กุมแก้ว';
const ADMIN_KEYWORD = process.env.ADMIN_KEYWORD || 'I AM ADMIN';
const REMOVE_ADMIN_KEYWORD = process.env.REMOVE_ADMIN_KEYWORD || 'IAMNOTADMIN';
const IS_PRODUCTION_RUNTIME =
  process.env.NODE_ENV === 'production' ||
  process.env.RENDER === 'true' ||
  Boolean(process.env.RENDER_SERVICE_ID);
const ALLOW_DEFAULT_CREDITS_ADMIN =
  process.env.ALLOW_DEFAULT_CREDITS_ADMIN === 'true' ||
  process.env.NODE_ENV === 'test' ||
  !IS_PRODUCTION_RUNTIME;
const CREDITS_ADMIN_USERNAME = process.env.CREDITS_ADMIN_USERNAME || (ALLOW_DEFAULT_CREDITS_ADMIN ? 'Admin' : '');
const CREDITS_ADMIN_PASSWORD = process.env.CREDITS_ADMIN_PASSWORD || (ALLOW_DEFAULT_CREDITS_ADMIN ? 'admin123' : '');
const CREDITS_ADMIN_COOKIE_NAME = 'lamp_credits_admin';
const CREDITS_ADMIN_SESSION_SECRET =
  process.env.CREDITS_ADMIN_SESSION_SECRET ||
  LINE_CHANNEL_SECRET ||
  (ALLOW_DEFAULT_CREDITS_ADMIN ? CREDITS_ADMIN_PASSWORD : '');
const LOG_FILE = path.join(__dirname, 'logs.json');
const ADMIN_FILE = path.join(__dirname, 'admins.json');
const MESSAGE_FILE = path.join(__dirname, 'messages.json');
const WOUND_FILE = path.join(__dirname, 'wounds.json');
const ROUND_FILE = path.join(__dirname, 'rounds.json');
const QUEUE_LIST_FILE = path.join(__dirname, 'queueLists.json');
const BROADCAST_FILE = path.join(__dirname, 'broadcasts.json');
const CREDIT_FILE = path.join(__dirname, 'credits.json');
const WITHDRAWAL_FILE = path.join(__dirname, 'withdrawals.json');
const BLACKLIST_FILE = path.join(__dirname, 'blacklist.json');
const BLACKLIST_MODE_FILE = path.join(__dirname, 'blacklistModes.json');
const CLOSE_IMAGE_FILE = path.join(__dirname, 'ปิด.jpg');
const CLOSE_IMAGE_ROUTE = '/assets/close.jpg';
const MAX_LOGS = 1000;
const MAX_ADMINS = 1000;
const MAX_MESSAGES = 3000;
const MAX_WOUNDS = 1000;
const MAX_ROUNDS = 1000;
const MAX_QUEUE_LISTS = 200;
const MAX_BROADCAST_SCHEDULES = 200;
const MAX_CREDITS = 5000;
const MAX_WITHDRAWALS = 2000;
const MAX_BLACKLIST = 5000;
const MAX_BLACKLIST_MODES = 500;
const MAX_CREDIT_TRANSACTIONS = 200;
const BLACKLIST_MODE_TTL_MS = 10 * 60 * 1000;
const RESULT_CONFIRMATION_WINDOW_MS = 5 * 60 * 1000;
const WIN_PAYOUT_RATE = 0.95;
const WITHDRAWAL_OPEN_HOUR = 18;
const WITHDRAWAL_CLOSE_HOUR = 8;
const WITHDRAWAL_TIME_CHECK_DISABLED = process.env.WITHDRAWAL_TIME_CHECK_DISABLED === 'true';
const WITHDRAWAL_TOKEN_MAX_AGE_MS = 2 * 60 * 60 * 1000;
const NO_QUEUE_REPLY = 'ตอนนี้ยังไม่มีคิวจุดครับ ✅\nรอแอดมินวางคิวก่อนนะครับ 🚀';
const REPEATED_TRADE_WARNING_THRESHOLD = 3;
const REPEATED_TRADE_WARNING_REPLY = [
  'ตอบติดกัน ขยับติดกัน 📍',
  '',
  '💰รอการตลาด💰'
].join('\n');
const MONGO_COLLECTION_BY_FILE = new Map([
  [LOG_FILE, 'lamp_logs'],
  [ADMIN_FILE, 'lamp_admins'],
  [MESSAGE_FILE, 'lamp_messages'],
  [WOUND_FILE, 'lamp_wounds'],
  [ROUND_FILE, 'lamp_rounds'],
  [QUEUE_LIST_FILE, 'lamp_queue_lists'],
  [BROADCAST_FILE, 'lamp_broadcast_settings'],
  [CREDIT_FILE, 'lamp_credits'],
  [WITHDRAWAL_FILE, 'lamp_withdrawals'],
  [BLACKLIST_FILE, 'lamp_blacklist'],
  [BLACKLIST_MODE_FILE, 'lamp_blacklist_modes']
]);
const MONGO_SLIP_COLLECTION = 'lamp_slips';
let mongoClient = null;
let mongoDb = null;
let mongoConnected = false;
const mongoCache = new Map();
const mongoWriteQueues = new Map();
const jsonReservedSlipTransRefs = new Set();
let mongoSyncCounter = 0;
let linePushMonthlyLimitReached = false;

function parseMultilineEnv(value) {
  return String(value || '').replace(/\\n/g, '\n').trim();
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function stripMongoId(value) {
  if (Array.isArray(value)) {
    return value.map(stripMongoId);
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const { _id, __sortIndex, __syncVersion, ...rest } = value;
  return Object.fromEntries(Object.entries(rest).map(([key, item]) => [key, stripMongoId(item)]));
}

function getStorageStatus() {
  return {
    driver: mongoConnected ? 'mongodb' : 'json',
    mongoConfigured: Boolean(MONGODB_URI),
    mongoConnected,
    databaseName: mongoConnected ? mongoDb.databaseName : '',
    collections: [...MONGO_COLLECTION_BY_FILE.values(), MONGO_SLIP_COLLECTION]
  };
}

function getMongoCollectionForFile(filePath) {
  if (!mongoConnected || !mongoDb) return null;
  const collectionName = MONGO_COLLECTION_BY_FILE.get(filePath);
  return collectionName ? mongoDb.collection(collectionName) : null;
}

function queueMongoCollectionReplace(filePath, rows) {
  const collection = getMongoCollectionForFile(filePath);
  if (!collection) return;

  const syncVersion = Date.now() * 1000 + (mongoSyncCounter = (mongoSyncCounter + 1) % 1000);
  const docs = cloneJson(rows).map((row, index) => ({ ...row, __sortIndex: index, __syncVersion: syncVersion }));
  const previousWrite = mongoWriteQueues.get(filePath) || Promise.resolve();
  const nextWrite = previousWrite
    .catch(() => {})
    .then(async () => {
      if (docs.length > 0) {
        await collection.bulkWrite(
          docs.map((doc) => ({
            replaceOne: {
              filter: { __sortIndex: doc.__sortIndex, __syncVersion: syncVersion },
              replacement: doc,
              upsert: true
            }
          })),
          { ordered: true }
        );
      }
      await collection.deleteMany({ __syncVersion: { $ne: syncVersion } });
    })
    .catch((error) => {
      console.error(`Unable to write MongoDB collection ${collection.collectionName}:`, error.message);
    });

  mongoWriteQueues.set(filePath, nextWrite);
}

async function seedMongoCollectionFromJson(filePath, collection) {
  const localRows = (() => {
    try {
      ensureJsonFile(filePath);
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      return [];
    }
  })();

  if (localRows.length === 0) return [];

  const docs = cloneJson(localRows).map((row, index) => ({ ...row, __sortIndex: index }));
  await collection.insertMany(docs, { ordered: true });
  return localRows;
}

async function initMongoStorage() {
  if (!MONGODB_URI) {
    return;
  }

  mongoClient = new MongoClient(MONGODB_URI);
  await mongoClient.connect();
  mongoDb = mongoClient.db(MONGODB_DB_NAME);

  await mongoDb.collection(MONGO_SLIP_COLLECTION).createIndex({ transRef: 1 }, { unique: true, sparse: true });

  for (const [filePath, collectionName] of MONGO_COLLECTION_BY_FILE.entries()) {
    const collection = mongoDb.collection(collectionName);
    await collection.createIndex({ __sortIndex: 1 });
    await collection.createIndex({ __syncVersion: 1 });
    let rows = await collection.find({}).sort({ __sortIndex: 1 }).toArray();

    if (rows.length === 0) {
      rows = await seedMongoCollectionFromJson(filePath, collection);
    } else {
      const syncVersions = rows
        .map((row) => Number(row.__syncVersion) || 0)
        .filter((syncVersion) => syncVersion > 0);
      if (syncVersions.length > 0) {
        const latestSyncVersion = Math.max(...syncVersions);
        rows = rows.filter((row) => Number(row.__syncVersion) === latestSyncVersion);
        await collection.deleteMany({ __syncVersion: { $ne: latestSyncVersion } });
      }
    }

    mongoCache.set(filePath, stripMongoId(rows));
  }

  mongoConnected = true;
}

function ensureJsonFile(filePath) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, '[]', 'utf8');
  }
}

function readJsonArray(filePath, label) {
  if (mongoConnected && mongoCache.has(filePath)) {
    return cloneJson(mongoCache.get(filePath));
  }

  try {
    ensureJsonFile(filePath);
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error(`Unable to read ${label}:`, error.message);
    return [];
  }
}

function writeJsonArray(filePath, rows, maxItems) {
  const trimmedRows = Array.isArray(rows) ? rows.slice(0, maxItems) : [];
  fs.writeFileSync(filePath, JSON.stringify(trimmedRows, null, 2), 'utf8');

  if (mongoConnected && MONGO_COLLECTION_BY_FILE.has(filePath)) {
    mongoCache.set(filePath, cloneJson(trimmedRows));
    queueMongoCollectionReplace(filePath, trimmedRows);
  }
}

function readLogs() {
  return readJsonArray(LOG_FILE, 'logs.json');
}

function writeLogs(logs) {
  writeJsonArray(LOG_FILE, logs, MAX_LOGS);
}

function readAdmins() {
  return sortAdmins(readJsonArray(ADMIN_FILE, 'admins.json'));
}

function writeAdmins(admins) {
  writeJsonArray(ADMIN_FILE, sortAdmins(admins), MAX_ADMINS);
}

function readMessages() {
  return readJsonArray(MESSAGE_FILE, 'messages.json');
}

function writeMessages(messages) {
  writeJsonArray(MESSAGE_FILE, messages, MAX_MESSAGES);
}

function readWounds() {
  return sortWounds(readJsonArray(WOUND_FILE, 'wounds.json'));
}

function writeWounds(wounds) {
  writeJsonArray(WOUND_FILE, sortWounds(wounds), MAX_WOUNDS);
}

function readRounds() {
  return sortRounds(readJsonArray(ROUND_FILE, 'rounds.json'));
}

function writeRounds(rounds) {
  writeJsonArray(ROUND_FILE, sortRounds(rounds), MAX_ROUNDS);
}

function readQueueLists() {
  return sortQueueLists(readJsonArray(QUEUE_LIST_FILE, 'queueLists.json'));
}

function writeQueueLists(queueLists) {
  writeJsonArray(QUEUE_LIST_FILE, sortQueueLists(queueLists), MAX_QUEUE_LISTS);
}

function normalizeBroadcastTime(value) {
  const text = String(value || '').trim();
  const match = text.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  return match ? `${match[1]}:${match[2]}` : '';
}

function normalizeBroadcastSchedule(schedule) {
  const nowTimestamp = Date.now();
  return {
    id: String(schedule?.id || `broadcast-${nowTimestamp}-${crypto.randomBytes(4).toString('hex')}`),
    title: String(schedule?.title || '').trim(),
    targetId: String(schedule?.targetId || '').trim(),
    messageText: String(schedule?.messageText || '').replace(/\r\n/g, '\n').trim(),
    scheduledTime: normalizeBroadcastTime(schedule?.scheduledTime),
    enabled: schedule?.enabled !== false,
    lastSentDate: String(schedule?.lastSentDate || '').trim(),
    lastSentTimestamp: Number(schedule?.lastSentTimestamp) || 0,
    lastSentTime: String(schedule?.lastSentTime || '').trim(),
    createdTimestamp: Number(schedule?.createdTimestamp) || nowTimestamp,
    updatedTimestamp: Number(schedule?.updatedTimestamp) || nowTimestamp
  };
}

function normalizeBroadcastSettings(settings) {
  const rawSchedules = Array.isArray(settings?.schedules) ? settings.schedules : [];
  const schedules = rawSchedules
    .map(normalizeBroadcastSchedule)
    .filter((schedule) => schedule.scheduledTime)
    .slice(0, MAX_BROADCAST_SCHEDULES);

  return {
    inviteText: String(settings?.inviteText || '').replace(/\r\n/g, '\n').trim(),
    schedules,
    updatedTimestamp: Number(settings?.updatedTimestamp) || 0,
    updatedTime: String(settings?.updatedTime || '').trim()
  };
}

function readBroadcastSettings() {
  const rows = readJsonArray(BROADCAST_FILE, 'broadcasts.json');
  return normalizeBroadcastSettings(rows[0] || {});
}

function writeBroadcastSettings(settings) {
  const normalizedSettings = normalizeBroadcastSettings(settings);
  writeJsonArray(BROADCAST_FILE, [normalizedSettings], 1);
}

function getBetGroupInviteText() {
  return readBroadcastSettings().inviteText || BET_GROUP_INVITE_TEXT;
}

function clearQueueListForGroup(groupId) {
  const key = String(groupId || '').trim();
  if (!key) return;
  writeQueueLists(readQueueLists().filter((queueList) => queueList.groupId !== key));
}

function readCredits() {
  return sortCredits(readJsonArray(CREDIT_FILE, 'credits.json'));
}

function writeCredits(credits) {
  writeJsonArray(CREDIT_FILE, sortCredits(credits), MAX_CREDITS);
}

function isPendingWithdrawal(withdrawal) {
  return String(withdrawal?.status || 'pending') === 'pending';
}

function readAllWithdrawals() {
  return sortWithdrawals(readJsonArray(WITHDRAWAL_FILE, 'withdrawals.json'));
}

function readWithdrawals() {
  return sortWithdrawals(readAllWithdrawals().filter(isPendingWithdrawal));
}

function writeWithdrawals(withdrawals) {
  writeJsonArray(WITHDRAWAL_FILE, sortWithdrawals(withdrawals).filter(isPendingWithdrawal), MAX_WITHDRAWALS);
}

function readBlacklist() {
  return sortBlacklist(readJsonArray(BLACKLIST_FILE, 'blacklist.json'));
}

function writeBlacklist(entries) {
  writeJsonArray(BLACKLIST_FILE, sortBlacklist(entries), MAX_BLACKLIST);
}

function readBlacklistModes() {
  return sortBlacklistModes(readJsonArray(BLACKLIST_MODE_FILE, 'blacklistModes.json'));
}

function writeBlacklistModes(modes) {
  writeJsonArray(BLACKLIST_MODE_FILE, sortBlacklistModes(modes), MAX_BLACKLIST_MODES);
}

function pruneProcessedWithdrawals() {
  const withdrawals = readAllWithdrawals();
  const pendingWithdrawals = withdrawals.filter(isPendingWithdrawal);
  if (pendingWithdrawals.length !== withdrawals.length) {
    writeWithdrawals(pendingWithdrawals);
  }
  return sortWithdrawals(pendingWithdrawals);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function parseCookies(cookieHeader) {
  return String(cookieHeader || '')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((cookies, part) => {
      const separatorIndex = part.indexOf('=');
      if (separatorIndex < 0) return cookies;

      const key = part.slice(0, separatorIndex).trim();
      const value = part.slice(separatorIndex + 1).trim();
      cookies[key] = decodeURIComponent(value);
      return cookies;
    }, {});
}

function getCreditsAdminAuthToken() {
  if (!isCreditsAdminConfigured()) return '';

  return crypto
    .createHmac('sha256', CREDITS_ADMIN_SESSION_SECRET)
    .update(`${CREDITS_ADMIN_USERNAME}:${CREDITS_ADMIN_PASSWORD}`)
    .digest('hex');
}

function getCreditsAdminUserToken(userId) {
  if (!CREDITS_ADMIN_SESSION_SECRET) return '';

  return crypto
    .createHmac('sha256', CREDITS_ADMIN_SESSION_SECRET)
    .update(`credit-user:${userId}`)
    .digest('hex')
    .slice(0, 40);
}

function getCreditUserIdFromAdminToken(userToken) {
  const token = String(userToken || '').trim();
  if (!token) return '';

  const user = getManualCreditUsers().find((row) => safeStringEqual(getCreditsAdminUserToken(row.userId), token));
  return user?.userId || '';
}

function signWithdrawalTokenPayload(payload) {
  if (!CREDITS_ADMIN_SESSION_SECRET) return '';

  return crypto
    .createHmac('sha256', CREDITS_ADMIN_SESSION_SECRET)
    .update(payload)
    .digest('hex')
    .slice(0, 48);
}

function createWithdrawalRequestToken(userId, timestamp = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ userId, timestamp }), 'utf8').toString('base64url');
  return `${payload}.${signWithdrawalTokenPayload(payload)}`;
}

function parseWithdrawalRequestToken(token) {
  const [payload, signature] = String(token || '').trim().split('.');
  if (!payload || !signature || !safeStringEqual(signWithdrawalTokenPayload(payload), signature)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const timestamp = Number(parsed.timestamp);
    const userId = String(parsed.userId || '').trim();
    if (!userId || !Number.isFinite(timestamp)) return null;
    if (Date.now() - timestamp > WITHDRAWAL_TOKEN_MAX_AGE_MS) return null;

    return { userId, timestamp };
  } catch (error) {
    return null;
  }
}

function getWithdrawalRequestTokenHash(token) {
  return crypto
    .createHmac('sha256', CREDITS_ADMIN_SESSION_SECRET)
    .update(String(token || '').trim())
    .digest('hex');
}

function getPublicBaseUrl(req) {
  const configuredBaseUrl = String(process.env.PUBLIC_BASE_URL || process.env.APP_BASE_URL || '').replace(/\/+$/, '');
  return configuredBaseUrl || `${req.protocol}://${req.get('host')}`;
}

function safeStringEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''));
  const rightBuffer = Buffer.from(String(right || ''));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function isCreditsAdminConfigured() {
  return Boolean(CREDITS_ADMIN_USERNAME && CREDITS_ADMIN_PASSWORD && CREDITS_ADMIN_SESSION_SECRET);
}

function isTestAdminApiAuthDisabled() {
  return process.env.NODE_ENV === 'test' && process.env.ADMIN_API_AUTH_DISABLED === 'true';
}

function isCreditsAdminAuthenticated(req) {
  if (!isCreditsAdminConfigured()) return false;

  const cookies = parseCookies(req.get('cookie'));
  return safeStringEqual(cookies[CREDITS_ADMIN_COOKIE_NAME], getCreditsAdminAuthToken());
}

function getSecureCookieAttribute(req) {
  const forwardedProto = String(req.get?.('x-forwarded-proto') || '').split(',')[0].trim();
  return req.secure || forwardedProto === 'https' ? '; Secure' : '';
}

function setCreditsAdminCookie(req, res) {
  const maxAgeSeconds = 12 * 60 * 60;
  res.setHeader(
    'Set-Cookie',
    `${CREDITS_ADMIN_COOKIE_NAME}=${encodeURIComponent(getCreditsAdminAuthToken())}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; SameSite=Lax${getSecureCookieAttribute(req)}`
  );
}

function clearCreditsAdminCookie(req, res) {
  res.setHeader(
    'Set-Cookie',
    `${CREDITS_ADMIN_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${getSecureCookieAttribute(req)}`
  );
}

function requireCreditsAdminAuth(req, res, next) {
  if (req.path.startsWith('/api/') && req.method !== 'POST' && isTestAdminApiAuthDisabled()) {
    return next();
  }

  if (isCreditsAdminAuthenticated(req)) {
    return next();
  }

  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ success: false, error: 'unauthorized' });
  }

  return res.redirect('/credits/login');
}

function formatDate(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '';

  return date.toLocaleString('th-TH', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

function normalizeGroupName(groupName) {
  return String(groupName || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function normalizeAdmin(admin) {
  const groupName = admin.groupName || '';
  const priority = Number(admin.priority) > 0 ? Number(admin.priority) : 1;

  return {
    ...admin,
    groupName,
    groupKey: admin.groupKey || normalizeGroupName(groupName),
    priority
  };
}

function sortAdmins(admins) {
  return [...admins].map(normalizeAdmin).sort((adminA, adminB) => {
    const groupCompare = adminA.groupKey.localeCompare(adminB.groupKey);
    if (groupCompare !== 0) return groupCompare;

    const priorityCompare = adminA.priority - adminB.priority;
    if (priorityCompare !== 0) return priorityCompare;

    return (adminB.timestamp || 0) - (adminA.timestamp || 0);
  });
}

function sortWounds(wounds) {
  return [...wounds].sort((woundA, woundB) => {
    if (woundA.status !== woundB.status) {
      return woundA.status === 'active' ? -1 : 1;
    }

    return (woundB.openedTimestamp || 0) - (woundA.openedTimestamp || 0);
  });
}

function sortRounds(rounds) {
  return [...rounds].sort((roundA, roundB) => (roundB.openedTimestamp || 0) - (roundA.openedTimestamp || 0));
}

function sortQueueLists(queueLists) {
  return [...queueLists].sort((listA, listB) => (listB.timestamp || 0) - (listA.timestamp || 0));
}

function normalizeCreditRow(row) {
  const transactions = Array.isArray(row.transactions) ? row.transactions : [];

  return {
    userId: row.userId || '',
    balance: Number(row.balance) || 0,
    totalAdded: Number(row.totalAdded) || 0,
    transactions: transactions.slice(0, MAX_CREDIT_TRANSACTIONS),
    updatedTimestamp: row.updatedTimestamp || row.timestamp || 0,
    updatedTime: row.updatedTime || row.time || ''
  };
}

function sortCredits(credits) {
  return [...credits]
    .map(normalizeCreditRow)
    .filter((credit) => credit.userId)
    .sort((creditA, creditB) => (creditB.updatedTimestamp || 0) - (creditA.updatedTimestamp || 0));
}

function normalizeWithdrawalRow(row) {
  return {
    id: row.id || '',
    userId: row.userId || '',
    displayName: normalizeDisplayName(row.displayName) || row.displayName || '',
    pictureUrl: normalizePictureUrl(row.pictureUrl),
    bankName: String(row.bankName || '').trim(),
    accountNumber: String(row.accountNumber || '').trim(),
    amount: roundPoints(row.amount),
    availableBalance: roundPoints(row.availableBalance),
    requestTokenHash: String(row.requestTokenHash || '').trim(),
    status: row.status || 'pending',
    createdTimestamp: row.createdTimestamp || row.timestamp || 0,
    createdTime: row.createdTime || row.time || '',
    completedAmount: roundPoints(row.completedAmount),
    completedTimestamp: row.completedTimestamp || 0,
    completedTime: row.completedTime || '',
    cancelReason: String(row.cancelReason || '').trim(),
    cancelledTimestamp: row.cancelledTimestamp || 0,
    cancelledTime: row.cancelledTime || ''
  };
}

function sortWithdrawals(withdrawals) {
  return [...withdrawals]
    .map(normalizeWithdrawalRow)
    .filter((withdrawal) => withdrawal.id && withdrawal.userId)
    .sort((withdrawalA, withdrawalB) => (withdrawalB.createdTimestamp || 0) - (withdrawalA.createdTimestamp || 0));
}

function normalizeBlacklistEntry(entry) {
  const groupId = String(entry?.groupId || '').trim();
  const userId = String(entry?.userId || '').trim();
  const timestamp = Number(entry?.timestamp || entry?.addedTimestamp || 0) || 0;

  return {
    id: String(entry?.id || `${groupId}:${userId}`).trim(),
    groupId,
    userId,
    displayName: normalizeDisplayName(entry?.displayName) || String(entry?.displayName || '').trim(),
    reason: String(entry?.reason || '').trim(),
    addedByUserId: String(entry?.addedByUserId || '').trim(),
    addedTimestamp: timestamp,
    addedTime: String(entry?.addedTime || entry?.time || '').trim(),
    messageId: String(entry?.messageId || '').trim()
  };
}

function sortBlacklist(entries) {
  return [...entries]
    .map(normalizeBlacklistEntry)
    .filter((entry) => entry.groupId && entry.userId)
    .sort((entryA, entryB) => (entryB.addedTimestamp || 0) - (entryA.addedTimestamp || 0));
}

function normalizeBlacklistMode(mode) {
  return {
    groupId: String(mode?.groupId || '').trim(),
    mode: mode?.mode === 'white' ? 'white' : 'black',
    openedByUserId: String(mode?.openedByUserId || '').trim(),
    openedTimestamp: Number(mode?.openedTimestamp || 0) || 0,
    expiresAt: Number(mode?.expiresAt || 0) || 0
  };
}

function sortBlacklistModes(modes) {
  return [...modes]
    .map(normalizeBlacklistMode)
    .filter((mode) => mode.groupId && mode.openedByUserId && mode.expiresAt > Date.now())
    .sort((modeA, modeB) => (modeB.openedTimestamp || 0) - (modeA.openedTimestamp || 0));
}

function getPendingWithdrawalForUser(userId) {
  const targetUserId = String(userId || '').trim();
  if (!targetUserId) return null;

  return readWithdrawals().find((withdrawal) => withdrawal.userId === targetUserId && withdrawal.status === 'pending') || null;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseAdminGroupTarget(value) {
  const groupName = String(value || '').trim();
  if (!groupName) return null;

  // A trailing number marks the admin priority: "Group1" or "Group 1".
  const priorityMatch = groupName.match(/^(.*?)(?:\s*([1-9]\d*))$/);
  const baseGroupName = priorityMatch && priorityMatch[1].trim() ? priorityMatch[1].trim() : groupName;
  const priority = priorityMatch ? Number(priorityMatch[2]) : 1;

  return {
    groupName: baseGroupName,
    groupKey: normalizeGroupName(baseGroupName),
    rawGroupName: groupName,
    priority
  };
}

function parseAdminCommand(message) {
  const pattern = new RegExp(`^\\s*${escapeRegExp(ADMIN_KEYWORD)}\\s*:\\s*(.+?)\\s*$`, 'i');
  const match = String(message || '').match(pattern);
  if (!match) return null;

  return parseAdminGroupTarget(match[1]);
}

function parseRemoveAdminCommand(message) {
  const pattern = new RegExp(`^\\s*${escapeRegExp(REMOVE_ADMIN_KEYWORD)}\\s*:\\s*(.+?)\\s*$`, 'i');
  const match = String(message || '').match(pattern);
  if (!match) return null;

  return parseAdminGroupTarget(match[1]);
}

function parseBindGroupCommand(message) {
  const text = normalizeMessageText(message);
  const match = text.match(/^(?:ผูกกลุ่ม|à¸œà¸¹à¸à¸à¸¥à¸¸à¹ˆà¸¡)\s*:\s*(.+)$/i);
  if (!match) return null;

  const groupName = match[1].trim();
  if (!groupName) return null;

  return {
    groupName,
    groupKey: normalizeGroupName(groupName)
  };
}

const ACCEPT_KEYWORDS = ['ต', 'ติด', 'ครับ', 'เค', 'จ้า'];
const ACCEPT_KEYWORDS_BY_LENGTH = [...ACCEPT_KEYWORDS].sort((keywordA, keywordB) => keywordB.length - keywordA.length);
const BASE_TRADE_KEYWORDS = [
  { keyword: 'ช่างไล่', side: 'chang_dai' },
  { keyword: 'ช่างยั่ง', side: 'chang_yang' },
  { keyword: 'ช่างถอย', side: 'chang_yang' },
  { keyword: 'ช่างมา', side: 'number_ma' },
  { keyword: 'ชล', side: 'chang_dai', adjustable: true },
  { keyword: 'ล', side: 'chang_dai', adjustable: true },
  { keyword: 'ไล่', side: 'chang_dai' },
  { keyword: 'ชย', side: 'chang_yang', adjustable: true },
  { keyword: 'ชถ', side: 'chang_yang', adjustable: true },
  { keyword: 'ย', side: 'chang_yang', adjustable: true },
  { keyword: 'ถ', side: 'chang_yang', adjustable: true },
  { keyword: 'ถ.ยั่ง', side: 'chang_yang' },
  { keyword: 'ถอย', side: 'chang_yang' }
];

const CUSTOM_PRICE_KEYWORDS = [
  { keyword: 'ช่างไล่', side: 'chang_dai' },
  { keyword: 'ช่างยั่ง', side: 'chang_yang' },
  { keyword: 'ช่างถอย', side: 'chang_yang' },
  { keyword: 'ไล่', side: 'chang_dai' },
  { keyword: 'ถอย', side: 'chang_yang' },
  { keyword: 'ยั่ง', side: 'chang_yang' },
  { keyword: 'มา', side: 'number_ma' },
  { keyword: 'ชล', side: 'chang_dai' },
  { keyword: 'ชย', side: 'chang_yang' },
  { keyword: 'ชถ', side: 'chang_yang' },
  { keyword: 'ล', side: 'chang_dai' },
  { keyword: 'ย', side: 'chang_yang' },
  { keyword: 'ถ', side: 'chang_yang' }
].sort((a, b) => b.keyword.length - a.keyword.length);

function buildTradeKeywords() {
  const adjustments = [];
  for (let number = 1; number <= 30; number += 1) {
    adjustments.push(`+${number}`, `-${number}`);
  }

  const keywords = [];
  for (const item of BASE_TRADE_KEYWORDS) {
    if (item.adjustable) {
      for (const adjustment of adjustments) {
        keywords.push({ keyword: `${adjustment}${item.keyword}`, side: item.side });
      }
    }

    keywords.push({ keyword: item.keyword, side: item.side });
  }

  return keywords.sort((a, b) => b.keyword.length - a.keyword.length);
}

const TRADE_KEYWORDS = buildTradeKeywords();
const CUSTOM_PRICE_KEYWORD_PATTERN = CUSTOM_PRICE_KEYWORDS.map((item) => escapeRegExp(item.keyword)).join('|');
const NO_BUILDER_FALLBACK_MARKERS = ['ชตย', 'ช่างตีไม่ติด', 'ช่างตียก'];
const NO_BUILDER_FALLBACK_MARKER_PATTERN = NO_BUILDER_FALLBACK_MARKERS
  .map((marker) => escapeRegExp(marker))
  .join('|');

function normalizeMessageText(message) {
  return String(message || '').trim().replace(/\s+/g, ' ');
}

function parseNoBuilderFallbackMarker(message) {
  const text = normalizeMessageText(message);
  return NO_BUILDER_FALLBACK_MARKERS.find((marker) => marker === text) || '';
}

function isNoBuilderFallbackMarker(message) {
  return Boolean(parseNoBuilderFallbackMarker(message));
}

function withNoBuilderFallback(trade, fallbackNoBuilder) {
  if (!trade || !fallbackNoBuilder) return trade;

  return {
    ...trade,
    fallbackNoBuilder: true,
    noBuilderPrice: true
  };
}

function parseTradeMessage(message) {
  const text = normalizeMessageText(message);
  if (!text) return null;

  for (const item of TRADE_KEYWORDS) {
    const pattern = new RegExp(`^${escapeRegExp(item.keyword)}(?:[\\s.]+)?(\\d*)$`, 'i');
    const match = text.match(pattern);

    if (match) {
      return {
        side: item.side,
        keyword: item.keyword,
        amount: match[1] || '',
        rawText: text
      };
    }
  }

  const customPriceMatch = text.match(new RegExp(`^(\\d+(?:-\\d+)*?)\\s*(${CUSTOM_PRICE_KEYWORD_PATTERN})\\s*(\\d*)\\s*(${NO_BUILDER_FALLBACK_MARKER_PATTERN})?$`, 'i'));
  if (customPriceMatch) {
    const priceRaw = customPriceMatch[1];
    const hasFullPriceNumbers = priceRaw
      .split('-')
      .every((part) => /^[1-9]\d{2,}$/.test(part));

    if (!hasFullPriceNumbers) {
      return null;
    }

    const keyword = customPriceMatch[2];
    const keywordEntry = CUSTOM_PRICE_KEYWORDS.find((item) => item.keyword === keyword);
    const amount = customPriceMatch[3] || '';
    const fallbackNoBuilder = Boolean(customPriceMatch[4]);

    return {
      side: keywordEntry?.side || 'custom_price',
      keyword,
      amount,
      rawText: text,
      priceRaw,
      customPrice: true,
      fallbackNoBuilder,
      noBuilderPrice: fallbackNoBuilder,
      requiredCredit: amount ? roundPoints(Number(amount)) : 0
    };
  }

  return null;
}

function parseAcceptMessage(message) {
  return parseAcceptIntent(message)?.keyword || null;
}

function parseAcceptIntent(message) {
  const text = normalizeMessageText(message);
  if (!text) return null;

  const compactText = text.replace(/\s+/g, '');
  for (const keyword of ACCEPT_KEYWORDS_BY_LENGTH) {
    if (compactText === keyword) {
      return { keyword, amount: '' };
    }

    if (compactText.startsWith(keyword)) {
      const amount = compactText.slice(keyword.length);
      if (/^[1-9]\d*$/.test(amount)) {
        return { keyword, amount };
      }
    }
  }

  const fallbackMarker = parseNoBuilderFallbackMarker(text);
  return fallbackMarker ? { keyword: fallbackMarker, amount: '' } : null;
}

function parseResultCommand(message) {
  const match = normalizeMessageText(message).match(/^แจ้งผล\s*(.+)$/i);
  const result = match ? match[1].trim() : '';
  return result || null;
}

function normalizeQueueLine(line) {
  return String(line || '').trim().replace(/\s+/g, ' ');
}

function looksLikeDateLine(line) {
  return /\d/.test(line) && /(มกราคม|กุมภาพันธ์|มีนาคม|เมษายน|พฤษภาคม|มิถุนายน|กรกฎาคม|สิงหาคม|กันยายน|ตุลาคม|พฤศจิกายน|ธันวาคม|\d{4})/.test(line);
}

const QUEUE_LIST_KEYWORDS = ['คิวจุดรายการ', 'จุดรายการ'];
const QUEUE_LOOKUP_KEYWORDS = ['คิวจุด', 'คิว'];

function isQueueSeparatorLine(line) {
  return /^[-=_\s]{3,}$/.test(String(line || ''));
}

function isNumberedQueueItemLine(line) {
  return /^\d+\s*[.)]\s*\S/.test(String(line || ''));
}

function cleanQueueItemLine(line) {
  return String(line || '').replace(/^\d+\s*[.)]\s*/, '').trim();
}

function isQueueFooterLine(line) {
  return /^📍/.test(String(line || '').trim());
}

function getQueueListKeyword(line) {
  return QUEUE_LIST_KEYWORDS.find((keyword) => line === keyword || line.startsWith(`${keyword} `)) || '';
}

function parseQueueLookupKeyword(message) {
  return QUEUE_LOOKUP_KEYWORDS.includes(normalizeMessageText(message));
}

function hasQueueItemContentAfterBlank(lines, blankIndex) {
  for (const line of lines.slice(blankIndex + 1)) {
    if (!line || isQueueSeparatorLine(line)) continue;
    if (/^หมายเหตุ/.test(line) || isQueueFooterLine(line)) return false;
    return true;
  }

  return false;
}

function parseQueueListMessage(message) {
  const rawLines = String(message || '').replace(/\r\n/g, '\n').split('\n');
  const lines = rawLines.map((line) => normalizeQueueLine(line));
  const firstContentIndex = lines.findIndex((line) => line.length > 0);
  const queueListKeyword = firstContentIndex >= 0 ? getQueueListKeyword(lines[firstContentIndex]) : '';

  if (!queueListKeyword) {
    return null;
  }

  const firstNumberedItemIndex = lines.findIndex((line, index) =>
    index > firstContentIndex && isNumberedQueueItemLine(line)
  );
  const firstBlankAfterHeader = lines.findIndex((line, index) =>
    index > firstContentIndex &&
    line.length === 0 &&
    (firstNumberedItemIndex < 0 || index < firstNumberedItemIndex)
  );
  const hasItemAfterFirstBlank =
    firstBlankAfterHeader >= 0 && hasQueueItemContentAfterBlank(lines, firstBlankAfterHeader);
  const blankSeparatesHeaderFromItems =
    firstBlankAfterHeader >= 0 && (firstNumberedItemIndex >= 0 || hasItemAfterFirstBlank);
  const itemStartIndex =
    blankSeparatesHeaderFromItems
      ? firstBlankAfterHeader + 1
      : firstNumberedItemIndex >= 0
        ? firstNumberedItemIndex
        : firstContentIndex + 1;
  const headerEndIndex = blankSeparatesHeaderFromItems ? firstBlankAfterHeader : itemStartIndex;
  const headerLines = lines
    .slice(firstContentIndex, headerEndIndex)
    .filter((line) => line && !isQueueSeparatorLine(line));
  const headerParts = headerLines.map((line, index) =>
    index === 0 ? line.slice(queueListKeyword.length).trim() : line
  );
  const dateLineIndex = headerParts.findIndex(looksLikeDateLine);
  const dateText = dateLineIndex >= 0 ? headerParts[dateLineIndex] : '';
  const title = headerParts.filter((_, index) => index !== dateLineIndex).join(' ').trim();
  const itemLines = [];
  const noteLines = [];
  let note = '';
  let isFooterSection = false;

  for (const line of lines.slice(itemStartIndex)) {
    if (!line) {
      if (firstNumberedItemIndex >= 0 && itemLines.length > 0) {
        isFooterSection = true;
      }
      continue;
    }
    if (isQueueSeparatorLine(line)) continue;
    if (/^หมายเหตุ/.test(line)) {
      note = line;
      break;
    }
    if (itemLines.length === 0 && isQueueFooterLine(line)) {
      isFooterSection = true;
    }
    if (isFooterSection) {
      noteLines.push(line);
      continue;
    }

    const itemLine = cleanQueueItemLine(line);
    if (itemLine) {
      itemLines.push(itemLine);
    }
  }

  if (!note && noteLines.length > 0) {
    note = noteLines.join('\n');
  }

  if (itemLines.length === 0) {
    return {
      error: 'missing_items',
      rawText: String(message || '')
    };
  }

  return {
    title,
    dateText,
    items: itemLines.map((name, index) => ({
      order: index + 1,
      name
    })),
    note,
    rawText: String(message || '')
  };
}

function looksLikeQueueListAttempt(message) {
  const rawLines = String(message || '').replace(/\r\n/g, '\n').split('\n');
  const lines = rawLines.map((line) => normalizeQueueLine(line)).filter((line) => line.length > 0);
  if (lines.length < 2) return false;

  const firstLine = lines[0] || '';
  if (getQueueListKeyword(firstLine)) return true;
  if (/คิว/.test(firstLine) && lines.length >= 3) return true;

  return false;
}

function buildQueueListErrorReply(error) {
  if (error === 'missing_keyword') {
    return [
      'คิวไม่ติด ❌',
      '',
      'ปัญหา: ขาดคำขึ้นต้นคิวจุดรายการ',
      'วิธีแก้: ให้บรรทัดแรกเป็น คิวจุดรายการ หรือ จุดรายการ แล้วตามด้วยรายชื่อคิว',
      '',
      'ตัวอย่าง:',
      'คิวจุดรายการ',
      '1.ชื่อคิว',
      '2.ชื่อคิว',
      '',
      'หรือ',
      'จุดรายการ',
      'ชื่อคิว',
      'ชื่อคิว'
    ].join('\n');
  }

  if (error === 'missing_items') {
    return [
      'คิวไม่ติด ❌',
      '',
      'ปัญหา: ยังไม่เจอรายชื่อคิว',
      'วิธีแก้: หลังคำว่า คิวจุดรายการ ให้ใส่รายชื่อคิวทีละบรรทัด',
      '',
      'ตัวอย่าง:',
      'คิวจุดรายการ',
      '1.ชื่อคิว',
      '2.ชื่อคิว',
      '',
      'หรือ',
      'คิวจุดรายการ',
      'ชื่อคิว',
      'ชื่อคิว'
    ].join('\n');
  }

  return [
    'คิวไม่ติด ❌',
    '',
    'ปัญหา: รูปแบบคิวจุดยังอ่านไม่ได้',
    'วิธีแก้: ขึ้นต้นด้วย คิวจุดรายการ แล้วใส่ชื่อคิวทีละบรรทัด'
  ].join('\n');
}

function formatClockTime(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '';

  return date.toLocaleTimeString('th-TH', {
    timeZone: 'Asia/Bangkok',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

function formatElapsedSeconds(fromTimestamp, toTimestamp) {
  if (!fromTimestamp || !toTimestamp) return '-';
  const seconds = Math.max(0, (toTimestamp - fromTimestamp) / 1000);
  return `${seconds.toFixed(2)} seconds`;
}

function parsePriceRange(message) {
  const match = String(message || '').match(/(\d+)\s*-\s*(\d+)/);
  if (!match) return null;

  const low = Number(match[1]);
  const high = Number(match[2]);
  const min = Math.min(low, high);
  const max = Math.max(low, high);

  return {
    raw: `${match[1]}-${match[2]}`,
    low: min,
    high: max
  };
}

function parseSettlementPrice(value) {
  const text = String(value || '').trim();
  const range = parsePriceRange(text);
  if (range) return range;

  const single = text.match(/^(\d+)$/);
  if (!single) return null;

  const price = Number(single[1]);
  if (!Number.isFinite(price)) return null;

  return {
    raw: single[1],
    low: price,
    high: price
  };
}

function parseBuilderPriceValue(value) {
  return parseSettlementPrice(value);
}

function parseOpenCommand(message) {
  const match = normalizeMessageText(message).match(/^เปิด\s+(.+)$/i);
  if (!match) return null;

  let queueName = match[1].trim();
  const price = parsePriceRange(queueName);
  const noBuilderPrice = /ช่างไม่ตี|ไม่ตี/.test(queueName);

  if (price) {
    queueName = queueName.replace(/\d+\s*-\s*\d+/, '').trim();
  }

  if (noBuilderPrice) {
    queueName = queueName.replace(/เบื้องต้น|ช่างไม่ตี|ไม่ตี/g, '').trim();
  }

  if (!queueName) return null;

  return {
    queueName,
    price,
    noBuilderPrice
  };
}

function parseWaitBuilderPriceCommand(message) {
  const match = normalizeMessageText(message).match(/^รอราคาช่าง\s*[,，]?\s*(.+)$/i);
  if (!match) return null;

  const queueName = match[1].trim();
  if (!queueName) return null;

  return {
    queueName,
    price: null,
    noBuilderPrice: false
  };
}

function parseRoundReminderCommand(message) {
  const text = normalizeMessageText(message).replace(/\s+/g, '');
  if (text === 'รอ' || text === 'รอราคาช่าง') return 'waiting_price';
  if (text === 'ลุย' || text === 'มาละ' || text === 'ตามนั้น') return 'ready';
  return '';
}

function parseCloseCommand(message) {
  return normalizeMessageText(message) === 'ปิด';
}

function parseFinishQueueCommand(message) {
  const text = normalizeMessageText(message);
  return text === 'ปิดคิวสุดท้าย' || text === 'สิ้นสุด' || text === 'ปิดคิวสุดท้าย, สิ้นสุด';
}

function parseBuilderPriceCommand(message) {
  const match = normalizeMessageText(message).match(/^ราคาช่าง\s*(.+)$/i);
  if (!match) return null;

  return parseBuilderPriceValue(match[1]);
}

function parseCancelQueueCommand(message) {
  const match = normalizeMessageText(message).match(/^ยกเลิก\s*(.+)$/i);
  const queueName = match ? match[1].trim() : '';
  return queueName || '';
}

function parseBehindHouseCommand(message) {
  return normalizeMessageText(message) === 'หลังบ้าน';
}

function parseNoBuilderAnnouncementCommand(message) {
  const text = normalizeMessageText(message);
  return /(^|\s)ช่าง(?:ไม่|บ่)ตี(?:\s|$|@)/.test(text);
}

function buildNoBuilderAnnouncementReply() {
  return [
    'ประกาศฯ กรณีทางกลุ่มประกาศช่างไม่ตี',
    '⛔',
    '👉คนที่เล่นช่างไว้ถ้าจะเล่นตัวเลขแล้วกลัวช่างตีตอนท้าย',
    '👉ให้พิมพ์หลังแผลที่เรียกว่า "ช่างตีไม่ติด" หรือ "ช่างตียก"',
    '👉หากช่างตีแล้วแผลนั้นจะยกเลิกให้อัตโนมัติ❌'
  ].join('\n');
}

function getLatestRoundForGroup(groupId) {
  return readRounds().find((round) => round.groupId === groupId) || null;
}

function getOpenRoundForGroup(groupId) {
  return readRounds().find((round) => round.groupId === groupId && round.status === 'open') || null;
}

function isRoundAwaitingResult(round) {
  return round?.status === 'open' || round?.status === 'closed';
}

function normalizeQueueNameForCompare(value) {
  return normalizeMessageText(value).replace(/\s+/g, '');
}

function findCancellableRoundByName(groupId, queueName) {
  const targetQueueName = normalizeQueueNameForCompare(queueName);
  if (!targetQueueName) return null;

  return (
    readRounds().find(
      (round) =>
        round.groupId === groupId &&
        round.status !== 'resulted' &&
        round.status !== 'cancelled' &&
        normalizeQueueNameForCompare(round.queueName) === targetQueueName
    ) || null
  );
}

function getLatestQueueListForGroup(groupId) {
  return readQueueLists().find((queueList) => queueList.groupId === groupId) || null;
}

function getQueueListTimestamp(queueList) {
  return Number(queueList?.timestamp || 0);
}

function isRoundInQueueListWindow(round, queueList) {
  const queueListTimestamp = getQueueListTimestamp(queueList);
  if (!queueListTimestamp) return true;

  return Number(round?.openedTimestamp || 0) >= queueListTimestamp;
}

function readRoundsForQueueList(groupId, queueList) {
  return readRounds()
    .filter((round) => round.groupId === groupId)
    .filter((round) => !queueList || isRoundInQueueListWindow(round, queueList))
    .sort((roundA, roundB) => (roundA.openedTimestamp || 0) - (roundB.openedTimestamp || 0));
}

function upsertRound(roundEntry) {
  const rounds = readRounds().filter((round) => round.id !== roundEntry.id);
  writeRounds([roundEntry, ...rounds]);
  return roundEntry;
}

function getPriceFields(price) {
  if (!price) {
    return {
      priceRaw: '',
      priceLow: null,
      priceHigh: null
    };
  }

  return {
    priceRaw: price.raw,
    priceLow: price.low,
    priceHigh: price.high
  };
}

function getRoundPrice(round) {
  if (!round?.priceRaw || round.priceLow === null || round.priceHigh === null) {
    return null;
  }

  return {
    raw: round.priceRaw,
    low: Number(round.priceLow),
    high: Number(round.priceHigh)
  };
}

function buildOpenReply(round) {
  if (round.noBuilderPrice) {
    return `${round.queueName}\n\nเบื้องต้นช่างไม่ตี ⛔️\n\n🚀🚀🚀🚀🚀`;
  }

  if (round.priceRaw) {
    return `${round.queueName}\n\nช่าง ${round.priceRaw} ⛔️\n\n🚀🚀🚀🚀🚀`;
  }

  return `${round.queueName}\n\nช่าง ⛔️\n\n🚀🚀🚀🚀🚀`;
}

function shouldSendRoundReminder(round, reminderMode) {
  if (!round || round.status !== 'open') return false;

  const hasBuilderPrice = Boolean(getRoundPrice(round));
  if (reminderMode === 'waiting_price') return !hasBuilderPrice && !round.noBuilderPrice;
  if (reminderMode === 'ready') return hasBuilderPrice;
  return false;
}

function buildCloseReply(round) {
  return `❌❌❌❌ ปิด ❌❌❌❌\n\n3 2 1 ไป๊!! 🚀🚀🚀\n\n${round.queueName}\n\n⛔หลังปิดไม่ติดทุกกรณี⛔`;
}

function buildQueueCancelledReply(round, cancelledCount) {
  return [
    `⚠️ ยกเลิกคิว: ${round.queueName}`,
    'เปลี่ยนคิวจุดกะทันหัน',
    `ยกเลิกทุกแผลของคิวนี้แล้ว ${cancelledCount} แผล`,
    'เครดิตที่กันไว้คืนให้ผู้เล่นแล้วครับ'
  ].join('\n');
}

function buildQueueCancelNotFoundReply(queueName) {
  return [
    `ยังไม่เจอคิวที่กำลังเล่นชื่อ "${queueName}" ครับ`,
    'ตรวจชื่อคิวให้ตรงกับคิวที่เปิดอยู่ แล้วพิมพ์ ยกเลิกชื่อคิว อีกครั้งครับ'
  ].join('\n');
}

function buildQueueCancelledPlayerMessage(round) {
  return {
    type: 'text',
    text: [
      `⚠️ คิว "${round.queueName}" ถูกยกเลิก`,
      'แผลของคิวนี้ถูกยกเลิกแล้ว',
      'เครดิตที่กันไว้กลับไปเป็นยอดถอนได้ครับ'
    ].join('\n')
  };
}

function buildCloseImageMessage(publicBaseUrl) {
  const baseUrl = String(publicBaseUrl || '').replace(/\/+$/, '');
  if (!baseUrl || !fs.existsSync(CLOSE_IMAGE_FILE)) return null;

  const imageUrl = `${baseUrl}${CLOSE_IMAGE_ROUTE}`;
  return {
    type: 'image',
    originalContentUrl: imageUrl,
    previewImageUrl: imageUrl
  };
}

function buildCloseReplyMessages(round, publicBaseUrl) {
  return [buildCloseReply(round), buildCloseImageMessage(publicBaseUrl)].filter(Boolean);
}

function buildPendingResultReply(round) {
  return `⚠️ รอบ '${round.queueName}' ยังไม่ได้แจ้งผล\nกรุณาแจ้งผล แล้วค่อยเปิดรอบใหม่`;
}

function isNumericResult(result) {
  return /^\d+$/.test(String(result || ''));
}

function getResultIcon(round, result) {
  if (!isNumericResult(result)) {
    return '';
  }

  const resultNumber = Number(result);
  const price = getRoundPrice(round);

  if (!price || Number.isNaN(resultNumber)) {
    return '➖';
  }

  if (resultNumber > price.high) return '✅';
  if (resultNumber < price.low) return '❌';
  return '➖';
}

function buildRoundResultLine(round) {
  if (!round.result) {
    return round.queueName;
  }

  if (!isNumericResult(round.result)) {
    return `${round.queueName} ${round.result}`;
  }

  if (round.priceRaw) {
    return `${round.queueName} ${round.priceRaw} ${round.result}${round.resultIcon || getResultIcon(round, round.result)}`;
  }

  return `${round.queueName} ช่างไม่ต่อย ${round.result}➖`;
}

function buildResultConfirmedReply(round, result) {
  const numericSuffix = isNumericResult(result) ? '///' : '';
  return `${round.queueName}\n\nผล ${result}${numericSuffix}\n\n🚀🚀🚀🚀🚀`;
}

function buildQueueSummary(groupId) {
  const queueList = getLatestQueueListForGroup(groupId);
  const rounds = readRoundsForQueueList(groupId, queueList);

  if (!queueList) {
    const lines = rounds.map(buildRoundResultLine);
    return `คิวจุด✅\n\n${lines.join('\n')}`;
  }

  const roundsByName = new Map(
    rounds.map((round) => [normalizeGroupName(round.queueName), round])
  );
  const lines = queueList.items.map((item) => {
    const round = roundsByName.get(normalizeGroupName(item.name));
    return round ? buildRoundResultLine(round) : item.name;
  });
  const note = queueList.note ? `\n\n${queueList.note}` : '';

  return `คิวจุด✅\n\n${lines.join('\n')}${note}`;
}

function buildQueueListSavedReply(queueList) {
  const lines = Array.isArray(queueList?.items)
    ? queueList.items.map((item) => String(item?.name || '').trim()).filter(Boolean)
    : [];

  if (lines.length === 0) {
    return 'คิวจุด✅';
  }

  return `คิวจุด✅\n\n${lines.join('\n')}`;
}

function buildQueueFinishedReply() {
  return [
    '❌จบการรายงาน',
    'สำหรับวันนี้ทางทีมงานขอขอบคุณ',
    'และสวัสดีครับบบ 🙏',
    '**ส่งเลขบัญชีไว้หลังบ้านได้เลยนะครับ',
    '✅✅✅'
  ].join('\n');
}

function isQueueListFinished(groupId) {
  const queueList = getLatestQueueListForGroup(groupId);
  if (!queueList || !Array.isArray(queueList.items) || queueList.items.length === 0) {
    return false;
  }

  const roundsByName = new Map(
    readRoundsForQueueList(groupId, queueList).map((round) => [normalizeGroupName(round.queueName), round])
  );

  return queueList.items.every((item) => {
    const round = roundsByName.get(normalizeGroupName(item.name));
    return round?.status === 'resulted';
  });
}

function toLineMessage(message) {
  if (typeof message === 'string') {
    return {
      type: 'text',
      text: message
    };
  }

  return message;
}

function parseCreditKeyword(message) {
  const text = normalizeMessageText(message);
  if (['เช็คยอดเงิน', 'เช็คยอด'].includes(text)) return 'balance';
  if (['แผลที่กำลังติด', 'การจับคู่', 'จับคู่'].includes(text)) return 'active_wounds';
  if (['ถอนยอดเงิน', 'ถอน'].includes(text)) return 'withdraw';
  return null;
}

function parsePaymentAccountKeyword(message) {
  const text = normalizeMessageText(message).replace(/\s+/g, '');
  return ['บช', 'เลข', 'เลขบัญชี', 'บัญชี', 'ลบช', 'เลขบช'].includes(text);
}

function parseBetGroupInviteKeyword(message) {
  const text = normalizeMessageText(message).replace(/\s+/g, '');
  return ['เข้ากลุ่มแทง', 'กลุ่มแทง'].includes(text);
}

function isBetGroupInviteAction(value) {
  const text = String(value || '').trim();
  if (!text) return false;
  if (parseBetGroupInviteKeyword(text)) return true;

  const normalizedAction = text.toLowerCase().replace(/[-\s]+/g, '_');
  return [
    'bet_group_invite',
    'betgroupinvite'
  ].includes(normalizedAction);
}

function parseBetGroupInvitePostbackData(data) {
  const rawData = String(data || '').trim();
  if (!rawData) return false;
  if (isBetGroupInviteAction(rawData)) return true;

  const params = new URLSearchParams(rawData);
  return [
    params.get('action'),
    params.get('type'),
    params.get('menu'),
    params.get('keyword'),
    params.get('text'),
    params.get('label'),
    params.get('message')
  ].some(isBetGroupInviteAction);
}

function parseGroupAdminLookupKeyword(message) {
  const text = normalizeMessageText(message).toLowerCase();
  return ['แอดมิน', 'แอด', 'admin'].includes(text);
}

function parseOpenAccountListCommand(message) {
  const text = normalizeMessageText(message).replace(/\s+/g, '');
  if (['เปิดบช.ดำ', 'เปิดดำ', 'เปิดบัญชีดำ', 'เปิดลบบัญชีดำ'].includes(text)) {
    return 'black';
  }
  if (['เปิดขาว', 'เปิดบช.ขาว', 'เปิดบัญชีขาว'].includes(text)) {
    return 'white';
  }
  return '';
}

function parseBlacklistTargetCommand(message) {
  const text = normalizeMessageText(message);
  if (!text) return null;

  const compact = text.replace(/\s+/g, '');
  const removePrefixes = ['ลบบัญชีดำ', 'ปลดบัญชีดำ', 'บัญชีขาว', 'บชขาว', 'whitelist', 'unblock'];
  const addPrefixes = ['เพิ่มบัญชีดำ', 'บัญชีดำ', 'บชดำ', 'blacklist', 'block'];

  for (const prefix of removePrefixes) {
    if (compact.toLowerCase().startsWith(prefix.toLowerCase())) {
      return {
        mode: 'white',
        targetText: text.slice(text.toLowerCase().indexOf(prefix.toLowerCase()) + prefix.length).replace(/^[:>\-\s]+/, '').trim()
      };
    }
  }

  for (const prefix of addPrefixes) {
    if (compact.toLowerCase().startsWith(prefix.toLowerCase())) {
      return {
        mode: 'black',
        targetText: text.slice(text.toLowerCase().indexOf(prefix.toLowerCase()) + prefix.length).replace(/^[:>\-\s]+/, '').trim()
      };
    }
  }

  return null;
}

function getMessageMentionTargets(event) {
  const text = getMessageText(event);
  const mentionees = Array.isArray(event?.message?.mention?.mentionees)
    ? event.message.mention.mentionees
    : [];

  return mentionees
    .filter((mention) => mention?.userId)
    .map((mention) => {
      const index = Math.max(0, Number(mention.index) || 0);
      const length = Math.max(0, Number(mention.length) || 0);
      const mentionedText = length > 0 ? text.slice(index, index + length) : '';
      return {
        userId: String(mention.userId || '').trim(),
        displayName: normalizeDisplayName(mentionedText.replace(/^@+/, '').trim()) || findKnownDisplayNameByUserId(mention.userId)
      };
    })
    .filter((target) => target.userId);
}

function findKnownGroupMemberByDisplayName(groupId, displayName) {
  const targetName = normalizeDisplayName(displayName).toLowerCase();
  if (!groupId || !targetName) return null;

  const message = readMessages()
    .filter((row) => row.groupId === groupId && row.userId && normalizeDisplayName(row.displayName).toLowerCase() === targetName)
    .sort((rowA, rowB) => (Number(rowB.timestamp) || 0) - (Number(rowA.timestamp) || 0))[0];

  if (!message) return null;
  return {
    userId: message.userId,
    displayName: normalizeDisplayName(message.displayName)
  };
}

function getLineUserIdsFromText(text) {
  return Array.from(new Set(String(text || '').match(/\bU[0-9A-Za-z_-]{5,}\b/g) || []));
}

function normalizeBlacklistTargetText(message, explicitTargetText = '') {
  const text = explicitTargetText || normalizeMessageText(message);
  return String(text || '')
    .replace(/^[@>\-:\s]+/, '')
    .replace(/^ลบบัญชีดำ\s*/i, '')
    .replace(/^ปลดบัญชีดำ\s*/i, '')
    .replace(/^บัญชีขาว\s*/i, '')
    .replace(/^บชขาว\s*/i, '')
    .replace(/^เพิ่มบัญชีดำ\s*/i, '')
    .replace(/^บัญชีดำ\s*/i, '')
    .replace(/^บชดำ\s*/i, '')
    .replace(/^blacklist\s*/i, '')
    .replace(/^block\s*/i, '')
    .replace(/^whitelist\s*/i, '')
    .replace(/^unblock\s*/i, '')
    .replace(/^[@>\-:\s]+/, '')
    .trim();
}

async function resolveBlacklistTargets(event, targetText = '') {
  const source = event.source || {};
  const targetsByUserId = new Map();

  for (const target of getMessageMentionTargets(event)) {
    targetsByUserId.set(target.userId, target);
  }

  const cleanedTargetText = normalizeBlacklistTargetText(getMessageText(event), targetText);
  for (const userId of getLineUserIdsFromText(cleanedTargetText)) {
    if (!targetsByUserId.has(userId)) {
      const displayName = findKnownDisplayNameByUserId(userId) ||
        normalizeDisplayName((await getLineGroupMemberProfile(source.groupId, userId).catch(() => null))?.displayName);
      targetsByUserId.set(userId, { userId, displayName });
    }
  }

  if (targetsByUserId.size === 0 && cleanedTargetText) {
    const knownMember = findKnownGroupMemberByDisplayName(source.groupId, cleanedTargetText.replace(/^@+/, ''));
    if (knownMember) {
      targetsByUserId.set(knownMember.userId, knownMember);
    }
  }

  return Array.from(targetsByUserId.values()).map((target) => ({
    userId: String(target.userId || '').trim(),
    displayName: normalizeDisplayName(target.displayName) || findKnownDisplayNameByUserId(target.userId) || String(target.userId || '').trim()
  })).filter((target) => target.userId);
}

function getActiveBlacklistMode(groupId) {
  const nowTimestamp = Date.now();
  const activeModes = readBlacklistModes().filter((mode) => mode.groupId === groupId && mode.expiresAt > nowTimestamp);
  return activeModes[0] || null;
}

function setBlacklistMode(groupId, mode, openedByUserId, openedTimestamp = Date.now()) {
  const entry = {
    groupId,
    mode,
    openedByUserId,
    openedTimestamp,
    expiresAt: openedTimestamp + BLACKLIST_MODE_TTL_MS
  };
  const modes = readBlacklistModes().filter((row) => row.groupId !== groupId);
  writeBlacklistModes([entry, ...modes]);
  return entry;
}

function clearBlacklistMode(groupId) {
  writeBlacklistModes(readBlacklistModes().filter((row) => row.groupId !== groupId));
}

function isUserBlacklistedForGroup(userId, groupId) {
  if (!userId || !groupId) return false;
  return readBlacklist().some((entry) => entry.userId === userId && entry.groupId === groupId);
}

function isUserBlacklistedAnywhere(userId) {
  if (!userId) return false;
  return readBlacklist().some((entry) => entry.userId === userId);
}

function upsertBlacklistEntries(groupId, targets, adminUserId, event) {
  const nowTimestamp = event?.timestamp || Date.now();
  const existing = readBlacklist();
  const nextEntries = [...existing];

  for (const target of targets) {
    const currentIndex = nextEntries.findIndex((entry) => entry.groupId === groupId && entry.userId === target.userId);
    const entry = normalizeBlacklistEntry({
      ...(currentIndex >= 0 ? nextEntries[currentIndex] : {}),
      id: `${groupId}:${target.userId}`,
      groupId,
      userId: target.userId,
      displayName: normalizeDisplayName(target.displayName) || target.userId,
      reason: 'black_account',
      addedByUserId: adminUserId,
      addedTimestamp: nowTimestamp,
      addedTime: formatDate(nowTimestamp),
      messageId: event?.message?.id || ''
    });

    if (currentIndex >= 0) {
      nextEntries[currentIndex] = entry;
    } else {
      nextEntries.push(entry);
    }
  }

  writeBlacklist(nextEntries);
}

function removeBlacklistEntries(groupId, targets) {
  const targetIds = new Set(targets.map((target) => target.userId));
  writeBlacklist(readBlacklist().filter((entry) => !(entry.groupId === groupId && targetIds.has(entry.userId))));
}

function buildBlacklistTargetReply(mode, groupName, targets) {
  const isRemove = mode === 'white';
  const names = targets.map((target, index) => `${index + 1}. ${target.displayName || target.userId}`).join('\n');
  const title = isRemove ? '✅ เปิดบัญชีขาวสำเร็จ' : '✅ เพิ่มบัญชีดำสำเร็จ';
  const note = isRemove
    ? 'ผู้ใช้นี้กลับมาใช้งานในกลุ่มนี้ได้แล้วครับ'
    : 'ระบบจะไม่รับแทง ไม่ตอบหลังบ้าน และไม่ให้ถอนจากบัญชีนี้ครับ';

  return `${title}\nกลุ่ม ${groupName || '-'}\n${names}\n\n${note}`;
}

function buildBlacklistTargetNotFoundReply(mode) {
  const actionText = mode === 'white' ? 'ปลดบัญชีดำ' : 'เพิ่มบัญชีดำ';
  return `ยัง${actionText}ไม่ได้ครับ\nกรุณา @ชื่อผู้ใช้ หรือส่ง userId ของ LINE ให้ชัดเจน`;
}

function buildBlacklistedWithdrawBlockedText() {
  return 'บัญชีนี้ถูกระงับการถอน กรุณาติดต่อแอดมินครับ';
}

function roundPoints(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

const POINT_FORMATTER = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

const INTEGER_FORMATTER = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 0
});

function formatPoints(value) {
  return POINT_FORMATTER.format(roundPoints(value));
}

function formatIntegerGroupsInText(value) {
  return String(value || '').replace(/\d+/g, (numberText) => INTEGER_FORMATTER.format(Number(numberText)));
}

function findCreditByUserId(userId) {
  return readCredits().find((credit) => credit.userId === userId) || {
    userId,
    balance: 0,
    totalAdded: 0,
    transactions: [],
    updatedTimestamp: 0,
    updatedTime: ''
  };
}

function addKnownCreditUserCandidate(users, userId, timestamp = 0) {
  const key = String(userId || '').trim();
  if (!key) return;

  const current = users.get(key) || { userId: key, lastSeenTimestamp: 0 };
  const nextTimestamp = Number(timestamp) || 0;
  users.set(key, {
    userId: key,
    lastSeenTimestamp: Math.max(current.lastSeenTimestamp || 0, nextTimestamp)
  });
}

function getManualCreditUsers() {
  const users = new Map();
  const credits = readCredits();
  const creditMap = new Map(credits.map((credit) => [credit.userId, credit]));

  credits.forEach((credit) => addKnownCreditUserCandidate(users, credit.userId, credit.updatedTimestamp));

  readMessages().forEach((message) => {
    addKnownCreditUserCandidate(users, message.userId, message.timestamp);
  });

  readWounds().forEach((wound) => {
    const timestamp = wound.openedTimestamp || wound.timestamp || 0;
    addKnownCreditUserCandidate(users, wound.openerUserId, timestamp);
    addKnownCreditUserCandidate(users, wound.accepterUserId, timestamp);
  });

  readWithdrawals().forEach((withdrawal) => {
    addKnownCreditUserCandidate(users, withdrawal.userId, withdrawal.createdTimestamp);
  });

  readAdmins().forEach((admin) => {
    addKnownCreditUserCandidate(users, admin.userId, admin.timestamp);
  });

  readLogs().forEach((log) => {
    addKnownCreditUserCandidate(users, log.userId, log.timestamp);
  });

  return [...users.values()]
    .map((user) => {
      const credit = creditMap.get(user.userId) || findCreditByUserId(user.userId);
      return {
        ...credit,
        lastSeenTimestamp: user.lastSeenTimestamp,
        sortTimestamp: credit.updatedTimestamp || user.lastSeenTimestamp || 0
      };
    })
    .sort((userA, userB) => (userB.sortTimestamp || 0) - (userA.sortTimestamp || 0));
}

function addCreditForUser(event, totalAmount, rawText, transactionFields = {}) {
  const source = event.source || {};
  const nowTimestamp = event.timestamp || Date.now();
  const credits = readCredits();
  const existing = credits.find((credit) => credit.userId === source.userId) || {
    userId: source.userId,
    balance: 0,
    totalAdded: 0,
    transactions: []
  };
  const nextBalance = roundPoints(existing.balance + totalAmount);
  const transaction = {
    id: `${event.message?.id || nowTimestamp}:credit`,
    type: 'credit_added',
    amount: totalAmount,
    rawText,
    messageId: event.message?.id || '',
    displayName: getEventDisplayName(event),
    pictureUrl: normalizePictureUrl(event?.source?.pictureUrl || event?.pictureUrl || transactionFields.pictureUrl),
    balanceAfter: nextBalance,
    timestamp: nowTimestamp,
    time: formatDate(nowTimestamp),
    ...transactionFields
  };
  const updatedCredit = {
    ...existing,
    balance: nextBalance,
    totalAdded: roundPoints(existing.totalAdded + totalAmount),
    transactions: [transaction, ...(existing.transactions || [])].slice(0, MAX_CREDIT_TRANSACTIONS),
    updatedTimestamp: nowTimestamp,
    updatedTime: formatDate(nowTimestamp)
  };
  const remainingCredits = credits.filter((credit) => credit.userId !== source.userId);

  writeCredits([updatedCredit, ...remainingCredits]);
  return {
    credit: updatedCredit,
    transaction
  };
}

function getUserActiveWounds(userId) {
  if (!userId) return [];

  return readWounds().filter(
    (wound) =>
      wound.status === 'active' &&
      (wound.openerUserId === userId || wound.accepterUserId === userId)
  );
}

function getWoundAmount(wound) {
  return parsePositiveAmount(wound?.amount);
}

function getWoundReservedCredit(wound) {
  const requiredCredit = Number(wound?.requiredCredit);
  return Number.isFinite(requiredCredit) && requiredCredit > 0 ? requiredCredit : getWoundAmount(wound);
}

function getCreditSnapshot(userId) {
  const credit = findCreditByUserId(userId);
  const activeWounds = getUserActiveWounds(userId);
  const activeWoundAmount = roundPoints(activeWounds.reduce((sum, wound) => sum + getWoundReservedCredit(wound), 0));
  const withdrawableBalance = Math.max(0, roundPoints(credit.balance - activeWoundAmount));

  return {
    credit,
    activeWounds,
    activeWoundAmount,
    withdrawableBalance
  };
}

function updateCreditForCompletedWithdrawal(withdrawal, nowTimestamp = Date.now()) {
  const credits = readCredits();
  const existing = credits.find((credit) => credit.userId === withdrawal.userId);
  if (!existing) {
    return { success: false, status: 404, error: 'ไม่พบผู้ใช้เครดิต' };
  }

  const amount = roundPoints(withdrawal.amount);
  const snapshot = getCreditSnapshot(withdrawal.userId);
  if (snapshot.withdrawableBalance < amount) {
    return { success: false, status: 400, error: 'ยอดเครดิตไม่พอสำหรับถอน' };
  }

  const nextBalance = roundPoints(existing.balance - amount);
  const transaction = {
    id: `${withdrawal.id}:completed`,
    type: 'withdrawal_completed',
    amount: -amount,
    rawText: `Withdrawal completed ${withdrawal.id}`,
    withdrawalId: withdrawal.id,
    displayName: withdrawal.displayName || '',
    bankName: withdrawal.bankName || '',
    accountNumber: withdrawal.accountNumber || '',
    balanceAfter: nextBalance,
    timestamp: nowTimestamp,
    time: formatDate(nowTimestamp)
  };
  const updatedCredit = {
    ...existing,
    balance: nextBalance,
    transactions: [transaction, ...(existing.transactions || [])].slice(0, MAX_CREDIT_TRANSACTIONS),
    updatedTimestamp: nowTimestamp,
    updatedTime: formatDate(nowTimestamp)
  };

  writeCredits([updatedCredit, ...credits.filter((credit) => credit.userId !== withdrawal.userId)]);
  return { success: true, credit: updatedCredit, transaction };
}

function removeWithdrawalById(withdrawalId) {
  const withdrawals = readWithdrawals();
  const nextWithdrawals = withdrawals.filter((withdrawal) => withdrawal.id !== withdrawalId);
  if (nextWithdrawals.length !== withdrawals.length) {
    writeWithdrawals(nextWithdrawals);
  }
}

function parsePositiveAmount(value) {
  const amount = Number(String(value || '').replace(/[^\d.]/g, ''));
  return Number.isFinite(amount) && amount > 0 ? roundPoints(amount) : 0;
}

function getTradeStakeAmount(trade) {
  return parsePositiveAmount(trade?.amount);
}

function formatStakeAmount(amount) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) return '';
  return Number.isInteger(value) ? String(value) : String(roundPoints(value));
}

function getActiveWoundsForTrade(wounds, groupId, roundId, openMessageId) {
  return wounds.filter(
    (wound) =>
      wound.status === 'active' &&
      wound.groupId === groupId &&
      wound.roundId === roundId &&
      wound.openMessageId === openMessageId
  );
}

function withAcceptedStakeAmount(trade, acceptedStakeAmount) {
  const amount = formatStakeAmount(acceptedStakeAmount);
  return amount ? { ...trade, amount } : trade;
}

function resolveAcceptedTradeForPair(trade, acceptAmount, wounds, groupId, roundId, openMessageId, accepterUserId = '') {
  const requestedStake = parsePositiveAmount(acceptAmount);
  const totalStake = getTradeStakeAmount(trade);
  const activeWounds = getActiveWoundsForTrade(wounds, groupId, roundId, openMessageId);
  const existingPairWound = activeWounds.find((wound) => wound.accepterUserId === accepterUserId);

  if (existingPairWound) {
    return {
      reason: 'already_paired',
      acceptedStake: 0,
      remainingStake: 0,
      trade,
      requiredCredit: getRequiredCreditFromTrade(trade),
      existingWoundId: existingPairWound.id
    };
  }

  if (totalStake <= 0) {
    const acceptedTrade = withAcceptedStakeAmount(trade, requestedStake);
    return {
      reason: '',
      acceptedStake: requestedStake,
      remainingStake: 0,
      trade: acceptedTrade,
      requiredCredit: getRequiredCreditFromTrade(acceptedTrade),
      existingWoundId: ''
    };
  }

  const acceptedStake = requestedStake > 0 ? requestedStake : totalStake;
  if (acceptedStake > totalStake) {
    const acceptedTrade = withAcceptedStakeAmount(trade, acceptedStake);
    return {
      reason: 'amount_exceeds_remaining',
      acceptedStake,
      remainingStake: totalStake,
      trade: acceptedTrade,
      requiredCredit: getRequiredCreditFromTrade(acceptedTrade),
      existingWoundId: ''
    };
  }

  const acceptedTrade = withAcceptedStakeAmount(trade, acceptedStake);
  return {
    reason: '',
    acceptedStake,
    remainingStake: totalStake,
    trade: acceptedTrade,
    requiredCredit: getRequiredCreditFromTrade(acceptedTrade),
    existingWoundId: ''
  };
}

function isSlipTransRefUsed(transRef) {
  if (!transRef) return false;
  return readCredits().some((credit) =>
    (credit.transactions || []).some((transaction) => transaction.slipTransRef === transRef)
  );
}

async function reserveSlipTransRef(slipData, event, amount) {
  const transRef = getSlipTransRef(slipData);
  if (!transRef) return false;

  if (!mongoConnected || !mongoDb) {
    if (isSlipTransRefUsed(transRef) || jsonReservedSlipTransRefs.has(transRef)) {
      return false;
    }

    jsonReservedSlipTransRefs.add(transRef);
    return true;
  }

  try {
    await mongoDb.collection(MONGO_SLIP_COLLECTION).insertOne({
      transRef,
      amount,
      userId: event.source?.userId || '',
      messageId: event.message?.id || '',
      receiverBank: slipData?.rawSlip?.receiver?.bank?.short || slipData?.receiver?.bank?.short || '',
      timestamp: event.timestamp || Date.now(),
      time: formatDate(event.timestamp || Date.now()),
      createdAt: new Date()
    });
    return true;
  } catch (error) {
    if (error?.code === 11000) {
      return false;
    }

    throw error;
  }
}

function releaseJsonSlipTransRefReservation(transRef) {
  if (transRef && (!mongoConnected || !mongoDb)) {
    jsonReservedSlipTransRefs.delete(transRef);
  }
}

function getSlipTransRef(slipData) {
  return String(slipData?.rawSlip?.transRef || slipData?.transRef || '').trim();
}

function getSlipAmount(slipData) {
  const amount = Number(
    slipData?.rawSlip?.amount?.amount ??
      slipData?.amount?.amount ??
      slipData?.amount ??
      0
  );

  return Number.isFinite(amount) && amount > 0 ? roundPoints(amount) : 0;
}

function getRequiredCreditFromTrade(trade) {
  const amount = getTradeStakeAmount(trade);
  if (amount <= 0) return 0;

  const reserveMultiplier = trade?.fallbackNoBuilder ? 2 : 1;
  return roundPoints(amount * reserveMultiplier);
}

function getPredictionLabels(side) {
  if (side === 'chang_dai') {
    return {
      openerPrediction: 'ทายชนะ',
      accepterPrediction: 'ทายแพ้'
    };
  }

  if (side === 'chang_yang') {
    return {
      openerPrediction: 'ทายแพ้',
      accepterPrediction: 'ทายชนะ'
    };
  }

  if (side === 'number_ma') {
    return {
      openerPrediction: 'ทายมา',
      accepterPrediction: 'ทายไม่มา'
    };
  }

  return {
    openerPrediction: '',
    accepterPrediction: ''
  };
}

function getNumberMaWinningSide(result, price) {
  if (!isNumericResult(result) || !price) return '';

  const resultNumber = Number(result);
  if (!Number.isFinite(resultNumber)) return '';
  return resultNumber >= price.low && resultNumber <= price.high ? 'number_ma' : 'number_not_ma';
}

function getSettlementPriceForWound(wound, round) {
  return parseSettlementPrice(wound?.priceRaw) || getRoundPrice(round);
}

function getWinningSide(result, price) {
  if (!isNumericResult(result) || !price) return '';

  const resultNumber = Number(result);
  if (!Number.isFinite(resultNumber)) return '';
  if (resultNumber > price.high) return 'chang_dai';
  if (resultNumber < price.low) return 'chang_yang';
  return 'draw';
}

function buildWoundSettlement(wound, result, round) {
  const builderPrice = getRoundPrice(round);
  const cancelsByBuilderHit = Boolean(wound?.fallbackNoBuilder && builderPrice);
  const price = cancelsByBuilderHit ? builderPrice : getSettlementPriceForWound(wound, round);
  const winningSide = cancelsByBuilderHit
    ? ''
    : wound?.side === 'number_ma'
      ? getNumberMaWinningSide(result, price)
      : getWinningSide(result, price);
  const stakeAmount = roundPoints(getWoundAmount(wound));
  const baseSettlement = {
    priceRawUsed: price?.raw || '',
    priceLow: price?.low ?? null,
    priceHigh: price?.high ?? null,
    stakeAmount,
    winningSide,
    winnerUserId: '',
    loserUserId: '',
    winnerPayoutAmount: 0,
    systemFeeAmount: 0
  };

  if (cancelsByBuilderHit) {
    return {
      ...baseSettlement,
      settlementStatus: 'cancelled_no_builder_fallback'
    };
  }

  if (!winningSide) {
    return {
      ...baseSettlement,
      settlementStatus: 'unsettled'
    };
  }

  if (winningSide === 'draw' || stakeAmount <= 0) {
    return {
      ...baseSettlement,
      settlementStatus: 'draw'
    };
  }

  const openerWon = wound.side === winningSide;
  const winnerUserId = openerWon ? wound.openerUserId : wound.accepterUserId;
  const loserUserId = openerWon ? wound.accepterUserId : wound.openerUserId;
  const winnerPayoutAmount = roundPoints(stakeAmount * WIN_PAYOUT_RATE);

  return {
    ...baseSettlement,
    settlementStatus: 'settled',
    winnerUserId,
    loserUserId,
    winnerPayoutAmount,
    systemFeeAmount: roundPoints(stakeAmount - winnerPayoutAmount)
  };
}

function getCreditRowFromMap(creditMap, userId) {
  if (!creditMap.has(userId)) {
    creditMap.set(userId, {
      userId,
      balance: 0,
      totalAdded: 0,
      transactions: []
    });
  }

  return creditMap.get(userId);
}

function appendCreditTransaction(credit, transaction) {
  return {
    ...credit,
    balance: transaction.balanceAfter,
    transactions: [transaction, ...(credit.transactions || [])].slice(0, MAX_CREDIT_TRANSACTIONS),
    updatedTimestamp: transaction.timestamp,
    updatedTime: transaction.time
  };
}

function applySettlementCredits(settlements, nowTimestamp) {
  const creditMap = new Map(readCredits().map((credit) => [credit.userId, credit]));
  let changed = false;

  for (const settlement of settlements) {
    if (settlement.settlementStatus !== 'settled') continue;

    const time = formatDate(nowTimestamp);
    const winner = getCreditRowFromMap(creditMap, settlement.winnerUserId);
    const loser = getCreditRowFromMap(creditMap, settlement.loserUserId);
    const winnerBalance = roundPoints(winner.balance + settlement.winnerPayoutAmount);
    const loserBalance = roundPoints(loser.balance - settlement.stakeAmount);

    creditMap.set(settlement.winnerUserId, appendCreditTransaction(winner, {
      id: `${settlement.woundId}:winner:${nowTimestamp}`,
      type: 'wound_won',
      amount: settlement.winnerPayoutAmount,
      stakeAmount: settlement.stakeAmount,
      feeAmount: settlement.systemFeeAmount,
      woundId: settlement.woundId,
      orderId: settlement.orderId,
      opponentUserId: settlement.loserUserId,
      result: settlement.result,
      balanceAfter: winnerBalance,
      timestamp: nowTimestamp,
      time
    }));

    creditMap.set(settlement.loserUserId, appendCreditTransaction(loser, {
      id: `${settlement.woundId}:loser:${nowTimestamp}`,
      type: 'wound_lost',
      amount: -settlement.stakeAmount,
      stakeAmount: settlement.stakeAmount,
      feeAmount: settlement.systemFeeAmount,
      woundId: settlement.woundId,
      orderId: settlement.orderId,
      opponentUserId: settlement.winnerUserId,
      result: settlement.result,
      balanceAfter: loserBalance,
      timestamp: nowTimestamp,
      time
    }));

    changed = true;
  }

  if (changed) {
    writeCredits([...creditMap.values()]);
  }
}

function flexText(text, options = {}) {
  return {
    type: 'text',
    text: String(text),
    wrap: true,
    ...options
  };
}

function flexRow(label, value, valueColor = '#111827') {
  return {
    type: 'box',
    layout: 'horizontal',
    spacing: 'md',
    contents: [
      flexText(label, { size: 'sm', color: '#9CA3AF', flex: 4 }),
      flexText(value, { size: 'sm', color: valueColor, weight: 'bold', align: 'end', flex: 6 })
    ]
  };
}

function flexPostbackButton(label, data, color = '#374151') {
  return {
    type: 'button',
    style: 'secondary',
    color,
    height: 'sm',
    action: {
      type: 'postback',
      label,
      data,
      displayText: label
    }
  };
}

function flexUriButton(label, uri, color = '#374151') {
  return {
    type: 'button',
    style: 'primary',
    color,
    height: 'sm',
    action: {
      type: 'uri',
      label,
      uri
    }
  };
}

function buildCreditBubble({
  title,
  titleColor,
  bodyColor,
  amount,
  subtitle,
  detailText = '',
  rows,
  footer,
  actionButtons = []
}) {
  const amountContents = [
    flexText(subtitle, { color: '#9CA3AF', align: 'center', size: 'sm' }),
    flexText(amount, { color: bodyColor, align: 'center', weight: 'bold', size: '4xl' })
  ];

  if (detailText) {
    amountContents.push(flexText(detailText, { color: '#B7B7B7', align: 'center', size: 'sm' }));
  }

  return {
    type: 'bubble',
    size: 'mega',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: titleColor,
      paddingAll: '16px',
      contents: [
        flexText(title, { color: '#FFFFFF', weight: 'bold', size: 'lg' })
      ]
    },
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'md',
      paddingAll: '18px',
      contents: [
        ...amountContents,
        {
          type: 'separator',
          margin: 'lg'
        },
        ...rows,
        ...(footer ? [flexText(footer, { color: '#C7C7C7', align: 'center', size: 'xs', margin: 'md' })] : []),
        ...actionButtons
      ]
    }
  };
}

function buildCreditAddedFlex(amount, snapshot) {
  return {
    type: 'flex',
    altText: `เพิ่มเครดิตสำเร็จ +${formatPoints(amount)}`,
    contents: buildCreditBubble({
      title: '✓ สลิปถูกต้อง',
      titleColor: '#22C55E',
      bodyColor: '#111827',
      subtitle: 'ตรวจสอบโดยระบบ',
      amount: formatPoints(amount),
      rows: [
        flexRow('เครดิตที่ได้รับ', `+${formatPoints(amount)}`, '#22C55E'),
        flexRow('ยอดคงเหลือ', formatPoints(snapshot.credit.balance)),
        flexRow('กำลังใช้', formatPoints(snapshot.activeWoundAmount), '#F59E0B')
      ],
      footer: 'ส่งเมนูเพื่อดูยอดหรือแผลที่กำลังติด'
    })
  };
}

function buildManualCreditAddedFlex(amount, snapshot) {
  return {
    type: 'flex',
    altText: `เติมเครดิตสำเร็จ +${formatPoints(amount)}`,
    contents: buildCreditBubble({
      title: '✓ เติมเครดิตสำเร็จ',
      titleColor: '#22C55E',
      bodyColor: '#111827',
      subtitle: 'เติมโดยแอดมิน',
      amount: formatPoints(amount),
      rows: [
        flexRow('เครดิตที่ได้รับ', `+${formatPoints(amount)}`, '#22C55E'),
        flexRow('ยอดคงเหลือ', formatPoints(snapshot.credit.balance)),
        flexRow('กำลังใช้', formatPoints(snapshot.activeWoundAmount), '#F59E0B')
      ],
      footer: 'ส่งเมนูเพื่อดูยอดหรือแผลที่กำลังติด'
    })
  };
}

function buildSlipStatusText(text) {
  return {
    type: 'text',
    text
  };
}

function buildBalanceFlex(snapshot) {
  return {
    type: 'flex',
    altText: `ยอดคงเหลือ ${formatPoints(snapshot.credit.balance)}`,
    contents: buildCreditBubble({
      title: '💰 ยอดเงินของคุณ',
      titleColor: '#3B82F6',
      bodyColor: '#3B82F6',
      subtitle: 'ยอดคงเหลือ',
      amount: formatPoints(snapshot.credit.balance),
      rows: [
        flexRow('กำลังใช้', formatPoints(snapshot.activeWoundAmount), '#F59E0B'),
        flexRow('ถอนได้', formatPoints(snapshot.withdrawableBalance), '#111827'),
        flexRow('จำนวนแผล', `${snapshot.activeWounds.length} รายการ`, '#F59E0B')
      ],
      footer: 'ตรวจสอบโดยระบบ'
    })
  };
}

function buildActiveWoundsFlex(snapshot) {
  const woundRows = snapshot.activeWounds.slice(0, 5).map((wound) => {
    const isOpener = wound.openerUserId === snapshot.credit.userId;
    const opponentName = normalizeDisplayName(isOpener ? wound.accepterDisplayName : wound.openerDisplayName);
    const label = wound.roundName || wound.groupId || 'รายการ';
    const value = opponentName
      ? `vs ${opponentName} ${formatPoints(getWoundAmount(wound))}`
      : formatPoints(getWoundAmount(wound));

    return flexRow(`#${String(wound.id || '').slice(-6)} ${label}`, value, '#F59E0B');
  });

  return {
    type: 'flex',
    altText: `แผลที่กำลังติด ${snapshot.activeWounds.length} รายการ`,
    contents: buildCreditBubble({
      title: '📋 จับคู่อยู่',
      titleColor: '#F59E0B',
      bodyColor: '#F59E0B',
      subtitle: 'กำลังใช้อยู่',
      amount: formatPoints(snapshot.activeWoundAmount),
      rows: woundRows.length > 0
        ? [
            flexRow('รวม', `${snapshot.activeWounds.length} รายการ`, '#F59E0B'),
            ...woundRows
          ]
        : [
            flexRow('รวม', '0 รายการ', '#F59E0B'),
            flexText('ไม่มีรายการที่ค้างอยู่', { color: '#9CA3AF', align: 'center' })
          ],
      footer: ''
    })
  };
}

function buildWithdrawFlex(snapshot) {
  return {
    type: 'flex',
    altText: `ถอนยอดเงินได้ ${formatPoints(snapshot.withdrawableBalance)}`,
    contents: buildCreditBubble({
      title: '🏧 ถอนยอดเงิน',
      titleColor: '#EF4444',
      bodyColor: '#EF4444',
      subtitle: 'ยอดที่ถอนได้',
      amount: formatPoints(snapshot.withdrawableBalance),
      rows: [
        flexRow('ยอดคงเหลือ', formatPoints(snapshot.credit.balance)),
        flexRow('กำลังใช้', formatPoints(snapshot.activeWoundAmount), '#F59E0B'),
        flexRow('แผลที่ค้าง', `${snapshot.activeWounds.length} รายการ`, '#EF4444')
      ],
      footer: 'ยอดถอนได้ = ยอดคงเหลือ - ยอดที่กำลังใช้อยู่'
    })
  };
}

function buildWithdrawalClosedFlex(snapshot) {
  return {
    type: 'flex',
    altText: 'ยังไม่ถึงเวลาเปิดถอนเครดิต',
    contents: buildCreditBubble({
      title: '⏰ ยังไม่เปิดถอน',
      titleColor: '#F59E0B',
      bodyColor: '#F59E0B',
      subtitle: 'ยอดที่ถอนได้',
      amount: formatPoints(snapshot.withdrawableBalance),
      rows: [
        flexRow('เวลาเปิดถอน', '18:00-08:00 น.', '#F59E0B'),
        flexRow('ยอดคงเหลือ', formatPoints(snapshot.credit.balance)),
        flexRow('กำลังใช้', formatPoints(snapshot.activeWoundAmount), '#F59E0B'),
        flexRow('แผลที่ค้าง', `${snapshot.activeWounds.length} รายการ`, '#EF4444')
      ],
      footer: 'เปิดให้ส่งคำขอถอนหลัง 18:00 ถึง 08:00 น. เท่านั้น'
    })
  };
}

function buildWithdrawalRequestFlex(snapshot, formUrl) {
  return {
    type: 'flex',
    altText: `กรอกข้อมูลถอนเครดิต ${formatPoints(snapshot.withdrawableBalance)}`,
    contents: buildCreditBubble({
      title: '🏧 ถอนเครดิต',
      titleColor: '#EF4444',
      bodyColor: '#EF4444',
      subtitle: 'ยอดที่ถอนได้',
      amount: formatPoints(snapshot.withdrawableBalance),
      rows: [
        flexRow('ยอดคงเหลือ', formatPoints(snapshot.credit.balance)),
        flexRow('กำลังใช้', formatPoints(snapshot.activeWoundAmount), '#F59E0B'),
        flexRow('แผลที่ค้าง', `${snapshot.activeWounds.length} รายการ`, '#EF4444')
      ],
      footer: 'กรอกข้อมูลธนาคาร เลขบัญชี และยอดถอน',
      actionButtons: [
        flexUriButton('กรอกข้อมูลถอนเงิน', formUrl, '#EF4444')
      ]
    })
  };
}

function buildWithdrawalPendingFlex(withdrawal, snapshot) {
  return {
    type: 'flex',
    altText: `มีรายการถอนที่รอดำเนินการ ${formatPoints(withdrawal.amount)}`,
    contents: buildCreditBubble({
      title: '⏳ รอดำเนินการ',
      titleColor: '#F59E0B',
      bodyColor: '#F59E0B',
      subtitle: 'รายการถอนของคุณ',
      amount: formatPoints(withdrawal.amount),
      rows: [
        flexRow('ธนาคาร', withdrawal.bankName || '-'),
        flexRow('เลขบัญชี', withdrawal.accountNumber || '-'),
        flexRow('ถอนได้ตอนนี้', formatPoints(snapshot.withdrawableBalance)),
        flexRow('สถานะ', 'รอแอดมินดำเนินการ', '#F59E0B')
      ],
      footer: 'ส่งคำขอถอนใหม่ได้หลังจากแอดมินเสร็จสิ้นหรือยกเลิกรายการนี้'
    })
  };
}

function buildWithdrawalCompletedFlex(withdrawal, credit) {
  return {
    type: 'flex',
    altText: `ถอนเครดิตสำเร็จ ${formatPoints(withdrawal.amount)}`,
    contents: buildCreditBubble({
      title: '✓ ถอนเครดิตสำเร็จ',
      titleColor: '#22C55E',
      bodyColor: '#111827',
      subtitle: 'ยอดที่ถอน',
      amount: formatPoints(withdrawal.amount),
      rows: [
        flexRow('ธนาคาร', withdrawal.bankName || '-'),
        flexRow('เลขบัญชี', withdrawal.accountNumber || '-'),
        flexRow('ยอดคงเหลือ', formatPoints(credit.balance))
      ],
      footer: 'แอดมินทำรายการเสร็จสิ้นแล้ว'
    })
  };
}

function buildWithdrawalCancelledFlex(withdrawal) {
  return {
    type: 'flex',
    altText: `ยกเลิกถอนเครดิต ${formatPoints(withdrawal.amount)}`,
    contents: buildCreditBubble({
      title: '✕ ยกเลิกถอนเครดิต',
      titleColor: '#EF4444',
      bodyColor: '#EF4444',
      subtitle: 'ยอดที่ขอถอน',
      amount: formatPoints(withdrawal.amount),
      rows: [
        flexRow('ธนาคาร', withdrawal.bankName || '-'),
        flexRow('เลขบัญชี', withdrawal.accountNumber || '-'),
        flexRow('เหตุผล', withdrawal.cancelReason || '-')
      ],
      footer: 'กรุณาตรวจสอบข้อมูลแล้วส่งคำขอใหม่'
    })
  };
}

function getBangkokHour(timestamp = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Bangkok',
    hour: '2-digit',
    hour12: false
  }).formatToParts(new Date(timestamp));
  const hour = Number(parts.find((part) => part.type === 'hour')?.value);
  return Number.isFinite(hour) ? hour : 0;
}

function isWithdrawalRequestOpen(timestamp = Date.now()) {
  const hour = getBangkokHour(timestamp);
  return hour >= WITHDRAWAL_OPEN_HOUR || hour < WITHDRAWAL_CLOSE_HOUR;
}

function buildWoundPostbackData(action, woundId, extras = {}) {
  const params = new URLSearchParams({
    action,
    woundId,
    ...extras
  });

  return params.toString();
}

function buildPairSuccessFlex(wound, viewerUserId) {
  const openerName = normalizeDisplayName(wound.openerDisplayName) || 'ผู้เปิด';
  const accepterName = normalizeDisplayName(wound.accepterDisplayName) || 'ผู้รับ';
  const openerPrediction = wound.openerPrediction || '-';
  const accepterPrediction = wound.accepterPrediction || '-';
  const openerPredictionColor = ['ทายชนะ', 'ทายมา'].includes(openerPrediction) ? '#22C55E' : '#EF4444';
  const accepterPredictionColor = ['ทายชนะ', 'ทายมา'].includes(accepterPrediction) ? '#22C55E' : '#EF4444';
  const rows = [
    flexRow(openerName, openerPrediction, openerPredictionColor),
    flexRow(accepterName, accepterPrediction, accepterPredictionColor),
    {
      type: 'separator',
      margin: 'sm'
    },
    flexRow('ทีม', wound.roundName || '-'),
    flexRow('สถานะ', '✅ ยืนยันแล้ว', '#22C55E')
  ];

  return {
    type: 'flex',
    altText: `จับคู่สำเร็จ ${formatPoints(wound.requiredCredit || getWoundAmount(wound))}`,
    contents: buildCreditBubble({
      title: '✓ จับคู่สำเร็จ',
      titleColor: '#22C55E',
      bodyColor: '#111827',
      subtitle: getWoundPriceSubtitle(wound),
      amount: formatPoints(wound.requiredCredit || getWoundAmount(wound)),
      detailText: wound.openedTime || '',
      rows,
      footer: 'รอผลการแข่งขัน 🍀',
      actionButtons:
        wound.status === 'active'
          ? [flexPostbackButton('แตะเพื่อยกเลิก', buildWoundPostbackData('wound_cancel_request', wound.id), '#F472B6')]
          : []
    })
  };
}

function buildPairSuccessText(wound, viewerUserId) {
  const amount = formatPoints(wound.requiredCredit || getWoundAmount(wound));
  const opponentName = getWoundOpponentName(wound, viewerUserId) || '-';

  return [
    '✅ จับคู่สำเร็จ',
    `รายการ: ${wound.roundName || '-'}`,
    `ยอด: ${amount}`,
    `คู่: ${opponentName}`,
    'พิมพ์ "แผลที่กำลังติด" เพื่อดูแผลที่ติดอยู่'
  ].join('\n');
}

function isLineMonthlyLimitError(status, errorText) {
  return status === 429 && /monthly limit/i.test(String(errorText || ''));
}

function getWoundParticipantName(wound, userId) {
  if (userId === wound.openerUserId) return normalizeDisplayName(wound.openerDisplayName) || 'ผู้เปิด';
  if (userId === wound.accepterUserId) return normalizeDisplayName(wound.accepterDisplayName) || 'ผู้รับ';
  return '';
}

function getWoundOpponentUserId(wound, userId) {
  if (userId === wound.openerUserId) return wound.accepterUserId || '';
  if (userId === wound.accepterUserId) return wound.openerUserId || '';
  return '';
}

function getWoundOpponentName(wound, userId) {
  return getWoundParticipantName(wound, getWoundOpponentUserId(wound, userId));
}

function getViewerSettlement(wound, viewerUserId) {
  const stakeAmount = roundPoints(wound.stakeAmount || getWoundAmount(wound));

  if (wound.settlementStatus === 'cancelled_no_builder_fallback') {
    return {
      label: 'ยกเลิก',
      amount: 0,
      color: '#EF4444',
      icon: '❌',
      title: `❌ ยกเลิกแผล "${wound.roundName || '-'}"`,
      detail: 'ช่างตีแล้ว แผลนี้ยกเลิกอัตโนมัติ'
    };
  }

  if (wound.settlementStatus === 'draw') {
    return {
      label: 'เสมอ',
      amount: 0,
      color: '#F59E0B',
      icon: '➖',
      title: `➖ ผลรอบ "${wound.roundName || '-'}"`,
      detail: 'เสมอ คืนยอด'
    };
  }

  if (wound.winnerUserId === viewerUserId) {
    const payout = roundPoints(wound.winnerPayoutAmount || stakeAmount * WIN_PAYOUT_RATE);
    return {
      label: 'ชนะ',
      amount: payout,
      color: '#22C55E',
      icon: '✅',
      title: `🎉 ผลรอบ "${wound.roundName || '-'}"`,
      detail: `+${formatPoints(stakeAmount)} -5% = +${formatPoints(payout)}`
    };
  }

  if (wound.loserUserId === viewerUserId) {
    return {
      label: 'แพ้',
      amount: -stakeAmount,
      color: '#EF4444',
      icon: '❌',
      title: `😢 ผลรอบ "${wound.roundName || '-'}"`,
      detail: `-${formatPoints(stakeAmount)}`
    };
  }

  return {
    label: '-',
    amount: 0,
    color: '#6B7280',
    icon: '',
    title: `ผลรอบ "${wound.roundName || '-'}"`,
    detail: '-'
  };
}

function formatSignedPoints(value) {
  const amount = roundPoints(value);
  if (amount > 0) return `+${formatPoints(amount)}`;
  if (amount < 0) return `-${formatPoints(Math.abs(amount))}`;
  return formatPoints(0);
}

function getWoundPriceText(wound) {
  const priceText = wound.priceRawUsed || wound.priceRaw || wound.openingPriceRaw || '';
  if (priceText) return formatIntegerGroupsInText(priceText);
  if (wound.noBuilderPrice || wound.fallbackNoBuilder || wound.openingNoBuilderPrice) return 'ช่างไม่ต่อย';
  return '-';
}

function getWoundPriceSubtitle(wound) {
  const priceText = getWoundPriceText(wound);
  return priceText === '-' ? 'รอราคาช่าง' : `ราคา ${priceText}`;
}

function buildWoundResultFlex(wound, viewerUserId) {
  const settlement = getViewerSettlement(wound, viewerUserId);
  const credit = findCreditByUserId(viewerUserId);
  const opponentName = getWoundOpponentName(wound, viewerUserId);
  const isOpener = viewerUserId === wound.openerUserId;
  const viewerPrediction = isOpener ? wound.openerPrediction : wound.accepterPrediction;
  const priceText = getWoundPriceText(wound);
  const rows = [
    flexRow(`ผลออก ${wound.result || '-'}`, settlement.label, settlement.color),
    flexRow(
      `${settlement.icon} ${settlement.label} vs ${opponentName || '-'}`,
      formatSignedPoints(settlement.amount),
      settlement.color
    ),
    flexText(`คุณทาย: ${viewerPrediction || '-'} | ราคา: ${priceText}`, {
      color: '#9CA3AF',
      size: 'xs',
      weight: 'bold'
    })
  ];

  if (settlement.amount > 0) {
    rows.push(flexText(settlement.detail, { color: settlement.color, size: 'xs', weight: 'bold', align: 'end' }));
  }

  rows.push(
    {
      type: 'separator',
      margin: 'md'
    }
  );

  rows.push(flexRow('คงเหลือ', formatPoints(credit.balance)));

  return {
    type: 'flex',
    altText: `${settlement.title} ${formatSignedPoints(settlement.amount)}`,
    contents: buildCreditBubble({
      title: settlement.title,
      titleColor: settlement.color,
      bodyColor: settlement.color,
      subtitle: settlement.label === 'ยกเลิก'
        ? 'ช่างตี แผลยกเลิก'
        : settlement.amount < 0
          ? 'คุณเสียเครดิต'
          : settlement.amount > 0
            ? 'คุณได้รับเครดิต'
            : 'เสมอ',
      amount: formatSignedPoints(settlement.amount),
      rows,
      footer: ''
    })
  };
}

function buildCancelRequestFlex(wound, requesterUserId) {
  const requesterName = getWoundParticipantName(wound, requesterUserId);
  return {
    type: 'flex',
    altText: `ขอยกเลิกแผล Order #${wound.orderId}`,
    contents: buildCreditBubble({
      title: '⚠️ ขอยกเลิกแผล',
      titleColor: '#F59E0B',
      bodyColor: '#F59E0B',
      subtitle: `Order #${wound.orderId}`,
      amount: formatPoints(wound.requiredCredit || getWoundAmount(wound)),
      rows: [
        flexRow('รายการ', wound.roundName || '-'),
        flexRow('ผู้ขอ', requesterName || '-'),
        flexRow('สถานะ', 'รอคู่ตัดสินใจ', '#F59E0B')
      ],
      footer: 'เลือกว่าจะยกเลิกหรือไม่ยกเลิก',
      actionButtons: [
        flexPostbackButton('ยกเลิก', buildWoundPostbackData('wound_cancel_decision', wound.id, { decision: 'approve' }), '#EF4444'),
        flexPostbackButton('ไม่ยกเลิก', buildWoundPostbackData('wound_cancel_decision', wound.id, { decision: 'reject' }), '#374151')
      ]
    })
  };
}

function buildCancelStatusFlex(wound, title, titleColor, statusText) {
  return {
    type: 'flex',
    altText: `${title} Order #${wound.orderId}`,
    contents: buildCreditBubble({
      title,
      titleColor,
      bodyColor: titleColor,
      subtitle: `Order #${wound.orderId}`,
      amount: formatPoints(wound.requiredCredit || getWoundAmount(wound)),
      rows: [
        flexRow('รายการ', wound.roundName || '-'),
        flexRow('สถานะ', statusText, titleColor)
      ],
      footer: ''
    })
  };
}

function handleCreditEvent(event, publicBaseUrl = '') {
  if (event.type !== 'message' || event.message?.type !== 'text' || !event.source?.userId) {
    return null;
  }

  const source = event.source || {};
  const messageText = getMessageText(event);

  if (source.type !== 'user') {
    return null;
  }

  const userBlacklisted = isUserBlacklistedAnywhere(source.userId);

  if (parsePaymentAccountKeyword(messageText)) {
    if (userBlacklisted) {
      return null;
    }

    return {
      type: 'payment_account',
      replyMessages: [
        buildBehindHousePaymentText(),
        ...(LINE_OFFICIAL_ACCOUNT_URL ? [buildBehindHouseFlex(LINE_OFFICIAL_ACCOUNT_URL)] : [])
      ]
    };
  }

  const keyword = parseCreditKeyword(messageText);
  if (!keyword) return null;

  const snapshot = getCreditSnapshot(source.userId);
  if (keyword === 'balance') {
    return {
      type: 'balance_card',
      creditBalance: snapshot.credit.balance,
      activeWoundAmount: snapshot.activeWoundAmount,
      withdrawableBalance: snapshot.withdrawableBalance,
      activeWoundCount: snapshot.activeWounds.length,
      replyMessages: [buildBalanceFlex(snapshot)]
    };
  }

  if (keyword === 'active_wounds') {
    return {
      type: 'active_wounds_card',
      creditBalance: snapshot.credit.balance,
      activeWoundAmount: snapshot.activeWoundAmount,
      withdrawableBalance: snapshot.withdrawableBalance,
      activeWoundCount: snapshot.activeWounds.length,
      replyMessages: [buildActiveWoundsFlex(snapshot)]
    };
  }

  if (keyword === 'withdraw') {
    if (userBlacklisted) {
      return {
        type: 'blacklisted_withdraw_blocked',
        creditBalance: snapshot.credit.balance,
        activeWoundAmount: snapshot.activeWoundAmount,
        withdrawableBalance: snapshot.withdrawableBalance,
        activeWoundCount: snapshot.activeWounds.length,
        replyMessages: [buildBlacklistedWithdrawBlockedText()]
      };
    }

    if (!isWithdrawalRequestOpen(event.timestamp || Date.now())) {
      return {
        type: 'withdraw_closed',
        creditBalance: snapshot.credit.balance,
        activeWoundAmount: snapshot.activeWoundAmount,
        withdrawableBalance: snapshot.withdrawableBalance,
        activeWoundCount: snapshot.activeWounds.length,
        replyMessages: [buildWithdrawalClosedFlex(snapshot)]
      };
    }

    const pendingWithdrawal = getPendingWithdrawalForUser(source.userId);
    if (pendingWithdrawal) {
      return {
        type: 'withdraw_pending',
        creditBalance: snapshot.credit.balance,
        activeWoundAmount: snapshot.activeWoundAmount,
        withdrawableBalance: snapshot.withdrawableBalance,
        activeWoundCount: snapshot.activeWounds.length,
        withdrawalId: pendingWithdrawal.id,
        replyMessages: [buildWithdrawalPendingFlex(pendingWithdrawal, snapshot)]
      };
    }

    const token = createWithdrawalRequestToken(source.userId);
    const formUrl = `${String(publicBaseUrl || '').replace(/\/+$/, '')}/withdraw/request?token=${encodeURIComponent(token)}`;

    return {
      type: 'withdraw_form',
      creditBalance: snapshot.credit.balance,
      activeWoundAmount: snapshot.activeWoundAmount,
      withdrawableBalance: snapshot.withdrawableBalance,
      activeWoundCount: snapshot.activeWounds.length,
      replyMessages: [buildWithdrawalRequestFlex(snapshot, formUrl)]
    };
  }

  return {
    type: 'withdraw_card',
    creditBalance: snapshot.credit.balance,
    activeWoundAmount: snapshot.activeWoundAmount,
    withdrawableBalance: snapshot.withdrawableBalance,
    activeWoundCount: snapshot.activeWounds.length,
    replyMessages: [buildWithdrawFlex(snapshot)]
  };
}

async function handleSlipCreditEvent(event) {
  if (event.type !== 'message' || event.message?.type !== 'image' || event.source?.type !== 'user' || !event.source?.userId) {
    return null;
  }
  let reservedSlipTransRef = '';
  let creditAddedFromReservedSlip = false;

  if (!event.message?.id) {
    return {
      type: 'slip_error',
      replyMessages: [buildSlipStatusText('ไม่พบรหัสรูปสลิป กรุณาส่งรูปสลิปใหม่อีกครั้ง')]
    };
  }

  try {
    const imageContent = await downloadLineMessageContent(event.message.id);
    const slipData = await verifyBankSlipWithEasySlip(imageContent, event);
    const slipTransRef = getSlipTransRef(slipData);
    const amount = getSlipAmount(slipData);

    if (slipData?.isDuplicate || isSlipTransRefUsed(slipTransRef)) {
      return {
        type: 'slip_duplicate',
        slipTransRef,
        replyMessages: [buildSlipStatusText('สลิปนี้ถูกใช้แล้ว ไม่สามารถเติมเครดิตซ้ำได้')]
      };
    }

    if (!slipTransRef) {
      return {
        type: 'slip_error',
        replyMessages: [buildSlipStatusText('ตรวจสลิปได้ แต่ไม่พบเลขอ้างอิง กรุณาส่งสลิปใหม่')]
      };
    }

    if (!amount) {
      return {
        type: 'slip_error',
        slipTransRef,
        replyMessages: [buildSlipStatusText('ตรวจสลิปได้ แต่ไม่พบยอดเงิน กรุณาส่งสลิปใหม่')]
      };
    }

    const slipReserved = await reserveSlipTransRef(slipData, event, amount);
    if (!slipReserved) {
      return {
        type: 'slip_duplicate',
        slipTransRef,
        replyMessages: [buildSlipStatusText('สลิปนี้ถูกใช้แล้ว ไม่สามารถเติมเครดิตซ้ำได้')]
      };
    }
    reservedSlipTransRef = slipTransRef;

    const result = addCreditForUser(event, amount, 'EasySlip verified bank slip', {
      id: `${slipTransRef}:slip`,
      type: 'slip_credit_added',
      slipProvider: 'EasySlip',
      slipTransRef,
      slipDuplicate: false,
      slipSenderBank: slipData?.rawSlip?.sender?.bank?.short || slipData?.sender?.bank?.short || '',
      slipReceiverBank: slipData?.rawSlip?.receiver?.bank?.short || slipData?.receiver?.bank?.short || ''
    });
    creditAddedFromReservedSlip = true;
    const snapshot = getCreditSnapshot(event.source.userId);

    return {
      type: 'slip_credit_added',
      amount,
      creditBalance: result.credit.balance,
      activeWoundAmount: snapshot.activeWoundAmount,
      withdrawableBalance: snapshot.withdrawableBalance,
      activeWoundCount: snapshot.activeWounds.length,
      slipTransRef,
      slipReceiverBank: slipData?.rawSlip?.receiver?.bank?.short || slipData?.receiver?.bank?.short || '',
      replyMessages: [buildCreditAddedFlex(amount, snapshot)]
    };
  } catch (error) {
    const message =
      error.code === 'SLIP_PENDING'
        ? 'สลิปธนาคารกรุงเทพอาจยังตรวจไม่ได้ กรุณารอสักครู่แล้วส่งใหม่อีกครั้ง'
        : `ตรวจสลิปไม่สำเร็จ: ${error.message}`;

    return {
      type: 'slip_error',
      slipErrorCode: error.code || '',
      replyMessages: [buildSlipStatusText(message)]
    };
  } finally {
    if (reservedSlipTransRef && !creditAddedFromReservedSlip) {
      releaseJsonSlipTransRefReservation(reservedSlipTransRef);
    }
  }
}

async function replyToLine(replyToken, messages) {
  if (!LINE_CHANNEL_ACCESS_TOKEN || !replyToken || messages.length === 0) {
    return null;
  }

  const response = await fetch(`${LINE_MESSAGING_API_URL}/v2/bot/message/reply`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`
    },
    body: JSON.stringify({
      replyToken,
      messages: messages.slice(0, 5).map(toLineMessage)
    })
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    console.error(`LINE reply failed: ${response.status} ${errorText}`);
  }

  return response;
}

async function pushToLine(to, messages, options = {}) {
  if (!LINE_CHANNEL_ACCESS_TOKEN || !to || messages.length === 0) {
    return null;
  }
  if (linePushMonthlyLimitReached) {
    console.error('LINE push skipped: monthly push/message limit already reached for this process.');
    return null;
  }

  const lineMessages = messages.slice(0, 5).map(toLineMessage);
  const response = await fetch(`${LINE_MESSAGING_API_URL}/v2/bot/message/push`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`
    },
    body: JSON.stringify({
      to,
      messages: lineMessages
    })
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    console.error(`LINE push failed: ${response.status} ${errorText}`);
    if (isLineMonthlyLimitError(response.status, errorText)) {
      linePushMonthlyLimitReached = true;
      return response;
    }
    if (options.splitRetry !== false && lineMessages.length > 1) {
      for (const message of lineMessages) {
        await pushToLine(to, [message], { splitRetry: false });
      }
    }
  }

  return response;
}

async function broadcastToLine(messages) {
  if (!LINE_CHANNEL_ACCESS_TOKEN || messages.length === 0) {
    return null;
  }

  const response = await fetch(`${LINE_MESSAGING_API_URL}/v2/bot/message/broadcast`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`
    },
    body: JSON.stringify({
      messages: messages.slice(0, 5).map(toLineMessage)
    })
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    console.error(`LINE broadcast failed: ${response.status} ${errorText}`);
  }

  return response;
}

function getBroadcastLocalParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: BROADCAST_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));

  return {
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`
  };
}

let broadcastSchedulerRunning = false;
let broadcastSchedulerTimer = null;

async function runScheduledBroadcasts(now = new Date()) {
  if (broadcastSchedulerRunning) return;

  broadcastSchedulerRunning = true;
  try {
    const settings = readBroadcastSettings();
    const sharedMessageText = getBetGroupInviteText();
    const localParts = getBroadcastLocalParts(now);
    const dueSchedules = settings.schedules.filter((schedule) => (
      schedule.enabled &&
      sharedMessageText &&
      schedule.scheduledTime === localParts.time &&
      schedule.lastSentDate !== localParts.dateKey
    ));

    if (dueSchedules.length === 0) return;

    const timestamp = now.getTime();
    const sentScheduleIds = new Set();
    const logs = readLogs();
    for (const schedule of dueSchedules) {
      const response = await broadcastToLine([sharedMessageText]).catch(() => null);
      const broadcastStatus = response ? (response.ok ? 'sent' : 'failed') : 'skipped';
      if (broadcastStatus === 'sent') {
        sentScheduleIds.add(schedule.id);
      }
      logs.unshift({
        eventType: 'scheduled_broadcast_sent',
        sourceType: 'web_admin',
        userId: '',
        groupId: '',
        message: sharedMessageText,
        timestamp,
        time: formatDate(timestamp),
        broadcastAction: 'scheduled_send',
        broadcastScheduleId: schedule.id,
        broadcastScheduleTitle: schedule.title,
        broadcastScheduledTime: schedule.scheduledTime,
        broadcastDelivery: 'broadcast',
        broadcastPushStatus: broadcastStatus
      });
    }
    if (sentScheduleIds.size > 0) {
      const nextSchedules = settings.schedules.map((schedule) => {
        if (!sentScheduleIds.has(schedule.id)) return schedule;

        return {
          ...schedule,
          lastSentDate: localParts.dateKey,
          lastSentTimestamp: timestamp,
          lastSentTime: formatDate(timestamp),
          updatedTimestamp: timestamp
        };
      });

      writeBroadcastSettings({
        ...settings,
        schedules: nextSchedules,
        updatedTimestamp: timestamp,
        updatedTime: formatDate(timestamp)
      });
    }
    writeLogs(logs);
  } finally {
    broadcastSchedulerRunning = false;
  }
}

function startBroadcastScheduler() {
  if (broadcastSchedulerTimer || BROADCAST_SCHEDULER_INTERVAL_MS <= 0) return;

  broadcastSchedulerTimer = setInterval(() => {
    runScheduledBroadcasts().catch((error) => {
      console.error('Scheduled broadcast failed:', error.message);
    });
  }, BROADCAST_SCHEDULER_INTERVAL_MS);
  broadcastSchedulerTimer.unref?.();
}

async function downloadLineMessageContent(messageId) {
  if (!LINE_CHANNEL_ACCESS_TOKEN) {
    throw new Error('LINE_CHANNEL_ACCESS_TOKEN is not set');
  }

  const baseUrl = LINE_CONTENT_API_BASE_URL.replace(/\/+$/, '');
  const response = await fetch(`${baseUrl}/v2/bot/message/${encodeURIComponent(messageId)}/content`, {
    headers: {
      Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`
    }
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`LINE content download failed: ${response.status} ${errorText}`);
  }

  const contentType = response.headers.get('content-type') || 'image/jpeg';
  const arrayBuffer = await response.arrayBuffer();

  return {
    contentType,
    buffer: Buffer.from(arrayBuffer)
  };
}

async function verifyBankSlipWithEasySlip(imageContent, event) {
  if (!EASYSLIP_API_KEY) {
    throw new Error('EASYSLIP_API_KEY is not set');
  }

  const baseUrl = EASYSLIP_API_BASE_URL.replace(/\/+$/, '');
  const base64 = `data:${imageContent.contentType};base64,${imageContent.buffer.toString('base64')}`;
  const body = {
    base64,
    checkDuplicate: EASYSLIP_CHECK_DUPLICATE,
    remark: `LINE ${event.source?.userId || '-'} ${event.message?.id || '-'}`
  };

  if (EASYSLIP_MATCH_ACCOUNT) {
    body.matchAccount = true;
  }

  const response = await fetch(`${baseUrl}/verify/bank`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${EASYSLIP_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  const result = await response.json().catch(() => null);

  if (!response.ok || !result?.success) {
    const error = result?.error || {};
    const message = error.message || result?.message || `EasySlip verify failed: ${response.status}`;
    const verifyError = new Error(message);
    verifyError.code = error.code || '';
    verifyError.status = response.status;
    throw verifyError;
  }

  return result.data;
}

async function getLineGroupMemberProfile(groupId, userId) {
  if (!LINE_CHANNEL_ACCESS_TOKEN || !groupId || !userId) {
    return null;
  }

  const response = await fetch(
    `${LINE_MESSAGING_API_URL}/v2/bot/group/${encodeURIComponent(groupId)}/member/${encodeURIComponent(userId)}`,
    {
      headers: {
        Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`
      }
    }
  );

  if (!response.ok) {
    return null;
  }

  return response.json();
}

async function getLineUserProfile(userId) {
  if (!LINE_CHANNEL_ACCESS_TOKEN || !userId) {
    return null;
  }

  const response = await fetch(
    `${LINE_MESSAGING_API_URL}/v2/bot/profile/${encodeURIComponent(userId)}`,
    {
      headers: {
        Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`
      }
    }
  );

  if (!response.ok) {
    return null;
  }

  return response.json();
}

function verifyLineSignature(req, res, next) {
  // Skip signature verification when the secret is not set for local testing.
  if (!LINE_CHANNEL_SECRET) {
    return next();
  }

  const signature = req.get('x-line-signature');
  if (!signature) {
    return res.sendStatus(401);
  }

  const expectedSignature = crypto
    .createHmac('sha256', LINE_CHANNEL_SECRET)
    .update(req.body)
    .digest('base64');

  const provided = Buffer.from(signature);
  const expected = Buffer.from(expectedSignature);

  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
    return res.sendStatus(401);
  }

  return next();
}

function getMessageText(event) {
  if (!event.message) return '';

  if (event.message.type === 'text') {
    return event.message.text || '';
  }

  return event.message.type || '';
}

function looksLikeLineIdentifier(value) {
  return /^[UCR][0-9a-f]{20,}$/i.test(String(value || '').trim());
}

function normalizeDisplayName(value) {
  const displayName = String(value || '').trim();
  if (!displayName || looksLikeLineIdentifier(displayName)) return '';
  return displayName;
}

function normalizePictureUrl(value) {
  const pictureUrl = String(value || '').trim();
  return /^https?:\/\//i.test(pictureUrl) ? pictureUrl : '';
}

function getEventDisplayName(event) {
  return normalizeDisplayName(event?.source?.displayName || event?.displayName || '');
}

function findKnownDisplayNameByUserId(userId) {
  if (!userId) return '';

  const credit = readCredits().find((row) => row.userId === userId);
  const creditDisplayName = (credit?.transactions || [])
    .map((transaction) => normalizeDisplayName(transaction.displayName))
    .find(Boolean);
  if (creditDisplayName) return creditDisplayName;

  const messageDisplayName = readMessages()
    .filter((message) => message.userId === userId)
    .map((message) => normalizeDisplayName(message.displayName))
    .find(Boolean);
  if (messageDisplayName) return messageDisplayName;

  const wound = readWounds().find((row) => row.openerUserId === userId || row.accepterUserId === userId);
  if (wound?.openerUserId === userId) return normalizeDisplayName(wound.openerDisplayName);
  if (wound?.accepterUserId === userId) return normalizeDisplayName(wound.accepterDisplayName);

  return '';
}

function findKnownPictureUrlByUserId(userId) {
  if (!userId) return '';

  const credit = readCredits().find((row) => row.userId === userId);
  return (credit?.transactions || [])
    .map((transaction) => normalizePictureUrl(transaction.pictureUrl))
    .find(Boolean) || '';
}

async function resolveCreditProfile(userId) {
  const profile = await getLineUserProfile(userId).catch(() => null);
  return {
    displayName: normalizeDisplayName(profile?.displayName) || findKnownDisplayNameByUserId(userId) || 'ไม่พบชื่อผู้ใช้',
    pictureUrl: normalizePictureUrl(profile?.pictureUrl) || findKnownPictureUrlByUserId(userId)
  };
}

async function resolveCreditDisplayName(userId) {
  const profile = await resolveCreditProfile(userId);
  return profile.displayName;
}

async function resolveGroupMemberDisplayName(groupId, userId, trackedMessage = null) {
  const trackedDisplayName = normalizeDisplayName(trackedMessage?.displayName);
  if (trackedDisplayName) return trackedDisplayName;

  const profile = await getLineGroupMemberProfile(groupId, userId);
  return normalizeDisplayName(profile?.displayName);
}

function createLogEntry(event) {
  const source = event.source || {};

  return {
    eventType: event.type || '',
    sourceType: source.type || '',
    userId: source.userId || '',
    groupId: source.groupId || '',
    roomId: source.roomId || '',
    message: getMessageText(event),
    timestamp: event.timestamp || null,
    time: formatDate(event.timestamp)
  };
}

function upsertAdminFromEvent(event) {
  const source = event.source || {};
  const message = getMessageText(event);
  const adminCommand = parseAdminCommand(message);

  if (!adminCommand || source.type !== 'user' || !source.userId) {
    return null;
  }

  const nowTimestamp = event.timestamp || Date.now();
  const admins = readAdmins().filter(
    (admin) => !(admin.groupKey === adminCommand.groupKey && admin.userId === source.userId)
  );
  const existingIndex = admins.findIndex(
    (admin) => admin.groupKey === adminCommand.groupKey && admin.priority === adminCommand.priority
  );
  const adminEntry = {
    groupName: adminCommand.groupName,
    groupKey: adminCommand.groupKey,
    rawGroupName: adminCommand.rawGroupName,
    priority: adminCommand.priority,
    userId: source.userId,
    adminKeyword: ADMIN_KEYWORD,
    timestamp: nowTimestamp,
    time: formatDate(nowTimestamp),
    replyTexts: [
      [
        `เริ่มการผูกกลุ่ม: ${adminCommand.groupName}`,
        `ลำดับแอดมิน: ${adminCommand.priority}`,
        '',
        'ขั้นตอนต่อไป ให้เข้าไปในกลุ่ม LINE ที่ต้องการผูก แล้วพิมพ์:',
        `ผูกกลุ่ม : ${adminCommand.groupName}`
      ].join('\n')
    ]
  };

  if (existingIndex >= 0) {
    admins[existingIndex] = {
      ...admins[existingIndex],
      ...adminEntry
    };
  } else {
    admins.unshift(adminEntry);
  }

  writeAdmins(admins);
  return adminEntry;
}

function removeAdminFromEvent(event) {
  const source = event.source || {};
  const removeCommand = parseRemoveAdminCommand(getMessageText(event));

  if (!removeCommand || source.type !== 'user' || !source.userId) {
    return null;
  }

  const admins = readAdmins();
  const remainingAdmins = admins.filter(
    (admin) => !(admin.groupKey === removeCommand.groupKey && admin.userId === source.userId)
  );
  const removedCount = admins.length - remainingAdmins.length;

  if (removedCount > 0) {
    writeAdmins(remainingAdmins);
  }

  return {
    removed: removedCount > 0,
    removedCount,
    groupName: removeCommand.groupName,
    groupKey: removeCommand.groupKey,
    userId: source.userId,
    replyTexts:
      removedCount > 0
        ? [`ยกเลิกแอดมินกลุ่ม ${removeCommand.groupName} แล้ว`]
        : [`ไม่พบสิทธิ์แอดมินกลุ่ม ${removeCommand.groupName}`]
  };
}

function bindGroupFromEvent(event) {
  if (!isGroupTextMessage(event)) return null;

  const source = event.source || {};
  const bindCommand = parseBindGroupCommand(getMessageText(event));
  if (!bindCommand || !source.groupId || !source.userId) {
    return null;
  }

  const nowTimestamp = event.timestamp || Date.now();
  const admins = readAdmins();
  const targetIndexes = admins
    .map((admin, index) => ({ admin, index }))
    .filter(({ admin }) => admin.userId === source.userId && admin.groupKey === bindCommand.groupKey)
    .map(({ index }) => index);

  if (targetIndexes.length === 0) {
    return {
      bound: false,
      groupName: bindCommand.groupName,
      groupKey: bindCommand.groupKey,
      groupId: source.groupId
    };
  }

  for (const index of targetIndexes) {
    admins[index] = {
      ...admins[index],
      groupName: bindCommand.groupName,
      groupKey: bindCommand.groupKey,
      groupId: source.groupId,
      boundAt: nowTimestamp,
      boundTime: formatDate(nowTimestamp)
    };
  }

  writeAdmins(admins);
  return {
    bound: true,
    groupName: bindCommand.groupName,
    groupKey: bindCommand.groupKey,
    groupId: source.groupId,
    userId: source.userId,
    adminCount: targetIndexes.length,
    replyTexts: [`✅ ผูกกลุ่มสำเร็จ: ${bindCommand.groupName}\nกลุ่มนี้พร้อมใช้งานแล้วครับ`]
  };
}

function isGroupTextMessage(event) {
  return event.type === 'message' && event.message?.type === 'text' && event.source?.type === 'group';
}

function buildBehindHouseFlex(link) {
  const contents = [];

  if (/^https:\/\//i.test(LINE_OFFICIAL_ACCOUNT_IMAGE_URL)) {
    contents.push({
      type: 'box',
      layout: 'vertical',
      width: '52px',
      height: '52px',
      cornerRadius: '26px',
      backgroundColor: '#FFFFFF',
      paddingAll: '0px',
      alignItems: 'center',
      justifyContent: 'center',
      contents: [
        {
          type: 'image',
          url: LINE_OFFICIAL_ACCOUNT_IMAGE_URL,
          size: 'full',
          aspectRatio: '1:1',
          aspectMode: 'cover',
          margin: 'none'
        }
      ]
    });
  }

  contents.push(
    flexText(LINE_OFFICIAL_ACCOUNT_NAME, {
      size: 'md',
      weight: 'bold',
      align: 'center',
      color: '#111827',
      margin: contents.length > 0 ? 'sm' : 'none'
    }),
    {
      type: 'box',
      layout: 'vertical',
      backgroundColor: '#72EF81',
      cornerRadius: 'md',
      paddingAll: '8px',
      margin: 'sm',
      action: {
        type: 'uri',
        label: 'ดูโปรไฟล์',
        uri: link
      },
      contents: [
        flexText('ดูโปรไฟล์', {
          size: 'sm',
          weight: 'bold',
          align: 'center',
          color: '#111827'
        })
      ]
    }
  );

  return {
    type: 'flex',
    altText: `หลังบ้าน ${LINE_OFFICIAL_ACCOUNT_NAME}`,
    contents: {
      type: 'bubble',
      size: 'micro',
      action: {
        type: 'uri',
        label: 'เปิดหลังบ้าน',
        uri: link
      },
      styles: {
        body: {
          backgroundColor: '#5FE66F'
        }
      },
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '14px',
        spacing: 'xs',
        alignItems: 'center',
        contents
      }
    }
  };
}

function buildBehindHousePaymentText() {
  return [
    '🟠🟠ช่องทางชำระเงิน🟠🟠',
    '',
    `${PAYMENT_ACCOUNT_NUMBER} ${PAYMENT_ACCOUNT_BANK}`,
    PAYMENT_ACCOUNT_NAME,
    '',
    '********************',
    '**ก่อนโอนเช็คชื่อบัญชีดีๆนะครับ🙏',
    '',
    '✅บัญชีนี้เท่านั้น✅'
  ].join('\n');
}

async function buildGroupAdminReplyMessage(groupId) {
  const admins = readAdmins()
    .filter((admin) => admin.groupId === groupId && admin.userId)
    .slice(0, 20);

  if (admins.length === 0) {
    return 'ยังไม่มีแอดมินที่ผูกกับกลุ่มนี้';
  }

  const labels = await Promise.all(admins.map(async (admin, index) => {
    const profile = await getLineGroupMemberProfile(groupId, admin.userId).catch(() => null);
    return normalizeDisplayName(profile?.displayName) || `แอดมิน${admin.priority || index + 1}`;
  }));
  let text = 'แอดมินกลุ่มนี้\n';
  const mentionees = [];

  admins.forEach((admin, index) => {
    const prefix = `${index + 1}. `;
    const label = `@${String(labels[index] || `แอดมิน${index + 1}`).replace(/^@+/, '')}`;

    text += prefix;
    mentionees.push({
      index: text.length,
      length: label.length,
      userId: admin.userId
    });
    text += `${label}\n`;
  });

  return {
    type: 'text',
    text: text.trimEnd(),
    mention: {
      mentionees
    }
  };
}

async function handleGroupAdminLookupCommand(event) {
  if (!isGroupTextMessage(event) || !parseGroupAdminLookupKeyword(getMessageText(event))) {
    return null;
  }

  const source = event.source || {};
  const replyMessage = await buildGroupAdminReplyMessage(source.groupId);
  const adminCount = readAdmins().filter((admin) => admin.groupId === source.groupId && admin.userId).length;

  return {
    type: 'group_admin_lookup',
    adminCount,
    replyMessages: [replyMessage]
  };
}

function getBoundGroupName(groupId) {
  const admin = readAdmins().find((entry) => entry.groupId === groupId && entry.groupName);
  return admin?.groupName || groupId || '';
}

function buildOpenBlackAccountReply(groupName) {
  return [
    'เปิดลบบัญชีดำ(🟢)',
    `กลุ่ม ${groupName || '-'}`,
    'กรุณาส่งคอนแทคเพื่อลบบัญชีดำ'
  ].join('\n');
}

function buildOpenWhiteAccountReply(groupName) {
  return [
    'เปิดบัญชีขาว(⚪)',
    `กลุ่ม ${groupName || '-'}`,
    'กรุณาส่งคอนแทคเพื่อเปิดบัญชีขาว'
  ].join('\n');
}

async function handleBlackAccountCommand(event) {
  if (!isGroupTextMessage(event)) {
    return null;
  }

  const source = event.source || {};
  if (!isRegisteredAdmin(source.userId, source.groupId)) {
    return null;
  }

  const messageText = getMessageText(event);
  const accountListMode = parseOpenAccountListCommand(messageText);
  const groupName = getBoundGroupName(source.groupId);

  if (accountListMode) {
    setBlacklistMode(source.groupId, accountListMode, source.userId);
    return {
      type: accountListMode === 'white' ? 'open_white_account' : 'open_black_account_removal',
      groupName,
      replyTexts: [
        accountListMode === 'white'
          ? buildOpenWhiteAccountReply(groupName)
          : buildOpenBlackAccountReply(groupName)
      ]
    };
  }

  const explicitTargetCommand = parseBlacklistTargetCommand(messageText);
  const activeMode = getActiveBlacklistMode(source.groupId);
  const mode = explicitTargetCommand?.mode || activeMode?.mode || '';
  if (!mode) {
    return null;
  }

  const targets = await resolveBlacklistTargets(event, explicitTargetCommand?.targetText || '');
  if (targets.length === 0) {
    return {
      type: mode === 'white' ? 'blacklist_remove_target_not_found' : 'blacklist_add_target_not_found',
      groupName,
      replyTexts: [buildBlacklistTargetNotFoundReply(mode)]
    };
  }

  if (mode === 'white') {
    removeBlacklistEntries(source.groupId, targets);
  } else {
    upsertBlacklistEntries(source.groupId, targets, source.userId, event);
  }

  clearBlacklistMode(source.groupId);

  return {
    type: mode === 'white' ? 'blacklist_removed' : 'blacklist_added',
    groupName,
    targets,
    replyTexts: [buildBlacklistTargetReply(mode, groupName, targets)]
  };
}

function handleBehindHouseCommand(event) {
  if (!isGroupTextMessage(event)) {
    return null;
  }

  const messageText = getMessageText(event);
  const behindHouseRequested = parseBehindHouseCommand(messageText);
  const paymentAccountRequested = parsePaymentAccountKeyword(messageText);
  if (!behindHouseRequested && !paymentAccountRequested) {
    return null;
  }

  if (isUserBlacklistedForGroup(event.source?.userId, event.source?.groupId)) {
    return null;
  }

  return {
    type: paymentAccountRequested && !behindHouseRequested ? 'group_payment_account' : 'behind_house',
    link: LINE_OFFICIAL_ACCOUNT_URL || '',
    replyTexts: [buildBehindHousePaymentText()],
    replyMessages: LINE_OFFICIAL_ACCOUNT_URL ? [buildBehindHouseFlex(LINE_OFFICIAL_ACCOUNT_URL)] : []
  };
}

function handleBetGroupInviteEvent(event) {
  if (event.source?.type !== 'user') {
    return null;
  }

  const requestedByMessage =
    event.type === 'message' &&
    event.message?.type === 'text' &&
    parseBetGroupInviteKeyword(getMessageText(event));
  const requestedByPostback =
    event.type === 'postback' &&
    parseBetGroupInvitePostbackData(event.postback?.data);

  if (!requestedByMessage && !requestedByPostback) {
    return null;
  }

  if (isUserBlacklistedAnywhere(event.source?.userId)) {
    return null;
  }

  return {
    type: 'bet_group_invite',
    replyTexts: [getBetGroupInviteText()]
  };
}

function trackGroupMessage(event) {
  if (!isGroupTextMessage(event) || !event.message.id) {
    return null;
  }

  const source = event.source || {};
  if (isUserBlacklistedForGroup(source.userId, source.groupId)) {
    return null;
  }

  const openRound = getOpenRoundForGroup(source.groupId);
  const messageText = getMessageText(event);
  const quotedMessageId = event.message.quotedMessageId || '';
  const quotedMessage = findTrackedMessage(quotedMessageId);
  const acceptIntent = parseAcceptIntent(messageText);
  const acceptKeyword = acceptIntent?.keyword || null;
  const acceptFallbackNoBuilder = isNoBuilderFallbackMarker(acceptKeyword);
  const tradeForPairIntent = quotedMessage?.trade
    ? withAcceptedStakeAmount(
        withNoBuilderFallback(quotedMessage.trade, acceptFallbackNoBuilder),
        parsePositiveAmount(acceptIntent?.amount)
      )
    : null;
  const pairIntent =
    acceptKeyword &&
    quotedMessage?.trade &&
    quotedMessage.groupId === source.groupId &&
    quotedMessage.roundId === openRound?.id &&
    quotedMessage.userId &&
    quotedMessage.userId !== source.userId
      ? {
          openMessageId: quotedMessage.id,
          openerUserId: quotedMessage.userId,
          accepterUserId: source.userId || '',
          accepterDisplayName: getEventDisplayName(event),
          roundId: openRound.id,
          groupId: source.groupId || '',
          requiredCredit: getRequiredCreditFromTrade(tradeForPairIntent),
          acceptAmount: acceptIntent?.amount || '',
          fallbackNoBuilder: acceptFallbackNoBuilder
        }
      : null;
  const messageEntry = {
    id: event.message.id,
    groupId: source.groupId || '',
    roundId: openRound?.id || '',
    roundName: openRound?.queueName || '',
    userId: source.userId || '',
    displayName: getEventDisplayName(event),
    text: messageText,
    quotedMessageId,
    acceptKeyword,
    pairIntent,
    trade: parseTradeMessage(messageText),
    timestamp: event.timestamp || Date.now(),
    time: formatDate(event.timestamp || Date.now())
  };
  const messages = readMessages().filter((message) => message.id !== messageEntry.id);

  writeMessages([messageEntry, ...messages]);
  return messageEntry;
}

function getTradeRepeatSignature(trade) {
  if (!trade) return '';

  return [
    trade.side || '',
    trade.keyword || '',
    trade.amount || '',
    trade.priceRaw || '',
    trade.fallbackNoBuilder ? 'fallback' : ''
  ].join('|');
}

function handleRepeatedTradeWarning(trackedMessage) {
  if (!trackedMessage?.trade || !trackedMessage.groupId || !trackedMessage.roundId || !trackedMessage.userId) {
    return null;
  }

  const signature = getTradeRepeatSignature(trackedMessage.trade);
  if (!signature) return null;

  const repeatedTrades = readMessages().filter((message) => (
    message.groupId === trackedMessage.groupId &&
    message.roundId === trackedMessage.roundId &&
    message.userId === trackedMessage.userId &&
    getTradeRepeatSignature(message.trade) === signature
  ));

  if (repeatedTrades.length !== REPEATED_TRADE_WARNING_THRESHOLD) {
    return null;
  }

  return {
    type: 'repeated_trade_warning',
    repeatedTradeCount: repeatedTrades.length,
    replyTexts: [REPEATED_TRADE_WARNING_REPLY]
  };
}

function findTrackedMessage(messageId) {
  if (!messageId) return null;
  return readMessages().find((message) => message.id === messageId) || null;
}

function createPairOrderId(timestamp, messageId) {
  const seed = `${timestamp}:${messageId || ''}`;
  let hash = 0;

  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) % 100000;
  }

  return String(hash).padStart(5, '0');
}

function updateTrackedMessage(messageId, patch) {
  if (!messageId) return null;

  let updatedMessage = null;
  const messages = readMessages().map((message) => {
    if (message.id !== messageId) return message;

    updatedMessage = {
      ...message,
      ...patch
    };

    return updatedMessage;
  });

  if (updatedMessage) {
    writeMessages(messages);
  }

  return updatedMessage;
}

function buildUnsendNotification(event, trackedMessage, displayName) {
  const cancelTimestamp = event.timestamp || Date.now();
  const senderName = displayName || trackedMessage?.displayName || trackedMessage?.userId || event.source?.userId || '-';
  const cancelledMessage = trackedMessage?.text || '(ไม่พบข้อความเดิม)';
  const elapsed = formatElapsedSeconds(trackedMessage?.timestamp, cancelTimestamp);
  const cancelledAt = formatClockTime(cancelTimestamp);

  return `❌ พบการยกเลิกข้อความ ❌\n\n• ผู้ยกเลิก: ${senderName}\n• ยกเลิกเมื่อ: ${elapsed} ที่แล้ว\n• ข้อความ: ${cancelledMessage}\n• เวลา: ${cancelledAt} ที่ยกเลิก\n\n❌❌❌❌❌❌❌❌`;
}

async function handleUnsendEvent(event) {
  if (event.type !== 'unsend' || event.source?.type !== 'group') {
    return null;
  }

  const source = event.source || {};
  const messageId = event.unsend?.messageId || '';
  const trackedMessage = findTrackedMessage(messageId);
  let displayName = trackedMessage?.displayName || '';

  if (!displayName && source.groupId && source.userId) {
    const profile = await getLineGroupMemberProfile(source.groupId, source.userId);
    displayName = profile?.displayName || '';
  }

  const updatedMessage = trackedMessage
    ? updateTrackedMessage(messageId, {
        displayName,
        unsent: true,
        unsentTimestamp: event.timestamp || Date.now(),
        unsentTime: formatDate(event.timestamp || Date.now())
      })
    : null;
  const notification = buildUnsendNotification(event, updatedMessage || trackedMessage, displayName);

  await pushToLine(source.groupId, [notification]);

  return {
    type: 'unsend_detected',
    groupId: source.groupId || '',
    userId: source.userId || '',
    displayName: displayName || source.userId || '',
    messageId,
    cancelledMessage: trackedMessage?.text || '',
    notification
  };
}

async function createWoundFromReply(event) {
  if (!isGroupTextMessage(event)) return null;

  const source = event.source || {};
  const openRound = getOpenRoundForGroup(source.groupId);
  if (!openRound) return null;

  if (isUserBlacklistedForGroup(source.userId, source.groupId)) {
    return {
      type: 'wound_rejected',
      reason: 'blacklisted_user',
      openerUserId: source.userId || '',
      accepterUserId: source.userId || '',
      insufficientCreditUsers: []
    };
  }

  const acceptIntent = parseAcceptIntent(getMessageText(event));
  const acceptKeyword = acceptIntent?.keyword || null;
  const quotedMessage = findTrackedMessage(event.message.quotedMessageId);

  if (!acceptKeyword || !quotedMessage) return null;
  if (quotedMessage.groupId !== source.groupId) return null;
  if (quotedMessage.roundId !== openRound.id) return null;

  const nowTimestamp = event.timestamp || Date.now();
  const wounds = readWounds();

  if (quotedMessage.trade) {
    if (!quotedMessage.userId || quotedMessage.userId === source.userId) return null;
    if (isUserBlacklistedForGroup(quotedMessage.userId, source.groupId)) {
      return {
        type: 'wound_rejected',
        reason: 'blacklisted_user',
        openMessageId: quotedMessage.id,
        openerUserId: quotedMessage.userId,
        accepterUserId: source.userId || '',
        insufficientCreditUsers: []
      };
    }

    const acceptFallbackNoBuilder = isNoBuilderFallbackMarker(acceptKeyword);
    const acceptedTrade = resolveAcceptedTradeForPair(
      withNoBuilderFallback(quotedMessage.trade, acceptFallbackNoBuilder),
      acceptIntent?.amount || '',
      wounds,
      source.groupId,
      openRound.id,
      quotedMessage.id,
      source.userId || ''
    );

    if (acceptedTrade.reason) {
      return {
        type: 'wound_rejected',
        reason: acceptedTrade.reason,
        openMessageId: quotedMessage.id,
        openerUserId: quotedMessage.userId,
        accepterUserId: source.userId || '',
        requiredCredit: acceptedTrade.requiredCredit,
        remainingStake: acceptedTrade.remainingStake,
        existingWoundId: acceptedTrade.existingWoundId
      };
    }

    return {
      type: 'pair_pending',
      openMessageId: quotedMessage.id,
      openerUserId: quotedMessage.userId,
      accepterUserId: source.userId || '',
      requiredCredit: acceptedTrade.requiredCredit,
      acceptAmount: acceptIntent?.amount || '',
      remainingStake: acceptedTrade.remainingStake,
      fallbackNoBuilder: acceptFallbackNoBuilder
    };
  }

  const pairIntent = quotedMessage.pairIntent;
  if (!pairIntent) return null;
  if (pairIntent.groupId !== source.groupId || pairIntent.roundId !== openRound.id) return null;
  if (pairIntent.openerUserId !== source.userId) return null;
  if (!pairIntent.accepterUserId || pairIntent.accepterUserId === source.userId) return null;

  const tradeMessage = findTrackedMessage(pairIntent.openMessageId);
  if (!tradeMessage?.trade) return null;
  if (tradeMessage.groupId !== source.groupId || tradeMessage.roundId !== openRound.id) return null;
  if (
    isUserBlacklistedForGroup(tradeMessage.userId, source.groupId) ||
    isUserBlacklistedForGroup(pairIntent.accepterUserId, source.groupId)
  ) {
    return {
      type: 'wound_rejected',
      reason: 'blacklisted_user',
      openMessageId: tradeMessage.id,
      openerUserId: tradeMessage.userId,
      accepterUserId: pairIntent.accepterUserId,
      insufficientCreditUsers: []
    };
  }

  const fallbackNoBuilder = Boolean(
    tradeMessage.trade.fallbackNoBuilder ||
      pairIntent.fallbackNoBuilder ||
      isNoBuilderFallbackMarker(quotedMessage.acceptKeyword || quotedMessage.text) ||
      isNoBuilderFallbackMarker(acceptKeyword)
  );
  const acceptedTrade = resolveAcceptedTradeForPair(
    withNoBuilderFallback(tradeMessage.trade, fallbackNoBuilder),
    pairIntent.acceptAmount || parseAcceptIntent(quotedMessage.text)?.amount || '',
    wounds,
    source.groupId,
    openRound.id,
    tradeMessage.id,
    pairIntent.accepterUserId
  );

  if (acceptedTrade.reason) {
    return {
      type: 'wound_rejected',
      reason: acceptedTrade.reason,
      openMessageId: tradeMessage.id,
      openerUserId: tradeMessage.userId,
      accepterUserId: pairIntent.accepterUserId,
      requiredCredit: acceptedTrade.requiredCredit,
      remainingStake: acceptedTrade.remainingStake,
      existingWoundId: acceptedTrade.existingWoundId
    };
  }

  const tradeForWound = acceptedTrade.trade;
  const requiredCredit = acceptedTrade.requiredCredit;
  const openerSnapshot = getCreditSnapshot(tradeMessage.userId);
  const accepterSnapshot = getCreditSnapshot(pairIntent.accepterUserId);
  const insufficientCreditUsers = [];

  if (requiredCredit > 0 && openerSnapshot.withdrawableBalance < requiredCredit) {
    insufficientCreditUsers.push(tradeMessage.userId);
  }

  if (requiredCredit > 0 && accepterSnapshot.withdrawableBalance < requiredCredit) {
    insufficientCreditUsers.push(pairIntent.accepterUserId);
  }

  if (insufficientCreditUsers.length > 0) {
    return {
      type: 'wound_rejected',
      reason: 'insufficient_credit',
      openMessageId: tradeMessage.id,
      openerUserId: tradeMessage.userId,
      accepterUserId: pairIntent.accepterUserId,
      requiredCredit,
      openerAvailableCredit: openerSnapshot.withdrawableBalance,
      accepterAvailableCredit: accepterSnapshot.withdrawableBalance,
      insufficientCreditUsers
    };
  }

  const predictionLabels = getPredictionLabels(tradeForWound.side);
  const [openerDisplayName, accepterDisplayName] = await Promise.all([
    resolveGroupMemberDisplayName(source.groupId, tradeMessage.userId, tradeMessage),
    resolveGroupMemberDisplayName(source.groupId, pairIntent.accepterUserId, quotedMessage)
  ]);
  const woundEntry = {
    id: `${source.groupId}:${tradeMessage.id}:${event.message.id || nowTimestamp}`,
    orderId: createPairOrderId(nowTimestamp, event.message.id),
    status: 'active',
    groupId: source.groupId || '',
    roundId: openRound.id,
    roundName: openRound.queueName,
    openerUserId: tradeMessage.userId,
    accepterUserId: pairIntent.accepterUserId,
    openerDisplayName,
    accepterDisplayName,
    openMessageId: tradeMessage.id,
    acceptMessageId: quotedMessage.id || '',
    confirmMessageId: event.message.id || '',
    openText: tradeMessage.text,
    acceptText: quotedMessage.text,
    confirmText: getMessageText(event),
    openKeyword: tradeForWound.keyword,
    acceptKeyword: quotedMessage.acceptKeyword || quotedMessage.text,
    confirmKeyword: acceptKeyword,
    side: tradeForWound.side,
    openerPrediction: predictionLabels.openerPrediction,
    accepterPrediction: predictionLabels.accepterPrediction,
    amount: tradeForWound.amount,
    requiredCredit,
    priceRaw: tradeForWound.priceRaw || '',
    openingPriceRaw: openRound.priceRaw || '',
    customPrice: Boolean(tradeForWound.customPrice),
    fallbackNoBuilder,
    noBuilderPrice: Boolean(tradeForWound.noBuilderPrice),
    openingNoBuilderPrice: Boolean(openRound.noBuilderPrice),
    openerAvailableBefore: openerSnapshot.withdrawableBalance,
    accepterAvailableBefore: accepterSnapshot.withdrawableBalance,
    openedTimestamp: nowTimestamp,
    openedTime: formatDate(nowTimestamp),
    result: '',
    closedByUserId: '',
    closedTimestamp: null,
    closedTime: ''
  };

  writeWounds([woundEntry, ...wounds]);
  return {
    type: 'wound_created',
    wound: woundEntry,
    notificationTargets: [woundEntry.openerUserId, woundEntry.accepterUserId].filter(Boolean),
    privateNotifications: [
      {
        to: woundEntry.openerUserId,
        messages: [
          buildPairSuccessText(woundEntry, woundEntry.openerUserId),
          buildPairSuccessFlex(woundEntry, woundEntry.openerUserId)
        ]
      },
      {
        to: woundEntry.accepterUserId,
        messages: [
          buildPairSuccessText(woundEntry, woundEntry.accepterUserId),
          buildPairSuccessFlex(woundEntry, woundEntry.accepterUserId)
        ]
      }
    ].filter((notification) => notification.to)
  };
}

function parsePostbackData(event) {
  if (event.type !== 'postback' || !event.postback?.data) return null;

  const params = new URLSearchParams(event.postback.data);
  return {
    action: params.get('action') || '',
    woundId: params.get('woundId') || '',
    decision: params.get('decision') || ''
  };
}

function updateWoundEntry(woundId, updater) {
  let updatedWound = null;
  const wounds = readWounds().map((wound) => {
    if (wound.id !== woundId) return wound;

    updatedWound = updater(wound);
    return updatedWound;
  });

  if (updatedWound) {
    writeWounds(wounds);
  }

  return updatedWound;
}

async function handleWoundCancelPostback(event) {
  const postback = parsePostbackData(event);
  if (!postback?.action || !postback.woundId) return null;

  const source = event.source || {};
  const userId = source.userId || '';
  const wound = readWounds().find((entry) => entry.id === postback.woundId);
  if (!wound || wound.status !== 'active' || ![wound.openerUserId, wound.accepterUserId].includes(userId)) {
    return null;
  }

  const nowTimestamp = event.timestamp || Date.now();

  if (postback.action === 'wound_cancel_request') {
    const targetUserId = getWoundOpponentUserId(wound, userId);
    if (!targetUserId) return null;

    const updatedWound = updateWoundEntry(wound.id, (entry) => ({
      ...entry,
      cancelRequestedByUserId: userId,
      cancelRequestedTimestamp: nowTimestamp,
      cancelRequestedTime: formatDate(nowTimestamp),
      cancelRejectedByUserId: '',
      cancelRejectedTimestamp: null,
      cancelRejectedTime: ''
    }));

    return {
      type: 'cancel_requested',
      wound: updatedWound,
      targetUserId,
      privateNotifications: [
        {
          to: targetUserId,
          messages: [buildCancelRequestFlex(updatedWound, userId)]
        }
      ],
      replyMessages: [buildCancelStatusFlex(updatedWound, 'ส่งคำขอยกเลิกแล้ว', '#F59E0B', 'รอคู่ตัดสินใจ')]
    };
  }

  if (postback.action === 'wound_cancel_decision') {
    const requesterUserId = wound.cancelRequestedByUserId || '';
    if (!requesterUserId || requesterUserId === userId || getWoundOpponentUserId(wound, requesterUserId) !== userId) {
      return null;
    }

    if (postback.decision === 'approve') {
      const updatedWound = updateWoundEntry(wound.id, (entry) => ({
        ...entry,
        status: 'cancelled',
        cancelApprovedByUserId: userId,
        cancelApprovedTimestamp: nowTimestamp,
        cancelApprovedTime: formatDate(nowTimestamp),
        cancelledByUserId: userId,
        cancelledTimestamp: nowTimestamp,
        cancelledTime: formatDate(nowTimestamp)
      }));

      return {
        type: 'cancel_approved',
        wound: updatedWound,
        targetUserId: requesterUserId,
        privateNotifications: [updatedWound.openerUserId, updatedWound.accepterUserId]
          .filter(Boolean)
          .map((participantUserId) => ({
            to: participantUserId,
            messages: [buildCancelStatusFlex(updatedWound, 'ยกเลิกแผลแล้ว', '#22C55E', 'คู่ยอมรับการยกเลิก')]
          })),
        replyMessages: []
      };
    }

    if (postback.decision === 'reject') {
      const updatedWound = updateWoundEntry(wound.id, (entry) => ({
        ...entry,
        cancelRequestedByUserId: '',
        cancelRejectedByUserId: userId,
        cancelRejectedTimestamp: nowTimestamp,
        cancelRejectedTime: formatDate(nowTimestamp)
      }));

      return {
        type: 'cancel_rejected',
        wound: updatedWound,
        targetUserId: requesterUserId,
        privateNotifications: [
          {
            to: requesterUserId,
            messages: [buildCancelStatusFlex(updatedWound, 'ไม่ยกเลิกแผล', '#EF4444', 'คู่ไม่ยอมรับการยกเลิก')]
          }
        ],
        replyMessages: [buildCancelStatusFlex(updatedWound, 'ไม่ยกเลิกแผล', '#EF4444', 'คุณเลือกไม่ยกเลิก')]
      };
    }
  }

  return null;
}

function isRegisteredAdmin(userId, groupId) {
  if (!userId || !groupId) return false;

  return readAdmins().some((admin) => {
    if (admin.userId !== userId) return false;
    return admin.groupId === groupId;
  });
}

function handleQueueListMessage(event) {
  if (!isGroupTextMessage(event)) return null;

  const source = event.source || {};
  if (!isRegisteredAdmin(source.userId, source.groupId)) {
    return null;
  }

  const queueList = parseQueueListMessage(getMessageText(event));
  if (!queueList) {
    const rawText = getMessageText(event);
    if (!looksLikeQueueListAttempt(rawText)) return null;

    return {
      type: 'queue_list_failed',
      saved: false,
      error: 'missing_keyword',
      rawText,
      replyTexts: [buildQueueListErrorReply('missing_keyword')]
    };
  }
  if (queueList.error) {
    return {
      type: 'queue_list_failed',
      saved: false,
      error: queueList.error,
      rawText: queueList.rawText,
      replyTexts: [buildQueueListErrorReply(queueList.error)]
    };
  }

  const nowTimestamp = event.timestamp || Date.now();
  const entry = {
    id: `${source.groupId}:${nowTimestamp}:${event.message.id || ''}`,
    groupId: source.groupId || '',
    title: queueList.title,
    dateText: queueList.dateText,
    items: queueList.items,
    note: queueList.note,
    rawText: queueList.rawText,
    createdByUserId: source.userId || '',
    messageId: event.message.id || '',
    timestamp: nowTimestamp,
    time: formatDate(nowTimestamp)
  };
  const queueLists = readQueueLists().filter((list) => list.groupId !== entry.groupId);

  writeQueueLists([entry, ...queueLists]);
  return {
    ...entry,
    type: 'queue_list_saved',
    saved: true,
    replyTexts: [buildQueueListSavedReply(entry)]
  };
}

function handleQueueLookupCommand(event) {
  if (!isGroupTextMessage(event) || !parseQueueLookupKeyword(getMessageText(event))) {
    return null;
  }

  const source = event.source || {};
  const queueList = getLatestQueueListForGroup(source.groupId);

  return {
    type: 'queue_lookup',
    found: Boolean(queueList),
    queueList,
    replyTexts: [queueList ? buildQueueSummary(source.groupId) : NO_QUEUE_REPLY]
  };
}

function closeWoundsForRound(event, result, round) {
  const source = event.source || {};
  const nowTimestamp = event.timestamp || Date.now();
  let closedCount = 0;
  const settlements = [];
  const closedWounds = [];
  const wounds = readWounds().map((wound) => {
    if (wound.status !== 'active' || wound.groupId !== source.groupId || wound.roundId !== round.id) {
      return wound;
    }

    const settlement = {
      woundId: wound.id,
      orderId: wound.orderId,
      result,
      ...buildWoundSettlement(wound, result, round)
    };
    settlements.push(settlement);
    closedCount += 1;
    const closedWound = {
      ...wound,
      status: 'closed',
      result,
      ...settlement,
      closedByUserId: source.userId || '',
      closedMessageId: event.message.id || '',
      closedTimestamp: nowTimestamp,
      closedTime: formatDate(nowTimestamp)
    };
    closedWounds.push(closedWound);
    return closedWound;
  });
  let privateNotifications = [];

  if (closedCount > 0) {
    writeWounds(wounds);
    applySettlementCredits(settlements, nowTimestamp);
    privateNotifications = closedWounds.flatMap((wound) =>
      [wound.openerUserId, wound.accepterUserId]
        .filter(Boolean)
        .map((userId) => ({
          to: userId,
          messages: [buildWoundResultFlex(wound, userId)]
        }))
    );
  }

  return {
    closedCount,
    settlements,
    privateNotifications
  };
}

function cancelActiveWoundsForRound(event, round) {
  const source = event.source || {};
  const nowTimestamp = event.timestamp || Date.now();
  const cancelledWounds = [];
  const wounds = readWounds().map((wound) => {
    if (wound.status !== 'active' || wound.groupId !== source.groupId || wound.roundId !== round.id) {
      return wound;
    }

    const cancelledWound = {
      ...wound,
      status: 'cancelled',
      cancelReason: 'queue_cancelled',
      cancelledByUserId: source.userId || '',
      cancelledMessageId: event.message?.id || '',
      cancelledTimestamp: nowTimestamp,
      cancelledTime: formatDate(nowTimestamp),
      closedByUserId: source.userId || '',
      closedTimestamp: nowTimestamp,
      closedTime: formatDate(nowTimestamp)
    };
    cancelledWounds.push(cancelledWound);
    return cancelledWound;
  });

  if (cancelledWounds.length > 0) {
    writeWounds(wounds);
  }

  const notificationMessage = buildQueueCancelledPlayerMessage(round);
  const targetUserIds = [
    ...new Set(cancelledWounds.flatMap((wound) => [wound.openerUserId, wound.accepterUserId]).filter(Boolean))
  ];

  return {
    cancelledCount: cancelledWounds.length,
    cancelledWounds,
    privateNotifications: targetUserIds.map((userId) => ({
      to: userId,
      messages: [notificationMessage]
    }))
  };
}

function handleQueueAdminCommand(event, publicBaseUrl = '') {
  if (!isGroupTextMessage(event)) return null;

  const source = event.source || {};
  const messageText = getMessageText(event);
  if (!isRegisteredAdmin(source.userId, source.groupId)) {
    return null;
  }

  const nowTimestamp = event.timestamp || Date.now();
  if (parseFinishQueueCommand(messageText)) {
    const queueSummary = buildQueueSummary(source.groupId);
    const queueFinishedReply = buildQueueFinishedReply();
    clearQueueListForGroup(source.groupId);
    return {
      type: 'queue_day_finished',
      round: getLatestRoundForGroup(source.groupId),
      queueFinished: true,
      queueFinishedReply,
      replyTexts: [queueSummary, queueFinishedReply]
    };
  }

  const cancelQueueName = parseCancelQueueCommand(messageText);
  if (cancelQueueName) {
    const round = findCancellableRoundByName(source.groupId, cancelQueueName);
    if (!round) {
      return {
        type: 'round_cancel_not_found',
        blockedQueueName: cancelQueueName,
        replyTexts: [buildQueueCancelNotFoundReply(cancelQueueName)]
      };
    }

    const cancelledRound = {
      ...round,
      status: 'cancelled',
      cancelledByUserId: source.userId || '',
      cancelledMessageId: event.message.id || '',
      cancelledTimestamp: nowTimestamp,
      cancelledTime: formatDate(nowTimestamp),
      pendingResult: null
    };
    upsertRound(cancelledRound);
    const cancelResult = cancelActiveWoundsForRound(event, cancelledRound);

    return {
      type: 'round_cancelled',
      round: cancelledRound,
      cancelledCount: cancelResult.cancelledCount,
      cancelledWounds: cancelResult.cancelledWounds,
      privateNotifications: cancelResult.privateNotifications,
      replyTexts: [buildQueueCancelledReply(cancelledRound, cancelResult.cancelledCount)]
    };
  }

  const openCommand = parseOpenCommand(messageText) || parseWaitBuilderPriceCommand(messageText);
  if (openCommand) {
    const latestRound = getLatestRoundForGroup(source.groupId);
    if (isRoundAwaitingResult(latestRound)) {
      return {
        type: 'round_open_blocked_pending_result',
        round: latestRound,
        blockedQueueName: openCommand.queueName,
        replyTexts: [buildPendingResultReply(latestRound)]
      };
    }

    const priceFields = getPriceFields(openCommand.price);
    const round = {
      id: `${source.groupId}:${nowTimestamp}:${event.message.id || ''}`,
      groupId: source.groupId || '',
      queueName: openCommand.queueName,
      status: 'open',
      ...priceFields,
      noBuilderPrice: openCommand.noBuilderPrice,
      openedByUserId: source.userId || '',
      openedMessageId: event.message.id || '',
      openedTimestamp: nowTimestamp,
      openedTime: formatDate(nowTimestamp),
      closedByUserId: '',
      closedMessageId: '',
      closedTimestamp: null,
      closedTime: '',
      result: '',
      resultIcon: '',
      resultTimestamp: null,
      resultTime: '',
      pendingResult: null
    };

    upsertRound(round);
    return {
      type: 'round_opened',
      round,
      replyTexts: [buildOpenReply(round)]
    };
  }

  const roundReminderCommand = parseRoundReminderCommand(messageText);
  if (roundReminderCommand) {
    const round = getOpenRoundForGroup(source.groupId);
    if (!shouldSendRoundReminder(round, roundReminderCommand)) return null;

    return {
      type: 'round_manual_reminder',
      round,
      reminderMode: roundReminderCommand,
      replyTexts: [buildOpenReply(round)]
    };
  }

  if (parseNoBuilderAnnouncementCommand(messageText)) {
    const latestRound = getLatestRoundForGroup(source.groupId);
    let updatedRound = latestRound || null;

    if (isRoundAwaitingResult(latestRound)) {
      updatedRound = {
        ...latestRound,
        ...getPriceFields(null),
        noBuilderPrice: true,
        noBuilderAnnouncedByUserId: source.userId || '',
        noBuilderAnnouncedMessageId: event.message.id || '',
        noBuilderAnnouncedTimestamp: nowTimestamp,
        noBuilderAnnouncedTime: formatDate(nowTimestamp)
      };
      upsertRound(updatedRound);
    }

    return {
      type: 'no_builder_announced',
      round: updatedRound,
      replyTexts: [buildNoBuilderAnnouncementReply()]
    };
  }

  if (parseCloseCommand(messageText)) {
    const round = getOpenRoundForGroup(source.groupId);
    if (!round) return null;

    const closedRound = {
      ...round,
      status: 'closed',
      closedByUserId: source.userId || '',
      closedMessageId: event.message.id || '',
      closedTimestamp: nowTimestamp,
      closedTime: formatDate(nowTimestamp),
      pendingResult: null
    };

    upsertRound(closedRound);
    return {
      type: 'round_closed',
      round: closedRound,
      replyTexts: buildCloseReplyMessages(closedRound, publicBaseUrl)
    };
  }

  const builderPrice = parseBuilderPriceCommand(messageText);
  if (builderPrice) {
    const round = getLatestRoundForGroup(source.groupId);
    if (!isRoundAwaitingResult(round)) return null;

    const updatedRound = {
      ...round,
      ...getPriceFields(builderPrice),
      noBuilderPrice: false,
      priceSetByUserId: source.userId || '',
      priceSetMessageId: event.message.id || '',
      priceSetTimestamp: nowTimestamp,
      priceSetTime: formatDate(nowTimestamp)
    };

    upsertRound(updatedRound);
    return {
      type: 'builder_price_set',
      round: updatedRound,
      replyTexts: [buildOpenReply(updatedRound)]
    };
  }

  const result = parseResultCommand(messageText);
  if (!result) return null;

  const round = getLatestRoundForGroup(source.groupId);
  if (!round || round.status !== 'closed') return null;

  const pendingResult = round.pendingResult;
  const isConfirmation =
    pendingResult?.result === result &&
    pendingResult?.userId === source.userId &&
    nowTimestamp - pendingResult.timestamp <= RESULT_CONFIRMATION_WINDOW_MS;

  if (!isConfirmation) {
    const pendingRound = {
      ...round,
      pendingResult: {
        result,
        userId: source.userId || '',
        timestamp: nowTimestamp,
        expiresAt: nowTimestamp + RESULT_CONFIRMATION_WINDOW_MS
      }
    };

    upsertRound(pendingRound);
    return {
      type: 'result_confirmation_requested',
      round: pendingRound,
      result,
      replyTexts: [`⚠️ ยืนยันผล: ${result}  ส่ง แจ้งผล ${result} อีกครั้งเพื่อยืนยัน (หมดเวลาใน 5 นาที)`]
    };
  }

  const wasQueueFinishedBefore = isQueueListFinished(source.groupId);
  const resultIcon = getResultIcon(round, result);
  const resultedRound = {
    ...round,
    status: 'resulted',
    result,
    resultIcon,
    resultByUserId: source.userId || '',
    resultMessageId: event.message.id || '',
    resultTimestamp: nowTimestamp,
    resultTime: formatDate(nowTimestamp),
    pendingResult: null
  };
  const closeResult = closeWoundsForRound(event, result, resultedRound);
  const closedCount = closeResult.closedCount;

  upsertRound(resultedRound);
  const queueFinished = !wasQueueFinishedBefore && isQueueListFinished(source.groupId);
  const queueFinishedReply = queueFinished ? buildQueueFinishedReply() : '';
  const replyTexts = [buildResultConfirmedReply(resultedRound, result), buildQueueSummary(source.groupId)];
  if (queueFinishedReply) {
    replyTexts.push(queueFinishedReply);
  }

  return {
    type: 'result_confirmed',
    round: resultedRound,
    result,
    closedCount,
    settlements: closeResult.settlements,
    privateNotifications: closeResult.privateNotifications,
    queueFinished,
    queueFinishedReply,
    replyTexts
  };
}

ensureJsonFile(LOG_FILE);
ensureJsonFile(ADMIN_FILE);
ensureJsonFile(MESSAGE_FILE);
ensureJsonFile(WOUND_FILE);
ensureJsonFile(ROUND_FILE);
ensureJsonFile(QUEUE_LIST_FILE);
ensureJsonFile(CREDIT_FILE);
ensureJsonFile(WITHDRAWAL_FILE);
ensureJsonFile(BLACKLIST_FILE);
ensureJsonFile(BLACKLIST_MODE_FILE);

app.get(CLOSE_IMAGE_ROUTE, (req, res) => {
  if (!fs.existsSync(CLOSE_IMAGE_FILE)) {
    res.status(404).send('close image not found');
    return;
  }

  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.sendFile(CLOSE_IMAGE_FILE);
});

// LINE signature verification needs the exact raw request body.
app.post(
  '/webhook',
  express.raw({ type: '*/*', limit: '2mb' }),
  verifyLineSignature,
  async (req, res) => {
    const replyJobs = [];

    try {
      const bodyText = req.body ? req.body.toString('utf8') : '{}';
      const payload = bodyText ? JSON.parse(bodyText) : {};
      const events = Array.isArray(payload.events) ? payload.events : [];
      const publicBaseUrl = getPublicBaseUrl(req);

      if (events.length > 0) {
        const newLogs = [];

        for (const event of events) {
          const logEntry = createLogEntry(event);
          const adminEntry = upsertAdminFromEvent(event);
          const removedAdminEntry = removeAdminFromEvent(event);
          const bindEntry = bindGroupFromEvent(event);
          const queueListEntry = handleQueueListMessage(event);
          const queueLookupAction = handleQueueLookupCommand(event);
          const queueAction = handleQueueAdminCommand(event, publicBaseUrl);
          const groupAdminAction = await handleGroupAdminLookupCommand(event);
          const blackAccountAction = await handleBlackAccountCommand(event);
          const behindHouseAction = handleBehindHouseCommand(event);
          const betGroupInviteAction = handleBetGroupInviteEvent(event);
          const trackedMessage = trackGroupMessage(event);
          const repeatedTradeAction = handleRepeatedTradeWarning(trackedMessage);
          const woundAction = await createWoundFromReply(event);
          const woundCancelAction = await handleWoundCancelPostback(event);
          const unsendAction = await handleUnsendEvent(event);
          const slipCreditAction = await handleSlipCreditEvent(event);
          const creditAction = slipCreditAction || handleCreditEvent(event, publicBaseUrl);

          if (adminEntry) {
            logEntry.adminRegistered = true;
            logEntry.adminGroupName = adminEntry.groupName;
            logEntry.adminPriority = adminEntry.priority;
            logEntry.adminReplyTexts = Array.isArray(adminEntry.replyTexts) ? adminEntry.replyTexts : [];

            if (Array.isArray(adminEntry.replyTexts) && adminEntry.replyTexts.length > 0) {
              replyJobs.push(replyToLine(event.replyToken, adminEntry.replyTexts));
            }
          }

          if (removedAdminEntry) {
            logEntry.adminRemoved = removedAdminEntry.removed;
            logEntry.adminRemovedGroupName = removedAdminEntry.groupName;
            logEntry.adminRemovedCount = removedAdminEntry.removedCount;

            if (Array.isArray(removedAdminEntry.replyTexts) && removedAdminEntry.replyTexts.length > 0) {
              replyJobs.push(replyToLine(event.replyToken, removedAdminEntry.replyTexts));
            }
          }

          if (bindEntry) {
            logEntry.groupBindRequested = true;
            logEntry.groupBindSuccess = bindEntry.bound;
            logEntry.boundGroupName = bindEntry.groupName;
            logEntry.boundGroupId = bindEntry.groupId;
            logEntry.groupBindReplyTexts = Array.isArray(bindEntry.replyTexts) ? bindEntry.replyTexts : [];

            if (Array.isArray(bindEntry.replyTexts) && bindEntry.replyTexts.length > 0) {
              replyJobs.push(replyToLine(event.replyToken, bindEntry.replyTexts));
            }
          }

          if (queueListEntry) {
            logEntry.queueListSaved = queueListEntry.saved !== false;
            logEntry.queueListFailed = queueListEntry.saved === false;
            logEntry.queueListError = queueListEntry.error || '';
            logEntry.queueListTitle = queueListEntry.title || '';
            logEntry.queueListItemCount = Array.isArray(queueListEntry.items) ? queueListEntry.items.length : 0;
            logEntry.queueListReplyTexts = Array.isArray(queueListEntry.replyTexts) ? queueListEntry.replyTexts : [];

            if (Array.isArray(queueListEntry.replyTexts) && queueListEntry.replyTexts.length > 0) {
              replyJobs.push(replyToLine(event.replyToken, queueListEntry.replyTexts));
            }
          }

          if (queueLookupAction) {
            logEntry.queueLookupRequested = true;
            logEntry.queueLookupFound = queueLookupAction.found;
            logEntry.queueLookupReplyTexts = Array.isArray(queueLookupAction.replyTexts) ? queueLookupAction.replyTexts : [];

            if (Array.isArray(queueLookupAction.replyTexts) && queueLookupAction.replyTexts.length > 0) {
              replyJobs.push(replyToLine(event.replyToken, queueLookupAction.replyTexts));
            }
          }

          if (queueAction) {
            logEntry.queueAction = queueAction.type;
            logEntry.queueName = queueAction.round?.queueName || '';
            logEntry.result = queueAction.result || '';
            logEntry.blockedQueueName = queueAction.blockedQueueName || '';
            logEntry.queueFinished = Boolean(queueAction.queueFinished);
            logEntry.queueReplyTextCount = Array.isArray(queueAction.replyTexts) ? queueAction.replyTexts.length : 0;
            logEntry.queueReplyTexts = Array.isArray(queueAction.replyTexts) ? queueAction.replyTexts : [];
            logEntry.queueFinishedReply = queueAction.queueFinishedReply || '';

            if (typeof queueAction.closedCount === 'number') {
              logEntry.woundsClosed = queueAction.closedCount;
            }

            if (typeof queueAction.cancelledCount === 'number') {
              logEntry.cancelledCount = queueAction.cancelledCount;
            }

            if (Array.isArray(queueAction.settlements)) {
              logEntry.woundSettlementCount = queueAction.settlements.filter(
                (settlement) => settlement.settlementStatus === 'settled'
              ).length;
              logEntry.woundDrawCount = queueAction.settlements.filter(
                (settlement) => settlement.settlementStatus === 'draw'
              ).length;
              logEntry.systemFeeAmount = roundPoints(
                queueAction.settlements.reduce((sum, settlement) => sum + (Number(settlement.systemFeeAmount) || 0), 0)
              );
            }

            if (Array.isArray(queueAction.privateNotifications) && queueAction.privateNotifications.length > 0) {
              logEntry.settlementPrivateNotifications = queueAction.privateNotifications;

              for (const notification of queueAction.privateNotifications) {
                replyJobs.push(pushToLine(notification.to, notification.messages));
              }
            }

            if (Array.isArray(queueAction.replyTexts) && queueAction.replyTexts.length > 0) {
              replyJobs.push(replyToLine(event.replyToken, queueAction.replyTexts));
            }
          }

          if (groupAdminAction) {
            logEntry.groupAdminLookupRequested = true;
            logEntry.groupAdminCount = groupAdminAction.adminCount || 0;
            logEntry.groupAdminReplyMessages = Array.isArray(groupAdminAction.replyMessages)
              ? groupAdminAction.replyMessages
              : [];

            if (Array.isArray(groupAdminAction.replyMessages) && groupAdminAction.replyMessages.length > 0) {
              replyJobs.push(replyToLine(event.replyToken, groupAdminAction.replyMessages));
            }
          }

          if (blackAccountAction) {
            logEntry.blackAccountAction = blackAccountAction.type;
            logEntry.blackAccountGroupName = blackAccountAction.groupName || '';
            logEntry.blackAccountTargetUserIds = Array.isArray(blackAccountAction.targets)
              ? blackAccountAction.targets.map((target) => target.userId)
              : [];
            logEntry.blackAccountTargetNames = Array.isArray(blackAccountAction.targets)
              ? blackAccountAction.targets.map((target) => target.displayName || target.userId)
              : [];
            logEntry.blackAccountReplyTexts = Array.isArray(blackAccountAction.replyTexts)
              ? blackAccountAction.replyTexts
              : [];

            if (Array.isArray(blackAccountAction.replyTexts) && blackAccountAction.replyTexts.length > 0) {
              replyJobs.push(replyToLine(event.replyToken, blackAccountAction.replyTexts));
            }
          }

          if (behindHouseAction) {
            logEntry.behindHouseRequested = true;
            logEntry.groupPaymentAccountRequested = behindHouseAction.type === 'group_payment_account';
            logEntry.behindHouseLink = behindHouseAction.link || '';
            logEntry.behindHouseReplyTexts = Array.isArray(behindHouseAction.replyTexts)
              ? behindHouseAction.replyTexts
              : [];
            logEntry.behindHouseReplyMessages = Array.isArray(behindHouseAction.replyMessages)
              ? behindHouseAction.replyMessages
              : [];

            const behindHouseReplyMessages = [
              ...(Array.isArray(behindHouseAction.replyTexts) ? behindHouseAction.replyTexts : []),
              ...(Array.isArray(behindHouseAction.replyMessages) ? behindHouseAction.replyMessages : [])
            ];

            if (behindHouseReplyMessages.length > 0) {
              replyJobs.push(replyToLine(event.replyToken, behindHouseReplyMessages));
            }
          }

          if (betGroupInviteAction) {
            logEntry.betGroupInviteRequested = true;
            logEntry.betGroupInviteReplyTexts = Array.isArray(betGroupInviteAction.replyTexts)
              ? betGroupInviteAction.replyTexts
              : [];

            if (logEntry.betGroupInviteReplyTexts.length > 0) {
              replyJobs.push(replyToLine(event.replyToken, logEntry.betGroupInviteReplyTexts));
            }
          }

          if (woundAction?.type === 'wound_created') {
            const woundEntry = woundAction.wound;
            logEntry.woundCreated = true;
            logEntry.woundId = woundEntry.id;
            logEntry.woundOrderId = woundEntry.orderId;
            logEntry.requiredCredit = woundEntry.requiredCredit;
            logEntry.woundNotificationTargets = woundAction.notificationTargets;
            logEntry.openerDisplayName = woundEntry.openerDisplayName || '';
            logEntry.accepterDisplayName = woundEntry.accepterDisplayName || '';
            logEntry.woundPrivateNotificationMessages = (woundAction.privateNotifications || []).map(
              (notification) => notification.messages
            );

            for (const notification of woundAction.privateNotifications || []) {
              replyJobs.push(pushToLine(notification.to, notification.messages));
            }
          }

          if (woundCancelAction) {
            logEntry.woundCancelAction = woundCancelAction.type;
            logEntry.woundId = woundCancelAction.wound?.id || '';
            logEntry.woundOrderId = woundCancelAction.wound?.orderId || '';
            logEntry.woundCancelTargetUserId = woundCancelAction.targetUserId || '';
            logEntry.woundCancelPrivateMessages = (woundCancelAction.privateNotifications || []).map(
              (notification) => notification.messages
            );
            logEntry.woundCancelReplyMessages = woundCancelAction.replyMessages || [];

            for (const notification of woundCancelAction.privateNotifications || []) {
              replyJobs.push(pushToLine(notification.to, notification.messages));
            }

            if (Array.isArray(woundCancelAction.replyMessages) && woundCancelAction.replyMessages.length > 0) {
              replyJobs.push(replyToLine(event.replyToken, woundCancelAction.replyMessages));
            }
          }

          if (woundAction?.type === 'pair_pending') {
            logEntry.woundPending = true;
            logEntry.openMessageId = woundAction.openMessageId;
            logEntry.openerUserId = woundAction.openerUserId;
            logEntry.accepterUserId = woundAction.accepterUserId;
            logEntry.requiredCredit = woundAction.requiredCredit;
          }

          if (woundAction?.type === 'wound_rejected') {
            logEntry.woundRejectedReason = woundAction.reason;
            logEntry.openMessageId = woundAction.openMessageId;
            logEntry.openerUserId = woundAction.openerUserId;
            logEntry.accepterUserId = woundAction.accepterUserId;
            logEntry.requiredCredit = woundAction.requiredCredit;
            logEntry.openerAvailableCredit = woundAction.openerAvailableCredit;
            logEntry.accepterAvailableCredit = woundAction.accepterAvailableCredit;
            logEntry.insufficientCreditUsers = woundAction.insufficientCreditUsers || [];
            logEntry.existingWoundId = woundAction.existingWoundId || '';
          }

          if (trackedMessage?.trade) {
            logEntry.tradeKeyword = trackedMessage.trade.keyword;
            logEntry.tradeAmount = trackedMessage.trade.amount;
          }

          if (repeatedTradeAction) {
            logEntry.repeatedTradeWarning = true;
            logEntry.repeatedTradeCount = repeatedTradeAction.repeatedTradeCount || 0;
            logEntry.repeatedTradeReplyTexts = Array.isArray(repeatedTradeAction.replyTexts)
              ? repeatedTradeAction.replyTexts
              : [];

            if (logEntry.repeatedTradeReplyTexts.length > 0) {
              replyJobs.push(replyToLine(event.replyToken, logEntry.repeatedTradeReplyTexts));
            }
          }

          if (unsendAction) {
            logEntry.unsendDetected = true;
            logEntry.unsendMessageId = unsendAction.messageId;
            logEntry.cancelledMessage = unsendAction.cancelledMessage;
            logEntry.unsendDisplayName = unsendAction.displayName;
            logEntry.unsendNotification = unsendAction.notification;
          }

          if (creditAction) {
            logEntry.creditAction = creditAction.type;
            logEntry.creditAmount = creditAction.amount || 0;
            logEntry.creditBalance = creditAction.creditBalance;
            logEntry.activeWoundAmount = creditAction.activeWoundAmount;
            logEntry.activeWoundCount = creditAction.activeWoundCount || 0;
            logEntry.withdrawableBalance = creditAction.withdrawableBalance;
            logEntry.slipTransRef = creditAction.slipTransRef || '';
            logEntry.slipReceiverBank = creditAction.slipReceiverBank || '';
            logEntry.slipErrorCode = creditAction.slipErrorCode || '';
            logEntry.withdrawalId = creditAction.withdrawalId || '';
            logEntry.creditReplyMessages = Array.isArray(creditAction.replyMessages) ? creditAction.replyMessages : [];

            if (Array.isArray(creditAction.replyMessages) && creditAction.replyMessages.length > 0) {
              replyJobs.push(replyToLine(event.replyToken, creditAction.replyMessages));
            }
          }

          newLogs.push(logEntry);
        }
        const logs = readLogs();
        writeLogs([...newLogs, ...logs]);
      }

      if (replyJobs.length > 0) {
        const replyJobResults = Promise.allSettled(replyJobs).then((results) => {
          const rejectedCount = results.filter((result) => result.status === 'rejected').length;
          if (rejectedCount > 0) {
            console.error(`LINE reply/push background jobs failed: ${rejectedCount}`);
          }
        });
        if (process.env.NODE_ENV === 'test') {
          await replyJobResults;
        }
      }
    } catch (error) {
      console.error('Webhook payload could not be processed:', error.message);
    }

    return res.sendStatus(200);
  }
);

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.get('/', (req, res) => {
  const webhookUrl = `${req.protocol}://${req.get('host')}/webhook`;

  res.send(`<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>LINE Webhook Logger</title>
  <style>
    body {
      margin: 0;
      font-family: Arial, sans-serif;
      color: #1f2937;
      background: #f3f4f6;
    }
    main {
      max-width: 760px;
      margin: 48px auto;
      padding: 32px;
      background: #ffffff;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      box-shadow: 0 12px 32px rgba(15, 23, 42, 0.08);
    }
    h1 {
      margin-top: 0;
      color: #111827;
    }
    code {
      display: block;
      padding: 14px;
      overflow-x: auto;
      background: #111827;
      color: #f9fafb;
      border-radius: 6px;
    }
    a {
      color: #047857;
      font-weight: 700;
      text-decoration: none;
    }
    a:hover {
      text-decoration: underline;
    }
    .links {
      display: flex;
      flex-wrap: wrap;
      gap: 16px;
      margin-top: 24px;
    }
  </style>
</head>
<body>
  <main>
    <h1>LINE Webhook Logger</h1>
    <p>Webhook URL</p>
    <code>${escapeHtml(webhookUrl)}</code>
    <div class="links">
      <a href="/logs">View Logs</a>
      <a href="/admins">Admins</a>
      <a href="/wounds">Wounds</a>
      <a href="/rounds">Rounds</a>
      <a href="/queue-lists">Queue Lists</a>
      <a href="/credits">Credits</a>
      <a href="/broadcasts">Broadcasts</a>
      <a href="/api/logs">JSON API</a>
      <a href="/webhook">Webhook Path</a>
    </div>
  </main>
</body>
</html>`);
});

app.get('/logs', requireCreditsAdminAuth, (req, res) => {
  const logs = readLogs();
  const rows = logs
    .map(
      (log) => `<tr>
        <td>${escapeHtml(log.time)}</td>
        <td>${escapeHtml(log.eventType)}</td>
        <td>${escapeHtml(log.sourceType)}</td>
        <td>${escapeHtml(log.userId)}</td>
        <td>${escapeHtml(log.groupId)}</td>
        <td>${escapeHtml(log.roomId)}</td>
        <td>${escapeHtml(log.adminRegistered ? `${log.message} -> admin: ${log.adminGroupName} #${log.adminPriority}` : log.message)}</td>
      </tr>`
    )
    .join('');

  res.send(`<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>LINE Webhook Logs</title>
  <style>
    body {
      margin: 0;
      font-family: Arial, sans-serif;
      color: #1f2937;
      background: #f3f4f6;
    }
    main {
      max-width: 1180px;
      margin: 32px auto;
      padding: 0 20px 40px;
    }
    .topbar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      margin-bottom: 18px;
    }
    h1 {
      margin: 0;
      color: #111827;
    }
    .actions {
      display: flex;
      gap: 10px;
    }
    button, a.button {
      border: 0;
      border-radius: 6px;
      padding: 10px 14px;
      color: #ffffff;
      background: #047857;
      font-weight: 700;
      cursor: pointer;
      text-decoration: none;
    }
    button.danger {
      background: #b91c1c;
    }
    .table-wrap {
      overflow-x: auto;
      background: #ffffff;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      box-shadow: 0 10px 24px rgba(15, 23, 42, 0.06);
    }
    table {
      width: 100%;
      border-collapse: collapse;
      min-width: 920px;
    }
    th, td {
      padding: 12px 14px;
      border-bottom: 1px solid #e5e7eb;
      text-align: left;
      vertical-align: top;
      font-size: 14px;
    }
    th {
      background: #f9fafb;
      color: #374151;
      font-size: 13px;
      text-transform: uppercase;
    }
    tr:last-child td {
      border-bottom: 0;
    }
    .empty {
      padding: 28px;
      color: #6b7280;
      text-align: center;
    }
    @media (max-width: 720px) {
      .topbar {
        align-items: flex-start;
        flex-direction: column;
      }
      .actions {
        width: 100%;
      }
      button, a.button {
        flex: 1;
        text-align: center;
      }
    }
  </style>
</head>
<body>
  <main>
    <div class="topbar">
      <h1>LINE Webhook Logs</h1>
      <div class="actions">
        <a class="button" href="/logs">Refresh</a>
        <button class="danger" type="button" onclick="clearLogs()">Clear Logs</button>
      </div>
    </div>
    <div class="table-wrap">
      ${
        rows
          ? `<table>
              <thead>
                <tr>
                  <th>เวลา</th>
                  <th>Event Type</th>
                  <th>Source Type</th>
                  <th>User ID</th>
                  <th>Group ID</th>
                  <th>Room ID</th>
                  <th>Message</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>`
          : '<div class="empty">No logs yet.</div>'
      }
    </div>
  </main>
  <script>
    async function clearLogs() {
      if (!confirm('Clear all logs?')) return;

      const response = await fetch('/api/logs', { method: 'DELETE' });
      if (response.ok) {
        window.location.reload();
      } else {
        alert('Unable to clear logs.');
      }
    }
  </script>
</body>
</html>`);
});

app.get('/admins', requireCreditsAdminAuth, (req, res) => {
  const admins = readAdmins();
  const rows = admins
    .map(
      (admin) => `<tr>
        <td>${escapeHtml(admin.time)}</td>
        <td>${escapeHtml(admin.groupName)}</td>
        <td>${escapeHtml(admin.priority)}</td>
        <td>${escapeHtml(admin.userId)}</td>
        <td>${escapeHtml(admin.groupId)}</td>
        <td>${escapeHtml(admin.adminKeyword)}</td>
      </tr>`
    )
    .join('');

  res.send(`<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>LINE Webhook Admins</title>
  <style>
    body {
      margin: 0;
      font-family: Arial, sans-serif;
      color: #1f2937;
      background: #f3f4f6;
    }
    main {
      max-width: 980px;
      margin: 32px auto;
      padding: 0 20px 40px;
    }
    .topbar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      margin-bottom: 18px;
    }
    h1 {
      margin: 0;
      color: #111827;
    }
    .actions {
      display: flex;
      gap: 10px;
    }
    button, a.button {
      border: 0;
      border-radius: 6px;
      padding: 10px 14px;
      color: #ffffff;
      background: #047857;
      font-weight: 700;
      cursor: pointer;
      text-decoration: none;
    }
    button.danger {
      background: #b91c1c;
    }
    .hint {
      margin: 0 0 18px;
      color: #4b5563;
    }
    code {
      padding: 2px 6px;
      background: #e5e7eb;
      border-radius: 4px;
    }
    .table-wrap {
      overflow-x: auto;
      background: #ffffff;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      box-shadow: 0 10px 24px rgba(15, 23, 42, 0.06);
    }
    table {
      width: 100%;
      border-collapse: collapse;
      min-width: 760px;
    }
    th, td {
      padding: 12px 14px;
      border-bottom: 1px solid #e5e7eb;
      text-align: left;
      vertical-align: top;
      font-size: 14px;
    }
    th {
      background: #f9fafb;
      color: #374151;
      font-size: 13px;
      text-transform: uppercase;
    }
    tr:last-child td {
      border-bottom: 0;
    }
    .empty {
      padding: 28px;
      color: #6b7280;
      text-align: center;
    }
    @media (max-width: 720px) {
      .topbar {
        align-items: flex-start;
        flex-direction: column;
      }
      .actions {
        width: 100%;
      }
      button, a.button {
        flex: 1;
        text-align: center;
      }
    }
  </style>
</head>
<body>
  <main>
    <div class="topbar">
      <h1>LINE Admins</h1>
      <div class="actions">
        <a class="button" href="/admins">Refresh</a>
        <a class="button" href="/logs">Logs</a>
        <button class="danger" type="button" onclick="clearAdmins()">Clear Admins</button>
      </div>
    </div>
    <p class="hint">Private chat command: <code>${escapeHtml(ADMIN_KEYWORD)} : group name1</code>, <code>${escapeHtml(ADMIN_KEYWORD)} : group name2</code></p>
    <div class="table-wrap">
      ${
        rows
          ? `<table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Group Name</th>
                  <th>Priority</th>
                  <th>User ID</th>
                  <th>Group ID</th>
                  <th>Keyword</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>`
          : '<div class="empty">No admins yet.</div>'
      }
    </div>
  </main>
  <script>
    async function clearAdmins() {
      if (!confirm('Clear all admins?')) return;

      const response = await fetch('/api/admins', { method: 'DELETE' });
      if (response.ok) {
        window.location.reload();
      } else {
        alert('Unable to clear admins.');
      }
    }
  </script>
</body>
</html>`);
});

app.get('/wounds', requireCreditsAdminAuth, (req, res) => {
  const wounds = readWounds();
  const rows = wounds
    .map(
      (wound) => `<tr>
        <td>${escapeHtml(wound.status)}</td>
        <td>${escapeHtml(wound.openedTime)}</td>
        <td>${escapeHtml(wound.groupId)}</td>
        <td>${escapeHtml(wound.openerUserId)}</td>
        <td>${escapeHtml(wound.accepterUserId)}</td>
        <td>${escapeHtml(wound.openText)}</td>
        <td>${escapeHtml(wound.acceptText)}</td>
        <td>${escapeHtml(wound.result)}</td>
        <td>${escapeHtml(wound.closedByUserId)}</td>
      </tr>`
    )
    .join('');

  res.send(`<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>LINE Wounds</title>
  <style>
    body {
      margin: 0;
      font-family: Arial, sans-serif;
      color: #1f2937;
      background: #f3f4f6;
    }
    main {
      max-width: 1280px;
      margin: 32px auto;
      padding: 0 20px 40px;
    }
    .topbar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      margin-bottom: 18px;
    }
    h1 {
      margin: 0;
      color: #111827;
    }
    .actions {
      display: flex;
      gap: 10px;
    }
    button, a.button {
      border: 0;
      border-radius: 6px;
      padding: 10px 14px;
      color: #ffffff;
      background: #047857;
      font-weight: 700;
      cursor: pointer;
      text-decoration: none;
    }
    button.danger {
      background: #b91c1c;
    }
    .hint {
      margin: 0 0 18px;
      color: #4b5563;
    }
    code {
      padding: 2px 6px;
      background: #e5e7eb;
      border-radius: 4px;
    }
    .table-wrap {
      overflow-x: auto;
      background: #ffffff;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      box-shadow: 0 10px 24px rgba(15, 23, 42, 0.06);
    }
    table {
      width: 100%;
      border-collapse: collapse;
      min-width: 1120px;
    }
    th, td {
      padding: 12px 14px;
      border-bottom: 1px solid #e5e7eb;
      text-align: left;
      vertical-align: top;
      font-size: 14px;
    }
    th {
      background: #f9fafb;
      color: #374151;
      font-size: 13px;
      text-transform: uppercase;
    }
    tr:last-child td {
      border-bottom: 0;
    }
    .empty {
      padding: 28px;
      color: #6b7280;
      text-align: center;
    }
    @media (max-width: 720px) {
      .topbar {
        align-items: flex-start;
        flex-direction: column;
      }
      .actions {
        width: 100%;
      }
      button, a.button {
        flex: 1;
        text-align: center;
      }
    }
  </style>
</head>
<body>
  <main>
    <div class="topbar">
      <h1>LINE Wounds</h1>
      <div class="actions">
        <a class="button" href="/wounds">Refresh</a>
        <a class="button" href="/logs">Logs</a>
        <a class="button" href="/admins">Admins</a>
        <button class="danger" type="button" onclick="clearWounds()">Clear Wounds</button>
      </div>
    </div>
    <p class="hint">Reply accept keywords: <code>${escapeHtml(ACCEPT_KEYWORDS.join(', '))}</code>. Admin close command: <code>แจ้งผล 50</code></p>
    <div class="table-wrap">
      ${
        rows
          ? `<table>
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Opened</th>
                  <th>Group ID</th>
                  <th>Opener</th>
                  <th>Accepter</th>
                  <th>Open Message</th>
                  <th>Accept Message</th>
                  <th>Result</th>
                  <th>Closed By</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>`
          : '<div class="empty">No wounds yet.</div>'
      }
    </div>
  </main>
  <script>
    async function clearWounds() {
      if (!confirm('Clear all wounds?')) return;

      const response = await fetch('/api/wounds', { method: 'DELETE' });
      if (response.ok) {
        window.location.reload();
      } else {
        alert('Unable to clear wounds.');
      }
    }
  </script>
</body>
</html>`);
});

app.get('/rounds', requireCreditsAdminAuth, (req, res) => {
  const rounds = readRounds();
  const rows = rounds
    .map(
      (round) => `<tr>
        <td>${escapeHtml(round.status)}</td>
        <td>${escapeHtml(round.openedTime)}</td>
        <td>${escapeHtml(round.groupId)}</td>
        <td>${escapeHtml(round.queueName)}</td>
        <td>${escapeHtml(round.priceRaw || (round.noBuilderPrice ? 'ช่างไม่ตี' : ''))}</td>
        <td>${escapeHtml(round.closedTime)}</td>
        <td>${escapeHtml(round.result)}</td>
        <td>${escapeHtml(round.resultIcon)}</td>
      </tr>`
    )
    .join('');

  res.send(`<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>LINE Queue Rounds</title>
  <style>
    body {
      margin: 0;
      font-family: Arial, sans-serif;
      color: #1f2937;
      background: #f3f4f6;
    }
    main {
      max-width: 1180px;
      margin: 32px auto;
      padding: 0 20px 40px;
    }
    .topbar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      margin-bottom: 18px;
    }
    h1 {
      margin: 0;
      color: #111827;
    }
    .actions {
      display: flex;
      gap: 10px;
    }
    button, a.button {
      border: 0;
      border-radius: 6px;
      padding: 10px 14px;
      color: #ffffff;
      background: #047857;
      font-weight: 700;
      cursor: pointer;
      text-decoration: none;
    }
    button.danger {
      background: #b91c1c;
    }
    .table-wrap {
      overflow-x: auto;
      background: #ffffff;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      box-shadow: 0 10px 24px rgba(15, 23, 42, 0.06);
    }
    table {
      width: 100%;
      border-collapse: collapse;
      min-width: 940px;
    }
    th, td {
      padding: 12px 14px;
      border-bottom: 1px solid #e5e7eb;
      text-align: left;
      vertical-align: top;
      font-size: 14px;
    }
    th {
      background: #f9fafb;
      color: #374151;
      font-size: 13px;
      text-transform: uppercase;
    }
    tr:last-child td {
      border-bottom: 0;
    }
    .empty {
      padding: 28px;
      color: #6b7280;
      text-align: center;
    }
  </style>
</head>
<body>
  <main>
    <div class="topbar">
      <h1>LINE Queue Rounds</h1>
      <div class="actions">
        <a class="button" href="/rounds">Refresh</a>
        <a class="button" href="/wounds">Wounds</a>
        <button class="danger" type="button" onclick="clearRounds()">Clear Rounds</button>
      </div>
    </div>
    <div class="table-wrap">
      ${
        rows
          ? `<table>
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Opened</th>
                  <th>Group ID</th>
                  <th>Queue Name</th>
                  <th>Builder Price</th>
                  <th>Closed</th>
                  <th>Result</th>
                  <th>Icon</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>`
          : '<div class="empty">No rounds yet.</div>'
      }
    </div>
  </main>
  <script>
    async function clearRounds() {
      if (!confirm('Clear all rounds?')) return;

      const response = await fetch('/api/rounds', { method: 'DELETE' });
      if (response.ok) {
        window.location.reload();
      } else {
        alert('Unable to clear rounds.');
      }
    }
  </script>
</body>
</html>`);
});

app.get('/queue-lists', requireCreditsAdminAuth, (req, res) => {
  const queueLists = readQueueLists();
  const rows = queueLists
    .map((queueList) => {
      const items = queueList.items.map((item) => `${item.order}. ${item.name}`).join('<br>');

      return `<tr>
        <td>${escapeHtml(queueList.time)}</td>
        <td>${escapeHtml(queueList.groupId)}</td>
        <td>${escapeHtml(queueList.title)}</td>
        <td>${escapeHtml(queueList.dateText)}</td>
        <td>${items}</td>
        <td>${escapeHtml(queueList.note)}</td>
      </tr>`;
    })
    .join('');

  res.send(`<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>LINE Queue Lists</title>
  <style>
    body {
      margin: 0;
      font-family: Arial, sans-serif;
      color: #1f2937;
      background: #f3f4f6;
    }
    main {
      max-width: 1180px;
      margin: 32px auto;
      padding: 0 20px 40px;
    }
    .topbar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      margin-bottom: 18px;
    }
    h1 {
      margin: 0;
      color: #111827;
    }
    .actions {
      display: flex;
      gap: 10px;
    }
    button, a.button {
      border: 0;
      border-radius: 6px;
      padding: 10px 14px;
      color: #ffffff;
      background: #047857;
      font-weight: 700;
      cursor: pointer;
      text-decoration: none;
    }
    button.danger {
      background: #b91c1c;
    }
    .table-wrap {
      overflow-x: auto;
      background: #ffffff;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      box-shadow: 0 10px 24px rgba(15, 23, 42, 0.06);
    }
    table {
      width: 100%;
      border-collapse: collapse;
      min-width: 980px;
    }
    th, td {
      padding: 12px 14px;
      border-bottom: 1px solid #e5e7eb;
      text-align: left;
      vertical-align: top;
      font-size: 14px;
    }
    th {
      background: #f9fafb;
      color: #374151;
      font-size: 13px;
      text-transform: uppercase;
    }
    tr:last-child td {
      border-bottom: 0;
    }
    .empty {
      padding: 28px;
      color: #6b7280;
      text-align: center;
    }
  </style>
</head>
<body>
  <main>
    <div class="topbar">
      <h1>LINE Queue Lists</h1>
      <div class="actions">
        <a class="button" href="/queue-lists">Refresh</a>
        <a class="button" href="/rounds">Rounds</a>
        <button class="danger" type="button" onclick="clearQueueLists()">Clear Queue Lists</button>
      </div>
    </div>
    <div class="table-wrap">
      ${
        rows
          ? `<table>
              <thead>
                <tr>
                  <th>Saved</th>
                  <th>Group ID</th>
                  <th>Title</th>
                  <th>Date</th>
                  <th>Items</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>`
          : '<div class="empty">No queue lists yet.</div>'
      }
    </div>
  </main>
  <script>
    async function clearQueueLists() {
      if (!confirm('Clear all queue lists?')) return;

      const response = await fetch('/api/queue-lists', { method: 'DELETE' });
      if (response.ok) {
        window.location.reload();
      } else {
        alert('Unable to clear queue lists.');
      }
    }
  </script>
</body>
</html>`);
});

function buildCreditsLoginPage(hasError = false) {
  return `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Credits Login</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      font-family: Arial, sans-serif;
      color: #111827;
      background: #eef2f7;
    }
    main {
      width: 100%;
      max-width: 390px;
      padding: 22px;
      background: #ffffff;
      border: 1px solid #e5e7eb;
      border-radius: 12px;
      box-shadow: 0 14px 30px rgba(15, 23, 42, 0.10);
    }
    h1 { margin: 0 0 6px; font-size: 26px; }
    p { margin: 0 0 18px; color: #6b7280; }
    label {
      display: block;
      margin: 14px 0 6px;
      color: #374151;
      font-weight: 700;
      font-size: 14px;
    }
    input {
      width: 100%;
      min-height: 46px;
      border: 1px solid #d1d5db;
      border-radius: 10px;
      padding: 10px 12px;
      font-size: 16px;
    }
    button {
      width: 100%;
      min-height: 48px;
      margin-top: 18px;
      border: 0;
      border-radius: 10px;
      color: #ffffff;
      background: #047857;
      font-size: 16px;
      font-weight: 700;
      cursor: pointer;
    }
    .error {
      margin: 0 0 12px;
      padding: 10px 12px;
      border-radius: 8px;
      color: #991b1b;
      background: #fee2e2;
      font-weight: 700;
    }
  </style>
</head>
<body>
  <main>
    <h1>LINE Credits</h1>
    <p>เข้าสู่ระบบสำหรับแอดมิน</p>
    ${hasError ? '<div class="error">รหัสไม่ถูกต้อง</div>' : ''}
    <form method="post" action="/credits/login">
      <label for="username">ชื่อผู้ใช้</label>
      <input id="username" name="username" autocomplete="username" required>
      <label for="password">รหัสผ่าน</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required>
      <button type="submit">เข้าสู่ระบบ</button>
    </form>
  </main>
</body>
</html>`;
}

function getBroadcastTargetOptions() {
  const seen = new Set();
  const options = [];

  readAdmins().forEach((admin) => {
    const groupId = String(admin.groupId || '').trim();
    if (!groupId || seen.has(groupId)) return;

    seen.add(groupId);
    options.push({
      value: groupId,
      label: `${admin.groupName || 'กลุ่ม'} (${groupId})`
    });
  });

  readCredits().forEach((credit) => {
    const userId = String(credit.userId || '').trim();
    if (!userId || seen.has(userId)) return;

    seen.add(userId);
    options.push({
      value: userId,
      label: `${credit.displayName || credit.userId} (${userId})`
    });
  });

  return options;
}

function buildBroadcastsPage(settings, statusMessage = '') {
  const schedules = settings.schedules || [];
  const scheduleCards = schedules
    .map((schedule) => `<article class="schedule-card">
      <div class="schedule-head">
        <div>
          <h3>${escapeHtml(schedule.title || 'ข้อความอัตโนมัติ')}</h3>
          <p>${escapeHtml(schedule.scheduledTime)} · ${schedule.enabled ? 'เปิดใช้งาน' : 'ปิดอยู่'}</p>
        </div>
        <span class="status ${schedule.enabled ? 'enabled' : 'disabled'}">${schedule.enabled ? 'active' : 'paused'}</span>
      </div>
      <div class="target">ใช้ข้อความเข้ากลุ่มด้านบน</div>
      <div class="schedule-meta">ส่งล่าสุด: ${escapeHtml(schedule.lastSentTime || '-')}</div>
      <div class="schedule-actions">
        <form method="post" action="/broadcasts/schedules/${encodeURIComponent(schedule.id)}/toggle">
          <button type="submit">${schedule.enabled ? 'ปิดส่ง' : 'เปิดส่ง'}</button>
        </form>
        <form method="post" action="/broadcasts/schedules/${encodeURIComponent(schedule.id)}/delete">
          <button class="danger" type="submit">ลบ</button>
        </form>
      </div>
    </article>`)
    .join('');

  return `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ตั้งค่าข้อความ</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Arial, sans-serif;
      color: #111827;
      background: #eef2f7;
    }
    main {
      width: 100%;
      max-width: 430px;
      margin: 0 auto;
      padding: 12px 10px 28px;
    }
    .topbar {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 10px;
      margin-bottom: 12px;
    }
    h1 {
      margin: 0;
      font-size: 24px;
      line-height: 1.1;
    }
    .hint {
      margin: 5px 0 0;
      color: #6b7280;
      font-size: 12px;
    }
    .actions {
      display: flex;
      gap: 7px;
      align-items: flex-start;
    }
    .button, button {
      min-height: 34px;
      border: 0;
      border-radius: 8px;
      padding: 8px 10px;
      color: #ffffff;
      background: #047857;
      font-size: 12px;
      font-weight: 800;
      cursor: pointer;
      text-decoration: none;
      white-space: nowrap;
    }
    .logout-button { background: #374151; }
    .danger { background: #b91c1c; }
    .panel, .schedule-card {
      margin-bottom: 10px;
      padding: 12px;
      border: 1px solid #e5e7eb;
      border-radius: 12px;
      background: #ffffff;
      box-shadow: 0 8px 20px rgba(15, 23, 42, 0.06);
    }
    h2 {
      margin: 0 0 8px;
      font-size: 17px;
    }
    label {
      display: block;
      margin-top: 10px;
      color: #374151;
      font-size: 12px;
      font-weight: 800;
    }
    input, textarea {
      width: 100%;
      margin-top: 5px;
      border: 1px solid #d1d5db;
      border-radius: 9px;
      padding: 9px 10px;
      color: #111827;
      background: #ffffff;
      font-size: 15px;
    }
    textarea {
      min-height: 160px;
      resize: vertical;
      line-height: 1.45;
    }
    .small-textarea { min-height: 118px; }
    .form-row {
      display: grid;
      grid-template-columns: 1fr 110px;
      gap: 14px;
      margin-bottom: 14px;
    }
    .check-row {
      display: flex;
      gap: 8px;
      align-items: center;
      margin-top: 10px;
      color: #374151;
      font-size: 13px;
      font-weight: 700;
    }
    .check-row input {
      width: auto;
      margin: 0;
    }
    .schedule-submit {
      margin-top: 4px;
    }
    .status-note {
      margin: 0 0 10px;
      padding: 9px 10px;
      border-radius: 9px;
      color: #065f46;
      background: #d1fae5;
      font-size: 13px;
      font-weight: 800;
    }
    .schedule-head {
      display: flex;
      justify-content: space-between;
      gap: 10px;
    }
    .schedule-head h3 {
      margin: 0;
      font-size: 16px;
    }
    .schedule-head p {
      margin: 3px 0 0;
      color: #6b7280;
      font-size: 12px;
    }
    .status {
      align-self: flex-start;
      border-radius: 999px;
      padding: 5px 8px;
      font-size: 11px;
      font-weight: 800;
    }
    .enabled { color: #047857; background: #d1fae5; }
    .disabled { color: #6b7280; background: #f3f4f6; }
    .target {
      margin-top: 8px;
      color: #047857;
      font-size: 12px;
      font-weight: 800;
      word-break: break-all;
    }
    pre {
      margin: 8px 0 0;
      white-space: pre-wrap;
      word-break: break-word;
      color: #111827;
      font-family: Arial, sans-serif;
      font-size: 13px;
      line-height: 1.45;
    }
    .schedule-meta {
      margin-top: 8px;
      color: #6b7280;
      font-size: 11px;
    }
    .schedule-actions {
      display: flex;
      gap: 7px;
      margin-top: 10px;
    }
    .empty {
      padding: 18px 12px;
      border: 1px dashed #cbd5e1;
      border-radius: 12px;
      color: #64748b;
      text-align: center;
      font-size: 13px;
      background: #ffffff;
    }
  </style>
</head>
<body>
  <main>
    <div class="topbar">
      <div>
        <h1>ตั้งค่าข้อความ</h1>
        <p class="hint">จัดข้อความปุ่มเข้ากลุ่ม และตั้งเวลาส่งอัตโนมัติรายวัน</p>
      </div>
      <div class="actions">
        <a class="button" href="/credits">เครดิต</a>
        <form method="post" action="/credits/logout">
          <button class="logout-button" type="submit">Logout</button>
        </form>
      </div>
    </div>
    ${statusMessage ? `<div class="status-note">${escapeHtml(statusMessage)}</div>` : ''}
    <section class="panel">
      <h2>ปุ่มกดเข้ากลุ่ม</h2>
      <form method="post" action="/broadcasts/invite">
        <label>
          ข้อความที่ส่งเมื่อผู้ใช้กด/พิมพ์ เข้ากลุ่มแทง
          <textarea name="inviteText" required>${escapeHtml(settings.inviteText || BET_GROUP_INVITE_TEXT)}</textarea>
        </label>
        <button type="submit">บันทึกข้อความเข้ากลุ่ม</button>
      </form>
    </section>
    <section class="panel">
      <h2>ตั้งเวลาส่งข้อความเข้ากลุ่มทุกวัน</h2>
      <form method="post" action="/broadcasts/schedules">
        <label>
          ชื่อรายการ
          <input name="title" type="text" maxlength="80" placeholder="เช่น เชิญเข้ากลุ่มรอบเช้า" required>
        </label>
        <div class="form-row">
          <label>
            เวลา
            <input name="scheduledTime" type="time" required>
          </label>
          <label class="check-row">
            <input name="enabled" type="checkbox" checked>
            เปิดส่ง
          </label>
        </div>
        <button class="schedule-submit" type="submit">เพิ่มรายการส่งอัตโนมัติ</button>
      </form>
    </section>
    <section>
      ${scheduleCards || '<div class="empty">ยังไม่มีรายการส่งอัตโนมัติ</div>'}
    </section>
  </main>
</body>
</html>`;
}

app.get('/broadcasts', requireCreditsAdminAuth, (req, res) => {
  const status = req.query?.saved === 'invite'
    ? 'บันทึกข้อความเข้ากลุ่มแล้ว'
    : req.query?.saved === 'schedule'
      ? 'บันทึกรายการส่งอัตโนมัติแล้ว'
      : req.query?.saved === 'updated'
        ? 'อัปเดตรายการแล้ว'
        : '';

  res.send(buildBroadcastsPage(readBroadcastSettings(), status));
});

app.post('/broadcasts/invite', requireCreditsAdminAuth, (req, res) => {
  const inviteText = String(req.body?.inviteText || '').replace(/\r\n/g, '\n').trim();
  if (!inviteText) {
    return res.status(400).send('กรุณากรอกข้อความเข้ากลุ่ม');
  }

  const nowTimestamp = Date.now();
  const settings = readBroadcastSettings();
  writeBroadcastSettings({
    ...settings,
    inviteText,
    updatedTimestamp: nowTimestamp,
    updatedTime: formatDate(nowTimestamp)
  });

  return res.redirect('/broadcasts?saved=invite');
});

app.post('/broadcasts/schedules', requireCreditsAdminAuth, (req, res) => {
  const title = String(req.body?.title || '').trim();
  const scheduledTime = normalizeBroadcastTime(req.body?.scheduledTime);

  if (!title || !scheduledTime) {
    return res.status(400).send('กรุณากรอกชื่อรายการและเวลาให้ครบ');
  }

  const nowTimestamp = Date.now();
  const settings = readBroadcastSettings();
  const sharedMessageText = settings.inviteText || BET_GROUP_INVITE_TEXT;
  if (!sharedMessageText) {
    return res.status(400).send('กรุณาบันทึกข้อความเข้ากลุ่มก่อน');
  }

  const schedule = normalizeBroadcastSchedule({
    title,
    scheduledTime,
    enabled: req.body?.enabled === 'on',
    createdTimestamp: nowTimestamp,
    updatedTimestamp: nowTimestamp
  });

  writeBroadcastSettings({
    ...settings,
    schedules: [schedule, ...settings.schedules],
    updatedTimestamp: nowTimestamp,
    updatedTime: formatDate(nowTimestamp)
  });

  return res.redirect('/broadcasts?saved=schedule');
});

app.post('/broadcasts/schedules/:scheduleId/toggle', requireCreditsAdminAuth, (req, res) => {
  const scheduleId = String(req.params.scheduleId || '').trim();
  const nowTimestamp = Date.now();
  const settings = readBroadcastSettings();

  writeBroadcastSettings({
    ...settings,
    schedules: settings.schedules.map((schedule) => (
      schedule.id === scheduleId
        ? { ...schedule, enabled: !schedule.enabled, updatedTimestamp: nowTimestamp }
        : schedule
    )),
    updatedTimestamp: nowTimestamp,
    updatedTime: formatDate(nowTimestamp)
  });

  return res.redirect('/broadcasts?saved=updated');
});

app.post('/broadcasts/schedules/:scheduleId/delete', requireCreditsAdminAuth, (req, res) => {
  const scheduleId = String(req.params.scheduleId || '').trim();
  const nowTimestamp = Date.now();
  const settings = readBroadcastSettings();

  writeBroadcastSettings({
    ...settings,
    schedules: settings.schedules.filter((schedule) => schedule.id !== scheduleId),
    updatedTimestamp: nowTimestamp,
    updatedTime: formatDate(nowTimestamp)
  });

  return res.redirect('/broadcasts?saved=updated');
});

app.get('/credits/login', (req, res) => {
  if (isCreditsAdminAuthenticated(req)) {
    return res.redirect('/credits');
  }

  return res.send(buildCreditsLoginPage(false));
});

app.post('/credits/login', (req, res) => {
  if (!isCreditsAdminConfigured()) {
    return res.status(503).send('Admin login is not configured. Set CREDITS_ADMIN_USERNAME, CREDITS_ADMIN_PASSWORD, and CREDITS_ADMIN_SESSION_SECRET.');
  }

  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');

  if (username === CREDITS_ADMIN_USERNAME && password === CREDITS_ADMIN_PASSWORD) {
    setCreditsAdminCookie(req, res);
    return res.redirect('/credits');
  }

  return res.status(401).send(buildCreditsLoginPage(true));
});

app.post('/credits/logout', (req, res) => {
  clearCreditsAdminCookie(req, res);
  res.redirect('/credits/login');
});

app.get('/withdraw/request', async (req, res) => {
  const token = String(req.query?.token || '');
  const tokenData = parseWithdrawalRequestToken(token);
  if (!tokenData) {
    return res.status(400).send('ลิงก์ถอนเครดิตไม่ถูกต้องหรือหมดอายุ');
  }

  if (!WITHDRAWAL_TIME_CHECK_DISABLED && !isWithdrawalRequestOpen()) {
    return res.status(403).send('ยังไม่ถึงเวลาถอนเครดิต เปิดถอนตั้งแต่ 18:00 ถึง 08:00 น. ครับ');
  }

  if (isUserBlacklistedAnywhere(tokenData.userId)) {
    return res.status(403).send(buildBlacklistedWithdrawBlockedText());
  }

  const requestTokenHash = getWithdrawalRequestTokenHash(token);
  const existingWithdrawals = readWithdrawals();
  if (existingWithdrawals.some((withdrawal) => safeStringEqual(withdrawal.requestTokenHash, requestTokenHash))) {
    return res.status(409).send('ลิงก์ถอนเครดิตนี้ถูกใช้แล้ว');
  }

  if (existingWithdrawals.some((withdrawal) => withdrawal.userId === tokenData.userId && withdrawal.status === 'pending')) {
    return res.status(409).send('คุณมีรายการถอนที่รอดำเนินการอยู่แล้ว');
  }

  const snapshot = getCreditSnapshot(tokenData.userId);
  const profile = await resolveCreditProfile(tokenData.userId);

  return res.send(`<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ถอนเครดิต</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Arial, sans-serif;
      color: #111827;
      background: #eef2f7;
    }
    main {
      width: 100%;
      max-width: 390px;
      margin: 0 auto;
      padding: 18px 12px 28px;
    }
    .card {
      padding: 16px;
      border: 1px solid #e5e7eb;
      border-radius: 12px;
      background: #ffffff;
      box-shadow: 0 10px 24px rgba(15, 23, 42, 0.08);
    }
    h1 {
      margin: 0 0 6px;
      font-size: 24px;
    }
    .user {
      margin-bottom: 16px;
      color: #6b7280;
      font-size: 13px;
    }
    .amount {
      margin: 12px 0;
      padding: 12px;
      border-radius: 10px;
      background: #fef2f2;
      color: #dc2626;
      text-align: center;
      font-size: 28px;
      font-weight: 800;
    }
    label {
      display: block;
      margin-top: 12px;
      color: #374151;
      font-size: 13px;
      font-weight: 700;
    }
    input {
      width: 100%;
      min-height: 42px;
      margin-top: 5px;
      border: 1px solid #d1d5db;
      border-radius: 9px;
      padding: 9px 10px;
      font-size: 16px;
    }
    button {
      width: 100%;
      min-height: 44px;
      margin-top: 16px;
      border: 0;
      border-radius: 9px;
      color: #ffffff;
      background: #dc2626;
      font-size: 16px;
      font-weight: 800;
    }
    .hint {
      margin-top: 10px;
      color: #9ca3af;
      font-size: 12px;
      text-align: center;
    }
  </style>
</head>
<body>
  <main>
    <form class="card" method="post" action="/withdraw/request">
      <h1>ถอนเครดิต</h1>
      <div class="user">${escapeHtml(profile.displayName)}</div>
      <div>ยอดที่ถอนได้</div>
      <div class="amount">${escapeHtml(formatPoints(snapshot.withdrawableBalance))}</div>
      <input type="hidden" name="token" value="${escapeHtml(token)}">
      <label>
        ธนาคาร
        <input name="bankName" type="text" required placeholder="เช่น กรุงเทพ">
      </label>
      <label>
        เลขบัญชี
        <input name="accountNumber" type="text" inputmode="numeric" required placeholder="เช่น 1234567890">
      </label>
      <label>
        ยอดเครดิตที่ต้องการถอน
        <input name="amount" type="number" inputmode="decimal" min="0.01" max="${escapeHtml(snapshot.withdrawableBalance)}" step="0.01" required placeholder="เช่น 300">
      </label>
      <button type="submit">ส่งคำขอถอน</button>
      <div class="hint">ยอดถอนต้องไม่เกินยอดที่ถอนได้</div>
    </form>
  </main>
</body>
</html>`);
});

app.post('/withdraw/request', async (req, res) => {
  const token = String(req.body?.token || '');
  const tokenData = parseWithdrawalRequestToken(token);
  if (!tokenData) {
    return res.status(400).send('ลิงก์ถอนเครดิตไม่ถูกต้องหรือหมดอายุ');
  }

  if (!WITHDRAWAL_TIME_CHECK_DISABLED && !isWithdrawalRequestOpen()) {
    return res.status(403).send('ยังไม่ถึงเวลาถอนเครดิต เปิดถอนตั้งแต่ 18:00 ถึง 08:00 น. ครับ');
  }

  if (isUserBlacklistedAnywhere(tokenData.userId)) {
    return res.status(403).send(buildBlacklistedWithdrawBlockedText());
  }

  const requestTokenHash = getWithdrawalRequestTokenHash(token);
  const existingWithdrawals = readWithdrawals();
  if (existingWithdrawals.some((withdrawal) => safeStringEqual(withdrawal.requestTokenHash, requestTokenHash))) {
    return res.status(409).send('ลิงก์ถอนเครดิตนี้ถูกใช้แล้ว');
  }

  if (existingWithdrawals.some((withdrawal) => withdrawal.userId === tokenData.userId && withdrawal.status === 'pending')) {
    return res.status(409).send('คุณมีรายการถอนที่รอดำเนินการอยู่แล้ว');
  }

  const bankName = String(req.body?.bankName || '').trim();
  const accountNumber = String(req.body?.accountNumber || '').trim();
  const amount = roundPoints(Number(req.body?.amount));
  const snapshot = getCreditSnapshot(tokenData.userId);

  if (!bankName || !accountNumber) {
    return res.status(400).send('กรุณากรอกธนาคารและเลขบัญชี');
  }

  if (!Number.isFinite(amount) || amount <= 0 || amount > snapshot.withdrawableBalance) {
    return res.status(400).send('ยอดถอนต้องไม่เกินยอดเครดิตที่ถอนได้');
  }

  const profile = await resolveCreditProfile(tokenData.userId);
  const nowTimestamp = Date.now();
  const withdrawal = {
    id: `withdraw-${nowTimestamp}-${crypto.randomBytes(4).toString('hex')}`,
    userId: tokenData.userId,
    displayName: profile.displayName,
    pictureUrl: profile.pictureUrl,
    bankName,
    accountNumber,
    amount,
    availableBalance: snapshot.withdrawableBalance,
    requestTokenHash,
    status: 'pending',
    createdTimestamp: nowTimestamp,
    createdTime: formatDate(nowTimestamp)
  };

  writeWithdrawals([withdrawal, ...readWithdrawals()]);
  writeLogs([
    {
      eventType: 'withdrawal_requested',
      sourceType: 'user',
      userId: tokenData.userId,
      message: `Withdraw ${amount} to ${bankName} ${accountNumber}`,
      timestamp: nowTimestamp,
      time: formatDate(nowTimestamp),
      creditAction: 'withdrawal_requested',
      creditAmount: amount,
      creditBalance: snapshot.credit.balance,
      withdrawableBalance: snapshot.withdrawableBalance,
      withdrawalId: withdrawal.id,
      withdrawalBankName: bankName,
      withdrawalAccountNumber: accountNumber
    },
    ...readLogs()
  ]);

  return res.redirect('/withdraw/request/success');
});

app.get('/withdraw/request/success', (req, res) => {
  res.send(`<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ส่งคำขอถอนแล้ว</title>
  <style>
    body { margin: 0; font-family: Arial, sans-serif; background: #eef2f7; color: #111827; }
    main { max-width: 390px; margin: 0 auto; padding: 24px 12px; }
    .card { padding: 22px; border-radius: 12px; background: #ffffff; text-align: center; box-shadow: 0 10px 24px rgba(15, 23, 42, 0.08); }
    h1 { margin: 0 0 8px; color: #16a34a; font-size: 24px; }
    p { margin: 0; color: #6b7280; }
  </style>
</head>
<body>
  <main>
    <div class="card">
      <h1>ส่งคำขอถอนแล้ว</h1>
      <p>แอดมินจะตรวจสอบรายการถอนเครดิตให้ครับ</p>
    </div>
  </main>
</body>
</html>`);
});

app.get('/credits', requireCreditsAdminAuth, async (req, res) => {
  const credits = getManualCreditUsers();
  const creditCards = await Promise.all(
    credits.map(async (credit, index) => {
      const profile = await resolveCreditProfile(credit.userId);
      const displayName = profile.displayName;
      const pictureUrl = profile.pictureUrl;
      const userToken = getCreditsAdminUserToken(credit.userId);
      const avatar = pictureUrl
        ? `<img class="avatar avatar-image" src="${escapeHtml(pictureUrl)}" alt="">`
        : `<div class="avatar">${escapeHtml(displayName.slice(0, 1) || String(index + 1))}</div>`;

      return `<article class="credit-card" data-credit-card data-search-name="${escapeHtml(displayName.toLocaleLowerCase('th-TH'))}">
        <div class="user-row">
          ${avatar}
          <div class="user-main">
            <div class="user-name">${escapeHtml(displayName)}</div>
            <div class="user-sub">ผู้ใช้ลำดับ ${index + 1}</div>
          </div>
          <div class="balance-box">
            <span>ยอดคงเหลือ</span>
            <strong data-balance>${escapeHtml(formatPoints(credit.balance))}</strong>
          </div>
        </div>
        <form class="credit-form">
          <input type="hidden" name="userKey" value="${escapeHtml(userToken)}">
          <label>
            จำนวนเครดิต
            <input name="amount" type="number" inputmode="decimal" min="0.01" step="0.01" placeholder="เช่น 500" required>
          </label>
          <label>
            หมายเหตุ
            <input name="note" type="text" maxlength="80" placeholder="เช่น เติมมือ">
          </label>
          <button type="submit">เติมเครดิต</button>
          <div class="form-status" aria-live="polite"></div>
        </form>
      </article>`;
    })
  );

  res.send(`<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>LINE Credits</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Arial, sans-serif;
      color: #111827;
      background: #eef2f7;
    }
    main {
      width: 100%;
      max-width: 390px;
      margin: 0 auto;
      padding: 12px 10px 24px;
    }
    .topbar {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 12px;
      margin-bottom: 10px;
    }
    h1 {
      margin: 0;
      color: #111827;
      font-size: 24px;
      line-height: 1.1;
    }
    .hint {
      margin: 6px 0 0;
      color: #6b7280;
      font-size: 12px;
    }
    .actions {
      display: grid;
      grid-template-columns: repeat(2, auto);
      gap: 8px;
      justify-content: end;
    }
    .button, .logout-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 32px;
      border: 0;
      border-radius: 8px;
      padding: 7px 9px;
      color: #ffffff;
      background: #047857;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
      text-decoration: none;
      white-space: nowrap;
    }
    .logout-button { background: #374151; }
    .search-wrap {
      margin: 0 0 10px;
    }
    .search-input {
      width: 100%;
      min-height: 38px;
      border: 1px solid #d1d5db;
      border-radius: 10px;
      padding: 8px 11px;
      font-size: 15px;
      background: #ffffff;
    }
    .cards {
      display: grid;
      gap: 9px;
    }
    .credit-card {
      padding: 10px;
      background: #ffffff;
      border: 1px solid #e5e7eb;
      border-radius: 10px;
      box-shadow: 0 8px 18px rgba(15, 23, 42, 0.06);
    }
    .credit-card[hidden] { display: none; }
    .user-row {
      display: flex;
      align-items: center;
      gap: 9px;
      margin-bottom: 8px;
    }
    .avatar {
      width: 34px;
      height: 34px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 999px;
      color: #ffffff;
      background: #047857;
      font-size: 17px;
      font-weight: 700;
      flex: 0 0 auto;
    }
    .avatar-image {
      display: block;
      object-fit: cover;
      border: 1px solid #e5e7eb;
      background: #ffffff;
    }
    .user-main {
      min-width: 0;
      flex: 1 1 auto;
    }
    .user-name {
      font-size: 16px;
      font-weight: 800;
      word-break: break-word;
    }
    .user-sub {
      margin-top: 2px;
      color: #6b7280;
      font-size: 11px;
    }
    .balance-box {
      min-width: 86px;
      padding: 6px 8px;
      border-radius: 9px;
      background: #ecfdf5;
      text-align: right;
      flex: 0 0 auto;
    }
    .balance-box span {
      display: block;
      color: #047857;
      font-size: 10px;
      font-weight: 700;
    }
    .balance-box strong {
      display: block;
      margin-top: 2px;
      color: #065f46;
      font-size: 14px;
    }
    label {
      display: block;
      margin-top: 7px;
      color: #374151;
      font-size: 12px;
      font-weight: 700;
    }
    input {
      width: 100%;
      min-height: 36px;
      margin-top: 4px;
      border: 1px solid #d1d5db;
      border-radius: 8px;
      padding: 7px 9px;
      font-size: 15px;
    }
    .credit-form button {
      width: 100%;
      min-height: 38px;
      margin-top: 9px;
      border: 0;
      border-radius: 8px;
      color: #ffffff;
      background: #16a34a;
      font-size: 15px;
      font-weight: 800;
      cursor: pointer;
    }
    .credit-form button:disabled {
      opacity: 0.65;
      cursor: wait;
    }
    .form-status {
      min-height: 18px;
      margin-top: 6px;
      color: #047857;
      font-size: 12px;
      font-weight: 700;
    }
    .form-status.error { color: #b91c1c; }
    .empty {
      padding: 28px 14px;
      color: #6b7280;
      text-align: center;
      background: #ffffff;
      border: 1px solid #e5e7eb;
      border-radius: 12px;
    }
  </style>
</head>
<body>
  <main>
    <div class="topbar">
      <div>
        <h1>LINE Credits</h1>
        <p class="hint">เติมมือเฉพาะกรณีสลิปเติมไม่เข้า</p>
      </div>
      <div class="actions">
        <a class="button" href="/withdrawals">หน้าถอน</a>
        <a class="button" href="/broadcasts">ข้อความ</a>
        <form method="post" action="/credits/logout">
          <button class="logout-button" type="submit">Logout</button>
        </form>
      </div>
    </div>
    <div class="search-wrap">
      <input id="creditSearch" class="search-input" type="search" placeholder="ค้นหาชื่อ" autocomplete="off">
    </div>
    <section class="cards">
      ${creditCards.length ? creditCards.join('') : '<div class="empty">ยังไม่มีผู้ใช้เครดิต</div>'}
      <div id="creditSearchEmpty" class="empty" hidden>ไม่พบชื่อที่ค้นหา</div>
    </section>
  </main>
  <script>
    function formatNumber(value) {
      return Number(value || 0).toLocaleString('th-TH', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      });
    }

    const searchInput = document.getElementById('creditSearch');
    const searchEmpty = document.getElementById('creditSearchEmpty');
    const creditCards = Array.from(document.querySelectorAll('[data-credit-card]'));

    function filterCreditCards() {
      const query = (searchInput?.value || '').trim().toLocaleLowerCase('th-TH');
      let visibleCount = 0;

      creditCards.forEach((card) => {
        const visible = !query || (card.dataset.searchName || '').includes(query);
        card.hidden = !visible;
        if (visible) visibleCount += 1;
      });

      if (searchEmpty) {
        searchEmpty.hidden = visibleCount !== 0 || creditCards.length === 0;
      }
    }

    searchInput?.addEventListener('input', filterCreditCards);

    document.querySelectorAll('.credit-form').forEach((form) => {
      form.addEventListener('submit', async (event) => {
        event.preventDefault();

        const card = form.closest('[data-credit-card]');
        const button = form.querySelector('button');
        const status = form.querySelector('.form-status');
        const payload = Object.fromEntries(new FormData(form).entries());

        button.disabled = true;
        status.classList.remove('error');
        status.textContent = 'กำลังเติมเครดิต...';

        try {
          const response = await fetch('/api/credits/manual', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          const result = await response.json().catch(() => ({}));

          if (!response.ok || !result.success) {
            throw new Error(result.error || 'เติมเครดิตไม่สำเร็จ');
          }

          form.reset();
          const balanceTarget = card?.querySelector('[data-balance]');
          if (balanceTarget) {
            balanceTarget.textContent = formatNumber(result.balance);
          }
          status.textContent = 'เติมสำเร็จ ยอดล่าสุด ' + formatNumber(result.balance);
        } catch (error) {
          status.classList.add('error');
          status.textContent = error.message || 'เติมเครดิตไม่สำเร็จ';
        } finally {
          button.disabled = false;
        }
      });
    });
  </script>
</body>
</html>`);
});

app.get('/withdrawals', requireCreditsAdminAuth, (req, res) => {
  const withdrawals = pruneProcessedWithdrawals();
  const cards = withdrawals.map((withdrawal, index) => {
    const avatar = withdrawal.pictureUrl
      ? `<img class="avatar avatar-image" src="${escapeHtml(withdrawal.pictureUrl)}" alt="">`
      : `<div class="avatar">${escapeHtml((withdrawal.displayName || String(index + 1)).slice(0, 1))}</div>`;
    const statusDetail = withdrawal.status === 'completed'
      ? `<div class="detail-row"><span>เสร็จสิ้น</span><strong>${escapeHtml(withdrawal.completedTime || '-')}</strong></div>`
      : withdrawal.status === 'cancelled'
        ? `<div class="detail-row"><span>เหตุผลยกเลิก</span><strong>${escapeHtml(withdrawal.cancelReason || '-')}</strong></div>`
        : '';
    const adminActions = withdrawal.status === 'pending'
      ? `<div class="card-actions">
          <form method="post" action="/withdrawals/${encodeURIComponent(withdrawal.id)}/complete">
            <button class="complete-button" type="submit">เสร็จสิ้น</button>
          </form>
          <form class="cancel-form" method="post" action="/withdrawals/${encodeURIComponent(withdrawal.id)}/cancel">
            <input name="reason" type="text" maxlength="120" required placeholder="เหตุผลที่ยกเลิก">
            <button class="cancel-button" type="submit">ยกเลิก</button>
          </form>
        </div>`
      : '';

    return `<article class="withdraw-card">
      <div class="user-row">
        ${avatar}
        <div class="user-main">
          <div class="user-name">${escapeHtml(withdrawal.displayName || 'ไม่พบชื่อผู้ใช้')}</div>
          <div class="user-sub">${escapeHtml(withdrawal.createdTime || '-')}</div>
        </div>
        <div class="status">${escapeHtml(withdrawal.status || 'pending')}</div>
      </div>
      <div class="amount">${escapeHtml(formatPoints(withdrawal.amount))}</div>
      <div class="detail-row"><span>ธนาคาร</span><strong>${escapeHtml(withdrawal.bankName)}</strong></div>
      <div class="detail-row"><span>เลขบัญชี</span><strong>${escapeHtml(withdrawal.accountNumber)}</strong></div>
      <div class="detail-row"><span>ยอดที่ถอนได้ตอนส่ง</span><strong>${escapeHtml(formatPoints(withdrawal.availableBalance))}</strong></div>
      ${statusDetail}
      ${adminActions}
    </article>`;
  });

  res.send(`<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ถอนเครดิต</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Arial, sans-serif;
      color: #111827;
      background: #eef2f7;
    }
    main {
      width: 100%;
      max-width: 390px;
      margin: 0 auto;
      padding: 12px 10px 24px;
    }
    .topbar {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 12px;
      margin-bottom: 12px;
    }
    h1 {
      margin: 0;
      font-size: 24px;
      line-height: 1.1;
    }
    .hint {
      margin: 6px 0 0;
      color: #6b7280;
      font-size: 12px;
    }
    .actions {
      display: grid;
      grid-template-columns: repeat(2, auto);
      gap: 8px;
      justify-content: end;
    }
    .button, .logout-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 32px;
      border: 0;
      border-radius: 8px;
      padding: 7px 9px;
      color: #ffffff;
      background: #047857;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
      text-decoration: none;
      white-space: nowrap;
    }
    .logout-button { background: #374151; }
    .cards {
      display: grid;
      gap: 9px;
    }
    .withdraw-card {
      padding: 10px;
      border: 1px solid #e5e7eb;
      border-radius: 10px;
      background: #ffffff;
      box-shadow: 0 8px 18px rgba(15, 23, 42, 0.06);
    }
    .user-row {
      display: flex;
      align-items: center;
      gap: 9px;
      margin-bottom: 8px;
    }
    .avatar {
      width: 34px;
      height: 34px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 999px;
      color: #ffffff;
      background: #dc2626;
      font-size: 17px;
      font-weight: 700;
      flex: 0 0 auto;
    }
    .avatar-image {
      display: block;
      object-fit: cover;
      border: 1px solid #e5e7eb;
      background: #ffffff;
    }
    .user-main {
      min-width: 0;
      flex: 1 1 auto;
    }
    .user-name {
      font-size: 16px;
      font-weight: 800;
      word-break: break-word;
    }
    .user-sub {
      margin-top: 2px;
      color: #6b7280;
      font-size: 11px;
    }
    .status {
      padding: 4px 8px;
      border-radius: 999px;
      color: #92400e;
      background: #fef3c7;
      font-size: 11px;
      font-weight: 800;
    }
    .amount {
      margin: 6px 0 10px;
      color: #dc2626;
      font-size: 30px;
      font-weight: 800;
      text-align: center;
    }
    .detail-row {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      padding: 7px 0;
      border-top: 1px solid #f3f4f6;
      color: #6b7280;
      font-size: 13px;
    }
    .detail-row strong {
      color: #111827;
      text-align: right;
      word-break: break-word;
    }
    .card-actions {
      display: grid;
      gap: 8px;
      margin-top: 10px;
      padding-top: 10px;
      border-top: 1px solid #f3f4f6;
    }
    .card-actions form {
      margin: 0;
    }
    .complete-button, .cancel-button {
      width: 100%;
      min-height: 38px;
      border: 0;
      border-radius: 8px;
      color: #ffffff;
      font-size: 14px;
      font-weight: 800;
      cursor: pointer;
    }
    .complete-button {
      background: #16a34a;
    }
    .cancel-button {
      margin-top: 7px;
      background: #dc2626;
    }
    .cancel-form input {
      width: 100%;
      min-height: 36px;
      border: 1px solid #d1d5db;
      border-radius: 8px;
      padding: 8px 9px;
      font-size: 14px;
    }
    .empty {
      padding: 28px 14px;
      color: #6b7280;
      text-align: center;
      background: #ffffff;
      border: 1px solid #e5e7eb;
      border-radius: 12px;
    }
  </style>
</head>
<body>
  <main>
    <div class="topbar">
      <div>
        <h1>ถอนเครดิต</h1>
        <p class="hint">รายการถอนจากผู้ใช้ใน LINE OA</p>
      </div>
      <div class="actions">
        <a class="button" href="/credits">หน้าเครดิต</a>
        <form method="post" action="/credits/logout">
          <button class="logout-button" type="submit">Logout</button>
        </form>
      </div>
    </div>
    <section class="cards">
      ${cards.length ? cards.join('') : '<div class="empty">ยังไม่มีรายการถอนเครดิต</div>'}
    </section>
  </main>
</body>
</html>`);
});

app.post('/withdrawals/:withdrawalId/complete', requireCreditsAdminAuth, async (req, res) => {
  const withdrawalId = String(req.params.withdrawalId || '').trim();
  const withdrawal = readWithdrawals().find((entry) => entry.id === withdrawalId);
  if (!withdrawal) {
    return res.status(404).send('ไม่พบรายการถอนเครดิต');
  }

  if (withdrawal.status !== 'pending') {
    return res.status(409).send('รายการถอนนี้ถูกดำเนินการแล้ว');
  }

  const nowTimestamp = Date.now();
  const creditResult = updateCreditForCompletedWithdrawal(withdrawal, nowTimestamp);
  if (!creditResult.success) {
    return res.status(creditResult.status || 400).send(creditResult.error || 'ไม่สามารถถอนเครดิตได้');
  }

  const updatedWithdrawal = {
    ...withdrawal,
    status: 'completed',
    completedAmount: roundPoints(withdrawal.amount),
    completedTimestamp: nowTimestamp,
    completedTime: formatDate(nowTimestamp)
  };
  removeWithdrawalById(withdrawal.id);
  const pushResponse = await pushToLine(
    updatedWithdrawal.userId,
    [buildWithdrawalCompletedFlex(updatedWithdrawal, creditResult.credit)]
  ).catch(() => null);
  const pushStatus = pushResponse ? (pushResponse.ok ? 'sent' : 'failed') : 'skipped';

  writeLogs([
    {
      eventType: 'withdrawal_completed',
      sourceType: 'web_admin',
      userId: updatedWithdrawal.userId,
      message: `Withdrawal completed ${updatedWithdrawal.id}`,
      timestamp: nowTimestamp,
      time: formatDate(nowTimestamp),
      creditAction: 'withdrawal_completed',
      creditAmount: -roundPoints(updatedWithdrawal.amount),
      creditBalance: creditResult.credit.balance,
      withdrawalId: updatedWithdrawal.id,
      withdrawalPushStatus: pushStatus
    },
    ...readLogs()
  ]);

  return res.redirect('/withdrawals');
});

app.post('/withdrawals/:withdrawalId/cancel', requireCreditsAdminAuth, async (req, res) => {
  const withdrawalId = String(req.params.withdrawalId || '').trim();
  const reason = String(req.body?.reason || '').trim();
  const withdrawal = readWithdrawals().find((entry) => entry.id === withdrawalId);
  if (!withdrawal) {
    return res.status(404).send('ไม่พบรายการถอนเครดิต');
  }

  if (withdrawal.status !== 'pending') {
    return res.status(409).send('รายการถอนนี้ถูกดำเนินการแล้ว');
  }

  if (!reason) {
    return res.status(400).send('กรุณาระบุเหตุผลที่ยกเลิก');
  }

  const nowTimestamp = Date.now();
  const updatedWithdrawal = {
    ...withdrawal,
    status: 'cancelled',
    cancelReason: reason,
    cancelledTimestamp: nowTimestamp,
    cancelledTime: formatDate(nowTimestamp)
  };
  removeWithdrawalById(withdrawal.id);
  const pushResponse = await pushToLine(
    updatedWithdrawal.userId,
    [buildWithdrawalCancelledFlex(updatedWithdrawal)]
  ).catch(() => null);
  const pushStatus = pushResponse ? (pushResponse.ok ? 'sent' : 'failed') : 'skipped';

  writeLogs([
    {
      eventType: 'withdrawal_cancelled',
      sourceType: 'web_admin',
      userId: updatedWithdrawal.userId,
      message: `Withdrawal cancelled ${updatedWithdrawal.id}: ${reason}`,
      timestamp: nowTimestamp,
      time: formatDate(nowTimestamp),
      creditAction: 'withdrawal_cancelled',
      creditAmount: 0,
      withdrawalId: updatedWithdrawal.id,
      withdrawalCancelReason: reason,
      withdrawalPushStatus: pushStatus
    },
    ...readLogs()
  ]);

  return res.redirect('/withdrawals');
});

app.get('/api/logs', requireCreditsAdminAuth, (req, res) => {
  res.json(readLogs());
});

app.get('/api/storage', requireCreditsAdminAuth, (req, res) => {
  res.json(getStorageStatus());
});

app.delete('/api/logs', requireCreditsAdminAuth, (req, res) => {
  writeLogs([]);
  res.json({ success: true });
});

app.get('/api/admins', requireCreditsAdminAuth, (req, res) => {
  res.json(readAdmins());
});

app.delete('/api/admins', requireCreditsAdminAuth, (req, res) => {
  writeAdmins([]);
  res.json({ success: true });
});

app.get('/api/wounds', requireCreditsAdminAuth, (req, res) => {
  res.json(readWounds());
});

app.delete('/api/wounds', requireCreditsAdminAuth, (req, res) => {
  writeWounds([]);
  writeMessages([]);
  res.json({ success: true });
});

app.get('/api/rounds', requireCreditsAdminAuth, (req, res) => {
  res.json(readRounds());
});

app.delete('/api/rounds', requireCreditsAdminAuth, (req, res) => {
  writeRounds([]);
  writeMessages([]);
  writeWounds([]);
  res.json({ success: true });
});

app.get('/api/queue-lists', requireCreditsAdminAuth, (req, res) => {
  res.json(readQueueLists());
});

app.delete('/api/queue-lists', requireCreditsAdminAuth, (req, res) => {
  writeQueueLists([]);
  res.json({ success: true });
});

app.get('/api/blacklist', requireCreditsAdminAuth, (req, res) => {
  res.json(readBlacklist());
});

app.delete('/api/blacklist', requireCreditsAdminAuth, (req, res) => {
  writeBlacklist([]);
  writeBlacklistModes([]);
  res.json({ success: true });
});

app.get('/api/broadcast-settings', requireCreditsAdminAuth, (req, res) => {
  res.json(readBroadcastSettings());
});

app.delete('/api/broadcast-settings', requireCreditsAdminAuth, (req, res) => {
  writeBroadcastSettings({ inviteText: '', schedules: [] });
  res.json({ success: true });
});

app.get('/api/credits', requireCreditsAdminAuth, (req, res) => {
  res.json(readCredits());
});

app.get('/api/withdrawals', requireCreditsAdminAuth, (req, res) => {
  res.json(readWithdrawals());
});

app.delete('/api/withdrawals', requireCreditsAdminAuth, (req, res) => {
  writeWithdrawals([]);
  res.json({ success: true });
});

app.post('/api/credits/manual', requireCreditsAdminAuth, async (req, res) => {
  const userId = getCreditUserIdFromAdminToken(req.body?.userKey);
  const amount = Number(req.body?.amount);
  const note = String(req.body?.note || '').trim();

  if (!userId) {
    return res.status(404).json({ success: false, error: 'ไม่พบผู้ใช้นี้' });
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ success: false, error: 'จำนวนเครดิตไม่ถูกต้อง' });
  }

  const nowTimestamp = Date.now();
  const profile = await resolveCreditProfile(userId);
  const displayName = profile.displayName;
  const manualEvent = {
    type: 'manual_credit',
    source: { type: 'web_admin', userId, displayName, pictureUrl: profile.pictureUrl },
    message: { id: `manual-credit-${nowTimestamp}-${crypto.randomBytes(4).toString('hex')}` },
    timestamp: nowTimestamp
  };
  const rawText = note ? `Manual credit: ${note}` : 'Manual credit by admin';
  const result = addCreditForUser(manualEvent, roundPoints(amount), rawText, {
    type: 'manual_credit_added',
    manual: true,
    manualAdmin: CREDITS_ADMIN_USERNAME,
    manualNote: note
  });
  const snapshot = getCreditSnapshot(userId);
  const pushResponse = await pushToLine(userId, [buildManualCreditAddedFlex(amount, snapshot)]).catch(() => null);
  const pushStatus = pushResponse ? (pushResponse.ok ? 'sent' : 'failed') : 'skipped';

  writeLogs([
    {
      eventType: 'manual_credit_added',
      sourceType: 'web_admin',
      userId,
      message: rawText,
      timestamp: nowTimestamp,
      time: formatDate(nowTimestamp),
      creditAction: 'manual_credit_added',
      creditAmount: roundPoints(amount),
      creditBalance: result.credit.balance,
      manualCreditDisplayName: displayName,
      manualCreditPushStatus: pushStatus
    },
    ...readLogs()
  ]);

  return res.json({
    success: true,
    userId,
    displayName,
    amount: roundPoints(amount),
    balance: result.credit.balance,
    pushStatus
  });
});

app.delete('/api/credits', requireCreditsAdminAuth, (req, res) => {
  writeCredits([]);
  res.json({ success: true });
});

async function startServer() {
  try {
    await initMongoStorage();
  } catch (error) {
    console.error('MongoDB storage could not start. Falling back to JSON files:', error.message);
    mongoConnected = false;
  }

  app.listen(PORT, () => {
    console.log(`LINE Webhook Logger is running on port ${PORT}`);
    console.log(`Storage driver: ${mongoConnected ? 'MongoDB' : 'JSON files'}`);
  });
  startBroadcastScheduler();
}

startServer();
