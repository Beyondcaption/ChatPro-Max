const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json({ limit: '50mb' })); // Größeres Limit für Screenshot-Bilder!

// Storage
const employees = new Map();
const activities = new Map();
const screenshots = new Map();
const downloads = new Map();
const adminConnections = new Set();

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

// Run cleanup on startup
setTimeout(cleanupOldData, 5000);

// Helper function to broadcast to admins
function broadcastToAdmins(data) {
    const message = JSON.stringify(data);
    adminConnections.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(message);
        }
    });
}

// WebSocket Connection Handler
wss.on('connection', (ws) => {
    console.log('📡 New WebSocket connection');
    
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            
            if (data.type === 'register_admin') {
                adminConnections.add(ws);
                console.log('👔 Admin registered. Total admins:', adminConnections.size);
                
                // Send current state
                ws.send(JSON.stringify({
                    type: 'initial_state',
                    employees: Array.from(employees.values()),
                    activities: Object.fromEntries(activities),
                    screenshots: Object.fromEntries(screenshots),
                    downloads: Object.fromEntries(downloads)
                }));
            }
        } catch (error) {
            console.error('WebSocket message error:', error);
        }
    });
    
    ws.on('close', () => {
        adminConnections.delete(ws);
        console.log('👔 Admin disconnected. Total admins:', adminConnections.size);
    });
});

// ============================================
// API ENDPOINTS
// ============================================

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok',
        uptime: process.uptime(),
        employees: employees.size,
        admins: adminConnections.size
    });
});

// Activity tracking
app.post('/api/activity', (req, res) => {
    const { employeeId, activity, timestamp } = req.body;
    
    if (!activities.has(employeeId)) {
        activities.set(employeeId, []);
    }
    
    const activityList = activities.get(employeeId);
    activityList.unshift({
        activity,
        timestamp: timestamp || Date.now()
    });
    
    // Keep only last 500 activities
    if (activityList.length > 500) {
        activityList.length = 500;
    }
    
    // Update employee status
    if (!employees.has(employeeId)) {
        employees.set(employeeId, {
            id: employeeId,
            name: `Employee ${employeeId}`,
            status: 'online',
            lastSeen: Date.now(),
            currentActivity: activity
        });
    } else {
        const emp = employees.get(employeeId);
        emp.lastSeen = Date.now();
        emp.currentActivity = activity;
        emp.status = 'online';
    }
    
    // Broadcast to admins
    broadcastToAdmins({
        type: 'activity',
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
    
    // Keep only last 100
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

    // ✅ User-Screenshots (vom Snipping Tool etc.) - NUR METADATEN!
    if (type === 'user_screenshot' && data && data.filename) {
        // Metadaten nur für Liste, BILD wird separat über /api/screenshots hochgeladen
        if (!downloads.has(employeeId)) {
            downloads.set(employeeId, []);
        }
        const downloadList = downloads.get(employeeId);
        downloadList.unshift({
            filename: data.filename,
            filesize: data.filesize || 0,
            timestamp: data.timestamp || timestamp || Date.now(),
            type: 'screenshot'
        });
        if (downloadList.length > MAX_ITEMS_PER_EMPLOYEE) {
            downloadList.length = MAX_ITEMS_PER_EMPLOYEE;
        }

        // Broadcast als download_detected
        broadcastToAdmins({
            type: 'download_detected',
            employeeId,
            data: {
                filename: data.filename,
                filesize: data.filesize || 0,
                timestamp: data.timestamp || timestamp || Date.now(),
                category: 'screenshot'
            }
        });
    }
    // ✅ Echte Downloads - NUR METADATEN!
    else if (type === 'download_detected' && data && data.filename) {
        if (!downloads.has(employeeId)) {
            downloads.set(employeeId, []);
        }
        const downloadList = downloads.get(employeeId);
        downloadList.unshift({
            filename: data.filename,
            filesize: data.filesize || 0,
            timestamp: data.timestamp || timestamp || Date.now(),
            type: 'download'
        });
        if (downloadList.length > MAX_ITEMS_PER_EMPLOYEE) {
            downloadList.length = MAX_ITEMS_PER_EMPLOYEE;
        }

        // Broadcast
        broadcastToAdmins({
            type: 'download_detected',
            employeeId,
            data: {
                filename: data.filename,
                filesize: data.filesize || 0,
                timestamp: data.timestamp || timestamp || Date.now(),
                category: 'download'
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

// Get all data for dashboard
app.get('/api/dashboard', (req, res) => {
    res.json({
        employees: Array.from(employees.values()),
        activities: Object.fromEntries(activities),
        screenshots: Object.fromEntries(screenshots),
        downloads: Object.fromEntries(downloads)
    });
});

// ============================================
// START SERVER
// ============================================

const PORT = process.env.PORT || 8080;

server.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📊 Dashboard: http://localhost:${PORT}`);
    console.log(`🔌 WebSocket: ws://localhost:${PORT}`);
});
