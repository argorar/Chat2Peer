// ==UserScript==
// @name         Chat2Peer for Netflix
// @namespace    https://github.com/argorar/Chat2Peer
// @version      1.15.4
// @description  P2P encrypted chat sidebar for Netflix — WebRTC powered with Video Sync
// @author       argorar
// @match        https://www.netflix.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      api.klipy.co
// @connect      cdn.pixabay.com
// @connect      raw.githubusercontent.com
// @updateURL    https://raw.githubusercontent.com/argorar/Chat2Peer/main/Chat2Peer-Netflix.user.js
// @downloadURL  https://raw.githubusercontent.com/argorar/Chat2Peer/main/Chat2Peer-Netflix.user.js
// @noframes
// @run-at       document-idle
// @icon         https://www.netflix.com/favicon.ico
// ==/UserScript==

(function () {
  'use strict';
  if (window.top !== window.self) return;
  if (document.getElementById('c2p-sidebar')) return;

  // ── Polyfills for Safari / Basic Extensions ──
  const getVal = typeof GM_getValue !== 'undefined' ? GM_getValue : (k, d) => localStorage.getItem('c2p_' + k) || d;
  const setVal = typeof GM_setValue !== 'undefined' ? GM_setValue : (k, v) => localStorage.setItem('c2p_' + k, v);
  const addStyle = typeof GM_addStyle !== 'undefined' ? GM_addStyle : (css) => {
    const s = document.createElement('style');
    s.textContent = css;
    (document.head || document.documentElement).appendChild(s);
  };

  // ── State ──
  const SCRIPT_VERSION = (typeof GM_info !== 'undefined' && GM_info?.script?.version) || '0.0.0';
  const SCRIPT_UPDATE_URL = 'https://raw.githubusercontent.com/argorar/Chat2Peer/main/Chat2Peer-Netflix.user.js';
  let isCheckingUpdate = false;
  let hasCheckedUpdate = false;
  let ws = null, peerConnection = null, dataChannel = null, sidebarVisible = false;
  let serverUrl = getVal('serverUrl', 'wss://chat2peer.onrender.com/ws');
  let nickname = getVal('nickname', '');
  let reconnectAttempts = 0;
  let reconnectTimer = null;
  let autoReconnectTimer = null;
  let disconnectGraceTimer = null;
  let wasConnected = false;
  const clientId = Math.random().toString(36).substring(2, 9);
  let isIntentionalDisconnect = false;
  let isPeerDisconnected = false;
  let isNegotiating = false;
  let lastOfferReceived = 0;
  const MAX_RECONNECT_DELAY = 10000;
  const ICE_CONFIG = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun.cloudflare.com:3478' }
    ]
  };
  const EMOJIS = ['🙈','🥰','😂','😲','😭','🔥','🎉','😘','😍','😎'];
  const SOUND_EFFECTS = [
    { svg: '<path d="M17 14V2"/><path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z"/>', name: 'Booh', url: 'https://cdn.pixabay.com/audio/2022/01/18/audio_6102704874.mp3' },
    { svg: '<path d="M2 12a50.5 50.5 0 0 0 20 0a1 1 0 0 0-1-1"/><path d="M2.457 11.159a1 1 0 0 0-.307 1.369a11.59 11.59 0 0 0 19.7 0a1 1 0 0 0-.308-1.368c-2.426-1.568-3.65-2.284-5.479-3.644a2.6 2.6 0 0 0-3.373.208a1 1 0 0 1-1.38 0a2.62 2.62 0 0 0-3.373-.208c-1.83 1.36-3.053 2.076-5.48 3.643"/>', name: 'Kiss', url: 'https://cdn.pixabay.com/audio/2025/02/05/audio_3a6957e546.mp3' },
    { svg: '<path d="M2 10h2M6 6v8M10 3v14M14 7v6M18 9v2M22 10h-2"/>', name: 'Fart', url: 'https://cdn.pixabay.com/audio/2025/05/01/audio_7be5cc9c12.mp3' },
    { svg: '<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/>', name: 'Laugh', url: 'https://cdn.pixabay.com/audio/2023/05/11/audio_3f41bc76a6.mp3' },
    { svg: '<circle cx="12" cy="12" r="10"/><path d="M16 16s-1.5-2-4-2-4 2-4 2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/><path d="M7 6l2 2M17 6l-2 2"/>', name: 'Evil', url: 'https://cdn.pixabay.com/audio/2022/03/15/audio_6b3f80310f.mp3' },
    { svg: '<path d="M18 11V6a2 2 0 0 0-4 0v5"/><path d="M14 10V4a2 2 0 0 0-4 0v8"/><path d="M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-6-2.34l-3.6-3.6a2 2 0 0 1 2.8-2.8L7 15"/>', name: 'Claps', url: 'https://cdn.pixabay.com/audio/2022/03/10/audio_b80daabd57.mp3' },
    { svg: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>', name: 'Slap', url: 'https://cdn.pixabay.com/audio/2022/03/10/audio_367e863251.mp3' },
    { svg: '<path d="M3 6h5l-5 5h5M12 11h5l-5 5h5M17 17h4l-4 4h4"/>', name: 'Snore', url: 'https://cdn.pixabay.com/audio/2025/05/06/audio_47fc2577b3.mp3' }
  ];
  const SPECIAL_EFFECTS = [
    { id: 'celebration', name: 'Celebration', icon: '🎉', title: 'Celebration (Confetti)' },
    { id: 'fireworks', name: 'Fireworks', icon: '🎆', title: 'Fireworks' },
    { id: 'tomato', name: 'Tomato Splat', icon: '🍅', title: 'Tomato Splat' },
    { id: 'dance', name: 'Dance', icon: '🕺', title: 'Disco Dance' },
    { id: 'stare', name: 'Stare', icon: '👀', title: 'Stare (Eyes)' },
    { id: 'smirk', name: 'Smirk', icon: '😏', title: 'Smirk' },
    { id: 'knock', name: 'Knock', icon: '✊', title: 'Knock' },
    { id: 'sheep', name: 'Sheep', icon: '🐑', title: 'Sheep' },
    { id: 'eyebrow', name: 'Eyebrow', icon: '🤨', title: 'Eyebrow' },
    { id: 'disgusted', name: 'Disgusted', icon: '🤢', title: 'Disgusted' }
  ];

  // ── Klipy GIF State ──
  const KLIPY_API_KEY = 'myMchPMlqDxJKpeSzJfOLCFrTpZqdqCLLF9Uf6RPKjxIPmeqxy6k5EPgo2PFivAI';
  const GIF_LIMIT = 20;
  let gifSearchTimeout = null, currentGifOffset = 0, currentGifQuery = '', isLoadingGifs = false, hasMoreGifs = true;

  // ── Sync State ──
  let suppressBroadcast = 0;
  let syncInterval = null;
  let lastPlayerState = null;
  let currentVideoId = null;
  let lastSeekTime = 0;
  const DRIFT_THRESHOLD = 2500;
  const PLAY_DRIFT_THRESHOLD = 5000;
  const SEEK_GRACE_PERIOD_MS = 5000;

  // ── Voice Notes State ──
  let mediaRecorder = null, audioChunks = [], recordTimerInterval = null, recordStartTime = 0;
  let incomingAudioChunks = {};
  let currentVoiceAudio = null;

  // ── Clipboard Images State ──
  let incomingImageChunks = {};
  let pendingImageBlob = null;
  let pendingImageThumbUrl = null;

  // ── Typing Indicator State ──
  let localTypingTimeout = null, isTypingLocally = false, remoteTypingTimeout = null;

  // ── Auto-scroll & User Scroll State ──
  let userScrolledUp = false, hasUnreadBelow = false;
  const SCROLL_THRESHOLD = 80;

  // ── Focus & Input Protection State ──
  let activeSidebarInput = null, userClickedOutside = false;
  document.addEventListener('mousedown', (e) => {
    const insideSidebar = e.target && e.target.closest && (e.target.closest('#c2p-sidebar') || e.target.closest('#c2p-toggle-btn'));
    if (!insideSidebar) {
      userClickedOutside = true;
      activeSidebarInput = null;
    } else {
      userClickedOutside = false;
    }
  }, true);

  // ── Settings ──
  function openSettingsModal() {
    if (!sidebarVisible) toggleSidebar(true);
    const kc = document.getElementById('c2p-klipy-container');
    if (kc) kc.style.display = 'none';
    const modal = document.getElementById('c2p-settings-modal');
    if (!modal) return;
    const nickInput = document.getElementById('c2p-setting-nickname');
    const serverInput = document.getElementById('c2p-setting-server');
    const hint = document.getElementById('c2p-server-hint');
    if (nickInput) nickInput.value = nickname || '';
    if (serverInput) {
      serverInput.value = serverUrl || '';
      serverInput.classList.remove('c2p-input-error');
    }
    if (hint) {
      hint.textContent = 'WebSocket URL for WebRTC handshake';
      hint.style.color = '';
    }
    const updateStatus = document.getElementById('c2p-update-status');
    const updateBtn = document.getElementById('c2p-check-update-btn');
    if (updateStatus && !isCheckingUpdate && !updateStatus.textContent.includes('Update available')) {
      updateStatus.textContent = `v${SCRIPT_VERSION} (Installed)`;
      updateStatus.style.color = '';
    }
    if (updateBtn && !isCheckingUpdate && !updateBtn.textContent.startsWith('Install')) {
      updateBtn.disabled = false;
      updateBtn.textContent = 'Check for updates';
      updateBtn.onclick = () => checkForScriptUpdates(true);
    }
    modal.style.display = 'flex';
    if (serverInput) {
      activeSidebarInput = serverInput;
      setTimeout(() => serverInput.focus(), 50);
    }
  }

  function closeSettingsModal() {
    const modal = document.getElementById('c2p-settings-modal');
    if (!modal) return;
    modal.style.display = 'none';
    focusMsgInput();
  }

  function toggleSettingsModal() {
    const modal = document.getElementById('c2p-settings-modal');
    if (!modal) return;
    if (modal.style.display === 'flex') {
      closeSettingsModal();
    } else {
      openSettingsModal();
    }
  }

  function saveSettings() {
    const serverInput = document.getElementById('c2p-setting-server');
    const nickInput = document.getElementById('c2p-setting-nickname');
    const hint = document.getElementById('c2p-server-hint');
    if (!serverInput) return;

    let newUrl = serverInput.value.trim();
    const newNick = nickInput ? nickInput.value.trim() : '';

    if (newUrl && !newUrl.startsWith('ws://') && !newUrl.startsWith('wss://')) {
      serverInput.classList.add('c2p-input-error');
      if (hint) {
        hint.textContent = '⚠ URL must start with ws:// or wss://';
        hint.style.color = '#ef4444';
      }
      serverInput.focus();
      return;
    }

    serverInput.classList.remove('c2p-input-error');
    if (hint) {
      hint.textContent = 'WebSocket URL for WebRTC handshake';
      hint.style.color = '';
    }

    const prevUrl = serverUrl;
    serverUrl = newUrl;
    setVal('serverUrl', serverUrl);

    nickname = newNick;
    setVal('nickname', nickname);

    if (serverUrl) {
      const h = document.getElementById('c2p-setup-hint');
      if (h && h.textContent.includes('Server URL')) {
        h.innerHTML = 'Click to connect and wait for a peer.';
        h.style.color = '';
      }
    }

    closeSettingsModal();
    displaySystemMessage('Settings saved.', 'refresh');

    if (prevUrl !== serverUrl && (ws || peerConnection)) {
      displayActionMessage('Server URL changed. Reconnect now?', 'Reconnect', forceFreshReconnect, 'refresh');
    }
  }

  function isNewerVersion(remote, local) {
    const r = (remote || '').split('.').map(n => parseInt(n, 10) || 0);
    const l = (local || '').split('.').map(n => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(r.length, l.length); i++) {
      const rv = r[i] || 0;
      const lv = l[i] || 0;
      if (rv > lv) return true;
      if (rv < lv) return false;
    }
    return false;
  }

  function checkForScriptUpdates(interactive = true) {
    if (isCheckingUpdate) return;
    isCheckingUpdate = true;
    const btn = document.getElementById('c2p-check-update-btn');
    const statusEl = document.getElementById('c2p-update-status');
    if (btn) { btn.disabled = true; btn.textContent = 'Checking...'; }
    if (statusEl) { statusEl.textContent = 'Checking GitHub for updates...'; statusEl.style.color = '#888'; }

    const url = `${SCRIPT_UPDATE_URL}?t=${Date.now()}`;

    const handleSuccess = (responseText) => {
      isCheckingUpdate = false;
      const match = responseText.match(/\/\/\s*@version\s+([0-9.]+)/);
      const remoteVersion = match ? match[1] : null;

      if (!remoteVersion) {
        handleError(new Error('Version not found in remote script'));
        return;
      }

      if (isNewerVersion(remoteVersion, SCRIPT_VERSION)) {
        if (btn) {
          btn.disabled = false;
          btn.textContent = 'Install v' + remoteVersion;
          btn.onclick = () => window.open(SCRIPT_UPDATE_URL, '_blank');
        }
        if (statusEl) {
          statusEl.innerHTML = `Update available: <b style="color:#10b981;">v${remoteVersion}</b>`;
          statusEl.style.color = '#10b981';
        }
        displayActionMessage(`New version available (v${remoteVersion}).`, 'Install Update', () => window.open(SCRIPT_UPDATE_URL, '_blank'), 'refresh');
      } else {
        if (btn) {
          btn.disabled = false;
          btn.textContent = 'Check for updates';
          btn.onclick = () => checkForScriptUpdates(true);
        }
        if (statusEl) {
          statusEl.textContent = `✓ Latest version installed (v${SCRIPT_VERSION})`;
          statusEl.style.color = '#10b981';
        }
        if (interactive) displaySystemMessage(`Chat2Peer is up to date (v${SCRIPT_VERSION}).`, 'refresh');
      }
    };

    const handleError = (err) => {
      isCheckingUpdate = false;
      console.warn('[C2P] Update check failed:', err);
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Retry check';
        btn.onclick = () => checkForScriptUpdates(true);
      }
      if (statusEl) {
        statusEl.textContent = '⚠ Could not check updates';
        statusEl.style.color = '#ef4444';
      }
      if (interactive) displaySystemMessage('Could not check for updates. Check connection.', 'warn');
    };

    if (typeof GM_xmlhttpRequest !== 'undefined') {
      try {
        GM_xmlhttpRequest({
          method: 'GET',
          url: url,
          timeout: 10000,
          onload: (res) => {
            if (res.status >= 200 && res.status < 300) handleSuccess(res.responseText);
            else handleError(new Error('Status ' + res.status));
          },
          onerror: handleError,
          ontimeout: () => handleError(new Error('Timeout'))
        });
        return;
      } catch (e) {}
    }

    fetch(url)
      .then(res => {
        if (!res.ok) throw new Error('Status ' + res.status);
        return res.text();
      })
      .then(handleSuccess)
      .catch(handleError);
  }

  function checkUpdateOnFirstOpen() {
    if (hasCheckedUpdate) return;
    hasCheckedUpdate = true;
    setTimeout(() => {
      checkForScriptUpdates(false);
    }, 1200);
  }

  function promptServerUrl() { openSettingsModal(); }
  function promptNickname() { openSettingsModal(); }

  if (typeof GM_registerMenuCommand !== 'undefined') {
    GM_registerMenuCommand('⚙️ Settings', openSettingsModal);
    GM_registerMenuCommand('🔄 Check for Updates', () => {
      openSettingsModal();
      checkForScriptUpdates(true);
    });
  }

  // ── Inject CSS ──
  addStyle(`
#c2p-sidebar{position:fixed;top:0;right:0;width:360px;height:100vh;background:rgba(20,20,20,.92);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);border-left:1px solid rgba(255,255,255,.06);display:flex;flex-direction:column;z-index:2147483640;font-family:'Segoe UI',system-ui,-apple-system,sans-serif;color:#e5e5e5;transform:translateX(0);transition:transform .35s cubic-bezier(.22,1,.36,1),box-shadow .35s ease;box-shadow:-8px 0 32px rgba(0,0,0,.5)}
#c2p-sidebar.c2p-hidden{transform:translateX(100%);box-shadow:none}
#c2p-toggle-btn{position:fixed;right:16px;bottom:80px;width:52px;height:52px;background:linear-gradient(135deg,#e50914,#b20710);border:none;border-radius:50%;color:#fff;font-size:22px;cursor:pointer;z-index:2147483641;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 20px rgba(229,9,20,.4),0 0 0 3px rgba(229,9,20,.15);transition:all .3s cubic-bezier(.22,1,.36,1);animation:c2p-pulse-btn 3s infinite}
#c2p-toggle-btn:hover{transform:scale(1.1);box-shadow:0 6px 28px rgba(229,9,20,.5),0 0 0 5px rgba(229,9,20,.2)}
#c2p-toggle-btn:active{transform:scale(.95)}
#c2p-toggle-btn.c2p-sidebar-open{display:none}
#c2p-toggle-btn svg{width:24px;height:24px;display:block}
@keyframes c2p-pulse-btn{0%,100%{box-shadow:0 4px 20px rgba(229,9,20,.4),0 0 0 3px rgba(229,9,20,.15)}50%{box-shadow:0 4px 28px rgba(229,9,20,.6),0 0 0 8px rgba(229,9,20,.08)}}
#c2p-sidebar .c2p-header{padding:16px 20px;background:linear-gradient(180deg,rgba(30,30,30,.9),rgba(20,20,20,.7));border-bottom:1px solid rgba(255,255,255,.06);display:flex;justify-content:space-between;align-items:center;flex-shrink:0;position:relative;z-index:20}
#c2p-sidebar .c2p-header-title{display:flex;flex-direction:column;gap:2px}
#c2p-sidebar .c2p-header-title h2{font-size:15px;font-weight:700;background:linear-gradient(135deg,#e50914,#ff6b6b);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;margin:0;padding:0;line-height:1.3}
#c2p-sidebar .c2p-header-subtitle{font-size:10px;color:#666;text-transform:uppercase;letter-spacing:.08em}
#c2p-sidebar .c2p-header-btn{background:none;border:none;color:#888;cursor:pointer;font-size:14px;padding:4px;border-radius:4px;transition:all .2s;display:flex;align-items:center;justify-content:center}
#c2p-sidebar .c2p-header-btn:hover{color:#fff;background:rgba(255,255,255,.08)}
#c2p-sidebar .c2p-header-btn.c2p-spinning{animation:c2p-spin 1s linear infinite;color:#e50914}
#c2p-sidebar .c2p-header-btn svg{width:15px;height:15px;stroke:currentColor;fill:none;stroke-width:2;display:block}
@keyframes c2p-spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
#c2p-sidebar .c2p-status-badge{font-size:11px;font-weight:500;padding:4px 10px;border-radius:9999px;display:flex;align-items:center;gap:6px;transition:all .3s;border:1px solid transparent;white-space:nowrap;cursor:pointer;user-select:none}
#c2p-sidebar .c2p-status-badge:hover{filter:brightness(1.2)}
#c2p-sidebar .c2p-status-popover{position:absolute;top:calc(100% + 8px);right:0;background:#1e1e1e;border:1px solid rgba(255,255,255,.12);border-radius:8px;padding:6px;display:none;box-shadow:0 8px 24px rgba(0,0,0,.7);z-index:100;white-space:nowrap}
#c2p-sidebar .c2p-btn-disconnect-popover{background:rgba(239,68,68,.15);color:#ef4444;border:1px solid rgba(239,68,68,.3);border-radius:6px;padding:6px 12px;font-size:11px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:6px;font-family:inherit;transition:all .2s}
#c2p-sidebar .c2p-btn-disconnect-popover:hover{background:rgba(239,68,68,.35);color:#fff;border-color:rgba(239,68,68,.6)}
#c2p-sidebar .c2p-status-badge::before{content:'';display:block;width:6px;height:6px;border-radius:50%;flex-shrink:0}
#c2p-sidebar .c2p-status-badge.c2p-disconnected{background:rgba(239,68,68,.1);color:#ef4444;border-color:rgba(239,68,68,.2);cursor:default}
#c2p-sidebar .c2p-status-badge.c2p-disconnected:hover{filter:none}
#c2p-sidebar .c2p-status-badge.c2p-disconnected::before{background:#ef4444}
#c2p-sidebar .c2p-status-badge.c2p-connecting{background:rgba(245,158,11,.1);color:#f59e0b;border-color:rgba(245,158,11,.2)}
#c2p-sidebar .c2p-status-badge.c2p-connecting::before{background:#f59e0b;animation:c2p-blink 1.5s infinite}
#c2p-sidebar .c2p-status-badge.c2p-connected{background:rgba(16,185,129,.1);color:#10b981;border-color:rgba(16,185,129,.2)}
#c2p-sidebar .c2p-status-badge.c2p-connected::before{background:#10b981;box-shadow:0 0 8px rgba(16,185,129,.5)}
@keyframes c2p-blink{0%,100%{opacity:.4}50%{opacity:1}}
#c2p-sidebar .c2p-setup{padding:14px 20px;display:flex;flex-direction:column;align-items:center;background:rgba(30,30,30,.4);border-bottom:1px solid rgba(255,255,255,.04);flex-shrink:0}
#c2p-sidebar .c2p-setup-hint{margin-top:8px;font-size:11px;color:#666;text-align:center}
#c2p-sidebar .c2p-btn-connect{background:linear-gradient(135deg,#e50914,#b20710);color:#fff;border:none;border-radius:99px;padding:10px 28px;font-weight:600;font-size:13px;cursor:pointer;transition:all .2s cubic-bezier(.22,1,.36,1);font-family:inherit}
#c2p-sidebar .c2p-btn-connect:hover:not(:disabled){box-shadow:0 0 20px rgba(229,9,20,.4);transform:translateY(-1px)}
#c2p-sidebar .c2p-btn-connect:disabled{opacity:.5;cursor:not-allowed;filter:grayscale(60%)}
#c2p-sidebar .c2p-messages-wrap{position:relative;flex:1;display:flex;flex-direction:column;min-height:0;overflow:hidden}
#c2p-sidebar .c2p-messages{flex:1;padding:16px;overflow-y:auto;display:flex;flex-direction:column;gap:10px;min-height:0}
#c2p-sidebar .c2p-messages::-webkit-scrollbar{width:4px}
#c2p-sidebar .c2p-messages::-webkit-scrollbar-track{background:transparent}
#c2p-sidebar .c2p-messages::-webkit-scrollbar-thumb{background:rgba(255,255,255,.08);border-radius:4px}
#c2p-sidebar .c2p-scroll-bottom-btn{position:absolute;bottom:12px;left:50%;transform:translateX(-50%) translateY(0);background:rgba(26,26,26,.94);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);color:#fff;border:1px solid rgba(229,9,20,.45);box-shadow:0 4px 16px rgba(0,0,0,.6),0 0 10px rgba(229,9,20,.25);border-radius:99px;padding:6px 14px;font-size:11px;font-weight:600;display:flex;align-items:center;gap:6px;cursor:pointer;z-index:25;transition:all .2s cubic-bezier(.22,1,.36,1);user-select:none;font-family:inherit}
#c2p-sidebar .c2p-scroll-bottom-btn:hover{background:rgba(38,38,38,.98);border-color:#e50914;box-shadow:0 4px 20px rgba(229,9,20,.45);transform:translateX(-50%) translateY(-2px)}
#c2p-sidebar .c2p-scroll-bottom-btn.c2p-hidden{opacity:0;pointer-events:none;transform:translateX(-50%) translateY(10px)}
#c2p-sidebar .c2p-scroll-bottom-btn.c2p-has-unread{border-color:#e50914;background:rgba(229,9,20,.22);box-shadow:0 4px 16px rgba(229,9,20,.4)}
#c2p-sidebar .c2p-scroll-bottom-btn svg{width:13px;height:13px;stroke:currentColor;stroke-width:2.5;fill:none;flex-shrink:0}
#c2p-sidebar .c2p-msg{position:relative;max-width:85%;min-width:60px;padding:10px 14px;border-radius:16px;font-size:13px;line-height:1.45;animation:c2p-slideUp .35s cubic-bezier(.22,1,.36,1) forwards;opacity:0;transform:translateY(12px);word-break:break-word}
@keyframes c2p-slideUp{to{opacity:1;transform:translateY(0)}}
#c2p-sidebar .c2p-msg.c2p-sent{align-self:flex-end;background:linear-gradient(135deg,#e50914,#b20710);color:#fff;border-bottom-right-radius:4px;box-shadow:0 2px 8px rgba(229,9,20,.2)}
#c2p-sidebar .c2p-msg.c2p-received{align-self:flex-start;background:rgba(50,50,50,.8);color:#e5e5e5;border-bottom-left-radius:4px;border:1px solid rgba(255,255,255,.06)}
#c2p-sidebar .c2p-reply-btn,#c2p-sidebar .c2p-edit-btn{opacity:0;pointer-events:none;transform:translateY(2px);position:absolute;top:-10px;right:8px;background:rgba(26,26,26,.95);backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,.12);color:#aaa;border-radius:6px;height:22px;padding:0 7px;font-size:11px;font-weight:500;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.35);z-index:5;display:inline-flex;align-items:center;gap:4px;font-family:inherit;white-space:nowrap;width:max-content;min-width:max-content;max-width:none;word-break:normal;overflow-wrap:normal;line-height:1;transition:opacity .15s ease,transform .15s ease,background-color .15s ease,border-color .15s ease,color .15s ease}
#c2p-sidebar .c2p-reply-btn svg,#c2p-sidebar .c2p-edit-btn svg{flex-shrink:0}
#c2p-sidebar .c2p-reply-btn span,#c2p-sidebar .c2p-edit-btn span{white-space:nowrap;line-height:1;display:inline}
#c2p-sidebar .c2p-reply-btn:hover,#c2p-sidebar .c2p-edit-btn:hover{color:#fff;border-color:rgba(229,9,20,.6);background:rgba(36,36,36,.98)}
#c2p-sidebar .c2p-msg.c2p-received:hover .c2p-reply-btn,#c2p-sidebar .c2p-msg.c2p-received:focus-within .c2p-reply-btn{opacity:1;pointer-events:auto;transform:translateY(0)}
#c2p-sidebar .c2p-msg.c2p-sent:hover .c2p-edit-btn,#c2p-sidebar .c2p-msg.c2p-sent:focus-within .c2p-edit-btn{opacity:1;pointer-events:auto;transform:translateY(0)}
#c2p-sidebar .c2p-edited-tag{font-size:10px;opacity:.7;font-style:italic;margin-left:4px}
#c2p-sidebar .c2p-reply-preview{display:flex;align-items:center;gap:5px;padding:3px 7px;margin-bottom:5px;border-radius:6px;background:rgba(0,0,0,.28);border-left:2px solid #e50914;max-width:100%;overflow:hidden;font-size:11px;line-height:1.35;color:#bbb;white-space:nowrap}
#c2p-sidebar .c2p-reply-preview svg{flex-shrink:0;color:#ff6b6b}
#c2p-sidebar .c2p-reply-preview-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#c2p-sidebar .c2p-msg.c2p-sent .c2p-reply-preview{border-left-color:rgba(255,255,255,.7);background:rgba(0,0,0,.18);color:rgba(255,255,255,.8)}
#c2p-sidebar .c2p-msg.c2p-sent .c2p-reply-preview svg{color:rgba(255,255,255,.85)}
#c2p-sidebar .c2p-reply-bar{display:flex;align-items:center;gap:8px;padding:6px 14px;background:rgba(20,20,20,.95);backdrop-filter:blur(8px);border-top:1px solid rgba(255,255,255,.08);animation:c2p-slideUp .18s cubic-bezier(.16,1,.3,1)}
#c2p-sidebar .c2p-reply-bar-indicator{width:3px;height:24px;border-radius:2px;background:#e50914;flex-shrink:0}
#c2p-sidebar .c2p-reply-bar-content{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}
#c2p-sidebar .c2p-reply-bar-header{display:inline-flex;align-items:center;gap:3px;color:#ff6b6b;font-size:10px;font-weight:600;line-height:1.2}
#c2p-sidebar .c2p-reply-bar-header svg{flex-shrink:0}
#c2p-sidebar .c2p-reply-bar-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#eee;font-size:11px;line-height:1.35}
#c2p-sidebar .c2p-reply-bar-close{background:transparent;border:none;color:#888;cursor:pointer;width:22px;height:22px;display:flex;align-items:center;justify-content:center;border-radius:4px;padding:0;flex-shrink:0;transition:background-color .15s ease,color .15s ease}
#c2p-sidebar .c2p-reply-bar-close:hover{color:#fff;background:rgba(255,255,255,.08)}
#c2p-sidebar .c2p-msg-author{font-size:11px;font-weight:700;color:#ff6b6b;margin-bottom:2px;line-height:1.2;letter-spacing:.02em}
#c2p-sidebar .c2p-msg.c2p-system{align-self:center;background:transparent;color:#666;font-size:11px;box-shadow:none;border:1px dashed rgba(255,255,255,.08);border-radius:10px;padding:6px 12px;max-width:95%;text-align:center;display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:5px}
#c2p-sidebar .c2p-msg.c2p-system svg{width:12px;height:12px;stroke:currentColor;stroke-width:2;fill:none;flex-shrink:0}
#c2p-sidebar .c2p-inline-action-btn{background:rgba(229,9,20,.18);color:#ff6b6b;border:1px solid rgba(229,9,20,.35);border-radius:99px;padding:2px 8px;font-size:10px;font-weight:600;cursor:pointer;transition:all .2s;font-family:inherit}
#c2p-sidebar .c2p-inline-action-btn:hover{background:rgba(229,9,20,.35);color:#fff;border-color:rgba(229,9,20,.6);transform:scale(1.05)}
#c2p-sidebar .c2p-msg .c2p-gif-wrap{border-radius:8px;overflow:hidden;display:inline-block;margin-top:4px}
#c2p-sidebar .c2p-msg .c2p-gif-wrap img{height:120px;width:auto;display:block;border-radius:4px}
#c2p-sidebar .c2p-msg .c2p-image-wrap{border-radius:10px;overflow:hidden;display:inline-block;max-width:240px;border:1px solid rgba(255,255,255,.12);box-shadow:0 4px 16px rgba(0,0,0,.5);background:rgba(0,0,0,.3);cursor:pointer;transition:transform .2s,border-color .2s}
#c2p-sidebar .c2p-msg .c2p-image-wrap:hover{transform:scale(1.02);border-color:#e50914}
#c2p-sidebar .c2p-msg .c2p-image-wrap img{display:block;max-width:100%;max-height:260px;object-fit:cover;border-radius:9px}
#c2p-sidebar .c2p-image-preview-bar{display:none;align-items:center;justify-content:space-between;padding:8px 16px;background:rgba(20,20,20,.95);border-top:1px solid rgba(255,255,255,.08);flex-shrink:0;animation:c2p-slideUp .2s cubic-bezier(.22,1,.36,1)}
#c2p-sidebar .c2p-preview-info{display:flex;align-items:center;gap:10px;min-width:0}
#c2p-sidebar .c2p-preview-thumb{width:42px;height:42px;object-fit:cover;border-radius:6px;border:1px solid rgba(255,255,255,.15);flex-shrink:0}
#c2p-sidebar .c2p-preview-details{display:flex;flex-direction:column;gap:2px;overflow:hidden}
#c2p-sidebar .c2p-preview-title{font-size:12px;font-weight:600;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#c2p-sidebar .c2p-preview-size{font-size:10px;color:#888}
#c2p-sidebar .c2p-preview-actions{display:flex;align-items:center;gap:6px;flex-shrink:0}
#c2p-sidebar .c2p-preview-btn{width:32px;height:32px;border-radius:50%;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:14px;transition:all .2s;font-family:inherit}
#c2p-sidebar .c2p-preview-cancel{background:rgba(255,255,255,.1);color:#aaa}
#c2p-sidebar .c2p-preview-cancel:hover{background:rgba(239,68,68,.25);color:#ef4444}
#c2p-sidebar .c2p-preview-send{background:linear-gradient(135deg,#e50914,#b20710);color:#fff}
#c2p-sidebar .c2p-preview-send:hover{transform:scale(1.08);box-shadow:0 0 12px rgba(229,9,20,.5)}
#c2p-sidebar .c2p-typing-indicator{display:flex;align-items:center;gap:6px;padding:4px 16px;font-size:11px;color:#888;min-height:20px;transition:opacity .2s,visibility .2s;flex-shrink:0}
#c2p-sidebar .c2p-typing-indicator.c2p-hidden{opacity:0;visibility:hidden;pointer-events:none}
#c2p-sidebar .c2p-typing-dots{display:inline-flex;gap:3px;align-items:center}
#c2p-sidebar .c2p-typing-dots span{width:4px;height:4px;background:#888;border-radius:50%;animation:c2p-typingBounce 1.4s infinite ease-in-out both}
#c2p-sidebar .c2p-typing-dots span:nth-child(1){animation-delay:-0.32s}
#c2p-sidebar .c2p-typing-dots span:nth-child(2){animation-delay:-0.16s}
#c2p-sidebar .c2p-typing-dots span:nth-child(3){animation-delay:0s}
@keyframes c2p-typingBounce{0%,80%,100%{transform:scale(0);opacity:.4}40%{transform:scale(1);opacity:1}}
#c2p-sidebar .c2p-emoji-bar{display:flex;justify-content:center;gap:4px;padding:2px 12px 4px;background:rgba(30,30,30,.5);flex-shrink:0}
#c2p-sidebar .c2p-emoji-btn{background:transparent;border:none;font-size:18px;cursor:pointer;transition:transform .2s;border-radius:50%;width:32px;height:32px;display:flex;align-items:center;justify-content:center;opacity:.5;padding:0}
#c2p-sidebar .c2p-emoji-btn:not(:disabled){opacity:1}
#c2p-sidebar .c2p-emoji-btn:hover:not(:disabled){transform:scale(1.3);background:rgba(255,255,255,.08)}
#c2p-sidebar .c2p-emoji-btn:active:not(:disabled){transform:scale(.85)}
#c2p-sidebar .c2p-sfx-bar{display:flex;justify-content:center;gap:5px;padding:6px 10px;background:rgba(20,20,20,.6);border-top:1px solid rgba(255,255,255,.04);flex-shrink:0}
#c2p-sidebar .c2p-sfx-btn{width:36px;height:36px;border-radius:8px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);color:#aaa;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all .2s;flex-shrink:0;opacity:.5;padding:0}
#c2p-sidebar .c2p-sfx-btn:not(:disabled){opacity:1}
#c2p-sidebar .c2p-sfx-btn:hover:not(:disabled){background:rgba(255,255,255,.12);color:#fff;border-color:rgba(255,255,255,.2);transform:scale(1.08)}
#c2p-sidebar .c2p-sfx-btn:active:not(:disabled){transform:scale(.92)}
#c2p-sidebar .c2p-sfx-btn svg{width:18px;height:18px;stroke:currentColor;stroke-width:2;fill:none}
#c2p-sidebar .c2p-sfx-btn.c2p-sfx-active{background:rgba(229,9,20,.2)!important;border-color:#e50914!important;color:#fff!important;box-shadow:0 0 10px rgba(229,9,20,.85),inset 0 0 6px rgba(229,9,20,.35)!important;transform:scale(1.05)}
#c2p-sidebar .c2p-input-area{padding:12px 16px;background:rgba(25,25,25,.8);border-top:1px solid rgba(255,255,255,.06);display:flex;gap:8px;align-items:center;flex-shrink:0}
#c2p-sidebar .c2p-input-area input[type="text"]{flex:1;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.08);border-radius:99px;padding:10px 16px;color:#e5e5e5;font-size:13px;outline:none;transition:all .2s;font-family:inherit}
#c2p-sidebar .c2p-input-area input[type="text"]:focus{border-color:rgba(229,9,20,.5);background:rgba(255,255,255,.1);box-shadow:0 0 0 3px rgba(229,9,20,.08)}
#c2p-sidebar .c2p-input-area input[type="text"]:disabled{opacity:.3;cursor:not-allowed}
#c2p-sidebar .c2p-send-btn{background:linear-gradient(135deg,#e50914,#b20710);color:#fff;border:none;border-radius:50%;width:38px;height:38px;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all .2s;flex-shrink:0;padding:0}
#c2p-sidebar .c2p-send-btn:hover:not(:disabled){box-shadow:0 0 14px rgba(229,9,20,.4)}
#c2p-sidebar .c2p-send-btn:disabled{opacity:.3;cursor:not-allowed;filter:grayscale(80%)}
#c2p-sidebar .c2p-send-btn svg{width:16px;height:16px}
#c2p-sidebar .c2p-gif-btn{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.08);color:#e5e5e5;border-radius:50%;width:38px;height:38px;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all .2s;flex-shrink:0;padding:0}
#c2p-sidebar .c2p-gif-btn:hover:not(:disabled){background:rgba(255,255,255,.14);border-color:rgba(255,255,255,.2);color:#fff;transform:scale(1.05)}
#c2p-sidebar .c2p-gif-btn:active:not(:disabled){transform:scale(.95)}
#c2p-sidebar .c2p-gif-btn:disabled{opacity:.3;cursor:not-allowed}
#c2p-sidebar .c2p-gif-btn svg{width:18px;height:18px}
#c2p-sidebar .c2p-mic-btn{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.08);color:#e5e5e5;border-radius:50%;width:38px;height:38px;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all .2s;flex-shrink:0;padding:0}
#c2p-sidebar .c2p-mic-btn:hover:not(:disabled){background:rgba(255,255,255,.14);border-color:rgba(255,255,255,.2);color:#fff;transform:scale(1.05)}
#c2p-sidebar .c2p-mic-btn:active:not(:disabled){transform:scale(.95)}
#c2p-sidebar .c2p-mic-btn:disabled{opacity:.3;cursor:not-allowed}
#c2p-sidebar .c2p-mic-btn svg{width:18px;height:18px}
#c2p-sidebar .c2p-nudge-btn{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.08);color:#e5e5e5;border-radius:50%;width:38px;height:38px;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all .2s;flex-shrink:0;padding:0}
#c2p-sidebar .c2p-nudge-btn:hover:not(:disabled){background:rgba(255,255,255,.14);border-color:rgba(245,158,11,.4);color:#f59e0b;transform:scale(1.05);box-shadow:0 0 10px rgba(245,158,11,.3)}
#c2p-sidebar .c2p-nudge-btn:active:not(:disabled){transform:scale(.95)}
#c2p-sidebar .c2p-nudge-btn:disabled{opacity:.3;cursor:not-allowed}
#c2p-sidebar .c2p-nudge-btn svg{width:18px;height:18px}
#c2p-sidebar .c2p-effects-wrapper{position:relative;display:flex;align-items:center;justify-content:center;flex-shrink:0}
#c2p-sidebar .c2p-effects-menu{position:absolute;bottom:calc(100% + 10px);left:50%;transform:translateX(-50%) translateY(6px);background:rgba(22,22,22,.96);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,.12);border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.7);padding:6px;min-width:145px;opacity:0;visibility:hidden;pointer-events:none;transition:opacity .2s cubic-bezier(.16,1,.3,1),transform .2s cubic-bezier(.16,1,.3,1),visibility .2s;transition-delay:0.12s;z-index:120;white-space:nowrap}
#c2p-sidebar .c2p-effects-menu::after{content:'';position:absolute;top:100%;left:0;right:0;height:14px}
#c2p-sidebar .c2p-effects-wrapper:hover .c2p-effects-menu,#c2p-sidebar .c2p-effects-wrapper:focus-within .c2p-effects-menu{opacity:1;visibility:visible;pointer-events:auto;transform:translateX(-50%) translateY(0)}
#c2p-sidebar .c2p-effects-wrapper.c2p-disabled .c2p-effects-menu{display:none !important}
#c2p-sidebar .c2p-effects-menu-header{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#888;padding:4px 8px 6px;border-bottom:1px solid rgba(255,255,255,.06);margin-bottom:4px}
#c2p-sidebar .c2p-effects-list{display:flex;flex-direction:column;gap:3px}
#c2p-sidebar .c2p-effect-item{display:flex;align-items:center;gap:8px;background:transparent;border:none;border-radius:8px;color:#e5e5e5;padding:7px 10px;font-size:12px;font-family:inherit;font-weight:500;cursor:pointer;transition:all .18s;width:100%;text-align:left}
#c2p-sidebar .c2p-effect-item:hover:not(:disabled){background:rgba(255,255,255,.1);color:#fff;transform:translateX(2px)}
#c2p-sidebar .c2p-effect-item:active:not(:disabled){transform:scale(.97)}
#c2p-sidebar .c2p-effect-item:disabled{opacity:.35;cursor:not-allowed}
#c2p-sidebar .c2p-effect-icon{font-size:16px;line-height:1;display:flex;align-items:center;justify-content:center}
#c2p-sidebar .c2p-effect-text{font-size:12px}
#c2p-sidebar .c2p-recording-bar{display:none;align-items:center;gap:10px;flex:1;background:rgba(229,9,20,.12);border:1px solid rgba(229,9,20,.3);border-radius:99px;padding:4px 12px;color:#fff}
#c2p-sidebar .c2p-record-dot{width:10px;height:10px;background:#e50914;border-radius:50%;animation:c2p-blink 1s infinite;flex-shrink:0}
#c2p-sidebar .c2p-record-timer{font-size:12px;font-weight:600;font-variant-numeric:tabular-nums;color:#ff6b6b;flex:1}
#c2p-sidebar .c2p-record-btn{background:none;border:none;cursor:pointer;font-size:14px;border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;transition:all .2s}
#c2p-sidebar .c2p-record-cancel{color:#999}
#c2p-sidebar .c2p-record-cancel:hover{color:#fff;background:rgba(255,255,255,.15)}
#c2p-sidebar .c2p-record-send{background:#e50914;color:#fff}
#c2p-sidebar .c2p-record-send:hover{background:#ff1e27;filter:brightness(1.15)}
#c2p-sidebar .c2p-record-send:active{transform:scale(.95)}
#c2p-sidebar .c2p-msg.c2p-msg-audio{padding:10px 14px;border-radius:16px;min-width:210px;max-width:85%}
#c2p-sidebar .c2p-msg.c2p-msg-audio.c2p-sent{align-self:flex-end;background:#1e1a1b;border:1px solid rgba(229,9,20,.24);border-bottom-right-radius:4px;box-shadow:0 1px 4px rgba(0,0,0,.3)}
#c2p-sidebar .c2p-msg.c2p-msg-audio.c2p-received{align-self:flex-start;background:#18181b;border:1px solid rgba(255,255,255,.08);border-bottom-left-radius:4px;box-shadow:0 1px 4px rgba(0,0,0,.3)}
#c2p-sidebar .c2p-audio-player{display:flex;align-items:center;gap:12px;user-select:none}
#c2p-sidebar .c2p-audio-btn{width:36px;height:36px;border-radius:50%;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;padding:0;outline:none;transition:filter 140ms ease,transform 140ms ease}
#c2p-sidebar .c2p-audio-btn:hover{filter:brightness(1.15)}
#c2p-sidebar .c2p-audio-btn:active{transform:scale(.95)}
#c2p-sidebar .c2p-sent .c2p-audio-btn{background:#e50914;color:#fff;box-shadow:0 2px 8px rgba(229,9,20,.32)}
#c2p-sidebar .c2p-received .c2p-audio-btn{background:#ededed;color:#141415;box-shadow:0 2px 6px rgba(0,0,0,.3)}
#c2p-sidebar .c2p-audio-btn svg{display:block}
#c2p-sidebar .c2p-audio-btn .c2p-icon-play{transform:translateX(1px)}
#c2p-sidebar .c2p-audio-body{flex:1;display:flex;flex-direction:column;gap:6px;min-width:0}
#c2p-sidebar .c2p-audio-waveform{height:22px;display:flex;align-items:center;gap:2px;cursor:pointer;padding:2px 0;outline:none}
#c2p-sidebar .c2p-audio-waveform:focus-visible{box-shadow:0 0 0 2px rgba(229,9,20,.5);border-radius:4px}
#c2p-sidebar .c2p-wave-bar{flex:1;min-width:2px;border-radius:2px;transition:background-color 100ms ease,transform 100ms ease}
#c2p-sidebar .c2p-sent .c2p-wave-bar{background:rgba(255,255,255,.22)}
#c2p-sidebar .c2p-sent .c2p-wave-bar.c2p-wave-played{background:#e50914}
#c2p-sidebar .c2p-received .c2p-wave-bar{background:rgba(255,255,255,.2)}
#c2p-sidebar .c2p-received .c2p-wave-bar.c2p-wave-played{background:#ededed}
#c2p-sidebar .c2p-audio-waveform:hover .c2p-wave-bar{transform:scaleY(1.08)}
#c2p-sidebar .c2p-audio-meta{display:flex;align-items:center;justify-content:space-between;font-size:11px;font-variant-numeric:tabular-nums;line-height:1}
#c2p-sidebar .c2p-sent .c2p-audio-meta{color:rgba(255,255,255,.65)}
#c2p-sidebar .c2p-received .c2p-audio-meta{color:rgba(255,255,255,.55)}
#c2p-sidebar .c2p-audio-meta-right{display:flex;align-items:center;gap:4px;opacity:.8}
#c2p-sidebar .c2p-audio-meta-right svg{display:block}
#c2p-sidebar .c2p-klipy-container{position:absolute;bottom:115px;left:12px;right:12px;height:340px;max-height:calc(100vh - 180px);background:rgba(24,24,24,.96);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,.12);border-radius:14px;box-shadow:0 12px 32px rgba(0,0,0,.7);display:none;flex-direction:column;z-index:100;overflow:hidden;animation:c2p-scaleIn .2s cubic-bezier(.16,1,.3,1) forwards;transform-origin:bottom right}
@keyframes c2p-scaleIn{from{opacity:0;transform:scale(.95)}to{opacity:1;transform:scale(1)}}
#c2p-sidebar .c2p-klipy-header{padding:10px 12px;border-bottom:1px solid rgba(255,255,255,.08);display:flex;gap:8px;align-items:center;background:rgba(0,0,0,.25)}
#c2p-sidebar .c2p-klipy-header input{flex:1;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:8px;padding:6px 10px;color:#e5e5e5;font-size:12px;outline:none;font-family:inherit}
#c2p-sidebar .c2p-klipy-header input:focus{border-color:rgba(229,9,20,.6);background:rgba(255,255,255,.1)}
#c2p-sidebar .c2p-klipy-close{background:transparent;border:none;color:#999;font-size:14px;cursor:pointer;padding:4px 8px;border-radius:6px;transition:all .2s}
#c2p-sidebar .c2p-klipy-close:hover{color:#fff;background:rgba(255,255,255,.1)}
#c2p-sidebar .c2p-klipy-results{flex:1;padding:8px;overflow-y:auto;display:grid;grid-template-columns:repeat(2,1fr);grid-auto-rows:80px;gap:8px;align-content:start}
#c2p-sidebar .c2p-klipy-results::-webkit-scrollbar{width:4px}
#c2p-sidebar .c2p-klipy-results::-webkit-scrollbar-thumb{background:rgba(255,255,255,.12);border-radius:4px}
#c2p-sidebar .c2p-klipy-results.c2p-loading{display:flex;align-items:center;justify-content:center}
#c2p-sidebar .c2p-klipy-results.c2p-loading::after{content:'';width:22px;height:22px;border:2px solid rgba(255,255,255,.15);border-top-color:#e50914;border-radius:50%;animation:c2p-twist 1s linear infinite}
@keyframes c2p-twist{to{transform:rotate(360deg)}}
#c2p-sidebar .c2p-gif-item{width:100%;height:80px;object-fit:cover;border-radius:6px;cursor:pointer;transition:transform .2s,box-shadow .2s;background:rgba(0,0,0,.3);user-select:none;-webkit-user-drag:none}
#c2p-sidebar .c2p-gif-item:hover{transform:scale(1.05);box-shadow:0 4px 12px rgba(0,0,0,.5);border:1px solid #e50914}
#c2p-sidebar .c2p-klipy-footer{padding:4px 8px;border-top:1px solid rgba(255,255,255,.06);text-align:center;background:rgba(0,0,0,.3);font-size:10px;color:#666}
#c2p-sidebar .c2p-modal-overlay{position:absolute;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.75);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);z-index:150;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;animation:c2p-fadeIn .2s ease}
@keyframes c2p-fadeIn{from{opacity:0}to{opacity:1}}
#c2p-sidebar .c2p-modal-card{width:100%;max-width:328px;background:linear-gradient(180deg,rgba(32,32,32,.98),rgba(20,20,20,.98));border:1px solid rgba(255,255,255,.12);border-radius:14px;box-shadow:0 16px 40px rgba(0,0,0,.8),0 0 0 1px rgba(255,255,255,.05);display:flex;flex-direction:column;overflow:hidden;animation:c2p-scaleIn .2s cubic-bezier(.16,1,.3,1) forwards}
#c2p-sidebar .c2p-modal-header{padding:14px 16px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.02)}
#c2p-sidebar .c2p-modal-title-group{display:flex;align-items:center;gap:8px}
#c2p-sidebar .c2p-modal-title-group svg{color:#e50914;display:block}
#c2p-sidebar .c2p-modal-title-group h3{margin:0;font-size:14px;font-weight:700;color:#fff;line-height:1}
#c2p-sidebar .c2p-version-badge{font-size:11px;font-weight:600;padding:2px 8px;border-radius:99px;background:rgba(229,9,20,.18);color:#ff6b6b;border:1px solid rgba(229,9,20,.35);font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;letter-spacing:.3px;line-height:1.2}
#c2p-sidebar .c2p-modal-close{background:none;border:none;color:#888;cursor:pointer;padding:4px 6px;border-radius:4px;font-size:14px;line-height:1;transition:all .2s;display:flex;align-items:center;justify-content:center}
#c2p-sidebar .c2p-modal-close:hover{color:#fff;background:rgba(255,255,255,.08)}
#c2p-sidebar .c2p-modal-body{padding:16px;display:flex;flex-direction:column;gap:14px}
#c2p-sidebar .c2p-form-group{display:flex;flex-direction:column;gap:5px}
#c2p-sidebar .c2p-form-group label{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:#aaa}
#c2p-sidebar .c2p-form-label-row{display:flex;justify-content:space-between;align-items:center}
#c2p-sidebar .c2p-link-btn{background:none;border:none;color:#e50914;font-size:10px;cursor:pointer;padding:0;font-family:inherit;text-decoration:underline;transition:color .2s}
#c2p-sidebar .c2p-link-btn:hover:not(:disabled){color:#ff6b6b}
#c2p-sidebar .c2p-link-btn:disabled{color:#666;cursor:not-allowed;text-decoration:none}
#c2p-sidebar .c2p-form-group input{width:100%;box-sizing:border-box;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:8px;padding:8px 12px;color:#e5e5e5;font-size:12px;outline:none;transition:all .2s;font-family:inherit}
#c2p-sidebar .c2p-form-group input:focus{border-color:rgba(229,9,20,.6);background:rgba(255,255,255,.1);box-shadow:0 0 0 3px rgba(229,9,20,.12)}
#c2p-sidebar .c2p-form-group input.c2p-input-error{border-color:#ef4444;background:rgba(239,68,68,.1)}
#c2p-sidebar .c2p-field-hint{font-size:10px;color:#666;line-height:1.3}
#c2p-sidebar .c2p-modal-footer{padding:12px 16px;display:flex;justify-content:flex-end;gap:8px;border-top:1px solid rgba(255,255,255,.08);background:rgba(0,0,0,.2)}
#c2p-sidebar .c2p-modal-foot-note{padding:0 16px 10px;text-align:center;font-size:10px;color:#555}
#c2p-sidebar .c2p-btn-secondary{background:rgba(255,255,255,.08);color:#ccc;border:1px solid rgba(255,255,255,.1);border-radius:6px;padding:6px 14px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;transition:all .2s}
#c2p-sidebar .c2p-btn-secondary:hover{background:rgba(255,255,255,.14);color:#fff}
#c2p-sidebar .c2p-btn-primary{background:linear-gradient(135deg,#e50914,#b20710);color:#fff;border:none;border-radius:6px;padding:6px 16px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;transition:all .2s}
#c2p-sidebar .c2p-btn-primary:hover{box-shadow:0 2px 12px rgba(229,9,20,.4);filter:brightness(1.1)}
#c2p-sidebar .c2p-floating-emoji{position:absolute;bottom:0;font-size:36px;pointer-events:none;z-index:50;user-select:none;filter:drop-shadow(0 4px 8px rgba(0,0,0,.35));will-change:transform,opacity;animation-fill-mode:forwards}
@keyframes c2p-floatUp{0%{transform:translate3d(0,0,0) scale(.65);opacity:0}12%{transform:translate3d(-5px,-11vh,0) scale(1.03) rotate(-2deg);opacity:1}35%{transform:translate3d(6px,-32vh,0) scale(1) rotate(2deg);opacity:1}60%{transform:translate3d(-5px,-55vh,0) scale(.99) rotate(-1.5deg);opacity:.95}80%{transform:translate3d(4px,-74vh,0) scale(.97) rotate(1deg);opacity:.75}100%{transform:translate3d(0,-88vh,0) scale(.94) rotate(0deg);opacity:0}}
@keyframes c2p-floatUpAlt{0%{transform:translate3d(0,0,0) scale(.65);opacity:0}12%{transform:translate3d(5px,-11vh,0) scale(1.03) rotate(2deg);opacity:1}35%{transform:translate3d(-6px,-32vh,0) scale(1) rotate(-2deg);opacity:1}60%{transform:translate3d(5px,-55vh,0) scale(.99) rotate(1.5deg);opacity:.95}80%{transform:translate3d(-4px,-74vh,0) scale(.97) rotate(-1deg);opacity:.75}100%{transform:translate3d(0,-88vh,0) scale(.94) rotate(0deg);opacity:0}}
#c2p-sidebar.c2p-earthquake,#c2p-sidebar.c2p-shaking,#c2p-toggle-btn.c2p-earthquake{animation:c2p-quake-sidebar 1s cubic-bezier(.36,.07,.19,.97) both;box-shadow:-12px 0 48px rgba(229,9,20,.8),0 0 36px rgba(229,9,20,.6);will-change:transform}
@keyframes c2p-quake-sidebar{0%,100%{transform:translateX(0) rotate(0deg)}5%{transform:translate(-20px,-14px) rotate(-2.5deg)}10%{transform:translate(18px,16px) rotate(2.2deg)}15%{transform:translate(-22px,10px) rotate(-2.3deg)}20%{transform:translate(20px,-18px) rotate(2.5deg)}28%{transform:translate(-16px,14px) rotate(-1.8deg)}36%{transform:translate(14px,-12px) rotate(1.5deg)}45%{transform:translate(-12px,10px) rotate(-1.2deg)}55%{transform:translate(10px,-8px) rotate(1deg)}65%{transform:translate(-8px,6px) rotate(-0.7deg)}75%{transform:translate(5px,-4px) rotate(0.5deg)}85%{transform:translate(-3px,2px) rotate(-0.3deg)}}
.watch-video.c2p-earthquake,.VideoContainer.c2p-earthquake,#appMountPoint.c2p-earthquake,video.c2p-earthquake{animation:c2p-quake-screen 1s cubic-bezier(.36,.07,.19,.97) both!important;will-change:transform}
@keyframes c2p-quake-screen{0%,100%{transform:translate(0,0) rotate(0deg)}5%{transform:translate(16px,10px) rotate(1.2deg)}10%{transform:translate(-18px,-14px) rotate(-1.5deg)}15%{transform:translate(20px,-8px) rotate(1.3deg)}20%{transform:translate(-16px,16px) rotate(-1.4deg)}28%{transform:translate(14px,-12px) rotate(1deg)}36%{transform:translate(-12px,10px) rotate(-0.8deg)}45%{transform:translate(10px,-8px) rotate(0.6deg)}55%{transform:translate(-8px,6px) rotate(-0.5deg)}65%{transform:translate(6px,-4px) rotate(0.4deg)}75%{transform:translate(-4px,3px) rotate(-0.2deg)}85%{transform:translate(2px,-1px) rotate(0.1deg)}}
#c2p-sidebar.c2p-earthquake .c2p-header,#c2p-sidebar.c2p-shaking .c2p-header{animation:c2p-fall-header 1s cubic-bezier(.25,1,.3,1) both;transform-origin:15% 0%;position:relative;z-index:20;will-change:transform}
@keyframes c2p-fall-header{0%,100%{transform:translate(0,0) rotate(0deg)}12%{transform:translate(0,0) rotate(0deg)}22%{transform:translate(-6px,24px) rotate(-4deg)}35%{transform:translate(-10px,65px) rotate(-7deg)}48%{transform:translate(-8px,82px) rotate(-8.5deg)}62%{transform:translate(-4px,55px) rotate(-5deg)}75%{transform:translate(-2px,16px) rotate(-1.5deg)}85%{transform:translate(0,-6px) rotate(1deg)}92%{transform:translate(0,2px) rotate(-0.5deg)}}
#c2p-sidebar.c2p-earthquake .c2p-header-title,#c2p-sidebar.c2p-shaking .c2p-header-title{animation:c2p-fall-title 1s cubic-bezier(.25,1,.3,1) both;transform-origin:top left;will-change:transform}
@keyframes c2p-fall-title{0%,100%{transform:translate(0,0) rotate(0deg)}15%{transform:translate(0,0) rotate(0deg)}28%{transform:translate(8px,20px) rotate(12deg)}42%{transform:translate(12px,38px) rotate(16deg)}55%{transform:translate(8px,25px) rotate(10deg)}72%{transform:translate(3px,8px) rotate(3deg)}86%{transform:translate(0,-4px) rotate(-1deg)}}
#c2p-sidebar.c2p-earthquake #c2p-status,#c2p-sidebar.c2p-shaking #c2p-status{animation:c2p-fall-badge 1s cubic-bezier(.25,1,.3,1) both;transform-origin:top right;will-change:transform}
@keyframes c2p-fall-badge{0%,100%{transform:translate(0,0) rotate(0deg)}18%{transform:translate(0,0) rotate(0deg)}32%{transform:translate(-6px,30px) rotate(-22deg)}48%{transform:translate(-10px,50px) rotate(-32deg)}64%{transform:translate(-5px,22px) rotate(-14deg)}80%{transform:translate(-2px,6px) rotate(-4deg)}88%{transform:translate(0,-3px) rotate(2deg)}}
#c2p-sidebar.c2p-earthquake .c2p-header-btn,#c2p-sidebar.c2p-shaking .c2p-header-btn{animation:c2p-fall-btn 1s cubic-bezier(.25,1,.3,1) both;will-change:transform}
@keyframes c2p-fall-btn{0%,100%{transform:translate(0,0) rotate(0deg)}20%{transform:translate(0,0)}36%{transform:translate(4px,28px) rotate(24deg)}50%{transform:translate(6px,42px) rotate(35deg)}68%{transform:translate(3px,18px) rotate(15deg)}82%{transform:translate(0,-3px) rotate(-3deg)}}
#c2p-sidebar.c2p-earthquake .c2p-setup,#c2p-sidebar.c2p-shaking .c2p-setup{animation:c2p-fall-setup 1s cubic-bezier(.25,1,.3,1) both;transform-origin:top center;position:relative;z-index:15;will-change:transform}
@keyframes c2p-fall-setup{0%,100%{transform:translate(0,0) rotate(0deg)}15%{transform:translate(0,0) rotate(0deg)}26%{transform:translate(4px,18px) rotate(3deg)}40%{transform:translate(6px,48px) rotate(5deg)}52%{transform:translate(4px,58px) rotate(6deg)}68%{transform:translate(2px,24px) rotate(2deg)}82%{transform:translate(0,-5px) rotate(-1deg)}92%{transform:translate(0,1px) rotate(0deg)}}
#c2p-sidebar.c2p-earthquake .c2p-messages,#c2p-sidebar.c2p-shaking .c2p-messages{animation:c2p-compress-messages 1s cubic-bezier(.25,1,.3,1) both;will-change:transform}
@keyframes c2p-compress-messages{0%,100%{transform:translate(0,0)}35%{transform:translate(0,10px)}50%{transform:translate(0,25px)}70%{transform:translate(0,8px)}85%{transform:translate(0,-3px)}}
body.c2p-sidebar-active .watch-video,body.c2p-sidebar-active .watch-video--player-view{width:calc(100vw - 360px)!important;max-width:calc(100vw - 360px)!important;transition:width .35s cubic-bezier(.22,1,.36,1)}
body.c2p-sidebar-active video{width:100%!important;object-fit:contain!important}
body.c2p-sidebar-active .watch-video--bottom-controls-container{width:calc(100vw - 360px)!important;max-width:calc(100vw - 360px)!important}
[data-uia="playback-speed"],[data-uia*="playback-speed"]:not(button):not(svg):not(path),[data-uia="playback-speed"] ul,[data-uia="playback-speed"] ol,[data-uia="playback-speed"] [role="menu"],[data-uia="playback-speed"] [role="radiogroup"],[data-uia="playback-speed"] > div{display:flex!important;flex-direction:column!important;width:auto!important;min-width:unset!important;max-width:fit-content!important;height:auto!important;align-items:center!important;justify-content:center!important;gap:4px!important;padding:8px 6px!important;box-sizing:border-box!important}
[data-uia="playback-speed"] button,[data-uia="playback-speed"] li,[data-uia="playback-speed"] [role="menuitem"],[data-uia="playback-speed"] [role="radio"],[data-uia="playback-speed"] [role="button"],[data-uia="playback-speed"] > button,[data-uia="playback-speed"] > div > button{display:flex!important;align-items:center!important;justify-content:center!important;width:100%!important;min-width:48px!important;margin:2px 0!important;padding:6px 12px!important;text-align:center!important;white-space:nowrap!important;box-sizing:border-box!important}
div:has(> [data-uia="playback-speed"]),div:has(> * > [data-uia="playback-speed"]){width:auto!important;min-width:unset!important;max-width:fit-content!important}
  `);

  // ── Build UI ──
  function buildSidebar() {
    const toggleBtn = document.createElement('button');
    toggleBtn.id = 'c2p-toggle-btn';
    toggleBtn.innerHTML = '<svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>';
    toggleBtn.title = 'Toggle Chat2Peer';
    document.body.appendChild(toggleBtn);

    const sidebar = document.createElement('div');
    sidebar.id = 'c2p-sidebar';
    sidebar.classList.add('c2p-hidden');
    sidebar.innerHTML = `
      <div class="c2p-header">
        <div style="display:flex;align-items:center;gap:8px;">
          <button id="c2p-close-btn" class="c2p-header-btn" title="Cerrar chat"><svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg></button>
          <div class="c2p-header-title">
            <h2>🎬 Chat2Peer</h2>
            <span class="c2p-header-subtitle">Encrypted</span>
          </div>
        </div>
        <div style="display:flex;gap:6px;align-items:center;position:relative;">
          <button id="c2p-reconnect-btn" class="c2p-header-btn" title="Force Fresh Reconnect"><svg viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg></button>
          <button id="c2p-settings-btn" class="c2p-header-btn" title="Settings"><svg viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg></button>
          <div class="c2p-status-badge c2p-disconnected" id="c2p-status" title="Connection state">Disconnected</div>
          <div id="c2p-status-popover" class="c2p-status-popover">
            <button id="c2p-disconnect-action-btn" class="c2p-btn-disconnect-popover">✕ Disconnect</button>
          </div>
        </div>
      </div>
      <div class="c2p-setup" id="c2p-setup">
        <button class="c2p-btn-connect" id="c2p-connect-btn">Enter Lounge</button>
        <p class="c2p-setup-hint" id="c2p-setup-hint">Click to connect and wait for a peer.</p>
      </div>
      <div class="c2p-messages-wrap">
        <div class="c2p-messages" id="c2p-messages">
          <div class="c2p-msg c2p-system">Welcome! Messages are sent securely over WebRTC.</div>
        </div>
        <button id="c2p-scroll-bottom-btn" class="c2p-scroll-bottom-btn c2p-hidden" title="Scroll to bottom">
          <svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
          <span id="c2p-scroll-btn-text">Jump to bottom ↓</span>
        </button>
      </div>
      <div id="c2p-typing-indicator" class="c2p-typing-indicator c2p-hidden">
        <span>Peer is typing</span>
        <span class="c2p-typing-dots"><span></span><span></span><span></span></span>
      </div>
      <div class="c2p-sfx-bar">${SOUND_EFFECTS.map((s, i) => `<button class="c2p-sfx-btn" data-sfx="${i}" title="${s.name}" disabled><svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">${s.svg}</svg></button>`).join('')}</div>
      <div class="c2p-emoji-bar">${EMOJIS.map(e => `<button class="c2p-emoji-btn" data-emoji="${e}" disabled>${e}</button>`).join('')}</div>
      <div id="c2p-image-preview-bar" class="c2p-image-preview-bar" style="display:none;">
        <div class="c2p-preview-info">
          <img id="c2p-preview-thumb" class="c2p-preview-thumb" src="" alt="Preview">
          <div class="c2p-preview-details">
            <span class="c2p-preview-title">Pasted Image</span>
            <span id="c2p-preview-size" class="c2p-preview-size">0 KB</span>
          </div>
        </div>
        <div class="c2p-preview-actions">
          <button id="c2p-preview-cancel-btn" class="c2p-preview-btn c2p-preview-cancel" title="Discard image">✕</button>
          <button id="c2p-preview-send-btn" class="c2p-preview-btn c2p-preview-send" title="Send image">✓</button>
        </div>
      </div>
      <div id="c2p-reply-bar" class="c2p-reply-bar" style="display:none;">
        <div class="c2p-reply-bar-indicator"></div>
        <div class="c2p-reply-bar-content">
          <div class="c2p-reply-bar-header">
            <svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
              <path d="M6 3L2 7l4 4"/>
              <path d="M2 7h7a4 4 0 0 1 4 4v2"/>
            </svg>
            <span>Replying to</span>
          </div>
          <span id="c2p-reply-bar-text" class="c2p-reply-bar-text"></span>
        </div>
        <button id="c2p-reply-bar-close" class="c2p-reply-bar-close" title="Cancel reply" aria-label="Cancel reply">
          <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="4" x2="4" y2="12"/>
            <line x1="4" y1="4" x2="12" y2="12"/>
          </svg>
        </button>
      </div>
      <div id="c2p-edit-bar" class="c2p-reply-bar" style="display:none;">
        <div class="c2p-reply-bar-indicator" style="background:#3b82f6;"></div>
        <div class="c2p-reply-bar-content">
          <div class="c2p-reply-bar-header" style="color:#60a5fa;">
            <svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
              <path d="M11.5 2.5a1.414 1.414 0 0 1 2 2L5 13H2v-3L10.5 1.5z"/>
            </svg>
            <span>Editing message</span>
          </div>
          <span id="c2p-edit-bar-text" class="c2p-reply-bar-text"></span>
        </div>
        <button id="c2p-edit-bar-close" class="c2p-reply-bar-close" title="Cancel edit" aria-label="Cancel edit">
          <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="4" x2="4" y2="12"/>
            <line x1="4" y1="4" x2="12" y2="12"/>
          </svg>
        </button>
      </div>
      <div class="c2p-input-area">
        <div class="c2p-recording-bar" id="c2p-recording-bar" style="display:none;">
          <span class="c2p-record-dot"></span>
          <span class="c2p-record-timer" id="c2p-record-timer">0:00</span>
          <button id="c2p-record-cancel-btn" class="c2p-record-btn c2p-record-cancel" title="Discard">✕</button>
          <button id="c2p-record-send-btn" class="c2p-record-btn c2p-record-send" title="Send Voice Note">✓</button>
        </div>
        <input type="text" id="c2p-msg-input" placeholder="Type a message..." disabled autocomplete="off">
        <div class="c2p-effects-wrapper c2p-disabled" id="c2p-effects-wrapper">
          <button class="c2p-nudge-btn" id="c2p-nudge-btn" disabled title="Send buzz" aria-label="Send buzz">
            <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
              <path d="M2 9a12 12 0 0 1 0 6"></path>
              <path d="M5 6a16 16 0 0 1 0 12"></path>
              <path d="M22 9a12 12 0 0 0 0 6"></path>
              <path d="M19 6a16 16 0 0 0 0 12"></path>
              <rect x="9" y="4" width="6" height="16" rx="2"></rect>
            </svg>
          </button>
          <div class="c2p-effects-menu" id="c2p-effects-menu">
            <div class="c2p-effects-menu-header">Effects</div>
            <div class="c2p-effects-list">
              ${SPECIAL_EFFECTS.map(fx => `<button class="c2p-effect-item" data-effect="${fx.id}" title="${fx.title}" disabled><span class="c2p-effect-icon">${fx.icon}</span><span class="c2p-effect-text">${fx.name}</span></button>`).join('')}
            </div>
          </div>
        </div>
        <button class="c2p-mic-btn" id="c2p-mic-btn" disabled title="Voice Note">
          <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
            <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
            <line x1="12" y1="19" x2="12" y2="23"></line>
            <line x1="8" y1="23" x2="16" y2="23"></line>
          </svg>
        </button>
        <button class="c2p-gif-btn" id="c2p-gif-btn" disabled title="Send GIF">
          <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
            <circle cx="8.5" cy="8.5" r="1.5"></circle>
            <polyline points="21 15 16 10 5 21"></polyline>
          </svg>
        </button>
        <button class="c2p-send-btn" id="c2p-send-btn" disabled>
          <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
            <line x1="22" y1="2" x2="11" y2="13"></line>
            <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
          </svg>
        </button>
      </div>
      <div id="c2p-klipy-container" class="c2p-klipy-container" style="display:none;">
        <div class="c2p-klipy-header">
          <input type="text" id="c2p-klipy-search" placeholder="Search Klipy GIFs..." autocomplete="off">
          <button id="c2p-klipy-close" class="c2p-klipy-close">✕</button>
        </div>
        <div id="c2p-klipy-results" class="c2p-klipy-results"></div>
        <div class="c2p-klipy-footer"><small>Powered by Klipy</small></div>
      </div>
      <div id="c2p-settings-modal" class="c2p-modal-overlay" style="display:none;">
        <div class="c2p-modal-card">
          <div class="c2p-modal-header">
            <div class="c2p-modal-title-group">
              <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
              <h3>Settings</h3>
              <span class="c2p-version-badge" title="Installed script version">v${SCRIPT_VERSION}</span>
            </div>
            <button id="c2p-settings-close-btn" class="c2p-modal-close" title="Close">✕</button>
          </div>
          <div class="c2p-modal-body">
            <div class="c2p-form-group">
              <label for="c2p-setting-nickname">Nickname</label>
              <input type="text" id="c2p-setting-nickname" placeholder="e.g. Alex" autocomplete="off" spellcheck="false">
              <span class="c2p-field-hint">Your display name in chat</span>
            </div>
            <div class="c2p-form-group">
              <div class="c2p-form-label-row">
                <label for="c2p-setting-server">Signaling Server URL</label>
                <button type="button" id="c2p-setting-server-reset" class="c2p-link-btn" title="Reset to default URL">Reset default</button>
              </div>
              <input type="text" id="c2p-setting-server" placeholder="wss://chat2peer.onrender.com/ws" autocomplete="off" spellcheck="false">
              <span class="c2p-field-hint" id="c2p-server-hint">WebSocket URL for WebRTC handshake</span>
            </div>
            <div class="c2p-form-group">
              <div class="c2p-form-label-row">
                <label>Script Updates</label>
                <button type="button" id="c2p-check-update-btn" class="c2p-link-btn" title="Check GitHub for script updates">Check for updates</button>
              </div>
              <span class="c2p-field-hint" id="c2p-update-status">v${SCRIPT_VERSION} (Installed)</span>
            </div>
          </div>
          <div class="c2p-modal-footer">
            <button type="button" id="c2p-settings-cancel-btn" class="c2p-btn-secondary">Cancel</button>
            <button type="button" id="c2p-settings-save-btn" class="c2p-btn-primary">Save Changes</button>
          </div>
          <div class="c2p-modal-foot-note"><small>Chat2Peer for Netflix • v${SCRIPT_VERSION}</small></div>
        </div>
      </div>`;
    document.body.appendChild(sidebar);

    toggleBtn.addEventListener('click', () => toggleSidebar());
    document.getElementById('c2p-close-btn').addEventListener('click', () => toggleSidebar(false));
    document.getElementById('c2p-settings-btn').addEventListener('click', toggleSettingsModal);
    document.getElementById('c2p-reconnect-btn').addEventListener('click', forceFreshReconnect);
    document.getElementById('c2p-connect-btn').addEventListener('click', forceFreshReconnect);
    document.getElementById('c2p-send-btn').addEventListener('click', sendMessage);

    const statusEl = document.getElementById('c2p-status');
    const statusPopover = document.getElementById('c2p-status-popover');
    const disconnectActionBtn = document.getElementById('c2p-disconnect-action-btn');

    if (statusEl && statusPopover) {
      statusEl.addEventListener('click', (e) => {
        e.stopPropagation();
        if (statusEl.classList.contains('c2p-disconnected')) {
          statusPopover.style.display = 'none';
          return;
        }
        statusPopover.style.display = statusPopover.style.display === 'block' ? 'none' : 'block';
      });
      document.addEventListener('click', (e) => {
        if (!e.target.closest?.('#c2p-status') && !e.target.closest?.('#c2p-status-popover')) {
          statusPopover.style.display = 'none';
        }
      });
    }

    if (disconnectActionBtn) {
      disconnectActionBtn.addEventListener('click', () => {
        if (statusPopover) statusPopover.style.display = 'none';
        terminateConnection();
      });
    }

    const settingNick = document.getElementById('c2p-setting-nickname');
    const settingServer = document.getElementById('c2p-setting-server');

    // Stop key events from bubbling to Netflix's video player controls
    ['keydown', 'keyup', 'keypress'].forEach(type => {
      sidebar.addEventListener(type, e => {
        e.stopPropagation();
        if (type === 'keydown') {
          if (e.key === 'Escape') {
            const pb = document.getElementById('c2p-image-preview-bar');
            if (pb && pb.style.display !== 'none') {
              e.preventDefault();
              clearImagePreview();
              return;
            }
            const sm = document.getElementById('c2p-settings-modal');
            if (sm && sm.style.display !== 'none') {
              e.preventDefault();
              closeSettingsModal();
              return;
            }
          }
          if (e.key === 'Enter' || e.keyCode === 13) {
            if (e.target === msgInput) {
              e.preventDefault();
              if (pendingImageBlob) {
                sendPendingImage();
              }
              sendMessage();
            } else if (e.target === settingNick || e.target === settingServer) {
              e.preventDefault();
              saveSettings();
            }
          }
        }
      });
    });

    function setupInputFocusProtection(inputEl) {
      if (!inputEl) return;
      inputEl.addEventListener('focus', () => {
        activeSidebarInput = inputEl;
        userClickedOutside = false;
      });
      inputEl.addEventListener('blur', () => {
        if (activeSidebarInput === inputEl && !userClickedOutside && sidebarVisible) {
          requestAnimationFrame(() => {
            const currentActive = document.activeElement;
            // If focus moved to another element inside sidebar (e.g. klipySearch), do not steal focus
            if (currentActive && currentActive.closest && currentActive.closest('#c2p-sidebar')) {
              return;
            }
            if (activeSidebarInput === inputEl && !userClickedOutside && sidebarVisible && !inputEl.disabled) {
              inputEl.focus();
            }
          });
        }
      });
    }

    const msgInput = document.getElementById('c2p-msg-input');
    setupInputFocusProtection(msgInput);
    setupInputFocusProtection(settingNick);
    setupInputFocusProtection(settingServer);

    const settingsCloseBtn = document.getElementById('c2p-settings-close-btn');
    if (settingsCloseBtn) settingsCloseBtn.addEventListener('click', closeSettingsModal);
    const settingsCancelBtn = document.getElementById('c2p-settings-cancel-btn');
    if (settingsCancelBtn) settingsCancelBtn.addEventListener('click', closeSettingsModal);
    const settingsSaveBtn = document.getElementById('c2p-settings-save-btn');
    if (settingsSaveBtn) settingsSaveBtn.addEventListener('click', saveSettings);

    const settingResetBtn = document.getElementById('c2p-setting-server-reset');
    if (settingResetBtn) {
      settingResetBtn.addEventListener('click', () => {
        if (settingServer) {
          settingServer.value = 'wss://chat2peer.onrender.com/ws';
          settingServer.classList.remove('c2p-input-error');
          const hint = document.getElementById('c2p-server-hint');
          if (hint) { hint.textContent = 'WebSocket URL for WebRTC handshake'; hint.style.color = ''; }
          settingServer.focus();
        }
      });
    }

    const checkUpdateBtn = document.getElementById('c2p-check-update-btn');
    if (checkUpdateBtn) {
      checkUpdateBtn.addEventListener('click', () => checkForScriptUpdates(true));
    }

    const settingsModal = document.getElementById('c2p-settings-modal');
    if (settingsModal) {
      settingsModal.addEventListener('click', (e) => {
        if (e.target === settingsModal) {
          closeSettingsModal();
        }
      });
    }

    sidebar.addEventListener('paste', handlePasteEvent);

    const previewCancelBtn = document.getElementById('c2p-preview-cancel-btn');
    if (previewCancelBtn) previewCancelBtn.addEventListener('click', clearImagePreview);

    const replyCloseBtn = document.getElementById('c2p-reply-bar-close');
    if (replyCloseBtn) replyCloseBtn.addEventListener('click', clearReply);

    const editCloseBtn = document.getElementById('c2p-edit-bar-close');
    if (editCloseBtn) editCloseBtn.addEventListener('click', clearEditing);

    const previewSendBtn = document.getElementById('c2p-preview-send-btn');
    if (previewSendBtn) previewSendBtn.addEventListener('click', () => {
      sendPendingImage();
      sendMessage();
    });

    msgInput.addEventListener('input', handleLocalTyping);
    msgInput.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        if (editingMsg) {
          clearEditing();
        } else {
          clearReply();
        }
      } else if (e.key === 'ArrowUp' && !msgInput.value.trim() && !editingMsg) {
        const sentMsgs = document.querySelectorAll('.c2p-msg.c2p-sent[data-msg-id]');
        for (let idx = sentMsgs.length - 1; idx >= 0; idx--) {
          const m = sentMsgs[idx];
          const textEl = m.querySelector('.c2p-msg-text');
          if (textEl && !m.querySelector('.c2p-gif-wrap, .c2p-image-wrap')) {
            const editBtn = m.querySelector('.c2p-edit-btn');
            if (editBtn) {
              editBtn.click();
              e.preventDefault();
              break;
            }
          }
        }
      } else if (e.key === 'Enter' || e.keyCode === 13) {
        e.preventDefault();
        if (pendingImageBlob) {
          sendPendingImage();
        }
        sendMessage();
      }
    });

    const inputArea = sidebar.querySelector('.c2p-input-area');
    if (inputArea) {
      inputArea.addEventListener('click', e => {
        if (!e.target.closest('button')) {
          focusMsgInput();
        }
      });
    }

    const nudgeBtn = document.getElementById('c2p-nudge-btn');
    if (nudgeBtn) {
      nudgeBtn.addEventListener('mousedown', e => e.preventDefault());
      nudgeBtn.addEventListener('click', sendNudge);
    }
    sidebar.querySelectorAll('.c2p-effect-item').forEach(btn => {
      btn.addEventListener('mousedown', e => e.preventDefault());
      btn.addEventListener('click', e => {
        e.stopPropagation();
        sendEffect(btn.getAttribute('data-effect'));
        const menu = document.getElementById('c2p-effects-menu');
        if (menu) {
          menu.style.display = 'none';
          setTimeout(() => { if (menu) menu.style.display = ''; }, 300);
        }
      });
    });
    document.getElementById('c2p-mic-btn').addEventListener('click', startRecording);
    document.getElementById('c2p-record-cancel-btn').addEventListener('click', cancelRecording);
    document.getElementById('c2p-record-send-btn').addEventListener('click', finishAndSendRecording);
    sidebar.querySelectorAll('.c2p-emoji-btn').forEach(btn => {
      btn.addEventListener('mousedown', e => e.preventDefault());
      btn.addEventListener('click', () => sendEmoji(btn.getAttribute('data-emoji')));
    });
    sidebar.querySelectorAll('.c2p-sfx-btn').forEach(btn => {
      btn.addEventListener('mousedown', e => e.preventDefault());
      btn.addEventListener('click', () => sendSoundEffect(parseInt(btn.getAttribute('data-sfx'), 10)));
    });

    const gifBtn = document.getElementById('c2p-gif-btn');
    const klipyContainer = document.getElementById('c2p-klipy-container');
    const klipySearch = document.getElementById('c2p-klipy-search');
    const klipyClose = document.getElementById('c2p-klipy-close');
    const klipyResults = document.getElementById('c2p-klipy-results');

    setupInputFocusProtection(klipySearch);

    gifBtn.addEventListener('click', () => {
      const sm = document.getElementById('c2p-settings-modal'); if (sm) sm.style.display = 'none';
      if (klipyContainer.style.display === 'none') {
        klipyContainer.style.display = 'flex';
        activeSidebarInput = klipySearch;
        setTimeout(() => klipySearch.focus(), 50);
        if (klipyResults.children.length === 0) {
          currentGifQuery = '';
          fetchTrendingGifs(true);
        }
      } else {
        klipyContainer.style.display = 'none';
        focusMsgInput();
      }
    });

    klipyClose.addEventListener('click', () => {
      klipyContainer.style.display = 'none';
      focusMsgInput();
    });

    klipySearch.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.keyCode === 13) {
        e.preventDefault();
        clearTimeout(gifSearchTimeout);
        const query = klipySearch.value.trim();
        if (query.length > 0) {
          currentGifQuery = query;
          searchKlipyGifs(query, true);
        }
      }
    });

    klipySearch.addEventListener('input', (e) => {
      clearTimeout(gifSearchTimeout);
      const query = e.target.value.trim();
      if (query.length === 0) {
        currentGifQuery = '';
        fetchTrendingGifs(true);
        return;
      }
      gifSearchTimeout = setTimeout(() => {
        currentGifQuery = query;
        searchKlipyGifs(query, true);
      }, 500);
    });

    klipyResults.addEventListener('scroll', () => {
      if (isLoadingGifs || !hasMoreGifs) return;
      if (klipyResults.scrollTop + klipyResults.clientHeight >= klipyResults.scrollHeight - 100) {
        if (currentGifQuery) {
          searchKlipyGifs(currentGifQuery, false);
        } else {
          fetchTrendingGifs(false);
        }
      }
    });

    const messagesEl = document.getElementById('c2p-messages');
    if (messagesEl) {
      messagesEl.addEventListener('scroll', () => {
        const distFromBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight;
        userScrolledUp = distFromBottom > SCROLL_THRESHOLD;
        if (!userScrolledUp) {
          hasUnreadBelow = false;
        }
        updateScrollBottomBtn();
      }, { passive: true });
    }

    const scrollBottomBtn = document.getElementById('c2p-scroll-bottom-btn');
    if (scrollBottomBtn) {
      scrollBottomBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        scrollToBottom(true);
      });
    }

    sidebar.addEventListener('wheel', e => e.stopPropagation(), { passive: true });

    // Move sidebar inside fullscreen element so it doesn't turn black
    const handleFullscreen = () => {
      const fsElement = document.fullscreenElement || document.webkitFullscreenElement;
      const target = (fsElement && fsElement.tagName !== 'VIDEO') ? fsElement : document.body;
      if (sidebar.parentElement !== target) {
        const wasFocused = document.activeElement === document.getElementById('c2p-msg-input');
        target.appendChild(sidebar);
        target.appendChild(toggleBtn);
        if (wasFocused) {
          focusMsgInput();
        }
      }
      if (confettiCanvas && confettiCanvas.parentElement !== target) {
        target.appendChild(confettiCanvas);
      }
      if (fireworksCanvas && fireworksCanvas.parentElement !== target) {
        target.appendChild(fireworksCanvas);
      }
      if (tomatoCanvas && tomatoCanvas.parentElement !== target) {
        target.appendChild(tomatoCanvas);
      }
      if (danceCanvas && danceCanvas.parentElement !== target) {
        target.appendChild(danceCanvas);
      }
      if (stareCanvas && stareCanvas.parentElement !== target) {
        target.appendChild(stareCanvas);
      }
      if (smirkCanvas && smirkCanvas.parentElement !== target) {
        target.appendChild(smirkCanvas);
      }
      if (knockCanvas && knockCanvas.parentElement !== target) {
        target.appendChild(knockCanvas);
      }
      if (sheepCanvas && sheepCanvas.parentElement !== target) {
        target.appendChild(sheepCanvas);
      }
      if (eyebrowCanvas && eyebrowCanvas.parentElement !== target) {
        target.appendChild(eyebrowCanvas);
      }
      if (disgustedCanvas && disgustedCanvas.parentElement !== target) {
        target.appendChild(disgustedCanvas);
      }
      if (!userScrolledUp) {
        scrollToBottom(false);
      }
    };
    document.addEventListener('fullscreenchange', handleFullscreen);
    document.addEventListener('webkitfullscreenchange', handleFullscreen);
    let lastWinWidth = window.innerWidth;
    let lastWinHeight = window.innerHeight;
    window.addEventListener('resize', () => {
      if (!sidebarVisible) return;
      const w = window.innerWidth, h = window.innerHeight;
      if (w === lastWinWidth && h === lastWinHeight) return;
      lastWinWidth = w;
      lastWinHeight = h;
      if (!userScrolledUp) {
        scrollToBottom(false);
      }
    });
  }

  function updateScrollBottomBtn() {
    const btn = document.getElementById('c2p-scroll-bottom-btn');
    if (!btn) return;
    if (userScrolledUp) {
      btn.classList.remove('c2p-hidden');
      if (hasUnreadBelow) {
        btn.classList.add('c2p-has-unread');
      } else {
        btn.classList.remove('c2p-has-unread');
      }
      const txt = document.getElementById('c2p-scroll-btn-text');
      if (txt) txt.textContent = hasUnreadBelow ? 'New messages ↓' : 'Jump to bottom ↓';
    } else {
      hasUnreadBelow = false;
      btn.classList.add('c2p-hidden');
      btn.classList.remove('c2p-has-unread');
    }
  }

  function scrollToBottom(smooth = false) {
    const c = document.getElementById('c2p-messages');
    if (!c) return;
    userScrolledUp = false;
    hasUnreadBelow = false;
    updateScrollBottomBtn();
    if (smooth) c.scrollTo({ top: c.scrollHeight, behavior: 'smooth' });
    else c.scrollTop = c.scrollHeight;
  }

  function focusMsgInput() {
    if (sidebarVisible) {
      userClickedOutside = false;
      setTimeout(() => {
        const inp = document.getElementById('c2p-msg-input');
        if (inp && !inp.disabled) {
          activeSidebarInput = inp;
          inp.focus();
        }
      }, 150);
    }
  }

  function toggleSidebar(forceOpen = null, persist = true) {
    sidebarVisible = typeof forceOpen === 'boolean' ? forceOpen : !sidebarVisible;
    const sidebar = document.getElementById('c2p-sidebar');
    const btn = document.getElementById('c2p-toggle-btn');
    if (!sidebar || !btn) return;
    if (sidebarVisible) {
      sidebar.classList.remove('c2p-hidden'); btn.classList.add('c2p-sidebar-open');
      document.body.classList.add('c2p-sidebar-active');
      focusMsgInput();
      if (!userScrolledUp) {
        scrollToBottom(false);
      }
      if (persist) {
        try { sessionStorage.setItem('c2p_sidebar_open', '1'); } catch(e){}
      }
      checkUpdateOnFirstOpen();
    } else {
      activeSidebarInput = null;
      sidebar.classList.add('c2p-hidden'); btn.classList.remove('c2p-sidebar-open');
      document.body.classList.remove('c2p-sidebar-active');
      const kc = document.getElementById('c2p-klipy-container'); if (kc) kc.style.display = 'none';
      const sm = document.getElementById('c2p-settings-modal'); if (sm) sm.style.display = 'none';
      if (persist) {
        try { sessionStorage.removeItem('c2p_sidebar_open'); } catch(e){}
      }
    }
  }

  // ── Helpers ──
  function updateStatus(state, text) {
    const b = document.getElementById('c2p-status');
    if (b) { b.className = `c2p-status-badge c2p-${state}`; b.textContent = text; }
    if (state === 'disconnected') {
      const p = document.getElementById('c2p-status-popover');
      if (p) p.style.display = 'none';
    }
  }
  const SYSTEM_ICONS = {
    clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    bell: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
    lock: '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    warn: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
    refresh: '<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>',
    play: '<polygon points="5 3 19 12 5 21 5 3"/>',
    pause: '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>',
    seek: '<polygon points="13 19 22 12 13 5 13 19"/><polygon points="2 19 11 12 2 5 2 19"/>',
    speed: '<path d="M12 14l4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
    audio: '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>',
    party: '<polygon points="4 22 7.5 13.5 10.5 16.5 4 22"/><path d="M12 15l2-2"/><path d="M16 11l4-4"/><path d="M17 2l.5 2.5L20 5l-2.5.5L17 8l-.5-2.5L14 5l2.5-.5z"/><circle cx="10" cy="5" r="1"/><circle cx="5" cy="10" r="1"/>',
    fireworks: '<path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>',
    tomato: '<circle cx="12" cy="13" r="8"/><path d="M12 5v3M9 6l3 2 3-2"/>',
    dance: '<circle cx="12" cy="4" r="2"/><path d="M9 22l3-9 3 9M6 13l6-3 6 3"/>',
    stare: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
    smirk: '<circle cx="12" cy="12" r="10"/><path d="M8 9.5a2 2 0 0 1 2-1M14 8.5a2 2 0 0 1 2 1M9 16c2 0 5-1 6-3"/>',
    knock: '<path d="M18 11V6a2 2 0 0 0-4 0v5"/><path d="M14 10V4a2 2 0 0 0-4 0v8"/><path d="M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-6-2.34l-3.6-3.6a2 2 0 0 1 2.8-2.8L7 15"/>',
    sheep: '<path d="M9 11a4 4 0 1 1 6 0c.5.8.9 1.8 1 3h-8c.1-1.2.5-2.2 1-3Z"/><path d="M7 9C5 9 4 10.5 4 12s1 2 2 2"/><path d="M17 9c2 0 3 1.5 3 3s-1 2-2 2"/><circle cx="10" cy="11" r="1"/><circle cx="14" cy="11" r="1"/><path d="M11 13h2"/>',
    eyebrow: '<circle cx="12" cy="12" r="10"/><path d="M8 9a1.5 1.5 0 0 1 2.5 0M13.5 7.5c1-1 3-1 4 .5"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="11" r="1"/><path d="M9 16c2 0 4-1 6-2"/>',
    disgusted: '<circle cx="12" cy="12" r="10"/><path d="M8 9a1.5 1.5 0 0 1 2.5 0M13.5 9a1.5 1.5 0 0 1 2.5 0"/><circle cx="9" cy="11.5" r="1"/><circle cx="15" cy="11.5" r="1"/><path d="M8.5 16.5c1.5-1.5 5.5-1.5 7 0"/>',
    pip: '<rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><rect x="11" y="9" width="9" height="6" rx="1" ry="1"/>'
  };
  function getSystemIconSvg(type) {
    const p = SYSTEM_ICONS[type];
    return p ? `<svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round">${p}</svg>` : '';
  }
  function displaySystemMessage(t, icon = null) {
    const d = document.createElement('div');
    d.classList.add('c2p-msg', 'c2p-system');
    if (icon) d.innerHTML = getSystemIconSvg(icon);
    const span = document.createElement('span');
    span.textContent = t;
    d.appendChild(span);
    appendMsg(d);
  }
  function displayActionMessage(text, actionText, actionFn, icon = null) {
    const d = document.createElement('div');
    d.classList.add('c2p-msg', 'c2p-system');
    if (icon) d.innerHTML = getSystemIconSvg(icon);
    const span = document.createElement('span');
    span.textContent = text;
    d.appendChild(span);
    if (actionText && actionFn) {
      const btn = document.createElement('button');
      btn.classList.add('c2p-inline-action-btn');
      btn.textContent = actionText;
      btn.addEventListener('click', actionFn);
      d.appendChild(btn);
    }
    appendMsg(d);
  }
  function showSetupBanner(btnText = 'Reconnect Fresh Session', hintText = 'Click to establish a fresh session.') {
    const su = document.getElementById('c2p-setup');
    const btn = document.getElementById('c2p-connect-btn');
    const hint = document.getElementById('c2p-setup-hint');
    if (su) su.style.display = 'flex';
    if (btn) { btn.disabled = false; btn.textContent = btnText; }
    if (hint) { hint.textContent = hintText; hint.style.color = '#888'; }
  }
  let currentReply = null;
  function setReply(text) {
    clearEditing();
    currentReply = text;
    const bar = document.getElementById('c2p-reply-bar');
    const txt = document.getElementById('c2p-reply-bar-text');
    if (bar && txt) {
      txt.textContent = text;
      bar.style.display = 'flex';
    }
    focusMsgInput();
  }
  function clearReply() {
    currentReply = null;
    const bar = document.getElementById('c2p-reply-bar');
    const txt = document.getElementById('c2p-reply-bar-text');
    if (bar && txt) {
      bar.style.display = 'none';
      txt.textContent = '';
    }
  }

  let editingMsg = null;
  function setEditing(id, text) {
    if (!id) return;
    clearReply();
    editingMsg = { id, originalContent: text };
    const bar = document.getElementById('c2p-edit-bar');
    const txt = document.getElementById('c2p-edit-bar-text');
    if (bar && txt) {
      txt.textContent = text;
      bar.style.display = 'flex';
    }
    const input = document.getElementById('c2p-msg-input');
    if (input) {
      input.value = text;
      focusMsgInput();
      try { input.setSelectionRange(text.length, text.length); } catch(e){}
    }
  }
  function clearEditing() {
    editingMsg = null;
    const bar = document.getElementById('c2p-edit-bar');
    const txt = document.getElementById('c2p-edit-bar-text');
    if (bar && txt) {
      bar.style.display = 'none';
      txt.textContent = '';
    }
    const input = document.getElementById('c2p-msg-input');
    if (input) {
      input.value = '';
      focusMsgInput();
    }
  }
  function applyMessageEdit(id, newContent) {
    const el = document.querySelector(`.c2p-msg[data-msg-id="${id}"]`);
    if (!el) return;
    const textWrap = el.querySelector('.c2p-msg-text') || el;
    let editedTag = el.querySelector('.c2p-edited-tag');
    textWrap.textContent = newContent;
    if (!editedTag) {
      editedTag = document.createElement('span');
      editedTag.className = 'c2p-edited-tag';
      editedTag.textContent = ' (edited)';
    }
    textWrap.appendChild(editedTag);
    const editBtn = el.querySelector('.c2p-edit-btn');
    if (editBtn) {
      editBtn.onclick = () => setEditing(id, newContent);
    }
  }

  function displayUserMessage(content, type, isGif = false, author = null, isImage = false, replyTo = null, msgId = null) {
    const d = document.createElement('div'); d.classList.add('c2p-msg', `c2p-${type}`);
    if (msgId) d.dataset.msgId = msgId;
    if (replyTo) {
      const q = document.createElement('div');
      q.classList.add('c2p-reply-preview');
      q.innerHTML = `
        <svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
          <path d="M6 3L2 7l4 4"/>
          <path d="M2 7h7a4 4 0 0 1 4 4v2"/>
        </svg>
        <span class="c2p-reply-preview-text"></span>
      `;
      q.querySelector('.c2p-reply-preview-text').textContent = replyTo;
      d.appendChild(q);
    }
    if (isGif) {
      if (!replyTo) d.style.cssText = 'background:transparent;padding:0;border:none';
      const w = document.createElement('div'); w.classList.add('c2p-gif-wrap');
      const i = document.createElement('img'); i.src = content;
      i.onload = () => { if (!userScrolledUp) scrollToBottom(true); };
      w.appendChild(i); d.appendChild(w);
    } else if (isImage) {
      if (!replyTo) d.style.cssText = 'background:transparent;padding:0;border:none';
      if (author && type === 'received') {
        const authEl = document.createElement('div');
        authEl.classList.add('c2p-msg-author');
        authEl.style.padding = '0 4px 4px';
        authEl.textContent = author;
        d.appendChild(authEl);
      }
      const w = document.createElement('div');
      w.classList.add('c2p-image-wrap');
      const img = document.createElement('img');
      img.src = content;
      img.onload = () => { if (!userScrolledUp) scrollToBottom(true); };
      img.alt = 'Pasted image';
      img.title = 'Click to open in new tab';
      img.addEventListener('click', () => {
        const win = window.open();
        if (win) {
          win.document.write(`<body style="margin:0;background:#111;display:flex;align-items:center;justify-content:center;height:100vh;"><img src="${content}" style="max-width:100%;max-height:100%;object-fit:contain;"></body>`);
        }
      });
      w.appendChild(img);
      d.appendChild(w);
    } else {
      if (author && type === 'received') {
        const authEl = document.createElement('div');
        authEl.classList.add('c2p-msg-author');
        authEl.textContent = author;
        d.appendChild(authEl);
      }
      const textEl = document.createElement('div');
      textEl.className = 'c2p-msg-text';
      textEl.textContent = content;
      d.appendChild(textEl);
    }
    if (type === 'received') {
      const rb = document.createElement('button');
      rb.className = 'c2p-reply-btn';
      rb.type = 'button';
      rb.title = 'Reply';
      rb.innerHTML = `
        <svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
          <path d="M6 3L2 7l4 4"/>
          <path d="M2 7h7a4 4 0 0 1 4 4v2"/>
        </svg>
        <span>Reply</span>
      `;
      rb.onclick = () => setReply(isGif ? '[GIF]' : isImage ? '[Image]' : content);
      d.appendChild(rb);
    } else if (type === 'sent' && !isGif && !isImage && msgId) {
      const eb = document.createElement('button');
      eb.className = 'c2p-edit-btn';
      eb.type = 'button';
      eb.title = 'Edit';
      eb.innerHTML = `
        <svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
          <path d="M11.5 2.5a1.414 1.414 0 0 1 2 2L5 13H2v-3L10.5 1.5z"/>
        </svg>
        <span>Edit</span>
      `;
      eb.onclick = () => setEditing(msgId, content);
      d.appendChild(eb);
    }
    appendMsg(d);
  }
  function appendMsg(el) {
    const c = document.getElementById('c2p-messages');
    if (!c) return;
    const isSentByMe = el.classList.contains('c2p-sent');
    const wasNearBottom = !userScrolledUp;
    c.appendChild(el);
    if (isSentByMe || wasNearBottom) {
      scrollToBottom(true);
    } else {
      hasUnreadBelow = true;
      updateScrollBottomBtn();
    }
  }
  function setInputEnabled(on) {
    const i=document.getElementById('c2p-msg-input'),s=document.getElementById('c2p-send-btn'),g=document.getElementById('c2p-gif-btn'),m=document.getElementById('c2p-mic-btn'),n=document.getElementById('c2p-nudge-btn');
    if(i)i.disabled=!on; if(s)s.disabled=!on; if(g)g.disabled=!on; if(m)m.disabled=!on; if(n)n.disabled=!on || nudgeCooldown;
    document.querySelectorAll('#c2p-sidebar .c2p-emoji-btn, #c2p-sidebar .c2p-sfx-btn').forEach(b=>b.disabled=!on);
    document.querySelectorAll('#c2p-sidebar .c2p-effect-item').forEach(b => {
      b.disabled = !on || (b.getAttribute('data-effect') !== 'tomato' && effectCooldown);
    });
    const wrap = document.getElementById('c2p-effects-wrapper');
    if (wrap) wrap.classList.toggle('c2p-disabled', !on);
  }

  // ── Sync & Netflix Player ──
  function isWatchPage() {
    return window.location.pathname.startsWith('/watch');
  }

  function syncSidebarWithRoute() {
    if (!isWatchPage()) {
      // Home / Browse: never open automatically
      if (sidebarVisible) toggleSidebar(false, false);
    } else {
      // Watch page: remember if user opened or closed the chat
      const wasOpen = sessionStorage.getItem('c2p_sidebar_open') === '1';
      if (wasOpen && !sidebarVisible) {
        toggleSidebar(true, false);
      } else if (!wasOpen && sidebarVisible) {
        toggleSidebar(false, false);
      }
    }
  }

  function getNetflixPlayer() {
    if (!isWatchPage()) return null;
    try {
      const win = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
      const vp = win?.netflix?.appContext?.state?.playerApp?.getAPI()?.videoPlayer;
      if (!vp) return null;
      const sids = vp.getAllPlayerSessionIds() || [];
      // the active full-screen playback session contains "watch"
      const sid = sids.find(id => id.includes('watch'));
      return sid ? vp.getVideoPlayerBySessionId(sid) : null;
    } catch (e) {
      return null;
    }
  }

  function getPlayer() {
    if (!isWatchPage()) return null;
    const np = getNetflixPlayer();
    const v = document.querySelector('.watch-video video') || (isWatchPage() ? document.querySelector('video') : null);
    if (np) {
      return {
        play: () => np.play(),
        pause: () => np.pause(),
        // -100ms offset prevents keyframe boundary decoding freezes
        seek: (ms) => np.seek(Math.max(0, ms - 100)),
        getTime: () => (np.getSegmentTime?.() ?? np.getCurrentTime()) || 0,
        isPaused: () => np.isPaused(),
        getPlaybackRate: () => {
          if (typeof np.getPlaybackRate === 'function') {
            try {
              const r = np.getPlaybackRate();
              if (typeof r === 'number' && !isNaN(r) && r > 0) return r;
            } catch (e) {}
          }
          if (v && typeof v.playbackRate === 'number' && v.playbackRate > 0) {
            return v.playbackRate;
          }
          return 1;
        },
        setPlaybackRate: (rate) => {
          const num = Number(rate);
          if (isNaN(num) || num <= 0) return;
          if (typeof np.setPlaybackRate === 'function') {
            try { np.setPlaybackRate(num); } catch (e) {}
          }
          if (v) {
            try { v.playbackRate = num; } catch (e) {}
          }
        },
        isReady: true
      };
    }
    if (v) {
      return {
        play: () => v.play().catch(() => {}),
        pause: () => v.pause(),
        seek: (ms) => { v.currentTime = Math.max(0, (ms - 100) / 1000); },
        getTime: () => (v.currentTime * 1000) || 0,
        isPaused: () => v.paused,
        getPlaybackRate: () => (typeof v.playbackRate === 'number' && v.playbackRate > 0) ? v.playbackRate : 1,
        setPlaybackRate: (rate) => {
          const num = Number(rate);
          if (!isNaN(num) && num > 0) {
            try { v.playbackRate = num; } catch (e) {}
          }
        },
        isReady: v.readyState > 0
      };
    }
    return null;
  }

  function formatSpeed(speed) {
    const s = Number(speed);
    if (isNaN(s) || s <= 0) return '1x';
    return `${parseFloat(s.toFixed(2))}x`;
  }

  // Synthetic mousemove to wake up Netflix controls & sync rendering
  function wakeNetflixUI() {
    if (!isWatchPage()) return;
    const c = document.querySelector('.VideoContainer') || document.querySelector('.watch-video');
    if (c) {
      c.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 100, clientY: 100 }));
    }
  }

  // ── Picture-in-Picture ──
  function enablePiPOnVideo(v) {
    if (!v) return;
    if (v.hasAttribute('disablepictureinpicture')) {
      v.removeAttribute('disablepictureinpicture');
    }
    if (v.disablePictureInPicture) {
      try {
        Object.defineProperty(v, 'disablePictureInPicture', {
          get: () => false,
          set: () => {},
          configurable: true
        });
      } catch (e) {
        v.disablePictureInPicture = false;
      }
    }
  }

  async function togglePictureInPicture() {
    const v = document.querySelector('.watch-video video') || (isWatchPage() ? document.querySelector('video') : null);
    if (!v) return;
    enablePiPOnVideo(v);

    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (document.pictureInPictureEnabled || v.requestPictureInPicture) {
        await v.requestPictureInPicture();
      } else {
        displaySystemMessage('Picture-in-Picture not supported in this browser', 'warn');
      }
    } catch (err) {
      console.warn('[C2P] Picture-in-Picture error:', err);
    }
  }

  // Teleparty-inspired video ID extraction from URL or DOM container
  function getVideoId() {
    if (!isWatchPage()) return null;
    const m = window.location.pathname.match(/\/watch\/([0-9]+)/);
    if (m) return m[1];
    const domId = document.querySelector('.watch-video video')?.parentElement?.id;
    return (domId && /^[0-9]+$/.test(domId)) ? domId : null;
  }

  // Teleparty-inspired Main World bridge: invokes React Fiber API directly in Netflix's page realm without reload
  (function injectMainWorldBridge() {
    try {
      if (document.getElementById('c2p-bridge')) return;
      const script = document.createElement('script');
      script.id = 'c2p-bridge';
      script.textContent = `(${function() {
        window.__c2p_getEpisodeData = function() {
          try {
            var root = document.querySelector('.watch-video');
            if (root) {
              var fiberKey = Object.keys(root).find(function(k) { return k.startsWith('__reactFiber'); });
              if (fiberKey) {
                var node = root[fiberKey];
                for (var i = 0; i < 8 && node; i++) {
                  var meta = node.stateNode?.state?.activeVideoMetadata;
                  if (meta) {
                    return {
                      seq: meta._video?.seq,
                      title: meta._video?.title,
                      seasonSeq: meta._season?._season?.seq
                    };
                  }
                  node = node.return;
                }
              }
            }
          } catch(e) {}
          return null;
        };

        window.addEventListener('message', function(e) {
          if (!e.data) return;
          if (e.data.type === 'C2P_NAVIGATE_EPISODE') {
            var targetId = parseInt(e.data.videoId, 10);
            try {
              var root = document.querySelector('.watch-video');
              if (root) {
                var fiberKey = Object.keys(root).find(function(k) { return k.startsWith('__reactFiber'); });
                if (fiberKey) {
                  var node = root[fiberKey];
                  for (var i = 0; i < 8 && node; i++) {
                    var api = node.stateNode;
                    if (api && typeof api.handleSelectorEpisodePlay === 'function') {
                      console.log('[C2P Bridge] In-page episode change via React Fiber:', targetId);
                      api.handleSelectorEpisodePlay({ stopPropagation: function() {} }, targetId);
                      return;
                    }
                    node = node.return;
                  }
                }
              }
            } catch(err) {
              console.warn('[C2P Bridge] React Fiber episode change failed:', err);
            }
          } else if (e.data.type === 'C2P_WATCH_CREDITS') {
            try {
              var btn = document.querySelector('[data-uia="watch-credits-seamless-button"], [data-uia="watch-credits"], [data-uia*="credits"]')
                || Array.from(document.querySelectorAll('button, [role="button"], a')).find(function(b) {
                  return /watch.*credit|ver.*cr[eé]dito/i.test(b.textContent || b.getAttribute('aria-label') || '');
                });
              if (btn) {
                btn.click();
                return;
              }
              var root = document.querySelector('.watch-video');
              if (root) {
                var fiberKey = Object.keys(root).find(function(k) { return k.startsWith('__reactFiber'); });
                if (fiberKey) {
                  var node = root[fiberKey];
                  for (var i = 0; i < 10 && node; i++) {
                    var api = node.stateNode;
                    if (api) {
                      if (typeof api.handleDismissPostPlay === 'function') { api.handleDismissPostPlay(); return; }
                      if (typeof api.handleWatchCredits === 'function') { api.handleWatchCredits(); return; }
                      if (typeof api.dismissPostPlay === 'function') { api.dismissPostPlay(); return; }
                    }
                    node = node.return;
                  }
                }
              }
            } catch(err) {
              console.warn('[C2P Bridge] Watch credits trigger failed:', err);
            }
          } else if (e.data.type === 'C2P_TRIGGER_NEXT_EPISODE') {
            try {
              var btn = document.querySelector(
                '[data-uia="next-episode-seamless-button"], [data-uia="next-episode-seamless-button-draining"], [data-uia="control-next"], [data-uia="postplay-play-button"], .button-nfplayerNextEpisode, [data-uia*="next-episode"]'
              ) || Array.from(document.querySelectorAll('button, [role="button"], a')).find(function(b) {
                return /next.*episode|siguiente.*episodio|pr[oó]ximo.*episodio/i.test(b.textContent || b.getAttribute('aria-label') || '');
              });
              if (btn) {
                btn.click();
                return;
              }
              var root = document.querySelector('.watch-video');
              if (root) {
                var fiberKey = Object.keys(root).find(function(k) { return k.startsWith('__reactFiber'); });
                if (fiberKey) {
                  var node = root[fiberKey];
                  for (var i = 0; i < 10 && node; i++) {
                    var api = node.stateNode;
                    if (api) {
                      if (typeof api.handlePlayNextEpisode === 'function') { api.handlePlayNextEpisode(); return; }
                      if (typeof api.handleNextEpisode === 'function') { api.handleNextEpisode(); return; }
                    }
                    node = node.return;
                  }
                }
              }
            } catch(err) {
              console.warn('[C2P Bridge] Next episode trigger failed:', err);
            }
          }
        });
      }})();`;
      (document.head || document.documentElement).appendChild(script);
    } catch(e) {
      console.warn('[C2P] Could not inject main world bridge:', e);
    }
  })();

  // Extract human-readable episode label (e.g. "Episode 1" or "Episode 1: Title")
  function getEpisodeLabel(vid = null) {
    try {
      // 1. Try Main-World bridge React Fiber metadata
      const win = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
      const data = typeof win.__c2p_getEpisodeData === 'function' ? win.__c2p_getEpisodeData() : null;
      if (data && data.seq) {
        return data.title ? `Episode ${data.seq}: ${data.title}` : `Episode ${data.seq}`;
      }

      // 2. Try Netflix UI title container [data-uia="video-title"]
      const titleEl = document.querySelector('[data-uia="video-title"]');
      if (titleEl) {
        const spans = Array.from(titleEl.querySelectorAll('span')).map(s => s.textContent.trim()).filter(Boolean);
        const epSpan = spans.find(t => /^(S\d+:E\d+|T\d+:E\d+|Ep\w*\.?\s*\d+)/i.test(t));
        if (epSpan) {
          const numMatch = epSpan.match(/E(\d+)/i) || epSpan.match(/(\d+)/);
          const epNum = numMatch ? numMatch[1] : null;
          const titleSpan = spans.find(t => t !== epSpan);
          if (epNum) return titleSpan ? `Episode ${epNum}: ${titleSpan}` : `Episode ${epNum}`;
          return titleSpan ? `${epSpan}: ${titleSpan}` : epSpan;
        }
        if (spans.length > 0) return spans.join(' - ');
      }

      // 3. Try document.title (e.g. "Show - Season 1: Episode 1")
      const m = document.title.match(/(?:Season\s*\d+[:\s]+)?(?:Episode|Episodio|Cap[ií]tulo)\s*(\d+)/i)
        || document.title.match(/(?:S\d+[:\s]*E|T\d+[:\s]*E)(\d+)/i);
      if (m && m[1]) return `Episode ${m[1]}`;

      // 4. Try matching DOM episode link for vid
      if (vid) {
        const link = document.querySelector(`a[href*="/watch/${vid}"]`);
        if (link?.textContent.trim()) {
          const lm = link.textContent.trim().match(/^(\d+)\.\s*(.*)/);
          return lm ? `Episode ${lm[1]}${lm[2] ? ': ' + lm[2] : ''}` : link.textContent.trim();
        }
      }
    } catch (e) {}
    return vid ? `Episode ${vid}` : 'Episode';
  }

  // Teleparty-inspired episode changer (Main-World React Fiber -> DOM links -> SPA fallback)
  function changeEpisode(videoId) {
    if (!videoId) return;
    const targetId = String(videoId);
    if (getVideoId() === targetId) return;

    suppressBroadcast++;

    // 1. Direct unsafeWindow React Fiber attempt
    try {
      const win = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
      const root = (win.document || document).querySelector('.watch-video');
      if (root) {
        const fiberKey = Object.keys(root).find(k => k.startsWith('__reactFiber'));
        if (fiberKey) {
          let node = root[fiberKey];
          for (let i = 0; i < 8 && node; i++) {
            const api = node.stateNode;
            if (api && typeof api.handleSelectorEpisodePlay === 'function') {
              console.log("[C2P] Switching episode via direct React Fiber:", targetId);
              api.handleSelectorEpisodePlay({ stopPropagation: () => {} }, parseInt(targetId, 10));
              setTimeout(() => { suppressBroadcast = Math.max(0, suppressBroadcast - 1); }, 2000);
              return;
            }
            node = node.return;
          }
        }
      }
    } catch (e) {}

    // 2. PostMessage to Main-World bridge (unproxied React realm)
    window.postMessage({ type: 'C2P_NAVIGATE_EPISODE', videoId: targetId }, '*');

    // 3. DOM episode selector link
    const epLink = document.querySelector(`a[href*="/watch/${targetId}"]`);
    if (epLink) {
      console.log("[C2P] Clicking episode link in DOM:", targetId);
      epLink.click();
      setTimeout(() => { suppressBroadcast = Math.max(0, suppressBroadcast - 1); }, 2000);
      return;
    }

    // 4. Next episode button in DOM
    const nextBtn = document.querySelector('[data-uia="next-episode-seamless-button"], [data-uia="control-next"], .button-nfplayerNextEpisode');
    if (nextBtn) {
      console.log("[C2P] Clicking next episode button in DOM");
      nextBtn.click();
      setTimeout(() => { suppressBroadcast = Math.max(0, suppressBroadcast - 1); }, 2000);
      return;
    }

    // 5. Fallback navigation with session persistence if in-page switch does not apply
    setTimeout(() => {
      if (getVideoId() !== targetId) {
        console.log("[C2P] Fallback navigating with persistence to /watch/" + targetId);
        try {
          sessionStorage.setItem('c2p_session_active', '1');
          if (sidebarVisible) {
            sessionStorage.setItem('c2p_sidebar_open', '1');
          } else {
            sessionStorage.removeItem('c2p_sidebar_open');
          }
        } catch(e) {}
        window.location.assign(`/watch/${targetId}`);
      }
      suppressBroadcast = Math.max(0, suppressBroadcast - 1);
    }, 1000);
  }

  // Teleparty-inspired history hook to immediately catch SPA navigation
  (function hookHistory() {
    const origPush = history.pushState;
    history.pushState = function() {
      const res = origPush.apply(this, arguments);
      setTimeout(() => {
        syncSidebarWithRoute();
        pollPlayerState(true);
      }, 100);
      return res;
    };
    const origReplace = history.replaceState;
    history.replaceState = function() {
      const res = origReplace.apply(this, arguments);
      setTimeout(() => {
        syncSidebarWithRoute();
        pollPlayerState(true);
      }, 100);
      return res;
    };
    window.addEventListener('popstate', () => setTimeout(() => {
      syncSidebarWithRoute();
      pollPlayerState(true);
    }, 100));
  })();

  let userListenersAttached = false;
  let lastCreditsClick = 0;
  let lastNextEpClick = 0;

  function extractNextEpisodeId(btn) {
    if (!btn) return null;
    const link = btn.closest('a') || btn.querySelector('a');
    if (link && link.href) {
      const m = link.href.match(/\/watch\/(\d+)/);
      if (m) return m[1];
    }
    const elWithId = btn.closest('[data-episode-id], [data-videoid], [data-id]');
    if (elWithId) {
      const id = elWithId.getAttribute('data-episode-id') || elWithId.getAttribute('data-videoid') || elWithId.getAttribute('data-id');
      if (id && /^\d+$/.test(id)) return id;
    }
    const card = btn.closest('.postplay, [data-uia*="postplay"], .seamless-control');
    if (card) {
      const cardLink = card.querySelector('a[href*="/watch/"]');
      if (cardLink) {
        const m = cardLink.href.match(/\/watch\/(\d+)/);
        if (m) return m[1];
      }
    }
    return null;
  }

  function handlePlayerInteractionClick(e) {
    if (!isWatchPage() || suppressBroadcast > 0) return;
    if (!e.target) return;
    if (e.target.closest?.('#c2p-sidebar') || e.target.closest?.('#c2p-toggle-btn')) return;

    const now = Date.now();

    // 1. Detect "Watch credits" / "Ver créditos"
    const creditsBtn = e.target.closest?.(
      '[data-uia="watch-credits-seamless-button"], [data-uia="watch-credits"], [data-uia*="credits"], [data-uia*="credit"]'
    ) || (e.target.closest?.('button, [role="button"], a') && /watch.*credit|ver.*cr[eé]dito/i.test(
      e.target.closest('button, [role="button"], a').textContent ||
      e.target.closest('button, [role="button"], a').getAttribute('aria-label') || ''
    ) ? e.target.closest('button, [role="button"], a') : null);

    if (creditsBtn) {
      if (now - lastCreditsClick < 2500) return;
      lastCreditsClick = now;
      console.log('[C2P] User clicked watch credits button');
      displaySystemMessage('You chose to watch credits', 'play');
      if (dataChannel && dataChannel.readyState === 'open') {
        dataChannel.send(JSON.stringify({
          type: 'sync',
          action: 'watch_credits',
          time: getPlayer()?.getTime() || 0
        }));
      }
      return;
    }

    // 2. Detect "Next episode" / "Siguiente episodio"
    const nextBtn = e.target.closest?.(
      '[data-uia="next-episode-seamless-button"], [data-uia="next-episode-seamless-button-draining"], [data-uia="control-next"], [data-uia="postplay-play-button"], .button-nfplayerNextEpisode, [data-uia*="next-episode"]'
    ) || (e.target.closest?.('button, [role="button"], a') && /next.*episode|siguiente.*episodio|pr[oó]ximo.*episodio/i.test(
      e.target.closest('button, [role="button"], a').textContent ||
      e.target.closest('button, [role="button"], a').getAttribute('aria-label') || ''
    ) ? e.target.closest('button, [role="button"], a') : null);

    if (nextBtn) {
      if (now - lastNextEpClick < 2500) return;
      lastNextEpClick = now;
      console.log('[C2P] User clicked next episode button');
      displaySystemMessage('You clicked next episode', 'play');

      const targetVid = extractNextEpisodeId(nextBtn);
      if (dataChannel && dataChannel.readyState === 'open') {
        dataChannel.send(JSON.stringify({
          type: 'sync',
          action: 'next_episode',
          videoId: targetVid
        }));
      }
      return;
    }

    // 3. Detect "Skip intro" / "Omitir intro" / "Saltar intro"
    const skipIntroBtn = e.target.closest?.(
      '[data-uia="player-skip-intro"], [data-uia*="skip-intro"], [data-uia*="skip-credits"]'
    ) || (e.target.closest?.('button, [role="button"], a') && /skip.*intro|omitir.*intro|saltar.*intro|pular.*intro/i.test(
      e.target.closest('button, [role="button"], a').textContent ||
      e.target.closest('button, [role="button"], a').getAttribute('aria-label') || ''
    ) ? e.target.closest('button, [role="button"], a') : null);

    if (skipIntroBtn) {
      lastSeekTime = now;
      console.log('[C2P] User clicked skip intro, activating seek grace period');
      setTimeout(() => { if (isWatchPage()) pollPlayerState(true); }, 150);
      return;
    }
  }

  function triggerWatchCredits() {
    suppressBroadcast++;
    const findAndClickCredits = () => {
      const btn = document.querySelector(
        '[data-uia="watch-credits-seamless-button"], [data-uia="watch-credits"], [data-uia*="credits"], [data-uia*="credit"]'
      ) || Array.from(document.querySelectorAll('button, [role="button"], a')).find(b =>
        /watch.*credit|ver.*cr[eé]dito/i.test(b.textContent || b.getAttribute('aria-label') || '')
      );
      if (btn) {
        console.log('[C2P] Triggering watch credits in DOM');
        btn.click();
        return true;
      }
      return false;
    };

    if (findAndClickCredits()) {
      wakeNetflixUI();
      setTimeout(() => { suppressBroadcast = Math.max(0, suppressBroadcast - 1); }, 1000);
      return;
    }

    // Main world bridge
    window.postMessage({ type: 'C2P_WATCH_CREDITS' }, '*');

    let attempts = 0;
    const interval = setInterval(() => {
      attempts++;
      if (findAndClickCredits() || attempts >= 16) {
        clearInterval(interval);
        wakeNetflixUI();
        setTimeout(() => { suppressBroadcast = Math.max(0, suppressBroadcast - 1); }, 1000);
      }
    }, 250);
  }

  function triggerNextEpisode(targetId = null) {
    if (targetId) {
      changeEpisode(targetId);
      return;
    }
    suppressBroadcast++;
    const findAndClickNext = () => {
      const btn = document.querySelector(
        '[data-uia="next-episode-seamless-button"], [data-uia="next-episode-seamless-button-draining"], [data-uia="control-next"], [data-uia="postplay-play-button"], .button-nfplayerNextEpisode, [data-uia*="next-episode"]'
      ) || Array.from(document.querySelectorAll('button, [role="button"], a')).find(b =>
        /next.*episode|siguiente.*episodio|pr[oó]ximo.*episodio/i.test(b.textContent || b.getAttribute('aria-label') || '')
      );
      if (btn) {
        console.log('[C2P] Triggering next episode in DOM');
        btn.click();
        return true;
      }
      return false;
    };

    if (findAndClickNext()) {
      wakeNetflixUI();
      setTimeout(() => { suppressBroadcast = Math.max(0, suppressBroadcast - 1); }, 1500);
      return;
    }

    // Main world bridge
    window.postMessage({ type: 'C2P_TRIGGER_NEXT_EPISODE' }, '*');

    let attempts = 0;
    const interval = setInterval(() => {
      attempts++;
      if (findAndClickNext() || attempts >= 16) {
        clearInterval(interval);
        wakeNetflixUI();
        setTimeout(() => { suppressBroadcast = Math.max(0, suppressBroadcast - 1); }, 1500);
      }
    }, 250);
  }

  function attachUserInteractionListeners() {
    if (userListenersAttached) return;
    userListenersAttached = true;
    window.addEventListener('click', handlePlayerInteractionClick, true);
    // detect seeks when mouse scrub finishes or keyboard keys release
    window.addEventListener('mouseup', () => { if (isWatchPage()) pollPlayerState(true); });
    window.addEventListener('keydown', (e) => {
      if (!isWatchPage()) return;
      if (e.target && (e.target.closest?.('#c2p-sidebar') || ['INPUT', 'TEXTAREA'].includes(e.target.tagName) || e.target.isContentEditable)) return;
      if (e.key === 'p' || e.key === 'P') {
        e.preventDefault();
        togglePictureInPicture();
      }
    });
    window.addEventListener('keyup', (e) => {
      if (!isWatchPage()) return;
      if (e.target && (e.target.closest?.('#c2p-sidebar') || e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      pollPlayerState(true);
    });
    document.addEventListener('ratechange', () => {
      if (isWatchPage()) pollPlayerState(true);
    }, true);

    if (navigator.mediaSession) {
      try {
        navigator.mediaSession.setActionHandler('play', () => {
          if (!isWatchPage()) return;
          const p = getPlayer();
          if (p) { p.play(); pollPlayerState(true); }
        });
        navigator.mediaSession.setActionHandler('pause', () => {
          if (!isWatchPage()) return;
          const p = getPlayer();
          if (p) { p.pause(); pollPlayerState(true); }
        });
      } catch (e) {}
    }
  }

  function broadcastSync(action, time, videoId = null, episodeLabel = null, speed = null) {
    if (suppressBroadcast > 0 || !dataChannel || dataChannel.readyState !== 'open') return;
    const msg = { type: 'sync', action, time };
    if (videoId) msg.videoId = videoId;
    if (episodeLabel) msg.episodeLabel = episodeLabel;
    if (speed !== null && speed !== undefined) msg.speed = speed;
    dataChannel.send(JSON.stringify(msg));
  }

  function pollPlayerState(isUserTriggered = false) {
    if (!isWatchPage()) {
      currentVideoId = null;
      lastPlayerState = null;
      return;
    }
    if (suppressBroadcast > 0 || !dataChannel || dataChannel.readyState !== 'open') return;

    // Detect episode change in series
    const vid = getVideoId();
    if (vid) {
      if (currentVideoId && vid !== currentVideoId) {
        console.log("[C2P] Detected episode change to", vid);
        currentVideoId = vid;
        lastPlayerState = null;
        const label = getEpisodeLabel(vid);
        displaySystemMessage('You switched to ' + label, 'refresh');
        broadcastSync('episode', 0, vid, label);
        return;
      }
      currentVideoId = vid;
    }

    const p = getPlayer();
    if (!p || !p.isReady) return;

    const time = p.getTime();
    const paused = p.isPaused();
    const playbackRate = p.getPlaybackRate ? p.getPlaybackRate() : 1;

    if (!lastPlayerState) {
      lastPlayerState = { paused, time, playbackRate };
      return;
    }

    const stateChanged = paused !== lastPlayerState.paused;
    const rateChanged = Math.abs(playbackRate - (lastPlayerState.playbackRate || 1)) > 0.05;
    const timeDelta = Math.abs(time - lastPlayerState.time);
    // User seeked if time jumped unexpectedly (>2.5s) without normal 1x progression
    const seeked = isUserTriggered ? (timeDelta > 1500) : (timeDelta > 2500);

    if (rateChanged) {
      const speedStr = formatSpeed(playbackRate);
      console.log("[C2P] Detected speed change to", speedStr);
      displaySystemMessage('You set playback speed to ' + speedStr, 'speed');
      broadcastSync('speed', time, null, null, playbackRate);
    }

    if (seeked) {
      lastSeekTime = Date.now();
      console.log("[C2P] Detected seek to", Math.floor(time / 1000));
      displaySystemMessage('You seeked to ' + Math.floor(time / 1000) + 's', 'seek');
      broadcastSync('seek', time);
    } else if (stateChanged) {
      if (paused) {
        console.log("[C2P] Detected pause at", time);
        displaySystemMessage('You paused playback', 'pause');
        broadcastSync('pause', time);
      } else {
        console.log("[C2P] Detected play at", time);
        displaySystemMessage('You resumed playback', 'play');
        broadcastSync('play', time);
      }
    }

    lastPlayerState = { paused, time, playbackRate };
  }

  function startSyncLoop() {
    if (syncInterval) clearInterval(syncInterval);
    attachUserInteractionListeners();
    lastPlayerState = null;
    currentVideoId = getVideoId();

    let tickCount = 0;
    // 250ms polling loop + 3s heartbeat/keepalive
    syncInterval = setInterval(() => {
      if (isWatchPage()) pollPlayerState(false);
      tickCount++;

      // Every 3 seconds (12 ticks of 250ms), send heartbeat to keep sync and UDP NAT alive
      if (tickCount % 12 === 0) {
        if (dataChannel && dataChannel.readyState === 'open') {
          const p = getPlayer();
          if (p && p.isReady) {
            dataChannel.send(JSON.stringify({
              type: 'sync',
              action: 'heartbeat',
              time: p.getTime(),
              paused: p.isPaused(),
              speed: p.getPlaybackRate ? p.getPlaybackRate() : 1,
              videoId: currentVideoId || getVideoId()
            }));
          } else {
            dataChannel.send(JSON.stringify({ type: 'ping' }));
          }
        }
        if (ws && ws.readyState === WebSocket.OPEN) {
          try { ws.send(JSON.stringify({ type: 'ping' })); } catch(e){}
        }
      }
    }, 250);
  }

  function stopSyncLoop() {
    if (syncInterval) { clearInterval(syncInterval); syncInterval = null; }
    lastPlayerState = null;
  }

  function handleSyncMessage(d) {
    if (d.action === 'watch_credits') {
      displaySystemMessage('Peer chose to watch credits', 'play');
      triggerWatchCredits();
      return;
    }

    if (d.action === 'next_episode') {
      displaySystemMessage('Peer clicked next episode', 'play');
      triggerNextEpisode(d.videoId);
      return;
    }

    if (d.action === 'episode') {
      const targetId = String(d.videoId);
      if (targetId && getVideoId() !== targetId) {
        const label = d.episodeLabel || getEpisodeLabel(targetId);
        displaySystemMessage('Peer switched to ' + label, 'refresh');
        currentVideoId = targetId;
        lastPlayerState = null;
        changeEpisode(targetId);
      }
      return;
    }

    const p = getPlayer();
    if (!p) return;

    suppressBroadcast++;
    try {
      if (d.action === 'play') {
        p.seek(d.time);
        p.play();
        wakeNetflixUI();
        displaySystemMessage('Peer resumed playback', 'play');
      } else if (d.action === 'pause') {
        p.seek(d.time);
        p.pause();
        wakeNetflixUI();
        displaySystemMessage('Peer paused playback', 'pause');
      } else if (d.action === 'seek') {
        lastSeekTime = Date.now();
        p.seek(d.time);
        wakeNetflixUI();
        displaySystemMessage('Peer seeked to ' + Math.floor(d.time / 1000) + 's', 'seek');
      } else if (d.action === 'speed') {
        const rate = Number(d.speed);
        if (!isNaN(rate) && rate > 0) {
          p.setPlaybackRate(rate);
          if (d.time && Math.abs(p.getTime() - d.time) > DRIFT_THRESHOLD) {
            p.seek(d.time);
          }
          wakeNetflixUI();
          displaySystemMessage('Peer set playback speed to ' + formatSpeed(rate), 'speed');
        }
      } else if (d.action === 'heartbeat') {
        if (d.videoId && getVideoId() && String(d.videoId) !== getVideoId()) {
          console.log("[C2P] Reconciling episode from heartbeat:", d.videoId);
          displaySystemMessage('Reconciling episode with peer...', 'refresh');
          changeEpisode(d.videoId);
          return;
        }
        if (d.speed && p.getPlaybackRate && Math.abs(p.getPlaybackRate() - d.speed) > 0.05) {
          console.log("[C2P] Reconciling speed from heartbeat:", d.speed);
          p.setPlaybackRate(d.speed);
        }
        const now = Date.now();
        const inSeekGracePeriod = (now - lastSeekTime) < SEEK_GRACE_PERIOD_MS;
        const localTime = p.getTime();
        const timeDiff = Math.abs(localTime - d.time);

        if (!inSeekGracePeriod) {
          if (!p.isPaused() && !d.paused && timeDiff > DRIFT_THRESHOLD) {
            p.seek(d.time);
            wakeNetflixUI();
          } else if (p.isPaused() && !d.paused && timeDiff >= PLAY_DRIFT_THRESHOLD) {
            console.log("[C2P] Missed play event detected. Reconciling playback with peer at:", d.time);
            p.seek(d.time);
            p.play();
            wakeNetflixUI();
            displaySystemMessage('Reconciling playback with peer...', 'play');
          }
        }
      }
      lastPlayerState = {
        paused: p.isPaused(),
        time: p.getTime(),
        playbackRate: p.getPlaybackRate ? p.getPlaybackRate() : (d.speed || 1)
      };
    } catch (e) {
      console.error("[C2P] Error applying sync:", e);
    } finally {
      setTimeout(() => {
        suppressBroadcast = Math.max(0, suppressBroadcast - 1);
      }, 500);
    }
  }

  // ── Signaling & Fresh Reconnect ──
  function scheduleAutoReconnect(reason = 'Connection lost') {
    if (autoReconnectTimer) clearTimeout(autoReconnectTimer);
    if (isIntentionalDisconnect || isPeerDisconnected) return;

    // 2-second delay with slight jitter (0-300ms) to prevent glare/sync loops between the two peers
    const delay = 2000 + Math.floor(Math.random() * 300);
    console.log(`[C2P] Scheduling auto-reconnect in ${(delay / 1000).toFixed(1)}s (reason: ${reason})...`);
    updateStatus('connecting', 'Auto-reconnecting in 2s...');
    displayActionMessage(`${reason}. Auto-reconnecting in 2s...`, 'Reconnect Now', () => {
      if (autoReconnectTimer) { clearTimeout(autoReconnectTimer); autoReconnectTimer = null; }
      forceFreshReconnect();
    }, 'warn');

    autoReconnectTimer = setTimeout(() => {
      autoReconnectTimer = null;
      if (!isIntentionalDisconnect && !isPeerDisconnected && peerConnection?.connectionState !== 'connected') {
        console.log('[C2P] Triggering automatic fresh reconnect now...');
        forceFreshReconnect();
      }
    }, delay);
  }

  async function forceFreshReconnect() {
    console.log('[C2P] Forcing fresh reconnect...');
    const recBtn = document.getElementById('c2p-reconnect-btn');
    if (recBtn) recBtn.classList.add('c2p-spinning');

    if (autoReconnectTimer) {
      clearTimeout(autoReconnectTimer);
      autoReconnectTimer = null;
    }

    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    // 1. Reset WebRTC cleanly
    resetWebRTC();
    reconnectAttempts = 0;
    isIntentionalDisconnect = false;
    isPeerDisconnected = false;
    setInputEnabled(false);
    incomingImageChunks = {};
    incomingAudioChunks = {};
    if (currentVoiceAudio) { try { currentVoiceAudio.pause(); } catch(e){} currentVoiceAudio = null; }
    clearImagePreview();
    const kc = document.getElementById('c2p-klipy-container'); if (kc) kc.style.display = 'none';

    updateStatus('connecting', 'Reconnecting...');
    displaySystemMessage('Starting fresh connection session...', 'refresh');

    const btn = document.getElementById('c2p-connect-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Connecting...'; }

    // 2. If signaling WebSocket is already open, reuse it to create a fresh offer!
    // This avoids closing/re-opening the socket and prevents ghost peer_left race conditions.
    if (ws && ws.readyState === WebSocket.OPEN) {
      console.log('[C2P] WebSocket already open. Sending fresh offer to peer...');
      try {
        initPC();
        await createOffer();
      } catch(err) {
        console.error('[C2P] Error creating fresh offer:', err);
      }
      if (recBtn) recBtn.classList.remove('c2p-spinning');
      return;
    }

    // 3. If WebSocket is not open, connect fresh signaling
    connectSignaling();
  }

  function connectSignaling() {
    if (!serverUrl) {
      console.warn('[C2P] No server URL configured.');
      displayActionMessage('No server URL configured.', 'Open Settings', openSettingsModal, 'warn');
      showSetupBanner('Enter Lounge', 'Please set the Signaling Server URL first.');
      const recBtn = document.getElementById('c2p-reconnect-btn');
      if (recBtn) recBtn.classList.remove('c2p-spinning');
      return;
    }
    console.log('[C2P] Connecting to signaling server:', serverUrl);
    isIntentionalDisconnect = false;
    isPeerDisconnected = false;
    updateStatus('connecting', 'Connecting...');
    try { sessionStorage.setItem('c2p_session_active', '1'); } catch(e){}
    try {
      ws = new WebSocket(serverUrl);
    } catch(e) {
      console.error('[C2P] Error creating WebSocket:', e);
      updateStatus('disconnected', 'Error');
      displayActionMessage('Connection failed. Check server URL.', 'Retry', forceFreshReconnect, 'warn');
      showSetupBanner('Reconnect Fresh Session', 'Connection failed. Check server URL.');
      const recBtn = document.getElementById('c2p-reconnect-btn');
      if (recBtn) recBtn.classList.remove('c2p-spinning');
      return;
    }

    ws.onopen = () => {
      console.log('[C2P] WebSocket connected successfully');
      const recBtn = document.getElementById('c2p-reconnect-btn');
      if (recBtn) recBtn.classList.remove('c2p-spinning');
      reconnectAttempts = 0;
      if (isPeerDisconnected) {
        updateStatus('disconnected', 'Peer off');
      } else if (peerConnection?.connectionState === 'connected' && dataChannel?.readyState === 'open') {
        updateStatus('connected', 'Connected');
        return;
      } else {
        updateStatus('connecting', 'Waiting for peer...');
        const b = document.getElementById('c2p-connect-btn');
        if (b) b.textContent = 'Waiting for peer...';
        displaySystemMessage('Connected to server. Waiting for a peer...');
      }
      // Announce presence to any peer already waiting in the lounge
      try {
        ws.send(JSON.stringify({ type: 'hello', from: clientId }));
      } catch(e){}
    };

    ws.onmessage = async (event) => {
      let msg; try { msg = JSON.parse(event.data); } catch { return; }
      try {
        switch(msg.type) {
          case 'ping': ws.send(JSON.stringify({ type: 'pong' })); break;
          case 'pong': break;
          case 'peer_disconnected':
            handlePeerDisconnected();
            break;
          case 'hello':
          case 'peer_joined':
            isPeerDisconnected = false;
            console.log('[C2P] Peer signal received:', msg.type);
            if (autoReconnectTimer) { clearTimeout(autoReconnectTimer); autoReconnectTimer = null; }
            if (disconnectGraceTimer) { clearTimeout(disconnectGraceTimer); disconnectGraceTimer = null; }
            if (peerConnection?.connectionState === 'connected' && dataChannel?.readyState === 'open') {
              console.log('[C2P] Already connected and dataChannel open. Ignoring signal.');
              break;
            }
            if (isNegotiating || peerConnection?.iceConnectionState === 'checking' || peerConnection?.connectionState === 'connecting') {
              console.log('[C2P] Negotiation/connecting already in progress. Ignoring duplicate signal.');
              break;
            }
            isNegotiating = true;
            displaySystemMessage('Peer detected! Establishing fresh connection...');
            resetWebRTC();
            initPC();
            await createOffer();
            setTimeout(() => { isNegotiating = false; }, 3000);
            break;
          case 'peer_left':
            console.log('[C2P] Peer left signaling room');
            if (dataChannel?.readyState === 'open') {
              break;
            }
            // Do not reset WebRTC or show error popups on stale ghost disconnects
            if (!isPeerDisconnected && peerConnection?.connectionState !== 'connected') {
              updateStatus('connecting', 'Waiting for peer...');
              const b = document.getElementById('c2p-connect-btn');
              if (b) b.textContent = 'Waiting for peer...';
            }
            break;
          case 'offer':
            isPeerDisconnected = false;
            console.log('[C2P] Received offer from peer');
            if (autoReconnectTimer) { clearTimeout(autoReconnectTimer); autoReconnectTimer = null; }
            if (disconnectGraceTimer) { clearTimeout(disconnectGraceTimer); disconnectGraceTimer = null; }

            // If P2P is already healthy, ignore unsolicited offers
            if (peerConnection?.connectionState === 'connected' && dataChannel?.readyState === 'open') {
              console.log('[C2P] Already connected, ignoring offer');
              break;
            }

            // Handle glare (offer collision)
            const isCollision = peerConnection && (peerConnection.signalingState !== 'stable' || isNegotiating);
            if (isCollision) {
              const isPolite = msg.from && msg.from < clientId;
              if (!isPolite) {
                console.log('[C2P] Glare detected: impolite peer ignoring offer');
                break;
              }
              console.log('[C2P] Glare detected: polite peer accepting offer');
              try {
                await peerConnection.setLocalDescription({ type: 'rollback' });
              } catch(e) {
                resetWebRTC();
                initPC();
              }
            } else if (!peerConnection || peerConnection.signalingState === 'closed') {
              initPC();
            }

            await peerConnection.setRemoteDescription(new RTCSessionDescription(msg));
            const a = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(a);
            ws.send(JSON.stringify({
              type: peerConnection.localDescription.type,
              sdp: peerConnection.localDescription.sdp,
              from: clientId
            }));
            break;
          case 'answer':
            console.log('[C2P] Received answer from peer');
            if (peerConnection) await peerConnection.setRemoteDescription(new RTCSessionDescription(msg));
            break;
          case 'ice-candidate':
            if (peerConnection && msg.candidate) {
              try {
                if (peerConnection.remoteDescription) {
                  await peerConnection.addIceCandidate(new RTCIceCandidate(msg.candidate));
                } else {
                  setTimeout(async () => {
                    try {
                      if (peerConnection?.remoteDescription) {
                        await peerConnection.addIceCandidate(new RTCIceCandidate(msg.candidate));
                      }
                    } catch(err){}
                  }, 500);
                }
              } catch(err) {
                console.warn('[C2P] ICE candidate error:', err);
              }
            }
            break;
        }
      } catch(e) { console.error('[C2P]', e); }
    };

    ws.onerror = (err) => {
      console.error('[C2P] WebSocket error:', err);
      const recBtn = document.getElementById('c2p-reconnect-btn');
      if (recBtn) recBtn.classList.remove('c2p-spinning');
      updateStatus('disconnected', 'Error');
    };

    ws.onclose = (event) => {
      console.log('[C2P] WebSocket closed:', event?.code, event?.reason);
      const recBtn = document.getElementById('c2p-reconnect-btn');
      if (recBtn) recBtn.classList.remove('c2p-spinning');
      if (isPeerDisconnected) {
        updateStatus('disconnected', 'Peer disconnected');
      } else if (!isIntentionalDisconnect) {
        attemptReconnect();
      } else if (peerConnection?.connectionState !== 'connected') {
        updateStatus('disconnected', 'Disconnected');
        handleDisconnect(true);
      }
    };
  }

  function attemptReconnect() {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    const d = Math.min(1000 * Math.pow(2, reconnectAttempts), MAX_RECONNECT_DELAY);
    reconnectAttempts++;
    if (peerConnection?.connectionState !== 'connected' || dataChannel?.readyState !== 'open') {
      updateStatus('connecting', `Reconnecting (${reconnectAttempts})...`);
    }
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (!isIntentionalDisconnect && (!ws || ws.readyState !== WebSocket.OPEN)) {
        connectSignaling();
      }
    }, d);
  }

  // ── WebRTC ──
  function handleConnectionFailure(reason = 'Connection lost') {
    const recBtn = document.getElementById('c2p-reconnect-btn');
    if (recBtn) recBtn.classList.remove('c2p-spinning');
    if (isPeerDisconnected) {
      updateStatus('disconnected', 'Peer disconnected');
      return;
    }
    updateStatus('disconnected', reason);
    showSetupBanner('Reconnect Fresh Session', `${reason}. Click to reconnect.`);
    resetWebRTC();
    if (ws && ws.readyState === WebSocket.OPEN && !isIntentionalDisconnect) {
      scheduleAutoReconnect(reason);
    } else {
      displayActionMessage(`${reason}.`, 'Reconnect Now', forceFreshReconnect, 'warn');
    }
  }

  function initPC() {
    peerConnection = new RTCPeerConnection(ICE_CONFIG);
    peerConnection.onicecandidate = e => {
      if (e.candidate && ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ice-candidate', candidate: e.candidate }));
      }
    };

    peerConnection.oniceconnectionstatechange = () => {
      const state = peerConnection.iceConnectionState;
      console.log('[C2P] ICE Connection State:', state);
      if (state === 'failed') {
        if (disconnectGraceTimer) {
          clearTimeout(disconnectGraceTimer);
          disconnectGraceTimer = null;
        }
        wasConnected = false;
        handleConnectionFailure('Network route failed (ICE timeout)');
      }
    };

    peerConnection.onconnectionstatechange = () => {
      const s = peerConnection.connectionState;
      console.log('[C2P] PeerConnection State:', s);
      if (s === 'connected') {
        if (disconnectGraceTimer) {
          clearTimeout(disconnectGraceTimer);
          disconnectGraceTimer = null;
        }
        if (autoReconnectTimer) {
          clearTimeout(autoReconnectTimer);
          autoReconnectTimer = null;
        }
        const recBtn = document.getElementById('c2p-reconnect-btn');
        if (recBtn) recBtn.classList.remove('c2p-spinning');
        updateStatus('connected', 'Connected');
        const su = document.getElementById('c2p-setup'); if (su) su.style.display = 'none';
        if (!wasConnected) {
          displaySystemMessage('Secure connection!', 'lock');
          wasConnected = true;
        }
        setInputEnabled(true);
        focusMsgInput();
      } else if (s === 'disconnected') {
        console.log('[C2P] PeerConnection disconnected. Waiting 5s grace period before teardown...');
        if (!disconnectGraceTimer) {
          disconnectGraceTimer = setTimeout(() => {
            disconnectGraceTimer = null;
            if (peerConnection?.connectionState === 'disconnected') {
              console.log('[C2P] Grace period expired, tearing down and reconnecting.');
              wasConnected = false;
              handleConnectionFailure('Connection lost');
            }
          }, 5000);
        }
      } else if (['failed', 'closed'].includes(s)) {
        if (disconnectGraceTimer) {
          clearTimeout(disconnectGraceTimer);
          disconnectGraceTimer = null;
        }
        wasConnected = false;
        handleConnectionFailure('Connection lost');
      }
    };

    peerConnection.ondatachannel = e => { dataChannel = e.channel; setupDC(); };
  }

  async function createOffer() {
    dataChannel = peerConnection.createDataChannel('chat-channel');
    setupDC();
    const o = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(o);
    ws.send(JSON.stringify({
      type: peerConnection.localDescription.type,
      sdp: peerConnection.localDescription.sdp,
      from: clientId
    }));
  }

  function setupDC() {
    dataChannel.onopen = () => {
      setInputEnabled(true);
      focusMsgInput();
      startSyncLoop();
    };
    dataChannel.onclose = () => {
      setInputEnabled(false);
      stopSyncLoop();
    };
    dataChannel.onmessage = event => {
      try {
        const d = JSON.parse(event.data);
        if (d.type === 'peer_disconnected') handlePeerDisconnected();
        else if (d.type === 'sync') handleSyncMessage(d);
        else if (d.type === 'typing') showRemoteTyping(!!d.isTyping);
        else if (d.type === 'text') { showRemoteTyping(false); displayUserMessage(d.content, 'received', false, d.nickname, false, d.replyTo, d.id); }
        else if (d.type === 'edit_text') { applyMessageEdit(d.id, d.content); }
        else if (d.type === 'emoji') createFloatingEmoji(d.emoji);
        else if (d.type === 'sfx') {
          playSoundEffect(d.idx);
          const s = SOUND_EFFECTS[d.idx];
          if (s) displaySystemMessage(s.name, 'audio');
        }
        else if (d.type === 'gif') { showRemoteTyping(false); displayUserMessage(d.url, 'received', true, null, false, d.replyTo); }
        else if (d.type === 'nudge') { showRemoteTyping(false); handleIncomingNudge(); }
        else if (d.type === 'effect') { showRemoteTyping(false); handleIncomingEffect(d.name); }
        else if (d.type === 'audio_chunk') {
          showRemoteTyping(false);
          if (!incomingAudioChunks[d.id]) {
            incomingAudioChunks[d.id] = { total: d.total, received: 0, chunks: new Array(d.total), duration: d.duration };
          }
          const item = incomingAudioChunks[d.id];
          if (!item.chunks[d.index]) {
            item.chunks[d.index] = d.chunk;
            item.received++;
          }
          if (item.received === item.total) {
            const fullDataUrl = item.chunks.join('');
            delete incomingAudioChunks[d.id];
            let audioUrl = fullDataUrl;
            const b = dataUrlToBlob(fullDataUrl);
            if (b) audioUrl = URL.createObjectURL(b);
            displayAudioMessage(audioUrl, 'received', item.duration);
          }
        }
        else if (d.type === 'image_chunk') {
          showRemoteTyping(false);
          if (!incomingImageChunks[d.id]) {
            incomingImageChunks[d.id] = { total: d.total, received: 0, chunks: new Array(d.total), nickname: d.nickname || null };
          }
          const item = incomingImageChunks[d.id];
          if (d.nickname && !item.nickname) {
            item.nickname = d.nickname;
          }
          if (!item.chunks[d.index]) {
            item.chunks[d.index] = d.chunk;
            item.received++;
          }
          if (item.received === item.total) {
            const fullDataUrl = item.chunks.join('');
            const senderNick = item.nickname;
            delete incomingImageChunks[d.id];
            displayUserMessage(fullDataUrl, 'received', false, senderNick, true);
          }
        }
        else if (d.type === 'ping') {
          if (dataChannel && dataChannel.readyState === 'open') {
            dataChannel.send(JSON.stringify({ type: 'pong' }));
          }
        }
        else if (d.type === 'pong') { /* keep-alive confirmed */ }
      } catch {
        displayUserMessage(event.data, 'received');
      }
    };
  }

  function resetWebRTC() {
    clearReply();
    clearEditing();
    if (disconnectGraceTimer) {
      clearTimeout(disconnectGraceTimer);
      disconnectGraceTimer = null;
    }
    stopSyncLoop();
    if (localTypingTimeout) { clearTimeout(localTypingTimeout); localTypingTimeout = null; }
    if (remoteTypingTimeout) { clearTimeout(remoteTypingTimeout); remoteTypingTimeout = null; }
    isTypingLocally = false;
    showRemoteTyping(false);
    if (mediaRecorder) cancelRecording();
    if (dataChannel) {
      try { dataChannel.onclose = null; dataChannel.onerror = null; dataChannel.onmessage = null; dataChannel.close(); } catch(e){}
      dataChannel = null;
    }
    if (peerConnection) {
      try { peerConnection.onicecandidate = null; peerConnection.onconnectionstatechange = null; peerConnection.oniceconnectionstatechange = null; peerConnection.ondatachannel = null; peerConnection.close(); } catch(e){}
      peerConnection = null;
    }
    setInputEnabled(false);
    incomingImageChunks = {};
    incomingAudioChunks = {};
    if (currentVoiceAudio) { try { currentVoiceAudio.pause(); } catch(e){} currentVoiceAudio = null; }
    clearImagePreview();
    const kc = document.getElementById('c2p-klipy-container'); if (kc) kc.style.display = 'none';
  }

  function handleDisconnect(full = true) {
    if (autoReconnectTimer) {
      clearTimeout(autoReconnectTimer);
      autoReconnectTimer = null;
    }
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (full) wasConnected = false;
    resetWebRTC();
    showSetupBanner('Reconnect Fresh Session', 'Click to reconnect and wait for a peer.');
    if (full) {
      isIntentionalDisconnect = true;
      try { sessionStorage.removeItem('c2p_session_active'); } catch(e){}
      if (ws) {
        try { ws.onclose = null; ws.close(); } catch(e){}
        ws = null;
      }
      const b = document.getElementById('c2p-connect-btn');
      if (b) { b.disabled = false; b.textContent = 'Reconnect Fresh Session'; }
    } else {
      const b = document.getElementById('c2p-connect-btn');
      if (b) { b.disabled = true; b.textContent = 'Reconnecting...'; }
    }
  }

  function handlePeerDisconnected() {
    console.log('[C2P] Remote peer manually disconnected the session.');
    isPeerDisconnected = true;
    wasConnected = false;
    if (autoReconnectTimer) { clearTimeout(autoReconnectTimer); autoReconnectTimer = null; }
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    reconnectAttempts = 0;
    try { sessionStorage.removeItem('c2p_session_active'); } catch(e){}
    resetWebRTC();
    if (ws) {
      try {
        ws.onclose = null;
        ws.onerror = null;
        ws.close();
      } catch(e){}
      ws = null;
    }
    updateStatus('disconnected', 'Peer disconnected');
    displaySystemMessage('Peer disconnected the session.', 'warn');
    showSetupBanner('Enter Lounge', 'Peer disconnected. Click to wait for a new peer.');
    const recBtn = document.getElementById('c2p-reconnect-btn');
    if (recBtn) recBtn.classList.remove('c2p-spinning');
  }

  function terminateConnection() {
    console.log('[C2P] Manually terminating connection and stopping automatic retries.');
    isIntentionalDisconnect = true;
    wasConnected = false;
    if (autoReconnectTimer) { clearTimeout(autoReconnectTimer); autoReconnectTimer = null; }
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    reconnectAttempts = 0;
    try { sessionStorage.removeItem('c2p_session_active'); } catch(e){}
    setInputEnabled(false);

    const discMsg = JSON.stringify({ type: 'peer_disconnected', reason: 'manual' });
    if (dataChannel && dataChannel.readyState === 'open') {
      try { dataChannel.send(discMsg); } catch(e){}
    }
    if (ws && ws.readyState === WebSocket.OPEN) {
      try { ws.send(discMsg); } catch(e){}
    }

    setTimeout(() => {
      resetWebRTC();
      if (ws) {
        try {
          ws.onclose = null;
          ws.onerror = null;
          ws.close();
        } catch(e){}
        ws = null;
      }
    }, 50);

    updateStatus('disconnected', 'Disconnected');
    displaySystemMessage('Connection terminated. Auto-reconnect stopped.', 'warn');
    showSetupBanner('Enter Lounge', 'Connection closed. Click to connect when ready.');
    const recBtn = document.getElementById('c2p-reconnect-btn');
    if (recBtn) recBtn.classList.remove('c2p-spinning');
  }

  // ── Typing Indicator Helpers ──
  function sendTypingStatus(isTyping) {
    if (dataChannel && dataChannel.readyState === 'open') {
      try { dataChannel.send(JSON.stringify({ type: 'typing', isTyping })); } catch(e){}
    }
  }

  function handleLocalTyping() {
    const input = document.getElementById('c2p-msg-input');
    const hasText = input && input.value.trim().length > 0;
    if (hasText) {
      if (!isTypingLocally) {
        isTypingLocally = true;
        sendTypingStatus(true);
      }
      if (localTypingTimeout) clearTimeout(localTypingTimeout);
      localTypingTimeout = setTimeout(() => {
        isTypingLocally = false;
        sendTypingStatus(false);
        localTypingTimeout = null;
      }, 2500);
    } else if (isTypingLocally) {
      if (localTypingTimeout) { clearTimeout(localTypingTimeout); localTypingTimeout = null; }
      isTypingLocally = false;
      sendTypingStatus(false);
    }
  }

  function showRemoteTyping(show) {
    const indicator = document.getElementById('c2p-typing-indicator');
    if (remoteTypingTimeout) { clearTimeout(remoteTypingTimeout); remoteTypingTimeout = null; }
    if (!indicator) return;
    if (show) {
      indicator.classList.remove('c2p-hidden');
      if (!userScrolledUp) scrollToBottom(true);
      remoteTypingTimeout = setTimeout(() => {
        indicator.classList.add('c2p-hidden');
        remoteTypingTimeout = null;
      }, 4000);
    } else {
      indicator.classList.add('c2p-hidden');
    }
  }

  // ── Messaging ──
  function sendMessage() {
    const i = document.getElementById('c2p-msg-input');
    if (!i) return;
    const t = i.value.trim();
    if (!t) return;

    if (editingMsg) {
      if (t !== editingMsg.originalContent && dataChannel?.readyState === 'open') {
        applyMessageEdit(editingMsg.id, t);
        dataChannel.send(JSON.stringify({ type: 'edit_text', id: editingMsg.id, content: t }));
      }
      i.value = '';
      clearEditing();
      return;
    }

    if (dataChannel?.readyState === 'open') {
      if (localTypingTimeout) { clearTimeout(localTypingTimeout); localTypingTimeout = null; }
      if (isTypingLocally) { isTypingLocally = false; sendTypingStatus(false); }
      const msgId = 'm_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const payload = { type: 'text', id: msgId, content: t, replyTo: currentReply };
      if (nickname && nickname.trim()) {
        payload.nickname = nickname.trim();
      }
      dataChannel.send(JSON.stringify(payload));
      displayUserMessage(t, 'sent', false, null, false, currentReply, msgId);
      i.value = '';
      clearReply();
    }
  }
  function sendGifMessage(gifUrl) {
    if (gifUrl && dataChannel?.readyState === 'open') {
      dataChannel.send(JSON.stringify({ type: 'gif', url: gifUrl, replyTo: currentReply }));
      displayUserMessage(gifUrl, 'sent', true, null, false, currentReply);
      const kc = document.getElementById('c2p-klipy-container');
      if (kc) kc.style.display = 'none';
      focusMsgInput();
      clearReply();
    }
  }
  function sendEmoji(e) { if(dataChannel?.readyState==='open'){dataChannel.send(JSON.stringify({type:'emoji',emoji:e}));createFloatingEmoji(e);} }
  function createFloatingEmoji(e) { 
    const s=document.getElementById('c2p-sidebar'); if(!s)return; 
    const el=document.createElement('div'); 
    el.classList.add('c2p-floating-emoji'); el.textContent=e; 
    el.style.left=`${10+Math.random()*80}%`; 
    const d=3.4+Math.random()*0.8; 
    const anim=Math.random()>0.5?'c2p-floatUp':'c2p-floatUpAlt'; 
    el.style.animation=`${anim} ${d}s linear forwards`; 
    s.appendChild(el); 
    setTimeout(()=>el.remove(),d*1000); 
  }
  function playSoundEffect(idx) {
    const s = SOUND_EFFECTS[idx];
    if (!s) return;
    try { new Audio(s.url).play().catch(() => {}); } catch {}
  }
  function sendSoundEffect(idx) {
    const s = SOUND_EFFECTS[idx];
    if (!s) return;
    playSoundEffect(idx);
    const btn = document.querySelector(`#c2p-sidebar .c2p-sfx-btn[data-sfx="${idx}"]`);
    if (btn) {
      btn.classList.add('c2p-sfx-active');
      setTimeout(() => btn.classList.remove('c2p-sfx-active'), 1200);
    }
    displaySystemMessage(s.name, 'audio');
    if (dataChannel?.readyState === 'open') {
      dataChannel.send(JSON.stringify({ type: 'sfx', idx }));
    }
  }

  // ── MSN Nudge / Zumbido ──
  let nudgeCooldown = false;
  const MSN_NUDGE_AUDIO = 'https://cdn.pixabay.com/audio/2022/03/24/audio_dcde83efa6.mp3';

  function playNudgeSound() {
    try {
      const a = new Audio(MSN_NUDGE_AUDIO);
      a.volume = 0.9;
      a.play().catch(() => {});
    } catch(e) {}
  }

  let nudgeAnimTimeout = null;
  function triggerNudgeEffect() {
    const s = document.getElementById('c2p-sidebar');
    const fs = document.fullscreenElement || document.webkitFullscreenElement;
    const player = (fs && fs.tagName !== 'VIDEO') ? fs : (
      document.querySelector('.watch-video') ||
      document.querySelector('.VideoContainer') ||
      document.querySelector('video')?.closest('.watch-video--player-view') ||
      document.querySelector('video') ||
      document.getElementById('appMountPoint')
    );
    const toggleBtn = document.getElementById('c2p-toggle-btn');
    const els = [s, player, toggleBtn].filter(Boolean);

    els.forEach(el => {
      el.classList.remove('c2p-earthquake', 'c2p-shaking');
      void el.offsetWidth;
      el.classList.add('c2p-earthquake');
    });

    if (nudgeAnimTimeout) clearTimeout(nudgeAnimTimeout);
    nudgeAnimTimeout = setTimeout(() => {
      els.forEach(el => el.classList.remove('c2p-earthquake', 'c2p-shaking'));
      nudgeAnimTimeout = null;
    }, 1000);

    playNudgeSound();
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      try { navigator.vibrate([120, 40, 120, 40, 200, 60, 250]); } catch(e){}
    }
  }

  function sendNudge() {
    if (nudgeCooldown) {
      displaySystemMessage('Wait to send another buzz.', 'clock');
      return;
    }
    if (!dataChannel || dataChannel.readyState !== 'open') return;
    dataChannel.send(JSON.stringify({ type: 'nudge' }));
    triggerNudgeEffect();
    displaySystemMessage('You sent a buzz.', 'bell');
    nudgeCooldown = true;
    const b = document.getElementById('c2p-nudge-btn');
    if (b) { b.disabled = true; b.style.opacity = '0.3'; }
    setTimeout(() => {
      nudgeCooldown = false;
      if (dataChannel?.readyState === 'open' && b) {
        b.disabled = false;
        b.style.opacity = '';
      }
    }, 5000);
  }

  function handleIncomingNudge() {
    if (!sidebarVisible) toggleSidebar();
    triggerNudgeEffect();
    displaySystemMessage('Peer sent you a buzz!', 'bell');
  }

  // ── Special Effects (Celebration / Fireworks / Tomato, etc.) ──
  const CELEBRATION_AUDIO = 'https://cdn.pixabay.com/audio/2024/07/24/audio_0e85d003fb.mp3';
  const FIREWORKS_AUDIO = 'https://cdn.pixabay.com/audio/2025/10/12/audio_c4109f7a7d.mp3';
  const TOMATO_AUDIO = 'https://cdn.pixabay.com/audio/2026/07/14/audio_3b46788a73.mp3';
  const KNOCK_AUDIO = 'https://cdn.pixabay.com/audio/2022/03/15/audio_88c919f17b.mp3';
  let effectCooldown = false;
  let confettiAnimId = null;
  let confettiCanvas = null;
  let fireworksAnimId = null;
  let fireworksCanvas = null;
  let tomatoAnimId = null;
  let tomatoCanvas = null;
  let danceAnimId = null;
  let danceCanvas = null;
  let stareAnimId = null;
  let stareCanvas = null;
  let smirkAnimId = null;
  let smirkCanvas = null;
  let knockAnimId = null;
  let knockCanvas = null;
  let sheepAnimId = null;
  let sheepCanvas = null;
  let eyebrowAnimId = null;
  let eyebrowCanvas = null;
  let disgustedAnimId = null;
  let disgustedCanvas = null;
  const DISGUSTED_WEBP = 'data:image/webp;base64,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';
  const disgustedImg = new Image();
  disgustedImg.src = DISGUSTED_WEBP;
  const EYEBROW_WEBP = 'data:image/webp;base64,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';
  const eyebrowImg = new Image();
  eyebrowImg.src = EYEBROW_WEBP;
  const SHEEP_WEBP = 'data:image/webp;base64,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';
  const sheepImg = new Image();
  sheepImg.src = SHEEP_WEBP;

  function playCelebrationSound() {
    try {
      const a = new Audio(CELEBRATION_AUDIO);
      a.volume = 0.85;
      a.play().catch(() => {});
    } catch(e) {}
  }

  function playFireworksSound() {
    try {
      const a = new Audio(FIREWORKS_AUDIO);
      a.volume = 0.85;
      a.play().catch(() => {});
    } catch(e) {}
  }

  function playTomatoSound() {
    try {
      const a = new Audio(TOMATO_AUDIO);
      a.volume = 0.9;
      a.play().catch(() => {});
    } catch(e) {}
  }

  function playKnockSound() {
    try {
      const a = new Audio(KNOCK_AUDIO);
      a.volume = 0.95;
      a.play().catch(() => {});
    } catch(e) {}
  }

  function getEffectContainer() {
    const fs = document.fullscreenElement || document.webkitFullscreenElement;
    return (fs && fs.tagName !== 'VIDEO') ? fs : document.body;
  }

  function triggerCelebrationEffect() {
    playCelebrationSound();
    const container = getEffectContainer();
    if (!container) return;

    if (!confettiCanvas) {
      confettiCanvas = document.createElement('canvas');
      confettiCanvas.className = 'c2p-confetti-canvas';
      confettiCanvas.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483645;';
      container.appendChild(confettiCanvas);
    } else if (confettiCanvas.parentElement !== container) {
      container.appendChild(confettiCanvas);
    }

    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    const h = window.innerHeight;
    confettiCanvas.width = Math.floor(w * dpr);
    confettiCanvas.height = Math.floor(h * dpr);
    const ctx = confettiCanvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);

    const CONFETTI_COLORS = [
      { light: '#e50914', dark: '#b20710' },
      { light: '#ff3366', dark: '#d90429' },
      { light: '#ffd166', dark: '#e09f3e' },
      { light: '#ffb703', dark: '#fb8500' },
      { light: '#06d6a0', dark: '#049669' },
      { light: '#118ab2', dark: '#073b4c' },
      { light: '#8338ec', dark: '#5a189a' },
      { light: '#ff70a6', dark: '#d63384' },
      { light: '#f8f9fa', dark: '#ced4da' }
    ];

    const particleCount = 140;
    const particles = [];
    for (let i = 0; i < particleCount; i++) {
      const col = CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)];
      particles.push({
        x: Math.random() * w,
        y: -20 - Math.random() * (h * 0.45),
        size: Math.random() * 5 + 6,
        length: Math.random() * 8 + 8,
        shape: Math.random() > 0.22 ? 'rect' : 'circle',
        color: col.light,
        darkColor: col.dark,
        vy: Math.random() * 2.8 + 2.4,
        vx: (Math.random() - 0.5) * 1.8,
        wobble: Math.random() * Math.PI * 2,
        wobbleSpeed: Math.random() * 0.07 + 0.03,
        rotation: Math.random() * Math.PI * 2,
        rotationSpeed: (Math.random() - 0.5) * 0.08,
        tilt: Math.random() * Math.PI * 2,
        tiltSpeed: Math.random() * 0.08 + 0.04
      });
    }

    if (confettiAnimId) cancelAnimationFrame(confettiAnimId);

    const startTime = performance.now();
    const spawnDuration = 2400;

    function animate(now) {
      const elapsed = now - startTime;
      ctx.clearRect(0, 0, w, h);

      let activeParticles = 0;

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];

        p.wobble += p.wobbleSpeed;
        p.tilt += p.tiltSpeed;
        p.rotation += p.rotationSpeed;
        p.x += p.vx + Math.sin(p.wobble) * 1.2;
        p.y += p.vy;

        if (p.y > h + 20) {
          if (elapsed < spawnDuration) {
            p.y = -20 - Math.random() * 40;
            p.x = Math.random() * w;
            p.vy = Math.random() * 2.8 + 2.4;
            p.vx = (Math.random() - 0.5) * 1.8;
            activeParticles++;
          }
          continue;
        }

        activeParticles++;

        const cosTilt = Math.cos(p.tilt);
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        ctx.scale(cosTilt, 1);
        ctx.fillStyle = cosTilt > 0 ? p.color : p.darkColor;

        if (p.shape === 'circle') {
          ctx.beginPath();
          ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillRect(-p.size / 2, -p.length / 2, p.size, p.length);
        }
        ctx.restore();
      }

      if (activeParticles > 0 && elapsed < 6500) {
        confettiAnimId = requestAnimationFrame(animate);
      } else {
        if (confettiCanvas) {
          confettiCanvas.remove();
          confettiCanvas = null;
        }
        confettiAnimId = null;
      }
    }

    confettiAnimId = requestAnimationFrame(animate);
  }

  function startEffectCooldown() {
    effectCooldown = true;
    const effectBtns = document.querySelectorAll('#c2p-sidebar .c2p-effect-item:not([data-effect="tomato"])');
    effectBtns.forEach(b => { b.disabled = true; b.style.opacity = '0.4'; });
    setTimeout(() => {
      effectCooldown = false;
      if (dataChannel?.readyState === 'open') {
        document.querySelectorAll('#c2p-sidebar .c2p-effect-item').forEach(b => { b.disabled = false; b.style.opacity = ''; });
      }
    }, 4000);
  }

  function triggerFireworksEffect() {
    playFireworksSound();
    const container = getEffectContainer();
    if (!container) return;

    if (!fireworksCanvas) {
      fireworksCanvas = document.createElement('canvas');
      fireworksCanvas.className = 'c2p-fireworks-canvas';
      fireworksCanvas.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483645;';
      container.appendChild(fireworksCanvas);
    } else if (fireworksCanvas.parentElement !== container) {
      container.appendChild(fireworksCanvas);
    }

    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    const h = window.innerHeight;
    fireworksCanvas.width = Math.floor(w * dpr);
    fireworksCanvas.height = Math.floor(h * dpr);
    const ctx = fireworksCanvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);

    const PALETTES = [
      ['#ff0055', '#ff5577', '#ff99bb', '#ffffff'],
      ['#ffd700', '#ffea75', '#ffaa00', '#ffffff'],
      ['#00e5ff', '#0099ff', '#70d6ff', '#ffffff'],
      ['#00ff88', '#55ff99', '#aaffcc', '#ffffff'],
      ['#b5179e', '#7209b7', '#f72585', '#ffffff'],
      ['#ff4500', '#ff8c00', '#ffd700', '#ffffff']
    ];

    const rockets = [
      { delay: 0,    x: 0.25 * w, targetY: 0.28 * h },
      { delay: 120,  x: 0.75 * w, targetY: 0.24 * h },
      { delay: 350,  x: 0.50 * w, targetY: 0.36 * h },
      { delay: 580,  x: 0.18 * w, targetY: 0.22 * h },
      { delay: 820,  x: 0.82 * w, targetY: 0.32 * h },
      { delay: 1050, x: 0.35 * w, targetY: 0.18 * h },
      { delay: 1250, x: 0.65 * w, targetY: 0.26 * h },
      { delay: 1500, x: 0.22 * w, targetY: 0.38 * h },
      { delay: 1700, x: 0.78 * w, targetY: 0.20 * h },
      { delay: 1950, x: 0.42 * w, targetY: 0.30 * h },
      { delay: 2150, x: 0.58 * w, targetY: 0.22 * h },
      { delay: 2400, x: 0.30 * w, targetY: 0.16 * h },
      { delay: 2450, x: 0.70 * w, targetY: 0.18 * h }
    ].map(r => ({
      delay: r.delay,
      x: r.x + (Math.random() - 0.5) * 30,
      y: h + 10,
      targetY: r.targetY + (Math.random() - 0.5) * 20,
      speed: (h - r.targetY) / 30,
      trail: [],
      exploded: false,
      palette: PALETTES[Math.floor(Math.random() * PALETTES.length)]
    }));

    const particles = [];

    function createExplosion(x, y, palette) {
      const count = 110;
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 6.5 + 1.8;
        particles.push({
          x,
          y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          color: palette[Math.floor(Math.random() * palette.length)],
          alpha: 1,
          decay: Math.random() * 0.015 + 0.010,
          size: Math.random() * 2.5 + 2.8,
          trail: [[x, y]]
        });
      }
    }

    if (fireworksAnimId) cancelAnimationFrame(fireworksAnimId);
    const startTime = performance.now();

    function animate(now) {
      const elapsed = now - startTime;
      ctx.clearRect(0, 0, w, h);

      for (let i = 0; i < rockets.length; i++) {
        const r = rockets[i];
        if (elapsed < r.delay || r.exploded) continue;

        r.trail.push([r.x, r.y]);
        if (r.trail.length > 5) r.trail.shift();

        r.y -= r.speed;

        ctx.save();
        ctx.strokeStyle = '#ffd700';
        ctx.lineWidth = 3.2;
        ctx.lineCap = 'round';
        ctx.beginPath();
        if (r.trail.length > 1) {
          ctx.moveTo(r.trail[0][0], r.trail[0][1]);
          for (let t = 1; t < r.trail.length; t++) {
            ctx.lineTo(r.trail[t][0], r.trail[t][1]);
          }
        }
        ctx.stroke();

        ctx.fillStyle = '#fff5cc';
        ctx.beginPath();
        ctx.arc(r.x, r.y, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        if (r.y <= r.targetY) {
          r.exploded = true;
          createExplosion(r.x, r.y, r.palette);
        }
      }

      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.trail.push([p.x, p.y]);
        if (p.trail.length > 4) p.trail.shift();

        p.vx *= 0.96;
        p.vy = p.vy * 0.96 + 0.06;
        p.x += p.vx;
        p.y += p.vy;
        p.alpha -= p.decay;

        if (p.alpha <= 0) {
          particles.splice(i, 1);
          continue;
        }

        ctx.save();
        ctx.globalAlpha = Math.max(0, p.alpha);
        ctx.strokeStyle = p.color;
        ctx.fillStyle = p.color;
        ctx.lineWidth = p.size;
        ctx.lineCap = 'round';
        ctx.beginPath();
        if (p.trail.length > 1) {
          ctx.moveTo(p.trail[0][0], p.trail[0][1]);
          for (let t = 1; t < p.trail.length; t++) {
            ctx.lineTo(p.trail[t][0], p.trail[t][1]);
          }
        }
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size / 1.7, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      const allRocketsExploded = rockets.every(r => r.exploded);
      if ((!allRocketsExploded || particles.length > 0) && elapsed < 6500) {
        fireworksAnimId = requestAnimationFrame(animate);
      } else {
        if (fireworksCanvas) {
          fireworksCanvas.remove();
          fireworksCanvas = null;
        }
        fireworksAnimId = null;
      }
    }

    fireworksAnimId = requestAnimationFrame(animate);
  }

  function triggerTomatoEffect() {
    playTomatoSound();
    const container = getEffectContainer();
    if (!container) return;

    if (!tomatoCanvas) {
      tomatoCanvas = document.createElement('canvas');
      tomatoCanvas.className = 'c2p-tomato-canvas';
      tomatoCanvas.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483645;';
      container.appendChild(tomatoCanvas);
    } else if (tomatoCanvas.parentElement !== container) {
      container.appendChild(tomatoCanvas);
    }

    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    const h = window.innerHeight;
    tomatoCanvas.width = Math.floor(w * dpr);
    tomatoCanvas.height = Math.floor(h * dpr);
    const ctx = tomatoCanvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);

    const targetX = w * (0.42 + Math.random() * 0.16);
    const targetY = h * (0.36 + Math.random() * 0.18);
    const startX = targetX + (Math.random() - 0.5) * 120;
    const startY = h + 60;
    const flyDuration = 260; // ms

    const lobeCount = 14;
    const baseRadius = Math.min(w, h) * 0.075 + 25;
    const lobes = [];
    for (let i = 0; i < lobeCount; i++) {
      const angle = (i / lobeCount) * Math.PI * 2;
      const variance = (Math.random() * 0.5 + 0.75);
      lobes.push({
        angle,
        radius: baseRadius * variance
      });
    }

    const dripCount = 5;
    const drips = [];
    for (let i = 0; i < dripCount; i++) {
      const offsetAngle = Math.PI * 0.2 + (i / (dripCount - 1)) * Math.PI * 0.6;
      const originX = Math.cos(offsetAngle) * (baseRadius * 0.75);
      const originY = Math.sin(offsetAngle) * (baseRadius * 0.75);
      drips.push({
        x: originX,
        y: originY,
        length: 0,
        maxLength: Math.random() * 80 + 40,
        width: Math.random() * 4 + 3,
        speed: Math.random() * 0.6 + 0.35
      });
    }

    const dropletCount = 28;
    const droplets = [];
    for (let i = 0; i < dropletCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 7 + 2.5;
      droplets.push({
        x: targetX,
        y: targetY,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        radius: Math.random() * 4 + 2,
        drip: 0,
        dripSpeed: Math.random() * 0.25 + 0.1
      });
    }

    if (tomatoAnimId) cancelAnimationFrame(tomatoAnimId);
    const startTime = performance.now();

    function animate(now) {
      const elapsed = now - startTime;
      ctx.clearRect(0, 0, w, h);

      if (elapsed < flyDuration) {
        const progress = elapsed / flyDuration;
        const ease = progress * progress;
        const curX = startX + (targetX - startX) * ease;
        const curY = startY + (targetY - startY) * ease;
        const scale = 0.25 + progress * 0.75;
        const radius = 28 * scale;

        ctx.save();
        ctx.translate(curX, curY);
        ctx.rotate(progress * 4);

        const grad = ctx.createRadialGradient(-radius * 0.3, -radius * 0.3, radius * 0.1, 0, 0, radius);
        grad.addColorStop(0, '#ff4d4d');
        grad.addColorStop(0.7, '#d61a1a');
        grad.addColorStop(1, '#8f0000');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(0, 0, radius, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#2e7d32';
        ctx.beginPath();
        ctx.arc(0, -radius * 0.85, radius * 0.35, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
        tomatoAnimId = requestAnimationFrame(animate);
      } else {
        const splatElapsed = elapsed - flyDuration;
        let alpha = 1;
        if (splatElapsed > 3200) {
          alpha = Math.max(0, 1 - (splatElapsed - 3200) / 1200);
        }

        if (alpha <= 0 || elapsed > 5500) {
          if (tomatoCanvas) {
            tomatoCanvas.remove();
            tomatoCanvas = null;
          }
          tomatoAnimId = null;
          return;
        }

        ctx.save();
        ctx.globalAlpha = alpha;

        for (let i = 0; i < droplets.length; i++) {
          const d = droplets[i];
          d.vx *= 0.88;
          d.vy *= 0.88;
          d.x += d.vx;
          d.y += d.vy + d.drip;
          d.drip += d.dripSpeed * 0.05;

          ctx.fillStyle = '#cc1818';
          ctx.beginPath();
          ctx.arc(d.x, d.y, d.radius, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.translate(targetX, targetY);

        ctx.fillStyle = '#b31212';
        for (let i = 0; i < drips.length; i++) {
          const dr = drips[i];
          if (dr.length < dr.maxLength) {
            dr.length += dr.speed;
          }
          ctx.beginPath();
          ctx.arc(dr.x, dr.y + dr.length, dr.width * 0.8, 0, Math.PI * 2);
          ctx.fill();

          ctx.beginPath();
          ctx.rect(dr.x - dr.width / 2, dr.y, dr.width, dr.length);
          ctx.fill();
        }

        ctx.beginPath();
        const first = lobes[0];
        ctx.moveTo(Math.cos(first.angle) * first.radius, Math.sin(first.angle) * first.radius);
        for (let i = 1; i <= lobeCount; i++) {
          const prev = lobes[(i - 1) % lobeCount];
          const curr = lobes[i % lobeCount];
          const cpAngle = (prev.angle + curr.angle) / 2;
          const cpRadius = (prev.radius + curr.radius) * 0.55;
          ctx.quadraticCurveTo(
            Math.cos(cpAngle) * cpRadius,
            Math.sin(cpAngle) * cpRadius,
            Math.cos(curr.angle) * curr.radius,
            Math.sin(curr.angle) * curr.radius
          );
        }
        ctx.closePath();

        const splatGrad = ctx.createRadialGradient(0, 0, baseRadius * 0.2, 0, 0, baseRadius * 1.1);
        splatGrad.addColorStop(0, '#e52222');
        splatGrad.addColorStop(0.65, '#b81414');
        splatGrad.addColorStop(1, '#780505');
        ctx.fillStyle = splatGrad;
        ctx.fill();

        ctx.fillStyle = '#6b0000';
        for (let s = 0; s < 7; s++) {
          const sa = (s / 7) * Math.PI * 2;
          const sr = baseRadius * 0.45;
          ctx.beginPath();
          ctx.arc(Math.cos(sa) * sr, Math.sin(sa) * sr, 3, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
        ctx.lineWidth = 3.5;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.arc(-baseRadius * 0.25, -baseRadius * 0.25, baseRadius * 0.4, Math.PI * 0.8, Math.PI * 1.4);
        ctx.stroke();

        ctx.fillStyle = '#2e7d32';
        ctx.beginPath();
        for (let p = 0; p < 5; p++) {
          const pa = (p / 5) * Math.PI * 2 - Math.PI / 2;
          const outerR = baseRadius * 0.32;
          const innerR = baseRadius * 0.12;
          ctx.lineTo(Math.cos(pa) * outerR, Math.sin(pa) * outerR);
          ctx.lineTo(Math.cos(pa + Math.PI / 5) * innerR, Math.sin(pa + Math.PI / 5) * innerR);
        }
        ctx.closePath();
        ctx.fill();

        ctx.restore();
        tomatoAnimId = requestAnimationFrame(animate);
      }
    }

    tomatoAnimId = requestAnimationFrame(animate);
  }

  function triggerDanceEffect() {
    const container = getEffectContainer();
    if (!container) return;

    if (!danceCanvas) {
      danceCanvas = document.createElement('canvas');
      danceCanvas.className = 'c2p-dance-canvas';
      danceCanvas.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483645;';
      container.appendChild(danceCanvas);
    } else if (danceCanvas.parentElement !== container) {
      container.appendChild(danceCanvas);
    }

    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    const h = window.innerHeight;
    danceCanvas.width = Math.floor(w * dpr);
    danceCanvas.height = Math.floor(h * dpr);
    const ctx = danceCanvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);

    const scale = Math.min(w, h) * 0.0017;
    const baseY = h * 0.82;
    const sparks = [];

    // Tapered anatomical limb segment (rounded capsule)
    function drawSegment(x1, y1, x2, y2, r1, r2) {
      const angle = Math.atan2(y2 - y1, x2 - x1);
      const perp = angle + Math.PI / 2;
      const dx1 = Math.cos(perp) * r1;
      const dy1 = Math.sin(perp) * r1;
      const dx2 = Math.cos(perp) * r2;
      const dy2 = Math.sin(perp) * r2;

      ctx.beginPath();
      ctx.arc(x1, y1, r1, perp, perp + Math.PI);
      ctx.lineTo(x2 - dx2, y2 - dy2);
      ctx.arc(x2, y2, r2, perp + Math.PI, perp);
      ctx.lineTo(x1 + dx1, y1 + dy1);
      ctx.closePath();
      ctx.fill();
    }

    // 70s Disco Bell-bottom pant leg with flared hem
    function drawBellBottom(kx, ky, ax, ay, kr, ar) {
      const angle = Math.atan2(ay - ky, ax - kx);
      const perp = angle + Math.PI / 2;
      const dx1 = Math.cos(perp) * kr;
      const dy1 = Math.sin(perp) * kr;
      const dx2 = Math.cos(perp) * ar;
      const dy2 = Math.sin(perp) * ar;

      ctx.beginPath();
      ctx.moveTo(kx - dx1, ky - dy1);
      ctx.quadraticCurveTo((kx + ax) / 2 - dx1 * 0.65, (ky + ay) / 2 - dy1 * 0.65, ax - dx2, ay - dy2);
      ctx.quadraticCurveTo(ax, ay + ar * 0.25, ax + dx2, ay + dy2);
      ctx.quadraticCurveTo((kx + ax) / 2 + dx1 * 0.65, (ky + ay) / 2 + dy1 * 0.65, kx + dx1, ky + dy1);
      ctx.closePath();
      ctx.fill();
    }

    function emitSpark(x, y, color) {
      if (sparks.length > 50) return;
      sparks.push({
        x: x + (Math.random() - 0.5) * 8,
        y: y + (Math.random() - 0.5) * 8,
        vx: (Math.random() - 0.5) * 1.5,
        vy: -Math.random() * 2 - 0.5,
        alpha: 1,
        size: Math.random() * 3 + 2,
        color
      });
    }

    function drawMan(cx, cy, beat, phrase) {
      const hipSway = Math.sin(beat * Math.PI * 0.5) * 14 * scale;
      const bounce = Math.abs(Math.sin(beat * Math.PI)) * 12 * scale;
      const rootX = cx + hipSway * 0.4;
      const rootY = cy - bounce;

      // Contact shadow
      ctx.save();
      ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
      ctx.beginPath();
      ctx.ellipse(cx + hipSway * 0.2, baseY + 6 * scale, 45 * scale, 10 * scale, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
      ctx.shadowBlur = 8 * scale;

      const manSkin = '#e8b28a';
      const manHair = '#141419';
      const manShirt = '#e50914';
      const manPants = '#f8fafc';
      const manShoes = '#111116';

      const hipX = rootX;
      const hipY = rootY - 75 * scale;
      const chestX = rootX + hipSway * 0.4;
      const chestY = hipY - 55 * scale;

      // Legs & Bell-Bottoms (Pants)
      const lHip = hipX - 12 * scale;
      const rHip = hipX + 12 * scale;

      const lKneeSwing = Math.sin(beat * Math.PI) * 0.25;
      const rKneeSwing = -Math.sin(beat * Math.PI) * 0.25;

      const lKneeX = lHip - 8 * scale + Math.sin(lKneeSwing) * 30 * scale;
      const lKneeY = hipY + 42 * scale;
      const rKneeX = rHip + 8 * scale + Math.sin(rKneeSwing) * 30 * scale;
      const rKneeY = hipY + 42 * scale;

      const lAnkleX = lKneeX - 4 * scale;
      const lAnkleY = baseY;
      const rAnkleX = rKneeX + 6 * scale;
      const rAnkleY = baseY - bounce * 0.3;

      // Pants (Thighs & Bell-Bottom Calves)
      ctx.fillStyle = manPants;
      drawSegment(lHip, hipY, lKneeX, lKneeY, 13 * scale, 10 * scale);
      drawSegment(rHip, hipY, rKneeX, rKneeY, 13 * scale, 10 * scale);
      drawBellBottom(lKneeX, lKneeY, lAnkleX, lAnkleY, 10 * scale, 22 * scale);
      drawBellBottom(rKneeX, rKneeY, rAnkleX, rAnkleY, 10 * scale, 22 * scale);

      // Platform Shoes
      ctx.fillStyle = manShoes;
      ctx.beginPath();
      ctx.ellipse(lAnkleX + 4 * scale, lAnkleY + 4 * scale, 14 * scale, 6 * scale, -0.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(rAnkleX + 6 * scale, rAnkleY + 4 * scale, 14 * scale, 6 * scale, 0.1, 0, Math.PI * 2);
      ctx.fill();

      // Shirt / Torso
      ctx.fillStyle = manShirt;
      ctx.beginPath();
      ctx.moveTo(chestX - 22 * scale, chestY);
      ctx.lineTo(chestX + 22 * scale, chestY);
      ctx.lineTo(hipX + 16 * scale, hipY);
      ctx.lineTo(hipX - 16 * scale, hipY);
      ctx.closePath();
      ctx.fill();

      // Open chest / collar cut accent showing skin
      ctx.fillStyle = manSkin;
      ctx.beginPath();
      ctx.moveTo(chestX - 8 * scale, chestY);
      ctx.lineTo(chestX + 8 * scale, chestY);
      ctx.lineTo(chestX, chestY + 24 * scale);
      ctx.closePath();
      ctx.fill();

      // Head & Black Hair
      const headX = chestX + hipSway * 0.2;
      const headY = chestY - 26 * scale;
      const headR = 14 * scale;

      // Neck (Skin)
      ctx.fillStyle = manSkin;
      drawSegment(chestX, chestY, headX, headY, 6 * scale, 6 * scale);

      // Face silhouette (Skin)
      ctx.beginPath();
      ctx.arc(headX, headY, headR, 0, Math.PI * 2);
      ctx.fill();

      // 70s Feathered Hair (Black)
      ctx.fillStyle = manHair;
      ctx.beginPath();
      ctx.arc(headX, headY - 3 * scale, headR * 1.2, Math.PI * 0.85, Math.PI * 2.15);
      ctx.quadraticCurveTo(headX + headR * 1.35, headY + headR * 0.45, headX + headR * 0.85, headY + 2 * scale);
      ctx.quadraticCurveTo(headX, headY - headR * 0.3, headX - headR * 0.85, headY + 2 * scale);
      ctx.quadraticCurveTo(headX - headR * 1.35, headY + headR * 0.45, headX - headR * 1.15, headY - 2 * scale);
      ctx.closePath();
      ctx.fill();

      // Arms: Poses depend on phrase
      const lShoulderX = chestX - 22 * scale;
      const lShoulderY = chestY + 4 * scale;
      const rShoulderX = chestX + 22 * scale;
      const rShoulderY = chestY + 4 * scale;

      let rElbowX, rElbowY, rHandX, rHandY;
      let lElbowX, lElbowY, lHandX, lHandY;

      if (phrase < 4) {
        // Move 1: Saturday Night Fever Iconic Disco Sky Point!
        const pointStep = phrase % 2;
        const isHigh = pointStep < 1.25;
        const rArmTargetAngle = isHigh ? -Math.PI * 0.38 : Math.PI * 0.22;

        rElbowX = rShoulderX + Math.cos(rArmTargetAngle) * 32 * scale;
        rElbowY = rShoulderY + Math.sin(rArmTargetAngle) * 32 * scale;
        rHandX = rElbowX + Math.cos(rArmTargetAngle) * 34 * scale;
        rHandY = rElbowY + Math.sin(rArmTargetAngle) * 34 * scale;

        // Left hand on hip
        lElbowX = lShoulderX - 22 * scale;
        lElbowY = lShoulderY + 24 * scale;
        lHandX = hipX - 16 * scale;
        lHandY = hipY;

        if (isHigh) emitSpark(rHandX, rHandY, '#ffdd55');
      } else {
        // Move 2: Funky Disco Hand Roll
        const rollAngle = beat * Math.PI * 2;
        const rollCenterY = chestY + 16 * scale;

        rElbowX = rShoulderX + 16 * scale;
        rElbowY = chestY + 20 * scale;
        rHandX = chestX + Math.cos(rollAngle) * 16 * scale;
        rHandY = rollCenterY + Math.sin(rollAngle) * 14 * scale;

        lElbowX = lShoulderX - 16 * scale;
        lElbowY = chestY + 20 * scale;
        lHandX = chestX + Math.cos(rollAngle + Math.PI) * 16 * scale;
        lHandY = rollCenterY + Math.sin(rollAngle + Math.PI) * 14 * scale;

        emitSpark(rHandX, rHandY, '#ffdd55');
      }

      // Shirt sleeves on arms
      ctx.fillStyle = manShirt;
      drawSegment(lShoulderX, lShoulderY, lElbowX, lElbowY, 9 * scale, 7 * scale);
      drawSegment(lElbowX, lElbowY, lHandX, lHandY, 7 * scale, 5 * scale);
      drawSegment(rShoulderX, rShoulderY, rElbowX, rElbowY, 9 * scale, 7 * scale);
      drawSegment(rElbowX, rElbowY, rHandX, rHandY, 7 * scale, 5 * scale);

      // Hands (Skin)
      ctx.fillStyle = manSkin;
      ctx.beginPath();
      ctx.arc(rHandX, rHandY, 6 * scale, 0, Math.PI * 2);
      ctx.arc(lHandX, lHandY, 6 * scale, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    }

    function drawWoman(cx, cy, beat, phrase) {
      const hipSway = -Math.sin(beat * Math.PI * 0.5) * 16 * scale;
      const bounce = Math.abs(Math.sin((beat + 0.5) * Math.PI)) * 12 * scale;
      const rootX = cx + hipSway * 0.5;
      const rootY = cy - bounce;

      // Contact shadow
      ctx.save();
      ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
      ctx.beginPath();
      ctx.ellipse(cx + hipSway * 0.3, baseY + 6 * scale, 40 * scale, 9 * scale, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
      ctx.shadowBlur = 8 * scale;

      const womanSkin = '#fcd0a1';
      const womanHair = '#563217';
      const womanHairDark = '#43240f';
      const womanDressGrad = ctx.createLinearGradient(rootX - 40 * scale, rootY - 120 * scale, rootX + 40 * scale, rootY);
      womanDressGrad.addColorStop(0, '#ffb703');
      womanDressGrad.addColorStop(1, '#fb8500');
      const womanHeels = '#d90429';

      const hipX = rootX;
      const hipY = rootY - 75 * scale;
      const waistX = rootX + hipSway * 0.3;
      const waistY = hipY - 26 * scale;
      const chestX = rootX + hipSway * 0.6;
      const chestY = waistY - 26 * scale;

      // Head position
      const headX = chestX + hipSway * 0.2;
      const headY = chestY - 24 * scale;
      const headR = 12 * scale;

      // Long Hair (Back layer in background, behind clothes and body)
      const hairLag = Math.sin((beat - 0.3) * Math.PI * 0.5) * 16 * scale;
      ctx.fillStyle = womanHairDark;
      ctx.beginPath();
      ctx.arc(headX, headY - 2 * scale, headR * 1.3, Math.PI * 0.9, Math.PI * 2.1);
      ctx.quadraticCurveTo(headX + headR * 1.6 + hairLag, headY + 30 * scale, headX + headR * 0.6 + hairLag, headY + 55 * scale);
      ctx.quadraticCurveTo(headX - headR * 0.5 + hairLag, headY + 35 * scale, headX - headR * 1.2, headY);
      ctx.closePath();
      ctx.fill();

      // Legs (Skin)
      const lHip = hipX - 10 * scale;
      const rHip = hipX + 10 * scale;

      const lLegPhase = Math.sin((beat + 0.5) * Math.PI) * 0.3;
      const rLegPhase = -Math.sin((beat + 0.5) * Math.PI) * 0.3;

      const lKneeX = lHip - 4 * scale + Math.sin(lLegPhase) * 26 * scale;
      const lKneeY = hipY + 40 * scale;
      const rKneeX = rHip + 4 * scale + Math.sin(rLegPhase) * 26 * scale;
      const rKneeY = hipY + 40 * scale;

      const lAnkleX = lKneeX - 3 * scale;
      const lAnkleY = baseY - bounce * 0.2;
      const rAnkleX = rKneeX + 5 * scale;
      const rAnkleY = baseY;

      // Slender legs (Skin)
      ctx.fillStyle = womanSkin;
      drawSegment(lHip, hipY, lKneeX, lKneeY, 10 * scale, 8 * scale);
      drawSegment(rHip, hipY, rKneeX, rKneeY, 10 * scale, 8 * scale);
      drawSegment(lKneeX, lKneeY, lAnkleX, lAnkleY, 8 * scale, 5 * scale);
      drawSegment(rKneeX, rKneeY, rAnkleX, rAnkleY, 8 * scale, 5 * scale);

      // Dancing High Heels
      ctx.fillStyle = womanHeels;
      ctx.beginPath();
      ctx.ellipse(lAnkleX + 3 * scale, lAnkleY + 3 * scale, 10 * scale, 4 * scale, 0.1, 0, Math.PI * 2);
      ctx.ellipse(rAnkleX + 4 * scale, rAnkleY + 3 * scale, 10 * scale, 4 * scale, -0.1, 0, Math.PI * 2);
      ctx.fill();

      // Flowing Disco Dress
      ctx.fillStyle = womanDressGrad;
      const skirtLag = Math.sin((beat - 0.2) * Math.PI) * 14 * scale;
      ctx.beginPath();
      ctx.moveTo(waistX - 12 * scale, waistY);
      ctx.lineTo(waistX + 12 * scale, waistY);
      ctx.quadraticCurveTo(hipX + 28 * scale + skirtLag, hipY + 18 * scale, hipX + 32 * scale + skirtLag, hipY + 38 * scale);
      ctx.quadraticCurveTo(hipX + skirtLag, hipY + 44 * scale, hipX - 32 * scale + skirtLag, hipY + 38 * scale);
      ctx.quadraticCurveTo(hipX - 28 * scale + skirtLag, hipY + 18 * scale, waistX - 12 * scale, waistY);
      ctx.closePath();
      ctx.fill();

      // Fitted Bodice
      ctx.beginPath();
      ctx.moveTo(chestX - 16 * scale, chestY);
      ctx.lineTo(chestX + 16 * scale, chestY);
      ctx.lineTo(waistX + 12 * scale, waistY);
      ctx.lineTo(waistX - 12 * scale, waistY);
      ctx.closePath();
      ctx.fill();

      // Neck (Skin)
      ctx.fillStyle = womanSkin;
      drawSegment(chestX, chestY, headX, headY, 5 * scale, 5 * scale);

      // Face (Skin)
      ctx.beginPath();
      ctx.arc(headX, headY, headR, 0, Math.PI * 2);
      ctx.fill();

      // Front hair / bangs framing face (Chestnut brown)
      ctx.fillStyle = womanHair;
      ctx.beginPath();
      ctx.arc(headX, headY - 3 * scale, headR * 1.15, Math.PI * 0.9, Math.PI * 2.1);
      ctx.quadraticCurveTo(headX + headR * 1.1, headY - 2 * scale, headX + headR * 0.6, headY + 5 * scale);
      ctx.quadraticCurveTo(headX + headR * 0.2, headY - headR * 0.25, headX - headR * 0.7, headY - headR * 0.15);
      ctx.quadraticCurveTo(headX - headR * 1.1, headY - 2 * scale, headX - headR * 1.15, headY - 3 * scale);
      ctx.closePath();
      ctx.fill();

      // Arms: Fluid disco poses (Skin)
      const lShoulderX = chestX - 16 * scale;
      const lShoulderY = chestY + 2 * scale;
      const rShoulderX = chestX + 16 * scale;
      const rShoulderY = chestY + 2 * scale;

      let rElbowX, rElbowY, rHandX, rHandY;
      let lElbowX, lElbowY, lHandX, lHandY;

      if (phrase < 4) {
        // Move 1: Graceful Disco Sway & Point
        const wave = Math.sin(beat * Math.PI);
        rElbowX = rShoulderX + 20 * scale;
        rElbowY = rShoulderY - 18 * scale + wave * 6 * scale;
        rHandX = rElbowX + 18 * scale;
        rHandY = rElbowY - 24 * scale - wave * 10 * scale;

        lElbowX = lShoulderX - 18 * scale;
        lElbowY = lShoulderY + 20 * scale;
        lHandX = hipX - 14 * scale;
        lHandY = hipY + 4 * scale;

        emitSpark(rHandX, rHandY, '#ffb703');
      } else {
        // Move 2: Overhead Double Wave & Shimmy
        const waveL = Math.sin(beat * Math.PI * 2) * 8 * scale;
        const waveR = Math.sin(beat * Math.PI * 2 + Math.PI) * 8 * scale;

        lElbowX = lShoulderX - 18 * scale;
        lElbowY = lShoulderY - 18 * scale;
        lHandX = lElbowX - 8 * scale + waveL;
        lHandY = lElbowY - 24 * scale;

        rElbowX = rShoulderX + 18 * scale;
        rElbowY = rShoulderY - 18 * scale;
        rHandX = rElbowX + 8 * scale + waveR;
        rHandY = rElbowY - 24 * scale;

        emitSpark(lHandX, lHandY, '#ffb703');
        emitSpark(rHandX, rHandY, '#fb8500');
      }

      ctx.fillStyle = womanSkin;
      drawSegment(lShoulderX, lShoulderY, lElbowX, lElbowY, 7 * scale, 5 * scale);
      drawSegment(lElbowX, lElbowY, lHandX, lHandY, 5 * scale, 4 * scale);
      drawSegment(rShoulderX, rShoulderY, rElbowX, rElbowY, 7 * scale, 5 * scale);
      drawSegment(rElbowX, rElbowY, rHandX, rHandY, 5 * scale, 4 * scale);

      ctx.beginPath();
      ctx.arc(rHandX, rHandY, 5 * scale, 0, Math.PI * 2);
      ctx.arc(lHandX, lHandY, 5 * scale, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    }

    if (danceAnimId) cancelAnimationFrame(danceAnimId);
    let startTime = null;
    const duration = 6000;

    function animate(now) {
      if (!startTime) startTime = now;
      const elapsed = now - startTime;

      if (elapsed >= duration) {
        if (danceCanvas) {
          danceCanvas.remove();
          danceCanvas = null;
        }
        danceAnimId = null;
        return;
      }

      const t = elapsed / 1000;
      const beat = t * 2.2;
      const phrase = beat % 8;

      ctx.clearRect(0, 0, w, h);

      let alpha = 1;
      if (elapsed < 350) {
        alpha = Math.max(0.1, elapsed / 350);
      } else if (elapsed > duration - 700) {
        alpha = Math.max(0, (duration - elapsed) / 700);
      }

      ctx.save();
      ctx.globalAlpha = alpha;

      // Draw Dancing Couple (Man & Woman)
      const manCenterX = w * 0.40;
      const womanCenterX = w * 0.60;
      drawMan(manCenterX, baseY, beat, phrase);
      drawWoman(womanCenterX, baseY, beat, phrase);

      // Render Floating Disco Sparks
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i];
        s.x += s.vx;
        s.y += s.vy;
        s.alpha -= 0.025;
        if (s.alpha <= 0) {
          sparks.splice(i, 1);
          continue;
        }
        ctx.fillStyle = s.color;
        ctx.globalAlpha = alpha * s.alpha;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.size * scale, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
      danceAnimId = requestAnimationFrame(animate);
    }

    danceAnimId = requestAnimationFrame(animate);
  }

  function triggerStareEffect() {
    const container = getEffectContainer();
    if (!container) return;

    if (!stareCanvas) {
      stareCanvas = document.createElement('canvas');
      stareCanvas.className = 'c2p-stare-canvas';
      stareCanvas.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483645;';
      container.appendChild(stareCanvas);
    } else if (stareCanvas.parentElement !== container) {
      container.appendChild(stareCanvas);
    }

    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    const h = window.innerHeight;
    stareCanvas.width = Math.floor(w * dpr);
    stareCanvas.height = Math.floor(h * dpr);
    const ctx = stareCanvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);

    if (stareAnimId) cancelAnimationFrame(stareAnimId);
    const startTime = performance.now();
    const DURATION = 4200;

    function getPupilOffset(elapsed) {
      // Moves pupil from right (+1) to left (-1) and back
      if (elapsed < 350) return 1;
      if (elapsed < 1200) {
        const p = (elapsed - 350) / 850;
        const ease = (1 - Math.cos(p * Math.PI)) / 2;
        return 1 - 2 * ease; // +1 -> -1
      }
      if (elapsed < 1800) return -1;
      if (elapsed < 2500) {
        const p = (elapsed - 1800) / 700;
        const ease = (1 - Math.cos(p * Math.PI)) / 2;
        return -1 + 2 * ease; // -1 -> +1
      }
      if (elapsed < 2900) return 1;
      if (elapsed < 3600) {
        const p = (elapsed - 2900) / 700;
        const ease = (1 - Math.cos(p * Math.PI)) / 2;
        return 1 - 2 * ease; // +1 -> -1
      }
      return -1;
    }

    function drawEye(eyeCenterX, eyeCenterY, tilt, rx, ry, pupilRadius, pupilOffsetNorm, blink) {
      ctx.save();
      ctx.translate(eyeCenterX, eyeCenterY);
      ctx.rotate(tilt);
      ctx.scale(1, blink);

      // Eyeball Sclera (White)
      ctx.beginPath();
      ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
      ctx.shadowBlur = 18;
      ctx.fill();

      // Clip inside sclera for pupil
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(0, 0, rx - 1, ry - 1, 0, 0, Math.PI * 2);
      ctx.clip();

      // Pupil position
      const maxDx = rx * 0.48;
      const pupilX = pupilOffsetNorm * maxDx;
      const pupilY = ry * 0.04;

      // Iris / Pupil (Emoji style dark brown/black gradient)
      ctx.beginPath();
      ctx.arc(pupilX, pupilY, pupilRadius, 0, Math.PI * 2);
      const pupilGrad = ctx.createRadialGradient(pupilX - pupilRadius * 0.25, pupilY - pupilRadius * 0.25, pupilRadius * 0.08, pupilX, pupilY, pupilRadius);
      pupilGrad.addColorStop(0, '#362016');
      pupilGrad.addColorStop(0.65, '#170e0a');
      pupilGrad.addColorStop(1, '#080504');
      ctx.fillStyle = pupilGrad;
      ctx.shadowColor = 'transparent';
      ctx.fill();

      // Glossy Reflection Glints
      // Big primary glint
      ctx.beginPath();
      ctx.arc(pupilX - pupilRadius * 0.32, pupilY - pupilRadius * 0.32, pupilRadius * 0.34, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();

      // Small secondary glint
      ctx.beginPath();
      ctx.arc(pupilX + pupilRadius * 0.36, pupilY + pupilRadius * 0.34, pupilRadius * 0.16, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.fill();

      ctx.restore();

      // Outer Eye Stroke
      ctx.beginPath();
      ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
      ctx.strokeStyle = '#222222';
      ctx.lineWidth = Math.max(3.5, rx * 0.065);
      ctx.stroke();

      ctx.restore();
    }

    function animate(now) {
      const elapsed = now - startTime;
      ctx.clearRect(0, 0, w, h);

      if (elapsed >= DURATION) {
        if (stareCanvas) {
          stareCanvas.remove();
          stareCanvas = null;
        }
        stareAnimId = null;
        return;
      }

      let scale = 1;
      let alpha = 1;
      if (elapsed < 350) {
        const p = elapsed / 350;
        scale = Math.sin(p * Math.PI * 0.5) * 1.05;
        alpha = Math.min(1, p * 2.5);
      } else if (elapsed > 3500) {
        alpha = Math.max(0, 1 - (elapsed - 3500) / 700);
      }

      // Blink animation around 1650ms - 1790ms
      let blink = 1;
      if (elapsed >= 1650 && elapsed <= 1790) {
        const bp = (elapsed - 1650) / 140;
        blink = Math.max(0.08, Math.abs(Math.cos(bp * Math.PI)));
      }

      const pupilOffset = getPupilOffset(elapsed);

      // Responsive emoji dimensions
      const baseSize = Math.min(w, h) * 0.14;
      const rx = baseSize * 0.76;
      const ry = baseSize * 0.98;
      const pupilRadius = baseSize * 0.44;
      const spacing = baseSize * 1.6;

      const cx = w * 0.5;
      const cy = h * 0.46;

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(cx, cy);
      ctx.scale(scale, scale);
      ctx.translate(-cx, -cy);

      // Left eye and Right eye (with emoji slight tilt)
      drawEye(cx - spacing * 0.5, cy, -0.11, rx, ry, pupilRadius, pupilOffset, blink);
      drawEye(cx + spacing * 0.5, cy, -0.05, rx, ry, pupilRadius, pupilOffset, blink);

      ctx.restore();

      stareAnimId = requestAnimationFrame(animate);
    }

    stareAnimId = requestAnimationFrame(animate);
  }

  function triggerSmirkEffect() {
    const container = getEffectContainer();
    if (!container) return;

    if (!smirkCanvas) {
      smirkCanvas = document.createElement('canvas');
      smirkCanvas.className = 'c2p-smirk-canvas';
      smirkCanvas.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483645;';
      container.appendChild(smirkCanvas);
    } else if (smirkCanvas.parentElement !== container) {
      container.appendChild(smirkCanvas);
    }

    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    const h = window.innerHeight;
    smirkCanvas.width = Math.floor(w * dpr);
    smirkCanvas.height = Math.floor(h * dpr);
    const ctx = smirkCanvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);

    if (smirkAnimId) cancelAnimationFrame(smirkAnimId);
    const startTime = performance.now();
    const DURATION = 4000;

    function animate(now) {
      const elapsed = now - startTime;
      ctx.clearRect(0, 0, w, h);

      if (elapsed >= DURATION) {
        if (smirkCanvas) {
          smirkCanvas.remove();
          smirkCanvas = null;
        }
        smirkAnimId = null;
        return;
      }

      let scale = 1;
      let alpha = 1;
      if (elapsed < 350) {
        const p = elapsed / 350;
        scale = Math.sin(p * Math.PI * 0.5) * 1.05;
        alpha = Math.min(1, p * 2.5);
      } else if (elapsed > 3300) {
        alpha = Math.max(0, 1 - (elapsed - 3300) / 700);
      }

      // Smirk progressive expression progression (0 to 1)
      const smirkP = Math.min(1, Math.max(0, (elapsed - 250) / 750));
      const smirkEase = (1 - Math.cos(smirkP * Math.PI)) / 2;

      // Gentle floating hover
      const floatY = Math.sin(elapsed * 0.003) * 5;

      const baseR = Math.min(w, h) * 0.17;
      const cx = w * 0.5;
      const cy = h * 0.46 + floatY;

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(cx, cy);
      ctx.scale(scale, scale);

      // 1. Round Head with Radial Gradient and Soft Ambient Occlusion
      const headR = baseR;

      ctx.save();
      ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
      ctx.shadowBlur = 26;
      const faceGrad = ctx.createRadialGradient(-headR * 0.3, -headR * 0.3, baseR * 0.15, 0, 0, headR);
      faceGrad.addColorStop(0, '#ffe380');
      faceGrad.addColorStop(0.72, '#ffb703');
      faceGrad.addColorStop(1, '#f77f00');

      ctx.beginPath();
      ctx.arc(0, 0, headR, 0, Math.PI * 2);
      ctx.fillStyle = faceGrad;
      ctx.fill();

      // Head perimeter definition
      ctx.lineWidth = Math.max(3, baseR * 0.035);
      ctx.strokeStyle = '#d47200';
      ctx.stroke();
      ctx.restore();

      // Soft Cheek Blush (adds human warmth)
      ctx.save();
      ctx.fillStyle = 'rgba(239, 68, 68, 0.14)';
      [-1, 1].forEach(side => {
        ctx.beginPath();
        ctx.ellipse(side * headR * 0.55, baseR * 0.14, baseR * 0.22, baseR * 0.12, side * 0.1, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.restore();

      // Feature lines color (warm anatomical dark brown)
      const strokeColor = '#522504';
      ctx.strokeStyle = strokeColor;
      ctx.fillStyle = strokeColor;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // 2. Eyebrows (Thick, shaped, human anatomical arch)
      const browThick = Math.max(4, baseR * 0.065);
      ctx.lineWidth = browThick;

      // Left eyebrow (relaxed, contemplative slant)
      ctx.beginPath();
      ctx.moveTo(-baseR * 0.62, -baseR * 0.34);
      ctx.quadraticCurveTo(-baseR * 0.38, -baseR * 0.48 - smirkEase * baseR * 0.04, -baseR * 0.14, -baseR * 0.36);
      ctx.stroke();

      // Right eyebrow (slyly arched high up with smug skepticism)
      const rBrowRaise = smirkEase * baseR * 0.18;
      ctx.beginPath();
      ctx.moveTo(baseR * 0.14, -baseR * 0.38 - rBrowRaise * 0.4);
      ctx.quadraticCurveTo(baseR * 0.40, -baseR * 0.62 - rBrowRaise, baseR * 0.66, -baseR * 0.42 - rBrowRaise * 0.65);
      ctx.stroke();

      // Micro forehead expression crease near cocked brow
      if (smirkEase > 0.3) {
        ctx.save();
        ctx.lineWidth = Math.max(2, baseR * 0.025);
        ctx.strokeStyle = 'rgba(133, 77, 14, 0.5)';
        ctx.beginPath();
        ctx.moveTo(baseR * 0.32, -baseR * 0.68 - rBrowRaise * 0.7);
        ctx.quadraticCurveTo(baseR * 0.44, -baseR * 0.73 - rBrowRaise * 0.8, baseR * 0.54, -baseR * 0.67 - rBrowRaise * 0.7);
        ctx.stroke();
        ctx.restore();
      }

      // 3. Eyes (Substantially enlarged, almond shape, distinct eyelid creases & iris)
      const eyeW = baseR * 0.46;
      const eyeH = baseR * 0.25;
      const eyeY = -baseR * 0.14;
      const eyeSpacing = baseR * 0.40;

      [-1, 1].forEach(side => {
        const eyeX = side * eyeSpacing;
        ctx.save();
        ctx.translate(eyeX, eyeY);

        // Upper eyelid fold (pliegue palpebral / crease)
        ctx.beginPath();
        ctx.lineWidth = Math.max(2, baseR * 0.025);
        ctx.strokeStyle = 'rgba(120, 53, 15, 0.6)';
        ctx.moveTo(-eyeW * 0.46, -eyeH * 0.72);
        ctx.quadraticCurveTo(0, -eyeH * 1.15, eyeW * 0.46, -eyeH * 0.70);
        ctx.stroke();

        // Eye Sclera (Almond contour)
        ctx.beginPath();
        ctx.moveTo(-eyeW * 0.50, 0);
        ctx.quadraticCurveTo(0, eyeH * 0.75, eyeW * 0.50, -eyeH * 0.06);
        ctx.quadraticCurveTo(0, -eyeH * 0.75, -eyeW * 0.50, 0);
        ctx.closePath();

        ctx.fillStyle = '#ffffff';
        ctx.fill();

        ctx.save();
        ctx.clip();

        // Colored Iris & Pupil (looking sideways to the right: smirk direction)
        const irisR = eyeH * 0.64;
        const pupilX = eyeW * 0.22 * smirkEase;
        const pupilY = 0;

        // Iris radial gradient (hazel/amber depth)
        const irisGrad = ctx.createRadialGradient(pupilX, pupilY, irisR * 0.2, pupilX, pupilY, irisR);
        irisGrad.addColorStop(0, '#1c1917');
        irisGrad.addColorStop(0.55, '#78350f');
        irisGrad.addColorStop(1, '#451a03');

        ctx.beginPath();
        ctx.arc(pupilX, pupilY, irisR, 0, Math.PI * 2);
        ctx.fillStyle = irisGrad;
        ctx.fill();

        // Jet-black pupil core
        ctx.beginPath();
        ctx.arc(pupilX, pupilY, irisR * 0.50, 0, Math.PI * 2);
        ctx.fillStyle = '#000000';
        ctx.fill();

        // Primary bright specular reflection glint
        ctx.beginPath();
        ctx.arc(pupilX - irisR * 0.32, pupilY - irisR * 0.32, irisR * 0.26, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();

        // Soft secondary glint
        ctx.beginPath();
        ctx.arc(pupilX + irisR * 0.32, pupilY + irisR * 0.32, irisR * 0.14, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
        ctx.fill();

        ctx.restore(); // restore clip

        // Lower eyelid line
        ctx.beginPath();
        ctx.moveTo(-eyeW * 0.50, 0);
        ctx.quadraticCurveTo(0, eyeH * 0.75, eyeW * 0.50, -eyeH * 0.06);
        ctx.lineWidth = Math.max(2, baseR * 0.028);
        ctx.strokeStyle = strokeColor;
        ctx.stroke();

        // Heavy upper eyelid lash line (smug, half-closed look)
        ctx.beginPath();
        ctx.moveTo(-eyeW * 0.52, 0);
        ctx.quadraticCurveTo(0, -eyeH * 0.78, eyeW * 0.52, -eyeH * 0.06);
        ctx.lineWidth = Math.max(3.8, baseR * 0.052);
        ctx.strokeStyle = strokeColor;
        ctx.stroke();

        ctx.restore();
      });

      // 4. Human Nose Contour (Bridge and nostril wing)
      ctx.save();
      ctx.beginPath();
      ctx.lineWidth = Math.max(2.6, baseR * 0.034);
      ctx.strokeStyle = '#92400e';
      ctx.moveTo(baseR * 0.02, -baseR * 0.06);
      ctx.quadraticCurveTo(-baseR * 0.035, baseR * 0.08, -baseR * 0.025, baseR * 0.13);
      ctx.quadraticCurveTo(baseR * 0.07, baseR * 0.17, baseR * 0.10, baseR * 0.11);
      ctx.stroke();
      ctx.restore();

      // 5. Anatomical Smirk Mouth & Lips (Cupid's bow, full lower lip, lifted right smirk)
      const mouthY = baseR * 0.48;
      const mouthW = baseR * 0.38;
      const smirkLift = smirkEase * baseR * 0.28;

      // Lower lip fullness shadow
      ctx.save();
      ctx.beginPath();
      ctx.lineWidth = Math.max(2.5, baseR * 0.032);
      ctx.strokeStyle = 'rgba(146, 64, 14, 0.55)';
      ctx.moveTo(-mouthW * 0.50, mouthY + baseR * 0.12 - smirkLift * 0.3);
      ctx.quadraticCurveTo(mouthW * 0.10, mouthY + baseR * 0.16 - smirkLift * 0.4, mouthW * 0.60, mouthY + baseR * 0.08 - smirkLift * 0.6);
      ctx.stroke();
      ctx.restore();

      // Main smirk mouth line
      ctx.beginPath();
      ctx.lineWidth = Math.max(4.2, baseR * 0.06);
      // Left mouth corner starts lower
      ctx.moveTo(-mouthW * 0.88, mouthY + baseR * 0.04);
      // Curves with subtle center dip and curls high into right smirk
      ctx.quadraticCurveTo(-mouthW * 0.15, mouthY + baseR * 0.09, mouthW * 0.92, mouthY - smirkLift);
      ctx.stroke();

      // Smirk cheek dimple / nasolabial crease at the elevated right corner
      ctx.beginPath();
      ctx.lineWidth = Math.max(3.2, baseR * 0.044);
      ctx.moveTo(mouthW * 0.82, mouthY - smirkLift - baseR * 0.07);
      ctx.quadraticCurveTo(mouthW * 1.02, mouthY - smirkLift, mouthW * 0.88, mouthY - smirkLift + baseR * 0.09);
      ctx.stroke();

      ctx.restore();
      smirkAnimId = requestAnimationFrame(animate);
    }

    smirkAnimId = requestAnimationFrame(animate);
  }

  function triggerKnockEffect() {
    playKnockSound();
    const container = getEffectContainer();
    if (!container) return;

    if (!knockCanvas) {
      knockCanvas = document.createElement('canvas');
      knockCanvas.className = 'c2p-knock-canvas';
      knockCanvas.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483645;';
      container.appendChild(knockCanvas);
    } else if (knockCanvas.parentElement !== container) {
      container.appendChild(knockCanvas);
    }

    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    const h = window.innerHeight;
    knockCanvas.width = Math.floor(w * dpr);
    knockCanvas.height = Math.floor(h * dpr);
    const ctx = knockCanvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);

    if (knockAnimId) cancelAnimationFrame(knockAnimId);
    const startTime = performance.now();
    const knockTimes = [100, 300, 535];

    function drawRoundedRect(c, x, y, rw, rh, r) {
      if (typeof r === 'number') r = [r, r, r, r];
      const tl = r[0], tr = r[1], br = r[2], bl = r[3];
      c.beginPath();
      c.moveTo(x + tl, y);
      c.lineTo(x + rw - tr, y);
      c.arcTo(x + rw, y, x + rw, y + tr, tr);
      c.lineTo(x + rw, y + rh - br);
      c.arcTo(x + rw, y + rh, x + rw - br, y + rh, br);
      c.lineTo(x + bl, y + rh);
      c.arcTo(x, y + rh, x, y + rh - bl, bl);
      c.lineTo(x, y + tl);
      c.arcTo(x, y, x + tl, y, tl);
      c.closePath();
    }

    function animate(now) {
      const elapsed = now - startTime;
      ctx.clearRect(0, 0, w, h);

      if (elapsed > 1550) {
        if (knockCanvas) {
          knockCanvas.remove();
          knockCanvas = null;
        }
        knockAnimId = null;
        return;
      }

      // Entrance (0-90ms) & exit (1100-1500ms) fade & subtle scale
      let alpha = 1;
      let scaleMod = 1;
      if (elapsed < 90) {
        const p = Math.max(0, elapsed / 90);
        alpha = p;
        scaleMod = 0.88 + 0.12 * p;
      } else if (elapsed > 1100) {
        const p = Math.min(1, (elapsed - 1100) / 400);
        alpha = Math.max(0, 1 - p);
        scaleMod = 1 - 0.04 * p;
      }

      // Micro-shake on knock impact
      let shakeX = 0, shakeY = 0;
      for (let i = 0; i < knockTimes.length; i++) {
        const dt = elapsed - knockTimes[i];
        if (dt >= 0 && dt < 80) {
          const decay = 1 - dt / 80;
          const mag = (i === 2 ? 6 : 4) * decay;
          shakeX = Math.sin(dt * 0.4) * mag;
          shakeY = Math.cos(dt * 0.3) * (mag * 0.5);
          break;
        }
      }

      const scale = Math.max(0.7, Math.min(Math.min(w, h) / 520, 1.35)) * scaleMod;
      const doorW = 210 * scale;
      const doorH = 340 * scale;
      const doorX = (w - doorW) / 2 + shakeX;
      const doorY = (h - doorH) / 2 + shakeY;
      const impactX = doorX + doorW * 0.50;
      const impactY = doorY + doorH * 0.36;

      ctx.save();
      ctx.globalAlpha = alpha;

      // ── 1. Door Frame (outer dark wood trim) ──
      const framePadX = 14 * scale;
      const framePadTop = 14 * scale;
      const frameX = doorX - framePadX;
      const frameY = doorY - framePadTop;
      const frameW = doorW + framePadX * 2;
      const frameH = doorH + framePadTop;

      ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
      ctx.shadowBlur = 24 * scale;
      ctx.shadowOffsetY = 12 * scale;

      ctx.fillStyle = '#3e1d08';
      drawRoundedRect(ctx, frameX, frameY, frameW, frameH, [10 * scale, 10 * scale, 0, 0]);
      ctx.fill();

      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;

      ctx.strokeStyle = '#271103';
      ctx.lineWidth = 2.5 * scale;
      ctx.stroke();

      // ── 2. Door Slab (warm brown wood gradient) ──
      const doorGrad = ctx.createLinearGradient(doorX, doorY, doorX + doorW, doorY + doorH);
      doorGrad.addColorStop(0, '#965223');
      doorGrad.addColorStop(0.45, '#783a13');
      doorGrad.addColorStop(1, '#54260a');
      ctx.fillStyle = doorGrad;
      drawRoundedRect(ctx, doorX, doorY, doorW, doorH, [6 * scale, 6 * scale, 0, 0]);
      ctx.fill();
      ctx.strokeStyle = '#321303';
      ctx.lineWidth = 2 * scale;
      ctx.stroke();

      // ── 3. Four Recessed Wood Panels ──
      const panelMarginX = 16 * scale;
      const panelGapX = 12 * scale;
      const panelW = (doorW - panelMarginX * 2 - panelGapX) / 2;
      const panelMarginTop = 18 * scale;
      const panelH1 = doorH * 0.38;
      const panelGapY = 14 * scale;
      const panelH2 = doorH * 0.44;

      const panels = [
        { x: doorX + panelMarginX, y: doorY + panelMarginTop, w: panelW, h: panelH1 },
        { x: doorX + panelMarginX + panelW + panelGapX, y: doorY + panelMarginTop, w: panelW, h: panelH1 },
        { x: doorX + panelMarginX, y: doorY + panelMarginTop + panelH1 + panelGapY, w: panelW, h: panelH2 },
        { x: doorX + panelMarginX + panelW + panelGapX, y: doorY + panelMarginTop + panelH1 + panelGapY, w: panelW, h: panelH2 }
      ];

      for (let i = 0; i < panels.length; i++) {
        const p = panels[i];
        const pGrad = ctx.createLinearGradient(p.x, p.y, p.x + p.w, p.y + p.h);
        pGrad.addColorStop(0, '#5a270c');
        pGrad.addColorStop(0.5, '#6f320e');
        pGrad.addColorStop(1, '#843d14');
        ctx.fillStyle = pGrad;
        drawRoundedRect(ctx, p.x, p.y, p.w, p.h, 4 * scale);
        ctx.fill();

        // 3D beveled edges (dark inset top/left, soft highlight bottom/right)
        ctx.lineWidth = 2 * scale;
        ctx.strokeStyle = 'rgba(15, 6, 2, 0.7)';
        ctx.beginPath();
        ctx.moveTo(p.x + p.w, p.y);
        ctx.lineTo(p.x, p.y);
        ctx.lineTo(p.x, p.y + p.h);
        ctx.stroke();

        ctx.strokeStyle = 'rgba(255, 215, 185, 0.22)';
        ctx.beginPath();
        ctx.moveTo(p.x, p.y + p.h);
        ctx.lineTo(p.x + p.w, p.y + p.h);
        ctx.lineTo(p.x + p.w, p.y);
        ctx.stroke();
      }

      // ── 4. Brass Doorknob ──
      const knobX = doorX + doorW - 20 * scale;
      const knobY = doorY + doorH * 0.55;
      const knobR = 10 * scale;

      // Knob backplate
      ctx.fillStyle = '#78350f';
      drawRoundedRect(ctx, knobX - 5 * scale, knobY - 14 * scale, 10 * scale, 28 * scale, 3 * scale);
      ctx.fill();
      ctx.strokeStyle = '#451a03';
      ctx.lineWidth = 1 * scale;
      ctx.stroke();

      // Keyhole under knob
      ctx.fillStyle = '#1c0a02';
      ctx.beginPath();
      ctx.arc(knobX, knobY + 6 * scale, 1.8 * scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(knobX - 1.2 * scale, knobY + 6 * scale, 2.4 * scale, 3.5 * scale);

      // Gold / brass knob sphere
      const knobGrad = ctx.createRadialGradient(
        knobX - knobR * 0.35, knobY - knobR * 0.35, knobR * 0.1,
        knobX, knobY, knobR
      );
      knobGrad.addColorStop(0, '#fef08a');
      knobGrad.addColorStop(0.3, '#fbbf24');
      knobGrad.addColorStop(0.7, '#d97706');
      knobGrad.addColorStop(1, '#78350f');
      ctx.fillStyle = knobGrad;
      ctx.beginPath();
      ctx.arc(knobX, knobY, knobR, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#451a03';
      ctx.lineWidth = 1.2 * scale;
      ctx.stroke();

      // ── 5. Sound Effects (Ondas y efectos de sonido en cada knock) ──
      for (let i = 0; i < knockTimes.length; i++) {
        const kt = knockTimes[i];
        const dt = elapsed - kt;
        if (dt >= 0 && dt < 500) {
          const pulse = dt / 500;
          const maxArcR = (i === 2 ? 155 : 125) * scale;
          const swAlpha = Math.max(0, (1 - pulse) * (i === 2 ? 1 : 0.85));

          // a) Impact burst flash (first 80ms)
          if (dt < 80) {
            const flashP = dt / 80;
            const flashR = (10 + flashP * 12) * scale;
            const fAlpha = (1 - flashP) * swAlpha;
            ctx.save();
            ctx.fillStyle = `rgba(255, 255, 255, ${fAlpha * 0.9})`;
            ctx.beginPath();
            ctx.arc(impactX, impactY, flashR * 0.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = `rgba(254, 240, 138, ${fAlpha * 0.5})`;
            ctx.beginPath();
            ctx.arc(impactX, impactY, flashR, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          }

          // b) Acoustic sound wave arcs (((( • ))))
          const arcR1 = pulse * maxArcR;
          ctx.save();
          ctx.lineCap = 'round';

          if (arcR1 > 12 * scale) {
            ctx.lineWidth = 4 * (1 - pulse * 0.6) * scale;
            ctx.strokeStyle = `rgba(253, 224, 71, ${swAlpha * 0.95})`;
            // Right acoustic arc
            ctx.beginPath();
            ctx.arc(impactX, impactY, arcR1, -Math.PI * 0.28, Math.PI * 0.28);
            ctx.stroke();
            // Left acoustic arc
            ctx.beginPath();
            ctx.arc(impactX, impactY, arcR1, Math.PI * 0.72, Math.PI * 1.28);
            ctx.stroke();
          }

          // Secondary trailing acoustic arcs
          if (pulse > 0.15) {
            const p2 = (pulse - 0.15) / 0.85;
            const arcR2 = p2 * maxArcR * 0.75;
            if (arcR2 > 10 * scale) {
              ctx.lineWidth = 3 * (1 - p2 * 0.5) * scale;
              ctx.strokeStyle = `rgba(254, 240, 138, ${swAlpha * 0.75})`;
              ctx.beginPath();
              ctx.arc(impactX, impactY, arcR2, -Math.PI * 0.26, Math.PI * 0.26);
              ctx.stroke();
              ctx.beginPath();
              ctx.arc(impactX, impactY, arcR2, Math.PI * 0.74, Math.PI * 1.26);
              ctx.stroke();
            }
          }

          // Subtle concentric circular ripple ring
          ctx.lineWidth = 2 * (1 - pulse * 0.7) * scale;
          ctx.strokeStyle = `rgba(250, 204, 21, ${swAlpha * 0.35})`;
          ctx.beginPath();
          ctx.arc(impactX, impactY, arcR1 * 0.95, 0, Math.PI * 2);
          ctx.stroke();

          ctx.restore();
        }
      }

      ctx.restore();

      knockAnimId = requestAnimationFrame(animate);
    }

    knockAnimId = requestAnimationFrame(animate);
  }

  function triggerSheepEffect() {
    const container = getEffectContainer();
    if (!container) return;

    if (!sheepCanvas) {
      sheepCanvas = document.createElement('canvas');
      sheepCanvas.className = 'c2p-sheep-canvas';
      sheepCanvas.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483645;';
      container.appendChild(sheepCanvas);
    } else if (sheepCanvas.parentElement !== container) {
      container.appendChild(sheepCanvas);
    }

    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    const h = window.innerHeight;
    sheepCanvas.width = Math.floor(w * dpr);
    sheepCanvas.height = Math.floor(h * dpr);
    const ctx = sheepCanvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);

    if (sheepAnimId) cancelAnimationFrame(sheepAnimId);
    const startTime = performance.now();
    const DURATION = 4200;

    const sparkles = [
      { relX: -0.28, relY: -0.32, size: 14, delay: 600, speed: 0.005 },
      { relX: 0.26, relY: -0.36, size: 18, delay: 800, speed: 0.004 },
      { relX: -0.36, relY: -0.15, size: 12, delay: 1100, speed: 0.006 },
      { relX: 0.35, relY: -0.12, size: 15, delay: 950, speed: 0.005 },
      { relX: -0.14, relY: -0.42, size: 22, delay: 1200, speed: 0.0035 },
      { relX: 0.12, relY: -0.45, size: 16, delay: 1400, speed: 0.0045 },
      { relX: -0.05, relY: -0.25, size: 13, delay: 1600, speed: 0.0055 },
      { relX: 0.28, relY: 0.05, size: 11, delay: 1300, speed: 0.005 }
    ];

    function drawDiamondSparkle(c, x, y, radius, alpha, rot) {
      if (alpha <= 0) return;
      c.save();
      c.translate(x, y);
      c.rotate(rot);
      c.globalAlpha *= alpha;

      const radGrad = c.createRadialGradient(0, 0, radius * 0.1, 0, 0, radius * 1.5);
      radGrad.addColorStop(0, 'rgba(255, 245, 180, 0.9)');
      radGrad.addColorStop(0.4, 'rgba(255, 215, 0, 0.4)');
      radGrad.addColorStop(1, 'rgba(255, 215, 0, 0)');
      c.fillStyle = radGrad;
      c.beginPath();
      c.arc(0, 0, radius * 1.5, 0, Math.PI * 2);
      c.fill();

      c.fillStyle = '#ffffff';
      c.beginPath();
      for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 2;
        const cos = Math.cos(a);
        const sin = Math.sin(a);
        const nextA = a + Math.PI / 4;
        const innerR = radius * 0.22;
        if (i === 0) c.moveTo(cos * radius, sin * radius);
        else c.lineTo(cos * radius, sin * radius);
        c.lineTo(Math.cos(nextA) * innerR, Math.sin(nextA) * innerR);
      }
      c.closePath();
      c.fill();

      c.restore();
    }

    function animate(now) {
      const elapsed = now - startTime;
      ctx.clearRect(0, 0, w, h);

      if (elapsed >= DURATION) {
        if (sheepCanvas) {
          sheepCanvas.remove();
          sheepCanvas = null;
        }
        sheepAnimId = null;
        return;
      }

      let alpha = 1;
      let entranceScale = 1;
      let slideY = 0;

      if (elapsed < 500) {
        const p = elapsed / 500;
        const bounce = 1 + 1.2 * Math.pow(p - 1, 3) + 0.6 * Math.pow(p - 1, 2);
        entranceScale = 0.5 + 0.5 * bounce;
        alpha = Math.min(1, p * 2.2);
        slideY = (1 - p) * 90;
      } else if (elapsed > 3400) {
        const p = (elapsed - 3400) / 800;
        alpha = Math.max(0, 1 - p);
        slideY = Math.pow(p, 2) * 60;
      }

      const tiltP = Math.min(1, Math.max(0, (elapsed - 400) / 950));
      const tiltEase = (1 - Math.cos(tiltP * Math.PI)) / 2;
      const tiltAngle = -0.09 * tiltEase;

      const floatY = Math.sin(elapsed * 0.0032) * 6;
      const breathY = Math.sin(elapsed * 0.004) * 0.015;
      const breathX = -breathY * 0.5;

      const targetH = Math.min(h * 0.46, 340);
      const imgAspect = 158 / 198;
      const imgW = targetH * imgAspect;
      const imgH = targetH;

      const cx = w * 0.5;
      const cy = h * 0.48 + slideY + floatY;

      ctx.save();
      ctx.globalAlpha = alpha;

      // ── 1. Divine Aura & Sunburst Rays behind the Lamb ──
      if (elapsed > 200) {
        const auraP = Math.min(1, (elapsed - 200) / 700);
        const auraAlpha = auraP * (elapsed > 3400 ? alpha : 1);
        const auraRadius = targetH * 0.95;
        const rayRot = elapsed * 0.00035;

        ctx.save();
        ctx.translate(cx, cy - targetH * 0.12);
        ctx.globalAlpha = auraAlpha * 0.75;

        const radialGlow = ctx.createRadialGradient(0, 0, auraRadius * 0.15, 0, 0, auraRadius);
        radialGlow.addColorStop(0, 'rgba(255, 240, 170, 0.40)');
        radialGlow.addColorStop(0.45, 'rgba(255, 205, 60, 0.18)');
        radialGlow.addColorStop(1, 'rgba(255, 190, 0, 0)');
        ctx.fillStyle = radialGlow;
        ctx.beginPath();
        ctx.arc(0, 0, auraRadius, 0, Math.PI * 2);
        ctx.fill();

        const numRays = 14;
        for (let i = 0; i < numRays; i++) {
          const angle = rayRot + (i * Math.PI * 2) / numRays;
          const halfW = (Math.PI * 2) / (numRays * 4);
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.arc(0, 0, auraRadius * 1.15, angle - halfW, angle + halfW);
          ctx.closePath();
          const rayGrad = ctx.createRadialGradient(0, 0, auraRadius * 0.1, 0, 0, auraRadius * 1.15);
          rayGrad.addColorStop(0, 'rgba(255, 230, 120, 0.35)');
          rayGrad.addColorStop(0.6, 'rgba(255, 200, 50, 0.12)');
          rayGrad.addColorStop(1, 'rgba(255, 180, 0, 0)');
          ctx.fillStyle = rayGrad;
          ctx.fill();
        }
        ctx.restore();
      }

      // ── 2. The Superior Sheep Illustration ──
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(entranceScale * (1 + breathX), entranceScale * (1 + breathY));
      ctx.rotate(tiltAngle);

      ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
      ctx.shadowBlur = 28;
      ctx.shadowOffsetY = 14;

      if (sheepImg.complete && sheepImg.naturalWidth > 0) {
        ctx.drawImage(sheepImg, -imgW * 0.5, -imgH * 0.5, imgW, imgH);
      }
      ctx.restore();

      // ── 3. Sparkling Glints & Stars of Superiority ──
      if (elapsed > 450) {
        sparkles.forEach(sp => {
          const spTime = elapsed - sp.delay;
          if (spTime > 0) {
            const loop = (spTime * sp.speed) % (Math.PI * 2);
            const spAlpha = Math.max(0, Math.sin(loop));
            const currentR = sp.size * (0.6 + 0.4 * Math.sin(loop));
            const spX = cx + sp.relX * targetH;
            const spY = cy + sp.relY * targetH + floatY;
            drawDiamondSparkle(ctx, spX, spY, currentR, spAlpha, loop * 0.5);
          }
        });
      }


      ctx.restore();
      sheepAnimId = requestAnimationFrame(animate);
    }

    sheepAnimId = requestAnimationFrame(animate);
  }

  function triggerEyebrowEffect() {
    const container = getEffectContainer();
    if (!container) return;

    if (!eyebrowCanvas) {
      eyebrowCanvas = document.createElement('canvas');
      eyebrowCanvas.className = 'c2p-eyebrow-canvas';
      eyebrowCanvas.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483645;';
      container.appendChild(eyebrowCanvas);
    } else if (eyebrowCanvas.parentElement !== container) {
      container.appendChild(eyebrowCanvas);
    }

    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    const h = window.innerHeight;
    eyebrowCanvas.width = Math.floor(w * dpr);
    eyebrowCanvas.height = Math.floor(h * dpr);
    const ctx = eyebrowCanvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);

    if (eyebrowAnimId) cancelAnimationFrame(eyebrowAnimId);
    const startTime = performance.now();
    const DURATION = 4200;

    const sparkles = [
      { relX: 0.24, relY: -0.16, size: 16, delay: 700, speed: 0.0045 },  // On the raised eyebrow!
      { relX: 0.12, relY: -0.47, size: 18, delay: 850, speed: 0.004 },   // On bald sheen!
      { relX: -0.15, relY: -0.48, size: 14, delay: 600, speed: 0.005 },  // Above head left
      { relX: 0.32, relY: -0.42, size: 15, delay: 1000, speed: 0.004 },  // Above head right
      { relX: -0.36, relY: -0.15, size: 13, delay: 1100, speed: 0.0055 },// Left aura
      { relX: 0.38, relY: 0.02, size: 15, delay: 950, speed: 0.005 },    // Right aura
      { relX: -0.32, relY: 0.18, size: 12, delay: 1300, speed: 0.006 },  // Lower left aura
      { relX: 0.32, relY: 0.25, size: 12, delay: 1400, speed: 0.005 }    // Lower right aura
    ];

    function drawDiamondSparkle(c, x, y, radius, alpha, rot) {
      if (alpha <= 0) return;
      c.save();
      c.translate(x, y);
      c.rotate(rot);
      c.globalAlpha *= alpha;

      const radGrad = c.createRadialGradient(0, 0, radius * 0.1, 0, 0, radius * 1.5);
      radGrad.addColorStop(0, 'rgba(255, 245, 180, 0.9)');
      radGrad.addColorStop(0.4, 'rgba(255, 215, 0, 0.4)');
      radGrad.addColorStop(1, 'rgba(255, 215, 0, 0)');
      c.fillStyle = radGrad;
      c.beginPath();
      c.arc(0, 0, radius * 1.5, 0, Math.PI * 2);
      c.fill();

      c.fillStyle = '#ffffff';
      c.beginPath();
      for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 2;
        const cos = Math.cos(a);
        const sin = Math.sin(a);
        const nextA = a + Math.PI / 4;
        const innerR = radius * 0.22;
        if (i === 0) c.moveTo(cos * radius, sin * radius);
        else c.lineTo(cos * radius, sin * radius);
        c.lineTo(Math.cos(nextA) * innerR, Math.sin(nextA) * innerR);
      }
      c.closePath();
      c.fill();

      c.restore();
    }

    function animate(now) {
      const elapsed = now - startTime;
      ctx.clearRect(0, 0, w, h);

      if (elapsed >= DURATION) {
        if (eyebrowCanvas) {
          eyebrowCanvas.remove();
          eyebrowCanvas = null;
        }
        eyebrowAnimId = null;
        return;
      }

      let alpha = 1;
      let entranceScale = 1;
      let slideY = 0;

      if (elapsed < 500) {
        const p = elapsed / 500;
        const bounce = 1 + 1.2 * Math.pow(p - 1, 3) + 0.6 * Math.pow(p - 1, 2);
        entranceScale = 0.5 + 0.5 * bounce;
        alpha = Math.min(1, p * 2.2);
        slideY = (1 - p) * 90;
      } else if (elapsed > 3400) {
        const p = (elapsed - 3400) / 800;
        alpha = Math.max(0, 1 - p);
        slideY = Math.pow(p, 2) * 60;
      }

      const tiltP = Math.min(1, Math.max(0, (elapsed - 400) / 950));
      const tiltEase = (1 - Math.cos(tiltP * Math.PI)) / 2;
      const tiltAngle = -0.08 * tiltEase;

      const floatY = Math.sin(elapsed * 0.0032) * 6;
      const breathY = Math.sin(elapsed * 0.004) * 0.015;
      const breathX = -breathY * 0.5;

      const targetH = Math.min(h * 0.52, 380);
      const imgAspect = 652 / 946;
      const imgW = targetH * imgAspect;
      const imgH = targetH;

      const cx = w * 0.5;
      const cy = h * 0.50 + slideY + floatY;

      ctx.save();
      ctx.globalAlpha = alpha;

      // ── 1. Divine Aura & Sunburst Rays behind The Rock ──
      if (elapsed > 200) {
        const auraP = Math.min(1, (elapsed - 200) / 700);
        const auraAlpha = auraP * (elapsed > 3400 ? alpha : 1);
        const auraRadius = targetH * 0.88;
        const rayRot = elapsed * 0.00035;

        ctx.save();
        ctx.translate(cx, cy - targetH * 0.15);
        ctx.globalAlpha = auraAlpha * 0.75;

        const radialGlow = ctx.createRadialGradient(0, 0, auraRadius * 0.15, 0, 0, auraRadius);
        radialGlow.addColorStop(0, 'rgba(255, 240, 170, 0.40)');
        radialGlow.addColorStop(0.45, 'rgba(255, 205, 60, 0.18)');
        radialGlow.addColorStop(1, 'rgba(255, 190, 0, 0)');
        ctx.fillStyle = radialGlow;
        ctx.beginPath();
        ctx.arc(0, 0, auraRadius, 0, Math.PI * 2);
        ctx.fill();

        const numRays = 14;
        for (let i = 0; i < numRays; i++) {
          const angle = rayRot + (i * Math.PI * 2) / numRays;
          const halfW = (Math.PI * 2) / (numRays * 4);
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.arc(0, 0, auraRadius * 1.15, angle - halfW, angle + halfW);
          ctx.closePath();
          const rayGrad = ctx.createRadialGradient(0, 0, auraRadius * 0.1, 0, 0, auraRadius * 1.15);
          rayGrad.addColorStop(0, 'rgba(255, 230, 120, 0.35)');
          rayGrad.addColorStop(0.6, 'rgba(255, 200, 50, 0.12)');
          rayGrad.addColorStop(1, 'rgba(255, 180, 0, 0)');
          ctx.fillStyle = rayGrad;
          ctx.fill();
        }
        ctx.restore();
      }

      // ── 2. The Rock Eyebrow Illustration ──
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(entranceScale * (1 + breathX), entranceScale * (1 + breathY));
      ctx.rotate(tiltAngle);

      ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
      ctx.shadowBlur = 28;
      ctx.shadowOffsetY = 14;

      if (eyebrowImg.complete && eyebrowImg.naturalWidth > 0) {
        ctx.drawImage(eyebrowImg, -imgW * 0.5, -imgH * 0.5, imgW, imgH);
      }
      ctx.restore();

      // ── 3. Sparkling Glints & Stars of Superiority ──
      if (elapsed > 450) {
        sparkles.forEach(sp => {
          const spTime = elapsed - sp.delay;
          if (spTime > 0) {
            const loop = (spTime * sp.speed) % (Math.PI * 2);
            const spAlpha = Math.max(0, Math.sin(loop));
            const currentR = sp.size * (0.6 + 0.4 * Math.sin(loop));
            const spX = cx + sp.relX * targetH;
            const spY = cy + sp.relY * targetH + floatY;
            drawDiamondSparkle(ctx, spX, spY, currentR, spAlpha, loop * 0.5);
          }
        });
      }

      ctx.restore();
      eyebrowAnimId = requestAnimationFrame(animate);
    }

    eyebrowAnimId = requestAnimationFrame(animate);
  }
  function triggerDisgustedEffect() {
    const container = getEffectContainer();
    if (!container) return;

    if (!disgustedCanvas) {
      disgustedCanvas = document.createElement('canvas');
      disgustedCanvas.className = 'c2p-disgusted-canvas';
      disgustedCanvas.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483645;';
      container.appendChild(disgustedCanvas);
    } else if (disgustedCanvas.parentElement !== container) {
      container.appendChild(disgustedCanvas);
    }

    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    const h = window.innerHeight;
    disgustedCanvas.width = Math.floor(w * dpr);
    disgustedCanvas.height = Math.floor(h * dpr);
    const ctx = disgustedCanvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);

    if (disgustedAnimId) cancelAnimationFrame(disgustedAnimId);
    const startTime = performance.now();
    const DURATION = 4200;

    const bubbles = [
      { relX: -0.32, relY: -0.25, r: 9, speed: 0.04, wobbleSpeed: 0.005, phase: 0 },
      { relX: 0.35, relY: -0.28, r: 11, speed: 0.035, wobbleSpeed: 0.004, phase: 1.5 },
      { relX: -0.18, relY: -0.48, r: 7.5, speed: 0.045, wobbleSpeed: 0.006, phase: 3.0 },
      { relX: 0.22, relY: -0.44, r: 8.5, speed: 0.038, wobbleSpeed: 0.005, phase: 4.5 },
      { relX: -0.42, relY: -0.05, r: 10, speed: 0.032, wobbleSpeed: 0.0045, phase: 2.1 },
      { relX: 0.44, relY: 0.02, r: 8, speed: 0.042, wobbleSpeed: 0.0055, phase: 5.2 },
      { relX: -0.05, relY: -0.55, r: 6.5, speed: 0.048, wobbleSpeed: 0.007, phase: 0.8 },
      { relX: 0.12, relY: -0.58, r: 7, speed: 0.04, wobbleSpeed: 0.006, phase: 3.7 }
    ];

    const wisps = [
      { relX: -0.28, relY: -0.15, height: 110, waveSpeed: 0.004, phase: 1.2 },
      { relX: 0.32, relY: -0.10, height: 125, waveSpeed: 0.0045, phase: 2.5 },
      { relX: -0.10, relY: -0.42, height: 95, waveSpeed: 0.005, phase: 0.4 },
      { relX: 0.15, relY: -0.45, height: 105, waveSpeed: 0.0042, phase: 3.1 },
      { relX: -0.40, relY: 0.05, height: 90, waveSpeed: 0.0048, phase: 4.2 },
      { relX: 0.42, relY: 0.08, height: 95, waveSpeed: 0.0046, phase: 1.8 }
    ];

    function drawStenchWisp(c, x, y, height, phase, alpha) {
      if (alpha <= 0) return;
      c.save();
      c.strokeStyle = 'rgba(135, 220, 65, ' + (alpha * 0.75) + ')';
      c.lineWidth = 3.5;
      c.lineCap = 'round';
      c.beginPath();
      const segments = 16;
      for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const py = y - t * height;
        const px = x + Math.sin(phase + t * Math.PI * 3) * (8 + t * 10);
        if (i === 0) c.moveTo(px, py);
        else c.lineTo(px, py);
      }
      c.stroke();

      c.strokeStyle = 'rgba(210, 255, 150, ' + (alpha * 0.9) + ')';
      c.lineWidth = 1.5;
      c.stroke();
      c.restore();
    }

    function drawDisgustBubble(c, x, y, radius, alpha) {
      if (alpha <= 0) return;
      c.save();
      c.globalAlpha = alpha;
      const grad = c.createRadialGradient(x - radius * 0.3, y - radius * 0.3, radius * 0.1, x, y, radius);
      grad.addColorStop(0, 'rgba(215, 255, 140, 0.85)');
      grad.addColorStop(0.5, 'rgba(110, 205, 50, 0.55)');
      grad.addColorStop(0.9, 'rgba(60, 140, 40, 0.8)');
      grad.addColorStop(1, 'rgba(30, 90, 20, 0.2)');
      c.fillStyle = grad;
      c.beginPath();
      c.arc(x, y, radius, 0, Math.PI * 2);
      c.fill();

      c.fillStyle = 'rgba(255, 255, 255, 0.7)';
      c.beginPath();
      c.arc(x - radius * 0.35, y - radius * 0.35, radius * 0.22, 0, Math.PI * 2);
      c.fill();
      c.restore();
    }

    function drawSweatDrop(c, x, y, size, alpha) {
      if (alpha <= 0) return;
      c.save();
      c.translate(x, y);
      c.rotate(-0.15);
      c.globalAlpha = alpha;

      c.fillStyle = 'rgba(150, 225, 255, 0.85)';
      c.strokeStyle = 'rgba(40, 100, 160, 0.6)';
      c.lineWidth = 1.5;

      c.beginPath();
      c.moveTo(0, -size);
      c.bezierCurveTo(size * 0.8, -size * 0.3, size * 0.85, size * 0.7, 0, size);
      c.bezierCurveTo(-size * 0.85, size * 0.7, -size * 0.8, -size * 0.3, 0, -size);
      c.closePath();
      c.fill();
      c.stroke();

      c.fillStyle = '#ffffff';
      c.beginPath();
      c.ellipse(-size * 0.28, size * 0.2, size * 0.2, size * 0.35, Math.PI / 6, 0, Math.PI * 2);
      c.fill();
      c.restore();
    }

    function animate(now) {
      const elapsed = now - startTime;
      ctx.clearRect(0, 0, w, h);

      if (elapsed >= DURATION) {
        if (disgustedCanvas) {
          disgustedCanvas.remove();
          disgustedCanvas = null;
        }
        disgustedAnimId = null;
        return;
      }

      let alpha = 1;
      let recoilEase = 1;
      let slideY = 0;
      let entranceScale = 1;

      if (elapsed < 500) {
        const p = elapsed / 500;
        recoilEase = 1 - Math.pow(1 - p, 3);
        slideY = (1 - recoilEase) * 60;
        entranceScale = 1.08 - 0.08 * recoilEase;
        alpha = Math.min(1, p * 2.2);
      } else if (elapsed > 3400) {
        const p = (elapsed - 3400) / 800;
        alpha = Math.max(0, 1 - p);
        slideY = Math.pow(p, 2) * 50;
      }

      const shudderEnvelope = elapsed > 3400 ? (1 - (elapsed - 3400) / 800) : Math.min(1, elapsed / 300);
      const shudderWave = 0.6 + 0.4 * Math.sin((elapsed * 0.007) % (Math.PI * 2));
      const shudderAmp = 2.4 * shudderEnvelope * shudderWave;
      const shudderX = Math.sin(elapsed * 0.058) * shudderAmp;
      const shudderY = Math.cos(elapsed * 0.068) * (shudderAmp * 0.55);
      const tiltAngle = 0.045 * recoilEase;

      const queasySway = Math.sin(elapsed * 0.0035) * 5;
      const breath = Math.sin(elapsed * 0.004) * 0.012;

      const targetH = Math.min(h * 0.54, 390);
      const imgAspect = 748 / 803;
      const imgW = targetH * imgAspect;
      const imgH = targetH;

      const cx = w * 0.5;
      const cy = h * 0.52 + slideY + queasySway;

      ctx.save();
      ctx.globalAlpha = alpha;

      // ── 1. Sickly Murky Miasma Aura (behind character) ──
      if (elapsed > 150) {
        const miasmaAlpha = Math.min(1, (elapsed - 150) / 600) * alpha;
        const pulse = 1 + 0.04 * Math.sin(elapsed * 0.003);
        const auraRadius = targetH * 0.85 * pulse;

        ctx.save();
        ctx.translate(cx, cy - targetH * 0.05);
        ctx.globalAlpha = miasmaAlpha * 0.85;

        const radialGlow = ctx.createRadialGradient(0, 0, auraRadius * 0.15, 0, 0, auraRadius);
        radialGlow.addColorStop(0, 'rgba(110, 215, 60, 0.32)');
        radialGlow.addColorStop(0.35, 'rgba(80, 185, 70, 0.18)');
        radialGlow.addColorStop(0.7, 'rgba(120, 60, 170, 0.10)');
        radialGlow.addColorStop(1, 'rgba(30, 20, 50, 0)');
        ctx.fillStyle = radialGlow;
        ctx.beginPath();
        ctx.arc(0, 0, auraRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // ── 2. Wavy Stench Wisps (fumes of disgust) ──
      if (elapsed > 250) {
        const wispAlpha = Math.min(1, (elapsed - 250) / 600) * alpha;
        wisps.forEach(ws => {
          const wispY = cy + ws.relY * targetH - (elapsed * 0.02) % 30;
          const wispX = cx + ws.relX * targetH;
          const wavePhase = ws.phase + elapsed * ws.waveSpeed;
          drawStenchWisp(ctx, wispX, wispY, ws.height, wavePhase, wispAlpha);
        });
      }

      // ── 3. Floating Noxious Bubbles ──
      if (elapsed > 300) {
        const bubbleAlpha = Math.min(1, (elapsed - 300) / 500) * alpha;
        bubbles.forEach(b => {
          const bubbleRise = (elapsed * b.speed) % (targetH * 0.85);
          const bx = cx + b.relX * targetH + Math.sin(elapsed * b.wobbleSpeed + b.phase) * 12;
          const by = cy + b.relY * targetH - bubbleRise;
          const bLife = 1 - bubbleRise / (targetH * 0.85);
          drawDisgustBubble(ctx, bx, by, b.r * (0.8 + 0.2 * bLife), bubbleAlpha * Math.min(1, bLife * 2));
        });
      }

      // ── 4. Disgusted Character Illustration ──
      ctx.save();
      ctx.translate(cx + shudderX, cy + shudderY);
      ctx.scale(entranceScale * (1 - breath), entranceScale * (1 + breath));
      ctx.rotate(tiltAngle);

      ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
      ctx.shadowBlur = 24;
      ctx.shadowOffsetY = 12;

      if (disgustedImg.complete && disgustedImg.naturalWidth > 0) {
        ctx.drawImage(disgustedImg, -imgW * 0.5, -imgH * 0.5, imgW, imgH);
      }

      // ── 5. Manga/Comic Disgust Gloom Hatching (forehead lines of despair) ──
      if (elapsed > 400) {
        const gloomAlpha = Math.min(0.38, (elapsed - 400) / 600 * 0.38) * alpha;
        ctx.strokeStyle = 'rgba(90, 50, 160, ' + gloomAlpha + ')';
        ctx.lineWidth = 2.2;
        ctx.lineCap = 'round';
        const hatchStartX = -targetH * 0.08;
        const hatchStartY = -targetH * 0.50;
        const hatchW = targetH * 0.30;
        const hatchH = targetH * 0.18;
        for (let i = 0; i < 7; i++) {
          const hx = hatchStartX + (i / 6) * hatchW;
          ctx.beginPath();
          ctx.moveTo(hx, hatchStartY);
          ctx.lineTo(hx - 6, hatchStartY + hatchH * (0.6 + 0.4 * Math.sin(i * 1.3)));
          ctx.stroke();
        }
      }

      ctx.restore();

      // ── 6. Cold Sweat Drop (on left temple near hairline) ──
      if (elapsed > 500) {
        const sweatAlpha = Math.min(1, (elapsed - 500) / 500) * alpha;
        const sweatDrip = Math.min(10, Math.max(0, (elapsed - 700) * 0.006));
        const sweatX = cx + shudderX - targetH * 0.15;
        const sweatY = cy + shudderY - targetH * 0.23 + sweatDrip;
        drawSweatDrop(ctx, sweatX, sweatY, 13, sweatAlpha);
      }

      ctx.restore();
      disgustedAnimId = requestAnimationFrame(animate);
    }

    disgustedAnimId = requestAnimationFrame(animate);
  }

  function sendEffect(effectId) {
    if (effectId !== 'tomato' && effectCooldown) {
      displaySystemMessage('Wait to send another effect.', 'clock');
      return;
    }
    if (!dataChannel || dataChannel.readyState !== 'open') return;

    if (effectId === 'celebration') {
      dataChannel.send(JSON.stringify({ type: 'effect', name: 'celebration' }));
      triggerCelebrationEffect();
      displaySystemMessage('You sent a celebration.', 'party');
      startEffectCooldown();
    } else if (effectId === 'fireworks') {
      dataChannel.send(JSON.stringify({ type: 'effect', name: 'fireworks' }));
      triggerFireworksEffect();
      displaySystemMessage('You sent fireworks.', 'fireworks');
      startEffectCooldown();
    } else if (effectId === 'tomato') {
      dataChannel.send(JSON.stringify({ type: 'effect', name: 'tomato' }));
      triggerTomatoEffect();
      displaySystemMessage('You sent a tomato splat.', 'tomato');
    } else if (effectId === 'dance') {
      dataChannel.send(JSON.stringify({ type: 'effect', name: 'dance' }));
      triggerDanceEffect();
      displaySystemMessage('You sent a dance.', 'dance');
      startEffectCooldown();
    } else if (effectId === 'stare') {
      dataChannel.send(JSON.stringify({ type: 'effect', name: 'stare' }));
      triggerStareEffect();
      displaySystemMessage('You sent a stare.', 'stare');
      startEffectCooldown();
    } else if (effectId === 'smirk') {
      dataChannel.send(JSON.stringify({ type: 'effect', name: 'smirk' }));
      triggerSmirkEffect();
      displaySystemMessage('You sent a smirk.', 'smirk');
      startEffectCooldown();
    } else if (effectId === 'knock') {
      dataChannel.send(JSON.stringify({ type: 'effect', name: 'knock' }));
      triggerKnockEffect();
      displaySystemMessage('You sent a knock.', 'knock');
      startEffectCooldown();
    } else if (effectId === 'sheep') {
      dataChannel.send(JSON.stringify({ type: 'effect', name: 'sheep' }));
      triggerSheepEffect();
      displaySystemMessage('You sent a sheep.', 'sheep');
      startEffectCooldown();
    } else if (effectId === 'eyebrow') {
      dataChannel.send(JSON.stringify({ type: 'effect', name: 'eyebrow' }));
      triggerEyebrowEffect();
      displaySystemMessage('You sent an eyebrow.', 'eyebrow');
      startEffectCooldown();
    } else if (effectId === 'disgusted') {
      dataChannel.send(JSON.stringify({ type: 'effect', name: 'disgusted' }));
      triggerDisgustedEffect();
      displaySystemMessage('You sent disgusted.', 'disgusted');
      startEffectCooldown();
    }
  }

  function handleIncomingEffect(effectName) {
    if (!sidebarVisible) toggleSidebar();
    if (effectName === 'celebration') {
      triggerCelebrationEffect();
      displaySystemMessage('Peer sent you a celebration!', 'party');
    } else if (effectName === 'fireworks') {
      triggerFireworksEffect();
      displaySystemMessage('Peer sent you fireworks!', 'fireworks');
    } else if (effectName === 'tomato') {
      triggerTomatoEffect();
      displaySystemMessage('Peer sent you a tomato splat!', 'tomato');
    } else if (effectName === 'dance') {
      triggerDanceEffect();
      displaySystemMessage('Peer sent you a dance!', 'dance');
    } else if (effectName === 'stare') {
      triggerStareEffect();
      displaySystemMessage('Peer sent you a stare!', 'stare');
    } else if (effectName === 'smirk') {
      triggerSmirkEffect();
      displaySystemMessage('Peer sent you a smirk!', 'smirk');
    } else if (effectName === 'knock') {
      triggerKnockEffect();
      displaySystemMessage('Peer sent you a knock!', 'knock');
    } else if (effectName === 'sheep' || effectName === 'superior') {
      triggerSheepEffect();
      displaySystemMessage('Peer sent you a sheep!', 'sheep');
    } else if (effectName === 'eyebrow') {
      triggerEyebrowEffect();
      displaySystemMessage('Peer sent you an eyebrow!', 'eyebrow');
    } else if (effectName === 'disgusted') {
      triggerDisgustedEffect();
      displaySystemMessage('Peer sent you disgusted!', 'disgusted');
    }
  }

  // ── Voice Notes ──
  async function startRecording() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      displaySystemMessage('Microphone API not supported in this browser.', 'warn');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeTypes = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
      const mimeType = mimeTypes.find(m => {
        try { return MediaRecorder.isTypeSupported(m); } catch(e) { return false; }
      }) || '';
      mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      audioChunks = [];
      mediaRecorder.ondataavailable = e => { if (e.data.size > 0) audioChunks.push(e.data); };

      recordStartTime = Date.now();
      const recBar = document.getElementById('c2p-recording-bar');
      const timerEl = document.getElementById('c2p-record-timer');
      const inputEl = document.getElementById('c2p-msg-input');
      const micBtn = document.getElementById('c2p-mic-btn');
      const gifBtn = document.getElementById('c2p-gif-btn');
      const sendBtn = document.getElementById('c2p-send-btn');

      if (recBar) recBar.style.display = 'flex';
      if (inputEl) inputEl.style.display = 'none';
      if (micBtn) micBtn.style.display = 'none';
      if (gifBtn) gifBtn.style.display = 'none';
      if (sendBtn) sendBtn.style.display = 'none';

      recordTimerInterval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - recordStartTime) / 1000);
        const m = Math.floor(elapsed / 60);
        const s = elapsed % 60;
        if (timerEl) timerEl.textContent = `${m}:${s < 10 ? '0' : ''}${s}`;
      }, 500);

      mediaRecorder.start(200);
    } catch(err) {
      console.error('[C2P] Microphone access error:', err);
      displaySystemMessage('Could not access microphone. Please grant permission.', 'warn');
      resetRecordingUI();
    }
  }

  function resetRecordingUI() {
    if (recordTimerInterval) { clearInterval(recordTimerInterval); recordTimerInterval = null; }
    const recBar = document.getElementById('c2p-recording-bar');
    const timerEl = document.getElementById('c2p-record-timer');
    const inputEl = document.getElementById('c2p-msg-input');
    const micBtn = document.getElementById('c2p-mic-btn');
    const gifBtn = document.getElementById('c2p-gif-btn');
    const sendBtn = document.getElementById('c2p-send-btn');
    if (recBar) recBar.style.display = 'none';
    if (timerEl) timerEl.textContent = '0:00';
    if (inputEl) inputEl.style.display = '';
    if (micBtn) micBtn.style.display = '';
    if (gifBtn) gifBtn.style.display = '';
    if (sendBtn) sendBtn.style.display = '';
  }

  function cancelRecording() {
    resetRecordingUI();
    if (mediaRecorder) {
      try {
        mediaRecorder.onstop = null;
        mediaRecorder.stop();
        mediaRecorder.stream?.getTracks().forEach(t => t.stop());
      } catch(e){}
      mediaRecorder = null;
      audioChunks = [];
    }
  }

  function finishAndSendRecording() {
    const duration = Math.max(1, Number(((Date.now() - recordStartTime) / 1000).toFixed(1)));
    resetRecordingUI();
    if (!mediaRecorder) return;
    const rec = mediaRecorder;
    rec.onstop = () => {
      const mime = rec.mimeType || 'audio/webm';
      const audioBlob = new Blob(audioChunks, { type: mime });
      rec.stream?.getTracks().forEach(t => t.stop());
      mediaRecorder = null;
      audioChunks = [];
      if (audioBlob.size > 0) {
        sendAudioBlob(audioBlob, duration);
      }
    };
    try { rec.stop(); } catch(e){}
  }

  function sendAudioBlob(blob, duration) {
    const localUrl = URL.createObjectURL(blob);
    displayAudioMessage(localUrl, 'sent', duration);

    const reader = new FileReader();
    reader.onloadend = () => {
      const base64Data = reader.result;
      const CHUNK_SIZE = 16384;
      const totalChunks = Math.ceil(base64Data.length / CHUNK_SIZE);
      const audioId = 'aud_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);

      for (let i = 0; i < totalChunks; i++) {
        const chunk = base64Data.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
        if (dataChannel?.readyState === 'open') {
          dataChannel.send(JSON.stringify({
            type: 'audio_chunk',
            id: audioId,
            index: i,
            total: totalChunks,
            chunk: chunk,
            duration: duration
          }));
        }
      }
    };
    reader.readAsDataURL(blob);
  }

  function dataUrlToBlob(dataUrl) {
    try {
      if (!dataUrl || typeof dataUrl !== 'string') return null;
      const commaIdx = dataUrl.indexOf(',');
      if (commaIdx === -1) return null;
      const header = dataUrl.slice(0, commaIdx);
      const mime = header.replace(/^data:/, '').replace(/;base64$/, '') || 'audio/webm';
      const bstr = atob(dataUrl.slice(commaIdx + 1));
      let n = bstr.length;
      const u8arr = new Uint8Array(n);
      while (n--) {
        u8arr[n] = bstr.charCodeAt(n);
      }
      return new Blob([u8arr], { type: mime });
    } catch (e) {
      console.error('[C2P] Error converting data URL to blob:', e);
      return null;
    }
  }

  const WAVE_HEIGHTS = [28, 45, 70, 90, 60, 35, 50, 85, 100, 75, 45, 65, 80, 55, 30, 60, 95, 75, 40, 55, 80, 65, 45, 35, 60, 40, 25, 20];
  const SVG_PLAY = '<svg class="c2p-icon-play" viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M7 4.5v15l12-7.5-12-7.5z"/></svg>';
  const SVG_PAUSE = '<svg class="c2p-icon-pause" viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><rect x="6" y="4.5" width="3.5" height="15" rx="1"/><rect x="14.5" y="4.5" width="3.5" height="15" rx="1"/></svg>';
  const SVG_MIC = '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/></svg>';

  function displayAudioMessage(srcUrl, type, duration = 0) {
    let finalSrc = srcUrl;
    if (typeof srcUrl === 'string' && srcUrl.startsWith('data:')) {
      const b = dataUrlToBlob(srcUrl);
      if (b) finalSrc = URL.createObjectURL(b);
    }

    const d = document.createElement('div');
    d.classList.add('c2p-msg', 'c2p-msg-audio', `c2p-${type}`);

    const player = document.createElement('div');
    player.classList.add('c2p-audio-player');

    const audio = document.createElement('audio');
    audio.src = finalSrc;
    audio.preload = 'auto';
    audio.volume = 1.0;
    audio.muted = false;
    audio.style.display = 'none';
    player.appendChild(audio);

    const playBtn = document.createElement('button');
    playBtn.classList.add('c2p-audio-btn');
    playBtn.innerHTML = SVG_PLAY;
    playBtn.setAttribute('aria-label', 'Play voice message');
    playBtn.title = 'Play';

    const body = document.createElement('div');
    body.classList.add('c2p-audio-body');

    const waveform = document.createElement('div');
    waveform.classList.add('c2p-audio-waveform');
    waveform.setAttribute('role', 'slider');
    waveform.setAttribute('tabindex', '0');
    waveform.setAttribute('aria-label', 'Voice message timeline');
    waveform.setAttribute('aria-valuemin', '0');
    waveform.setAttribute('aria-valuemax', '100');
    waveform.setAttribute('aria-valuenow', '0');

    const bars = [];
    WAVE_HEIGHTS.forEach((h) => {
      const bar = document.createElement('div');
      bar.classList.add('c2p-wave-bar');
      bar.style.height = `${h}%`;
      waveform.appendChild(bar);
      bars.push(bar);
    });

    const meta = document.createElement('div');
    meta.classList.add('c2p-audio-meta');

    const timeDisplay = document.createElement('span');
    timeDisplay.classList.add('c2p-audio-time');
    const formatTime = (sec) => {
      if (!sec || isNaN(sec) || !isFinite(sec) || sec < 0) sec = 0;
      const rounded = Math.round(sec);
      const m = Math.floor(rounded / 60);
      const s = Math.floor(rounded % 60);
      return `${m}:${s < 10 ? '0' : ''}${s}`;
    };
    timeDisplay.textContent = '0:00';

    const metaRight = document.createElement('div');
    metaRight.classList.add('c2p-audio-meta-right');
    metaRight.innerHTML = SVG_MIC;
    const totalDisplay = document.createElement('span');
    totalDisplay.textContent = formatTime(duration);
    metaRight.appendChild(totalDisplay);

    meta.appendChild(timeDisplay);
    meta.appendChild(metaRight);

    const isKnownFinite = (val) => typeof val === 'number' && !isNaN(val) && isFinite(val) && val > 0;
    const getEffectiveDuration = () => isKnownFinite(audio.duration) ? audio.duration : (isKnownFinite(duration) ? duration : 0);

    let playWatchInterval = null;

    function stopPlayWatch() {
      if (playWatchInterval) {
        clearInterval(playWatchInterval);
        playWatchInterval = null;
      }
    }

    function resetToPlayState() {
      stopPlayWatch();
      if (currentVoiceAudio === audio) currentVoiceAudio = null;
      try { audio.pause(); } catch(e){}
      audio.currentTime = 0;
      playBtn.innerHTML = SVG_PLAY;
      playBtn.setAttribute('aria-label', 'Play voice message');
      playBtn.title = 'Play';
      updateWaveform(0);
      timeDisplay.textContent = '0:00';
    }

    function updateWaveform(ratio) {
      const cut = Math.floor(ratio * bars.length);
      bars.forEach((b, i) => {
        b.classList.toggle('c2p-wave-played', i <= cut && ratio > 0);
      });
      waveform.setAttribute('aria-valuenow', Math.round(ratio * 100));
    }

    function seekToRatio(ratio) {
      ratio = Math.max(0, Math.min(1, ratio));
      const totalDur = getEffectiveDuration();
      if (totalDur > 0) {
        audio.currentTime = ratio * totalDur;
        updateWaveform(ratio);
        timeDisplay.textContent = formatTime(audio.currentTime);
      }
    }

    playBtn.addEventListener('click', () => {
      if (audio.paused) {
        audio.play().catch(e => console.error('[C2P] Play error:', e));
      } else {
        audio.pause();
      }
    });

    audio.addEventListener('play', () => {
      if (currentVoiceAudio && currentVoiceAudio !== audio) {
        try { currentVoiceAudio.pause(); } catch(e){}
      }
      currentVoiceAudio = audio;
      playBtn.innerHTML = SVG_PAUSE;
      playBtn.setAttribute('aria-label', 'Pause voice message');
      playBtn.title = 'Pause';

      stopPlayWatch();
      let lastPos = audio.currentTime;
      let stallTicks = 0;

      playWatchInterval = setInterval(() => {
        if (audio.paused || audio.ended) {
          stopPlayWatch();
          return;
        }

        const totalDur = getEffectiveDuration();
        const cur = audio.currentTime;

        // Reached end of audio duration
        if (totalDur > 0 && cur >= totalDur) {
          resetToPlayState();
          return;
        }

        // Buffer finished and currentTime stopped advancing (handles Chrome WebM duration: Infinity quirk)
        if (cur > 0.3 && Math.abs(cur - lastPos) < 0.05) {
          stallTicks++;
          if (stallTicks >= 2 && (totalDur <= 0 || cur >= totalDur * 0.8)) {
            resetToPlayState();
            return;
          }
        } else {
          stallTicks = 0;
          lastPos = cur;
        }
      }, 200);
    });

    audio.addEventListener('pause', () => {
      stopPlayWatch();
      playBtn.innerHTML = SVG_PLAY;
      playBtn.setAttribute('aria-label', 'Play voice message');
      playBtn.title = 'Play';
    });

    audio.addEventListener('loadedmetadata', () => {
      const eff = getEffectiveDuration();
      if (eff > 0) {
        totalDisplay.textContent = formatTime(eff);
      }
    });

    audio.addEventListener('timeupdate', () => {
      const totalDur = getEffectiveDuration();
      if (totalDur > 0) {
        if (audio.currentTime >= totalDur) {
          resetToPlayState();
          return;
        }
        const ratio = Math.max(0, Math.min(1, audio.currentTime / totalDur));
        updateWaveform(ratio);
        timeDisplay.textContent = formatTime(audio.currentTime);
      }
    });

    audio.addEventListener('ended', () => {
      resetToPlayState();
    });

    waveform.addEventListener('click', (e) => {
      const rect = waveform.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      seekToRatio(clickX / rect.width);
    });

    waveform.addEventListener('keydown', (e) => {
      const totalDur = getEffectiveDuration();
      if (!totalDur) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
        e.preventDefault();
        seekToRatio((audio.currentTime + 2) / totalDur);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
        e.preventDefault();
        seekToRatio((audio.currentTime - 2) / totalDur);
      } else if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        playBtn.click();
      }
    });

    body.appendChild(waveform);
    body.appendChild(meta);
    player.appendChild(playBtn);
    player.appendChild(body);
    d.appendChild(player);
    appendMsg(d);
  }

  // ── Clipboard Images ──
  function compressImageBlob(file, maxDim = 1280, quality = 0.82) {
    return new Promise((resolve) => {
      if (file.type === 'image/gif' || file.type === 'image/svg+xml' || file.size < 60 * 1024) {
        return resolve(file);
      }
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob((b) => resolve(b || file), 'image/jpeg', quality);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(file);
      };
      img.src = url;
    });
  }

  async function processPastedImage(file) {
    try {
      const compressedBlob = await compressImageBlob(file, 1280, 0.82);
      pendingImageBlob = compressedBlob;
      if (pendingImageThumbUrl) URL.revokeObjectURL(pendingImageThumbUrl);
      pendingImageThumbUrl = URL.createObjectURL(compressedBlob);

      const previewBar = document.getElementById('c2p-image-preview-bar');
      const thumb = document.getElementById('c2p-preview-thumb');
      const sizeEl = document.getElementById('c2p-preview-size');

      if (thumb) thumb.src = pendingImageThumbUrl;
      if (sizeEl) {
        const sizeKb = Math.round(compressedBlob.size / 1024);
        sizeEl.textContent = sizeKb > 1024 ? (sizeKb / 1024).toFixed(1) + ' MB' : sizeKb + ' KB';
      }
      if (previewBar) {
        previewBar.style.display = 'flex';
        scrollToBottom(true);
      }
    } catch (err) {
      console.error('[C2P] Error processing pasted image:', err);
    }
  }

  function clearImagePreview() {
    pendingImageBlob = null;
    if (pendingImageThumbUrl) {
      URL.revokeObjectURL(pendingImageThumbUrl);
      pendingImageThumbUrl = null;
    }
    const previewBar = document.getElementById('c2p-image-preview-bar');
    if (previewBar) previewBar.style.display = 'none';
  }

  function sendPendingImage() {
    if (!pendingImageBlob) return;
    if (dataChannel?.readyState !== 'open') {
      displaySystemMessage('Connect first to send images.', 'warn');
      return;
    }
    const blobToSend = pendingImageBlob;
    clearImagePreview();
    sendImageBlob(blobToSend);
  }

  function sendImageBlob(blob) {
    if (!blob || dataChannel?.readyState !== 'open') return;
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64Data = reader.result;
      displayUserMessage(base64Data, 'sent', false, null, true, currentReply);
      clearReply();

      const CHUNK_SIZE = 16384;
      const totalChunks = Math.ceil(base64Data.length / CHUNK_SIZE);
      const imgId = 'img_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);

      for (let i = 0; i < totalChunks; i++) {
        const chunk = base64Data.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
        const payload = {
          type: 'image_chunk',
          id: imgId,
          index: i,
          total: totalChunks,
          chunk: chunk
        };
        if (i === 0 && nickname && nickname.trim()) {
          payload.nickname = nickname.trim();
        }
        dataChannel.send(JSON.stringify(payload));
      }
    };
    reader.readAsDataURL(blob);
  }

  function handlePasteEvent(e) {
    const items = (e.clipboardData || window.clipboardData)?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type && item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          processPastedImage(file);
          break;
        }
      }
    }
  }

  // ── Klipy GIFs ──
  async function fetchKlipyJson(url) {
    if (typeof GM_xmlhttpRequest !== 'undefined') {
      return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
          method: 'GET',
          url: url,
          onload: (res) => {
            try { resolve(JSON.parse(res.responseText)); }
            catch (err) { reject(err); }
          },
          onerror: (err) => reject(err)
        });
      });
    }
    const res = await fetch(url);
    return await res.json();
  }

  async function fetchTrendingGifs(reset = false) {
    const klipyResults = document.getElementById('c2p-klipy-results');
    if (!klipyResults) return;
    if (reset) {
      klipyResults.innerHTML = '';
      klipyResults.classList.add('c2p-loading');
      currentGifOffset = 0;
      hasMoreGifs = true;
    }
    if (isLoadingGifs || !hasMoreGifs) return;
    isLoadingGifs = true;

    try {
      const url = KLIPY_API_KEY
        ? `https://api.klipy.co/api/v1/${KLIPY_API_KEY}/gifs/trending?limit=${GIF_LIMIT}&offset=${currentGifOffset}`
        : `https://api.klipy.co/api/v1/gifs/trending?limit=${GIF_LIMIT}&offset=${currentGifOffset}`;

      const data = await fetchKlipyJson(url);
      const newGifs = data.data?.data || [];
      if (newGifs.length === 0) {
        hasMoreGifs = false;
      } else {
        currentGifOffset += GIF_LIMIT;
        renderGifs(newGifs, reset);
      }
    } catch (err) {
      console.error('[C2P] Error fetching trending GIFs:', err);
      if (reset) klipyResults.innerHTML = '<p style="text-align:center;color:#666;font-size:11px;grid-column:1/-1;margin-top:20px;">Failed to load GIFs.</p>';
    } finally {
      if (reset) klipyResults.classList.remove('c2p-loading');
      isLoadingGifs = false;
    }
  }

  async function searchKlipyGifs(query, reset = false) {
    const klipyResults = document.getElementById('c2p-klipy-results');
    if (!klipyResults) return;
    if (reset) {
      klipyResults.innerHTML = '';
      klipyResults.classList.add('c2p-loading');
      currentGifOffset = 0;
      hasMoreGifs = true;
    }
    if (isLoadingGifs || !hasMoreGifs) return;
    isLoadingGifs = true;

    try {
      const url = KLIPY_API_KEY
        ? `https://api.klipy.co/api/v1/${KLIPY_API_KEY}/gifs/search?q=${encodeURIComponent(query)}&limit=${GIF_LIMIT}&offset=${currentGifOffset}`
        : `https://api.klipy.co/api/v1/gifs/search?q=${encodeURIComponent(query)}&limit=${GIF_LIMIT}&offset=${currentGifOffset}`;

      const data = await fetchKlipyJson(url);
      const newGifs = data.data?.data || [];
      if (newGifs.length === 0) {
        hasMoreGifs = false;
      } else {
        currentGifOffset += GIF_LIMIT;
        renderGifs(newGifs, reset);
      }
    } catch (err) {
      console.error('[C2P] Error searching GIFs:', err);
      if (reset) klipyResults.innerHTML = '<p style="text-align:center;color:#666;font-size:11px;grid-column:1/-1;margin-top:20px;">Failed to load GIFs.</p>';
    } finally {
      if (reset) klipyResults.classList.remove('c2p-loading');
      isLoadingGifs = false;
    }
  }

  function renderGifs(gifs, reset = false) {
    const klipyResults = document.getElementById('c2p-klipy-results');
    if (!klipyResults) return;
    if (reset) klipyResults.innerHTML = '';

    if (gifs.length === 0 && reset) {
      klipyResults.innerHTML = '<p style="text-align:center;color:#666;font-size:11px;grid-column:1/-1;margin-top:20px;">No GIFs found.</p>';
      return;
    }

    gifs.forEach(gifData => {
      const imageUrl = gifData.file?.sm?.gif?.url || gifData.file?.md?.gif?.url || gifData.images?.downsized?.url || gifData.images?.original?.url || gifData.url;
      if (!imageUrl) return;

      const img = document.createElement('img');
      img.src = imageUrl;
      img.classList.add('c2p-gif-item');
      img.loading = 'lazy';
      img.addEventListener('click', () => {
        sendGifMessage(imageUrl);
      });
      klipyResults.appendChild(img);
    });
  }

  // ── Init ──
  function init() {
    buildSidebar();
    attachUserInteractionListeners();
    if (!serverUrl) {
      const h = document.getElementById('c2p-setup-hint');
      if (h) { h.innerHTML = '⚠ Click ⚙️ to set Server URL'; h.style.color = '#e50914'; }
    }
    try {
      syncSidebarWithRoute();
      if (sessionStorage.getItem('c2p_session_active') === '1') {
        console.log('[C2P] Auto-reconnecting active session after navigation/reload...');
        connectSignaling();
      }
    } catch (e) {}
    if (sidebarVisible) {
      checkUpdateOnFirstOpen();
    }
  }
  if (document.readyState === 'complete') init();
  else window.addEventListener('load', init);
})();
