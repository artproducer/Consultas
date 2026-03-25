/**
 * GMAIL QUERY TOOL - SCRIPT
 * Manages OAuth flow and Gmail API searching / rendering.
 */

// ─── CONFIGURATION ───────────────────────────────────────────────────────────
const HARDCODED_CLIENT_ID = '340536761168-1p62v96f8669d0qjcliaem6e00i98n4d.apps.googleusercontent.com'; // Pre-filled
const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const SK_CID = 'query_client_id';
const SK_ACCESS = 'query_access_token';
const SK_EXPIRY = 'query_token_expiry';

let accessToken = null;
let tokenClient = null;
let isSearching = false;

// DOM Cache
let resultsContainer, loader, submitBtn, filterInput, authBtn, authText, banner, clientIdInput;

// ─── AUTHENTICATION (GIS) ────────────────────────────────────────────────────
function getSavedClientId() { return localStorage.getItem(SK_CID) || HARDCODED_CLIENT_ID; }
function getClientId() { return getSavedClientId(); }

function initTokenClient() {
    const cid = getClientId();
    if (!cid || !window.google) return false;
    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: cid,
        scope: SCOPE,
        callback: handleTokenResponse,
        error_callback: (err) => showToast('Error Google: ' + (err.type || 'Error'), 'error')
    });
    return true;
}

function startAuth() {
    if (accessToken) return; // Prevent prompt if already connected
    const cid = getClientId();
    if (!cid) { toggleConfig(); return; }
    if (!tokenClient && !initTokenClient()) return;
    tokenClient.requestAccessToken({ prompt: 'consent' });
}

function handleTokenResponse(res) {
    if (res.error) { showToast('Error: ' + res.error, 'error'); return; }
    accessToken = res.access_token;
    localStorage.setItem(SK_ACCESS, accessToken);
    localStorage.setItem(SK_EXPIRY, Date.now() + (res.expires_in * 1000));
    onAuthed();
}

function onAuthed() {
    const card = document.getElementById('authCard');
    card.classList.add('connected');
    
    authText.textContent = 'Sesión Activa';
    
    // Clicking icon while authed toggles the menu (good for mobile)
    authBtn.onclick = (e) => {
        e.stopPropagation();
        authText.style.opacity = authText.style.opacity === '1' ? '0' : '1';
        authText.style.pointerEvents = authText.style.opacity === '1' ? 'auto' : 'none';
    };
    
    // Put Disconnect inside the status hover area
    if (!authText.querySelector('.disconnect-btn')) {
        const btn = document.createElement('button');
        btn.className = 'disconnect-btn';
        btn.textContent = 'Cerrar';
        btn.onclick = (e) => {
            e.stopPropagation();
            logout();
        };
        authText.appendChild(btn);
    }
}

function logout() {
    localStorage.removeItem(SK_ACCESS);
    localStorage.removeItem(SK_EXPIRY);
    accessToken = null;
    location.reload();
}

function isTokenValid() {
    const exp = parseInt(localStorage.getItem(SK_EXPIRY) || '0');
    return exp > Date.now();
}

// ─── SEARCH & RENDER ─────────────────────────────────────────────────────────

async function searchMails() {
    if (isSearching) return;
    
    // Ensure session
    if (!accessToken && isTokenValid()) {
        accessToken = localStorage.getItem(SK_ACCESS);
        onAuthed();
    }

    if (!accessToken) {
        showToast('Conecta con Google primero', 'error');
        startAuth();
        return;
    }

    const filter = filterInput.value.trim();
    if (!filter) return;

    setLoading(true);
    resultsContainer.innerHTML = '';

    try {
        const query = encodeURIComponent(`${filter}`);
        const listRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${query}&maxResults=10`, {
            headers: { 'Authorization': 'Bearer ' + accessToken }
        });

        if (listRes.status === 401) { logout(); throw new Error('Sesión expirada. Por favor reconecta.'); }
        if (!listRes.ok) throw new Error('Error buscando correos');

        const listData = await listRes.json();
        
        if (!listData.messages || listData.messages.length === 0) {
            resultsContainer.innerHTML = `
                <div style="text-align:center; padding:40px; border-radius:18px; border:1px dashed var(--border);">
                    <div style="font-size:0.9rem; font-weight:600; color:var(--text); margin-bottom:8px;">No se encontraron resultados</div>
                    <div style="font-size:0.75rem; color:var(--text-dim); line-height:1.4;">
                        No hay correos que coincidan con <strong>${filter}</strong>. Prueba con otro término.
                    </div>
                </div>`;
            return;
        }

        for (const msg of listData.messages) {
            const detailRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`, {
                headers: { 'Authorization': 'Bearer ' + accessToken }
            });
            const data = await detailRes.json();
            renderEmail(data);
        }

    } catch (err) {
        showToast(err.message, 'error');
    } finally {
        setLoading(false);
    }
}

function renderEmail(msg) {
    const headers = msg.payload.headers;
    const subject = headers.find(h => h.name.toLowerCase() === 'subject')?.value || '(Sin asunto)';
    const from = headers.find(h => h.name.toLowerCase() === 'from')?.value || '';
    const dateStr = headers.find(h => h.name.toLowerCase() === 'date')?.value || '';
    const date = new Date(dateStr).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
    
    const { content, isHtml } = extractBody(msg.payload);

    // Advanced Code Detection with DOM Parsing (Disney+, Netflix, etc.)
    let foundCode = null;
    let pureText = content;
    
    // Crucial: DOMParser completely ignores HTML attributes (like color="#000000")
    if (isHtml) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(content, 'text/html');
        pureText = doc.body.textContent || "";
    }
    
    const searchContext = `${subject} | ${msg.snippet} | ${pureText}`.replace(/\s+/g, ' ');

    const isInvalidCode = (c) => {
        if (/^(202[4-9]|2030)$/.test(c)) return true; // Common years
        if (/^(\d)\1+$/.test(c)) return true; // Kills '000000', '777777', etc.
        if (/^(91521|95032|1050)$/.test(c)) return true; // Disney/Netflix explicit zip/buildings
        return false;
    };

    // 1. Precise Proximity Match (Code AFTER keyword - up to 200 chars away)
    // ONLY looks for 6 to 8 digits (ignores 5-digit Zip codes like 91521 entirely)
    const afterRegex = /(?:código|code|confirmación|verific|acceso|passcode|security|único|pin).{0,200}?\b(\d{6,8})\b/i;
    const afterMatch = searchContext.match(afterRegex);
    if (afterMatch && !isInvalidCode(afterMatch[1])) {
        foundCode = afterMatch[1];
    }

    // 2. Precise Proximity Match (Code BEFORE keyword)
    if (!foundCode) {
        const beforeRegex = /\b(\d{6,8})\b.{0,60}?(?:código|code|confirmación|verific|es tu|is your)/i;
        const beforeMatch = searchContext.match(beforeRegex);
        if (beforeMatch && !isInvalidCode(beforeMatch[1])) {
            foundCode = beforeMatch[1];
        }
    }

    // 3. Fallback for spaced codes (Netflix: 1 2 3 4 5 6)
    if (!foundCode) {
        const spacedMatch = searchContext.match(/(?:código|code|confirmación|verific).{0,100}?\b((\d\s*){6,8})\b/i);
        if (spacedMatch) {
            const joined = spacedMatch[1].replace(/\s+/g, '');
            if (!isInvalidCode(joined)) foundCode = joined;
        }
    }

    // 4. Final Fallback: If email subject screams "code", grab the first valid 6-8 digit number
    if (!foundCode && /(código|code|verific|acceso|inicio|sesión|login)/i.test(subject)) {
        const allNums = searchContext.match(/\b\d{6,8}\b/g) || [];
        const valid = allNums.find(n => !isInvalidCode(n));
        if (valid) foundCode = valid;
    }

    // Smart Summary
    let displaySnippet = msg.snippet;
    const lowerSub = subject.toLowerCase();
    if (lowerSub.includes('hogar') || lowerSub.includes('viaje') || lowerSub.includes('dispositivo')) {
        const netflixMatch = content.match(/([A-Z][a-z]+) ha enviado una solicitud desde el dispositivo (.*?)(?= a las| \r|\n|$)/);
        if (netflixMatch) {
            displaySnippet = `<strong>${netflixMatch[1]}</strong> solicitó acceso desde <strong>${netflixMatch[2]}</strong>`;
        } else {
            const deviceMatch = content.match(/Dispositivo\s*[\r\n]+\s*(.*?)(?=[\r\n]|$)/i);
            if (deviceMatch) displaySnippet = `Nuevo acceso en: <strong>${deviceMatch[1]}</strong>`;
        }
    }

    const mainAction = findMainAction(content, isHtml);

    const item = document.createElement('div');
    item.className = 'email-item';
    item.onclick = (e) => {
        if (!e.target.closest('a') && !e.target.closest('.copy-mini')) {
            toggleBody(item);
        }
    };
    
    let highlightHtml = '';
    if (foundCode) {
        highlightHtml += `
            <div class="code-box">
                <span class="code-value">${foundCode}</span>
                <span class="code-label">CÓDIGO</span>
                <button class="copy-mini" onclick="copyToClipboard('${foundCode}', 'Código copiado')">Copiar</button>
            </div>
        `;
    }

    if (mainAction) {
        const isNetflixConfirm = mainAction.label === 'SÍ, LO SOLICITÉ YO';
        const btnColor = isNetflixConfirm ? '#e50914' : 'var(--green)';
        const btnShadow = isNetflixConfirm ? 'rgba(229,9,20,0.4)' : 'var(--green-glow)';

        highlightHtml += `
            <a href="${mainAction.url}" target="_blank" class="btn-submit" onclick="event.stopPropagation()" style="display:block; text-align:center; text-decoration:none; margin-top:10px; background:${btnColor}; font-size:0.8rem; padding:12px; border-radius:12px; border:1px solid rgba(255,255,255,0.1); box-shadow: 0 4px 15px ${btnShadow}; color: #000;">
                ${mainAction.label.toUpperCase()}
            </a>
        `;
    }

    item.innerHTML = `
        <div style="font-size:0.8rem; color:var(--text); margin-bottom:10px; display:flex; justify-content:space-between; align-items:center; pointer-events:none;">
            <span style="font-weight:700; color:var(--green); letter-spacing:0.01em;">${from.split('<')[0].trim() || from}</span>
            <span style="font-weight:600; background:rgba(255,255,255,0.06); padding:4px 10px; border-radius:10px; font-size:0.75rem; color:var(--text-dim);">${date}</span>
        </div>
        <div class="email-subject" style="pointer-events:none;">${subject}</div>
        
        <div class="card-summary">
            <div class="email-snippet" style="pointer-events:none;">${displaySnippet}</div>
            ${highlightHtml}
        </div>
        
        <div class="msg-body" style="display:none; transition: all 0.3s; margin-top:10px; background:#fff; border-radius:12px; overflow:hidden;">
            ${isHtml ? 
                `<iframe id="iframe-${msg.id}" style="width:100%; border:none; background:#fff; min-height:500px; display:block;"></iframe>` : 
                `<div style="padding:16px; color:#333; background:#fff;">${formatBodyWithLinks(content)}</div>`
            }
        </div>
        <div class="card-indicator">▼</div>
    `;

    resultsContainer.appendChild(item);

    if (isHtml) {
        const iframe = document.getElementById('iframe-' + msg.id);
        const doc = iframe.contentWindow.document;
        doc.open();
        doc.write(`
            <!DOCTYPE html>
            <html>
            <head>
                <base target="_blank">
                <style>
                    body { font-family: sans-serif; margin: 15px; color: #333; line-height: 1.5; background: #fff; }
                    img { max-width: 100% !important; height: auto !important; }
                    a { color: #128c7e; }
                </style>
            </head>
            <body>${content}</body>
            </html>
        `);
        doc.close();
    }
}

// ─── UTILS ───────────────────────────────────────────────────────────────────

function extractBody(payload) {
    // Collect all parts
    let htmlPart = null;
    let plainPart = null;

    function findParts(p) {
        if (p.mimeType === 'text/html') htmlPart = p.body.data;
        if (p.mimeType === 'text/plain') plainPart = p.body.data;
        if (p.parts) p.parts.forEach(findParts);
    }
    
    findParts(payload);

    if (htmlPart) return { content: decodeB64(htmlPart), isHtml: true };
    if (plainPart) return { content: decodeB64(plainPart), isHtml: false };
    
    return { content: 'Cuerpo del mensaje no disponible.', isHtml: false };
}

function decodeB64(str) {
    try {
        const raw = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
        const bytes = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
        return new TextDecoder().decode(bytes);
    } catch (e) { return 'Error de decodificación.'; }
}

function formatBodyWithLinks(text) {
    const urlPattern = /(https?:\/\/[^\s]+)/g;
    return text.replace(urlPattern, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
}

function toggleBody(item) {
    const body = item.querySelector('.msg-body');
    const summary = item.querySelector('.card-summary');
    const indicator = item.querySelector('.card-indicator');
    
    const isExpanded = body.style.display === 'block';

    if (isExpanded) {
        body.style.display = 'none';
        summary.style.display = 'block';
        indicator.style.transform = 'rotate(0deg)';
    } else {
        body.style.display = 'block';
        summary.style.display = 'none';
        indicator.style.transform = 'rotate(180deg)';
    }
}

// Manual extractor based on keywords
function findMainAction(content, isHtml) {
    const rules = [
        { label: 'SÍ, LO SOLICITÉ YO', regex: /sí, lo solicité yo|sí, he sido yo|confirmar solicitud/i },
        { label: 'CAMBIAR CONTRASEÑA', regex: /cambi.* contraseña|change password|reset password/i },
        { label: 'GESTIONAR HOGAR', regex: /administrar hogar|configurar hogar|manage household|gestion de hogar/i },
        { label: 'GESTIONAR ACCESO', regex: /gestionar el acceso|comprueba qué dispositivos|manage access/i },
        { label: 'VERIFICAR CUENTA', regex: /verificar cuenta|confirmar correo|verify account|confirm email/i },
        { label: 'REESTABLECER', regex: /restablecer|recuperar|reset|recover/i }
    ];

    if (isHtml) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(content, 'text/html');
        const links = Array.from(doc.querySelectorAll('a'));
        
        for (const rule of rules) {
            // Priority: link text or title matches rule
            const match = links.find(l => rule.regex.test(l.innerText) || rule.regex.test(l.title));
            if (match && match.href.startsWith('http')) {
                return { label: rule.label, url: match.href };
            }
        }
    } else {
        const lines = content.split('\n');
        for (const rule of rules) {
            const lineIdx = lines.findIndex(l => rule.regex.test(l));
            if (lineIdx !== -1) {
                for (let i = lineIdx; i < Math.min(lineIdx + 6, lines.length); i++) {
                    const linkMatch = lines[i].match(/(https?:\/\/[^\s]+)/);
                    if (linkMatch) return { label: rule.label, url: linkMatch[0] };
                }
            }
        }
    }
    return null;
}

function copyToClipboard(text, successMsg) {
    navigator.clipboard.writeText(text)
        .then(() => showToast(successMsg, 'success'))
        .catch(() => showToast('Error al copiar', 'error'));
}

function setLoading(on) {
    isSearching = on;
    loader.style.display = on ? 'flex' : 'none';
    submitBtn.disabled = on;
    submitBtn.textContent = on ? 'Buscando...' : 'Buscar Correos';
}

function showToast(text, type = 'error') {
    const t = document.getElementById('toast');
    t.textContent = text;
    t.className = `show ${type}`;
    setTimeout(() => t.classList.remove('show'), 3500);
}

function saveConfigs() {
    const cid = clientIdInput.value.trim();
    if (cid) localStorage.setItem(SK_CID, cid);
    banner.style.display = 'none';
    showToast('Configuracion guardada', 'success');
    if (window.google) initTokenClient();
}

function clearConfigs() {
    localStorage.removeItem(SK_CID);
    clientIdInput.value = '';
    showToast('Configuración eliminada', 'error');
}

// ─── INITIALIZATION ──────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    // Cache DOM
    resultsContainer = document.getElementById('resultsContainer');
    loader = document.getElementById('loader');
    submitBtn = document.getElementById('submitBtn');
    filterInput = document.getElementById('filterEmail');
    authBtn = document.getElementById('authBtn');
    authText = document.getElementById('authStatus');
    banner = document.getElementById('config-banner');
    clientIdInput = document.getElementById('clientIdInput');

    document.getElementById('showOrigin').textContent = location.origin;
    clientIdInput.value = getSavedClientId();
    
    // Check local session
    if (isTokenValid()) {
        accessToken = localStorage.getItem(SK_ACCESS);
        onAuthed();
    }
    
    // Load GIS
    if (window.google) initTokenClient();
});

// Helper for UI paste
window.pasteFromClipboard = function() {
    navigator.clipboard.readText().then(text => {
        const clean = text.trim();
        if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) {
            filterInput.value = clean;
            showToast('Correo pegado', 'success');
        } else {
            showToast('No es un correo válido', 'error');
        }
    }).catch(() => showToast('Permiso denegado', 'error'));
};
