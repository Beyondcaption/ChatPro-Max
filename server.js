
Kopieren

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
 
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
 
// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' })); // ✅ Größeres Limit für Screenshots!
app.use(express.static('public'));
 
// In-Memory Storage
const agents = new Map();
const admins = new Set();
const screenshots = new Map();
const activities = new Map();
const downloads = new Map();
 
// ============================================
// 💾 PERSISTENT USER STORAGE (FILE-BASED)
// ============================================
const USERS_FILE = path.join(__dirname, 'users.json');
 
// Load users from file
function loadUsers() {
    try {
        if (fs.existsSync(USERS_FILE)) {
            const data = fs.readFileSync(USERS_FILE, 'utf8');
            const usersArray = JSON.parse(data);
            console.log(`💾 Loading ${usersArray.length} users from file...`);
            
            usersArray.forEach(user => {
                users.set(user.username, user);
            });
            
            console.log(`✅ Loaded ${users.size} users successfully`);
        } else {
            console.log('📝 No users file found, creating default admin...');
            // Initialize with default admin
            users.set('admin', {
                username: 'admin',
                password: 'admin123',
                employeeId: 0,
                role: 'admin',
                createdAt: Date.now()
            });
            saveUsers();
        }
    } catch (error) {
        console.error('❌ Error loading users:', error.message);
        // Fallback: create default admin
        users.set('admin', {
            username: 'admin',
            password: 'admin123',
            employeeId: 0,
            role: 'admin',
            createdAt: Date.now()
        });
        saveUsers();
    }
}
 
// Save users to file
function saveUsers() {
    try {
        const usersArray = Array.from(users.values());
        fs.writeFileSync(USERS_FILE, JSON.stringify(usersArray, null, 2), 'utf8');
        console.log(`💾 Saved ${usersArray.length} users to file`);
    } catch (error) {
        console.error('❌ Error saving users:', error.message);
    }
}
 
// User Management Database
const users = new Map();
 
// Load users on startup
loadUsers();
 
console.log('🚀 Monitoring Relay Server starting...');
 
// ✅ AUTO-CLEANUP CONFIGURATION
const MAX_ITEMS_PER_EMPLOYEE = 100;
const MAX_AGE_DAYS = 30;
const CLEANUP_INTERVAL_HOURS = 24;
 
// ✅ Cleanup Function - Läuft alle 24h
function cleanupOldData() {
    const now = Date.now();
    const maxAge = MAX_AGE_DAYS * 24 * 60 * 60 * 1000; // 30 Tage in Millisekunden
    
    console.log('🧹 Running automatic cleanup...');
    
    let totalRemoved = 0;
    
    // Cleanup Screenshots
    for (const [employeeId, items] of screenshots.entries()) {
        const before = items.length;
        
        // Remove items older than 30 days
        const filtered = items.filter(item => {
            const age = now - new Date(item.timestamp).getTime();
            return age < maxAge;
        });
        
        // Keep only last 100 items
        const limited = filtered.slice(0, MAX_ITEMS_PER_EMPLOYEE);
        
        screenshots.set(employeeId, limited);
        
        const removed = before - limited.length;
        if (removed > 0) {
            console.log(`🧹 Removed ${removed} old screenshots for employee ${employeeId}`);
            totalRemoved += removed;
        }
    }
    
    // Cleanup Downloads
    for (const [employeeId, items] of downloads.entries()) {
        const before = items.length;
        
        // Remove items older than 30 days
        const filtered = items.filter(item => {
            const age = now - new Date(item.timestamp).getTime();
            return age < maxAge;
        });
        
        // Keep only last 100 items
        const limited = filtered.slice(0, MAX_ITEMS_PER_EMPLOYEE);
        
        downloads.set(employeeId, limited);
        
        const removed = before - limited.length;
        if (removed > 0) {
            console.log(`🧹 Removed ${removed} old downloads for employee ${employeeId}`);
            totalRemoved += removed;
        }
    }
    
    // Cleanup Activities (keep last 500 per employee, remove older than 30 days)
    for (const [employeeId, items] of activities.entries()) {
        const before = items.length;
        
        const filtered = items.filter(item => {
            const age = now - new Date(item.timestamp).getTime();
            return age < maxAge;
        });
        
        const limited = filtered.slice(0, 500);
        activities.set(employeeId, limited);
        
        const removed = before - limited.length;
        if (removed > 0) {
            console.log(`🧹 Removed ${removed} old activities for employee ${employeeId}`);
            totalRemoved += removed;
        }
    }
    
    console.log(`✅ Cleanup complete! Removed ${totalRemoved} total items`);
}
 
// ✅ Start automatic cleanup (runs every 24 hours)
setInterval(cleanupOldData, CLEANUP_INTERVAL_HOURS * 60 * 60 * 1000);
console.log(`🧹 Auto-cleanup scheduled: Every ${CLEANUP_INTERVAL_HOURS}h, Max ${MAX_AGE_DAYS} days, Max ${MAX_ITEMS_PER_EMPLOYEE} items/employee`);
 
// Run cleanup on startup (after 5 seconds)
setTimeout(cleanupOldData, 5000);
 
// ============================================
// REST API ENDPOINTS
// ============================================
 
// Health Check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok',
        agents: agents.size,
        admins: admins.size,
        uptime: Math.floor(process.uptime()),
        memory: Math.floor(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB'
    });
});
 
// ============================================
// USER MANAGEMENT ENDPOINTS
// ============================================
 
// Login Endpoint
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    
    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password required' });
    }
    
    const user = users.get(username);
    
    if (!user || user.password !== password) {
        return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    res.json({
        success: true,
        user: {
            username: user.username,
            employeeId: user.employeeId,
            role: user.role
        }
    });
});
 
// Get All Users (Admin only - no auth for now)
app.get('/api/admin/users', (req, res) => {
    const userList = Array.from(users.values()).map(u => ({
        username: u.username,
        employeeId: u.employeeId,
        role: u.role,
        createdAt: u.createdAt
    }));
    
    res.json({ users: userList });
});
 
// Create User (Admin only - no auth for now)
app.post('/api/admin/users', (req, res) => {
    const { username, password, employeeName } = req.body;
    
    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password required' });
    }
    
    if (users.has(username)) {
        return res.status(409).json({ error: 'Username already exists' });
    }
    
    // Generate next employeeId
    const existingIds = Array.from(users.values()).map(u => u.employeeId);
    const maxId = existingIds.length > 0 ? Math.max(...existingIds) : 0;
    const newEmployeeId = maxId + 1;
    
    const newUser = {
        username,
        password,
        employeeId: newEmployeeId,
        employeeName: employeeName || username,
        role: 'employee',
        createdAt: Date.now()
    };
    
    users.set(username, newUser);
    saveUsers(); // 💾 Save to file!
    
    res.json({
        success: true,
        user: {
            username: newUser.username,
            employeeId: newUser.employeeId,
            role: newUser.role
        }
    });
});
 
// Delete User (Admin only - no auth for now)
app.delete('/api/admin/users/:username', (req, res) => {
    const { username } = req.params;
    
    if (username === 'admin') {
        return res.status(403).json({ error: 'Cannot delete admin user' });
    }
    
    if (!users.has(username)) {
        return res.status(404).json({ error: 'User not found' });
    }
    
    users.delete(username);
    saveUsers(); // 💾 Save to file!
    
    res.json({ success: true });
});
 
// Update User Password (Admin only - no auth for now)
app.put('/api/admin/users/:username/password', (req, res) => {
    const { username } = req.params;
    const { newPassword } = req.body;
    
    if (!newPassword) {
        return res.status(400).json({ error: 'New password required' });
    }
    
    const user = users.get(username);
    if (!user) {
        return res.status(404).json({ error: 'User not found' });
    }
    
    user.password = newPassword;
    saveUsers(); // 💾 Save to file!
    
    res.json({ success: true });
});
 
// ============================================
// USER MANAGEMENT ALIASES (für Dashboard)
// ============================================
 
// Create User - Alias mit auto-generated password
app.post('/api/users/create', (req, res) => {
    const { username, employeeName } = req.body;
    
    if (!username || !employeeName) {
        return res.status(400).json({ error: 'Username and employeeName required' });
    }
    
    if (users.has(username)) {
        return res.status(409).json({ error: 'Username already exists' });
    }
    
    // Generate random password
    const password = Math.random().toString(36).slice(-8) + Math.random().toString(36).slice(-8);
    
    // Generate next employeeId
    const existingIds = Array.from(users.values()).map(u => u.employeeId);
    const maxId = existingIds.length > 0 ? Math.max(...existingIds) : 0;
    const newEmployeeId = maxId + 1;
    
    const newUser = {
        username,
        password,
        employeeId: newEmployeeId,
        employeeName: employeeName || username,
        role: 'employee',
        createdAt: Date.now()
    };
    
    users.set(username, newUser);
    saveUsers(); // 💾 Save to file!
    
    console.log(`👤 New user created: ${username} (ID: ${newEmployeeId})`);
    
    res.json({
        success: true,
        username: newUser.username,
        password: password, // ⚠️ Only returned once!
        employeeId: newUser.employeeId,
        employeeName: newUser.employeeName
    });
});
 
// Delete User by ID - Alias
app.delete('/api/users/:employeeId', (req, res) => {
    const employeeId = parseInt(req.params.employeeId);
    
    if (employeeId === 0) {
        return res.status(403).json({ error: 'Cannot delete admin user' });
    }
    
    // Find user by employeeId
    let userToDelete = null;
    for (const [username, user] of users.entries()) {
        if (user.employeeId === employeeId) {
            userToDelete = username;
            break;
        }
    }
    
    if (!userToDelete) {
        return res.status(404).json({ error: 'User not found' });
    }
    
    users.delete(userToDelete);
    saveUsers(); // 💾 Save to file!
    
    console.log(`👤 User deleted: ${userToDelete} (ID: ${employeeId})`);
    
    res.json({ success: true });
});
 
// Activity Upload
app.post('/api/activity', (req, res) => {
    const { employeeId, timestamp, activity } = req.body;
    
    if (employeeId === undefined || !activity) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
 
    // Store agent info
    const agentKey = `agent_${employeeId}`;
    agents.set(agentKey, {
        employeeId,
        name: activity.employeeName || `Employee ${employeeId}`,
        lastActivity: activity,
        lastSeen: Date.now()
    });
 
    // Store activity history (keep last 100)
    if (!activities.has(employeeId)) {
        activities.set(employeeId, []);
    }
    const activityList = activities.get(employeeId);
    activityList.unshift({ 
        timestamp: timestamp || Date.now(), 
        activity 
    });
    if (activityList.length > 100) {
        activityList.length = 100;
    }
 
    // ✅ FIXED: Broadcast mit richtigem Format!
    broadcastToAdmins({
        type: 'activity',  // Dashboard erwartet 'activity'!
        employeeId,
        activity,
        timestamp: timestamp || Date.now()
    });
 
    res.json({ success: true });
});
 
// ✅ Screenshot Upload - FÜR BILDER!
app.post('/api/screenshots', (req, res) => {
    const { employeeId, imageData, filename, timestamp } = req.body;
    
    console.log('📸 Screenshot received from employee:', employeeId);
    
    if (!screenshots.has(employeeId)) {
        screenshots.set(employeeId, []);
    }
    
    const screenshotList = screenshots.get(employeeId);
    screenshotList.unshift({
        imageData,          // Das Base64-Bild!
        filename,
        timestamp: timestamp || Date.now()
    });
    
    // Keep only last 100 (wird auch durch Auto-Cleanup begrenzt)
    if (screenshotList.length > MAX_ITEMS_PER_EMPLOYEE) {
        screenshotList.length = MAX_ITEMS_PER_EMPLOYEE;
    }
    
    // Broadcast to admins
    broadcastToAdmins({
        type: 'screenshot',
        employeeId,
        data: {
            imageData,
            filename,
            timestamp: timestamp || Date.now()
        }
    });
    
    res.json({ success: true });
});
 
// Alerts - für Downloads UND User-Screenshots!
app.post('/api/alerts', (req, res) => {
    const { type, data, timestamp, employeeId } = req.body;
 
    console.log('🚨 Alert received:', type, 'from employee:', employeeId);
 
    // ✅ User-Screenshots (vom Snipping Tool etc.)
    if (type === 'user_screenshot' && data && data.filename) {
        if (!screenshots.has(employeeId)) {
            screenshots.set(employeeId, []);
        }
        const screenshotList = screenshots.get(employeeId);
        screenshotList.unshift({
            filename: data.filename,
            filesize: data.filesize || 0,
            timestamp: data.timestamp || timestamp || Date.now(),
            type: 'user_screenshot'
        });
        if (screenshotList.length > 100) {
            screenshotList.length = 100;
        }
 
        // Broadcast to Dashboard
        broadcastToAdmins({
            type: 'screenshot',  // Dashboard erwartet 'screenshot'!
            employeeId,
            data: {
                filename: data.filename,
                filesize: data.filesize || 0,
                timestamp: data.timestamp || timestamp || Date.now()
            }
        });
    }
    // ✅ Echte Downloads
    else if (type === 'download_detected' && data && data.filename) {
        if (!downloads.has(employeeId)) {
            downloads.set(employeeId, []);
        }
        const downloadList = downloads.get(employeeId);
        downloadList.unshift({
            filename: data.filename,
            filesize: data.filesize || 0,
            timestamp: data.timestamp || timestamp || Date.now()
        });
        if (downloadList.length > 100) {
            downloadList.length = 100;
        }
 
        // Broadcast to Dashboard
        broadcastToAdmins({
            type: 'download_detected',
            employeeId,
            data: {
                filename: data.filename,
                filesize: data.filesize || 0,
                timestamp: data.timestamp || timestamp || Date.now()
            }
        });
    } 
    // ✅ Andere Alerts
    else {
        broadcastToAdmins({
            type: 'alert',
            alert: {
                type,
                data,
                timestamp: timestamp || Date.now(),
                employeeId
            }
        });
    }
 
    res.json({ success: true });
});
 
// Ping (keep-alive)
app.post('/api/ping', (req, res) => {
    const { employeeId, timestamp, version } = req.body;
    
    if (employeeId) {
        const agentKey = `agent_${employeeId}`;
        if (agents.has(agentKey)) {
            agents.get(agentKey).lastSeen = Date.now();
        }
    }
    
    res.json({ success: true });
});
 
// ============================================
// 🔧 FIXED GET ENDPOINTS - Jetzt mit richtigem Format!
// ============================================
 
// Get Screenshots for employee
app.get('/api/screenshots/:employeeId', (req, res) => {
    const employeeId = parseInt(req.params.employeeId);
    const employeeScreenshots = screenshots.get(employeeId) || [];
    
    console.log(`📸 GET /api/screenshots/${employeeId} - Returning ${employeeScreenshots.length} screenshots`);
    
    // ✅ FIXED: Wrap in object with 'screenshots' property
    res.json({ 
        success: true,
        screenshots: employeeScreenshots 
    });
});
 
// Get Activities for employee
app.get('/api/activities/:employeeId', (req, res) => {
    const employeeId = parseInt(req.params.employeeId);
    const employeeActivities = activities.get(employeeId) || [];
    
    // ✅ Transform to match dashboard expectations
    const transformedActivities = employeeActivities.map(item => ({
        appName: item.activity?.application || 'Unknown',
        windowTitle: item.activity?.windowTitle || '',
        timestamp: item.activity?.timestamp || item.timestamp
    }));
    
    console.log(`📊 GET /api/activities/${employeeId} - Returning ${transformedActivities.length} activities`);
    
    // ✅ FIXED: Wrap in object with 'activities' property
    res.json({ 
        success: true,
        activities: transformedActivities 
    });
});
 
// ═══════════════════════════════════════════════════════════════════
// TRANSLATIONS API (NEW!)
// ═══════════════════════════════════════════════════════════════════
 
const translations = new Map();
 
// POST Translation
app.post('/api/translations', (req, res) => {
    const { employeeId, employeeName, timestamp, translation } = req.body;
    
    if (employeeId === undefined || !translation) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    
    // Store translation history (keep last 100)
    if (!translations.has(employeeId)) {
        translations.set(employeeId, []);
    }
    const translationList = translations.get(employeeId);
    translationList.unshift({ 
        timestamp: timestamp || Date.now(), 
        employeeName,
        translation 
    });
    if (translationList.length > 100) {
        translationList.length = 100;
    }
    
    console.log(`💬 Translation logged for employee ${employeeId}`);
    
    // Broadcast to admins
    broadcastToAdmins({
        type: 'translation',
        employeeId,
        employeeName,
        translation,
        timestamp: timestamp || Date.now()
    });
    
    res.json({ success: true });
});
 
// GET Translations for employee
app.get('/api/translations/:employeeId', (req, res) => {
    const employeeId = parseInt(req.params.employeeId);
    const employeeTranslations = translations.get(employeeId) || [];
    
    console.log(`📊 GET /api/translations/${employeeId} - Returning ${employeeTranslations.length} translations`);
    
    res.json({ 
        success: true,
        translations: employeeTranslations 
    });
});
 
// Get Downloads for employee
app.get('/api/downloads/:employeeId', (req, res) => {
    const employeeId = parseInt(req.params.employeeId);
    const employeeDownloads = downloads.get(employeeId) || [];
    
    console.log(`📥 GET /api/downloads/${employeeId} - Returning ${employeeDownloads.length} downloads`);
    
    // ✅ FIXED: Wrap in object with 'downloads' property
    res.json({ 
        success: true,
        downloads: employeeDownloads 
    });
});
 
// Get all agents
app.get('/api/agents', (req, res) => {
    const now = Date.now();
    const agentsList = Array.from(agents.values()).map(agent => ({
        employeeId: agent.employeeId,
        name: agent.name,
        lastSeen: agent.lastSeen,
        status: now - agent.lastSeen < 120000 ? 'online' : 'offline',
        lastActivity: agent.lastActivity
    }));
    res.json(agentsList);
});
 
// ============================================
// ✅ NEW ENDPOINT: Get Employees (merged users + agents)
// ============================================
app.get('/api/employees', (req, res) => {
    const now = Date.now();
    
    // Combine users with agent status
    const employeeList = Array.from(users.values())
        .filter(u => u.role === 'employee')
        .map(u => {
            const agentKey = `agent_${u.employeeId}`;
            const agent = agents.get(agentKey);
            
            return {
                id: u.employeeId,
                name: u.employeeName || u.username,
                username: u.username,
                online: agent ? (now - agent.lastSeen < 120000) : false,
                lastSeen: agent ? agent.lastSeen : null,
                lastActivity: agent ? agent.lastActivity : null,
                createdAt: u.createdAt
            };
        });
    
    res.json({ employees: employeeList });
});
 
// ============================================
// 📊 DASHBOARD ROUTE (explicit for Railway)
// ============================================
app.get('/dashboard.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});
 
// ============================================
// WEBSOCKET
// ============================================
 
wss.on('connection', (ws, req) => {
    console.log('📡 New WebSocket connection');
    
    const url = new URL(req.url, `http://${req.headers.host}`);
    const role = url.searchParams.get('role');
    const employeeId = url.searchParams.get('employeeId');
 
    if (role === 'admin') {
        // Admin connection
        admins.add(ws);
        console.log('👨‍💼 Admin connected. Total admins:', admins.size);
 
        // Send current agents list
        const now = Date.now();
        const agentsList = Array.from(agents.values()).map(agent => ({
            employeeId: agent.employeeId,
            name: agent.name,
            lastSeen: agent.lastSeen,
            status: now - agent.lastSeen < 120000 ? 'online' : 'offline',
            lastActivity: agent.lastActivity
        }));
 
        ws.send(JSON.stringify({
            type: 'agents_list',
            agents: agentsList
        }));
 
        ws.on('close', () => {
            admins.delete(ws);
            console.log('👨‍💼 Admin disconnected. Total admins:', admins.size);
        });
 
        ws.on('error', (error) => {
            console.error('Admin WebSocket error:', error.message);
        });
    } else {
        // Regular connection (no role specified)
        // Still add to admins for backward compatibility
        admins.add(ws);
        console.log('📡 Client connected (no role). Total clients:', admins.size);
 
        ws.on('close', () => {
            admins.delete(ws);
            console.log('📡 Client disconnected. Total clients:', admins.size);
        });
    }
 
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            console.log('📨 Received message type:', data.type);
            
            // ✅ Handle register_admin message
            if (data.type === 'register_admin') {
                admins.add(ws);
                console.log('👨‍💼 Admin registered via message. Total admins:', admins.size);
                
                // Send initial state
                ws.send(JSON.stringify({
                    type: 'initial_state',
                    employees: Array.from(agents.values()),
                    activities: Object.fromEntries(activities),
                    screenshots: Object.fromEntries(screenshots),
                    downloads: Object.fromEntries(downloads)
                }));
                
                // Setup close handler
                ws.on('close', () => {
                    admins.delete(ws);
                    console.log('👨‍💼 Admin disconnected. Total admins:', admins.size);
                });
            }
        } catch (error) {
            console.error('Message parse error:', error.message);
        }
    });
});
 
function broadcastToAdmins(message) {
    let sent = 0;
    admins.forEach(admin => {
        if (admin.readyState === WebSocket.OPEN) {
            try {
                admin.send(JSON.stringify(message));
                sent++;
            } catch (error) {
                console.error('Broadcast error:', error.message);
            }
        }
    });
    if (sent > 0) {
        console.log(`📤 Broadcast to ${sent} client(s): ${message.type}`);
    }
}
 
// ============================================
// CLEANUP & MAINTENANCE
// ============================================
 
// Cleanup old inactive agents every 5 minutes
setInterval(() => {
    const now = Date.now();
    const timeout = 300000; // 5 minutes
 
    for (const [key, agent] of agents.entries()) {
        if (now - agent.lastSeen > timeout) {
            agents.delete(key);
            console.log(`🗑️ Removed inactive agent: ${agent.employeeId} (${agent.name})`);
            
            // Notify admins
            broadcastToAdmins({
                type: 'agent_disconnected',
                employeeId: agent.employeeId
            });
        }
    }
}, 300000);
 
// Memory cleanup every 30 minutes
setInterval(() => {
    // Cleanup old screenshots (keep only last 10)
    screenshots.forEach((list, employeeId) => {
        if (list.length > 10) {
            list.length = 10;
        }
    });
 
    // Cleanup old activities (keep only last 100)
    activities.forEach((list, employeeId) => {
        if (list.length > 100) {
            list.length = 100;
        }
    });
 
    // Cleanup old downloads (keep only last 100)
    downloads.forEach((list, employeeId) => {
        if (list.length > 100) {
            list.length = 100;
        }
    });
 
    console.log('🧹 Memory cleanup completed');
}, 1800000);
 
// ============================================
// SERVER START
// ============================================
 
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log('');
    console.log('🎉 ==========================================');
    console.log('🎉  Monitoring Relay Server ONLINE!');
    console.log('🎉 ==========================================');
    console.log('');
    console.log(`📊 Server: http://localhost:${PORT}`);
    console.log(`🔗 Health: http://localhost:${PORT}/health`);
    console.log(`🔗 API:    http://localhost:${PORT}/api`);
    console.log('');
    console.log('💡 Ready to receive connections from agents');
    console.log('💡 Dashboard can connect via WebSocket');
    console.log('');
});
 
// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('🛑 SIGTERM received, shutting down gracefully...');
    server.close(() => {
        console.log('✅ Server closed');
        process.exit(0);
    });
});
 
process.on('SIGINT', () => {
    console.log('🛑 SIGINT received, shutting down gracefully...');
    server.close(() => {
        console.log('✅ Server closed');
        process.exit(0);
    });
});
