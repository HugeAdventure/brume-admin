import mysql from 'mysql2/promise';
import crypto from 'crypto';
import Rcon from 'rcon'; // npm install rcon

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

        return res.status(403).json({ error: "Forbidden: No permission." });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Server error: " + error.message });
    }
}
