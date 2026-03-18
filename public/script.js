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
        this.loadSettings();

        if (['admin', 'mod'].includes(this.session.user.role)) {
            this.loadStats();
            this.loadOverviewLogs();
            this.startAlertPolling();
            setTimeout(() => {
                this.req(`analytics_economy&days=7`).then(r => { if (!r.error) this.renderOverviewEcoChart(r); });
                this.req('analytics_retention').then(r => { if (!r.error) this.renderOverviewWeekStats(r); });
                this.req('analytics_leaderboard').then(r => {
                    if (!r.error && r.totals) {
                        const el = document.getElementById('ov-avg-session');
                        if (el) el.innerText = this.fmtDuration(r.totals.avg_playtime_s);
                        const sel = document.getElementById('ov-sessions');
                        if (sel) sel.innerText = Number(r.totals.total_sessions || 0).toLocaleString();
                    }
                });
            }, 100);
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
        // Close sidebar on mobile after navigation
        if (window.innerWidth <= 768) this.closeSidebar();
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
        if (!res || res.error) return;
        const u = document.getElementById('stat-users');
        const e = document.getElementById('stat-eco');
        const r = document.getElementById('stat-rich');
        if (u) u.innerText = Number(res.user_count || 0).toLocaleString();
        if (e) e.innerText = Number(res.total_economy || 0).toLocaleString() + ' ◎';
        if (r) r.innerText = res.top_player || 'None';
    },

    async loadOverviewLogs() {
        const container = document.getElementById('overview-logs-container');
        if (!container) return;
        const res = await this.req('logs');
        // Handle error or non-array response
        if (!res || res.error || !Array.isArray(res)) {
            container.innerHTML = `<p style="font-family:'Space Mono',monospace;font-size:12px;color:var(--text-dim);padding:4px 0;">No recent activity.</p>`;
            return;
        }
        if (!res.length) {
            container.innerHTML = `<p style="font-family:'Space Mono',monospace;font-size:12px;color:var(--text-dim);padding:4px 0;">No recent activity yet.</p>`;
            return;
        }
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
                padding: 12,
                titleFont: { family: 'Space Mono', size: 12 },
                bodyFont: { family: 'Space Mono', size: 12 },
            }},
            scales: {
                x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#6666aa', font: { family: 'Space Mono', size: 12 }, maxTicksLimit: 8 } },
                y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#6666aa', font: { family: 'Space Mono', size: 12 }, maxTicksLimit: 6 } }
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
        const peak  = data.peak || {};

        // KPIs
        document.getElementById('a-peak-eco').innerText = this.fmtCoins(peak.peak_coins || 0) + ' ◎';

        // Growth — find first non-zero snapshot to compare against
        const firstNonZero = snaps.find(s => s.total_coins > 0);
        const lastSnap = snaps[snaps.length - 1];
        if (firstNonZero && lastSnap && firstNonZero !== lastSnap) {
            const pct = (((lastSnap.total_coins - firstNonZero.total_coins) / firstNonZero.total_coins) * 100).toFixed(1);
            const el = document.getElementById('a-eco-growth');
            el.innerText = (parseFloat(pct) >= 0 ? '+' : '') + pct + '%';
            el.style.color = parseFloat(pct) >= 0 ? 'var(--green)' : 'var(--red)';
        } else if (snaps.length > 0) {
            document.getElementById('a-eco-growth').innerText = 'No change';
        }

        // ── Anomaly detection ──
        // Flag any snapshot where coins changed by >20% vs previous
        const anomalies = [];
        for (let i = 1; i < snaps.length; i++) {
            const prev = snaps[i - 1].total_coins;
            const curr = snaps[i].total_coins;
            if (prev > 0) {
                const change = ((curr - prev) / prev) * 100;
                if (Math.abs(change) >= 20) {
                    anomalies.push({ index: i, change, snap: snaps[i] });
                }
            }
        }

        const badge = document.getElementById('eco-anomaly-badge');
        badge.style.display = anomalies.length ? 'inline-block' : 'none';

        const annoEl = document.getElementById('eco-annotations');
        annoEl.innerHTML = anomalies.map(a => {
            const d = new Date(a.snap.hour).toLocaleString('en-GB', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
            const col = a.change > 0 ? 'var(--amber)' : 'var(--red)';
            const sign = a.change > 0 ? '+' : '';
            return `<span style="font-family:'Space Mono',monospace;font-size:10px;background:var(--bg-raised);border:1px solid var(--border-mid);padding:4px 10px;border-radius:2px;color:${col};">
                ⚠ ${d} — ${sign}${a.change.toFixed(1)}% (${this.fmtCoins(a.snap.total_coins)} ◎)
            </span>`;
        }).join('');

        const labels = snaps.map(s => {
            const d = new Date(s.hour);
            return this._analyticsDays <= 7
                ? d.toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false })
                : d.toLocaleDateString('en-GB', { month: 'short', day: 'numeric' });
        });

        const ctx = document.getElementById('eco-chart').getContext('2d');
        const grad = ctx.createLinearGradient(0, 0, 0, 340);
        grad.addColorStop(0, 'rgba(91,106,255,0.3)');
        grad.addColorStop(1, 'rgba(91,106,255,0)');

        // Anomaly point colors
        const pointColors = snaps.map((_, i) =>
            anomalies.find(a => a.index === i) ? '#ff4757' : '#5b6aff'
        );
        const pointSizes = snaps.map((_, i) =>
            anomalies.find(a => a.index === i) ? 7 : (snaps.length > 60 ? 0 : 4)
        );

        this._charts['eco'] = new Chart(ctx, {
            type: 'line',
            data: {
                labels,
                datasets: [
                    {
                        label: 'Total Coins',
                        data: snaps.map(s => Math.max(0, s.total_coins)), // clamp negatives
                        borderColor: '#5b6aff',
                        backgroundColor: grad,
                        borderWidth: 2.5,
                        pointRadius: pointSizes,
                        pointBackgroundColor: pointColors,
                        fill: true,
                        tension: 0.3,
                        yAxisID: 'y',
                    },
                    {
                        label: 'Online Players',
                        data: snaps.map(s => s.online_count ?? null),
                        borderColor: '#00e5a0',
                        backgroundColor: 'transparent',
                        borderWidth: 1.5,
                        pointRadius: 0,
                        borderDash: [5, 5],
                        tension: 0.3,
                        yAxisID: 'y2',
                        spanGaps: true,
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: '#16161f',
                        borderColor: 'rgba(255,255,255,0.12)',
                        borderWidth: 1,
                        titleColor: '#eeeef5',
                        bodyColor: '#8888aa',
                        padding: 14,
                        titleFont: { family: 'Space Mono', size: 12 },
                        bodyFont: { family: 'Space Mono', size: 12 },
                        callbacks: {
                            label: ctx => {
                                if (ctx.datasetIndex === 0) return ` Coins: ${Number(ctx.raw).toLocaleString()} ◎`;
                                return ctx.raw != null ? ` Online: ${ctx.raw}` : ` Online: no data`;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { color: 'rgba(255,255,255,0.04)' },
                        ticks: { color: '#6666aa', font: { family: 'Space Mono', size: 12 }, maxTicksLimit: 10 }
                    },
                    y: {
                        position: 'left',
                        grid: { color: 'rgba(255,255,255,0.06)' },
                        ticks: { color: '#6666aa', font: { family: 'Space Mono', size: 12 }, callback: v => this.fmtCoins(v) + ' ◎' }
                    },
                    y2: {
                        position: 'right',
                        grid: { drawOnChartArea: false },
                        ticks: { color: '#00e5a0', font: { family: 'Space Mono', size: 12 } }
                    }
                }
            }
        });
    },

    renderOverviewEcoChart(data) {
        this.destroyChart('ov-eco');
        const snaps = (data.snapshots || []).filter(s => s.total_coins > 0).slice(-24);
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
        document.getElementById('ov-new').innerText = last.new_players || 0;
        document.getElementById('ov-ret').innerText = last.returning_players || 0;
        // ov-sessions and ov-avg-session are set separately from leaderboard totals
    },

    renderRetention(data) {
        this.destroyChart('ret');
        const rows = data || [];

        // Total sessions KPI is set by renderLeaderboards from totals.total_sessions
        // Here we just render the chart

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
                    legend: { display: true, labels: { color: '#8888aa', font: { family: 'Space Mono', size: 12 }, boxWidth: 12 } }
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

        const cellSize = 24;
        const labelW   = 36;
        const labelH   = 24;

        let html = `<div style="overflow-x:auto;"><div style="display:inline-block;">`;

        // Hour labels top
        html += `<div style="display:flex;margin-left:${labelW}px;margin-bottom:4px;">`;
        HOURS.forEach((h, i) => {
            html += `<div style="width:${cellSize}px;font-family:'Space Mono',monospace;font-size:10px;color:var(--text-secondary);text-align:center;overflow:hidden;">${i % 3 === 0 ? h : ''}</div>`;
        });
        html += `</div>`;

        // Rows
        DAYS.forEach((day, di) => {
            html += `<div style="display:flex;align-items:center;margin-bottom:3px;">`;
            html += `<div style="width:${labelW}px;font-family:'Space Mono',monospace;font-size:11px;color:var(--text-secondary);text-align:right;padding-right:8px;">${day}</div>`;
            HOURS.forEach((_, hi) => {
                const val = grid[`${di}_${hi}`] || 0;
                const intensity = maxVal > 0 ? val / maxVal : 0;
                const alpha  = 0.08 + intensity * 0.92;
                const color  = `rgba(91,106,255,${alpha})`;
                const border = intensity > 0.5 ? '1px solid rgba(91,106,255,0.4)' : '1px solid rgba(255,255,255,0.04)';
                html += `<div title="${day} ${hi}:00 — ${val} sessions" style="width:${cellSize}px;height:${cellSize}px;background:${color};border:${border};border-radius:2px;cursor:default;"></div>`;
            });
            html += `</div>`;
        });

        // Legend
        html += `<div style="display:flex;align-items:center;gap:6px;margin-top:10px;margin-left:${labelW}px;">`;
        html += `<span style="font-family:'Space Mono',monospace;font-size:11px;color:var(--text-secondary);">Low</span>`;
        [0.1,0.3,0.5,0.7,0.9].forEach(a => {
            html += `<div style="width:18px;height:18px;background:rgba(91,106,255,${a});border-radius:2px;"></div>`;
        });
        html += `<span style="font-family:'Space Mono',monospace;font-size:11px;color:var(--text-secondary);">High</span>`;
        html += `</div>`;

        html += `</div></div>`;
        document.getElementById('heatmap-container').innerHTML = html;
    },

    renderLeaderboards(data) {
        const fmt = this.fmtDuration.bind(this);
        const fmtC = this.fmtCoins.bind(this);

        if (data.totals) {
            const avgEl = document.getElementById('a-avg-session');
            if (avgEl) avgEl.innerText = fmt(data.totals.avg_playtime_s) || '0s';
            const sesEl = document.getElementById('a-sessions');
            if (sesEl) sesEl.innerText = Number(data.totals.total_sessions || 0).toLocaleString();
        }

        const makeTable = (rows, cols) => {
            if (!rows.length) return `<p style="padding:16px;font-family:'Space Mono',monospace;font-size:12px;color:var(--text-dim);">No data yet.</p>`;
            return `<table class="data-table" style="font-size:12px;">
                <thead><tr>${cols.map(c => `<th>${c.label}</th>`).join('')}</tr></thead>
                <tbody>${rows.map((r, i) => `<tr>
                    <td style="color:var(--text-dim);font-family:'Space Mono',monospace;">#${i+1}</td>
                    ${cols.slice(1).map(c => `<td ${c.style||''}>${c.fmt ? c.fmt(r[c.key], r) : r[c.key]}</td>`).join('')}
                </tr>`).join('')}</tbody>
            </table>`;
        };

        const nameLink = (name) => `<span class="player-link" onclick="app.openProfileModal('${name}')">${name}</span>`;

        document.getElementById('lb-coins').innerHTML = makeTable(data.byCoins, [
            { label: '#' },
            { label: 'Player', key: 'name', fmt: v => nameLink(v) },
            { label: 'Coins', key: 'coins', fmt: v => `<span style="color:var(--amber)">${fmtC(v)} ◎</span>` },
            { label: 'Lv', key: 'level', style: 'style="color:var(--text-dim);"' },
        ]);
        document.getElementById('lb-playtime').innerHTML = makeTable(data.byPlaytime, [
            { label: '#' },
            { label: 'Player', key: 'name', fmt: v => nameLink(v) },
            { label: 'Playtime', key: 'total_playtime_s', fmt: v => `<span style="color:var(--green)">${fmt(v)}</span>` },
            { label: 'Sessions', key: 'session_count', style: 'style="color:var(--text-dim);"' },
        ]);
        document.getElementById('lb-level').innerHTML = makeTable(data.byLevel, [
            { label: '#' },
            { label: 'Player', key: 'name', fmt: v => nameLink(v) },
            { label: 'Level', key: 'level', fmt: v => `<span style="color:var(--purple)">${v}</span>` },
            { label: 'Coins', key: 'coins', fmt: v => fmtC(v), style: 'style="color:var(--text-dim);"' },
        ]);
    },

    // ════ MOBILE SIDEBAR ════
    toggleSidebar() {
        const sidebar = document.querySelector('aside.sidebar');
        const overlay = document.getElementById('sidebar-overlay');
        const btn = document.querySelector('.hamburger');
        const isOpen = sidebar.classList.contains('open');
        if (isOpen) {
            this.closeSidebar();
        } else {
            sidebar.classList.add('open');
            overlay.classList.add('visible');
            btn.classList.add('open');
        }
    },

    closeSidebar() {
        document.querySelector('aside.sidebar').classList.remove('open');
        document.getElementById('sidebar-overlay').classList.remove('visible');
        document.querySelector('.hamburger')?.classList.remove('open');
    },
    _searchTimer: null,
    _searchFocusIndex: -1,

    openSearch() {
        const overlay = document.getElementById('search-overlay');
        overlay.style.display = 'flex';
        setTimeout(() => document.getElementById('search-input').focus(), 50);
        this._searchFocusIndex = -1;
    },

    closeSearch() {
        document.getElementById('search-overlay').style.display = 'none';
        document.getElementById('search-input').value = '';
        document.getElementById('search-results').innerHTML = '<div style="padding:24px;text-align:center;font-family:\'Space Mono\',monospace;font-size:12px;color:var(--text-dim);">// Start typing to search...</div>';
    },

    searchKeydown(e) {
        const items = document.querySelectorAll('.search-result-item');
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            this._searchFocusIndex = Math.min(this._searchFocusIndex + 1, items.length - 1);
            items.forEach((el, i) => el.classList.toggle('focused', i === this._searchFocusIndex));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            this._searchFocusIndex = Math.max(this._searchFocusIndex - 1, 0);
            items.forEach((el, i) => el.classList.toggle('focused', i === this._searchFocusIndex));
        } else if (e.key === 'Enter' && this._searchFocusIndex >= 0) {
            items[this._searchFocusIndex]?.click();
        }
    },

    doSearch(q) {
        clearTimeout(this._searchTimer);
        if (!q || q.length < 2) return;
        this._searchTimer = setTimeout(() => this._execSearch(q), 250);
    },

    async _execSearch(q) {
        const res = await this.req('search', 'POST', { query: q });
        if (res.error) return;

        const el = document.getElementById('search-results');
        let html = '';

        if (res.players?.length) {
            html += `<div class="search-result-group"><div class="search-result-label">Players</div>`;
            res.players.forEach(p => {
                html += `<div class="search-result-item" onclick="app.closeSearch();app.openProfileModal('${p.name}')">
                    <div class="search-result-icon" style="color:var(--accent-bright);font-weight:700;">${p.name.charAt(0).toUpperCase()}</div>
                    <div><div class="search-result-name">${p.name}</div>
                    <div class="search-result-meta">Lv.${p.level} — ${Number(p.coins).toLocaleString()} ◎</div></div>
                </div>`;
            });
            html += `</div>`;
        }

        if (res.punishments?.length) {
            html += `<div class="search-result-group"><div class="search-result-label">Punishments</div>`;
            res.punishments.forEach(p => {
                const typeClass = `ptype-${p.type}`;
                html += `<div class="search-result-item" onclick="app.closeSearch();app.navigate('bans')">
                    <div class="search-result-icon" style="color:var(--red);">⊘</div>
                    <div><div class="search-result-name">${p.target_name} <span class="${typeClass}" style="margin-left:6px;">${p.type.toUpperCase()}</span></div>
                    <div class="search-result-meta">${p.reason} — by ${p.issued_by}</div></div>
                </div>`;
            });
            html += `</div>`;
        }

        if (res.logs?.length) {
            html += `<div class="search-result-group"><div class="search-result-label">Audit Logs</div>`;
            res.logs.forEach(l => {
                const date = new Date(l.timestamp).toLocaleDateString('en-GB');
                html += `<div class="search-result-item" onclick="app.closeSearch();app.navigate('logs')">
                    <div class="search-result-icon" style="color:var(--text-dim);">≡</div>
                    <div><div class="search-result-name">${l.action}</div>
                    <div class="search-result-meta">${l.username} — ${date}</div></div>
                </div>`;
            });
            html += `</div>`;
        }

        if (!html) html = `<div style="padding:32px;text-align:center;font-family:'Space Mono',monospace;font-size:12px;color:var(--text-dim);">// No results for "${q}"</div>`;
        el.innerHTML = html;
        this._searchFocusIndex = -1;
    },

    // ════ PLAYER PROFILE MODAL ════
    _modalChart: null,

    playerLink(name) {
        return `<span class="player-link" onclick="app.openProfileModal('${name}')">${name}</span>`;
    },

    async openProfileModal(name) {
        const modal = document.getElementById('profile-modal');
        modal.style.display = 'flex';

        // Reset
        document.getElementById('modal-name').innerText = name;
        document.getElementById('modal-avatar').innerText = name.charAt(0).toUpperCase();
        document.getElementById('modal-uuid').innerText = 'Loading...';
        document.getElementById('modal-coins').innerText = '—';
        document.getElementById('modal-level').innerText = '—';
        document.getElementById('modal-playtime').innerText = '—';
        document.getElementById('modal-sessions').innerText = '—';
        document.getElementById('modal-punishments').innerHTML = 'Loading...';
        document.getElementById('modal-sessions-list').innerHTML = 'Loading...';

        const [playerRes, historyRes, punishRes, sessionRes] = await Promise.all([
            this.req('lookup', 'POST', { query: name }),
            this.req(`analytics_player&uuid=lookup&name=${encodeURIComponent(name)}`),
            this.req('player_punishments', 'POST', { name }),
            this.req('player_sessions', 'POST', { name }),
        ]);

        if (playerRes.error) {
            document.getElementById('modal-uuid').innerText = 'Player not found';
            return;
        }

        document.getElementById('modal-uuid').innerText = playerRes.uuid;
        document.getElementById('modal-coins').innerText = Number(playerRes.coins || 0).toLocaleString() + ' ◎';
        document.getElementById('modal-level').innerText = playerRes.level || 1;
        document.getElementById('modal-playtime').innerText = this.fmtDuration(playerRes.total_playtime_s);
        document.getElementById('modal-sessions').innerText = playerRes.session_count || 0;

        // Online badge
        const badge = document.getElementById('modal-status-badge');
        badge.innerHTML = playerRes.online
            ? `<span style="font-family:'Space Mono',monospace;font-size:9px;background:var(--green-dim);color:var(--green);border:1px solid rgba(0,229,160,0.3);padding:2px 8px;border-radius:2px;letter-spacing:1px;"><span class="status-dot" style="width:5px;height:5px;margin-right:4px;"></span>ONLINE</span>`
            : `<span style="font-family:'Space Mono',monospace;font-size:9px;color:var(--text-dim);">OFFLINE</span>`;

        // Store for quick action buttons
        this._modalPlayer = playerRes;

        // Coin history chart
        if (this._modalChart) { this._modalChart.destroy(); this._modalChart = null; }
        if (historyRes && !historyRes.error && historyRes.length > 1) {
            const ctx = document.getElementById('modal-chart').getContext('2d');
            const grad = ctx.createLinearGradient(0, 0, 0, 120);
            grad.addColorStop(0, 'rgba(255,184,48,0.25)');
            grad.addColorStop(1, 'rgba(255,184,48,0)');
            this._modalChart = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: historyRes.map(r => new Date(r.snapped_at).toLocaleDateString('en-GB')),
                    datasets: [{ data: historyRes.map(r => r.coins), borderColor: '#ffb830', backgroundColor: grad, borderWidth: 2, pointRadius: 0, fill: true, tension: 0.3 }]
                },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { enabled: true } }, scales: { x: { display: false }, y: { display: true, ticks: { color: '#6666aa', font: { family: 'Space Mono', size: 10 }, callback: v => this.fmtCoins(v) }, grid: { color: 'rgba(255,255,255,0.04)' } } } }
            });
        } else {
            document.getElementById('modal-chart').parentElement.innerHTML = `<div style="height:120px;display:flex;align-items:center;justify-content:center;font-family:'Space Mono',monospace;font-size:11px;color:var(--text-dim);">// Not enough history yet</div>`;
        }

        // Punishments
        const pList = document.getElementById('modal-punishments');
        if (!punishRes || punishRes.error || !punishRes.length) {
            pList.innerHTML = `<span style="color:var(--green);">// Clean record</span>`;
        } else {
            pList.innerHTML = punishRes.map(p => {
                const d = new Date(p.issued_at).toLocaleDateString('en-GB');
                const col = p.type === 'ban' ? 'var(--red)' : p.type === 'tempban' ? 'var(--purple)' : 'var(--amber)';
                return `<div style="padding:6px 0;border-bottom:1px solid var(--border-dim);">
                    <span style="color:${col};text-transform:uppercase;letter-spacing:1px;">${p.type}</span>
                    <span style="color:var(--text-dim);margin:0 6px;">·</span>${p.reason}
                    <div style="color:var(--text-dim);font-size:10px;margin-top:2px;">${d} by ${p.issued_by}</div>
                </div>`;
            }).join('');
        }

        // Recent sessions
        const sList = document.getElementById('modal-sessions-list');
        if (!sessionRes || sessionRes.error || !sessionRes.length) {
            sList.innerHTML = `<span style="color:var(--text-dim);">// No sessions logged yet</span>`;
        } else {
            sList.innerHTML = sessionRes.slice(0, 8).map(s => {
                const d = new Date(s.joined_at).toLocaleDateString('en-GB');
                const dur = this.fmtDuration(s.duration_s);
                return `<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border-dim);">
                    <span style="color:var(--text-secondary);">${d}</span>
                    <span style="color:var(--green);">${dur}</span>
                </div>`;
            }).join('');
        }
    },

    closeProfileModal() {
        document.getElementById('profile-modal').style.display = 'none';
        if (this._modalChart) { this._modalChart.destroy(); this._modalChart = null; }
    },

    modalEditPlayer() {
        if (!this._modalPlayer) return;
        this.closeProfileModal();
        document.getElementById('p-search').value = this._modalPlayer.name;
        this.navigate('player');
        this.lookupPlayer();
    },

    modalBanPlayer() {
        if (!this._modalPlayer) return;
        this.closeProfileModal();
        document.getElementById('ban-target').value = this._modalPlayer.name;
        document.getElementById('ban-type').value = 'ban';
        this.navigate('bans');
    },

    // ════ STAFF MANAGEMENT ════
    async loadStaff() {
        const res = await this.req('staff_list');
        if (res.error) return;

        let html = `<table class="data-table">
            <thead><tr><th>ID</th><th>Username</th><th>Role</th><th>Actions</th></tr></thead><tbody>`;

        res.forEach(s => {
            const isSelf = s.username === this.session.user.username;
            html += `<tr>
                <td class="mono" style="color:var(--text-dim);">#${s.id}</td>
                <td style="font-weight:600;">${s.username}${isSelf ? ' <span style="font-family:\'Space Mono\',monospace;font-size:9px;color:var(--accent);background:var(--accent-glow);padding:2px 6px;border-radius:2px;">YOU</span>' : ''}</td>
                <td><span class="badge ${s.role}">${s.role}</span></td>
                <td>
                    <div style="display:flex;gap:6px;">
                        <select onchange="app.changeStaffRole(${s.id},'${s.username}',this.value)" style="background:var(--bg-base);border:1px solid var(--border-dim);color:var(--text-secondary);padding:4px 8px;border-radius:2px;font-family:'Space Mono',monospace;font-size:10px;width:auto;" ${isSelf ? 'disabled' : ''}>
                            <option value="mod" ${s.role==='mod'?'selected':''}>Mod</option>
                            <option value="dev" ${s.role==='dev'?'selected':''}>Dev</option>
                            <option value="admin" ${s.role==='admin'?'selected':''}>Admin</option>
                        </select>
                        <button class="btn-sm" onclick="app.resetStaffToken(${s.id},'${s.username}')">RESET TOKEN</button>
                        ${!isSelf ? `<button class="btn-sm btn-red" onclick="app.deleteStaff(${s.id},'${s.username}')">DELETE</button>` : ''}
                    </div>
                </td>
            </tr>`;
        });

        html += `</tbody></table>`;
        document.getElementById('staff-table-container').innerHTML = html;
    },

    async createStaff() {
        const username = document.getElementById('new-staff-user').value.trim();
        const password = document.getElementById('new-staff-pass').value;
        const role     = document.getElementById('new-staff-role').value;
        const invite   = document.getElementById('new-staff-invite').value.trim();

        if (!username || !password || !invite) return this.toast("All fields required.", "error");

        const res = await this.req('staff_create', 'POST', { username, password, role, invite_code: invite });
        if (res.error) return this.toast(res.error, "error");

        this.toast(`Account created for ${username}.`);
        document.getElementById('new-staff-user').value = '';
        document.getElementById('new-staff-pass').value = '';
        document.getElementById('new-staff-invite').value = '';
        this.loadStaff();
    },

    async changeStaffRole(id, username, role) {
        const ok = await this.confirm(`Change ${username}'s role to ${role.toUpperCase()}?`);
        if (!ok) return;
        const res = await this.req('staff_update', 'POST', { id, role });
        if (res.error) return this.toast(res.error, "error");
        this.toast(`${username} is now ${role}.`);
        this.loadStaff();
    },

    async resetStaffToken(id, username) {
        const ok = await this.confirm(`Reset ${username}'s session token? They will be logged out.`);
        if (!ok) return;
        const res = await this.req('staff_reset_token', 'POST', { id });
        if (res.error) return this.toast(res.error, "error");
        this.toast(`Token reset for ${username}.`);
    },

    async deleteStaff(id, username) {
        const ok = await this.confirm(`Permanently delete ${username}'s account? This cannot be undone.`, true);
        if (!ok) return;
        const res = await this.req('staff_delete', 'POST', { id });
        if (res.error) return this.toast(res.error, "error");
        this.toast(`${username} deleted.`);
        this.loadStaff();
    },

    // ════ SETTINGS ════
    _settings: {},

    loadSettings() {
        const saved = localStorage.getItem('brume_settings');
        this._settings = saved ? JSON.parse(saved) : {
            theme: 'dark', accent: 'indigo', textSize: 14,
            dateFormat: 'en-GB', sidebar: 'expanded', anomalyThreshold: 20
        };
        this.applySettings();
        this.renderSettingsUI();
    },

    saveSettings() {
        localStorage.setItem('brume_settings', JSON.stringify(this._settings));
    },

    applySettings() {
        const s = this._settings;
        const body = document.body;

        // Theme
        body.classList.remove('theme-dark', 'theme-midnight', 'theme-light');
        if (s.theme !== 'dark') body.classList.add(`theme-${s.theme}`);

        // Accent
        body.classList.remove('accent-indigo', 'accent-amber', 'accent-rose');
        body.classList.add(`accent-${s.accent}`);

        // Text size
        document.documentElement.style.setProperty('--base-font-size', (s.textSize || 14) + 'px');
        document.querySelector('main') && (document.querySelector('main').style.fontSize = (s.textSize || 14) + 'px');

        // Sidebar
        body.classList.toggle('sidebar-compact', s.sidebar === 'compact');
    },

    renderSettingsUI() {
        const s = this._settings;

        // Theme buttons
        document.querySelectorAll('.theme-btn[data-theme]').forEach(b => b.classList.toggle('active', b.dataset.theme === s.theme));
        document.querySelectorAll('.theme-btn[data-fmt]').forEach(b => b.classList.toggle('active', b.dataset.fmt === s.dateFormat));
        document.querySelectorAll('.theme-btn[data-sidebar]').forEach(b => b.classList.toggle('active', b.dataset.sidebar === s.sidebar));

        // Accent swatches
        document.querySelectorAll('.accent-swatch').forEach(b => b.classList.toggle('active', b.dataset.accent === s.accent));

        // Sliders
        const ts = document.getElementById('text-size-slider');
        if (ts) { ts.value = s.textSize; document.getElementById('text-size-label').innerText = s.textSize + 'px'; }
        const as = document.getElementById('anomaly-slider');
        if (as) { as.value = s.anomalyThreshold; document.getElementById('anomaly-label').innerText = s.anomalyThreshold + '%'; }
    },

    setTheme(theme, btn) {
        this._settings.theme = theme;
        this.saveSettings(); this.applySettings();
        document.querySelectorAll('.theme-btn[data-theme]').forEach(b => b.classList.toggle('active', b === btn));
    },

    setAccent(accent, btn) {
        this._settings.accent = accent;
        this.saveSettings(); this.applySettings();
        document.querySelectorAll('.accent-swatch').forEach(b => b.classList.toggle('active', b === btn));
    },

    setTextSize(v) {
        this._settings.textSize = parseInt(v);
        document.getElementById('text-size-label').innerText = v + 'px';
        this.saveSettings(); this.applySettings();
    },

    setDateFormat(fmt, btn) {
        this._settings.dateFormat = fmt;
        this.saveSettings();
        document.querySelectorAll('.theme-btn[data-fmt]').forEach(b => b.classList.toggle('active', b === btn));
    },

    setSidebar(mode, btn) {
        this._settings.sidebar = mode;
        this.saveSettings(); this.applySettings();
        document.querySelectorAll('.theme-btn[data-sidebar]').forEach(b => b.classList.toggle('active', b === btn));
    },

    setAnomalyThreshold(v) {
        this._settings.anomalyThreshold = parseInt(v);
        document.getElementById('anomaly-label').innerText = v + '%';
        this.saveSettings();
    },

    async changePassword() {
        const p1 = document.getElementById('change-pass').value;
        const p2 = document.getElementById('change-pass-confirm').value;
        if (!p1) return this.toast("Enter a new password.", "error");
        if (p1 !== p2) return this.toast("Passwords don't match.", "error");
        const res = await this.req('change_password', 'POST', { password: p1 });
        if (res.error) return this.toast(res.error, "error");
        this.toast("Password updated.");
        document.getElementById('change-pass').value = '';
        document.getElementById('change-pass-confirm').value = '';
    },

    async clearEconomySnapshots() {
        const ok = await this.confirm('Permanently delete ALL economy snapshots? Charts will be empty until new data accumulates.', true);
        if (!ok) return;
        const res = await this.req('purge_snapshots', 'POST', {});
        if (res.error) return this.toast(res.error, "error");
        this.toast("Economy snapshots purged.");
    },

    async clearSessionLogs() {
        const ok = await this.confirm('Permanently delete ALL session logs? Heatmap and retention data will reset.', true);
        if (!ok) return;
        const res = await this.req('purge_sessions', 'POST', {});
        if (res.error) return this.toast(res.error, "error");
        this.toast("Session logs purged.");
    },

    // ════ CONFIRM MODAL ════
    _confirmResolve: null,

    confirm(message, danger = false) {
        return new Promise(resolve => {
            const modal = document.getElementById('confirm-modal');
            document.getElementById('confirm-body').innerText = message;
            const btn = document.getElementById('confirm-ok');
            btn.style.background = danger ? 'var(--red)' : 'var(--accent)';
            modal.style.display = 'flex';
            this._confirmResolve = (val) => {
                modal.style.display = 'none';
                resolve(val);
            };
        });
    },

    closeConfirm() {
        if (this._confirmResolve) this._confirmResolve(false);
    },

    // ════ SECURITY ════
    _secTab: 'alerts',

    setSecTab(tab, btn) {
        this._secTab = tab;
        ['alerts','analysis','rollback','settings-sec'].forEach(t => {
            const el = document.getElementById(`sec-${t}`);
            if (el) el.style.display = t === tab ? 'block' : 'none';
        });
        document.querySelectorAll('.sec-tab').forEach(b => {
            b.style.color = b === btn ? 'var(--text-primary)' : 'var(--text-dim)';
            b.style.borderBottomColor = b === btn ? 'var(--accent)' : 'transparent';
        });
        if (tab === 'alerts') this.loadAlerts();
        if (tab === 'analysis') this.loadAnalysis();
    },

    async loadAlerts() {
        const showResolved = document.getElementById('show-resolved')?.checked;
        const res = await this.req(`alerts_list${showResolved ? '&resolved=true' : ''}`);
        const container = document.getElementById('alerts-container');
        if (!container) return;

        // Update badge
        this.updateAlertBadge(res.unresolved_count || 0);

        if (res.error) {
            container.innerHTML = `<p style="font-family:'Space Mono',monospace;font-size:12px;color:var(--red);">// Error: ${res.error}</p>`;
            return;
        }

        if (!res.alerts?.length) {
            container.innerHTML = `<div style="text-align:center;padding:48px;font-family:'Space Mono',monospace;font-size:12px;color:var(--green);">// No ${showResolved ? '' : 'unresolved '}alerts. Server looks clean.</div>`;
            return;
        }

        const severityColor = { low: 'var(--text-dim)', medium: 'var(--amber)', high: 'var(--red)', critical: 'var(--red)' };
        const typeIcon = { VELOCITY: '⚡', SNAPSHOT_DELTA: '📈', ALT_ACCOUNT: '👥', ECONOMY_SPIKE: '💹' };

        container.innerHTML = res.alerts.map(a => {
            const date = new Date(a.created_at).toLocaleString('en-GB', { hour12: false });
            const col = severityColor[a.severity] || 'var(--text-secondary)';
            const icon = typeIcon[a.type] || '⚠';
            const resolved = a.resolved ? `<span style="font-family:'Space Mono',monospace;font-size:9px;color:var(--green);background:var(--green-dim);padding:2px 6px;border-radius:2px;border:1px solid rgba(0,229,160,0.2);">RESOLVED by ${a.resolved_by}</span>` : '';

            return `<div style="background:var(--bg-panel);border:1px solid var(--border-dim);border-left:3px solid ${col};border-radius:4px;padding:16px;margin-bottom:10px;${a.resolved ? 'opacity:0.5;' : ''}">
                <div style="display:flex;align-items:flex-start;gap:12px;">
                    <span style="font-size:18px;flex-shrink:0;">${icon}</span>
                    <div style="flex:1;">
                        <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;flex-wrap:wrap;">
                            <span style="font-family:'Space Mono',monospace;font-size:10px;font-weight:700;letter-spacing:1.5px;color:${col};">${a.type}</span>
                            <span style="font-family:'Space Mono',monospace;font-size:10px;background:${col === 'var(--red)' ? 'var(--red-dim)' : 'var(--amber-dim)'};color:${col};border:1px solid ${col === 'var(--red)' ? 'rgba(255,71,87,0.3)' : 'rgba(255,184,48,0.3)'};padding:1px 6px;border-radius:2px;">${a.severity.toUpperCase()}</span>
                            <span style="font-weight:700;font-size:14px;">${a.player_name !== 'SERVER' ? `<span class="player-link" onclick="app.openProfileModal('${a.player_name}')">${a.player_name}</span>` : 'SERVER'}</span>
                            ${resolved}
                        </div>
                        <p style="font-family:'Space Mono',monospace;font-size:11px;color:var(--text-secondary);line-height:1.7;margin-bottom:8px;">${a.detail}</p>
                        <div style="display:flex;align-items:center;gap:10px;">
                            <span style="font-family:'Space Mono',monospace;font-size:10px;color:var(--text-dim);">${date}</span>
                            ${!a.resolved ? `
                            <button class="btn-sm" onclick="app.resolveAlert(${a.id})">RESOLVE</button>
                            ${a.player_name !== 'SERVER' ? `
                            <button class="btn-sm" onclick="app.openProfileModal('${a.player_name}')">VIEW PLAYER</button>
                            <button class="btn-sm" onclick="app.quickRollback('${a.player_name}')">ROLLBACK</button>
                            ` : ''}` : ''}
                        </div>
                    </div>
                </div>
            </div>`;
        }).join('');
    },

    updateAlertBadge(count) {
        const badge = document.getElementById('alert-badge');
        if (!badge) return;
        if (count > 0) {
            badge.style.display = 'inline-block';
            badge.innerText = count > 99 ? '99+' : count;
        } else {
            badge.style.display = 'none';
        }
    },

    async resolveAlert(id) {
        const res = await this.req('alert_resolve', 'POST', { id });
        if (res.error) return this.toast(res.error, "error");
        this.toast("Alert resolved.");
        this.loadAlerts();
    },

    async resolveAllAlerts() {
        const ok = await this.confirm('Mark all unresolved alerts as resolved?');
        if (!ok) return;
        const res = await this.req('alerts_resolve_all', 'POST', {});
        if (res.error) return this.toast(res.error, "error");
        this.toast("All alerts resolved.");
        this.loadAlerts();
    },

    async loadAnalysis() {
        const container = document.getElementById('analysis-container');
        if (!container) return;
        container.innerHTML = `<p style="font-family:'Space Mono',monospace;font-size:12px;color:var(--text-dim);">// Running analysis...</p>`;

        const res = await this.req('security_analysis');
        if (res.error) {
            container.innerHTML = `<p style="font-family:'Space Mono',monospace;font-size:12px;color:var(--red);">// Error: ${res.error}</p>`;
            return;
        }

        const fmtC = this.fmtCoins.bind(this);
        let html = '';

        // Economy spikes
        html += `<div class="card" style="margin-bottom:16px;">
            <div class="card-title">Economy Spikes <span style="color:var(--red);margin-left:8px;">${res.spikes?.length || 0} found</span></div>`;
        if (!res.spikes?.length) {
            html += `<p style="font-family:'Space Mono',monospace;font-size:12px;color:var(--green);">// No economy spikes detected.</p>`;
        } else {
            html += `<table class="data-table"><thead><tr><th>Time</th><th>Before</th><th>After</th><th>Change</th></tr></thead><tbody>`;
            res.spikes.forEach(s => {
                const date = new Date(s.snapped_at).toLocaleString('en-GB', { hour12: false });
                const col = s.pct_change > 0 ? 'var(--red)' : 'var(--green)';
                const sign = s.pct_change > 0 ? '+' : '';
                html += `<tr>
                    <td class="mono" style="color:var(--text-dim);">${date}</td>
                    <td style="color:var(--text-secondary);">${fmtC(s.prev_coins)} ◎</td>
                    <td style="color:var(--text-primary);">${fmtC(s.total_coins)} ◎</td>
                    <td style="color:${col};font-weight:700;">${sign}${s.pct_change}%</td>
                </tr>`;
            });
            html += `</tbody></table>`;
        }
        html += `</div>`;

        // Snapshot deltas
        html += `<div class="card" style="margin-bottom:16px;">
            <div class="card-title">Largest Snapshot Jumps <span style="color:var(--amber);margin-left:8px;">${res.deltas?.length || 0} found</span></div>`;
        if (!res.deltas?.length) {
            html += `<p style="font-family:'Space Mono',monospace;font-size:12px;color:var(--green);">// No suspicious jumps detected.</p>`;
        } else {
            html += `<table class="data-table"><thead><tr><th>Player</th><th>Before</th><th>After</th><th>Delta</th><th>Time</th><th></th></tr></thead><tbody>`;
            res.deltas.forEach(d => {
                const date = new Date(d.snapped_at).toLocaleDateString('en-GB');
                const col = d.delta > 0 ? 'var(--red)' : 'var(--green)';
                html += `<tr>
                    <td style="font-weight:600;"><span class="player-link" onclick="app.openProfileModal('${d.name}')">${d.name}</span></td>
                    <td style="color:var(--text-secondary);">${fmtC(d.prev_coins)} ◎</td>
                    <td style="color:var(--text-primary);">${fmtC(d.current_coins)} ◎</td>
                    <td style="color:${col};font-weight:700;">${d.delta > 0 ? '+' : ''}${fmtC(d.delta)} ◎</td>
                    <td class="mono" style="color:var(--text-dim);">${date}</td>
                    <td><button class="btn-sm" onclick="app.quickRollback('${d.name}')">ROLLBACK</button></td>
                </tr>`;
            });
            html += `</tbody></table>`;
        }
        html += `</div>`;

        // Alt accounts
        html += `<div class="card" style="margin-bottom:16px;">
            <div class="card-title">Shared IPs / Possible Alts <span style="color:var(--purple);margin-left:8px;">${res.alts?.length || 0} groups</span></div>`;
        if (!res.alts?.length) {
            html += `<p style="font-family:'Space Mono',monospace;font-size:12px;color:var(--green);">// No shared IPs detected.</p>`;
        } else {
            html += `<table class="data-table"><thead><tr><th>IP</th><th>Accounts</th><th>Names</th><th>Last Seen</th></tr></thead><tbody>`;
            res.alts.forEach(a => {
                const date = new Date(a.last_seen).toLocaleDateString('en-GB');
                const names = a.names.split(', ').map(n =>
                    `<span class="player-link" onclick="app.openProfileModal('${n}')">${n}</span>`
                ).join(', ');
                html += `<tr>
                    <td class="mono" style="color:var(--text-dim);">${a.ip.replace(/(\d+\.\d+)\.\d+\.\d+/, '$1.*.*')}</td>
                    <td style="color:var(--purple);font-weight:700;">${a.account_count}</td>
                    <td>${names}</td>
                    <td class="mono" style="color:var(--text-dim);">${date}</td>
                </tr>`;
            });
            html += `</tbody></table>`;
        }
        html += `</div>`;

        container.innerHTML = html;
    },

    // ── ROLLBACK ──
    quickRollback(name) {
        this.setSecTab('rollback', document.querySelectorAll('.sec-tab')[2]);
        document.getElementById('rollback-search').value = name;
        this.loadRollbackTimeline();
    },

    async loadRollbackTimeline() {
        const name = document.getElementById('rollback-search').value.trim();
        if (!name) return;
        const container = document.getElementById('rollback-container');
        container.innerHTML = `<p style="font-family:'Space Mono',monospace;font-size:12px;color:var(--text-dim);">Loading timeline...</p>`;

        const res = await this.req('rollback_timeline', 'POST', { name });
        if (res.error) {
            container.innerHTML = `<p style="font-family:'Space Mono',monospace;font-size:12px;color:var(--red);">// ${res.error}</p>`;
            return;
        }

        const { player, snapshots } = res;
        const fmtC = this.fmtCoins.bind(this);
        const fmtD = this.fmtDuration.bind(this);

        let html = `
        <div class="card" style="margin-bottom:16px;">
            <div style="display:flex;align-items:center;gap:16px;">
                <div style="width:44px;height:44px;clip-path:polygon(50% 0%,100% 25%,100% 75%,50% 100%,0% 75%,0% 25%);background:var(--accent);display:flex;align-items:center;justify-content:center;font-family:'Space Mono',monospace;font-weight:700;font-size:18px;color:white;flex-shrink:0;">${player.name.charAt(0).toUpperCase()}</div>
                <div>
                    <h3 style="font-size:18px;font-weight:800;margin-bottom:4px;">${player.name}</h3>
                    <div style="font-family:'Space Mono',monospace;font-size:11px;color:var(--text-secondary);">
                        Current: <span style="color:var(--amber);">${fmtC(player.coins)} ◎</span>
                        &nbsp;·&nbsp; Lv.${player.level}
                        &nbsp;·&nbsp; <span style="color:var(--green);">${fmtD(player.total_playtime_s)}</span>
                    </div>
                </div>
            </div>
        </div>

        <div class="card" style="padding:0;">
            <div style="padding:20px 24px 0;"><div class="card-title">Snapshot Timeline — ${snapshots.length} snapshots</div></div>
            <div style="padding:0 24px 16px;">
                <p style="font-family:'Space Mono',monospace;font-size:10px;color:var(--text-dim);margin-bottom:16px;line-height:1.7;">// Click RESTORE on any snapshot to roll this player back to that point in time. This will overwrite their current coins, level and XP.</p>`;

        if (!snapshots.length) {
            html += `<p style="font-family:'Space Mono',monospace;font-size:12px;color:var(--text-dim);">// No snapshots found. Data accumulates over time.</p>`;
        } else {
            html += `<div style="position:relative;">`;
            // Timeline line
            html += `<div style="position:absolute;left:20px;top:0;bottom:0;width:1px;background:var(--border-dim);"></div>`;

            snapshots.forEach((snap, i) => {
                const date = new Date(snap.snapped_at).toLocaleString('en-GB', { hour12: false });
                const isCurrent = i === 0;
                const dotColor = isCurrent ? 'var(--green)' : 'var(--border-mid)';

                html += `<div style="display:flex;align-items:flex-start;gap:16px;padding:10px 0;position:relative;">
                    <div style="width:40px;height:40px;border-radius:50%;background:var(--bg-raised);border:2px solid ${dotColor};display:flex;align-items:center;justify-content:center;flex-shrink:0;z-index:1;">
                        ${isCurrent ? '<span style="font-size:8px;font-family:\'Space Mono\',monospace;color:var(--green);">NOW</span>' : `<span style="font-family:'Space Mono',monospace;font-size:9px;color:var(--text-dim);">${i + 1}</span>`}
                    </div>
                    <div style="flex:1;background:var(--bg-raised);border:1px solid ${isCurrent ? 'rgba(0,229,160,0.2)' : 'var(--border-dim)'};border-radius:4px;padding:12px 16px;">
                        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
                            <div>
                                <div style="font-family:'Space Mono',monospace;font-size:10px;color:var(--text-dim);margin-bottom:4px;">${date}</div>
                                <div style="display:flex;gap:16px;font-family:'Space Mono',monospace;font-size:12px;">
                                    <span style="color:var(--amber);">${fmtC(snap.coins)} ◎</span>
                                    <span style="color:var(--purple);">Lv.${snap.level}</span>
                                    <span style="color:var(--text-secondary);">XP: ${Number(snap.xp).toLocaleString()}</span>
                                </div>
                            </div>
                            ${!isCurrent ? `<button class="btn-sm btn-red" onclick="app.executeRollback(${snap.id},'${player.name}',${snap.coins},${snap.level})">RESTORE</button>` : `<span style="font-family:'Space Mono',monospace;font-size:9px;color:var(--green);background:var(--green-dim);padding:2px 8px;border-radius:2px;border:1px solid rgba(0,229,160,0.2);">CURRENT</span>`}
                        </div>
                    </div>
                </div>`;
            });
            html += `</div>`;
        }

        html += `</div></div>`;
        container.innerHTML = html;
    },

    async executeRollback(snapshotId, name, coins, level) {
        const ok = await this.confirm(
            `Roll back ${name} to: ${this.fmtCoins(coins)} coins, Level ${level}?\n\nThis will overwrite their current stats. A new snapshot will be taken after the rollback.`,
            true
        );
        if (!ok) return;

        const res = await this.req('rollback_execute', 'POST', { snapshot_id: snapshotId, name });
        if (res.error) return this.toast(res.error, "error");

        this.toast(`${name} rolled back. Coins: ${this.fmtCoins(res.restored.coins)} ◎`);
        this.loadRollbackTimeline();
        this.loadLogs();
    },

    // ── WEBHOOK CONFIG ──
    async saveWebhook() {
        const url = document.getElementById('webhook-url').value.trim();
        if (!url) return this.toast("Enter a webhook URL.", "error");
        localStorage.setItem('brume_webhook', url);
        this.toast("Webhook URL saved locally.");
    },

    async testWebhook() {
        const url = document.getElementById('webhook-url').value.trim() || localStorage.getItem('brume_webhook');
        if (!url) return this.toast("Enter a webhook URL first.", "error");
        const res = await this.req('test_webhook', 'POST', { webhook_url: url });
        if (res.error) return this.toast("Webhook failed: " + res.error, "error");
        this.toast("Discord webhook test sent!");
    },

    // Poll alert count every 60s when logged in
    startAlertPolling() {
        this.req('alerts_list').then(r => { if (!r.error) this.updateAlertBadge(r.unresolved_count || 0); });
        setInterval(() => {
            this.req('alerts_list').then(r => { if (!r.error) this.updateAlertBadge(r.unresolved_count || 0); });
        }, 60000);
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
        if (viewId === 'logs') app.loadLogs();
        if (viewId === 'console') app.initConsole();
        if (viewId === 'analytics') app.loadAnalytics();
        if (viewId === 'staff') app.loadStaff();
        if (viewId === 'settings') app.renderSettingsUI();
        if (viewId === 'security') app.loadAlerts();
    };
};
