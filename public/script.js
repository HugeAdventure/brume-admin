const ops = {
    key: "",
    activeInput: null,
    library: JSON.parse(localStorage.getItem('brume_lib')) || [],

    colors:[
        { name: "Common", hex: "#FFFFFF" }, { name: "Uncommon", hex: "#55FF55" },
        { name: "Rare", hex: "#55FFFF" }, { name: "Epic", hex: "#9D4EDD" },
        { name: "Legendary", hex: "#FFAA00" }, { name: "Mythic", hex: "#FF55FF" },
        { name: "Exclusive", hex: "#FFD700" }, { name: "Fennel", hex: "#51559B" }
    ],

    init() {
        this.renderColorGrid();
        this.renderLibrary();
        // Dashboard is hidden, Auth is visible by default.
    },

    // --- AUTH ---
    async login() {
        this.key = document.getElementById('root-key').value;
        const btn = document.getElementById('login-btn');
        btn.innerText = "Authenticating...";
        
        try {
            // Bypass API for local UI testing if needed by uncommenting:
            // return this.unlockUI();
            
            const res = await this.req('stats');
            if (res.error) throw new Error("Invalid Key");
            
            this.unlockUI();
            document.getElementById('stat-users').innerText = res.user_count || 0;
            document.getElementById('stat-eco').innerText = (res.total_economy || 0).toLocaleString();
            
        } catch (e) {
            document.getElementById('auth-msg').innerText = "ACCESS DENIED";
            document.getElementById('auth-msg').style.color = "var(--danger)";
            btn.innerText = "Authenticate";
        }
    },

    unlockUI() {
        document.getElementById('auth-layer').style.display = 'none';
        document.getElementById('dashboard-layer').style.display = 'flex';
        this.navigate('generator');
        this.live();
        this.toast("Session Authenticated");
    },

    async req(mode, method = 'GET', body = null) {
        const opts = { method, headers: { 'Content-Type': 'application/json', 'x-brume-secret': this.key } };
        if (body) opts.body = JSON.stringify(body);
        return await fetch(`/api/ops?mode=${mode}`, opts).then(r => r.json());
    },

    // --- NAVIGATION ---
    navigate(viewId) {
        document.querySelectorAll('.view-page').forEach(e => e.classList.remove('active'));
        document.getElementById(`view-${viewId}`).classList.add('active');
        document.querySelectorAll('.nav-link').forEach(e => e.classList.remove('active'));
        event.target.classList.add('active');
    },

    // --- TOASTS ---
    toast(msg, type = "success") {
        const c = document.getElementById('toast-container');
        const el = document.createElement('div');
        el.className = `toast ${type}`;
        el.innerText = msg;
        c.appendChild(el);
        setTimeout(() => { el.style.opacity = 0; setTimeout(() => el.remove(), 300); }, 3000);
    },

    // --- ARCHITECT ENGINE ---
    live() {
        if(!document.getElementById('gen-id')) return;

        const d = {
            id: val('gen-id').toUpperCase(), mat: val('gen-mat'), name: val('gen-name'),
            tier: val('gen-tier'), type: val('gen-type'),
            dmg: val('gen-dmg'), str: val('gen-str'), crit: val('gen-crit'),
            hp: val('gen-hp'), def: val('gen-def'), spd: val('gen-spd'),
            mspd: val('gen-mspd'), mfort: val('gen-mfort'),
            ab_name: val('gen-ab-name'), ab_desc: val('gen-ab-desc'), flavor: val('gen-flavor'),
            p1: val('gen-p1') || "<#FFFFFF>", p2: val('gen-p2') || "<#AAAAAA>",
            enchants: document.getElementById('gen-enchants').checked
        };

        // Update Swatches
        setBg('swatch-name', d.p1); setBg('swatch-p1', d.p1); setBg('swatch-p2', d.p2); setBg('swatch-ab', "#FFAA00");

        // Generate Strict Skript Code
        let c = `    if {_id} is "${d.id}":\n`;
        if(d.name) c += `        if {_key} is "name": return "${this.injectColor(d.name, d.p1)}"\n`;
        if(d.mat) c += `        if {_key} is "material": return ${d.mat}\n`;
        c += `        if {_key} is "version": return 1\n`;

        const addS = (k, v) => { if(v) c += `        if {_key} is "${k}": return ${v}\n`; };
        addS("damage", d.dmg); addS("strength", d.str); addS("health", d.hp);
        addS("defense", d.def); addS("speed", d.spd); addS("mining_speed", d.mspd); addS("mining_fortune", d.mfort);

        if(d.tier) c += `        if {_key} is "tier": return "${d.tier}"\n`;
        if(d.type) c += `        if {_key} is "type": return "${d.type}"\n`;
        if(d.p1) c += `        if {_key} is "p_primary": return "${d.p1}"\n`;
        if(d.p2) c += `        if {_key} is "p_secondary": return "${d.p2}"\n`;

        if(d.ab_name) c += `        if {_key} is "ab_name": return "${d.ab_name}"\n`;
        if(d.ab_desc) c += `        if {_key} is "desc": return "${d.ab_desc}"\n`;
        if(d.flavor) c += `        if {_key} is "flavor": return "${d.flavor}"\n`;
        if(d.enchants) c += `        if {_key} is "enchants": return true\n`;

        document.getElementById('gen-out').value = c;
        this.renderPreview(d);
    },

    renderPreview(d) {
        const lore = document.getElementById('prev-lore');
        const name = document.getElementById('prev-name');
        const c1 = this.parseHex(d.p1); const c2 = this.parseHex(d.p2);
        
        name.innerHTML = `<span style="color:${c1}">${d.name || "Item Name"}</span>`;
        let h = "";
        
        const stat = (l, v, c, i) => v ? `<div><span style="color:#aaa">${l}:</span> <span style="color:${c}">+${v}</span> <span style="color:${c}">${i}</span></div>` : "";
        h += stat("Damage", d.dmg, "#ff5555", "🗡"); h += stat("Strength", d.str, "#ffaa00", "❁");
        h += stat("Health", d.hp, "#ff5555", "❤"); h += stat("Defense", d.def, "#55ff55", "🛡");
        h += stat("Speed", d.spd, c1, "⚡"); h += stat("Mining Spd", d.mspd, "#3ab0ff", "⛏");
        
        if(d.dmg || d.str || d.hp || d.def || d.spd || d.mspd) h += "<br>";

        if(d.ab_name) {
            h += `<div><span style="color:#ffaa00">Ability: <span style="color:${c1}; font-weight:bold;">${d.ab_name}</span></span> <span style="color:#aaa">RIGHT CLICK</span></div>`;
            d.ab_desc.split('|').forEach(l => h += `<div style="color:#aaa">${this.formatColors(l)}</div>`);
            h += `<br>`;
        }
        
        if(d.enchants) h += `<div><span style="color:#aaa">Enchantments:</span></div><div><span style="color:#555">[ </span><span style="color:#aaa">Empty Slot</span><span style="color:#555"> ]</span></div><br>`;
        if(d.flavor) h += `<div style="color:#555; font-style:italic;">${d.flavor}</div><br>`;
        
        h += `<div style="font-weight:bold;"><span style="color:${c1}">${d.tier}</span> <span style="color:${c2}">✦</span> <span style="color:${c1}">${d.type}</span></div>`;
        lore.innerHTML = h;
    },

    copyCode() {
        document.getElementById('gen-out').select();
        document.execCommand('copy');
        this.toast("Code Copied!");
    },
    resetGen() {
        document.querySelectorAll('.architect-form input, .architect-form textarea').forEach(el => {
            if(el.type !== 'checkbox') el.value = '';
        });
        document.getElementById('gen-p1').value = "<#FFFFFF>";
        document.getElementById('gen-p2').value = "<#777777>";
        this.live();
        this.toast("Form Cleared");
    },

    // --- LIBRARY SYSTEM ---
    saveToLibrary() {
        const id = val('gen-id').toUpperCase();
        if (!id) return this.toast("ID required to save!", "error");
        
        const data = {};
        document.querySelectorAll('.architect-form input, .architect-form select, .architect-form textarea').forEach(el => {
            if(el.type === 'checkbox') data[el.id] = el.checked;
            else data[el.id] = el.value;
        });

        const idx = this.library.findIndex(i => i['gen-id'] === id);
        if (idx > -1) this.library[idx] = data; else this.library.push(data);
        
        localStorage.setItem('brume_lib', JSON.stringify(this.library));
        this.renderLibrary();
        this.toast(`Saved ${id}`);
    },

    renderLibrary() {
        const div = document.getElementById('library-list');
        if(!div) return;
        div.innerHTML = this.library.map((item, i) => `
            <div class="lib-item" onclick="ops.loadFromLibrary(${i})">
                <div>
                    <strong style="color:${this.parseHex(item['gen-p1'])}">${item['gen-name'] || item['gen-id']}</strong><br>
                    <small style="color:var(--text-dim)">${item['gen-id']}</small>
                </div>
                <button class="lib-del" onclick="event.stopPropagation(); ops.delLibrary(${i})">×</button>
            </div>
        `).join('');
    },

    loadFromLibrary(idx) {
        const d = this.library[idx];
        Object.keys(d).forEach(k => {
            const el = document.getElementById(k);
            if(el) {
                if(el.type === 'checkbox') el.checked = d[k];
                else el.value = d[k];
            }
        });
        this.live();
        this.toast(`Loaded ${d['gen-id']}`);
    },

    delLibrary(idx) {
        this.library.splice(idx, 1);
        localStorage.setItem('brume_lib', JSON.stringify(this.library));
        this.renderLibrary();
        this.toast("Deleted from Library");
    },

    // --- COLOR MODAL ---
    renderColorGrid() {
        document.getElementById('rarity-colors').innerHTML = this.colors.map(c => 
            `<div class="color-btn" style="background:${c.hex}" onclick="ops.pickPreset('${c.hex}')" title="${c.name}"></div>`
        ).join('');
    },
    openColor(id) { this.activeInput = document.getElementById(id); document.getElementById('color-modal').style.display = 'flex'; },
    closeColor() { document.getElementById('color-modal').style.display = 'none'; },
    pickPreset(hex) { this.activeInput.value = `<${hex}>`; this.closeColor(); this.live(); },
    applyColor() { this.activeInput.value = document.getElementById('manual-hex').value; this.closeColor(); this.live(); },

    // --- DEV TOOLS (All restored) ---
    tools: {
        grad() {
            const txt = val('grad-text') || "Gradient";
            const c1 = ops.parseHex(val('grad-c1') || "<#55FFFF>");
            const c2 = ops.parseHex(val('grad-c2') || "<#51559B>");
            const prev = document.getElementById('grad-preview');
            prev.style.background = `linear-gradient(to right, ${c1}, ${c2})`;
            prev.style.webkitBackgroundClip = "text";
            prev.style.webkitTextFillColor = "transparent";
            prev.innerText = txt;
            document.getElementById('grad-out').value = `<gradient:${c1}:${c2}>${txt}</gradient>`;
        },
        xp() {
            const lvl = parseInt(val('math-lvl')) || 1;
            const def = parseInt(val('math-def')) || 0;
            const req = Math.round(40 * Math.pow(lvl + 1, 1.07));
            document.getElementById('out-req').innerText = req.toLocaleString() + " XP";
            let total = 0; for(let i=1; i<lvl; i++) total += Math.round(40 * Math.pow(i + 1, 1.07));
            document.getElementById('out-total').innerText = total.toLocaleString() + " XP";
            document.getElementById('out-def').innerText = ((1 - (100 / (100 + def))) * 100).toFixed(1) + "%";
        },
        mm() {
            let t = val('mm-in').replace(/&([0-9a-f])/g, "<$1>").replace(/&l/g, "<bold>").replace(/<#(.*?)>/g, "<#$1>");
            document.getElementById('mm-out').value = t;
            document.getElementById('mm-preview').innerHTML = ops.formatColors(val('mm-in'));
        },
        snip(type) {
            let c = "";
            if(type==='gui') c = `function openMenu(p: player):\n    set metadata tag "gui" of {_p} to chest inventory with 3 rows named "Menu"\n    open (metadata tag "gui" of {_p}) to {_p}`;
            if(type==='nbt') c = `set {_n} to custom nbt compound of player's tool\nset {_id} to string tag "id" of {_n}\nif {_id} is "ITEM":`;
            if(type==='loop') c = `loop all players:\n    if distance between loop-player and player < 5:\n        send "Close!" to loop-player`;
            if(type==='skull') c = `set {_h} to player head\nset string tag "SkullOwner;Name" of nbt compound of {_h} to "Notch"`;
            if(type==='packet') c = `import:\n    com.github.retrooper.packetevents.wrapper.play.server.WrapperPlayServerEntityAnimation`;
            if(type==='db') c = `run section async:\n    set {_conn} to DriverManager.getConnection({-sql::url}, {-sql::user}, {-sql::pass})\n    # ... logic\n    {_conn}.close()`;
            document.getElementById('snip-out').value = c;
            ops.toast("Snippet Generated");
        },
        simulateRNG() {
            const chance = parseInt(val('rng-chance'));
            const att = parseInt(val('rng-attempts'));
            const box = document.getElementById('rng-result');
            box.innerHTML = `> Simulating ${att.toLocaleString()} pulls at 1/${chance.toLocaleString()}<br>`;
            let drops = 0;
            for(let i=0; i<att; i++) { if(Math.random() < (1/chance)) drops++; }
            const prob = (1 - Math.pow((chance-1)/chance, att)) * 100;
            box.innerHTML += `> Result: <b style="color:var(--success)">${drops}</b> items dropped.<br>`;
            box.innerHTML += `> Probability of getting at least 1: <b>${prob.toFixed(2)}%</b>`;
            ops.toast("Simulation Complete");
        }
    },

    // --- HELPERS ---
    injectColor(t, h) { return t.includes("<#") ? t : h + t; },
    parseHex(v) { return v ? v.replace(/[<>]/g, '') : "#ffffff"; },
    formatColors(t) {
        if(!t) return "";
        const c = { 'c': '#FF5555', 'a': '#55FF55', 'b': '#55FFFF', 'e': '#FFFF55', 'f': '#FFFFFF', '7': '#AAAAAA', '8': '#555555' };
        t = t.replace(/<#(.*?)>/g, '</span><span style="color:#$1">');
        t = t.replace(/&([0-9a-f])/g, (m, x) => `</span><span style="color:${c[x]||'#fff'}">`);
        t = t.replace(/&l/g, '</span><span style="font-weight:bold; color:inherit">');
        return '<span>' + t + '</span>';
    }
};

function val(id) { const e = document.getElementById(id); return e ? e.value : ""; }
function setBg(id, v) { const e = document.getElementById(id); if(e) e.style.background = v ? v.replace(/[<>]/g, '') : "#fff"; }

window.onload = () => ops.init();
