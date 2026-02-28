const ops = {
    key: "",
    activeInput: null, // Tracks which input opened the color picker

    // --- BRUME STANDARDS ---
    colors:[
        { name: "Common", hex: "#FFFFFF" },
        { name: "Uncommon", hex: "#55FF55" },
        { name: "Rare", hex: "#55FFFF" },
        { name: "Epic", hex: "#9D4EDD" },
        { name: "Legendary", hex: "#FFAA00" },
        { name: "Mythic", hex: "#FF55FF" },
        { name: "Divine", hex: "#AA0000" },
        { name: "Fennel", hex: "#51559B" }
    ],

    init() {
        this.renderColorGrid();
        this.live(); // Render initial preview
    },

    // ==========================================
    // AUTH & API SYSTEM
    // ==========================================
    async login() {
        const btn = document.getElementById('login-btn');
        const msg = document.getElementById('auth-msg');
        
        this.key = document.getElementById('root-key').value;
        btn.innerText = "Authenticating...";
        msg.innerText = "";
        
        try {
            // Test Key by fetching stats
            const res = await this.req('stats');
            
            if (res.error) {
                msg.innerText = "ACCESS DENIED: " + res.error;
                msg.style.color = "#ff5555";
                btn.innerText = "Enter Dashboard";
            } else {
                document.getElementById('auth-layer').style.display = 'none';
                document.getElementById('dashboard-layer').style.display = 'flex';
                this.renderStats(res);
            }
        } catch (err) {
            console.error(err);
            msg.innerText = "Connection Failed. Check Console (F12).";
            msg.style.color = "#ffaa00";
            btn.innerText = "Enter Dashboard";
        }
    },

    async req(mode, method = 'GET', body = null) {
        const opts = {
            method: method,
            headers: { 'Content-Type': 'application/json', 'x-brume-secret': this.key }
        };
        if (body) opts.body = JSON.stringify(body);
        
        const response = await fetch(`/api/ops?mode=${mode}`, opts);
        
        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Server Error ${response.status}: ${text}`);
        }
        return await response.json();
    },

    // ==========================================
    // UI NAVIGATION
    // ==========================================
    tab(id) {
        document.querySelectorAll('.panel').forEach(e => e.classList.remove('active'));
        document.getElementById(`tab-${id}`).classList.add('active');
        document.querySelectorAll('nav button').forEach(e => e.classList.remove('active'));
        event.target.classList.add('active');
    },

    // ==========================================
    // DASHBOARD & PLAYER EDITOR
    // ==========================================
    renderStats(data) {
        document.getElementById('stat-users').innerText = data.user_count || 0;
        document.getElementById('stat-eco').innerText = (data.total_economy || 0).toLocaleString();
        document.getElementById('stat-rich').innerText = data.top_player || "None";
    },

    async lookup() {
        const q = document.getElementById('p-search').value;
        if (!q) return;
        
        try {
            const res = await this.req('lookup', 'POST', { query: q });
            
            if (res.error) {
                alert("USER_NOT_FOUND");
            } else {
                document.getElementById('p-editor').style.display = 'block';
                document.getElementById('val-uuid').innerText = res.uuid;
                document.getElementById('val-name').innerText = res.name;
                document.getElementById('inp-coins').value = res.coins;
                document.getElementById('inp-level').value = res.level;
            }
        } catch(e) {
            alert("Lookup failed: " + e.message);
        }
    },

    async savePlayer() {
        const body = {
            uuid: document.getElementById('val-uuid').innerText,
            coins: document.getElementById('inp-coins').value,
            level: document.getElementById('inp-level').value
        };
        try {
            const res = await this.req('update', 'POST', body);
            if (res.success) alert("DATABASE_UPDATE :: SUCCESS\nPlayer will sync on next join.");
        } catch(e) {
            alert("Save failed: " + e.message);
        }
    },

    // ==========================================
    // COLOR STUDIO
    // ==========================================
    renderColorGrid() {
        const grid = document.getElementById('rarity-colors');
        grid.innerHTML = this.colors.map(c => 
            `<div class="color-btn" style="background:${c.hex}" data-name="${c.name}" onclick="ops.pickPreset('${c.hex}')"></div>`
        ).join('');
    },

    openColor(inputId) {
        this.activeInput = document.getElementById(inputId);
        document.getElementById('color-modal').style.display = 'flex';
        // Pre-fill modal with current input value
        const current = this.activeInput.value;
        if(current.startsWith('<#')) {
            document.getElementById('manual-hex').value = current;
            document.getElementById('native-picker').value = current.replace('<', '').replace('>', '');
        }
    },

    closeColor() { document.getElementById('color-modal').style.display = 'none'; },

    pickPreset(hex) {
        this.setInputColor(`<${hex}>`);
        this.closeColor();
    },

    pickNative(hex) {
        document.getElementById('manual-hex').value = `<${hex.toUpperCase()}>`;
    },

    applyColor() {
        this.setInputColor(document.getElementById('manual-hex').value);
        this.closeColor();
    },

    setInputColor(val) {
        if (this.activeInput) {
            this.activeInput.value = val;
            this.live(); // Update preview instantly
        }
    },

    // --- DEV TOOLS TAB SPECIFIC ---
    updateToolHex(val) {
        const hex = "<#" + val.toUpperCase().substring(1) + ">";
        document.getElementById('tool-hex').value = hex;
        document.getElementById('tool-preview').style.background = val;
    },
    
    copyToolHex() {
        const val = document.getElementById('tool-hex').value;
        navigator.clipboard.writeText(val);
        alert("Copied: " + val);
    },

    // ==========================================
    // THE "LIVE" ITEM GENERATOR
    // ==========================================
    resetGen() {
        document.querySelectorAll('.architect-form input, .architect-form textarea').forEach(el => {
            if(el.type !== 'checkbox' && el.id !== 'gen-p1' && el.id !== 'gen-p2') el.value = '';
        });
        document.getElementById('gen-p1').value = "<#FFFFFF>";
        document.getElementById('gen-p2').value = "<#777777>";
        this.live();
    },

    live() {
        const d = {
            id: val('gen-id').toUpperCase(),
            mat: val('gen-mat'),
            name: val('gen-name'),
            tier: val('gen-tier'),
            type: val('gen-type'),
            dmg: val('gen-dmg'), str: val('gen-str'), crit: val('gen-crit'),
            hp: val('gen-hp'), def: val('gen-def'), spd: val('gen-spd'),
            mspd: val('gen-mspd'), mfort: val('gen-mfort'),
            ab_name: val('gen-ab-name'),
            ab_desc: val('gen-ab-desc'),
            flavor: val('gen-flavor'),
            p1: val('gen-p1'), p2: val('gen-p2'),
            enchants: document.getElementById('gen-enchants').checked
        };

        this.updateSwatches(d);

        // 1. GENERATE SKRIPT CODE (FIXED FORMATTING)
        let c = `    if {_id} is "${d.id}":\n`;
        c += `        if {_key} is "name":\n            return "${this.injectColor(d.name, d.p1)}"\n`;
        c += `        if {_key} is "material":\n            return ${d.mat || "stone"}\n`;
        c += `        if {_key} is "version":\n            return 1\n`;

        // Helper for one-line returns
        const addStat = (key, val) => {
            if(val) c += `        if {_key} is "${key}":\n            return ${val}\n`;
        };

        addStat("damage", d.dmg);
        addStat("strength", d.str);
        addStat("health", d.hp);
        addStat("defense", d.def);
        addStat("speed", d.spd);
        addStat("mining_speed", d.mspd);
        addStat("mining_fortune", d.mfort);

        c += `        if {_key} is "tier":\n            return "${d.tier}"\n`;
        c += `        if {_key} is "type":\n            return "${d.type}"\n`;
        c += `        if {_key} is "p_primary":\n            return "${d.p1}"\n`;
        c += `        if {_key} is "p_secondary":\n            return "${d.p2}"\n`;

        if(d.ab_name) c += `        if {_key} is "ab_name":\n            return "${d.ab_name}"\n`;
        if(d.ab_desc) c += `        if {_key} is "desc":\n            return "${d.ab_desc}"\n`;
        if(d.flavor) c += `        if {_key} is "flavor":\n            return "${d.flavor}"\n`;
        if(d.enchants) c += `        if {_key} is "enchants":\n            return true\n`;

        document.getElementById('gen-out').value = c;

        // 2. UPDATE PREVIEW HTML
        this.renderPreview(d);
    },

    updateSwatches(d) {
        document.getElementById('swatch-name').style.background = this.parseHex(d.p1);
        document.getElementById('swatch-p1').style.background = this.parseHex(d.p1);
        document.getElementById('swatch-p2').style.background = this.parseHex(d.p2);
        document.getElementById('swatch-ab').style.background = "#FFAA00"; 
    },

    renderPreview(d) {
        const lore = document.getElementById('prev-lore');
        const name = document.getElementById('prev-name');
        
        const col1 = this.parseHex(d.p1);
        const col2 = this.parseHex(d.p2);
        
        name.innerHTML = `<span style="color:${col1}">${d.name || "Unknown Item"}</span>`;
        
        let h = "";
        
        if(d.dmg) h += `<div><span style="color:#aaa">Damage:</span> <span style="color:#ff5555">+${d.dmg}</span></div>`;
        if(d.str) h += `<div><span style="color:#aaa">Strength:</span> <span style="color:#ffaa00">+${d.str} ❁</span></div>`;
        if(d.hp) h += `<div><span style="color:#aaa">Health:</span> <span style="color:#ff5555">+${d.hp} ❤</span></div>`;
        if(d.def) h += `<div><span style="color:#aaa">Defense:</span> <span style="color:#55ff55">+${d.def} 🛡</span></div>`;
        if(d.spd) h += `<div><span style="color:#aaa">Speed:</span> <span style="color:${col1}">+${d.spd} ⚡</span></div>`;
        if(d.mspd) h += `<div><span style="color:#aaa">Mining Speed:</span> <span style="color:#ffffff">+${d.mspd} ⛏</span></div>`;
        
        h += `<br>`;
        
        if(d.ab_name) {
            h += `<div><span style="color:#ffaa00">Ability: <span style="color:${col1}; font-weight:bold;">${d.ab_name}</span></span> <span style="color:#aaa">RIGHT CLICK</span></div>`;
            d.ab_desc.split('|').forEach(l => h += `<div style="color:#aaa">${this.formatColors(l)}</div>`);
            h += `<br>`;
        }
        
        if(d.enchants) {
            h += `<div><span style="color:#aaa">Enchantments:</span></div>`;
            h += `<div><span style="color:#555">[ </span><span style="color:#aaa">Empty Enchantment Slot</span><span style="color:#555"> ]</span></div>`;
            h += `<div><span style="color:#555">[ </span><span style="color:#aaa">Empty Enchantment Slot</span><span style="color:#555"> ]</span></div>`;
            h += `<br>`;
        }
        
        if(d.flavor) {
            d.flavor.split('|').forEach(l => h += `<div style="color:#555; font-style:italic;">${l}</div>`);
            h += `<br>`;
        }
        
        h += `<div style="font-weight:bold;">
            <span style="color:${col1}">${d.tier}</span> <span style="color:${col2}">✦</span> <span style="color:${col1}">${d.type}</span>
        </div>`;
        
        lore.innerHTML = h;
    },
    
    // ==========================================
    // UTILITIES
    // ==========================================
    injectColor(text, hex) {
        if(!text) return "";
        if(text.includes("<#")) return text;
        return hex + text;
    },
    
    parseHex(val) {
        if(!val) return "#ffffff";
        return val.replace('<', '').replace('>', '');
    },

    formatColors(t) {
        if(!t) return "";
        const codes = {
            '0': '#000000', '1': '#0000AA', '2': '#00AA00', '3': '#00AAAA',
            '4': '#AA0000', '5': '#AA00AA', '6': '#FFAA00', '7': '#AAAAAA',
            '8': '#555555', '9': '#5555FF', 'a': '#55FF55', 'b': '#55FFFF',
            'c': '#FF5555', 'd': '#FF55FF', 'e': '#FFFF55', 'f': '#FFFFFF'
        };

        t = t.replace(/<#(.*?)>/g, (match, hex) => `</span><span style="color:#${hex}">`);
        t = t.replace(/&([0-9a-f])/g, (match, code) => `</span><span style="color:${codes[code]}">`);
        t = t.replace(/&l/g, '</span><span style="font-weight:bold; color:inherit">');
        t = t.replace(/&o/g, '</span><span style="font-style:italic; color:inherit">');
        
        return '<span>' + t + '</span>';
    }
};

function val(id) { return document.getElementById(id).value; }

// Initialize when the page loads
window.onload = () => ops.init();
