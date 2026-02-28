const ops = {
    key: "",

    async login() {
        const btn = document.getElementById('login-btn');
        const msg = document.getElementById('auth-msg');
        this.key = document.getElementById('root-key').value;
        
        btn.innerText = "Authenticating...";
        msg.innerText = "";
        
        try {
            const res = await this.req('stats');
            if (res.error) {
                msg.innerText = "Invalid Key";
                btn.innerText = "Enter Dashboard";
            } else {
                document.getElementById('auth-layer').style.display = 'none';
                document.getElementById('dashboard-layer').style.display = 'flex';
                this.renderStats(res);
            }
        } catch (e) {
            msg.innerText = "Connection Failed. Check Console.";
            btn.innerText = "Enter Dashboard";
        }
    },

    // --- API & TABS (Same as before) ---
    async req(mode, method = 'GET', body = null) {
        const opts = { method, headers: { 'Content-Type': 'application/json', 'x-brume-secret': this.key } };
        if (body) opts.body = JSON.stringify(body);
        return await fetch(`/api/ops?mode=${mode}`, opts).then(r => r.json());
    },
    
    tab(id) {
        document.querySelectorAll('.panel').forEach(e => e.classList.remove('active'));
        document.getElementById(`tab-${id}`).classList.add('active');
        document.querySelectorAll('nav button').forEach(e => e.classList.remove('active'));
        event.target.classList.add('active');
    },

    // --- STATS & PLAYER (Same as before) ---
    renderStats(data) { /* ... */ },
    async lookup() { /* ... */ },
    async savePlayer() { /* ... */ },

    // --- THE ITEM ARCHITECT ---
    generate() {
        // 1. Gather Data
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
            p1: val('gen-p1'), p2: val('gen-p2')
        };

        // 2. Generate Skript Code
        let code = `    if {_id} is "${d.id}":\n`;
        code += `        if {_key} is "name": return "${d.name}"\n`;
        code += `        if {_key} is "material": return ${d.mat}\n`;
        code += `        if {_key} is "version": return 1\n`;
        
        // Stats
        if(d.dmg) code += `        if {_key} is "damage": return ${d.dmg}\n`;
        if(d.str) code += `        if {_key} is "strength": return ${d.str}\n`;
        if(d.hp) code += `        if {_key} is "health": return ${d.hp}\n`;
        if(d.def) code += `        if {_key} is "defense": return ${d.def}\n`;
        if(d.spd) code += `        if {_key} is "speed": return ${d.spd}\n`;
        
        // Visuals
        code += `        if {_key} is "tier": return "${d.tier}"\n`;
        code += `        if {_key} is "type": return "${d.type}"\n`;
        code += `        if {_key} is "p_primary": return "${d.p1}"\n`;
        code += `        if {_key} is "p_secondary": return "${d.p2}"\n`;
        
        // Content
        if(d.ab_name) code += `        if {_key} is "ab_name": return "${d.ab_name}"\n`;
        if(d.ab_desc) code += `        if {_key} is "desc": return "${d.ab_desc}"\n`;
        if(d.flavor) code += `        if {_key} is "flavor": return "${d.flavor}"\n`;
        
        document.getElementById('gen-out').value = code;

        // 3. Update Preview
        this.updatePreview(d);
    },

    updatePreview(d) {
        const nameEl = document.getElementById('prev-name');
        const loreEl = document.getElementById('prev-lore');
        
        // Set Name
        nameEl.innerHTML = this.formatColors(d.name || "Item Name");
        
        // Build Lore HTML
        let html = "";
        
        // Stats
        if(d.dmg) html += `<div><span style="color:#aaa">Damage:</span> <span style="color:#ff5555">+${d.dmg}</span></div>`;
        if(d.str) html += `<div><span style="color:#aaa">Strength:</span> <span style="color:#ff5555">+${d.str}</span> <span style="color:#ffaa00">❁</span></div>`;
        if(d.hp) html += `<div><span style="color:#aaa">Health:</span> <span style="color:#ff5555">+${d.hp}</span> <span style="color:#ff5555">❤</span></div>`;
        if(d.def) html += `<div><span style="color:#aaa">Defense:</span> <span style="color:#55ff55">+${d.def}</span> <span style="color:#55ff55">🛡</span></div>`;
        if(d.spd) html += `<div><span style="color:#aaa">Speed:</span> <span style="color:#f1c40f">+${d.spd}</span> <span style="color:#55ffff">⚡</span></div>`;
        
        html += `<br>`;
        
        // Ability
        if(d.ab_name) {
            html += `<div><span style="color:#ffaa00">Ability: ${d.ab_name}</span> <span style="color:#aaa">RIGHT CLICK</span></div>`;
            const lines = d.ab_desc.split('|');
            lines.forEach(l => html += `<div style="color:#aaa">${this.formatColors(l)}</div>`);
            html += `<br>`;
        }
        
        // Flavor
        if(d.flavor) {
            html += `<div style="color:#555; font-style:italic;">${d.flavor}</div>`;
            html += `<br>`;
        }
        
        // Footer
        const p1 = this.hexToRgb(d.p1) || "255,255,255";
        const p2 = this.hexToRgb(d.p2) || "170,170,170";
        
        html += `<div style="font-weight:bold;">
            <span style="color:${d.p1}">${d.tier}</span> 
            <span style="color:${d.p2}">✦</span> 
            <span style="color:${d.p1}">${d.type}</span>
        </div>`;

        loreEl.innerHTML = html;
    },
    
    // Simple color parser for preview
    formatColors(text) {
        if(!text) return "";
        // Replace &c with span, Replace <#hex> with span
        text = text.replace(/&([0-9a-f])/g, '<span class="c-$1">');
        // Very basic Hex replacement for preview purposes
        text = text.replace(/<#(.*?)>/g, '<span style="color:#$1">');
        return text;
    },
    
    hexToRgb(hex) {
        // Basic check just to pass color to style
        return hex ? hex.replace('<', '').replace('>', '') : null;
    }
};

function val(id) { return document.getElementById(id).value; }
