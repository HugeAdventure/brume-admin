import mysql from 'mysql2/promise';
import crypto from 'crypto';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// Lazy RCON — won't crash the whole module if package is missing
let Rcon;
try { Rcon = require('rcon'); } catch { Rcon = null; }

// ── Connection pool (reused across requests on Vercel) ──
let pool;
function getPool() {
    if (!pool) {
        pool = mysql.createPool({
            uri: process.env.DATABASE_URL,
            waitForConnections: true,
            connectionLimit: 5,
            queueLimit: 0,
        });
    }
    return pool;
}

// ── RCON helper ──
function rconExec(command) {
    if (!Rcon) throw new Error('RCON package not installed. Run: npm install rcon');
    return new Promise((resolve, reject) => {
        const conn = new Rcon(
            process.env.RCON_HOST || 'localhost',
            parseInt(process.env.RCON_PORT || '25575'),
            process.env.RCON_PASSWORD
        );

        let output = '';
        const timeout = setTimeout(() => {
            conn.disconnect();
            reject(new Error('RCON timeout'));
        }, 8000);

        conn.on('auth', () => conn.send(command));
        conn.on('response', (str) => {
            output += str;
            clearTimeout(timeout);
            conn.disconnect();
            resolve(output);
        });
        conn.on('error', (err) => {
            clearTimeout(timeout);
            reject(err);
        });

        conn.connect();
    });
}

// ── Auth helper ──
async function authenticate(req, db) {
    const authHeader = req.headers['authorization'];
    if (!authHeader) return null;
    const token = authHeader.split(' ')[1];
    const [rows] = await db.execute('SELECT * FROM admins WHERE token = ?', [token]);
    return rows[0] || null;
}

// ── Role guards ──
const ROLES = {
    modOrAbove: ['admin', 'mod'],
    adminOnly:  ['admin'],
};

export default async function handler(req, res) {
    const db = getPool();
    
    try {
        const { mode } = req.query;

        // ════ LOGIN ════
        if (req.method === 'POST' && mode === 'login') {
            const { username, password } = req.body;
            const [rows] = await db.execute('SELECT * FROM admins WHERE username = ?', [username]);
            const admin = rows[0];

            // TODO: replace with bcrypt.compare(password, admin.password_hash)
            if (!admin || admin.password !== password) {
                return res.status(401).json({ error: "Invalid username or password" });
            }

            const token = crypto.randomBytes(32).toString('hex');
            await db.execute('UPDATE admins SET token = ? WHERE id = ?', [token, admin.id]);

            return res.json({
                success: true,
                token,
                user: { username: admin.username, role: admin.role }
            });
        }

        // ════ AUTHENTICATED ROUTES ════
        const user = await authenticate(req, db);
        if (!user) return res.status(401).json({ error: "Session expired or invalid" });

        // ── Stats ──
        if (mode === 'stats' && ROLES.modOrAbove.includes(user.role)) {
            const [[{ c: user_count }]] = await db.execute('SELECT COUNT(*) as c FROM brume_stats');
            const [[{ c: total_economy }]] = await db.execute('SELECT SUM(coins) as c FROM brume_stats');
            const [richest] = await db.execute('SELECT name, coins FROM brume_stats ORDER BY coins DESC LIMIT 1');
            return res.json({
                user_count,
                total_economy: total_economy || 0,
                top_player: richest[0] ? `${richest[0].name} (${Number(richest[0].coins).toLocaleString()})` : "None"
            });
        }

        // ── Lookup ──
        if (req.method === 'POST' && mode === 'lookup' && ROLES.modOrAbove.includes(user.role)) {
            const { query } = req.body;
            const [rows] = await db.execute(
                'SELECT * FROM brume_stats WHERE name = ? OR uuid = ?', [query, query]
            );
            return res.json(rows[0] || { error: "Player not found" });
        }

        // ── Player autocomplete ──
        if (mode === 'player_autocomplete' && ROLES.modOrAbove.includes(user.role)) {
            const q = req.query.q || '';
            if (q.length < 1) return res.json([]);
            const [rows] = await db.execute(
                `SELECT name, uuid, coins, level, total_playtime_s, last_seen
                 FROM brume_stats WHERE name LIKE ? ORDER BY last_seen DESC LIMIT 8`,
                [`${q}%`]
            );
            return res.json(rows);
        }

        // ── Rich player detail — everything about one player ──
        if (req.method === 'POST' && mode === 'player_detail' && ROLES.modOrAbove.includes(user.role)) {
            const { query } = req.body;
            const [rows] = await db.execute(
                'SELECT * FROM brume_stats WHERE name = ? OR uuid = ?', [query, query]
            );
            const player = rows[0];
            if (!player) return res.status(404).json({ error: "Player not found" });

            const uuid = player.uuid;
            const name = player.name;

            // Run all queries in parallel
            const [
                [snapshots],
                [sessions],
                [punishments],
                [ipHistory],
                [[coinRank]],
                [[playtimeRank]],
                [[levelRank]],
                [[serverTotals]],
                [alerts],
                [recentSessions],
            ] = await Promise.all([
                db.execute(
                    `SELECT coins, level, xp, snapped_at FROM player_snapshots
                     WHERE uuid = ? ORDER BY snapped_at DESC LIMIT 60`, [uuid]
                ),
                db.execute(
                    `SELECT joined_at, quit_at, duration_s FROM session_log
                     WHERE uuid = ? ORDER BY joined_at DESC LIMIT 20`, [uuid]
                ),
                db.execute(
                    `SELECT * FROM punishments WHERE target_name = ? ORDER BY issued_at DESC`, [name]
                ),
                db.execute(
                    `SELECT ip, MIN(joined_at) as first_seen, MAX(joined_at) as last_seen, COUNT(*) as times
                     FROM ip_log WHERE uuid = ? GROUP BY ip ORDER BY last_seen DESC LIMIT 10`, [uuid]
                ),
                db.execute(
                    `SELECT COUNT(*) + 1 as rank FROM brume_stats WHERE coins > ?`, [player.coins]
                ),
                db.execute(
                    `SELECT COUNT(*) + 1 as rank FROM brume_stats WHERE total_playtime_s > ?`, [player.total_playtime_s || 0]
                ),
                db.execute(
                    `SELECT COUNT(*) + 1 as rank FROM brume_stats WHERE level > ? OR (level = ? AND xp > ?)`,
                    [player.level, player.level, player.xp || 0]
                ),
                db.execute(
                    `SELECT COUNT(*) as total_players, AVG(coins) as avg_coins, AVG(total_playtime_s) as avg_playtime FROM brume_stats`
                ),
                db.execute(
                    `SELECT type, severity, detail, created_at, resolved FROM alerts
                     WHERE player_name = ? ORDER BY created_at DESC LIMIT 5`, [name]
                ),
                db.execute(
                    `SELECT joined_at, duration_s FROM session_log
                     WHERE uuid = ? AND duration_s IS NOT NULL
                     ORDER BY joined_at DESC LIMIT 30`, [uuid]
                ),
            ]);

            // ── Calculated stats ──
            const totalSessions = player.session_count || 0;
            const totalPlaytimeH = (player.total_playtime_s || 0) / 3600;
            const coinsPerHour = totalPlaytimeH > 0
                ? Math.round(player.coins / totalPlaytimeH)
                : 0;

            const avgSessionS = recentSessions.length > 0
                ? Math.round(recentSessions.reduce((s, r) => s + (r.duration_s || 0), 0) / recentSessions.length)
                : 0;

            // Wealth trend — compare current coins to 7 days ago snapshot
            const weekAgoSnap = snapshots.find(s => {
                const d = new Date(s.snapped_at);
                return (Date.now() - d.getTime()) >= 6 * 24 * 3600 * 1000;
            });
            const wealthTrend = weekAgoSnap
                ? Math.round(((player.coins - weekAgoSnap.coins) / Math.max(weekAgoSnap.coins, 1)) * 100)
                : null;

            // Percentile calculations
            const totalPlayers = serverTotals.total_players || 1;
            const coinPercentile = Math.round(((totalPlayers - coinRank.rank + 1) / totalPlayers) * 100);
            const playtimePercentile = Math.round(((totalPlayers - playtimeRank.rank + 1) / totalPlayers) * 100);
            const levelPercentile = Math.round(((totalPlayers - levelRank.rank + 1) / totalPlayers) * 100);

            // Days since last seen
            const lastSeen = player.last_seen ? new Date(player.last_seen) : null;
            const daysSinceLastSeen = lastSeen
                ? Math.floor((Date.now() - lastSeen.getTime()) / (1000 * 60 * 60 * 24))
                : null;

            // Is online right now?
            const [[onlineCheck]] = await db.execute(
                `SELECT uuid FROM online_sessions WHERE uuid = ?`, [uuid]
            );
            const isOnline = !!onlineCheck;

            // Alt accounts
            const altMap = {};
            for (const ipRow of ipHistory) {
                const [others] = await db.execute(
                    `SELECT DISTINCT name, uuid FROM ip_log WHERE ip = ? AND uuid != ? LIMIT 5`,
                    [ipRow.ip, uuid]
                );
                if (others.length) altMap[ipRow.ip] = others;
            }

            return res.json({
                player: {
                    ...player,
                    is_online: isOnline,
                    days_since_last_seen: daysSinceLastSeen,
                },
                stats: {
                    coins_per_hour: coinsPerHour,
                    avg_session_s: avgSessionS,
                    wealth_trend_pct: wealthTrend,
                    coin_rank: coinRank.rank,
                    coin_percentile: coinPercentile,
                    playtime_rank: playtimeRank.rank,
                    playtime_percentile: playtimePercentile,
                    level_rank: levelRank.rank,
                    level_percentile: levelPercentile,
                    total_players: totalPlayers,
                    server_avg_coins: Math.round(serverTotals.avg_coins || 0),
                    server_avg_playtime: Math.round(serverTotals.avg_playtime || 0),
                },
                snapshots: snapshots.reverse(), // chronological
                sessions,
                punishments,
                ip_history: ipHistory,
                alt_accounts: altMap,
                security_alerts: alerts,
            });
        }

        // ── Update player ──
        if (req.method === 'POST' && mode === 'update' && user.role === 'admin') {
            const { uuid, name, coins, level } = req.body;
            await db.execute('UPDATE brume_stats SET coins = ?, level = ? WHERE uuid = ?', [coins, level, uuid]);
            await db.execute(
                'INSERT INTO action_logs (username, action) VALUES (?, ?)',
                [user.username, `Updated ${name} — Coins: ${coins}, Lvl: ${level}`]
            );
            return res.json({ success: true });
        }

        // ── Staff list ──
        if (mode === 'staff_list' && user.role === 'admin') {
            const [rows] = await db.execute('SELECT id, username, role FROM admins ORDER BY role ASC');
            return res.json(rows);
        }

        // ── Logs ──
        if (mode === 'logs' && ROLES.modOrAbove.includes(user.role)) {
            const [rows] = await db.execute(
                'SELECT * FROM action_logs ORDER BY timestamp DESC LIMIT 50'
            );
            return res.json(rows);
        }

        // ════ ONLINE PLAYERS ════
        // Reads from a `online_sessions` table that your Minecraft plugin writes to.
        // Columns: uuid, name, coins, level, joined_at
        if (mode === 'online_players' && ROLES.modOrAbove.includes(user.role)) {
            const [rows] = await db.execute(
                `SELECT s.uuid, s.name, s.joined_at, b.coins, b.level
                 FROM online_sessions s
                 LEFT JOIN brume_stats b ON b.uuid = s.uuid
                 ORDER BY s.joined_at ASC`
            );
            return res.json(rows);
        }

        // ════ BANS & WARNINGS ════

        // Issue punishment
        if (req.method === 'POST' && mode === 'punish' && ROLES.modOrAbove.includes(user.role)) {
            const { target, type, reason, duration } = req.body;

            if (!['warn', 'ban', 'tempban'].includes(type)) {
                return res.status(400).json({ error: "Invalid punishment type" });
            }

            // Persist in DB
            await db.execute(
                `INSERT INTO punishments (target_name, type, reason, duration, issued_by, issued_at, active)
                 VALUES (?, ?, ?, ?, ?, NOW(), 1)`,
                [target, type, reason, duration || null, user.username]
            );

            // Fire RCON command so it takes effect in-game immediately
            try {
                if (type === 'ban') {
                    await rconExec(`ban ${target} ${reason}`);
                } else if (type === 'tempban') {
                    // Requires a plugin like LiteBans/AdvancedBan:
                    await rconExec(`tempban ${target} ${duration || '1d'} ${reason}`);
                } else if (type === 'warn') {
                    await rconExec(`warn ${target} ${reason}`);
                }
            } catch (rconErr) {
                // RCON fail is non-fatal — punishment is still logged in DB
                console.warn('RCON error (punishment still saved):', rconErr.message);
            }

            await db.execute(
                'INSERT INTO action_logs (username, action) VALUES (?, ?)',
                [user.username, `Issued ${type.toUpperCase()} to ${target}: "${reason}"`]
            );

            return res.json({ success: true });
        }

        // List active punishments
        if (mode === 'bans_list' && ROLES.modOrAbove.includes(user.role)) {
            const [rows] = await db.execute(
                `SELECT * FROM punishments WHERE active = 1 ORDER BY issued_at DESC`
            );
            return res.json(rows);
        }

        // Revoke punishment
        if (req.method === 'POST' && mode === 'revoke' && ROLES.modOrAbove.includes(user.role)) {
            const { id } = req.body;
            const [[p]] = await db.execute('SELECT * FROM punishments WHERE id = ?', [id]);
            if (!p) return res.status(404).json({ error: "Punishment not found" });

            await db.execute('UPDATE punishments SET active = 0 WHERE id = ?', [id]);

            // Unban in-game if it was a ban
            try {
                if (p.type === 'ban' || p.type === 'tempban') {
                    await rconExec(`pardon ${p.target_name}`);
                }
            } catch (rconErr) {
                console.warn('RCON error (revoke still saved):', rconErr.message);
            }

            await db.execute(
                'INSERT INTO action_logs (username, action) VALUES (?, ?)',
                [user.username, `Revoked ${p.type.toUpperCase()} for ${p.target_name}`]
            );

            return res.json({ success: true });
        }

        // ════ SERVER CONSOLE ════
        if (req.method === 'POST' && mode === 'console' && user.role === 'admin') {
            const { command } = req.body;

            // Block dangerous commands
            const blocked = ['stop', 'restart', 'reload', 'op ', 'deop '];
            const lower = command.toLowerCase().trim();
            if (blocked.some(b => lower.startsWith(b))) {
                return res.status(403).json({ error: "Command blocked for safety. Use your server host panel for server lifecycle commands." });
            }

            let output;
            try {
                output = await rconExec(command);
            } catch (err) {
                return res.status(500).json({ error: `RCON error: ${err.message}` });
            }

            await db.execute(
                'INSERT INTO action_logs (username, action) VALUES (?, ?)',
                [user.username, `Console: /${command}`]
            );

            return res.json({ success: true, output: output || '(no output)' });
        }

        // ════ ANALYTICS ════

        // Economy inflation — hourly snapshots for the last N days
        if (mode === 'analytics_economy' && ROLES.modOrAbove.includes(user.role)) {
            const days = parseInt(req.query.days) || 30;
            const [rows] = await db.execute(
                `SELECT
                    DATE_FORMAT(snapped_at, '%Y-%m-%d %H:00') as hour,
                    GREATEST(total_coins, 0) as total_coins,
                    total_players as registered_players,
                    online_count,
                    GREATEST(avg_coins, 0) as avg_coins,
                    GREATEST(max_coins, 0) as max_coins
                 FROM economy_snapshots
                 WHERE snapped_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
                 ORDER BY snapped_at ASC`,
                [days]
            );
            const [[peak]] = await db.execute(
                `SELECT GREATEST(MAX(total_coins), 0) as peak_coins, MAX(total_players) as peak_players, MAX(online_count) as peak_online FROM economy_snapshots`
            );
            return res.json({ snapshots: rows, peak });
        }

        // Playtime heatmap — avg sessions by hour-of-day × day-of-week
        if (mode === 'analytics_heatmap' && ROLES.modOrAbove.includes(user.role)) {
            const [rows] = await db.execute(
                `SELECT
                    DAYOFWEEK(joined_at) - 1 AS day_of_week,
                    HOUR(joined_at)          AS hour_of_day,
                    COUNT(*)                 AS session_count,
                    AVG(duration_s)          AS avg_duration_s
                 FROM session_log
                 WHERE joined_at >= DATE_SUB(NOW(), INTERVAL 90 DAY)
                   AND duration_s IS NOT NULL
                 GROUP BY day_of_week, hour_of_day
                 ORDER BY day_of_week, hour_of_day`
            );
            return res.json(rows);
        }

        // Retention — new vs returning players per week
        if (mode === 'analytics_retention' && ROLES.modOrAbove.includes(user.role)) {
            const [rows] = await db.execute(
                `SELECT
                    YEARWEEK(joined_at, 1)                         AS yw,
                    MIN(DATE(joined_at))                           AS week_start,
                    COUNT(DISTINCT uuid)                           AS total_players,
                    COUNT(DISTINCT CASE
                        WHEN joined_at = (SELECT MIN(s2.joined_at) FROM session_log s2 WHERE s2.uuid = session_log.uuid)
                        THEN uuid END)                             AS new_players,
                    COUNT(DISTINCT CASE
                        WHEN joined_at > (SELECT MIN(s2.joined_at) FROM session_log s2 WHERE s2.uuid = session_log.uuid)
                        THEN uuid END)                             AS returning_players
                 FROM session_log
                 WHERE joined_at >= DATE_SUB(NOW(), INTERVAL 12 WEEK)
                 GROUP BY yw
                 ORDER BY yw ASC`
            );
            return res.json(rows);
        }

        // Player growth history — stat snapshots for one player
        if (mode === 'analytics_player' && ROLES.modOrAbove.includes(user.role)) {
            const { uuid } = req.query;
            if (!uuid) return res.status(400).json({ error: "uuid required" });
            const [rows] = await db.execute(
                `SELECT coins, level, xp, snapped_at
                 FROM player_snapshots
                 WHERE uuid = ?
                 ORDER BY snapped_at ASC
                 LIMIT 365`,
                [uuid]
            );
            return res.json(rows);
        }

        // Leaderboards — top players by various metrics
        if (mode === 'analytics_leaderboard' && ROLES.modOrAbove.includes(user.role)) {
            const [byCoins] = await db.execute(
                `SELECT name, coins, level, total_playtime_s, session_count
                 FROM brume_stats ORDER BY coins DESC LIMIT 10`
            );
            const [byPlaytime] = await db.execute(
                `SELECT name, total_playtime_s, session_count, coins, level
                 FROM brume_stats ORDER BY total_playtime_s DESC LIMIT 10`
            );
            const [byLevel] = await db.execute(
                `SELECT name, level, xp, coins, total_playtime_s
                 FROM brume_stats ORDER BY level DESC, xp DESC LIMIT 10`
            );
            // Server-wide totals
            const [[totals]] = await db.execute(
                `SELECT
                    COUNT(*) as total_players,
                    SUM(total_playtime_s) as total_playtime_s,
                    SUM(session_count) as total_sessions,
                    AVG(total_playtime_s) as avg_playtime_s
                 FROM brume_stats`
            );
            return res.json({ byCoins, byPlaytime, byLevel, totals });
        }

        // ════ GLOBAL SEARCH ════
        if (req.method === 'POST' && mode === 'search' && ROLES.modOrAbove.includes(user.role)) {
            const { query } = req.body;
            if (!query || query.length < 2) return res.json({ players: [], punishments: [], logs: [] });

            const q = `%${query}%`;
            const [players] = await db.execute(
                `SELECT name, uuid, coins, level FROM brume_stats WHERE name LIKE ? OR uuid LIKE ? LIMIT 5`, [q, q]
            );
            const [punishments] = await db.execute(
                `SELECT * FROM punishments WHERE target_name LIKE ? OR reason LIKE ? ORDER BY issued_at DESC LIMIT 5`, [q, q]
            );
            const [logs] = await db.execute(
                `SELECT * FROM action_logs WHERE action LIKE ? OR username LIKE ? ORDER BY timestamp DESC LIMIT 5`, [q, q]
            );
            return res.json({ players, punishments, logs });
        }

        // ════ PLAYER PROFILE ════
        if (req.method === 'POST' && mode === 'player_punishments' && ROLES.modOrAbove.includes(user.role)) {
            const { name } = req.body;
            const [rows] = await db.execute(
                `SELECT * FROM punishments WHERE target_name = ? ORDER BY issued_at DESC LIMIT 20`, [name]
            );
            return res.json(rows);
        }

        if (req.method === 'POST' && mode === 'player_sessions' && ROLES.modOrAbove.includes(user.role)) {
            const { name } = req.body;
            const [rows] = await db.execute(
                `SELECT joined_at, quit_at, duration_s FROM session_log WHERE name = ? ORDER BY joined_at DESC LIMIT 20`, [name]
            );
            return res.json(rows);
        }

        // Override analytics_player to support name-based lookup
        if (mode === 'analytics_player' && ROLES.modOrAbove.includes(user.role)) {
            let uuid = req.query.uuid;
            const name = req.query.name;
            if (uuid === 'lookup' && name) {
                const [[p]] = await db.execute(`SELECT uuid FROM brume_stats WHERE name = ? LIMIT 1`, [decodeURIComponent(name)]);
                uuid = p?.uuid;
            }
            if (!uuid) return res.json([]);
            const [rows] = await db.execute(
                `SELECT coins, level, xp, snapped_at FROM player_snapshots WHERE uuid = ? ORDER BY snapped_at ASC LIMIT 365`, [uuid]
            );
            return res.json(rows);
        }

        // ════ STAFF MANAGEMENT ════
        if (req.method === 'POST' && mode === 'staff_create' && user.role === 'admin') {
            const { username, password, role, invite_code } = req.body;

            if (invite_code !== process.env.INVITE_CODE) {
                return res.status(403).json({ error: "Invalid invite code." });
            }
            if (!['mod', 'dev', 'admin'].includes(role)) {
                return res.status(400).json({ error: "Invalid role." });
            }

            const [existing] = await db.execute('SELECT id FROM admins WHERE username = ?', [username]);
            if (existing.length) return res.status(400).json({ error: "Username already exists." });

            // TODO: hash password with bcrypt before storing
            await db.execute(
                'INSERT INTO admins (username, password, role) VALUES (?, ?, ?)',
                [username, password, role]
            );
            await db.execute('INSERT INTO action_logs (username, action) VALUES (?, ?)',
                [user.username, `Created staff account: ${username} (${role})`]);
            return res.json({ success: true });
        }

        if (req.method === 'POST' && mode === 'staff_update' && user.role === 'admin') {
            const { id, role } = req.body;
            if (!['mod', 'dev', 'admin'].includes(role)) return res.status(400).json({ error: "Invalid role." });
            const [[target]] = await db.execute('SELECT username FROM admins WHERE id = ?', [id]);
            if (!target) return res.status(404).json({ error: "User not found." });
            await db.execute('UPDATE admins SET role = ? WHERE id = ?', [role, id]);
            await db.execute('INSERT INTO action_logs (username, action) VALUES (?, ?)',
                [user.username, `Changed ${target.username}'s role to ${role}`]);
            return res.json({ success: true });
        }

        if (req.method === 'POST' && mode === 'staff_reset_token' && user.role === 'admin') {
            const { id } = req.body;
            const newToken = crypto.randomBytes(32).toString('hex');
            const [[target]] = await db.execute('SELECT username FROM admins WHERE id = ?', [id]);
            if (!target) return res.status(404).json({ error: "User not found." });
            await db.execute('UPDATE admins SET token = ? WHERE id = ?', [newToken, id]);
            await db.execute('INSERT INTO action_logs (username, action) VALUES (?, ?)',
                [user.username, `Reset session token for ${target.username}`]);
            return res.json({ success: true });
        }

        if (req.method === 'POST' && mode === 'staff_delete' && user.role === 'admin') {
            const { id } = req.body;
            if (id === user.id) return res.status(400).json({ error: "Cannot delete your own account." });
            const [[target]] = await db.execute('SELECT username FROM admins WHERE id = ?', [id]);
            if (!target) return res.status(404).json({ error: "User not found." });
            await db.execute('DELETE FROM admins WHERE id = ?', [id]);
            await db.execute('INSERT INTO action_logs (username, action) VALUES (?, ?)',
                [user.username, `Deleted staff account: ${target.username}`]);
            return res.json({ success: true });
        }

        // ════ ACCOUNT SETTINGS ════
        if (req.method === 'POST' && mode === 'change_password') {
            const { password } = req.body;
            if (!password || password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters." });
            // TODO: hash with bcrypt
            await db.execute('UPDATE admins SET password = ? WHERE id = ?', [password, user.id]);
            await db.execute('INSERT INTO action_logs (username, action) VALUES (?, ?)',
                [user.username, `Changed their password`]);
            return res.json({ success: true });
        }

        // ════ DANGER ZONE ════
        if (req.method === 'POST' && mode === 'purge_snapshots' && user.role === 'admin') {
            await db.execute('TRUNCATE TABLE economy_snapshots');
            await db.execute('INSERT INTO action_logs (username, action) VALUES (?, ?)',
                [user.username, 'Purged all economy snapshots']);
            return res.json({ success: true });
        }

        if (req.method === 'POST' && mode === 'purge_sessions' && user.role === 'admin') {
            await db.execute('TRUNCATE TABLE session_log');
            await db.execute('INSERT INTO action_logs (username, action) VALUES (?, ?)',
                [user.username, 'Purged all session logs']);
            return res.json({ success: true });
        }

        // ════ ITEM ARCHITECT ════
        if (req.method === 'POST' && mode === 'save_item' && ROLES.modOrAbove.includes(user.role)) {
            const { item } = req.body;
            if (!item?.id) return res.status(400).json({ error: "Item ID required." });

            await db.execute(
                `INSERT INTO architect_items (item_id, created_by, data, updated_at)
                 VALUES (?, ?, ?, NOW())
                 ON DUPLICATE KEY UPDATE data=VALUES(data), updated_at=NOW(), created_by=VALUES(created_by)`,
                [item.id, user.username, JSON.stringify(item)]
            );
            return res.json({ success: true });
        }

        if (mode === 'load_items' && ROLES.modOrAbove.includes(user.role)) {
            const [rows] = await db.execute(
                `SELECT item_id, created_by, data, updated_at FROM architect_items ORDER BY updated_at DESC`
            );
            return res.json(rows.map(r => ({ ...JSON.parse(r.data), _meta: { created_by: r.created_by, updated_at: r.updated_at } })));
        }

        if (req.method === 'POST' && mode === 'delete_item' && user.role === 'admin') {
            const { item_id } = req.body;
            await db.execute('DELETE FROM architect_items WHERE item_id = ?', [item_id]);
            return res.json({ success: true });
        }

        // ════ ITEM ARCHITECT ════
        if (mode === 'items_list' && ROLES.modOrAbove.includes(user.role)) {
            await db.execute(`CREATE TABLE IF NOT EXISTS custom_items (id INT AUTO_INCREMENT PRIMARY KEY, item_id VARCHAR(64) NOT NULL, tier VARCHAR(16), item_type VARCHAR(32), data JSON NOT NULL, created_by VARCHAR(64), updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, INDEX idx_item_id (item_id))`);
            const [rows] = await db.execute(`SELECT id as db_id, item_id as id, tier, item_type, data FROM custom_items ORDER BY updated_at DESC`);
            return res.json(rows.map(r => ({ ...JSON.parse(r.data), db_id: r.db_id, id: r.id, tier: r.tier, item_type: r.item_type })));
        }

        if (req.method === 'POST' && mode === 'items_save' && ROLES.modOrAbove.includes(user.role)) {
            const { db_id, id, tier, item_type, ...rest } = req.body;
            const dataJson = JSON.stringify({ id, tier, item_type, ...rest });
            if (db_id) {
                await db.execute(`UPDATE custom_items SET item_id=?, tier=?, item_type=?, data=?, created_by=? WHERE id=?`, [id, tier, item_type, dataJson, user.username, db_id]);
                return res.json({ success: true, id: db_id });
            } else {
                const [result] = await db.execute(`INSERT INTO custom_items (item_id, tier, item_type, data, created_by) VALUES (?, ?, ?, ?, ?)`, [id, tier, item_type, dataJson, user.username]);
                return res.json({ success: true, id: result.insertId });
            }
        }

        if (req.method === 'POST' && mode === 'items_delete' && ROLES.modOrAbove.includes(user.role)) {
            const { id } = req.body;
            await db.execute(`DELETE FROM custom_items WHERE id=?`, [id]);
            return res.json({ success: true });
        }

        // ════ SECURITY & ALERTS ════

        // List unresolved alerts
        if (mode === 'alerts_list' && ROLES.modOrAbove.includes(user.role)) {
            const limit = parseInt(req.query.limit) || 50;
            const showResolved = req.query.resolved === 'true';
            const [rows] = await db.execute(
                `SELECT * FROM alerts
                 WHERE resolved = ?
                 ORDER BY created_at DESC
                 LIMIT ?`,
                [showResolved ? 1 : 0, limit]
            );
            const [[{ count }]] = await db.execute(
                `SELECT COUNT(*) as count FROM alerts WHERE resolved = 0`
            );
            return res.json({ alerts: rows, unresolved_count: count });
        }

        // Resolve an alert
        if (req.method === 'POST' && mode === 'alert_resolve' && ROLES.modOrAbove.includes(user.role)) {
            const { id } = req.body;
            await db.execute(
                `UPDATE alerts SET resolved = 1, resolved_by = ?, resolved_at = NOW() WHERE id = ?`,
                [user.username, id]
            );
            await db.execute('INSERT INTO action_logs (username, action) VALUES (?, ?)',
                [user.username, `Resolved alert #${id}`]);
            return res.json({ success: true });
        }

        // Resolve all alerts
        if (req.method === 'POST' && mode === 'alerts_resolve_all' && ROLES.modOrAbove.includes(user.role)) {
            await db.execute(
                `UPDATE alerts SET resolved = 1, resolved_by = ?, resolved_at = NOW() WHERE resolved = 0`,
                [user.username]
            );
            await db.execute('INSERT INTO action_logs (username, action) VALUES (?, ?)',
                [user.username, `Resolved all security alerts`]);
            return res.json({ success: true });
        }

        // Security analysis — runs all three detection queries on demand
        if (mode === 'security_analysis' && ROLES.modOrAbove.includes(user.role)) {

            // 1. Velocity — players who gained a lot in a single session (from alerts)
            const [velocity] = await db.execute(
                `SELECT player_name, detail, created_at, resolved
                 FROM alerts WHERE type = 'VELOCITY'
                 ORDER BY created_at DESC LIMIT 20`
            );

            // 2. Snapshot delta — biggest single-snapshot coin jumps per player
            const [deltas] = await db.execute(
                `SELECT
                    a.name,
                    a.uuid,
                    a.coins AS current_coins,
                    b.coins AS prev_coins,
                    (a.coins - b.coins) AS delta,
                    a.snapped_at
                 FROM player_snapshots a
                 JOIN player_snapshots b
                   ON b.uuid = a.uuid
                   AND b.id = (
                     SELECT MAX(id) FROM player_snapshots
                     WHERE uuid = a.uuid AND id < a.id
                   )
                 WHERE ABS(a.coins - b.coins) > 10000
                 ORDER BY ABS(a.coins - b.coins) DESC
                 LIMIT 20`
            );

            // 3. Alt accounts — UUIDs sharing an IP
            const [alts] = await db.execute(
                `SELECT
                    ip,
                    GROUP_CONCAT(DISTINCT name ORDER BY name SEPARATOR ', ') AS names,
                    COUNT(DISTINCT uuid) AS account_count,
                    MAX(joined_at) AS last_seen
                 FROM ip_log
                 GROUP BY ip
                 HAVING COUNT(DISTINCT uuid) > 1
                 ORDER BY account_count DESC, last_seen DESC
                 LIMIT 20`
            );

            // 4. Economy spikes from snapshots
            const [spikes] = await db.execute(
                `SELECT
                    curr.snapped_at,
                    curr.total_coins,
                    prev.total_coins AS prev_coins,
                    ROUND(((curr.total_coins - prev.total_coins) / prev.total_coins) * 100, 1) AS pct_change
                 FROM economy_snapshots curr
                 JOIN economy_snapshots prev ON prev.id = curr.id - 1
                 WHERE prev.total_coins > 0
                   AND ABS((curr.total_coins - prev.total_coins) / prev.total_coins) >= 0.10
                 ORDER BY curr.snapped_at DESC
                 LIMIT 20`
            );

            return res.json({ velocity, deltas, alts, spikes });
        }

        // Player IP history
        if (req.method === 'POST' && mode === 'player_ip_history' && ROLES.modOrAbove.includes(user.role)) {
            const { name } = req.body;
            const [ips] = await db.execute(
                `SELECT DISTINCT ip, MIN(joined_at) AS first_seen, MAX(joined_at) AS last_seen, COUNT(*) AS times
                 FROM ip_log WHERE name = ?
                 GROUP BY ip ORDER BY last_seen DESC`,
                [name]
            );
            // For each IP, find other players who used it
            const results = await Promise.all(ips.map(async row => {
                const [others] = await db.execute(
                    `SELECT DISTINCT name FROM ip_log WHERE ip = ? AND name != ? LIMIT 10`,
                    [row.ip, name]
                );
                return { ...row, shared_with: others.map(r => r.name) };
            }));
            return res.json(results);
        }

        // ════ ROLLBACK ════

        // Get rollback timeline for a player
        if (req.method === 'POST' && mode === 'rollback_timeline' && ROLES.modOrAbove.includes(user.role)) {
            const { name } = req.body;
            const [[player]] = await db.execute(
                `SELECT uuid, name, coins, level, xp, total_playtime_s FROM brume_stats WHERE name = ?`, [name]
            );
            if (!player) return res.status(404).json({ error: 'Player not found' });

            const [snapshots] = await db.execute(
                `SELECT id, coins, level, xp, snapped_at FROM player_snapshots
                 WHERE uuid = ?
                 ORDER BY snapped_at DESC
                 LIMIT 50`,
                [player.uuid]
            );
            return res.json({ player, snapshots });
        }

        // Execute rollback
        if (req.method === 'POST' && mode === 'rollback_execute' && user.role === 'admin') {
            const { snapshot_id, name } = req.body;

            const [[snap]] = await db.execute(
                `SELECT ps.*, bs.uuid FROM player_snapshots ps
                 JOIN brume_stats bs ON bs.uuid = ps.uuid
                 WHERE ps.id = ? AND bs.name = ?`,
                [snapshot_id, name]
            );
            if (!snap) return res.status(404).json({ error: 'Snapshot not found' });

            // Restore full stats row
            await db.execute(
                `UPDATE brume_stats SET coins = ?, level = ?, xp = ? WHERE uuid = ?`,
                [snap.coins, snap.level, snap.xp, snap.uuid]
            );

            // Fire RCON to update in-game if player is online
            try {
                await rconExec(`economy set ${name} ${snap.coins}`);
            } catch (e) {
                // Non-fatal if RCON fails or player is offline
            }

            const snapDate = new Date(snap.snapped_at).toLocaleString('en-GB');
            await db.execute('INSERT INTO action_logs (username, action) VALUES (?, ?)',
                [user.username, `Rolled back ${name} to snapshot from ${snapDate} — Coins: ${snap.coins}, Lv: ${snap.level}, XP: ${snap.xp}`]);

            // Create a "post-rollback" snapshot so the timeline reflects the change
            await db.execute(
                `INSERT INTO player_snapshots (uuid, name, coins, level, xp) VALUES (?, ?, ?, ?, ?)`,
                [snap.uuid, name, snap.coins, snap.level, snap.xp]
            );

            return res.json({ success: true, restored: { coins: snap.coins, level: snap.level, xp: snap.xp } });
        }

        // Discord webhook test
        if (req.method === 'POST' && mode === 'test_webhook' && user.role === 'admin') {
            const { webhook_url } = req.body;
            if (!webhook_url) return res.status(400).json({ error: 'No webhook URL provided' });

            const payload = {
                embeds: [{
                    title: '✅ Brume Security — Webhook Test',
                    description: 'Your Discord webhook is configured correctly.',
                    color: 0x5b6aff,
                    footer: { text: `Tested by ${user.username}` }
                }]
            };

            const r = await fetch(webhook_url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!r.ok) return res.status(400).json({ error: `Webhook returned ${r.status}` });
            return res.json({ success: true });
        }

        return res.status(403).json({ error: "Forbidden: No permission." });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Server error: " + error.message });
    }
}
