/**
 * GMAIL QUERY TOOL - SCRIPT
 * Manages OAuth flow and Gmail API searching / rendering.
 */

// ─── CONFIGURATION ───────────────────────────────────────────────────────────
const HARDCODED_CLIENT_ID = ''; // Optional
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
function getSavedClientId() { return localStorage.getItem(SK_CID) || ''; }
function getClientId() { return HARDCODED_CLIENT_ID || getSavedClientId(); }

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
    authBtn.style.display = 'none';
    document.getElementById('authConfigBtn').style.display = 'none';
    authText.className = 'auth-status connected';
    authText.textContent = '✓ Sesión Gmail activa';
    
    const card = document.getElementById('authCard');
    if (!card.querySelector('.disconnect')) {
        const btn = document.createElement('div');
        btn.className = 'disconnect';
        btn.textContent = 'Cerrar';
        btn.onclick = logout;
        card.appendChild(btn);
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
    
    const codeMatch = msg.snippet.match(/\b\d{5,6}\b/);
    const foundCode = codeMatch ? codeMatch[0] : null;
    const { content, isHtml } = extractBody(msg.payload);

    const item = document.createElement('div');
    item.className = 'email-item';
    
    let codeHtml = '';
    if (foundCode) {
        codeHtml = `
            <div class="code-box">
                <span class="code-value">${foundCode}</span>
                <span class="code-label">CÓDIGO</span>
                <button class="copy-mini" onclick="copyToClipboard('${foundCode}', 'Código copiado')">📋</button>
            </div>
        `;
    }

    item.innerHTML = `
        <div style="font-size:0.7rem; color:var(--text-muted); margin-bottom:4px; display:flex; justify-content:space-between; letter-spacing:0.02em;">
            <span style="font-weight:600; color:var(--text-dim);">${from.split('<')[0].trim() || from}</span>
            <span>${date}</span>
        </div>
        <div class="email-subject">${subject}</div>
        <div class="email-snippet">${msg.snippet}</div>
        ${codeHtml}
        
        <div id="body-container-${msg.id}" class="msg-body" style="background:#fff; padding:0; overflow:hidden;">
            ${isHtml ? 
                `<iframe id="iframe-${msg.id}" style="width:100%; border:none; background:#fff; min-height:400px; display:block;"></iframe>` : 
                `<div style="padding:14px; color:#000;">${formatBodyWithLinks(content)}</div>`
            }
        </div>

        <div class="email-meta">
            <button onclick="toggleBody('${msg.id}', this, ${isHtml})" class="btn-view">Ver mensaje completo</button>
        </div>
    `;
    resultsContainer.appendChild(item);

    // If it's HTML, we need to write to the iframe after it's in the DOM
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
                    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 15px; color: #333; line-height: 1.5; background: #fff; }
                    img { max-width: 100% !important; height: auto !important; display: block; margin: 15px auto; }
                    a { color: #6366f1; }
                    table { max-width: 100% !important; border-collapse: collapse; }
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

function toggleBody(id, btn, isHtml) {
    const el = document.getElementById('body-container-' + id);
    if (el.style.display === 'block') {
        el.style.display = 'none';
        btn.textContent = 'Ver mensaje completo';
    } else {
        el.style.display = 'block';
        btn.textContent = 'Ocultar';
        
        // Auto-adjust iframe height to show everything
        if (isHtml) {
            const iframe = document.getElementById('iframe-' + id);
            // Give it a moment to render images/styles before measuring
            setTimeout(() => {
                const innerBody = iframe.contentWindow.document.body;
                iframe.style.height = (innerBody.scrollHeight + 50) + 'px';
            }, 300);
        }
    }
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

// ─── OAUTH UI CONFIG ─────────────────────────────────────────────────────────

function toggleConfig() { banner.style.display = banner.style.display === 'none' ? 'block' : 'none'; }
function saveClientId() {
    const val = clientIdInput.value.trim();
    if (!val) return;
    localStorage.setItem(SK_CID, val);
    banner.style.display = 'none';
    showToast('Client ID actualizado', 'success');
    if (window.google) initTokenClient();
}
function clearClientId() {
    localStorage.removeItem(SK_CID);
    clientIdInput.value = '';
    showToast('Client ID eliminado', 'error');
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
