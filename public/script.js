const app = {
    session: null,

    init() {
        const savedSession = localStorage.getItem('brume_session');
        if (savedSession) {
            this.session = JSON.parse(savedSession);
            this.unlockUI();
        }
    },

    async login(e) {
        e.preventDefault();
        const user = document.getElementById('auth-user').value;
        const pass = document.getElementById('auth-pass').value;
        const btn = document.getElementById('login-btn');
        const err = document.getElementById('auth-error');

        btn.innerText = "AUTHENTICATING...";
        err.innerText = "";

        try {
            const res = await fetch(`/api/ops?mode=login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: user, password: pass })
            }).then(r => r.json());

            if (res.error) throw new Error(res.error);

            this.session = { token: res.token, user: res.user };
            localStorage.setItem('brume_session', JSON.stringify(this.session));

            this.unlockUI();
            this.toast("Welcome back, " + this.session.user.username);

        } catch (error) {
            err.innerText = "// " + error.message;
            btn.innerText = "AUTHENTICATE";
        }
    },

    logout() {
        localStorage.removeItem('brume_session');
        location.reload();
    },

    async req(mode, method = 'GET', body = null) {
        if (!this.session) return { error: "No session" };

        const opts = {
            method,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.session.token}`
            }
        };
        if (body) opts.body = JSON.stringify(body);

        const res = await fetch(`/api/ops?mode=${mode}`, opts).then(r => r.json());

        if (res.error === "Session expired or invalid") this.logout();
        return res;
    },

    async unlockUI() {
        document.getElementById('auth-layer').style.display = 'none';
        document.getElementById('dashboard-layer').style.display = 'flex';

        document.getElementById('profile-name').innerText = this.session.user.username;
        document.getElementById('profile-role').innerText = this.session.user.role.toUpperCase();
        document.getElementById('profile-avatar').innerText = this.session.user.username.charAt(0).toUpperCase();

        // Apply role badge class
        const badge = document.getElementById('profile-role');
        badge.className = 'badge ' + this.session.user.role;

        this.applyRolePermissions();

        if (['admin', 'mod'].includes(this.session.user.role)) {
            this.loadStats();
            this.loadLogs();
            this.loadOverviewLogs();
            // Load overview analytics summary (mini chart + week stats)
            this.req(`analytics_economy&days=7`).then(r => { if (!r.error) { this.renderOverviewEcoChart(r); } });
            this.req('analytics_retention').then(r => { if (!r.error) this.renderOverviewWeekStats(r); });
        }

        if (this.session.user.role === 'admin') {
            this.loadStaff();
        }
    },

    applyRolePermissions() {
        const role = this.session.user.role;
        const links = document.querySelectorAll('.nav-link[data-roles]');
        let firstAvailableView = null;

        links.forEach(link => {
            const allowedRoles = link.getAttribute('data-roles').split(',');
            if (!allowedRoles.includes(role)) {
                link.style.display = 'none';
            } else if (!firstAvailableView) {
                firstAvailableView = link.getAttribute('onclick').match(/'([^']+)'/)[1];
            }
        });

        if (firstAvailableView) this.navigate(firstAvailableView);
    },

    navigate(viewId) {
        document.querySelectorAll('.view-page').forEach(e => e.classList.remove('active'));
        document.getElementById(`view-${viewId}`).classList.add('active');

        document.querySelectorAll('.nav-link').forEach(e => e.classList.remove('active'));
        if (event && event.target) event.target.classList.add('active');
    },

    toast(msg, type = "success") {
        const c = document.getElementById('toast-container');
        const el = document.createElement('div');
        el.className = `toast ${type}`;
        el.innerText = msg;
        c.appendChild(el);
        setTimeout(() => { el.style.opacity = 0; setTimeout(() => el.remove(), 300); }, 3000);
    },

    async loadStats() {
        const res = await this.req('stats');
        if (res.error) return this.toast("Stats: " + res.error, "error");

        document.getElementById('stat-users').innerText = res.user_count || 0;
        document.getElementById('stat-eco').innerText = Number(res.total_economy || 0).toLocaleString() + " ◎";
        document.getElementById('stat-rich').innerText = res.top_player || "None";
    },

    async loadOverviewLogs() {
        const res = await this.req('logs');
        const container = document.getElementById('overview-logs-container');
        if (res.error || !res.length) {
            container.innerHTML = `<p style="font-family:'Space Mono',monospace;font-size:12px;color:var(--text-dim);padding:4px 0;">No recent activity.</p>`;
            return;
        }

        // Show 5 most recent entries as a compact list
        const recent = res.slice(0, 5);
        container.innerHTML = recent.map(l => {
            const date = new Date(l.timestamp).toLocaleString('en-GB', { hour12: false });
            return `<div style="display:flex;gap:16px;align-items:baseline;padding:8px 0;border-bottom:1px solid var(--border-dim);">
                <span style="font-family:'Space Mono',monospace;font-size:10px;color:var(--text-dim);white-space:nowrap;">${date}</span>
                <span style="font-family:'Space Mono',monospace;font-size:11px;color:var(--accent-bright);white-space:nowrap;">${l.username}</span>
                <span style="font-size:13px;color:var(--text-secondary);">${l.action}</span>
            </div>`;
        }).join('') + `<div style="padding-top:12px;"><button class="nav-link" style="padding:0;font-family:'Space Mono',monospace;font-size:10px;letter-spacing:1px;color:var(--accent);" onclick="app.navigate('logs')">VIEW ALL LOGS →</button></div>`;
    },

    async savePlayer() {
        const body = {
            uuid: document.getElementById('val-uuid').innerText,
            name: document.getElementById('val-name').innerText,
            coins: document.getElementById('inp-coins').value,
            level: document.getElementById('inp-level').value
        };
        const res = await this.req('update', 'POST', body);

        if (res.error) this.toast(res.error, "error");
        else {
            this.toast("Player record updated.");
            this.loadLogs();
            this.loadStats();
        }
    },

    async loadStaff() {
        const res = await this.req('staff_list');
        if (res.error) return;

        let html = `<table class="data-table">
            <thead><tr><th>ID</th><th>Username</th><th>Access Level</th></tr></thead><tbody>`;

        res.forEach(s => {
            html += `<tr>
                <td class="mono" style="color:var(--text-dim);">#${s.id}</td>
                <td class="bold">${s.username}</td>
                <td><span class="badge ${s.role}">${s.role}</span></td>
            </tr>`;
        });

        html += `</tbody></table>`;
        document.getElementById('staff-table-container').innerHTML = html;
    },

    async loadLogs() {
        const res = await this.req('logs');
        const container = document.getElementById('logs-table-container');

        if (res.error) {
            container.innerHTML = `<p style="padding:24px;font-family:'Space Mono',monospace;font-size:12px;color:var(--red);">// Error: ${res.error}</p>`;
            return this.toast("Logs: " + res.error, "error");
        }

        let html = `<table class="data-table">
            <thead><tr><th>Timestamp</th><th>Staff Member</th><th>Action</th></tr></thead><tbody>`;

        if (res.length === 0) {
            html += `<tr><td colspan="3" style="text-align:center;padding:32px;font-family:'Space Mono',monospace;font-size:12px;color:var(--text-dim);">// No entries found</td></tr>`;
        } else {
            res.forEach(l => {
                const date = new Date(l.timestamp).toLocaleString('en-GB', { hour12: false });
                html += `<tr>
                    <td class="mono" style="color:var(--text-dim);white-space:nowrap;">${date}</td>
                    <td class="bold mono" style="color:var(--accent-bright);">${l.username}</td>
                    <td style="color:var(--text-secondary);">${l.action}</td>
                </tr>`;
            });
        }

        html += `</tbody></table>`;
        container.innerHTML = html;
    },

    async lookupPlayer() {
        const q = document.getElementById('p-search').value;
        if (!q) return;

        const res = await this.req('lookup', 'POST', { query: q });
        if (res.error) return this.toast(res.error, "error");

        document.getElementById('p-editor').style.display = 'block';
        document.getElementById('val-name').innerText = res.name;
        document.getElementById('val-uuid').innerText = res.uuid;
        document.getElementById('inp-coins').value = res.coins;
        document.getElementById('inp-level').value = res.level;
    },

    // ── ONLINE PLAYERS ──
    _playersInterval: null,

    async loadOnlinePlayers() {
        const res = await this.req('online_players');
        const container = document.getElementById('online-players-container');
        const badge = document.getElementById('online-count-badge');

        if (res.error) {
            container.innerHTML = `<p style="padding:24px;font-family:'Space Mono',monospace;font-size:12px;color:var(--red);">// Error: ${res.error}</p>`;
            return;
        }

        const players = res || [];
        badge.innerText = `${players.length} ONLINE`;

        if (players.length === 0) {
            container.innerHTML = `<p style="padding:24px;font-family:'Space Mono',monospace;font-size:12px;color:var(--text-dim);">// No players online.</p>`;
            return;
        }

        container.innerHTML = players.map(p => `
            <div class="player-row">
                <div class="player-avatar-sm">${p.name.charAt(0).toUpperCase()}</div>
                <span class="player-row-name">${p.name}</span>
                <span class="player-row-meta" style="color:var(--text-dim);">${p.uuid ? p.uuid.substring(0,8) + '...' : ''}</span>
                <span class="player-row-meta">Lv.${p.level || '?'}</span>
                <span class="player-row-meta text-gold">${Number(p.coins || 0).toLocaleString()} ◎</span>
                <div class="player-row-actions">
                    <button class="btn-sm" onclick="app.quickBan('${p.name}')">BAN</button>
                    <button class="btn-sm" onclick="app.quickWarn('${p.name}')">WARN</button>
                </div>
            </div>
        `).join('');
    },

    startPlayerPolling() {
        this.loadOnlinePlayers();
        if (this._playersInterval) clearInterval(this._playersInterval);
        this._playersInterval = setInterval(() => this.loadOnlinePlayers(), 15000);
    },

    quickBan(name) {
        document.getElementById('ban-target').value = name;
        document.getElementById('ban-type').value = 'ban';
        this.navigate('bans');
        document.querySelectorAll('.nav-link').forEach(e => e.classList.remove('active'));
    },

    quickWarn(name) {
        document.getElementById('ban-target').value = name;
        document.getElementById('ban-type').value = 'warn';
        this.navigate('bans');
        document.querySelectorAll('.nav-link').forEach(e => e.classList.remove('active'));
    },

    toggleDuration() {
        const type = document.getElementById('ban-type').value;
        const group = document.getElementById('duration-group');
        group.style.opacity = type === 'tempban' ? '1' : '0.3';
        group.style.pointerEvents = type === 'tempban' ? 'auto' : 'none';
    },

    // ── BANS & WARNINGS ──
    async issuePunishment() {
        const target = document.getElementById('ban-target').value.trim();
        const type = document.getElementById('ban-type').value;
        const reason = document.getElementById('ban-reason').value.trim();
        const duration = document.getElementById('ban-duration').value.trim();

        if (!target || !reason) return this.toast("Player name and reason required.", "error");

        const res = await this.req('punish', 'POST', { target, type, reason, duration });
        if (res.error) return this.toast(res.error, "error");

        this.toast(`${type.toUpperCase()} issued to ${target}.`);
        document.getElementById('ban-target').value = '';
        document.getElementById('ban-reason').value = '';
        this.loadBans();
        this.loadLogs();
    },

    async loadBans() {
        const res = await this.req('bans_list');
        const container = document.getElementById('bans-table-container');

        if (res.error) {
            container.innerHTML = `<p style="padding:24px;font-family:'Space Mono',monospace;font-size:12px;color:var(--red);">// Error: ${res.error}</p>`;
            return;
        }

        if (!res.length) {
            container.innerHTML = `<p style="padding:24px;font-family:'Space Mono',monospace;font-size:12px;color:var(--text-dim);">// No active punishments.</p>`;
            return;
        }

        let html = `<table class="data-table">
            <thead><tr><th>Player</th><th>Type</th><th>Reason</th><th>Issued By</th><th>Date</th><th></th></tr></thead><tbody>`;

        res.forEach(b => {
            const date = new Date(b.issued_at).toLocaleDateString('en-GB');
            const typeClass = `ptype-${b.type}`;
            const label = b.type === 'tempban' ? `TEMP BAN${b.duration ? ' · ' + b.duration : ''}` : b.type.toUpperCase();
            html += `<tr>
                <td class="bold">${b.target_name}</td>
                <td><span class="${typeClass}">${label}</span></td>
                <td style="color:var(--text-secondary);max-width:260px;">${b.reason}</td>
                <td class="mono" style="color:var(--accent-bright);">${b.issued_by}</td>
                <td class="mono" style="color:var(--text-dim);">${date}</td>
                <td><button class="btn-sm" onclick="app.revokePunishment(${b.id})">REVOKE</button></td>
            </tr>`;
        });

        html += `</tbody></table>`;
        container.innerHTML = html;
    },

    async revokePunishment(id) {
        const res = await this.req('revoke', 'POST', { id });
        if (res.error) return this.toast(res.error, "error");
        this.toast("Punishment revoked.");
        this.loadBans();
        this.loadLogs();
    },

    // ── SERVER CONSOLE ──
    _cmdHistory: [],
    _historyIndex: -1,

    consoleLog(text, cls = '') {
        const out = document.getElementById('console-output');
        if (!out) return;
        const line = document.createElement('div');
        line.className = cls;
        line.innerHTML = text;
        out.appendChild(line);
        out.scrollTop = out.scrollHeight;
    },

    initConsole() {
        const output = document.getElementById('console-output');
        output.innerHTML = '';
        this.consoleLog(`<span class="con-prompt">brume@server</span><span class="con-dim">:~$</span> <span class="con-dim">// Console ready. Commands run via RCON.</span>`);

        // Arrow key history navigation
        const input = document.getElementById('console-input');
        input.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (this._historyIndex < this._cmdHistory.length - 1) {
                    this._historyIndex++;
                    input.value = this._cmdHistory[this._cmdHistory.length - 1 - this._historyIndex];
                }
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (this._historyIndex > 0) {
                    this._historyIndex--;
                    input.value = this._cmdHistory[this._cmdHistory.length - 1 - this._historyIndex];
                } else {
                    this._historyIndex = -1;
                    input.value = '';
                }
            }
        });
    },

    async runCommand() {
        const input = document.getElementById('console-input');
        const cmd = input.value.trim();
        if (!cmd) return;

        this._cmdHistory.push(cmd);
        this._historyIndex = -1;
        input.value = '';

        this.consoleLog(`<span class="con-prompt">brume@server</span><span class="con-dim">:~$</span> <span class="con-line-cmd">${this.escapeHtml(cmd)}</span>`);

        const res = await this.req('console', 'POST', { command: cmd });

        if (res.error) {
            this.consoleLog(`<span class="con-line-err">✗ ${this.escapeHtml(res.error)}</span>`);
        } else {
            const lines = (res.output || '').split('\n');
            lines.forEach(line => {
                const cls = line.startsWith('[ERROR]') ? 'con-line-err'
                          : line.startsWith('[WARN]')  ? 'con-line-info'
                          : 'con-line-ok';
                this.consoleLog(`<span class="${cls}">${this.escapeHtml(line)}</span>`);
            });
        }
    },

    clearConsole() {
        const out = document.getElementById('console-output');
        out.innerHTML = '';
        this.consoleLog(`<span class="con-dim">// Console cleared.</span>`);
    },

    escapeHtml(str) {
        return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    },

    // ════ ANALYTICS ════
    _analyticsDays: 7,
    _charts: {},

    setAnalyticsRange(days, btn) {
        this._analyticsDays = days;
        document.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.loadAnalytics();
    },

    fmtDuration(seconds) {
        if (!seconds || seconds < 60) return `${Math.round(seconds || 0)}s`;
        if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
        return `${(seconds / 3600).toFixed(1)}h`;
    },

    fmtCoins(n) {
        if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
        if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
        return Math.round(n).toLocaleString();
    },

    destroyChart(id) {
        if (this._charts[id]) { this._charts[id].destroy(); delete this._charts[id]; }
    },

    chartDefaults() {
        return {
            color: '#8888aa',
            borderColor: 'rgba(255,255,255,0.06)',
            plugins: { legend: { display: false }, tooltip: {
                backgroundColor: '#16161f',
                borderColor: 'rgba(255,255,255,0.12)',
                borderWidth: 1,
                titleColor: '#eeeef5',
                bodyColor: '#8888aa',
                padding: 10,
                titleFont: { family: 'Space Mono', size: 11 },
                bodyFont: { family: 'Space Mono', size: 11 },
            }},
            scales: {
                x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#44445a', font: { family: 'Space Mono', size: 10 }, maxTicksLimit: 8 } },
                y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#44445a', font: { family: 'Space Mono', size: 10 }, maxTicksLimit: 6 } }
            }
        };
    },

    async loadAnalytics() {
        const [ecoRes, heatRes, retRes, lbRes] = await Promise.all([
            this.req(`analytics_economy&days=${this._analyticsDays}`),
            this.req('analytics_heatmap'),
            this.req('analytics_retention'),
            this.req('analytics_leaderboard'),
        ]);

        if (!ecoRes.error) this.renderEcoChart(ecoRes);
        if (!heatRes.error) this.renderHeatmap(heatRes);
        if (!retRes.error) this.renderRetention(retRes);
        if (!lbRes.error) this.renderLeaderboards(lbRes);

        // Also load overview mini-chart
        if (!ecoRes.error) this.renderOverviewEcoChart(ecoRes);
        if (!retRes.error) this.renderOverviewWeekStats(retRes);
    },

    renderEcoChart(data) {
        this.destroyChart('eco');
        const snaps = data.snapshots || [];
        const peak = data.peak || {};

        // KPIs
        document.getElementById('a-peak-eco').innerText = this.fmtCoins(peak.peak_coins || 0) + ' ◎';
        if (snaps.length >= 2) {
            const first = snaps[0].total_coins;
            const last  = snaps[snaps.length - 1].total_coins;
            const pct   = first > 0 ? (((last - first) / first) * 100).toFixed(1) : '0';
            const el    = document.getElementById('a-eco-growth');
            el.innerText = (pct >= 0 ? '+' : '') + pct + '%';
            el.style.color = pct >= 0 ? 'var(--green)' : 'var(--red)';
        }

        const labels = snaps.map(s => {
            const d = new Date(s.hour);
            return this._analyticsDays <= 7
                ? d.toLocaleDateString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false })
                : d.toLocaleDateString('en-GB', { month: 'short', day: 'numeric' });
        });

        const ctx = document.getElementById('eco-chart').getContext('2d');
        const grad = ctx.createLinearGradient(0, 0, 0, 220);
        grad.addColorStop(0, 'rgba(91,106,255,0.25)');
        grad.addColorStop(1, 'rgba(91,106,255,0)');

        this._charts['eco'] = new Chart(ctx, {
            type: 'line',
            data: {
                labels,
                datasets: [
                    {
                        label: 'Total Coins',
                        data: snaps.map(s => s.total_coins),
                        borderColor: '#5b6aff',
                        backgroundColor: grad,
                        borderWidth: 2,
                        pointRadius: snaps.length > 60 ? 0 : 3,
                        pointBackgroundColor: '#5b6aff',
                        fill: true,
                        tension: 0.3,
                        yAxisID: 'y',
                    },
                    {
                        label: 'Players',
                        data: snaps.map(s => s.total_players),
                        borderColor: '#00e5a0',
                        backgroundColor: 'transparent',
                        borderWidth: 1.5,
                        pointRadius: 0,
                        borderDash: [4, 4],
                        tension: 0.3,
                        yAxisID: 'y2',
                    }
                ]
            },
            options: {
                ...this.chartDefaults(),
                interaction: { mode: 'index', intersect: false },
                scales: {
                    x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#44445a', font: { family: 'Space Mono', size: 10 }, maxTicksLimit: 8 } },
                    y:  { position: 'left',  grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#44445a', font: { family: 'Space Mono', size: 10 }, callback: v => this.fmtCoins(v) } },
                    y2: { position: 'right', grid: { drawOnChartArea: false }, ticks: { color: '#00e5a0', font: { family: 'Space Mono', size: 10 } } }
                }
            }
        });
    },

    renderOverviewEcoChart(data) {
        this.destroyChart('ov-eco');
        const snaps = (data.snapshots || []).slice(-24); // last 24 datapoints
        if (!snaps.length) return;
        const ctx = document.getElementById('overview-eco-chart');
        if (!ctx) return;
        const grad = ctx.getContext('2d').createLinearGradient(0, 0, 0, 80);
        grad.addColorStop(0, 'rgba(91,106,255,0.2)');
        grad.addColorStop(1, 'rgba(91,106,255,0)');
        this._charts['ov-eco'] = new Chart(ctx, {
            type: 'line',
            data: { labels: snaps.map(() => ''), datasets: [{ data: snaps.map(s => s.total_coins), borderColor: '#5b6aff', backgroundColor: grad, borderWidth: 2, pointRadius: 0, fill: true, tension: 0.4 }] },
            options: { animation: false, plugins: { legend: { display: false }, tooltip: { enabled: false } }, scales: { x: { display: false }, y: { display: false } } }
        });
    },

    renderOverviewWeekStats(data) {
        const rows = data || [];
        const last = rows[rows.length - 1];
        if (!last) return;
        document.getElementById('ov-new').innerText     = last.new_players || 0;
        document.getElementById('ov-ret').innerText     = last.returning_players || 0;
        document.getElementById('ov-sessions').innerText = last.total_players || 0;
        // avg session from heatmap would need another call; leave as placeholder
    },

    renderRetention(data) {
        this.destroyChart('ret');
        const rows = data || [];

        // Fill session KPIs from totals
        const totalSessions = rows.reduce((s, r) => s + (r.total_players || 0), 0);
        document.getElementById('a-sessions').innerText = totalSessions.toLocaleString();

        const labels = rows.map(r => {
            const d = new Date(r.week_start);
            return d.toLocaleDateString('en-GB', { month: 'short', day: 'numeric' });
        });

        const ctx = document.getElementById('retention-chart').getContext('2d');
        this._charts['ret'] = new Chart(ctx, {
            type: 'bar',
            data: {
                labels,
                datasets: [
                    { label: 'New',       data: rows.map(r => r.new_players),       backgroundColor: 'rgba(0,229,160,0.7)',   borderRadius: 2 },
                    { label: 'Returning', data: rows.map(r => r.returning_players), backgroundColor: 'rgba(91,106,255,0.7)',  borderRadius: 2 }
                ]
            },
            options: {
                ...this.chartDefaults(),
                plugins: {
                    ...this.chartDefaults().plugins,
                    legend: { display: true, labels: { color: '#8888aa', font: { family: 'Space Mono', size: 10 }, boxWidth: 10 } }
                },
                scales: {
                    x: { stacked: true, grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#44445a', font: { family: 'Space Mono', size: 10 } } },
                    y: { stacked: true, grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#44445a', font: { family: 'Space Mono', size: 10 } } }
                }
            }
        });
    },

    renderHeatmap(data) {
        const DAYS  = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const HOURS = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2,'0')}h`);

        // Build lookup grid
        const grid = {};
        let maxVal = 0;
        data.forEach(r => {
            grid[`${r.day_of_week}_${r.hour_of_day}`] = r.session_count;
            if (r.session_count > maxVal) maxVal = r.session_count;
        });

        const cellSize = 16;
        const labelW   = 28;
        const labelH   = 20;

        let html = `<div style="overflow-x:auto;"><div style="display:inline-block;">`;

        // Hour labels top
        html += `<div style="display:flex;margin-left:${labelW}px;margin-bottom:2px;">`;
        HOURS.forEach((h, i) => {
            html += `<div style="width:${cellSize}px;font-family:'Space Mono',monospace;font-size:8px;color:var(--text-dim);text-align:center;overflow:hidden;">${i % 3 === 0 ? h : ''}</div>`;
        });
        html += `</div>`;

        // Rows
        DAYS.forEach((day, di) => {
            html += `<div style="display:flex;align-items:center;margin-bottom:2px;">`;
            html += `<div style="width:${labelW}px;font-family:'Space Mono',monospace;font-size:9px;color:var(--text-dim);text-align:right;padding-right:6px;">${day}</div>`;
            HOURS.forEach((_, hi) => {
                const val = grid[`${di}_${hi}`] || 0;
                const intensity = maxVal > 0 ? val / maxVal : 0;
                const alpha     = 0.08 + intensity * 0.92;
                const color     = intensity > 0.6 ? `rgba(91,106,255,${alpha})` : intensity > 0.3 ? `rgba(91,106,255,${alpha})` : `rgba(91,106,255,${alpha})`;
                const border    = intensity > 0.5 ? '1px solid rgba(91,106,255,0.4)' : '1px solid rgba(255,255,255,0.04)';
                html += `<div title="${day} ${hi}:00 — ${val} sessions" style="width:${cellSize}px;height:${cellSize}px;background:${color};border:${border};border-radius:2px;cursor:default;"></div>`;
            });
            html += `</div>`;
        });

        // Legend
        html += `<div style="display:flex;align-items:center;gap:6px;margin-top:8px;margin-left:${labelW}px;">`;
        html += `<span style="font-family:'Space Mono',monospace;font-size:9px;color:var(--text-dim);">Low</span>`;
        [0.1,0.3,0.5,0.7,0.9].forEach(a => {
            html += `<div style="width:14px;height:14px;background:rgba(91,106,255,${a});border-radius:2px;"></div>`;
        });
        html += `<span style="font-family:'Space Mono',monospace;font-size:9px;color:var(--text-dim);">High</span>`;
        html += `</div>`;

        html += `</div></div>`;
        document.getElementById('heatmap-container').innerHTML = html;
    },

    renderLeaderboards(data) {
        const fmt = this.fmtDuration.bind(this);
        const fmtC = this.fmtCoins.bind(this);

        // Total sessions / avg playtime KPIs
        if (data.totals) {
            document.getElementById('a-avg-session').innerText = fmt(data.totals.avg_playtime_s);
            if (!document.getElementById('a-sessions').innerText || document.getElementById('a-sessions').innerText === '—') {
                document.getElementById('a-sessions').innerText = Number(data.totals.total_sessions || 0).toLocaleString();
            }
        }

        const makeTable = (rows, cols) => {
            if (!rows.length) return `<p style="padding:16px;font-family:'Space Mono',monospace;font-size:12px;color:var(--text-dim);">No data yet.</p>`;
            return `<table class="data-table" style="font-size:12px;">
                <thead><tr>${cols.map(c => `<th>${c.label}</th>`).join('')}</tr></thead>
                <tbody>${rows.map((r, i) => `<tr>
                    <td style="color:var(--text-dim);font-family:'Space Mono',monospace;">#${i+1}</td>
                    ${cols.slice(1).map(c => `<td ${c.style || ''}>${c.fmt ? c.fmt(r[c.key]) : r[c.key]}</td>`).join('')}
                </tr>`).join('')}</tbody>
            </table>`;
        };

        document.getElementById('lb-coins').innerHTML = makeTable(data.byCoins, [
            { label: '#' },
            { label: 'Player', key: 'name', style: 'style="font-weight:600;"' },
            { label: 'Coins', key: 'coins', fmt: v => `<span style="color:var(--amber)">${fmtC(v)} ◎</span>` },
            { label: 'Lv', key: 'level', style: 'style="color:var(--text-dim);"' },
        ]);

        document.getElementById('lb-playtime').innerHTML = makeTable(data.byPlaytime, [
            { label: '#' },
            { label: 'Player', key: 'name', style: 'style="font-weight:600;"' },
            { label: 'Playtime', key: 'total_playtime_s', fmt: v => `<span style="color:var(--green)">${fmt(v)}</span>` },
            { label: 'Sessions', key: 'session_count', style: 'style="color:var(--text-dim);"' },
        ]);

        document.getElementById('lb-level').innerHTML = makeTable(data.byLevel, [
            { label: '#' },
            { label: 'Player', key: 'name', style: 'style="font-weight:600;"' },
            { label: 'Level', key: 'level', fmt: v => `<span style="color:var(--purple)">${v}</span>` },
            { label: 'Coins', key: 'coins', fmt: v => fmtC(v), style: 'style="color:var(--text-dim);"' },
        ]);
    }
};

window.onload = () => {
    app.init();

    // Kick off player polling when that view is navigated to
    const origNavigate = app.navigate.bind(app);
    app.navigate = function(viewId) {
        origNavigate(viewId);
        if (viewId === 'players') app.startPlayerPolling();
        if (viewId === 'bans') app.loadBans();
        if (viewId === 'console') app.initConsole();
        if (viewId === 'analytics') app.loadAnalytics();
    };
};
