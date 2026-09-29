const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Persistent Data Storage Path
// Defaults to the 'data' directory right next to server.js (on External SSD)
const DATA_DIR = process.env.DATA_PATH || path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const USERS_FILE = path.join(DATA_DIR, 'users.json');
const GROUPS_FILE = path.join(DATA_DIR, 'groups.json');
const REQUESTS_FILE = path.join(DATA_DIR, 'requests.json');
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');
const INSTALLS_FILE = path.join(DATA_DIR, 'installs.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');

function loadData(file, fallback = {}) {
  try {
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    }
  } catch (e) {
    console.error(`[SSD-STORAGE] Error reading ${file}:`, e.message);
  }
  return fallback;
}

function saveData(file, data) {
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error(`[SSD-STORAGE] Error writing to ${file}:`, e.message);
  }
}

// Helpers
function hashPin(pin) {
  return crypto.createHash('sha256').update(pin || '0000').digest('hex');
}

function generateToken(userId) {
  return 'tk_' + crypto.randomBytes(24).toString('hex');
}

// ==========================================
// 1. HEALTH & SYSTEM DIAGNOSTICS (EXTERNAL SSD)
// ==========================================
app.get('/api/health', (req, res) => {
  const users = loadData(USERS_FILE, {});
  const groups = loadData(GROUPS_FILE, {});
  const installs = loadData(INSTALLS_FILE, []);
  res.json({
    status: 'ONLINE',
    serverType: 'PadhLo External SSD Dedicated Backend',
    storageDirectory: DATA_DIR,
    timestamp: new Date().toISOString(),
    metrics: {
      totalUsers: Object.keys(users).length,
      totalGroups: Object.keys(groups).length,
      totalInstalls: installs.length
    }
  });
});

// ==========================================
// 2. USER AUTHENTICATION ENDPOINTS
// ==========================================

function handleRegister(req, res) {
  const { studentId, padhloId, name, examGoal, pin, avatarId, isPro } = req.body;
  const actualId = studentId || padhloId;
  if (!actualId || !name) {
    return res.status(400).json({ error: 'studentId and name are required' });
  }

  const cleanId = actualId.trim().toUpperCase();
  const users = loadData(USERS_FILE, {});

  if (users[cleanId]) {
    // If account exists, update profile but retain token & pin
    users[cleanId].name = name.trim();
    users[cleanId].examGoal = examGoal || users[cleanId].examGoal;
    users[cleanId].avatarId = avatarId !== undefined ? avatarId : users[cleanId].avatarId;
    users[cleanId].isPro = isPro !== undefined ? isPro : users[cleanId].isPro;
    users[cleanId].lastLogin = new Date().toISOString();
    saveData(USERS_FILE, users);
    return res.json({
      success: true,
      message: 'Account updated successfully',
      user: {
        studentId: users[cleanId].studentId,
        padhloId: users[cleanId].studentId,
        name: users[cleanId].name,
        examGoal: users[cleanId].examGoal,
        avatarId: users[cleanId].avatarId,
        isPro: users[cleanId].isPro,
        token: users[cleanId].token
      }
    });
  }

  const token = generateToken(cleanId);
  const newUser = {
    studentId: cleanId,
    padhloId: cleanId,
    name: name.trim(),
    examGoal: examGoal || 'General Exam',
    pinHash: hashPin(pin || '1234'),
    avatarId: avatarId || 1,
    isPro: !!isPro,
    token,
    createdAt: new Date().toISOString(),
    lastLogin: new Date().toISOString()
  };

  users[cleanId] = newUser;
  saveData(USERS_FILE, users);

  console.log(`[AUTH] 👤 Registered Student: ${newUser.name} (${newUser.studentId}) on Server`);
  res.json({
    success: true,
    message: 'Registered successfully',
    user: {
      studentId: newUser.studentId,
      padhloId: newUser.studentId,
      name: newUser.name,
      examGoal: newUser.examGoal,
      avatarId: newUser.avatarId,
      isPro: newUser.isPro,
      token: newUser.token
    }
  });
}

app.post('/api/auth/register', handleRegister);
app.post('/api/students/register', handleRegister);

// Login with studentId + PIN
app.post('/api/auth/login', (req, res) => {
  const { studentId, pin } = req.body;
  if (!studentId) {
    return res.status(400).json({ error: 'studentId is required' });
  }

  const cleanId = studentId.trim().toUpperCase();
  const users = loadData(USERS_FILE, {});
  const user = users[cleanId];

  if (!user) {
    return res.status(404).json({ error: 'Student ID not registered. Please register first.' });
  }

  // If PIN provided, verify hash
  if (pin && user.pinHash && user.pinHash !== hashPin(pin)) {
    return res.status(401).json({ error: 'Incorrect PIN. Please try again.' });
  }

  // Refresh token
  user.token = generateToken(cleanId);
  user.lastLogin = new Date().toISOString();
  saveData(USERS_FILE, users);

  res.json({
    success: true,
    user: {
      studentId: user.studentId,
      name: user.name,
      examGoal: user.examGoal,
      avatarId: user.avatarId,
      isPro: user.isPro,
      token: user.token
    }
  });
});

// Profile Lookup by PadhLo ID (Multi-device discovery)
app.get('/api/students/:padhloId', (req, res) => {
  const cleanId = req.params.padhloId.trim().toUpperCase();
  const users = loadData(USERS_FILE, {});
  const user = users[cleanId];

  if (user) {
    return res.json({
      found: true,
      student: {
        padhloId: user.studentId,
        name: user.name,
        examGoal: user.examGoal,
        avatarId: user.avatarId,
        isPro: user.isPro,
        lastLogin: user.lastLogin
      }
    });
  }
  res.json({ found: false, message: `Student with ID ${cleanId} not found` });
});

// ==========================================
// 3. STUDY GROUP COORDINATION ENDPOINTS
// ==========================================

// Create Group
app.post('/api/groups/create', (req, res) => {
  const { name, subject, targetDailyHours, creatorId, creatorName } = req.body;
  if (!name || !creatorId) {
    return res.status(400).json({ error: 'name and creatorId are required' });
  }

  const groups = loadData(GROUPS_FILE, {});
  const groupId = 'grp_' + Date.now().toString(36);
  const inviteCode = Math.floor(100000 + Math.random() * 900000).toString();

  const newGroup = {
    id: groupId,
    inviteCode,
    name: name.trim(),
    subject: subject || 'Exams & Concept Mastery',
    targetDailyHours: Number(targetDailyHours) || 6,
    creatorId: creatorId.trim().toUpperCase(),
    creatorName: creatorName || 'Study Leader',
    memberCount: 1,
    members: [
      {
        studentId: creatorId.trim().toUpperCase(),
        name: creatorName || 'Study Leader',
        role: 'ADMIN',
        joinedAt: new Date().toISOString()
      }
    ],
    createdAt: new Date().toISOString()
  };

  groups[groupId] = newGroup;
  saveData(GROUPS_FILE, groups);

  console.log(`[GROUPS] 📚 Created Study Group: ${newGroup.name} (Code: ${newGroup.inviteCode})`);
  res.json(newGroup);
});

// Search Group by Code or ID
app.get('/api/groups/search', (req, res) => {
  const query = (req.query.query || '').trim().toUpperCase();
  if (!query) return res.status(400).json({ error: 'Query is required' });

  const groups = loadData(GROUPS_FILE, {});
  const matched = Object.values(groups).find(
    g => g.inviteCode === query || g.id === query || g.name.toUpperCase().includes(query)
  );

  if (matched) {
    return res.json({ found: true, group: matched });
  }
  res.json({ found: false, message: `No study group found matching: ${query}` });
});

// List Groups
app.get('/api/groups/list', (req, res) => {
  const groups = loadData(GROUPS_FILE, {});
  res.json(Object.values(groups));
});

// Send Join Request
app.post('/api/groups/request', (req, res) => {
  const { inviteCode, applicantId, applicantName, applicantGoal } = req.body;
  if (!inviteCode || !applicantId) {
    return res.status(400).json({ error: 'inviteCode and applicantId are required' });
  }

  const cleanCode = inviteCode.trim().toUpperCase();
  const cleanApplicant = applicantId.trim().toUpperCase();

  const groups = loadData(GROUPS_FILE, {});
  const targetGroup = Object.values(groups).find(
    g => g.inviteCode === cleanCode || g.id === cleanCode
  );

  if (!targetGroup) {
    return res.status(404).json({ error: `Study Group with Code ${cleanCode} not found` });
  }

  // Check if already a member
  if (targetGroup.members.some(m => m.studentId === cleanApplicant)) {
    return res.json({ success: true, message: 'You are already a member of this study circle!' });
  }

  const requests = loadData(REQUESTS_FILE, []);
  const existing = requests.find(
    r => r.groupId === targetGroup.id && r.applicantId === cleanApplicant && r.status === 'PENDING'
  );

  if (existing) {
    return res.json({ success: true, message: 'Join request already submitted. Awaiting group admin approval!' });
  }

  const newRequest = {
    requestId: 'req_' + Date.now().toString(36),
    groupId: targetGroup.id,
    groupName: targetGroup.name,
    creatorId: targetGroup.creatorId,
    applicantId: cleanApplicant,
    applicantName: applicantName || 'Student',
    applicantGoal: applicantGoal || 'Exam Prep',
    status: 'PENDING',
    timestamp: Date.now(),
    dateStr: new Date().toLocaleString()
  };

  requests.unshift(newRequest);
  saveData(REQUESTS_FILE, requests);

  console.log(`[REQUESTS] 📩 ${newRequest.applicantName} (${cleanApplicant}) requested to join ${targetGroup.name}`);
  res.json({ success: true, message: `Request sent to ${targetGroup.name} admin!`, request: newRequest });
});

// View Pending Requests for Group Creator
app.get('/api/groups/my-requests', (req, res) => {
  const creatorId = (req.query.creatorId || '').trim().toUpperCase();
  if (!creatorId) return res.json([]);

  const requests = loadData(REQUESTS_FILE, []);
  const pending = requests.filter(r => r.creatorId === creatorId && r.status === 'PENDING');
  res.json(pending);
});

// Respond to Join Request (Accept / Reject)
app.post('/api/groups/request/respond', (req, res) => {
  const { requestId, action } = req.body; // action: 'ACCEPT' or 'REJECT'
  if (!requestId || !action) {
    return res.status(400).json({ error: 'requestId and action are required' });
  }

  const requests = loadData(REQUESTS_FILE, []);
  const reqItem = requests.find(r => r.requestId === requestId);

  if (!reqItem) {
    return res.status(404).json({ error: 'Request not found' });
  }

  reqItem.status = action === 'ACCEPT' ? 'ACCEPTED' : 'REJECTED';
  reqItem.resolvedAt = new Date().toISOString();

  if (action === 'ACCEPT') {
    const groups = loadData(GROUPS_FILE, {});
    const targetGroup = groups[reqItem.groupId];
    if (targetGroup) {
      if (!targetGroup.members.some(m => m.studentId === reqItem.applicantId)) {
        targetGroup.members.push({
          studentId: reqItem.applicantId,
          name: reqItem.applicantName,
          role: 'MEMBER',
          joinedAt: new Date().toISOString()
        });
        targetGroup.memberCount = targetGroup.members.length;
        saveData(GROUPS_FILE, groups);
      }
    }
  }

  saveData(REQUESTS_FILE, requests);
  res.json({ success: true, status: reqItem.status });
});

// Study Group Chat Messages
app.get('/api/groups/:groupId/messages', (req, res) => {
  const groupId = req.params.groupId;
  const messages = loadData(MESSAGES_FILE, {});
  res.json(messages[groupId] || []);
});

app.post('/api/groups/:groupId/messages', (req, res) => {
  const groupId = req.params.groupId;
  const { senderId, senderName, text } = req.body;
  if (!text || !senderId) {
    return res.status(400).json({ error: 'senderId and text are required' });
  }

  const messages = loadData(MESSAGES_FILE, {});
  if (!messages[groupId]) messages[groupId] = [];

  const msg = {
    id: 'msg_' + Date.now().toString(36),
    senderId: senderId.trim().toUpperCase(),
    senderName: senderName || 'Student',
    text: text.trim(),
    timestamp: Date.now(),
    timeStr: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  };

  messages[groupId].push(msg);
  // Keep last 100 messages per group
  if (messages[groupId].length > 100) {
    messages[groupId] = messages[groupId].slice(-100);
  }
  saveData(MESSAGES_FILE, messages);

  res.json({ success: true, message: msg });
});

// ==========================================
// 4. APP ANALYTICS & DOWNLOAD TELEMETRY
// ==========================================

// Log App Install / First Open
app.post('/api/telemetry/install', (req, res) => {
  const { installId, device, androidVersion, studentName, examGoal, isTest } = req.body;
  if (!installId) {
    return res.status(400).json({ error: 'installId is required' });
  }

  const installs = loadData(INSTALLS_FILE, []);
  const existing = installs.find(item => item.installId === installId);

  const entry = {
    installId,
    device: device || 'Android Device',
    androidVersion: androidVersion || 'Android',
    studentName: studentName || 'New Student',
    examGoal: examGoal || 'General Study',
    isTest: !!isTest,
    firstSeen: existing ? existing.firstSeen : new Date().toISOString(),
    lastSeen: new Date().toISOString(),
    ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress
  };

  if (existing) {
    Object.assign(existing, entry);
  } else {
    installs.unshift(entry);
    console.log(`[ANALYTICS] 📱 New App Install Logged on External SSD: ${entry.device} (${entry.installId})`);
  }

  saveData(INSTALLS_FILE, installs);
  res.json({ success: true, totalInstalls: installs.length, install: entry });
});

// Log Study Session
app.post('/api/telemetry/session', (req, res) => {
  const { studentId, subject, durationMinutes, strictMode } = req.body;
  if (!durationMinutes) {
    return res.status(400).json({ error: 'durationMinutes is required' });
  }

  const sessions = loadData(SESSIONS_FILE, []);
  const session = {
    id: 'ses_' + Date.now().toString(36),
    studentId: (studentId || 'ANONYMOUS').trim().toUpperCase(),
    subject: subject || 'General',
    durationMinutes: Number(durationMinutes),
    strictMode: !!strictMode,
    timestamp: Date.now(),
    dateStr: new Date().toLocaleString()
  };

  sessions.unshift(session);
  // Keep last 1000 sessions
  if (sessions.length > 1000) sessions.pop();
  saveData(SESSIONS_FILE, sessions);

  res.json({ success: true, loggedSession: session });
});

// Analytics Summary
app.get('/api/telemetry/stats', (req, res) => {
  const users = loadData(USERS_FILE, {});
  const groups = loadData(GROUPS_FILE, {});
  const installs = loadData(INSTALLS_FILE, []);
  const sessions = loadData(SESSIONS_FILE, []);

  const totalStudyMinutes = sessions.reduce((acc, curr) => acc + (curr.durationMinutes || 0), 0);

  res.json({
    totalInstalls: installs.length,
    registeredStudents: Object.keys(users).length,
    activeStudyCircles: Object.keys(groups).length,
    totalSessionsCompleted: sessions.length,
    totalStudyHours: Math.round(totalStudyMinutes / 60)
  });
});

const ADMIN_SECRET = process.env.ADMIN_SECRET || 'ankit_iit_2026';

// Full Backup Export for External SSD Sync (Protected by Admin Secret Key)
app.get('/api/admin/export', (req, res) => {
  const key = req.query.key || req.headers['x-admin-key'];
  if (key !== ADMIN_SECRET) {
    return res.status(403).json({ error: 'Unauthorized: Valid Admin Secret Key required' });
  }

  const users = loadData(USERS_FILE, {});
  const groups = loadData(GROUPS_FILE, {});
  const requests = loadData(REQUESTS_FILE, {});
  const messages = loadData(MESSAGES_FILE, {});
  const installs = loadData(INSTALLS_FILE, []);
  const sessions = loadData(SESSIONS_FILE, []);

  res.json({
    timestamp: new Date().toISOString(),
    users,
    groups,
    requests,
    messages,
    installs,
    sessions
  });
});

// ==========================================
// 5. EXTERNAL SSD LIVE ADMIN DASHBOARD (OWNER PROTECTED)
// ==========================================
app.get('/admin', (req, res) => {
  const key = req.query.key;
  if (key !== ADMIN_SECRET) {
    return res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>PadhLo Owner Portal - Restricted Access</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #070913; color: #FFF; display:flex; align-items:center; justify-content:center; min-height:100vh; margin:0; }
          .card { background: #0F1528; border: 1px solid #1E293B; border-radius: 18px; padding: 36px 28px; width: 100%; max-width: 380px; text-align: center; box-shadow: 0 20px 40px rgba(0,0,0,0.6); }
          input { width: 100%; padding: 14px; border-radius: 12px; border: 1px solid #334155; background: #141A2E; color: #FFF; font-size: 15px; margin: 18px 0 14px 0; box-sizing: border-box; text-align: center; }
          button { width: 100%; padding: 14px; border-radius: 12px; border: none; background: linear-gradient(135deg, #8B5CF6, #6366F1); color: #FFF; font-weight: bold; font-size: 15px; cursor: pointer; }
        </style>
      </head>
      <body>
        <div class="card">
          <div style="font-size: 44px; margin-bottom: 12px;">🛡️</div>
          <h2 style="margin: 0 0 6px 0;">PadhLo Owner Portal</h2>
          <p style="color: #94A3B8; font-size: 13px; margin: 0;">Restricted Access • Enter Owner Secret Key</p>
          ${key ? '<p style="color:#EF4444; font-size:12px; font-weight:bold; margin-top:10px;">❌ Invalid Secret Key! Access Denied.</p>' : ''}
          <form method="GET" action="/admin">
            <input type="password" name="key" placeholder="Enter Owner Secret Key" required autofocus>
            <button type="submit">Unlock Dashboard</button>
          </form>
          <p style="color:#64748B; font-size:11px; margin-top:18px;">Designed by Future IITian Ankit • 100% Secure</p>
        </div>
      </body>
      </html>
    `);
  }

  const users = loadData(USERS_FILE, {});
  const groups = loadData(GROUPS_FILE, {});
  const installs = loadData(INSTALLS_FILE, []);
  const sessions = loadData(SESSIONS_FILE, []);

  const installRows = installs.map((item, idx) => `
    <tr>
      <td>${idx + 1}</td>
      <td><strong>${item.device}</strong></td>
      <td><code>${item.installId}</code></td>
      <td>${item.studentName || '-'}</td>
      <td>${item.examGoal || '-'}</td>
      <td>${item.firstSeen ? new Date(item.firstSeen).toLocaleString() : '-'}</td>
      <td><span class="badge active">Logged</span></td>
    </tr>
  `).join('');

  const userRows = Object.values(users).map((u, idx) => `
    <tr>
      <td>${idx + 1}</td>
      <td><code>${u.studentId}</code></td>
      <td><strong>${u.name}</strong></td>
      <td>${u.examGoal}</td>
      <td>${u.isPro ? '<span class="badge pro">PRO VIP</span>' : '<span class="badge free">Free</span>'}</td>
      <td>${u.lastLogin ? new Date(u.lastLogin).toLocaleString() : '-'}</td>
    </tr>
  `).join('');

  const groupRows = Object.values(groups).map((g, idx) => `
    <tr>
      <td>${idx + 1}</td>
      <td><span class="code-box">${g.inviteCode}</span></td>
      <td><strong>${g.name}</strong></td>
      <td>${g.subject}</td>
      <td>${g.memberCount} Students</td>
      <td>${g.creatorName}</td>
    </tr>
  `).join('');

  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="utf-8">
      <title>PadhLo External SSD Dedicated Server Hub</title>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <style>
        :root {
          --bg: #070913;
          --card: #0F1528;
          --card-elevated: #161F38;
          --primary: #8B5CF6;
          --cyan: #00F0FF;
          --success: #10B981;
          --text: #F1F5F9;
          --text-muted: #94A3B8;
          --border: #222F50;
        }
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: var(--bg); color: var(--text); padding: 24px; margin: 0; }
        .header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px; border-bottom: 1px solid var(--border); padding-bottom: 16px; }
        .ssd-badge { background: rgba(0, 240, 255, 0.15); border: 1px solid var(--cyan); color: var(--cyan); padding: 6px 14px; border-radius: 20px; font-weight: bold; font-size: 13px; }
        .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 28px; }
        .stat-card { background: var(--card); border: 1px solid var(--border); border-radius: 14px; padding: 18px; text-align: center; }
        .stat-val { font-size: 32px; font-weight: 800; color: var(--primary); margin-bottom: 4px; }
        .stat-sub { color: var(--text-muted); font-size: 13px; }
        .card { background: var(--card); border: 1px solid var(--border); border-radius: 14px; padding: 20px; margin-bottom: 28px; }
        h2 { font-size: 18px; margin-top: 0; color: var(--cyan); display: flex; align-items: center; gap: 8px; }
        table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 13px; }
        th, td { padding: 10px 14px; text-align: left; border-bottom: 1px solid #1E293B; }
        th { background: var(--card-elevated); color: var(--text-muted); font-weight: 600; }
        code { background: #1E293B; padding: 3px 7px; border-radius: 4px; color: #38BDF8; font-family: monospace; }
        .code-box { background: rgba(139, 92, 246, 0.2); border: 1px solid var(--primary); color: #C4B5FD; padding: 3px 8px; border-radius: 6px; font-weight: bold; letter-spacing: 1px; }
        .badge { padding: 3px 8px; border-radius: 6px; font-size: 11px; font-weight: bold; }
        .badge.active { background: rgba(16, 185, 129, 0.2); color: var(--success); }
        .badge.pro { background: rgba(245, 158, 11, 0.2); color: #F59E0B; }
        .badge.free { background: rgba(148, 163, 184, 0.2); color: var(--text-muted); }
        .path-box { background: #141A30; border: 1px dashed var(--cyan); padding: 12px 16px; border-radius: 8px; margin-bottom: 20px; font-size: 13px; }
      </style>
    </head>
    <body>
      <div class="header">
        <div>
          <h1 style="margin:0; font-size: 24px; color: #FFF;">🚀 PadhLo External SSD Backend Server</h1>
          <p style="margin: 4px 0 0 0; color: var(--text-muted); font-size: 13px;">Running on Dedicated External SSD Drive • Live Authentication, Multi-Device Sync, & Installs</p>
        </div>
        <div style="display:flex; gap:10px; align-items:center;">
          <a href="/api/admin/export?key=${key}" download="padhlo_ssd_backup.json" style="background:#8B5CF6; color:white; padding:8px 14px; border-radius:10px; text-decoration:none; font-weight:bold; font-size:12px;">💾 Download Data to SSD</a>
          <div class="ssd-badge">💾 External SSD Active</div>
        </div>
      </div>

      <div class="path-box">
        <strong>📂 SSD Storage Location:</strong> <code>${DATA_DIR}</code><br>
        <span style="color:var(--text-muted); font-size:12px;">All database JSON files (users, study groups, installs, sessions) are safely stored on your External SSD!</span>
      </div>

      <div class="grid">
        <div class="stat-card">
          <div class="stat-val">${installs.length}</div>
          <div class="stat-sub">📱 App Downloads / Installs</div>
        </div>
        <div class="stat-card">
          <div class="stat-val">${Object.keys(users).length}</div>
          <div class="stat-sub">👤 Authenticated Students</div>
        </div>
        <div class="stat-card">
          <div class="stat-val">${Object.keys(groups).length}</div>
          <div class="stat-sub">👥 Active Study Circles</div>
        </div>
        <div class="stat-card">
          <div class="stat-val">${sessions.length}</div>
          <div class="stat-sub">⏱️ Study Sessions Completed</div>
        </div>
      </div>

      <div class="card">
        <h2>📱 Real-Time APK Download & Install Telemetry</h2>
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Device Model</th>
              <th>Install ID</th>
              <th>Student Name</th>
              <th>Target Exam</th>
              <th>Install Timestamp</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${installRows || '<tr><td colspan="7" style="text-align:center;color:#64748B;">No app installs logged yet. When students install and open PadhLo, their device model appears here!</td></tr>'}
          </tbody>
        </table>
      </div>

      <div class="card">
        <h2>👤 Registered Student Accounts (Authentication)</h2>
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>PadhLo ID</th>
              <th>Student Name</th>
              <th>Target Exam</th>
              <th>Plan</th>
              <th>Last Active</th>
            </tr>
          </thead>
          <tbody>
            ${userRows || '<tr><td colspan="6" style="text-align:center;color:#64748B;">No student accounts registered yet.</td></tr>'}
          </tbody>
        </table>
      </div>

      <div class="card">
        <h2>👥 Multi-Device Study Circles</h2>
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Invite Code</th>
              <th>Group Name</th>
              <th>Subject / Exam</th>
              <th>Members</th>
              <th>Group Creator</th>
            </tr>
          </thead>
          <tbody>
            ${groupRows || '<tr><td colspan="6" style="text-align:center;color:#64748B;">No study groups created yet.</td></tr>'}
          </tbody>
        </table>
      </div>
    </body>
    </html>
  `);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('=======================================================');
  console.log(`🚀 PadhLo Server is RUNNING on Port ${PORT}`);
  console.log(`💾 Dedicated Storage Path: ${DATA_DIR}`);
  console.log(`📊 View Live External SSD Dashboard: http://localhost:${PORT}/admin`);
  console.log('✨ Ready for User Authentication, Study Groups, & Telemetry!');
  console.log('=======================================================');
});
