/**
 * Consulta Inbox - Netlify Functions + sesion por contrasena
 */
const NETLIFY_API_BASE = 'https://marvelous-salmiakki-382f32.netlify.app';
const IS_GITHUB_PAGES = /github\.io$/i.test(window.location.hostname);
const API_BASE = IS_GITHUB_PAGES ? NETLIFY_API_BASE : '';
const LOGIN_ENDPOINT = `${API_BASE}/.netlify/functions/login`;
const INBOX_ENDPOINT = `${API_BASE}/.netlify/functions/inbox`;
const LOGOUT_ENDPOINT = `${API_BASE}/.netlify/functions/logout`;
const POLL_INTERVAL_MS = 700;
let isSearching = false;
let pollingInterval = null;
let renderedMessageIds = new Set();
let latestSeenInternalDate = 0;
let activeSearchSeq = 0;
let activeFilterTerm = '';
let resultsContainer;
let loader;
let submitBtn;
let filterInput;
let backToTopBtn;
let clearFilterBtn;
let configLogoutBtn;
let configModal;
let configLoginForm;
let configPasswordInput;
let configLoginPromise = null;
async function hasActiveSession() {
    try {
        const res = await fetch(`${INBOX_ENDPOINT}?action=ping`, {
            credentials: 'include'
        });
        if (!res.ok) return false;
        const payload = await res.json();
        return !!(payload && payload.ok === true && payload.pong === true);
    } catch (_) {
        return false;
    }
}
async function ensureSessionOnFirstVisit() {
    if (await hasActiveSession()) return true;
    if (configLoginPromise) return configLoginPromise;
    configLoginPromise = openLoginModal().finally(() => {
        configLoginPromise = null;
    });
    return configLoginPromise;
}
function openLoginModal() {
    return new Promise((resolve) => {
        if (!configModal || !configLoginForm || !configPasswordInput) {
            resolve(false);
            return;
        }
        configPasswordInput.value = '';
        configModal.classList.add('show');
        configModal.setAttribute('aria-hidden', 'false');
        document.body.classList.add('modal-open');
        configPasswordInput.focus();
        const onSubmit = async (e) => {
            e.preventDefault();
            const password = (configPasswordInput.value || '').trim();
            const submit = configLoginForm.querySelector('button[type="submit"]');
            const originalText = submit ? submit.textContent : '';
            if (!password) {
                showToast('Ingresa la contrasena', 'error');
                return;
            }
            try {
                if (submit) {
                    submit.disabled = true;
                    submit.textContent = 'Entrando...';
                }
                await loginWithPassword(password);
            } catch (err) {
                showToast(err.message || 'No se pudo iniciar sesion', 'error');
                return;
            } finally {
                if (submit) {
                    submit.disabled = false;
                    submit.textContent = originalText || 'Entrar';
                }
            }
            configModal.classList.remove('show');
            configModal.setAttribute('aria-hidden', 'true');
            document.body.classList.remove('modal-open');
            configLoginForm.removeEventListener('submit', onSubmit);
            resolve(true);
        };
        configLoginForm.addEventListener('submit', onSubmit);
    });
}
async function loginWithPassword(password) {
    let res;
    try {
        res = await fetch(LOGIN_ENDPOINT, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password })
        });
    } catch (_) {
        throw new Error('No se pudo conectar al servidor');
    }
    const raw = await res.text();
    let payload = {};
    try {
        payload = raw ? JSON.parse(raw) : {};
    } catch (_) {
        throw new Error(`Backend no actualizado o URL incorrecta (HTTP ${res.status})`);
    }
    if (!res.ok || !payload || payload.ok !== true) {
        throw new Error((payload && payload.error) ? payload.error : 'Contrasena invalida');
    }
}
async function resetGasSession() {
    try {
        await fetch(LOGOUT_ENDPOINT, {
            method: 'POST',
            credentials: 'include'
        });
    } catch (_) {
        // no-op
    }
    activeFilterTerm = '';
    renderedMessageIds.clear();
    latestSeenInternalDate = 0;
    resultsContainer.innerHTML = '';
    if (pollingInterval) clearInterval(pollingInterval);
    const live = document.getElementById('liveStatus');
    if (live) live.style.display = 'none';
    showToast('Sesion cerrada', 'success');
    await ensureSessionOnFirstVisit();
}
function encodeB64Url(text) {
    const bytes = new TextEncoder().encode(text || '');
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function mapGasItemToMessage(item) {
    const bodyText = item.body || item.snippet || '';
    const bodyHtml = item.html || '';
    return {
        id: item.id || ('gas-' + Date.now()),
        snippet: item.snippet || bodyText,
        internalDate: String(new Date(item.date || Date.now()).getTime()),
        gasPlainBody: bodyText,
        gasHtmlBody: bodyHtml,
        payload: {
            mimeType: 'multipart/alternative',
            headers: [
                { name: 'Subject', value: item.subject || '(Sin asunto)' },
                { name: 'From', value: item.from || '' },
                { name: 'Date', value: item.date || new Date().toISOString() }
            ],
            parts: [
                { mimeType: 'text/plain', body: { data: encodeB64Url(bodyText) } },
                { mimeType: 'text/html', body: { data: encodeB64Url(bodyHtml) } }
            ],
            body: { data: encodeB64Url(bodyText) }
        }
    };
}

async function searchMails(isSilent = false) {
    if (isSearching) return;
    const filter = isSilent ? activeFilterTerm : filterInput.value.trim();
    if (!filter) return;
    const localSeq = isSilent ? activeSearchSeq : (++activeSearchSeq);
    if (!isSilent) {
        if (pollingInterval) clearInterval(pollingInterval);
        setLoading(true);
        activeFilterTerm = filter;
        resultsContainer.innerHTML = '';
        renderedMessageIds.clear();
        latestSeenInternalDate = 0;
        const live = document.getElementById('liveStatus');
        if (live) live.style.display = 'none';
    } else {
        isSearching = true;
    }
    try {
        if (!isSilent) {
            const ready = await ensureSessionOnFirstVisit();
            if (!ready) return;
        }
        const maxLimit = document.getElementById('maxResultsInput').value || 10;
        updateResultsMaxInfo(maxLimit);
        const qs = new URLSearchParams({
            action: 'search',
            filter: filter,
            max: String(maxLimit)
        });
        const res = await fetch(`${INBOX_ENDPOINT}?${qs.toString()}`, {
            credentials: 'include'
        });
        if (localSeq !== activeSearchSeq || filter !== activeFilterTerm) return;
        if (res.status === 401) {
            if (!isSilent) {
                showToast('Sesion vencida. Inicia sesion de nuevo.', 'error');
                await ensureSessionOnFirstVisit();
            }
            return;
        }
        if (!res.ok) throw new Error('Error consultando bandeja');
        const payload = await res.json();
        if (!payload.ok) throw new Error(payload.error || 'Error en servidor');
        const items = Array.isArray(payload.items) ? payload.items : [];
        if (items.length === 0) {
            if (!isSilent) {
                resultsContainer.innerHTML = `
                    <div style="text-align:center; padding:40px; border-radius:18px; border:1px dashed var(--border);">
                        <div style="font-size:0.9rem; font-weight:600; color:var(--text); margin-bottom:8px;">No se encontraron resultados</div>
                    </div>
                `;
            }
            return;
        }
        const newBatch = items.filter(m => !renderedMessageIds.has(m.id)).reverse();
        for (let i = 0; i < newBatch.length; i++) {
            if (localSeq !== activeSearchSeq || filter !== activeFilterTerm) return;
            const msg = mapGasItemToMessage(newBatch[i]);
            const msgInternalDate = Number(msg.internalDate || 0);
            const shouldHighlightNew = isSilent && msgInternalDate > latestSeenInternalDate;
            latestSeenInternalDate = Math.max(latestSeenInternalDate, msgInternalDate);
            renderedMessageIds.add(newBatch[i].id);
            renderEmail(msg, true, i, shouldHighlightNew);
        }
    } catch (err) {
        if (!isSilent) showToast(err.message || 'Error', 'error');
    } finally {
        if (!isSilent) setLoading(false);
        else isSearching = false;
        if (!isSilent) startPolling();
    }
}
function startPolling() {
    if (pollingInterval) clearInterval(pollingInterval);
    const live = document.getElementById('liveStatus');
    if (live) live.style.display = 'inline-flex';
    pollingInterval = setInterval(() => {
        const filter = activeFilterTerm.trim();
        if (!filter) return;
        if (!isSearching) searchMails(true);
    }, POLL_INTERVAL_MS);
}

function renderEmail(msg, prepend = false, _animIndex = 0, highlightAsNew = false) {
    const headers = msg.payload.headers || [];
    const subject = headers.find(h => h.name.toLowerCase() === 'subject')?.value || '(Sin asunto)';
    const from = headers.find(h => h.name.toLowerCase() === 'from')?.value || '';
    const dateStr = headers.find(h => h.name.toLowerCase() === 'date')?.value || '';
    const date = new Date(dateStr).toLocaleString('es-ES', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
    }).toUpperCase();

    const { content, isHtml } = extractBody(msg);

    let foundCode = null;
    let pureText = content || '';
    let doc = null;

    if (isHtml) {
        const parser = new DOMParser();
        doc = parser.parseFromString(content, 'text/html');
        doc.querySelectorAll('style, script').forEach(s => s.remove());
        pureText = (doc.body && doc.body.textContent) ? doc.body.textContent : '';
    }

    const searchContext = `${subject} | ${msg.snippet || ''} | ${pureText}`.replace(/[\n\r\t]/g, ' ').replace(/\s+/g, ' ');

    const isInvalidCode = (c, context, raw = null) => {
        if (/^(202[4-9]|2030)$/.test(c)) return true;
        if (/^[0-9]{5}$/.test(c)) return true;
        if (/^(.)\1+$/.test(c)) return true;
        if (c.includes('1570') || c.startsWith('01800')) return true;

        const searchStr = raw || c;
        const pos = context.indexOf(searchStr);
        if (pos === -1) return false;

        const surrounding = context.substring(Math.max(0, pos - 15), Math.min(context.length, pos + searchStr.length + 15));
        if (/[0-9a-fA-F]{4,}[-_]|[-_][0-9a-fA-F]{4,}/.test(surrounding)) return true;
        if (surrounding.includes('SRC:') || surrounding.includes('ID:') || /src/i.test(surrounding) || surrounding.includes('UUID')) return true;

        const lookbehind = context.substring(Math.max(0, pos - 50), pos).toLowerCase();
        const lookahead = context.substring(pos + searchStr.length, Math.min(context.length, pos + searchStr.length + 30)).toLowerCase();

        if (lookbehind.includes('llama') || lookbehind.includes('llámanos') || lookbehind.includes('tel') || lookbehind.includes('phone') || lookbehind.includes('01 800') || lookbehind.includes('800')) return true;
        if (lookahead.includes('way') || lookahead.includes('ave') || lookahead.includes('st') || lookahead.includes('calle') || lookahead.includes('road')) return true;

        const footerTerms = ['derechos reservados', 'unsubscribe', 'privacidad', 'términos', 'copyright', 'inc.', 'privacy', 'src:', 'id:', 'uuid', '121 albright'];
        const contextAroundCode = context.substring(Math.max(0, pos - 150), Math.min(context.length, pos + searchStr.length + 150)).toLowerCase();
        if (footerTerms.some(term => contextAroundCode.includes(term))) return true;

        return false;
    };

    if (isHtml && doc) {
        const potentialCodes = Array.from(doc.querySelectorAll('td, span, div, b, strong, font')).filter(el => {
            const txt = (el.textContent || '').trim().replace(/\s+/g, '');
            const style = el.getAttribute('style') || '';
            const cls = el.className || '';
            return (cls.includes('number') || cls.includes('code') || style.includes('letter-spacing')) && /^\d{4,8}$/.test(txt);
        });
        if (potentialCodes.length > 0) {
            foundCode = (potentialCodes[0].textContent || '').trim().replace(/\s+/g, '');
        }
    }

    const afterRegex = /(?:código|code|confirmación|verific|acceso|pin|confirma|cambio).{0,400}?\b(\d{4,8})\b/i;
    const afterMatch = searchContext.match(afterRegex);
    if (afterMatch && !foundCode && !isInvalidCode(afterMatch[1], searchContext)) foundCode = afterMatch[1];

    if (!foundCode) {
        const beforeRegex = /\b(\d{4,8})\b.{0,60}?(?:código|code|confirmación|verific|es tu|is tu|confirma)/i;
        const beforeMatch = searchContext.match(beforeRegex);
        if (beforeMatch && !isInvalidCode(beforeMatch[1], searchContext)) foundCode = beforeMatch[1];
    }

    if (!foundCode) {
        const spacedMatch = searchContext.match(/(?:código|code|confirmación|verific|confirma|cambio).{0,250}?\b((\d\s*){4,8})\b/i);
        if (spacedMatch) {
            const rawCode = spacedMatch[1];
            const joined = rawCode.replace(/\s+/g, '');
            if (joined.length >= 4 && !isInvalidCode(joined, searchContext, rawCode)) foundCode = joined;
        }
    }

    if (!foundCode && /(código|code|verific|acceso|inicio|sesión|login|confirma|cambio)/i.test(subject)) {
        const allNums = searchContext.match(/\b\d{4,8}\b/g) || [];
        const valid = allNums.find(n => !isInvalidCode(n, searchContext));
        if (valid) foundCode = valid;
    }

    let displaySnippet = msg.snippet || '';
    const lowerSub = subject.toLowerCase();

    if (lowerSub.includes('accedida') || lowerSub.includes('inicio de sesión') || lowerSub.includes('inicia sesión') || lowerSub.includes('seguridad') || lowerSub.includes('verific') || lowerSub.includes('contraseña')) {
        const locationMatch = searchContext.match(/(?:Cerca de|Cerca|En)\s+(?!(?:and|min|max|width))\b([^,\|]{3,50}, [^,\|]{3,50}(?:, [^,\|]{3,50})?)/i);
        const accountMatch = searchContext.match(/(?:Cuenta de Google|la cuenta)\s+([^\s]+@gmail\.com)/i);

        if (accountMatch) {
            displaySnippet = `Verificando cuenta: <strong>${accountMatch[1].trim()}</strong>`;
        } else if (locationMatch && locationMatch[1].includes(',')) {
            displaySnippet = `Inicio detectado en: <strong>${locationMatch[1].trim()}</strong>`;
        } else if (lowerSub.includes('contraseña') || lowerSub.includes('password')) {
            displaySnippet = 'Actualización de seguridad confirmada';
        } else if (lowerSub.includes('verific')) {
            displaySnippet = 'Confirmación: <strong>Escribe el código para validar</strong>';
        }
    }

    if (lowerSub.includes('hogar') || lowerSub.includes('viaje') || lowerSub.includes('dispositivo') || lowerSub.includes('solicitaste') || lowerSub.includes('vix') || lowerSub.includes('unirse') || lowerSub.includes('tienes') || lowerSub.includes('inicio') || lowerSub.includes('temporal')) {
        const netflixMatch = searchContext.match(/(\w+) ha enviado una solicitud desde (?:el dispositivo )?([^|]+?)(?= a las| \||$)/i);
        const newNetflixMatch = searchContext.match(/Solicitud de (.*?), enviada desde:\s*([^,]+)/i);
        const inviteMatch = searchContext.match(/(\w+) te ha invitado(?: [^ ]+){0,5} a (?:unirse|su plan)/i);
        const deviceMatch = searchContext.match(/([A-Z][a-z0-9 ]+-[^|]+)/i) || searchContext.match(/([A-Z][a-z]+ Smart TV|Samsung|LG|Apple TV|Roku)/i);

        if (subject.includes('Solicitud de inicio') || subject.includes('solicitud de inicio')) {
            const dev = deviceMatch ? deviceMatch[1].trim() : 'Dispositivo';
            displaySnippet = `Aprobar acceso: <strong>${dev}</strong>`;
        } else if (subject.includes('¡Casi lo tienes!')) {
            displaySnippet = 'Suscripción pendiente: <strong>Crea tu cuenta ahora</strong>';
        } else if (inviteMatch) {
            displaySnippet = `Invitación de: <strong>${inviteMatch[1].trim()}</strong>`;
        } else if (newNetflixMatch) {
            displaySnippet = `<strong>${newNetflixMatch[1].trim()}</strong> solicitó desde <strong>${newNetflixMatch[2].trim()}</strong>`;
        } else if (netflixMatch) {
            displaySnippet = `<strong>${netflixMatch[1].trim()}</strong> solicitó desde <strong>${netflixMatch[2].trim()}</strong>`;
        } else if (!displaySnippet.includes('Inicio detectado') && !displaySnippet.includes('Verificando')) {
            const dm = searchContext.match(/Dispositivo\s*(.*?)(?=\sFecha|\sHora|$)/i);
            if (dm) displaySnippet = `Nuevo acceso en: <strong>${dm[1].trim()}</strong>`;
        }
    }

    let useFromAction = false;
    const cleanSnippet = (displaySnippet || '').replace(/&nbsp;/g, ' ').trim();
    if (!cleanSnippet || cleanSnippet === '...' || cleanSnippet.toLowerCase() === 'no snippet') {
        const safeFrom = from.replace(/</g, '&lt;').replace(/>/g, '&gt;');
        displaySnippet = `<span style="opacity:0.6; font-size:0.75rem;">Remitente: ${safeFrom}</span>`;
        useFromAction = true;
    }

    let mainAction = findMainAction(content, isHtml);

    if (useFromAction && !mainAction) {
        const emailOnly = from.match(/[^ <]+@[^ >]+/);
        if (emailOnly) {
            mainAction = { label: 'COPIAR CORREO', url: 'javascript:void(0)', isCopyEmail: true, email: emailOnly[0] };
        }
    }

    const item = document.createElement('div');
    item.className = 'email-item';
    item.onclick = (e) => {
        if (!e.target.closest('a') && !e.target.closest('.copy-mini')) {
            item.classList.remove('email-item-new-live');
            toggleBody(item);
        }
    };

    let codeHtml = '';
    if (foundCode) {
        codeHtml = `
            <div class="code-box click-to-copy" style="background:rgba(18,140,126,0.3); border:1px solid rgba(18,140,126,0.8); cursor:pointer; display:inline-flex; align-items:center; height:30px; padding:0 12px; border-radius:8px;" title="Clic para copiar" onclick="event.stopPropagation(); copyToClipboard('${foundCode}', 'Código copiado')">
                <span class="code-value" style="color:#fff; font-size:1.1rem; letter-spacing:3px;">${foundCode}</span>
            </div>
        `;
    }

    let actionHtml = '';
    if (mainAction) {
        const isProtection = mainAction.label === 'PROTEGER CUENTA';
        const isBilling = mainAction.label === 'GESTIONAR PAGO';
        const isRenew = mainAction.label === 'RENOVAR';
        const isLogin = mainAction.label === 'INICIAR SESIÓN';
        const isCreate = mainAction.label === 'CREAR CUENTA';
        const isApprove = mainAction.label === 'APROBAR INICIO';
        const isRequest = mainAction.label === 'SOLICITAR CÓDIGO';
        const isCopy = !!mainAction.isCopyEmail;

        let btnColor = 'var(--green)';
        let btnShadow = 'var(--green-glow)';
        let txtColor = '#000';
        let clickAction = 'event.stopPropagation()';

        if (mainAction.label === 'SÍ, LO SOLICITÉ YO' || mainAction.label === 'ACEPTAR INVITACIÓN' || isCreate || isApprove || isRequest) {
            btnColor = '#e50914';
            btnShadow = 'rgba(229,9,20,0.4)';
        } else if (isProtection) {
            btnColor = '#ff6600';
            btnShadow = 'rgba(255,102,0,0.4)';
        } else if (isBilling) {
            btnColor = '#7d2ae8';
            btnShadow = 'rgba(125,42,232,0.4)';
            txtColor = '#fff';
        } else if (isRenew) {
            btnColor = '#00c9db';
            btnShadow = 'rgba(0,201,219,0.4)';
        } else if (isLogin) {
            btnColor = '#f35400';
            btnShadow = 'rgba(243,84,0,0.4)';
        } else if (isCopy) {
            btnColor = '#3498db';
            btnShadow = 'rgba(52,152,219,0.4)';
            txtColor = '#000';
            clickAction = `event.stopPropagation(); copyToClipboard('${mainAction.email}', 'Correo copiado')`;
        }

        const href = isCopy ? 'javascript:void(0)' : mainAction.url;

        actionHtml = `
            <a href="${href}" target="${isCopy ? '' : '_blank'}" onclick="${clickAction}" style="display:inline-flex; align-items:center; justify-content:center; white-space:nowrap; height:30px; padding:0 12px; background:${btnColor}; border-radius:8px; font-size:0.7rem; font-weight:800; color:${txtColor}; text-decoration:none; box-shadow:0 4px 10px ${btnShadow}; flex-shrink:0;">
                ${String(mainAction.label || '').toUpperCase()}
            </a>
        `;
    }

    item.innerHTML = `
        <div class="email-top-row">
            <span class="email-from">${from.split('<')[0].trim().replace(/['"]/g, '') || from}</span>
            <div class="email-top-actions">
                <span class="email-date">${date}</span>
            </div>
        </div>
        <div class="email-subject" style="pointer-events:none;">${subject}</div>

        <div class="card-summary">
            <div style="display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:nowrap;">
                <div class="email-snippet" style="pointer-events:none; margin-bottom:0; flex-grow:1; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;">${displaySnippet}</div>
                <div style="display:flex; gap:8px; align-items:center; flex-shrink:0; margin-right:20px;">
                    ${codeHtml}
                    ${actionHtml}
                </div>
            </div>
        </div>

        <div class="msg-body" style="display:none; transition:all 0.3s; margin-top:10px; background:#fff; border-radius:12px; overflow:hidden;">
            ${isHtml
                ? `<iframe id="iframe-${msg.id}" style="width:100%; border:none; background:#fff; min-height:500px; display:block;"></iframe>`
                : `<div style="padding:16px; color:#333; background:#fff;">${formatBodyWithLinks(content)}</div>`
            }
        </div>
        <div class="card-indicator">▼</div>
    `;

    if (highlightAsNew) {
        document.querySelectorAll('.email-item-new-live').forEach(el => el.classList.remove('email-item-new-live'));
        item.classList.add('email-item-new-live');
    }

    if (prepend) resultsContainer.prepend(item);
    else resultsContainer.appendChild(item);

    if (isHtml) {
        const iframe = document.getElementById('iframe-' + msg.id);
        if (iframe) renderHtmlInIframe(iframe, content);
    }
}

function renderHtmlInIframe(iframe, html) {
    if (!iframe || !iframe.contentWindow) return;
    const raw = String(html || '');
    const hasHtmlShell = /<html[\s>]/i.test(raw) || /<body[\s>]/i.test(raw);
    const docHtml = hasHtmlShell
        ? raw
        : `<!DOCTYPE html><html><head><base target="_blank"></head><body>${raw}</body></html>`;

    const iframeDoc = iframe.contentWindow.document;
    iframeDoc.open();
    iframeDoc.write(docHtml);
    iframeDoc.close();

    const resize = () => {
        try {
            const d = iframe.contentWindow.document;
            const h = Math.max(
                (d.body && d.body.scrollHeight) || 0,
                (d.documentElement && d.documentElement.scrollHeight) || 0,
                420
            );
            iframe.style.height = `${h}px`;
        } catch (_) {
            iframe.style.height = '500px';
        }
    };

    resize();
    setTimeout(resize, 150);
    setTimeout(resize, 700);
}

function extractBody(input) {
    if (!input) return { content: 'Cuerpo del mensaje no disponible.', isHtml: false };

    if (input.gasHtmlBody) return { content: input.gasHtmlBody, isHtml: true };
    if (input.gasPlainBody) return { content: input.gasPlainBody, isHtml: false };

    const payload = input.payload ? input.payload : input;

    let htmlPart = null;
    let plainPart = null;

    function findParts(p) {
        if (!p) return;
        if (p.mimeType === 'text/html' && p.body && p.body.data) htmlPart = p.body.data;
        if (p.mimeType === 'text/plain' && p.body && p.body.data) plainPart = p.body.data;
        if (Array.isArray(p.parts)) p.parts.forEach(findParts);
    }

    findParts(payload);

    if (htmlPart) return { content: decodeB64(htmlPart), isHtml: true };
    if (plainPart) return { content: decodeB64(plainPart), isHtml: false };
    if (payload && payload.body && payload.body.data) return { content: decodeB64(payload.body.data), isHtml: false };

    return { content: 'Cuerpo del mensaje no disponible.', isHtml: false };
}

function decodeB64(str) {
    try {
        const raw = atob((str || '').replace(/-/g, '+').replace(/_/g, '/'));
        const bytes = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
        return new TextDecoder().decode(bytes);
    } catch (_) {
        return 'Error de decodificación.';
    }
}

function formatBodyWithLinks(text) {
    const safe = String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    return safe.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
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

function updateBackToTopVisibility() {
    if (!backToTopBtn) return;
    const shouldShow = window.scrollY > 240;
    backToTopBtn.classList.toggle('show', shouldShow);
}

function updateResultsMaxInfo(maxValue) {
    const info = document.getElementById('resultsMaxInfo');
    if (!info) return;
    info.textContent = `MAX: ${maxValue}`;
}

function findMainAction(content, isHtml) {
    const rules = [
        { label: 'SÍ, LO SOLICITÉ YO', regex: /sí, lo solicit[eé] yo|sí, he sido yo|sí, la envi[eé] yo|confirmar solicitud/i },
        { label: 'APROBAR INICIO', regex: /aprobar inicio|aprobar acceso|approve login/i },
        { label: 'VERIFICAR CUENTA', regex: /verificar cuenta|confirmar correo|verificar correo electr[oó]nico|verify account|confirm email/i },
        { label: 'ACEPTAR INVITACIÓN', regex: /comenzar|unirse|aceptar invitaci[oó]n|get started/i },
        { label: 'INICIAR SESIÓN', regex: /inicia[r]? sesi[oó]n|log[ -]?in|acceder|sign[ -]?in|mi cuenta/i },
        { label: 'CREAR CUENTA', regex: /crea[r]? cuenta|iniciar mi membres[ií]a|sign[ -]?up|create account/i },
        { label: 'SOLICITAR CÓDIGO', regex: /solicitar c[oó]digo|get code|enviar c[oó]digo/i },
        { label: 'PROTEGER CUENTA', regex: /esto no fui yo|not me|security alert|seguridad/i },
        { label: 'GESTIONAR PAGO', regex: /actualizar método|método de pago|update payment|billing|pago/i },
        { label: 'CAMBIAR CONTRASEÑA', regex: /cambi.* contraseña|change password|reset password/i },
        { label: 'GESTIONAR HOGAR', regex: /administrar hogar|configurar hogar|manage household|gestion de hogar/i },
        { label: 'GESTIONAR ACCESO', regex: /gestionar el acceso|comprueba qué dispositivos|manage access/i },
        { label: 'REESTABLECER', regex: /restablecer|recuperar|reset|recover/i }
    ];

    if (isHtml) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(content, 'text/html');
        const links = Array.from(doc.querySelectorAll('a'));

        for (const rule of rules) {
            const match = links.find(l => {
                const text = (l.textContent || l.innerText || '').trim();
                const title = (l.getAttribute('title') || l.getAttribute('aria-label') || '').trim();
                return rule.regex.test(text) || rule.regex.test(title);
            });

            if (match && match.href && match.href.startsWith('http')) {
                return { label: rule.label, url: match.href };
            }
        }
    } else {
        const lines = String(content || '').split('\n');
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

window.pasteFromClipboard = function () {
    navigator.clipboard.readText().then(text => {
        const clean = text.trim();
        if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) {
            filterInput.value = clean;
            updateClearFilterVisibility();
            showToast('Correo pegado', 'success');
            searchMails();
        } else {
            showToast('No es un correo válido', 'error');
        }
    }).catch(() => showToast('Permiso denegado', 'error'));
};

window.clearFilterInput = function () {
    filterInput.value = '';
    filterInput.focus();
    updateClearFilterVisibility();
};

function updateClearFilterVisibility() {
    if (!clearFilterBtn || !filterInput) return;
    const show = filterInput.value.trim().length > 0;
    clearFilterBtn.classList.toggle('show', show);
}

document.addEventListener('DOMContentLoaded', async () => {
    resultsContainer = document.getElementById('resultsContainer');
    loader = document.getElementById('loader');
    submitBtn = document.getElementById('submitBtn');
    filterInput = document.getElementById('filterEmail');
    backToTopBtn = document.getElementById('backToTopBtn');
    clearFilterBtn = document.getElementById('clearFilterBtn');
    configLogoutBtn = document.getElementById('configLogoutBtn');
    configModal = document.getElementById('configLoginModal');
    configLoginForm = document.getElementById('configLoginForm');
    configPasswordInput = document.getElementById('configPasswordInput');
    const maxResultsInput = document.getElementById('maxResultsInput');
    const sessionOk = await ensureSessionOnFirstVisit();
    if (!sessionOk) {
        showToast('Inicia sesion para buscar correos', 'error');
    }
    if (backToTopBtn) {
        backToTopBtn.addEventListener('click', () => {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    }
    window.addEventListener('scroll', updateBackToTopVisibility, { passive: true });
    updateBackToTopVisibility();
    if (filterInput && clearFilterBtn) {
        filterInput.addEventListener('input', updateClearFilterVisibility);
        updateClearFilterVisibility();
    }
    if (maxResultsInput) {
        maxResultsInput.addEventListener('input', () => updateResultsMaxInfo(maxResultsInput.value || 10));
        updateResultsMaxInfo(maxResultsInput.value || 10);
    }
    if (submitBtn) {
        submitBtn.addEventListener('click', () => searchMails());
    }
    if (configLogoutBtn) {
        configLogoutBtn.addEventListener('click', () => {
            resetGasSession();
        });
    }
    if (filterInput) {
        filterInput.addEventListener('paste', () => {
            setTimeout(() => {
                updateClearFilterVisibility();
                const clean = filterInput.value.trim();
                if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) searchMails();
            }, 100);
        });
    }
});
