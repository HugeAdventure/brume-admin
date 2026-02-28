const ops = {
    activeInput: null,
    key: "",
    colors:[
        { name: "Common", hex: "#FFFFFF" }, { name: "Uncommon", hex: "#55FF55" },
        { name: "Rare", hex: "#55FFFF" }, { name: "Epic", hex: "#9D4EDD" },
        { name: "Legendary", hex: "#FFAA00" }, { name: "Mythic", hex: "#FF55FF" },
        { name: "Divine", hex: "#AA0000" }, { name: "Fennel", hex: "#51559B" }
    ],

    init() {
        this.renderColorGrid();
        this.live();
    },

    async login() {
        const btn = document.getElementById('login-btn');
        const msg = document.getElementById('auth-msg');
        this.key = document.getElementById('root-key').value;
        
        btn.innerText = "Authenticating...";
        
        try {
            const res = await this.req('stats');
            if (res.error) {
                msg.innerText = "ACCESS DENIED";
                msg.style.color = "#ff5555";
                btn.innerText = "Authenticate";
            } else {
                document.getElementById('auth-layer').style.display = 'none';
                document.getElementById('dashboard-layer').style.display = 'flex';
                this.renderStats(res);
                this.live();
            }
        } catch (err) {
            msg.innerText = "API Offline (Test Mode Active)";
            msg.style.color = "#ffaa00";
            // UNCOMMENT TO BYPASS LOGIN FOR TESTING CSS:
            document.getElementById('auth-layer').style.display = 'none';
            document.getElementById('dashboard-layer').style.display = 'flex';
        }
    },

    async req(mode, method = 'GET', body = null) {
        const opts = { method, headers: { 'Content-Type': 'application/json', 'x-brume-secret': this.key } };
        if (body) opts.body = JSON.stringify(body);
        const response = await fetch(`/api/ops?mode=${mode}`, opts);
        if (!response.ok) throw new Error(`HTTP Error ${response.status}`);
        return await response.json();
    },

    tab(id) {
        document.querySelectorAll('.panel').forEach(e => e.classList.remove('active'));
        document.getElementById(`tab-${id}`).classList.add('active');
        document.querySelectorAll('nav button').forEach(e => e.classList.remove('active'));
        event.target.classList.add('active');
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

        this.updateSwatches(d);

        let c = `    if {_id} is "${d.id}":\n`;
        if(d.name) c += `        if {_key} is "name":\n            return "${this.injectColor(d.name, d.p1)}"\n`;
        if(d.mat) c += `        if {_key} is "material":\n            return ${d.mat}\n`;
        c += `        if {_key} is "version":\n            return 1\n`;

        const addStat = (k, v) => { if(v) c += `        if {_key} is "${k}":\n            return ${v}\n`; };
        addStat("damage", d.dmg); addStat("strength", d.str); addStat("health", d.hp);
        addStat("defense", d.def); addStat("speed", d.spd); addStat("mining_speed", d.mspd); addStat("mining_fortune", d.mfort);

        if(d.tier) c += `        if {_key} is "tier":\n            return "${d.tier}"\n`;
        if(d.type) c += `        if {_key} is "type":\n            return "${d.type}"\n`;
        c += `        if {_key} is "p_primary":\n            return "${d.p1}"\n`;
        c += `        if {_key} is "p_secondary":\n            return "${d.p2}"\n`;

        if(d.ab_name) c += `        if {_key} is "ab_name":\n            return "${d.ab_name}"\n`;
        if(d.ab_desc) c += `        if {_key} is "desc":\n            return "${d.ab_desc}"\n`;
        if(d.flavor) c += `        if {_key} is "flavor":\n            return "${d.flavor}"\n`;
        if(d.enchants) c += `        if {_key} is "enchants":\n            return true\n`;

        document.getElementById('gen-out').value = c;
        this.renderPreview(d);
    },

    updateSwatches(d) {
        setBg('swatch-name', d.p1); setBg('swatch-p1', d.p1); setBg('swatch-p2', d.p2); setBg('swatch-ab', "#FFAA00");
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

    // --- COLOR MODAL ---
    renderColorGrid() {
        document.getElementById('rarity-colors').innerHTML = this.colors.map(c => 
            `<div class="color-btn" style="background:${c.hex}" onclick="ops.pickPreset('${c.hex}')"></div>`
        ).join('');
    },
    openColor(inputId) {
        this.activeInput = document.getElementById(inputId);
        document.getElementById('color-modal').style.display = 'flex';
    },
    closeColor() { document.getElementById('color-modal').style.display = 'none'; },
    pickPreset(hex) { this.activeInput.value = `<${hex}>`; this.closeColor(); this.live(); },
    applyColor() { this.activeInput.value = document.getElementById('manual-hex').value; this.closeColor(); this.live(); },

    // --- DEV TOOLS ---
    tools: {
        grad() {
            const text = val('grad-text') || "Gradient";
            const c1 = ops.parseHex(val('grad-c1')) || "#55FFFF";
            const c2 = ops.parseHex(val('grad-c2')) || "#51559B";
            
            const prev = document.getElementById('grad-preview');
            prev.style.background = `linear-gradient(to right, ${c1}, ${c2})`;
            prev.style.webkitBackgroundClip = "text";
            prev.style.webkitTextFillColor = "transparent";
            prev.innerText = text;
            
            setBg('swatch-g1', c1); setBg('swatch-g2', c2);
            document.getElementById('grad-out').value = `<gradient:${c1}:${c2}>${text}</gradient>`;
        },
        xp() {
            const lvl = parseInt(val('math-lvl')) || 1;
            const def = parseInt(val('math-def')) || 0;
            const req = Math.round(40 * Math.pow(lvl + 1, 1.07));
            document.getElementById('out-req').innerText = req.toLocaleString() + " XP";
            document.getElementById('out-def').innerText = ((1 - (100 / (100 + def))) * 100).toFixed(1) + "%";
        },
        mm() {
            let t = val('mm-in').replace(/&([0-9a-f])/g, "<$1>").replace(/&l/g, "<bold>");
            document.getElementById('mm-out').value = t;
            document.getElementById('mm-preview').innerHTML = ops.formatColors(val('mm-in'));
        },
        snip(type) {
            document.getElementById('snip-out').value = type === 'gui' ? "GUI CODE" : "NBT CODE";
        }
    },

    // --- HELPERS ---
    injectColor(t, h) { return t.includes("<#") ? t : h + t; },
    parseHex(v) { return v ? v.replace(/[<>]/g, '') : "#ffffff"; },
    formatColors(t) { return t.replace(/<#(.*?)>/g, '</span><span style="color:#$1">').replace(/&([0-9a-f])/g, ''); },
    resetGen() { document.querySelectorAll('input').forEach(e=>e.value=''); this.live(); }
};

function val(id) { return document.getElementById(id).value; }
function setBg(id, val) { const el = document.getElementById(id); if(el) el.style.background = val; }

window.onload = () => ops.init();
