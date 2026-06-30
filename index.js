// family-bot/index.js
// בוט תזכורות משפחתי לקבוצת וואטסאפ
// מבוסס על whatsapp-web.js

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');

const EVENTS_FILE = path.join(__dirname, 'events.json');
const SENT_LOG_FILE = path.join(__dirname, 'sent_log.json');

const CONFIG_FILE = path.join(__dirname, 'config.json');
const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
const GROUP_NAME = config.groupName;
const CHECK_INTERVAL_MINUTES = config.checkIntervalMinutes || 15;

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: '/app/session' }),
  puppeteer: {
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  }
});

client.on('qr', (qr) => {
  console.log('סרקו את קוד ה-QR עם הוואטסאפ שלכם (וואטסאפ > מכשירים מקושרים):');
  qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
  console.log('✅ הבוט מחובר ופעיל!');
  setInterval(checkReminders, CHECK_INTERVAL_MINUTES * 60 * 1000);
  checkReminders(); // בדיקה ראשונה מיד עם ההפעלה
});

function loadJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function saveSentLog(log) {
  fs.writeFileSync(SENT_LOG_FILE, JSON.stringify(log, null, 2));
}

// מחשב את הפרשי הזמן הרלוונטיים (יום לפני, באותו יום בבוקר, שעה לפני)
function getReminderStage(eventDateTime, now) {
  const diffMs = eventDateTime - now;
  const diffHours = diffMs / (1000 * 60 * 60);

  if (diffHours > 23 && diffHours <= 25) return 'יום לפני';
  if (diffHours > 0.5 && diffHours <= 1.5) return 'שעה לפני';
  // "באותו יום בבוקר" - נשלח בין 07:00-07:15 ביום האירוע
  if (
    now.toDateString() === eventDateTime.toDateString() &&
    now.getHours() === 7 &&
    now.getMinutes() < 15
  ) {
    return 'היום';
  }
  return null;
}

function buildEventDateTime(ev, now) {
  // תומך באירועים חוזרים: yearly / weekly / daily / חד פעמי
  let [year, month, day] = ev.date.split('-').map(Number);
  const [hour, minute] = (ev.time || '09:00').split(':').map(Number);

  if (ev.repeat === 'yearly') {
    year = now.getFullYear();
  } else if (ev.repeat === 'weekly') {
    // מוצא את ההופעה הקרובה של אותו יום בשבוע
    const base = new Date(year, month - 1, day, hour, minute);
    const todayDow = now.getDay();
    const baseDow = base.getDay();
    const daysUntil = (baseDow - todayDow + 7) % 7;
    const occurrence = new Date(now);
    occurrence.setDate(now.getDate() + daysUntil);
    occurrence.setHours(hour, minute, 0, 0);
    return occurrence;
  } else if (ev.repeat === 'daily') {
    const occurrence = new Date(now);
    occurrence.setHours(hour, minute, 0, 0);
    return occurrence;
  }

  return new Date(year, month - 1, day, hour, minute);
}

async function checkReminders() {
  const now = new Date();
  const events = loadJSON(EVENTS_FILE, []);
  const sentLog = loadJSON(SENT_LOG_FILE, {});

  for (const ev of events) {
    const eventDateTime = buildEventDateTime(ev, now);
    const stage = getReminderStage(eventDateTime, now);
    if (!stage) continue;

    const key = `${ev.title}_${eventDateTime.toDateString()}_${stage}`;
    if (sentLog[key]) continue; // כבר נשלח

    const message = formatMessage(ev, stage);
    await sendToGroup(message);

    sentLog[key] = true;
    saveSentLog(sentLog);
  }
}

function formatMessage(ev, stage) {
  const icons = { birthday: '🎂', medicine: '💊', activity: '⚽', default: '📌' };
  const icon = icons[ev.type] || icons.default;
  return `${icon} תזכורת (${stage}): ${ev.title}`;
}

async function sendToGroup(message) {
  const chats = await client.getChats();
  const group = chats.find(c => c.isGroup && c.name === GROUP_NAME);
  if (!group) {
    console.error(`⚠️ לא נמצאה קבוצה בשם "${GROUP_NAME}". ודאו שהשם מדויק ב-index.js`);
    return;
  }
  await group.sendMessage(message);
  console.log(`נשלחה הודעה: ${message}`);
}

client.initialize();
