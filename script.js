/**
 * GMAIL QUERY TOOL - SCRIPT
 * Manages OAuth flow and Gmail API searching / rendering.
 */

// ─── CONFIGURATION ───────────────────────────────────────────────────────────
const HARDCODED_CLIENT_ID = '340536761168-1p62v96f8669d0qjcliaem6e00i98n4d.apps.googleusercontent.com'; // Pre-filled
const HARDCODED_GEMINI_KEY = 'AIzaSyBdVA8AidC-c8Xk0JRZz_q0d1hUJa-Sxdc'; // Pre-filled as requested
const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const SK_CID = 'query_client_id';
const SK_GEMINI = 'query_gemini_key';
const SK_ACCESS = 'query_access_token';
const SK_EXPIRY = 'query_token_expiry';

let accessToken = null;
let tokenClient = null;
let isSearching = false;

// DOM Cache
let resultsContainer, loader, submitBtn, filterInput, authBtn, authText, banner, clientIdInput, geminiKeyInput;

// ─── AUTHENTICATION (GIS) ────────────────────────────────────────────────────
function getSavedClientId() { return localStorage.getItem(SK_CID) || HARDCODED_CLIENT_ID; }
function getSavedGeminiKey() { return localStorage.getItem(SK_GEMINI) || HARDCODED_GEMINI_KEY; }
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
            await renderEmail(data);
        }

    } catch (err) {
        showToast(err.message, 'error');
    } finally {
        setLoading(false);
    }
}

async function renderEmail(msg) {
    const headers = msg.payload.headers;
    const subject = headers.find(h => h.name.toLowerCase() === 'subject')?.value || '(Sin asunto)';
    const from = headers.find(h => h.name.toLowerCase() === 'from')?.value || '';
    const dateStr = headers.find(h => h.name.toLowerCase() === 'date')?.value || '';
    const date = new Date(dateStr).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
    
    const { content, isHtml } = extractBody(msg.payload);
    
    // Detect code (5-6 digits)
    const codeMatch = msg.snippet.match(/\b\d{5,6}\b/);
    const foundCode = codeMatch ? codeMatch[0] : null;

    // Detect Main Action (Local Fallback)
    let mainAction = findMainAction(content, isHtml);
    
    // AI Intelligent Extraction if key is present
    const gKey = getSavedGeminiKey();
    if (gKey) {
        const aiAction = await analyzeWithGemini(msg.snippet, content, gKey);
        if (aiAction) mainAction = aiAction;
    }

    const item = document.createElement('div');
    item.className = 'email-item';
    item.onclick = (e) => {
        // Only toggle if we didn't click a button or link
        if (!e.target.closest('button') && !e.target.closest('a')) {
            const btn = item.querySelector('.toggle-control');
            toggleBody(msg.id, btn, isHtml);
        }
    };
    
    let highlightHtml = '';
    
    // 1. Show Code if found
    if (foundCode) {
        highlightHtml += `
            <div class="code-box">
                <span class="code-value">${foundCode}</span>
                <span class="code-label">CÓDIGO</span>
                <button class="copy-mini" onclick="copyToClipboard('${foundCode}', 'Código copiado')">Copiar</button>
            </div>
        `;
    }

    // 2. Show Main Action button if found
    if (mainAction) {
        highlightHtml += `
            <a href="${mainAction.url}" target="_blank" class="btn-submit" onclick="event.stopPropagation()" style="display:block; text-align:center; text-decoration:none; margin-top:10px; background:var(--green); font-size:0.8rem; padding:12px; border-radius:12px; border:1px solid rgba(255,255,255,0.1); box-shadow: 0 4px 15px var(--green-glow);">
                ${mainAction.label.toUpperCase()}
            </a>
        `;
    }

    item.innerHTML = `
        <div style="font-size:0.7rem; color:var(--text-muted); margin-bottom:4px; display:flex; justify-content:space-between; letter-spacing:0.02em; pointer-events:none;">
            <span style="font-weight:600; color:var(--text-dim);">${from.split('<')[0].trim() || from}</span>
            <span>${date}</span>
        </div>
        <div class="email-subject" style="pointer-events:none;">${subject}</div>
        <div class="email-snippet" style="pointer-events:none;">${msg.snippet}</div>
        
        ${highlightHtml}
        
        <div class="email-meta" style="margin-top:12px;">
            <button onclick="event.stopPropagation(); toggleBody('${msg.id}', this, ${isHtml})" class="btn-view toggle-control" style="width:100%; border:1px solid var(--border); border-radius:10px; padding:10px; background:rgba(255,255,255,0.02); font-size:0.8rem; font-weight:600; pointer-events:auto;">Ver contenido completo</button>
        </div>

        <div id="body-container-${msg.id}" class="msg-body" style="background:#fff; padding:0; overflow:hidden; border-radius:12px; margin-top:12px;">
            ${isHtml ? 
                `<iframe id="iframe-${msg.id}" style="width:100%; border:none; background:#fff; min-height:400px; display:block;"></iframe>` : 
                `<div style="padding:16px; color:#333; background:#fff;">${formatBodyWithLinks(content)}</div>`
            }
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
        btn.textContent = 'Ver contenido completo';
    } else {
        el.style.display = 'block';
        btn.textContent = 'Ocultar contenido';
        
        // Auto-adjust iframe height to show everything
        if (isHtml) {
            const iframe = document.getElementById('iframe-' + id);
            setTimeout(() => {
                const innerBody = iframe.contentWindow.document.body;
                iframe.style.height = (innerBody.scrollHeight + 50) + 'px';
            }, 300);
        }
    }
}

// Intelligent extractor with Gemini AI
async function analyzeWithGemini(snippet, content, key) {
    try {
        const prompt = `Analiza este correo (probablemente de una plataforma de streaming o seguridad) y extrae la ACCIÓN MÁS IMPORTANTE (link y etiqueta corta).
        
        CONTEXTO: 
        - Si es Netflix/Disney/HBO y habla de "Nuevo dispositivo" o "Hogar", busca el botón de "Gestionar Hogar" o "Cambiar Contraseña".
        - Si el correo sugiere "Cambiar contraseña de inmediato" por seguridad, extrae ESE link.
        - Si es un código de verificación, busca el botón de "Verificar".
        
        Email Snippet: ${snippet}
        Email Body (resumen): ${content.substring(0, 2000)}
        
        Responde ÚNICAMENTE en JSON: {"label": "NOMBRE ACCION', "url": "URL_AQUI"}.
        Si no hay link de acción clara, devuelve null.`;

        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${key}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { responseMimeType: "application/json" }
            })
        });

        if (!res.ok) return null;
        const data = await res.json();
        const output = data.candidates?.[0]?.content?.parts?.[0]?.text;
        return JSON.parse(output);
    } catch (e) { return null; }
}

// Low-intelligence local fallback
function findMainAction(content, isHtml) {
    const keywords = [
        { label: 'Cambiar contraseña', regex: /cambiar contraseña|cambiar la contraseña|change password|reset password/i },
        { label: 'Restablecer contraseña', regex: /restablecer|recuperar|reset|recover/i },
        { label: 'Verificar cuenta', regex: /verificar|confirmar|verify|confirm/i },
        { label: 'Administrar Hogar', regex: /administrar hogar|configurar hogar|manage household/i },
        { label: 'Ir al sitio', regex: /ir a|visit|access|entrar/i }
    ];

    if (isHtml) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(content, 'text/html');
        const links = Array.from(doc.querySelectorAll('a'));
        
        for (const kw of keywords) {
            // Priority: links whose text matches keywords
            const match = links.find(l => kw.regex.test(l.innerText) || kw.regex.test(l.title));
            if (match && match.href.startsWith('http')) {
                return { label: kw.label, url: match.href };
            }
        }
    } else {
        const lines = content.split('\n');
        for (const kw of keywords) {
            const lineIdx = lines.findIndex(l => kw.regex.test(l));
            if (lineIdx !== -1) {
                // Find next link in immediate vicinity
                for (let i = lineIdx; i < Math.min(lineIdx + 5, lines.length); i++) {
                    const linkMatch = lines[i].match(/(https?:\/\/[^\s]+)/);
                    if (linkMatch) return { label: kw.label, url: linkMatch[0] };
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
    const gkey = geminiKeyInput.value.trim();
    if (cid) localStorage.setItem(SK_CID, cid);
    if (gkey) localStorage.setItem(SK_GEMINI, gkey);
    banner.style.display = 'none';
    showToast('Configuración guardada', 'success');
    if (window.google) initTokenClient();
}

function clearConfigs() {
    localStorage.removeItem(SK_CID);
    localStorage.removeItem(SK_GEMINI);
    clientIdInput.value = '';
    geminiKeyInput.value = '';
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
    geminiKeyInput = document.getElementById('geminiKeyInput');

    document.getElementById('showOrigin').textContent = location.origin;
    clientIdInput.value = getSavedClientId();
    geminiKeyInput.value = getSavedGeminiKey();
    
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
