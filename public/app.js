const startBtn = document.getElementById('start-btn');
const setupContainer = document.getElementById('setup-container');
const statusBadge = document.getElementById('connection-status');
const messageInput = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');
const chatMessages = document.getElementById('chat-messages');
const emojiButtons = document.querySelectorAll('.emoji-btn');
const chatContainer = document.querySelector('.chat-container');

// Klipy Elements
const gifBtn = document.getElementById('gif-btn');
const klipyContainer = document.getElementById('klipy-container');
const klipySearch = document.getElementById('klipy-search');
const klipyClose = document.getElementById('klipy-close');
const klipyResults = document.getElementById('klipy-results');

let ws;
let peerConnection;
let dataChannel;

// Public STUN servers for NAT Traversal
const configuration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

startBtn.addEventListener('click', () => {
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
        updateStatus('connecting', 'Waiting for peer...');
        startBtn.textContent = 'Waiting for peer...';
        displaySystemMessage('Connected to signaling server. Waiting for a peer to join...');
    };

    ws.onmessage = async (event) => {
        const message = JSON.parse(event.data);
        console.log('Signal received:', message.type);

        try {
            switch (message.type) {
                case 'peer_joined':
                    // Another peer joined. If we are already here, we can initiate the WebRTC offer.
                    console.log('Peer joined, initiating connection...');
                    displaySystemMessage('Peer detected! Negotiating secure connection...');
                    initPeerConnection();
                    await createOffer();
                    break;
                case 'peer_left':
                    console.log('Peer left');
                    displaySystemMessage('Peer disconnected from the network.');
                    handleDisconnect();
                    break;
                case 'offer':
                    console.log('Received offer');
                    if (!peerConnection) initPeerConnection();
                    await peerConnection.setRemoteDescription(new RTCSessionDescription(message));
                    const answer = await peerConnection.createAnswer();
                    await peerConnection.setLocalDescription(answer);
                    ws.send(JSON.stringify(peerConnection.localDescription));
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
        if (peerConnection?.connectionState !== 'connected') {
            updateStatus('disconnected', 'Disconnected');
            handleDisconnect();
        }
    };
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
        console.log('WebRTC State:', peerConnection.connectionState);

        if (peerConnection.connectionState === 'connected') {
            updateStatus('connected', 'P2P Connected');
            setupContainer.style.display = 'none'; // Hide setup once connected
            displaySystemMessage('Secure P2P connection established!');

        } else if (['disconnected', 'failed', 'closed'].includes(peerConnection.connectionState)) {
            updateStatus('disconnected', 'P2P Disconnected');
            displaySystemMessage('P2P connection lost.');
            handleDisconnect();
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
    ws.send(JSON.stringify(peerConnection.localDescription));
}

function setupDataChannel() {
    dataChannel.onopen = () => {
        console.log('Data channel open');
        messageInput.disabled = false;
        sendBtn.disabled = false;
        messageInput.focus();
    };

    dataChannel.onclose = () => {
        console.log('Data channel closed');
        messageInput.disabled = true;
        sendBtn.disabled = true;
        setEmojiButtonsDisabled(true);
    };

    dataChannel.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            if (data.type === 'text') {
                displayUserMessage(data.content, 'received');
            } else if (data.type === 'emoji') {
                createFloatingEmoji(data.emoji);
            } else if (data.type === 'gif') {
                displayUserMessage(data.url, 'received', true);
            }
        } catch (e) {
            // Fallback for older plaintext messages if any
            displayUserMessage(event.data, 'received');
        }
    };
}

function handleDisconnect() {
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
    setEmojiButtonsDisabled(true);
    klipyContainer.style.display = 'none';

    setupContainer.style.display = 'flex';
    startBtn.disabled = false;
    startBtn.textContent = 'Reconnect';
}

function sendMessage() {
    const text = messageInput.value.trim();
    if (text && dataChannel?.readyState === 'open') {
        const payload = { type: 'text', content: text };
        dataChannel.send(JSON.stringify(payload));
        displayUserMessage(text, 'sent');
        messageInput.value = '';
    }
}

function sendGifMessage(gifUrl) {
    if (gifUrl && dataChannel?.readyState === 'open') {
        const payload = { type: 'gif', url: gifUrl };
        dataChannel.send(JSON.stringify(payload));
        displayUserMessage(gifUrl, 'sent', true);
        klipyContainer.style.display = 'none';
        klipySearch.value = '';
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

function displayUserMessage(text, type, isGif = false) {
    const msgDiv = document.createElement('div');
    msgDiv.classList.add('message', type);

    if (isGif) {
        msgDiv.style.background = 'transparent';
        msgDiv.style.padding = '0';
        msgDiv.style.border = 'none';
        const img = document.createElement('img');
        img.src = text;
        img.classList.add('gif-content');

        const container = document.createElement('div');
        container.classList.add('gif-container');
        container.appendChild(img);
        msgDiv.appendChild(container);
    } else {
        msgDiv.textContent = text;
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

    // Add jitter to animation duration
    const randomDuration = 2.5 + Math.random();
    emojiEl.style.animationDuration = `${randomDuration}s`;

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
        });
    }
};

/* --- Klipy GIF Search Implementation --- */
// Añade tu API Key de Klipy aquí (de lo contrario, los endpoints públicos funcionarán de forma limitada)
const KLIPY_API_KEY = 'myMchPMlqDxJKpeSzJfOLCFrTpZqdqCLLF9Uf6RPKjxIPmeqxy6k5EPgo2PFivAI';
let searchTimeout;

// Toggle GIF container
gifBtn.addEventListener('click', () => {
    if (klipyContainer.style.display === 'none') {
        klipyContainer.style.display = 'flex';
        klipySearch.focus();
        fetchTrendingGifs();
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
        fetchTrendingGifs();
        return;
    }

    // Klipy API recommends searching after a short delay
    searchTimeout = setTimeout(() => {
        searchKlipyGifs(query);
    }, 500);
});

async function fetchTrendingGifs() {
    klipyResults.innerHTML = '';
    klipyResults.classList.add('loading');

    try {
        const url = KLIPY_API_KEY
            ? `https://api.klipy.co/v2/gifs/trending?limit=20&api_key=${KLIPY_API_KEY}`
            : 'https://api.klipy.co/v2/gifs/trending?limit=20';

        const response = await fetch(url);
        const data = await response.json();
        renderGifs(data.data || []);
    } catch (error) {
        console.error('Error fetching trending GIFs:', error);
        klipyResults.innerHTML = '<p class="hint">Failed to load GIFs.</p>';
    } finally {
        klipyResults.classList.remove('loading');
    }
}

async function searchKlipyGifs(query) {
    klipyResults.innerHTML = '';
    klipyResults.classList.add('loading');

    try {
        const url = KLIPY_API_KEY
            ? `https://api.klipy.co/v2/gifs/search?q=${encodeURIComponent(query)}&limit=20&api_key=${KLIPY_API_KEY}`
            : `https://api.klipy.co/v2/gifs/search?q=${encodeURIComponent(query)}&limit=20`;

        const response = await fetch(url);
        const data = await response.json();
        renderGifs(data.data || []);
    } catch (error) {
        console.error('Error searching GIFs:', error);
        klipyResults.innerHTML = '<p class="hint">Failed to load GIFs.</p>';
    } finally {
        klipyResults.classList.remove('loading');
    }
}

function renderGifs(gifs) {
    klipyResults.innerHTML = '';

    if (gifs.length === 0) {
        klipyResults.innerHTML = '<p class="hint">No GIFs found.</p>';
        return;
    }

    gifs.forEach(gifData => {
        // Klipy typically returns multiple formats. We prefer downsized or original.
        const imageUrl = gifData.images?.downsized?.url || gifData.images?.original?.url || gifData.url;
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
