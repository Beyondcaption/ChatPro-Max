const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

// In-Memory Storage
const agents = new Map();
const admins = new Set();
const screenshots = new Map();
const activities = new Map();
const downloads = new Map();

console.log('🚀 Monitoring Relay Server starting...');

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

// Activity Upload
app.post('/api/activity', (req, res) => {
    const { employeeId, timestamp, activity } = req.body;
    
    if (!employeeId || !activity) {
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

    // Store downloads if present
    if (activity.downloads && activity.downloads.length > 0) {
        if (!downloads.has(employeeId)) {
            downloads.set(employeeId, []);
        }
        const downloadList = downloads.get(employeeId);
        activity.downloads.forEach(dl => {
            downloadList.unshift(dl);
        });
        if (downloadList.length > 100) {
            downloadList.length = 100;
        }
    }

    // Broadcast to admins
    broadcastToAdmins({
        type: 'activity_update',
        employeeId,
        activity,
        timestamp: timestamp || Date.now()
    });

    res.json({ success: true });
});

// Screenshot Upload
app.post('/api/screenshots', (req, res) => {
    const { employeeId, imageData, timestamp } = req.body;

    if (!employeeId || !imageData) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    // Store screenshot (keep last 10 per employee)
    if (!screenshots.has(employeeId)) {
        screenshots.set(employeeId, []);
    }
    
    const employeeScreenshots = screenshots.get(employeeId);
    employeeScreenshots.unshift({ 
        imageData, 
        timestamp: timestamp || Date.now() 
    });
    
    if (employeeScreenshots.length > 10) {
        employeeScreenshots.pop();
    }

    // Broadcast to admins
    broadcastToAdmins({
        type: 'screenshot_ready',
        employeeId,
        imageData,
        timestamp: timestamp || Date.now()
    });

    res.json({ success: true });
});

// Alerts
app.post('/api/alerts', (req, res) => {
    const { type, data, timestamp, employeeId } = req.body;

    // Broadcast alert to admins
    broadcastToAdmins({
        type: 'alert',
        alert: {
            type,
            data,
            timestamp: timestamp || Date.now(),
            employeeId
        }
    });

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

// Get Screenshots for employee
app.get('/api/screenshots/:employeeId', (req, res) => {
    const employeeId = parseInt(req.params.employeeId);
    const employeeScreenshots = screenshots.get(employeeId) || [];
    res.json(employeeScreenshots);
});

// Get Activities for employee
app.get('/api/activities/:employeeId', (req, res) => {
    const employeeId = parseInt(req.params.employeeId);
    const employeeActivities = activities.get(employeeId) || [];
    res.json(employeeActivities);
});

// Get Downloads for employee
app.get('/api/downloads/:employeeId', (req, res) => {
    const employeeId = parseInt(req.params.employeeId);
    const employeeDownloads = downloads.get(employeeId) || [];
    res.json(employeeDownloads);
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
    }

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            console.log('📨 Received message type:', data.type);
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
        console.log(`📤 Broadcast to ${sent} admin(s): ${message.type}`);
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
