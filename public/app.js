const startBtn = document.getElementById('start-btn');
const setupContainer = document.getElementById('setup-container');
const statusBadge = document.getElementById('connection-status');
const messageInput = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');
const chatMessages = document.getElementById('chat-messages');
const emojiButtons = document.querySelectorAll('.emoji-btn');
const chatContainer = document.querySelector('.chat-container');

// Nudge Element
const nudgeBtn = document.getElementById('nudge-btn');

// Klipy Elements
const gifBtn = document.getElementById('gif-btn');
const klipyContainer = document.getElementById('klipy-container');
const klipySearch = document.getElementById('klipy-search');
const klipyClose = document.getElementById('klipy-close');
const klipyResults = document.getElementById('klipy-results');

// Reply & Edit Elements
const replyBar = document.getElementById('reply-bar');
const replyBarText = document.getElementById('reply-bar-text');
const cancelReplyBtn = document.getElementById('cancel-reply-btn');
let currentReply = null;

const editBar = document.getElementById('edit-bar');
const editBarText = document.getElementById('edit-bar-text');
const cancelEditBtn = document.getElementById('cancel-edit-btn');
let editingMsg = null;

function setReply(text) {
    clearEditing();
    currentReply = text;
    if (replyBar && replyBarText) {
        replyBarText.textContent = text;
        replyBar.style.display = 'flex';
    }
    messageInput.focus();
}

function clearReply() {
    currentReply = null;
    if (replyBar && replyBarText) {
        replyBar.style.display = 'none';
        replyBarText.textContent = '';
    }
}

function setEditing(id, text) {
    if (!id) return;
    clearReply();
    editingMsg = { id, originalContent: text };
    if (editBar && editBarText) {
        editBarText.textContent = text;
        editBar.style.display = 'flex';
    }
    messageInput.value = text;
    messageInput.focus();
    try { messageInput.setSelectionRange(text.length, text.length); } catch (e) {}
}

function clearEditing() {
    editingMsg = null;
    if (editBar && editBarText) {
        editBar.style.display = 'none';
        editBarText.textContent = '';
    }
}

function applyMessageEdit(id, newContent) {
    const el = document.querySelector(`.message[data-msg-id="${id}"]`);
    if (!el) return;
    const textWrap = el.querySelector('.msg-text') || el;
    let editedTag = el.querySelector('.edited-tag');
    textWrap.textContent = newContent;
    if (!editedTag) {
        editedTag = document.createElement('span');
        editedTag.className = 'edited-tag';
        editedTag.textContent = ' (editado)';
    }
    textWrap.appendChild(editedTag);
    const editBtn = el.querySelector('.edit-btn');
    if (editBtn) {
        editBtn.onclick = () => setEditing(id, newContent);
    }
}

if (cancelReplyBtn) {
    cancelReplyBtn.addEventListener('click', clearReply);
}
if (cancelEditBtn) {
    cancelEditBtn.addEventListener('click', () => {
        clearEditing();
        messageInput.value = '';
    });
}

let ws;
let peerConnection;
let dataChannel;

// Public STUN and TURN servers for NAT Traversal
const configuration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun.cloudflare.com:3478' }
    ]
};

let reconnectAttempts = 0;
const MAX_RECONNECT_DELAY = 10000;
let isIntentionalDisconnect = false;
let isNegotiating = false;
let lastOfferReceived = 0;
let autoReconnectTimer = null;
let disconnectGraceTimer = null;
let wasConnected = false;
const clientId = Math.random().toString(36).substring(2, 9);

function scheduleAutoReconnect(reason = 'P2P connection lost') {
    if (autoReconnectTimer) clearTimeout(autoReconnectTimer);
    if (isIntentionalDisconnect) return;

    const delay = 2000 + Math.floor(Math.random() * 300);
    console.log(`Scheduling auto-reconnect in ${(delay / 1000).toFixed(1)}s (reason: ${reason})...`);
    updateStatus('connecting', 'Auto-reconnecting in 2s...');
    startBtn.textContent = 'Auto-reconnecting in 2s...';

    autoReconnectTimer = setTimeout(async () => {
        autoReconnectTimer = null;
        if (!isIntentionalDisconnect && peerConnection?.connectionState !== 'connected') {
            console.log('Triggering automatic fresh reconnect now...');
            if (ws && ws.readyState === WebSocket.OPEN) {
                if (peerConnection) handleDisconnect(false);
                initPeerConnection();
                await createOffer();
            } else {
                connectSignalingServer();
            }
        }
    }, delay);
}

startBtn.addEventListener('click', async () => {
    if (autoReconnectTimer) {
        clearTimeout(autoReconnectTimer);
        autoReconnectTimer = null;
    }
    isIntentionalDisconnect = false;
    reconnectAttempts = 0;
    if (ws && ws.readyState === WebSocket.OPEN) {
        startBtn.disabled = true;
        startBtn.textContent = 'Re-negotiating...';
        if (peerConnection) handleDisconnect(false);
        initPeerConnection();
        await createOffer();
        return;
    }
    startBtn.disabled = true;
    startBtn.textContent = 'Connecting to signaling...';
    connectSignalingServer();
});

function updateStatus(state, message) {
    statusBadge.className = `status ${state}`;
    statusBadge.textContent = message;
}

function displaySystemMessage(text) {
    const msgDiv = document.createElement('div');
    msgDiv.classList.add('message', 'system');
    msgDiv.textContent = text;
    appendMessageElement(msgDiv);
}

function connectSignalingServer() {
    updateStatus('connecting', 'Connecting Signaling...');

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    // The Python FastAPI WebSocket server is running on the same host/port under /ws route
    ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

    ws.onopen = () => {
        console.log('Connected to signaling server');
        reconnectAttempts = 0;
        if (peerConnection?.connectionState === 'connected' && dataChannel?.readyState === 'open') {
            updateStatus('connected', 'P2P Connected');
            return;
        }
        updateStatus('connecting', 'Waiting for peer...');
        startBtn.textContent = 'Waiting for peer...';
        displaySystemMessage('Connected to signaling server. Waiting for a peer to join...');
        try {
            ws.send(JSON.stringify({ type: 'hello', from: clientId }));
        } catch(e){}
    };

    ws.onmessage = async (event) => {
        const message = JSON.parse(event.data);
        console.log('Signal received:', message.type);

        try {
            switch (message.type) {
                case 'hello':
                    console.log('Peer announced presence in lounge');
                    if (autoReconnectTimer) { clearTimeout(autoReconnectTimer); autoReconnectTimer = null; }
                    if (peerConnection?.connectionState === 'connected' && dataChannel?.readyState === 'open') break;
                    if (isNegotiating || peerConnection?.iceConnectionState === 'checking' || peerConnection?.connectionState === 'connecting') {
                        console.log('Negotiation/connecting already in progress. Ignoring duplicate hello.');
                        break;
                    }
                    isNegotiating = true;
                    displaySystemMessage('Peer detected! Negotiating secure connection...');
                    if (peerConnection) handleDisconnect(false);
                    initPeerConnection();
                    await createOffer();
                    setTimeout(() => { isNegotiating = false; }, 3000);
                    break;
                case 'peer_joined':
                    // Another peer joined. If we are already here, we can initiate the WebRTC offer.
                    console.log('Peer joined, initiating connection...');
                    if (autoReconnectTimer) { clearTimeout(autoReconnectTimer); autoReconnectTimer = null; }
                    if (peerConnection?.connectionState === 'connected' && dataChannel?.readyState === 'open') break;
                    if (isNegotiating || peerConnection?.iceConnectionState === 'checking' || peerConnection?.connectionState === 'connecting') {
                        console.log('Negotiation/connecting already in progress. Ignoring duplicate peer_joined.');
                        break;
                    }
                    isNegotiating = true;
                    displaySystemMessage('Peer detected! Negotiating secure connection...');
                    if (peerConnection) handleDisconnect(false);
                    initPeerConnection();
                    await createOffer();
                    setTimeout(() => { isNegotiating = false; }, 3000);
                    break;
                case 'peer_left':
                    console.log('Peer left signaling room');
                    if (dataChannel?.readyState === 'open') {
                        break;
                    }
                    if (peerConnection?.connectionState !== 'connected') {
                        updateStatus('connecting', 'Waiting for peer...');
                        startBtn.textContent = 'Waiting for peer...';
                    }
                    break;
                case 'offer':
                    console.log('Received offer');
                    if (autoReconnectTimer) { clearTimeout(autoReconnectTimer); autoReconnectTimer = null; }
                    if (disconnectGraceTimer) { clearTimeout(disconnectGraceTimer); disconnectGraceTimer = null; }
                    if (peerConnection?.connectionState === 'connected' && dataChannel?.readyState === 'open') {
                        console.log('Already connected and dataChannel open, ignoring duplicate offer.');
                        break;
                    }
                    const isCollision = peerConnection && (peerConnection.signalingState !== 'stable' || isNegotiating);
                    if (isCollision) {
                        const isPolite = message.from && message.from < clientId;
                        if (!isPolite) {
                            console.log('Offer collision: impolite peer ignoring offer.');
                            break;
                        }
                        console.log('Offer collision: polite peer rolling back local offer.');
                        try {
                            await peerConnection.setLocalDescription({ type: 'rollback' });
                        } catch(e) {
                            if (peerConnection) handleDisconnect(false);
                            initPeerConnection();
                        }
                    } else if (!peerConnection || peerConnection.signalingState === 'closed') {
                        initPeerConnection();
                    }
                    await peerConnection.setRemoteDescription(new RTCSessionDescription(message));
                    const answer = await peerConnection.createAnswer();
                    await peerConnection.setLocalDescription(answer);
                    ws.send(JSON.stringify({
                        type: peerConnection.localDescription.type,
                        sdp: peerConnection.localDescription.sdp,
                        from: clientId
                    }));
                    break;
                case 'answer':
                    console.log('Received answer');
                    if (peerConnection) {
                        await peerConnection.setRemoteDescription(new RTCSessionDescription(message));
                    }
                    break;
                case 'ice-candidate':
                    if (peerConnection && message.candidate) {
                        await peerConnection.addIceCandidate(new RTCIceCandidate(message.candidate));
                    }
                    break;
            }
        } catch (err) {
            console.error('Error handling signaling message:', err);
        }
    };

    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        updateStatus('disconnected', 'Signaling Error');
        handleDisconnect();
    };

    ws.onclose = () => {
        console.log('WebSocket closed');
        if (!isIntentionalDisconnect) {
            if (peerConnection?.connectionState !== 'connected' || dataChannel?.readyState !== 'open') {
                handleDisconnect(false);
            }
            attemptReconnection();
        } else {
            if (peerConnection?.connectionState !== 'connected') {
                updateStatus('disconnected', 'Disconnected');
                handleDisconnect(true);
            }
        }
    };
}

function attemptReconnection() {
    const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), MAX_RECONNECT_DELAY);
    reconnectAttempts++;
    if (peerConnection?.connectionState !== 'connected' || dataChannel?.readyState !== 'open') {
        updateStatus('connecting', `Reconnecting in ${delay / 1000}s...`);
        startBtn.textContent = `Reconnecting... (${reconnectAttempts})`;
    }

    setTimeout(() => {
        if (!isIntentionalDisconnect && (!ws || ws.readyState !== WebSocket.OPEN)) {
            console.log(`Reconnection attempt ${reconnectAttempts}`);
            connectSignalingServer();
        }
    }, delay);
}

function initPeerConnection() {
    peerConnection = new RTCPeerConnection(configuration);

    peerConnection.onicecandidate = (event) => {
        if (event.candidate && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'ice-candidate',
                candidate: event.candidate
            }));
        }
    };

    peerConnection.onconnectionstatechange = () => {
        const s = peerConnection.connectionState;
        console.log('WebRTC State:', s);

        if (s === 'connected') {
            if (disconnectGraceTimer) {
                clearTimeout(disconnectGraceTimer);
                disconnectGraceTimer = null;
            }
            if (autoReconnectTimer) {
                clearTimeout(autoReconnectTimer);
                autoReconnectTimer = null;
            }
            updateStatus('connected', 'P2P Connected');
            setupContainer.style.display = 'none'; // Hide setup once connected
            if (!wasConnected) {
                displaySystemMessage('Secure P2P connection established!');
                wasConnected = true;
            }
        } else if (s === 'disconnected') {
            console.log('P2P state is disconnected. Waiting 5s grace period before teardown...');
            if (!disconnectGraceTimer) {
                disconnectGraceTimer = setTimeout(() => {
                    disconnectGraceTimer = null;
                    if (peerConnection?.connectionState === 'disconnected') {
                        wasConnected = false;
                        updateStatus('disconnected', 'P2P Disconnected');
                        displaySystemMessage('P2P connection lost. Auto-reconnecting in 2s...');
                        handleDisconnect(false);
                        scheduleAutoReconnect('P2P connection timeout');
                    }
                }, 5000);
            }
        } else if (['failed', 'closed'].includes(s)) {
            if (disconnectGraceTimer) {
                clearTimeout(disconnectGraceTimer);
                disconnectGraceTimer = null;
            }
            wasConnected = false;
            updateStatus('disconnected', 'P2P Disconnected');
            displaySystemMessage('P2P connection lost. Auto-reconnecting in 2s...');
            handleDisconnect(false);
            if (ws && ws.readyState === WebSocket.OPEN && !isIntentionalDisconnect) {
                scheduleAutoReconnect('P2P connection lost');
            } else {
                updateStatus('connecting', 'Waiting for peer...');
                startBtn.textContent = 'Waiting for peer...';
            }
        }
    };

    // When remote creates the data channel (for the answerer)
    peerConnection.ondatachannel = (event) => {
        console.log('Received data channel from peer');
        dataChannel = event.channel;
        setupDataChannel();
    };
}

async function createOffer() {
    // Initiator creates data channel before creating offer
    dataChannel = peerConnection.createDataChannel('chat-channel');
    setupDataChannel();

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    ws.send(JSON.stringify({
        type: peerConnection.localDescription.type,
        sdp: peerConnection.localDescription.sdp,
        from: clientId
    }));
}

function setupDataChannel() {
    dataChannel.onopen = () => {
        console.log('Data channel open');
        messageInput.disabled = false;
        sendBtn.disabled = false;
        if (nudgeBtn) nudgeBtn.disabled = nudgeCooldown;
        messageInput.focus();
    };

    dataChannel.onclose = () => {
        console.log('Data channel closed');
        messageInput.disabled = true;
        sendBtn.disabled = true;
        if (nudgeBtn) nudgeBtn.disabled = true;
        setEmojiButtonsDisabled(true);
    };

    dataChannel.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            if (data.type === 'text') {
                displayUserMessage(data.content, 'received', false, data.replyTo, data.id);
            } else if (data.type === 'edit_text') {
                applyMessageEdit(data.id, data.content);
            } else if (data.type === 'emoji') {
                createFloatingEmoji(data.emoji);
            } else if (data.type === 'gif') {
                displayUserMessage(data.url, 'received', true, data.replyTo);
            } else if (data.type === 'nudge') {
                handleIncomingNudge();
            } else if (data.type === 'effect') {
                if (data.name === 'stare') {
                    displaySystemMessage('👀 Peer sent you a stare!');
                } else if (data.name === 'smirk') {
                    displaySystemMessage('😏 Peer sent you a smirk!');
                }
            } else if (data.type === 'ping') {
                if (dataChannel && dataChannel.readyState === 'open') {
                    dataChannel.send(JSON.stringify({ type: 'pong' }));
                }
            } else if (data.type === 'pong') {
                // keep-alive confirmed
            }
        } catch (e) {
            // Fallback for older plaintext messages if any
            displayUserMessage(event.data, 'received');
        }
    };
}

function handleDisconnect(fullDisconnect = true) {
    clearReply();
    clearEditing();
    if (disconnectGraceTimer) {
        clearTimeout(disconnectGraceTimer);
        disconnectGraceTimer = null;
    }
    if (fullDisconnect) {
        wasConnected = false;
        if (autoReconnectTimer) {
            clearTimeout(autoReconnectTimer);
            autoReconnectTimer = null;
        }
    }
    if (dataChannel) {
        dataChannel.close();
        dataChannel = null;
    }
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }

    messageInput.disabled = true;
    sendBtn.disabled = true;
    gifBtn.disabled = true;
    if (nudgeBtn) nudgeBtn.disabled = true;
    setEmojiButtonsDisabled(true);
    klipyContainer.style.display = 'none';

    setupContainer.style.display = 'flex';

    if (fullDisconnect) {
        isIntentionalDisconnect = true;
        if (ws) {
            ws.close();
        }
        startBtn.disabled = false;
        startBtn.textContent = 'Reconnect';
    } else {
        startBtn.disabled = true;
        startBtn.textContent = 'Reconnecting P2P...';
    }
}

function sendMessage() {
    const text = messageInput.value.trim();
    if (!text) return;

    if (editingMsg) {
        if (text !== editingMsg.originalContent && dataChannel?.readyState === 'open') {
            applyMessageEdit(editingMsg.id, text);
            dataChannel.send(JSON.stringify({ type: 'edit_text', id: editingMsg.id, content: text }));
        }
        messageInput.value = '';
        clearEditing();
        return;
    }

    if (dataChannel?.readyState === 'open') {
        const msgId = 'm_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        const payload = { type: 'text', id: msgId, content: text, replyTo: currentReply };
        dataChannel.send(JSON.stringify(payload));
        displayUserMessage(text, 'sent', false, currentReply, msgId);
        messageInput.value = '';
        clearReply();
    }
}

function sendGifMessage(gifUrl) {
    if (gifUrl && dataChannel?.readyState === 'open') {
        const payload = { type: 'gif', url: gifUrl, replyTo: currentReply };
        dataChannel.send(JSON.stringify(payload));
        displayUserMessage(gifUrl, 'sent', true, currentReply);
        klipyContainer.style.display = 'none';
        clearReply();
    }
}

function sendEmoji(emojiChar) {
    if (dataChannel?.readyState === 'open') {
        const payload = { type: 'emoji', emoji: emojiChar };
        dataChannel.send(JSON.stringify(payload));
        createFloatingEmoji(emojiChar);
    }
}

sendBtn.addEventListener('click', sendMessage);
messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        sendMessage();
    } else if (e.key === 'Escape') {
        if (editingMsg) {
            clearEditing();
            messageInput.value = '';
        } else {
            clearReply();
        }
    } else if (e.key === 'ArrowUp' && !messageInput.value.trim() && !editingMsg) {
        const sentMsgs = document.querySelectorAll('.message.sent[data-msg-id]');
        for (let idx = sentMsgs.length - 1; idx >= 0; idx--) {
            const m = sentMsgs[idx];
            const textEl = m.querySelector('.msg-text');
            if (textEl && !m.querySelector('.gif-container')) {
                const editBtn = m.querySelector('.edit-btn');
                if (editBtn) {
                    editBtn.click();
                    e.preventDefault();
                    break;
                }
            }
        }
    }
});

emojiButtons.forEach(btn => {
    // Disable initially until connected
    btn.disabled = true;
    btn.addEventListener('click', () => {
        const emoji = btn.getAttribute('data-emoji');
        sendEmoji(emoji);
    });
});

function setEmojiButtonsDisabled(disabled) {
    emojiButtons.forEach(btn => btn.disabled = disabled);
}

function displayUserMessage(text, type, isGif = false, replyTo = null, msgId = null) {
    const msgDiv = document.createElement('div');
    msgDiv.classList.add('message', type);
    if (msgId) msgDiv.dataset.msgId = msgId;

    if (replyTo) {
        const quote = document.createElement('div');
        quote.classList.add('reply-preview');
        quote.innerHTML = `
            <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
                <path d="M6 3L2 7l4 4"/>
                <path d="M2 7h7a4 4 0 0 1 4 4v2"/>
            </svg>
            <span class="reply-preview-text"></span>
        `;
        quote.querySelector('.reply-preview-text').textContent = replyTo;
        msgDiv.appendChild(quote);
    }

    if (isGif) {
        if (!replyTo) {
            msgDiv.style.background = 'transparent';
            msgDiv.style.padding = '0';
            msgDiv.style.border = 'none';
        }
        const img = document.createElement('img');
        img.src = text;
        img.classList.add('gif-content');

        const container = document.createElement('div');
        container.classList.add('gif-container');
        container.appendChild(img);
        msgDiv.appendChild(container);
    } else {
        const span = document.createElement('span');
        span.className = 'msg-text';
        span.textContent = text;
        msgDiv.appendChild(span);
    }

    if (type === 'received') {
        const replyBtn = document.createElement('button');
        replyBtn.className = 'reply-btn';
        replyBtn.type = 'button';
        replyBtn.title = 'Reply';
        replyBtn.innerHTML = `
            <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
                <path d="M6 3L2 7l4 4"/>
                <path d="M2 7h7a4 4 0 0 1 4 4v2"/>
            </svg>
            <span>Reply</span>
        `;
        replyBtn.onclick = () => setReply(isGif ? '[GIF]' : text);
        msgDiv.appendChild(replyBtn);
    } else if (type === 'sent' && !isGif && msgId) {
        const editBtn = document.createElement('button');
        editBtn.className = 'edit-btn';
        editBtn.type = 'button';
        editBtn.title = 'Edit';
        editBtn.innerHTML = `
            <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
                <path d="M11.5 2.5a1.414 1.414 0 0 1 2 2L5 13H2v-3L10.5 1.5z"/>
            </svg>
            <span>Edit</span>
        `;
        editBtn.onclick = () => setEditing(msgId, text);
        msgDiv.appendChild(editBtn);
    }

    appendMessageElement(msgDiv);
}

function appendMessageElement(element) {
    chatMessages.appendChild(element);
    // Smooth scroll to bottom
    chatMessages.scrollTo({
        top: chatMessages.scrollHeight,
        behavior: 'smooth'
    });
}

function createFloatingEmoji(emojiChar) {
    const emojiEl = document.createElement('div');
    emojiEl.classList.add('floating-emoji');
    emojiEl.textContent = emojiChar;

    // Randomize horizontal position between 10% and 90% of the container
    const randomLeft = 10 + Math.random() * 80;
    emojiEl.style.left = `${randomLeft}%`;

    // Smooth continuous duration and natural alternating sway
    const randomDuration = 3.4 + Math.random() * 0.8;
    const animName = Math.random() > 0.5 ? 'floatUp' : 'floatUpAlt';
    emojiEl.style.animation = `${animName} ${randomDuration}s linear forwards`;

    chatContainer.appendChild(emojiEl);

    // Clean up after animation completes
    setTimeout(() => {
        emojiEl.remove();
    }, randomDuration * 1000);
}

// Enable emoji & gif buttons when data channel opens
const originalSetupDataChannel = setupDataChannel;
setupDataChannel = function () {
    originalSetupDataChannel();
    if (dataChannel) {
        dataChannel.addEventListener('open', () => {
            setEmojiButtonsDisabled(false);
            gifBtn.disabled = false;
            if (nudgeBtn) nudgeBtn.disabled = nudgeCooldown;
        });
    }
};

/* --- Klipy GIF Search Implementation --- */
// Añade tu API Key de Klipy aquí (de lo contrario, los endpoints públicos funcionarán de forma limitada)
const KLIPY_API_KEY = 'myMchPMlqDxJKpeSzJfOLCFrTpZqdqCLLF9Uf6RPKjxIPmeqxy6k5EPgo2PFivAI';
let searchTimeout;
let currentGifOffset = 0;
let currentGifQuery = '';
let isLoadingGifs = false;
let hasMoreGifs = true;
const GIF_LIMIT = 20;

// Toggle GIF container
gifBtn.addEventListener('click', () => {
    if (klipyContainer.style.display === 'none') {
        klipyContainer.style.display = 'flex';
        klipySearch.focus();
        if (klipyResults.children.length === 0) {
            currentGifQuery = '';
            fetchTrendingGifs(true);
        }
    } else {
        klipyContainer.style.display = 'none';
    }
});

klipyClose.addEventListener('click', () => {
    klipyContainer.style.display = 'none';
});

// Search input with debounce
klipySearch.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    const query = e.target.value.trim();

    if (query.length === 0) {
        currentGifQuery = '';
        fetchTrendingGifs(true);
        return;
    }

    // Klipy API recommends searching after a short delay
    searchTimeout = setTimeout(() => {
        currentGifQuery = query;
        searchKlipyGifs(query, true);
    }, 500);
});

// Infinite Scroll for GIF results
klipyResults.addEventListener('scroll', () => {
    if (isLoadingGifs || !hasMoreGifs) return;

    // Check if scrolled near the bottom (100px threshold)
    if (klipyResults.scrollTop + klipyResults.clientHeight >= klipyResults.scrollHeight - 100) {
        if (currentGifQuery) {
            searchKlipyGifs(currentGifQuery, false);
        } else {
            fetchTrendingGifs(false);
        }
    }
});

async function fetchTrendingGifs(reset = false) {
    if (reset) {
        klipyResults.innerHTML = '';
        klipyResults.classList.add('loading');
        currentGifOffset = 0;
        hasMoreGifs = true;
    }

    if (isLoadingGifs || !hasMoreGifs) return;
    isLoadingGifs = true;

    try {
        const url = KLIPY_API_KEY
            ? `https://api.klipy.co/api/v1/${KLIPY_API_KEY}/gifs/trending?limit=${GIF_LIMIT}&offset=${currentGifOffset}`
            : `https://api.klipy.co/api/v1/gifs/trending?limit=${GIF_LIMIT}&offset=${currentGifOffset}`;

        const response = await fetch(url);
        const data = await response.json();
        const newGifs = data.data?.data || [];

        if (newGifs.length === 0) {
            hasMoreGifs = false;
        } else {
            currentGifOffset += GIF_LIMIT;
            renderGifs(newGifs, reset);
        }
    } catch (error) {
        console.error('Error fetching trending GIFs:', error);
        if (reset) klipyResults.innerHTML = '<p class="hint">Failed to load GIFs.</p>';
    } finally {
        if (reset) klipyResults.classList.remove('loading');
        isLoadingGifs = false;
    }
}

async function searchKlipyGifs(query, reset = false) {
    if (reset) {
        klipyResults.innerHTML = '';
        klipyResults.classList.add('loading');
        currentGifOffset = 0;
        hasMoreGifs = true;
    }

    if (isLoadingGifs || !hasMoreGifs) return;
    isLoadingGifs = true;

    try {
        const url = KLIPY_API_KEY
            ? `https://api.klipy.co/api/v1/${KLIPY_API_KEY}/gifs/search?q=${encodeURIComponent(query)}&limit=${GIF_LIMIT}&offset=${currentGifOffset}`
            : `https://api.klipy.co/api/v1/gifs/search?q=${encodeURIComponent(query)}&limit=${GIF_LIMIT}&offset=${currentGifOffset}`;

        const response = await fetch(url);
        const data = await response.json();
        const newGifs = data.data?.data || [];

        if (newGifs.length === 0) {
            hasMoreGifs = false;
        } else {
            currentGifOffset += GIF_LIMIT;
            renderGifs(newGifs, reset);
        }
    } catch (error) {
        console.error('Error searching GIFs:', error);
        if (reset) klipyResults.innerHTML = '<p class="hint">Failed to load GIFs.</p>';
    } finally {
        if (reset) klipyResults.classList.remove('loading');
        isLoadingGifs = false;
    }
}

function renderGifs(gifs, reset = false) {
    if (reset) {
        klipyResults.innerHTML = '';
    }

    if (gifs.length === 0 && reset) {
        klipyResults.innerHTML = '<p class="hint">No GIFs found.</p>';
        return;
    }

    gifs.forEach(gifData => {
        // Klipy typically returns multiple formats. We prefer downsized or original.
        const imageUrl = gifData.file?.sm?.gif?.url || gifData.file?.md?.gif?.url || gifData.images?.downsized?.url || gifData.images?.original?.url || gifData.url;
        if (!imageUrl) return;

        const img = document.createElement('img');
        img.src = imageUrl;
        img.classList.add('gif-item');
        img.loading = 'lazy';

        img.addEventListener('click', () => {
            sendGifMessage(imageUrl);
        });

        klipyResults.appendChild(img);
    });
}

/* --- MSN Nudge / Zumbido Implementation --- */
let nudgeCooldown = false;

function playNudgeSound() {
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        const now = ctx.currentTime;

        const osc1 = ctx.createOscillator(), gain1 = ctx.createGain();
        osc1.type = 'sawtooth';
        osc1.frequency.setValueAtTime(140, now);
        osc1.frequency.exponentialRampToValueAtTime(45, now + 0.12);
        gain1.gain.setValueAtTime(0.25, now);
        gain1.gain.exponentialRampToValueAtTime(0.01, now + 0.12);
        osc1.connect(gain1); gain1.connect(ctx.destination);
        osc1.start(now); osc1.stop(now + 0.12);

        const osc2 = ctx.createOscillator(), gain2 = ctx.createGain();
        osc2.type = 'sawtooth';
        osc2.frequency.setValueAtTime(170, now + 0.14);
        osc2.frequency.exponentialRampToValueAtTime(40, now + 0.38);
        gain2.gain.setValueAtTime(0.3, now + 0.14);
        gain2.gain.exponentialRampToValueAtTime(0.01, now + 0.38);
        osc2.connect(gain2); gain2.connect(ctx.destination);
        osc2.start(now + 0.14); osc2.stop(now + 0.38);

        setTimeout(() => { try { ctx.close(); } catch (e) {} }, 500);
    } catch (e) {}
}

function triggerNudgeEffect() {
    if (chatContainer) {
        chatContainer.classList.remove('shaking');
        void chatContainer.offsetWidth;
        chatContainer.classList.add('shaking');
        setTimeout(() => chatContainer.classList.remove('shaking'), 600);
    }
    playNudgeSound();
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
        try { navigator.vibrate([100, 50, 100, 50, 150]); } catch (e) {}
    }
}

function sendNudge() {
    if (nudgeCooldown) {
        displaySystemMessage('⏳ No puedes enviar un zumbido tan seguido.');
        return;
    }
    if (!dataChannel || dataChannel.readyState !== 'open') return;

    dataChannel.send(JSON.stringify({ type: 'nudge' }));
    triggerNudgeEffect();
    displaySystemMessage('🔔 Has enviado un zumbido.');

    nudgeCooldown = true;
    if (nudgeBtn) {
        nudgeBtn.disabled = true;
        nudgeBtn.style.opacity = '0.3';
    }
    setTimeout(() => {
        nudgeCooldown = false;
        if (dataChannel?.readyState === 'open' && nudgeBtn) {
            nudgeBtn.disabled = false;
            nudgeBtn.style.opacity = '';
        }
    }, 5000);
}

function handleIncomingNudge() {
    triggerNudgeEffect();
    displaySystemMessage('💥 ¡Te han enviado un zumbido!');
}

if (nudgeBtn) {
    nudgeBtn.addEventListener('click', sendNudge);
}
