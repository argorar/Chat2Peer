// ==UserScript==
// @name         Chat2Peer for Netflix
// @namespace    https://github.com/argorar/Chat2Peer
// @version      1.15.1
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
    { id: 'sheep', name: 'Sheep', icon: '🐑', title: 'Sheep' }
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
  const DRIFT_THRESHOLD = 2500;
  const PLAY_DRIFT_THRESHOLD = 5000;

  // ── Voice Notes State ──
  let mediaRecorder = null, audioChunks = [], recordTimerInterval = null, recordStartTime = 0;
  let incomingAudioChunks = {};

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
#c2p-sidebar .c2p-record-send:hover{background:#ff1e27;transform:scale(1.1)}
#c2p-sidebar .c2p-audio-player{display:flex;align-items:center;gap:10px;min-width:180px;padding:2px 0}
#c2p-sidebar .c2p-audio-btn{background:rgba(255,255,255,.2);border:none;color:#fff;border-radius:50%;width:32px;height:32px;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:13px;flex-shrink:0;transition:all .2s}
#c2p-sidebar .c2p-audio-btn:hover{background:rgba(255,255,255,.35);transform:scale(1.08)}
#c2p-sidebar .c2p-audio-timeline{flex:1;display:flex;flex-direction:column;gap:4px}
#c2p-sidebar .c2p-audio-progress{width:100%;height:4px;background:rgba(255,255,255,.2);border-radius:2px;appearance:none;-webkit-appearance:none;outline:none;cursor:pointer}
#c2p-sidebar .c2p-audio-progress::-webkit-slider-thumb{-webkit-appearance:none;width:10px;height:10px;border-radius:50%;background:#fff;cursor:pointer}
#c2p-sidebar .c2p-audio-duration{font-size:10px;opacity:.8;font-variant-numeric:tabular-nums}
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
          msgInput.value = '';
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
        const localTime = p.getTime();
        const timeDiff = Math.abs(localTime - d.time);

        if (!p.isPaused() && !d.paused && timeDiff > DRIFT_THRESHOLD) {
          p.seek(d.time);
          wakeNetflixUI();
        } else if (p.isPaused() && !d.paused && timeDiff >= PLAY_DRIFT_THRESHOLD) {
          console.log("[C2P] Missed play event detected. Reconciling playback with peer at:", d.time);
          p.seek(d.time);
          p.play();
          wakeNetflixUI();
          displaySystemMessage('Reconciling playback with peer...', 'play');
        } else if (!p.isPaused() && d.paused && (localTime - d.time) >= PLAY_DRIFT_THRESHOLD) {
          console.log("[C2P] Peer is paused while local is playing. Resending play sync:", localTime);
          if (dataChannel && dataChannel.readyState === 'open') {
            dataChannel.send(JSON.stringify({ type: 'sync', action: 'play', time: localTime }));
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
            displayAudioMessage(fullDataUrl, 'received', item.duration);
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
  const SHEEP_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAKEAAADJCAYAAABL9lKBAABUoElEQVR42u2dB3RUVbfHQwIkhN75LCBFRIqKBVFUilSRIgoqINjFTlGkdwIhoffee+ghpPfeE1JICL13sIG+7739zn/PnJs7NzOZTPpA7lp7zaRPZn6z+97HxqbsKrvKrrKr7Cq7LL7++usvKnsWyq4SBfDOnTuUmZlJycnJFBERQQEBAXTgwAHy9PSk8PBwSkhIoIsXL9Lvv/9eBmvZVTANd/LkSXJzcyNXV1ca/MlQeq3D69SiVUuqUasmlbevSDa25cimnA3ZVahA9pUcsj9nY0OOVarQk40a0kuvvExffPUlbdiwgTIyMvj3//3334S/9ccff5RBWnZlX3fv3iUfHx+aPXs2DXhvANWrV49q1KhBlSpVIjs7OwYLwDFouC9gK2dnm0MAZAUHe/4e3MfnbMvrf17I888/Tz///DOlpKSUAVh22dikpqbS8uXLadCgQfTEE09QuXLlFFjU9yHQdNVqVKfHnnyCXm7Xjrr17EE93+lFffv3o/4DBtDHQ4fQ+4MG0rv9+lKPXj3p+RfbUr0G9alSZUf++YoVK5KtrS3/XtyvWrUqffjhhxQaGkrQjGWvxiN0HT9+nKZOnUqtWrViKCoIbeXg4MCgAIzq1avT008/Te+++y599dVXbIq3b99OQSHBlC7M6YmTmXT52lX6A+ZUJX8KkOT93//8gy5evkQZWScpMjqKtm7fRr/88gu99NJLDKC9vU5TOjo6srz11lsUExNTBuLDdBnTLIBv4MCBCgBSMwG4vn37MiSADX7g+fPn6fbt2xyAwEzj/pXr1xg+U6L++qUrVxhC3L9x6ybdunuHcN27d4+OHDlCI0eOpCZNmijw43HA7OPzN2/ezPHY79+/XwaoNYInXziY3D59+vCLDa0H/65169Y0Z84c8vPzoysCGPwsAAFsgEDe3rhxg65fv85iCYSQqzd0P3Ph0kU6e+E8Xbp0iX8vImYIfv+yZcuoWbNm/LiqVavGbxD4ogcPHiyDztovmMZzFy9wVFqlejUODgAhAg6kU65evcrR6T///MNwIJ1y/eYNBgcAQYtBoNFyAy+vEELwNy5cuMAC8CWMAH3BggXsHuANIjV1jx496PTp01SmBa3wuim0zfiJE6hW3Tr8YiIw+PDjjygqKopTIoAO5haa6NSpUwwkAIG2AiwSIkCIjwGiWvJqjvEmwO/A5yHQptCEMO+4j78NwePA4wKY48eP54hcBkPQjs7OzmUQltR1/y/LIkapURDBIiXyRMMn6ceff6bouFgOFgCbWvCiX9EABrlwVSfnr1yic5cv8i1ErR3NaUj5dfX3yb9nSuB/4oLv2r9/f/YRYaYBY7du3ZQcY9lVkj7fn9mJ5Ad/ZN+PDAmjMSNHkZ1NOdYiyMMtXLiQTdm1a9fY14Pmyw+EasmrRjSpKc1AiMcIwWOGmUaSvGXLlgwiAhcI/q9HFoDNmzfTrFmzKDY2tsSehH//uk8J0bE0f64zDflgEL3U+nmqUakKlUNqxaES9enZiw7uP0B3b9+hP+/9TreFmbt+VZhCYX61ABqDUMLHAF7LCaH665DChBAuwiX944RrgDcQNCMEyfM6deooviK05CNXu960aRNVqVKFnwTcfvfdd0bTCEV5rV22glo1a05P1XuMWjd5mnq+1Zk+HTSYvhoyjFymzyY/92N0Jj2Trp67QBmpaXQmM4tuX79BN69co2sXL9HlCxfp6uUreYKQASwBCAGfDF6kRoT/iAumeMSIERy4QCNC4/v7+z86ICJpKxOryK3hFmkEFxcXNnVF/fc//2QYa7vxP46iM/EpdCIiTpELyel0NimN0iPjKNDdk8K9/Sk6MJRC/QIoKzWdbly8Qg/u/UEXTp9l+ff+A7p57TprSAmj4seJz0MuXNeL+B5DKRiExrRxjjeEXiNCtKD++++/FBgYSC+++KKugiOUAsp/1pQ+U6fR8lw3h2+Cd51M7OKdiPscdQrH+bHHHqNRo0ax+SiKBx/o40f2tnbkaGNHtcrZ09GNO+lMVCLFewVSzFE/Sg+NoZOR8ZQeHsuAAsjUqDhKiYmnQA8vvj1/8hT9fece/XH7LmtIaESAaG0QIqLGiwgNiYoPrBJek86dO7NlsoZUDrR8XFwcHTp0iFNTefohtCfZ6OuoKGk5OTmR1IwyhSBzW5999hnFx8cX6hPhfcSDXmnzAs0YN5FebPQ0HVq9mU6FxVHCsQA6H5VM0e4+tGjyLBrxwRCa8O3PtH/jNkqPSaDM+GQ6nZJOsSHhdCLxOF07f5Gy0jPo91t3WAtaI4QADS+ijKKR70Tggue+UaNG/OKWNujQ7oZ4YtiwYVwgwBtHRvwoFuTpl8yYMUPpIHn88cc5fYB3IvyRwYMHU926dZVKhCxBIZ2A0lRh/BPb1m+it197k7avXk9hhzwpzT+cUv3CKCs0liU9KJLcN++iFTOd6cXGzal2+Ur07JON6euhw2nh7LlsliODQqlNi5bUu0dP+lNoxAvnzut8RIshvFaiEML1gc+I7z937hznHAElXmA873gt3N3dSxxE5GNlbV5aUMkGrCoaRfC52rVr8/9l9hfCGYYPiF/w2muv8bsN7U6or+JJQQPnunXr6M0331SAlP4KfBdvb2+LnpTf/7hL9//6kx788Tv9NnIkPd/8GXLbtIWOh0Ww6U0NjKAUn1BK8gpisww5HhBOnjvdaPrIsfRK81bsP1apYE+V7SpSdccq1PjJhmSLz4n/43hSMl06f4Ff5GtXb7BcuXaDLl/PKZeu3TSQy1evF6lcEkFUbmIqmIGZ/vHHH/mFrVmzptFGiMLy3R88yPbp/vrLsGF306b19HqH9kLbOQqlpFNc9erXoSFDPqZZs2ZwyikoKIgSExOpYcOG/Hj37t1r/nENHz5c8QVff/111oT4wX379rE5gLpFBId/Ev888lidOnXid4DUoG3bts3xxDz423SK4X/+uU+d33iDOgnoMxKThGlNpFjfAIYNEEL7QeAXZoTF0qWUTDqfkkH/vfU7Xco4RZN++Y3qVK1O5W2yW7HKi//hheeep1sCLjxevIjWDqGswMAywclHoh7POdI56PYuCi33z7+GfufNW9fJed4cql6jqlA8FaicrQ21aNGcRo78iQ4e3C/cs1ihrc8RgD179ix3oiPSb9OmDSsqZF4sgrBdu3YcgIwePZpf2B9++IHb2AEifjFrF/GEwFR4eHjQ0KFD+Z2J74UvMPijQXRJPKC7t2/l+oc//nAg9e3VU/hx5xnClMhoyoyNp2gvHYhZUQl0PiGV4v2CKSU8hq6dPEt/Xr1Jf1wRgF25zkFIRHAozZwyjQa+/wG93PZF+vrrr7lsp7xof/1l9RDCLON/QToHz/l//+e/DCKeb5hCOVpQFL2K9+7doRUrl1Gjp57UdQHZ2Qjl8xatWbOKTp/JYvCuX79K6SdShbLyo/nzXdhVSE9PZyuK1rU8Q6g2x2g9CgsLY7iknd+5Yyc3ZSIgycrKorS0NP5DqIninYouFbQnNW7cmOzKCZ+gWhVavHC+yT/8/Q/f0isvtaWUhHhaOs+FBvbqTa+1eo4eq1KNnqhWmzq/1J7GfvMDrZ2/hOKCwuhUUipdPJFFty9epTuXr3FKBnlB5Aj/58E/9ODv+5y8RqMCHHpobLxwaFZ4GMwx/h+pFfH/PXjwgJPbeL2KKn3j5X2Mmj/TTN9/WVnEBh+Rp6cHQSsCOm8fT1q4aD4N+vADavNcK7IrX46lS5curAnBR9euXfNujpcsWaI0fuKP7tm1mz7/9DNytHcg+woVqdNbHSkkMIh8vbwpPSWVMsQfwG3miQw6f/YcVysQCODrnw4bSnVr16KK5e3o1VdepjOnThJMr1TrYWEhwlmtSSO+/pJaCGjLw4wKqYwo3AZpGluqbmfP6RrI6y+8RIucnOnU8TROUt8RL+TdGwIWcR8R8C3xMZLVuA+5duUqiwwG1BDqQLyVq1y5ppUbhSrmIIVmA2gADgDKpLYUmDt2M8SbrHfv3vx6QUFYlJPL5bp79zYNGz6UHCpVZLML+BKT4sXfPS0sn7uA/kcRG3SgSsIs21cor+vZLF+B2ZHuGapuUFaIlPF1xBRm/3BwcLDiV6E2+7NwgL/58it29D/+8EOdWf72O4qNjqFQ8b0pyccZvrPCbEPOZJ1iAYhXLl2gIKGaASOrcCFbN+vUMVT3082b8oO3E59/TEROH/ftR5N+GknTRv9K33w8hDq93J7qV9V1mADO6g46Df3Wq6+R56EjnAdEQhrgAX7cPiwQ4uuAD48b8AE49EmqBS5RZGQkv8iwRPXr16fu3bsXijZcu3YtVRNWrGLF8kKLdaHDRw6Sv78vTZw0XtGKzIiwdva25chBAFepoj2/xvg8rCYEzcOwlrCMSPshSDH7x0EqSIZJhuZr/WxLGvLxYP7FM6dNp25vd2XaV69cSTFRERQXEy1ATBIgnmFNl5WZQSczTgjNKDRk6nH+GD4hYPzis08ZOqhuCP5BaMkfhP/mvf8gpUZE09nE43Q5LYPOHU8VvmEs7dmwhT7s05+qlrfnCJjfbeLNUc2+Em1Zu56uX7hEl86e51SM5RBqRQvhjSIVc105gA8+OXxwQAfThhdRCj6H4Sn46dCM69ev59wuusXzC196Zjp169mN7IX2g5WCHwgAPxk2RPj5Dtnwlc+GsKpDBapRpTJ1fPMt6tD+teyZHTtb2n/oIEfIsK7IpiC6z/UBoBIiqyOguAKS0gLEXt178Oe++vwLWrlsOTVu1Iga1K1HR48couBAf/L19qQTaSksGempDKG8vXDuLKUdT6Y7t0QgIZzb40mJHL5XrmRPb7R/lQI9jtGF9Aw6ER1Lkcd8KDkghNJCIuh4SDiX5lIjYtkPDBFfe69Hb6rlUIWq2FUkBwEiBEnttIRkOi4CGQmhBFEL4VURxEAUjWMhhFJDFQeEEDj08KeQoQCAAA5aRQr8cgRf+DyghLbs1asXR6L5AXD6rGlUTUS95QRg3303gk0u4IMprljBcAisfu1q1PG1l+nzwYNoifNcOix8PS93D/YDbcvrGMK47L0/fueCB7gy+7jwT0KVVtCnWWCKbfWpjjdee50qO1Sigf0H0PJFS2jaxInUoE5thig0MIACfI6xJMZG0ZmTJ1jSjycqUEIbns7KFOY6i27duEabNqwje/G7ofnOxSeL6DeO4rz9KSUglCU1MIwlJSiCkoMAZCQlC0GJbsbYCVTPsZoA0IYqicdYq6IjzZsyg06I34NE9dkTJ7lagkrJuTNnOUUDgYugTVYrAYI+aa2F0hg4V6/fpAuXLtOJzCzKOn2G0jNOUnJKGiUkJVNcQiJ/nJicQmfFY4AgwLh+8xaLBFnOoyhtYlcxm3KZrly/wrfnLp6ji1cuGGhAgKgWfE6rGQHs7t27OQo11+zwx9/ZOb+s81nU531dVazVcy1o2fJFNH7CryKodMxOeZXTuVOvt2tL40b/SOuXzie/3TspcPce8tnrRgdEwLp+1Rr999tS+YoOtGTZCjp39gKXGfH5sWPHmn9zPNeqtfJHASMAhOlF7x4Svy8/35aWLVxE8+fOobGjR1HdGtUZxOT4GPJ0P0g+x9wpJMCXEmKEnyKiJqkdJYww2zevXqFOHTpQ1w5vMHxnouIpIzyaNeBxf6EF/UMpPSAbwhQ9hJC0sBhhptPJd99hEUG/wCCiYoIAxnXaLEoIi6To4DDWiheyTrNGRKUE/ik0oraLxlIIAdItYfYBV1RMHMMm4YuJS6DU9BOUJgI0fAwJDg2n+MQkhvXi5SsMJP4exgAgEkYAB7l19xbduH1d/J1rDKRWC0JygxDQQkPCD0PuNrd0zd///E337v9OK9etoso1BGx2NjTqlx/owMHd9OJLralKZeEqVdCBV82xPH34Xh9as2whuW3dSP5H9pO/2246tm4dy+FNG+nQju30y8if2ezawF2qUVNo6kTas8eNrSreGHmqqrnOc1HAg+bDA3j3nd50YN8+Nr/NGzelBc4uNHfmTHHrTJPHj+VqRds2z1Kg7zGKDA0iPy8P1orhwf6UFBdNqSKaOpGWzHIyTYAYF0cVxM/MmjiJTgkzmg4AgwGcXvSaUPexDsLU4EgW5AkjPHwoIzqBzfQH3XtTTVt7qlmhEmvEbWvWs2kGiCE+/nRC+JWybsyBkiblkV2+08lloaXVYswcA7Ljael0RkTk0QJ2wAYQAWREVDT5+gcyeNCW54S/mineDPh+CLQkgJQjBYBNkVtXFPgg0IapqYAtUUCXxPfNQQh/HiYZ9X+Yv9wS2GcvnKUBA/uTrQCtUZMn6fDRfTR12niqWqW8ovlqVqtIfXt2ps1rl9H+HZto94bVtGf9ajq4YS15bFpHvpsFkNu3kd8eoQ0PHqDXX3lFn1UpR/3eG0D37v1Bw4d/phQw8tRwgRerij5HCE1YtXIV2r1zF0fCcDod7CoIDTiG5syYIQAcR/OcZtKcmdPoqSfrs6xfvUKYZz9FAGJMRKgC4y3xxB8U5qKaeFdsWb2GzqSkUlJIGMUFBHOZLikolAVQsqjNsbhNDAqnE0JzxglQcRsvYH1fgGjPptmWnmnUhAK9fAToCRQfEUWJQlulCEjOnzotfNLbuv7Cy/mHEAKIkgTcAA8CUyxN83c//Eitn3ueWrV5jrp07U4TJ0+ldRs2ko9wEzy9fRhSQJsmgrZTZ05TRlaGXtJZzpw/w5J1+qSA9jjDBwhTUpL1kjuE+DyyG2h8QD0fhQcemxAvvhoAt317yLGyA/t6v40bQ94+7tSr99tkW05nBas72lKr5g1p8+qldHj3Vtq/bQPt3biG9m9cywC6b1hDnnoIvTZtokMiINotomkEJ+zKiQBy1Zp1dDw5lRo0eIw1IVI1eetkvv+Agw9owxpVqzGI3434lk0aIuNqlRzpk48G0+L5rjR98iRaMHc2zZ0xjRY6z6Yend+g+jWr0pfDPiYvoa6Px0UKH82Hgny8+BZa8oKI9H4dNZLTLR7i3RopnrCY4BCKDQym+OBQTkZD4oPDDSRBBCoQ3JffA0kMjaSkiBga/N4HHDE7lLOjnp27crNrcnQcNzJAAGRqYjLnFK9fusI+InxDbXPrJRWQEFMBBczqKeFvQvtBACVg9PD0pjnO8xjGTl3epsZNn6YatWrziwI/CQ57zdp1eVfNlOnTBJTiTSX851DxRk0UPjQi0/jEOIoSvjVuASFEQmjKL5SCzyFlg2oKqhVoHEC+EBfAROkUVSxkKFq3bC4CywPkftiNGj5RT5eIthdvZgHiN598SN4H91Cg+z7y2reDDm9dRwfWr6JDQhMeFSAeEyB6CfHduIF8Nm5iv3DB5ClUSfCChgX8z8dTM2jkz6NZK6KsiOc7zxFScEAgQ4jkNB7YSy+0pcS4eNq3Zy83Bzz3bCsRnCyiWdOmkouIcgGhq9N0mjN9Ek0TzmzbVs2pbnUB64cDBGj7KMTXm2JCg8nb/TCFBwXSxwM/oFrVqlKEABAQRgQGskQJQXMqJEZoQQjasiDxoRHKffk1+fUooUVPpWXQl5/wu56bGJymTqeMpBQKDwiipKhY1oyxQtNC7onAAkntK/qulfxAKAUmVmpEwCh9Qpf5C4Vm6UMrV4sXy8eX1qzbQPNcF9CESZOpd59+vDgJ6YuadWrSmvVrWBsCOkAJGFPTU/hWQpgtuUMIbYiIGflDRM3t27enbdu2sRbE1xs9+Tg/R2NG/SiCxEya6zRNuF22Sm6vbfPGtEUEJYEH3ejwlg3kvjVbjm5exyYYAHqv14m/8AV9N2+mgF27aeSnn7FyQYK6W49elJqWSY0aNRa+YCWuuFnWNfH3fU7BQAvCNMucILpRunfuwrMdk8b9Rs6zZ9GkX8fQsgXCR5wxhZa4zlFuET292rY11atamfr36EZLXJwpQPiKp06coLc7d6RaNapRdHgYQykFIErNBZ8OEgPoNCK/BpGQQU4KTdSne09hmm2pdpVq5HXYnVKFY4zvixCaNiEyhuLCI/n3wzxLs1wQCKEN4f/BxOIWZjnj5Cm+P3uOMzUSPvQPP/3MH0P8xON123+QlixfRp8MH8a5OMj4ieMoOTW5wBACQJk3BIjLV66gyUJZHDt2jGv5dWrVpC0CnNvC5/z8k8FU0daGCwW1q1akIe/3Ifedmxg4r11bKHj/btZ8kCPCFMMEe4g3zLF1axhA33VrKWjbFvLbImTnTurR7lUF5llOc/mNZ2tbnqpVq5G/ntNJ4yco6Rn80s+EbwFtuMhlPlUSJmXQe+9xhAwtOHvKJJo5aZwwzTMZwKnjfyGnaRNpsTDVMyeMp08/HEQvtn6WurzxOmvPhk88Rs8+05wSYlFxCeQUj5TwoGAWNCNAokR0qRVM2kkBXAAQsAGwTGEWe3TqwsFSp9c6sEmG4GthImAAxAy50IhI3xQUQgQqMMWIjCGImKENoSFPnz1P7h6eVK/Bf4T5bUf7Dhyirdt30P6Dh2nBooVCA66jxcsWi6CgET/H0IimzHFeIcRQGqJjaESYZezQ6dqjO1cqkL9LSoijLBFxt3/5BapSwY5f4wZVHWne5HEU4n6QDm0SoAkNeGD1cvLetol8tm9m8NzE49w+fx6bYM81qxlAP/H4GcJtW8lr5w5q/vhjXDlBFLxj1x7q+U5vdkE6dHgzf0NamGvAL0OPGKoa7dq9TAF+vuTpcVRoySeF09qcg5JpE34jl9nTaMk8J3KePoFcZk41lBnTaZnrPPYd8b0/jPiGM+wtWzxDMTFRnEmH+UctGoIyIERCGB4axqKFTwFSAMXaUUAFgWYEkO3bvsQacfqEyZyu8T/mxZpQmmR8b1R4BGWeyuI54ys3r9PZSxcshlAGKjDHgFCaZilYjhQiND6G8hs1bsyayTfAX8DpQXv3udGBw4do6Yrl1ODxBpwkjoiKFCDHiODkHN9qoTMnMo2D/wsADv9c56J88cVnnKuF9WnYoAE5otQmPt/h2Wdp07y5FCEiW5jagyuX0dF1K8l7y3o6tnE1HV6znPYvXUh7F7nQrgXOtHPeHDq2arkAcA0FbN4ktOAmzhVuFZ+rWE7XWYP9jOisBviIlFevXm05gDKvBH+ikqM994yhaXHDxnUCiBAa9fNP/AcnjfuVAYQvqANwMrnOmsbwzZ+hk4VOs2j6uLFCU06glYsXksscJ/YHX3iuDQUG+TOE6FEEiGoYJYRhIdka0RiE0mSrIZQBSduWrTlQ2SyiNCSwoTW1EGLrlnrmOD8QIg0D7SdTNWrBEH5CEkx1AjV8qhFvhli8bCmbSLxYGNYHoACQa/I//cjgJqUc51tLIYTZQ3IbmyWwqq5SFQeu9aIRwUP45M898wznVgHgFwPep6Micj+6Rmi/tatZfDevJ29her2ECT68cokC3w6XOQzgPqENAaG/YAEQIihBvnDWlPG6Mp7g4vU3X+MpQQCIxVMFKmCPGzdOv8lKlzdC+QYlNz8R7aJW+Eb7V2ix0ICAcObEX2n+7GwNCADnTRNwTplM80QUOH/OLBYncb+yfUXq+OYblCDMDTRubhBKUfuBal9RCyG0HT6HaBgwYlb5ibr1c2hCCWKA8EWDhXbg1v0b1/IFoVobaiURq4WFdoNmOux+RETGtRnEBo89pizRxA7ECuL5dKhsz1/DYwKA0GSWQogyH1yMnj178u9evnwp3b59k/bt3U1P1K9HVezKUz2HyvTrV1+T3669tG/FSgoU/hz8vAT3Q8LXE/7fykW0d8FcFoCnFndhln3WrqLAzRs4MkZ6JmDfHhoysL+ArhzZVbSj9we9T88++wxbPGw9KxCE+KegXiHopmjY6Ak2yYnxsTTiy8/IUfxBAAhtOH/2dKEFpwjgpihaELJIBC8QmOVZkydyWgeO8FtvdKCoaN3eZ5SXAvx0AhCD/OEfBrFvKDWfKQgVGPVQycAGiWpABw14cPdectu+i6HUQhgcGkpe/n4UEhlOt+7dzTeEUhsagxDaMCY+jk0sNO8zLZ9V1g1zZ5GAsVz57JosAhZUUfBzlkKIdq+PPvqIXamVIphEvd798EGqV7MmFwhqV7Cnub+Op9hj3sL8bmJ/zn/rVgrasZUOrliswLdn/hyW3a5zWXY4z2YIfdetZoEmBISeQoIO7OcackV7W3IU/uVgEfDAeuJ/QYRe4InAjh3fNCharxTvLG9PD/LxOko1qlSi3l27sIabO3Uim2JXASFk/jRxO1WvCaeKj2fPZL9w3JjR3PLTXkRSaP8HhJhf8ff1ExrWh3y9fAWMIlgJCKHwwFCTEGphVJtntQBIGT3jvhbC0IhwCo0S94XDfvPunXxDKAXpGRktQwChWqDdoOmw8RUriGWzCPwnJHRR8sLCTixjR3sWotzcoEMAgkAEQYkcC8XvnO/iylWiEOF/Nn3iCX7jtxDad8nU6eQr3pCeG7ZQpAiUkF5BsHFo6RIBnbMCnwLhvNmKHF66gOGDICgBhID4gLjf6ukmbI5r1a1Fb3V+i63nyy++UDgNtrMFPGhohDbEkzVs6GCKjY6i8LAgeq/PO1S/ZnWOjp2mTDAL4aI5s+mnb77hCKqriNQAIbQgINQB6M0Q+vsEMIQRweEFhlDCJ2HUQhiXIIKWkCA2xQhQCgohaspqELUQwjTD3wOMv4wdawChehnSl19+yS1c6iS0KQgREeN7kQ/Ez6LLGsUFPy9PeuappzgIaVqvHm1wXUDBe/eT75ZtFCpMsdf69QzggWU6AKHpTEG4f6Gz8AWXKhD6b4A53iTM8RbaJQIrcGDvYMfppvqP1WNeZk6fWjgQXr16mYMTtGrziGHtWrRDhOWAcN2qZVRRfG7IBwNE0DGfnIUPOE8PIQQ+ocuUiXwrIfxk0CAOaj78YKCiCTEOIDWhn7cfa0KdFozINT0DMQch9thIvxL3ozUQYq3viVMnjQYl+YEQlRQ1iFoIsXoYEMI0o3SHeQssc5KtczCjaP5s2rQpa0Pk+nLThsgwwLfOysoUP9eIer3TQ/xMOvd19urWlX/vU/Vq0dJZM+iYMLuAJkDAum/xEjqyYpmiAaXPp4Vwp8tslkPLFpD3hpUCvHV60VVK/LZup4XCxapc3pZ9Qvi1vCRBmGP0mRbafMHAge8ziOwfij8weeJ4hhB14R5vd6R6IrJbOn8u5wrVIEoIoREXztJBOKB3b86qf/HZ57lCGBqUPwi1X5fwxcXEcqQtfUcZHaemp3Fq5szF84UGoRpENYAySsZ9aGDch8nF84AdhRhml5oMH2PNMdItam0oG1khuI+68o2b12j4p59QzVrVGcjTZzJp9JifyEEojpp25WjNXOHLieADkTD8v93CVO+c50x7XV2E6ACUvt9uVycWNYRui5zp6OqlArpVCoASwiA3N/r5s8+oqj54ldK08VM8xltI+0T+pO3CaZXTVYh4MJTEFY7gYNaGCFCm/PYr+4ZzAJ+IgCWIcyaMpeVznQSE0xnC1/Q7VSZPnMjphICAIPIX0EH8fANY8LlQJJXDIoWEsxhLWucAVHwfcozIK+IWUEdHRPLHCHp8PL0oRjjKmIdBbRULLY2BVxAIZQIbbVvosjmelmqoDVXNBhDZpAqNB9dk+5atXKuHa4JavUxIS80HrcgNrekpDBw6a7Zt30I2tja0YfNaunjlHC1ftYjbsnjjwZhRFLJjJ4Xv2k3HVq+h/UID7pk3jwHc5+JMbvNEEOICcdIJ+4XZsm/xPHJftVinBTetIZ9N64ToAPTcLMyx2x6OC8rptZ+E8NNPhhX+wJWcoKog3llox0flAyCid/Cd7m9zRWSx+IcAoQ7EKZyqcUUOcep4XeAycwY926QJzwYvmr+AM/oAToqEMTAwmMJCIygiIirPEMrvA2QcYQcFsa+E7h+UG5G6AHjoKeR91DdvcILaWFqmoBCqQZTmVwuh1tcDjNBuJ1LTlMExiNSE6uqIThMe54GjU6dP0rMtn6ahwz8U0f01Cg73p7r/qUYOVcrRuNHfU/g+NwrZvJU8lq2g/cIn1AIoxRSEagChBRlAPYQeW7bQUbe99FzLZ5QZINkQvWzJ0sKHcI7QYjJfCG3YvElj8vU8xo2su7dtpro1q9Kvo37iKorTtMlcQ9aBOJlmTRrLQE4SkXENR0eqbO/AE3wABcBJkTAGBYnIODySIYTJVIuETQun/BiaDx3UchG6XICOyJHHPsV9XoxexBBKEE+fPWuoDXOBkO+LN0xSfALfJqvas9TVEP4dSfEM4gphJmvVrUFRMSHifzpPgz/uT5UcbOjjQe+S14Gd5L56JR1csIAOzJ9PXitWCviyAdzrLEztPCcWUxAiaa3TfusULei1WZcfBIRQLPZC6zpWrECVKpTnURC0/yXGJRY+hBjPhOMLTVitSmVWv2N+/oniosJYG379+XBq9UwzmivMrtMMnTYEiDMn/MYwrhD/0Leff8oQN2vUWOcDCl+wsCHEug9M/slVGXIbv9LFfFG30Fy7f7AoIIQg32egDXOBkLWe+Bq0edpxYW5j43JExjDbWMsSFxfDAUjnrm/Rp18Mo+s3LtKypS4c9L3Uqgkd3rWBvHdvpr0LXIUGdBWgzaPdc+YI8OYoABqDEH6hGkJTAEoIx4/8STeia1+RnmnSjEdCnm7SlG7fuF14EP6r30OCWeHNG9czgFIbPtagHu0XPkF0pAAhIozatHqWsElhpYi40OKF1A3SNlN/G0OuIjp+45WXOD3zQb/+FBsVR0eOHLUYQlNQ4kW7ZGQ7q9SA2gXn6iVHhuBdN5DCGGSC74kKSHJqitJupUCYpBOMzcr7AFGK/JwierOMaPjAgX1Uo3ZVCo8KoTOn0+nZpk9wOW7R9Il0ZMsaOiS0JPw9tdmVEObQgC4yIBFacqGLiIYX0dFVy7mC4rNhDXkLUwyJFIFI2J49nOYJO3SIur3RgV9TdFqh86pSxUrUpWMX0nVj/VP42vC6eMEwwA4HFJNygLHTW2+Sj9cxLuUB0ubNmtDIn36kZYtcuULCJbzZ09lE16pcmZOmC+e5img1niErKITc3CBuAZrcXmUJhDm1X+FCKP+uAmIBIYQfDV/3itDiHw35iPp+0IfHAiZN/IUcRXAyrF8vCt2/h9wWu9K2OTNzQJgtWg2oEwB4cOlCcl+5lDzXrmQA1RAit4jWrdA9buS2cjU1e+xx1oTPNHua6tepSxXt7Mllrouum/vPB4UPIbRhSFCAwdAzbge+P4C1YXJiPM2aMY17Bcf/OporJIiaoQW/HDZEhPEV2R/08fDkVExwcKhBYJIfCFFnzso8yabX2KL00gChGkQ5OZdfCGWgEiEsT6s2LWnr7i3id1+kJo0fp6fq1aDDIkIO3rmVts2eQduEO2QcQNMQQgMCQK91qxg+DkZUEKLZAYNNqLb89uXXVNnWjk0xdv+gCRoQJsUnFe2qOoA4cfxvumWZwjSjTby8eAeO/WU0V1LQI+g0aybVr12Lfv5+BDe8LhQmoHXzZlS5fHledK6LYHURcEEhRO4Pe2cw3INB8dIKofz7iNLVcyGAT0pezTFyi+howiastPRkmj51IldFJv34LWvBvQvm0S7hBrnPn0f7nC2DECZYakD/zetzQOi7dQvXi8MPHKSuL79CldCPWKc2NW3chP3BV158pfh2JQ7o35/DcfgCEEA5buxvHJ3CocYMytONn6IRnw2neTMxm+LAwYzzLCdOPSBvh1wYmhWkyAYGgAXA8LtMwYcpMgj238gOaTWE6sNuDEAo4gVHOcTIVgUEKUhWQyuaa1LVCjQhUk2ffPIJfTfiG/rj1g1q16IFvfhUIwGgG1dA4PcdcJlDB9F6JUDbpwdOLWpfEAIzfHj5YtaAOj9wnYEAQB5s2rGNfHdtp+UiKq7COyErKHsgwYB+Q1gxLcX+8y9B/Uu8e6RalaocmgPGX0aN5hRDgLcXue3aSd98Oox6vd2ZAcQkltvuPVy9AHRaCCEwrxz1mtGAEkIALY+LUAcmpRVCeQqojJYthRDfA62PNWt7d+win4OHqBra6X/8iTthds+TAM6mA86z8gQh6sIAEBoQAOpEN0MiAZQQHhXRcagISN57+20e3UA0DksIU4yoGHsgC3NBp9kL7fEtWzyrLKSEOoZgFAB1Q3TxQrp37sQPtuPrr/GIgIQNFQ3ZwgXhFq7gYLNaUA0hgEdaRuYDrUETwjdE3RhlvPxAKAeYMFM9/IOBVF08/5h2O7h8KZfhACEAzAuEANB9+ULDIERA6KWfplMDiM7rBH9vGvnFp1RDuGEOtjoAMTaKGfV1a9aSseboQr9wYI3BAPXp09T2+RdYE+KByKClf993uZM3Vfg1LZ9uxolMtPbD9/E+5skQqgGUIqPdvGpCaFUMtSMXiOS0NWhCPA40MOQHQphjbMzFQYyYp37miSfp20EfkffWbbTZaRZDCOjyCiEA9FqzXGlM0EII+OADemzaQEe2bKCpo3/izuyKqjoxKmnv9OhJf9y9V3K7s0G87OS10Z/jCyifb9OGli1cwI4rzDYm9mBqkaiG76cDL9BAUC+OCo9SSe4QIshBmUtuus+xnFwDoflgwnAVXFFAKLcvwCRb2rSKNBSOqkX7vJ9wZ6rbVaAVs2aT+/oNtM3ZSdGEMMdskl10ss91DosawgOL5nFjAspy/iKqRkL66JoVPDeCoXbMm3ht2cz5QJjg0V99QdXsbHUaEGfcOFTkGSR0UWN8QLvPukSuMWPGKCACOtz+p24d9gfhL25ct17RgDIQ0UIYHhphEYQw24gi0U+nNselFUIIIMRjyU/7PoIvnACKLhssH2rZ8Cny3L6TVs+YSfuXLs4zhPsWzOUmVc+1ei0oImEf/UYFCOcEN+m6ZHavXEHd2r9C1cvbcTIcrpUs4aKKlpl5Qr/loRQce4atotjcj0WNFfRRkyxoI3g5eviIRgsWHELc584YvTYsOISWbVLND4TSJOdnkAkQTpgwgbBN9+fvf6D3hRn02LqdtrrOp13zXQwhdJmpglAnbi6zWA4smstmGKYXA+xcktOb4MMrVpD35s0U53GU5o79lZrVryt8QFuqZFeONSBeT6wQafNCGx7aL1WHqMjZUvhmQ4YMUbQiwnf4i+isgAYEhLJ/EF3UagkLli1ckXrTbB5CaMNEvTa0FghRy84PhEjIYx/41q1bqd8779CnAwbQwfUbafuChQLC+br2K1ddhKwFUEK4f74THV7mqm/N2sDAwec7unE9p2CQA1w5Ywa9I4Kf6sL0VrXV76cR4MkCRb8BfemBaqt/qdCCRpdte3nxEQ7wDxHCY+MXIEOiGsChlR+Vk9wg1IoxIGVuEr6hPGUdAEIzy2S1Ommdq5RyCPFG+/7772nPnl3U8+23aZy4v3vZStolNOM2Fxfa6epKu13mccsWxjMR/e6fP5fBxK0HVnyI4CN06wZORntieH2/G3ns3kER3p60buF8GtizJ5tdBCCVURfWNKuuF9ry97/u0V8PrOTUUWg8mGSY5lXLV7C5BYSAz8fTRwFRCjqq8T1S8gIhRPYNouET+UIZpDxsECJR/dVXX5Gfnw9179iRXMdPpJ2LltKexYBwPkOoA9GVQTyw0JW2zppOO5xm0tHlS3hcM3jLRores5OiD+3nnTMbVyyhKWNHcz4XwKFVv5pDBe6Yr2ijWxNSwc6GfhPf88ef9wiNzqUePPXKBwzcwBQjjzjq55E5INRqwvxCKLUhcmhI5sqGBoshLOyUTiFDiM5qRMY4sOZjYYrXzZ1HO10W0b6FS2j3vAW029lFwOeaLa4uPMiERHa8xxHy3bqJV3o4/fgdDe3ZnZ5+rD7Zl8tOuTR87D/0+SdDeQEqSq/ZU5aLrfuI2xbNm+vOv3u7q2KOTUEYEhiSA0Q1jLnlDqENOVrmVqesHAA+DBAePnyYzyrBXpqx4nb1LEzEAcJltHuu8AnnLVAAhDb0WL+O9q1eQc6/jKaPenSl5nVrUQ34d/pjOp6oV5Pe6dmVRv78Pa0SGlGuesG+IDSioDdg9crlSjuf+nUttX6gsQuHqABC7Mrz8fHjJgXcoovG3yeIAnyDFQkJDGMJC45kMQehenAJkqxvCkBNGVoYQRIS2Vf0Da2WwljYEN64dZOrJvjdqJpYCiH2USMyvnjpPAWJwG6V0zzavXA57Vu8gsVr7QY6uHg5rZowhb57bwC93Kwp1XXEOTA2VE8EFt1eb0cjPh1Km1cvJ9+jRyjleAJ3aWNmJTY2mptlX9TNC/Pql/G6ZhXrv+Q6EczVrly5moeYMNDErVx6+IL8QliCA0IZwtCgcD2I4QYgmoMQZTw1iPLYM3mqprVDiLNFEBnjGC9s19qzbiNtE9DtWLyUTfOgjl2oVe36VNemHD1brwF1fPUV+u7rz2nrxrUUERLI23KxNxynKWA8ABoVCzp9A3x5M+yAgQN4aAqv14eDBz08p8xjuB3ztPjHvv56BMXGxDOEgFENnxSpDXUgWgYhatNqEJE/RFoD4EEjGoNQDUlph3DNmjXc2ArNBZjihQ/sOnMWjf72G+r7dhca0q8fzRbBivvuPZQcFU3nT2XRpcsX6OTJDAqPDKOE5Hju4MEQfnCYsDzhIeQV4EPRCTH0y/hfqXylCuRQzZGead2CTp3NEhHwfbp97y4fA2G1AMpz2LBCFlsGur7dnZKTUooUQjWIuA8QoRHlQYvWDCGODMOcMgITDL6jUcRtzy7xHHpTVFgoa8fLGKwXgOLIDphYmFss3IwTACalpfDGCb/gQPFxIoVGhVFMYiztP3KA9+PwgqYqDnTw6CHd5v9/Hjw82nDQoI/Izq4iVShvL8zJdm5YNdZZjaAFIgMUXd5QNdhkBkIsUYpBcCIgTEs6rjSGSh9RmmRoRYh2cbpWCgqhurkWZUX4pXhDyOk6Y10yBvsGBUxqydFprfk6Zm1kgywGopAtQFIfh2RiTyKE9+9IiYrgrWTNsaTJTrdlY47z3IcHPH4n/aV7J61YsUpoQl0J75dfxjKAnp7e5iEMCbUYQkzfxUVGUVJsvNKpLEFUn67OB1hfvlTkEEoAcYtEupwxxvB/QSHEsW1qwe8AfDDZOE4C8EF7StGCCG34wccfUgVHBypXsQL1HzDg4QJQDeH5cxepenXdOcjtXmnPEMIcm4JQglgQCLH+Qz3Di1u88DDPSPpCE5rb3l9QCNUAQgvisBtAAhALA0Ks6VOLDr5Ifn75OQ4NzRXChYsX8QJ3bAjDsk40VbAbZc0+YG5Xt649eJE2YNy0cYvR+ZLChhAJbAminNGQM77sK6pOdyoKCNUAylVv+NuYmDPVtGoJhLzzW5FgBT5TEEqzLCFs3qIFL+asUr0abdyy+eEGENf69Rt5kTakX7/36GTmqVwhhOCJtQRCreB74CehrpysGixSD51j+AjtVdjKcBNbG27qNCT3/Rk5/jU3uYATRy9d4ZNEb9y4xeYXR8ACeGV7gkq0EGqPkgV4mGLEABkGyWTHOZ4Luc9bLRgeM5AQnUujfI8w0fAToZH79OnDWhAQPpRmWCnh/Xmf7t7RvbNwumbz5i34XAtow8OH3dl0FDWEiJABnjEIYRqT9Svbsk6fYsHqjuxjv24ZiDnNd+UytN5lPlTw9OmzCnzJRpYhGQNR+zUJH5YLRIaHmoQvrxB6eHjwY5o7d65uN6KIiP/zxOOKGX4krunTZ+qOLBNRcv/+A8S7MqbIIZSLkrQQGrzo4j46nbnbOS2VXxQAic1aasGSI7UoXzt/jgUmVx5yaA4+YyBCSxmIHj4srNdJWO4QhhmK9ut402HvoVxDB024aMmSRwdAHo4SGqJmzdpUsYIDVa1SnbZt22GgDYsCQvQv4gXQQqg+OxjgScG6DuwOxJ5p7Q5qeSiOFHlwovxZ5PDwQstFRnkBUA1iTohCNFIwCOGT9uvXT2lM6Nuf79sgKQ15ZEAcNUo3BgAQhw7+hGIiY7iZAbdaCDEOoA1O1JIXCNWdNmhyQKAiYTQ3WCTPrlMkMZnFWEBhyqRqD0DELUAFsNB2iGiRy5MpldwhNCeG0Ml9jRiNhW+MXdYSQJwQD61t8yhe6ekZVKVyNXJ0rEK1a9QmjyMe3NqP3kIthPJYCVMgWgKhFJhmTOlxVaWYIZRnzwFALXwyei1MCPGmQzc7nitMOT71ZEMetcAwGlYVP5IAyrzh6NG/KMnrvu/243mSnAAGG5xvYgzE/ECohrHwINQdCQvhMpkUDYBSA8oqhjaZDCANxGIIDQXPGZ4/ZAf69H5Xmfnp37//owmg+jp16gz7hPYVdEt01qxcaxRCuZlBgmgMQvXGVksghBQ3hFIDauErKghhjuF2LFm0iGd9ILWq12A/2KbssrEZO2asbk7Zxpbe6tCRk9NobD3m7kmeHl78sXpPDUQ9hZenXdZ5GKSHRlQS2tqmgeRUbrhQRGNys0HUAYgTr9SihVULnRzYkqKFEJExGhNMCadtVIJoGpUTpHWCAvz4ucNAGcwwutsxZrF5o84MYwbnkYVPLk88LyLlBnUbkKO9I4O4avkq7paBb+h9zJs1oXZDAxoaWPT5L+22fvUW/7xCaOArCnMJn02BTA+fAqNJrZk3CKEF1WIMSgVAvMnCLIMQuyKhAbGqD1UUvLl69+qlbMfAUvYy9Qe/8I/sVMBXn3+laENs+ISWQ+OCPNlJCyG0o050Z+DlBiF/bAGEeNE5GNBXFXQtU4mUkJCUQxPmB0IlAZ2QoIhWE8pghe/nA8KYqAgFQlRbpkyarPiBWGR5++ZNfu5xGnwZifoL0FV2wAZXO6pbux5t37KdQZTnmWghDPIP0ovOTJuCEOeXWAohBOeq4NBHSDCOvI0QMEbHKTAaK7XlBULtURCyfq0GEsIJatWbwlIIgwP9FXOM498QCWMbBnxB/M4y4kxcHTt25IZXdF9/O+J7frG9vX11x0pohuO1GxuyRQep3PQlS1U5p/WizIjxndg5kuRC00Dwgp9IS+E2KjSYShizJfcGBe3X4RKgH9LYwUDGDg/SLo4HxLo3TwS1bt1ayQk6OTmVAZjbhd0qjvoli9279eSaJzqvscc6vxDKJG1BITQpIgCAQOPgNHVoPdwWBEJuNYuKKRCEcCXwuzAWKgHEyVBllJm50C2C7D0SqPXqNSCPo57choS1wQWBUJdXLFoIpUALYniopCGESccgFCwLAHzhhRfokY6CLbkwDlqvXj1+4vbu3ac0ZuYXwuzkdtFCGBYSzH4YTDPMckEhlIdAGoNQe86zMQjhZ2J3oZ0+GFm/fn0ZgHm96tSpo3/ibLnhNS4ugWeTc0AoZ5RNwJgduOhEC1l0RLQZicxVZDkMAAI8aED4hej5gxgkqpOMd07L9n7Z4q9UULCrOzTcAELt4eKxelGDCO2Jkhwg3LJlC29EQ5tWr169ygDM64UXQvovlSpVpt279nJgYtQc5wFCdWe2nFWRQ1PazQ45JfcuFQQOqMeiz499QD18EHycG4Tac4phOtUlPF6VrDnRNC8QYpYGFgANCjj1HW4N3tBubm5lEOblwt6aTp06cWSMd+/zz7VlM4ygxN3dIydoedSEObtxDIE0KcHBuYoOwDglGJHwScHJmxBTmlAeEYv2fpmwlg0MrGFzqf5ogZSpKIwyQEvDDXn88cfZH2zTpk0ZgOYu1C5Xr17NTxYv1LS1ZU04YcIkZU2IvzHQzEBozjwbb5LI2TBhSuQhjtIMQyyFEBoQ8MlUinrXorlSpNYfxExNiH8gnw66dPES5SR5dE6XUZbLNeC9AYrmA3y1a9dWOjtyDD+ZglAr+YRSK8bOX8YbAgIXAWcSo7wmB5WkWVWg05vm7IR19olNkBwHRJoJgMx1CcmznGGKUZ7D6QloUMAy+TLSTFyurq6s+WxUixdhPtDtqzsJvmAQmoum8wKhsTOYpWBGAyDisRoMLmkglIJZZ3liJzRoYUMIFwGZAPzuZ59pwbvBe3XvQbju//V3GYjGLuyzttFv+Mdt8+bNaenSpewXQcPkOGJMC0kxQag++BGCIIkDJb0mRKODQfu+CQjR0SyPj9Ulzy2DMC9n++F3ozOGz5YTEE6eOJEe/H2/DEJTF3brqbUgSks49xg1W36RNZqnJCDUgqfM8IaEGzQjsBk2AyECGbUUFELtzyOtA3M/ZuQofSOIDX++jDQz16uvvqpk9GvUqEVeXj78YrPP5RdsIHmGUC/Yd6gWY6cDyN9lbBOsQe9gUnYTa07RtO3nAcL8mGOzh46Lz8HXfP+9Afqd0k0YwH/vPygD0dSFTQQODg4MIQKTjz4awp0qqBcDRj/fIBYJoVaDFRRCaEe5GzsxLpGPRYUkJySzKJ3ThQxhTFSUSYgsEWMJdPibOLgIQUn/Pn3L4MtLYAIIZXAiN3QBQmjC4oYwJTnVQMxpQlMd1uYgNKYFLYEQPy8T5RjSAngQ+Juolsi94M5Oc8ogNHc1bNhQAfDFF19kXwvwyZPfixpCrTkGiGopCghNacH8aEJ0SqvlZEambNdn2bdnb/bZImWBSc5rz549vALEwcGRFyONHz+RNSC3bAlAsCpOQijFHHQFFSzjjAyNprhoAVJsMvcySgF0aOtPTU2ntLQTLOYGo4wJAhjkFXNsV9DPHKtFajm56FMu+9SeDi8FEM6cNl05yg0poTLSTFxoJ3/33XcZQlkjxi4aGYkCQl1SOKBYIYTI7bCAEa6BlMjIaBbpLkBr5wdCNYxaQd1cLTmXYB43ejq8GsKfvv9Bd45gvfp06/qNMghNXXgR4AvqtnLZcEACLSO3+WcnhoOLHUI1jDItI+WYhxc/LoCIFn9Lj4Y1O1KqCXCQ2FaLOQizMk9yMAJ/EEf+lpFmNj9Yjld/QAtic6tSCvMLZG0YGhJZ7OY4h2iS5ehrxNImmOaUlLQSgVCtFbUQnj6ZRR3av8ZHt3Xp2KkMQtNpmctUp3Y9vfNsR+1ffYPN3KFDR5QgJMA/hMXfL9RAShJCPMYcgUkegAKcaFTIC3Ra8yxTRYokJiq+ofQV1XL18hUaNmQoT9ShYvLtNyPKQDR2YTkmVsFhcXrFCo40dcpMnmBDXlDCV9ogRHUER11YAqGEzNRknTEwtVDKvKUUgAb4ELBoqy+QK5cuscZ86YW2/CZHqgaJ67/KRjqzr/t//0OdO7+tpBAaNWrKsMHH4lYtCSBefIbQsGJSUhAa04J5gRDaDHVlqdm0mxq0gQi+11ASDARRtdzeZUywZRabYFEE6Nmzp97vtqEOHTrw18oIFBeiSviBWH4ETTj442HiyYtTWqUMIAwIKhUQmtKCeYEQwEAAjzmAjKVo4H8aiuH3a38flnJi8ypAxCJ4dFYjD4vOaizCxO985CH85JPhei1YjkHcumUnBeGgHBGEBAaEGl2ebiDFDCECJAQjiIQ5EBERvBSZpNYuOEIHUFBQEA/My2YM3EfHjRaySDQx5CK5ARvFa0piKCwshCX9RKqAMNNArl69TLNnzyS78uWokqM91axZk7u279/PuQBTfRrrQ3udPXOeAxJoQuwi7Nu3P0VGxHIw4uXpp9N0pQxCGa1DG8rtC2rR7o6R8AE8CI5Qw8d44eVaj8KEECc0RWDeWdxmZKTngBDn1d25c4s2bVpPVatW5vME0Ta3a9cueuT8QNw6Oc3lgKRatRqsCRcuXEzhYdEMX04IA/SSz6bWQhCU+WQ3tWzp0uYNod3Ukv24daIstxTaUa6BswTCyOioXAXn00XHRfNhiGkZqZR5KtNAcHwYbm/fu03efl58sipAhK+Ivs1HCsTff/+TmjVrzn4g8oKtWrVhM3fMQxcRh4VGGfiCpQFCTljrewcBHCBEBK8WLXRaUfuCav+tsCDEgYhJKUmUkZXBooVQSlxCLN28c5PfEG3btmU/EZ1LaCB5ZCDEADvqw0jJlLOpQON+m8S+oMwLZjcp6BtYFc1SMhDKgx5l5cbUrAnMr1owrCSXW0rzm2sgYhZC41DiVE7cQtOlZ6abBFBrnnHCKdJE7du3VzIUc+bk7LQx5jNa/dWrV28u0Tk6Vqd6dR9jDRgcHJ6jIlIaITQm8nEa26yaF/gKAqECIM5byQVAYxAiTYMj1BBQQSNKEBcuXPhwgwhTBi0ok9M/fD+SYmMShdPvbzUQalv8pRjbJ5gX+PILoQGAGbmbYGMQynNVcLwZxmy7dOmiDJctWLDg4TXNOFgbWhAtWzVq1CE3t4MUF5tkVZpQCyGiZYglwBWWJswG8GSuAJqCEJWa06dPK9KtWzcOVBCwLHkYD9KBD1K3bl1F7Q/+eCinOuRaj2wAdX6WdrCppFM02kPAJYzmNKQMaLTJZkuhC8Eempg4vh8UEsrgqQXmtSCCo29x3t4HH3ygO1lLBCzHjh17uEDE5D/+MQy3V6tWjXbu2K0crq1z8q0DQnM+oikpKIQxcQnCBEfzfZwWUNgQQhOePXuW70vT3LhxYz7/+aEAEO8wlIoAIP653r17s5Y4cuSoAlwZhLkLjioDiEnHUykz63ShQwgAES0jWEFQBQCRzEbD8UMB4YEDB5T1HoAQyVEU4WWzAhpEyyA0UzERpjjtRAadPnueTp05W+gQwkcEgOjquXnzJm3btk1xnR6KXYbYCir/oZdeeomTtxI2U5KjYUHT2mUtEOoi56gCQRiXkMjaTy2WQohOa7UY+x40OwBG3ALEUaNG8bpmbPSCT2+1AOL4UnRuyA2hyEOhmP8oQGgKQEsgBICp6SeKBUI1iEjbIHpu164dv24//MDzKjZ//21Fk3pIcOIBd+7cmX0LBCXPP/88VxOQR9Oa29IKoUl3II8AWp56yQlg1ukzBYbQEgGI8A/RArZzx05O2QBEpJKsTguiRgpfUAYk0IJo2Dxy5MhDD6HUgIUBIHzA3CAsTAClZGRkcD8iUjf6Qxdp8ODB1gfhV199pZhhDLQj6Sz76bQQaqHLCWGYoRQxdNo3hTb/pxU0YaDrGgGEzOdZItGx8cqB3bifcfKUgWQJ8NRiytzmgCmfoCJIwS2qKnCpqlSpwoLXzmoAxD8h171BfvvtNw79oQW9vb1LPYRazSaTzqaSz7KvMD8ASgiRBwSE0H4lDSH8QWhD3EdQMmjQIH4dhw4dSlZz9NiYMWOUfYPYNYiIGL4gmjuRic/ZCFC6IFRat0KCWUIjwg0Ebf5qYQCjYhgkmVSGhMcYFy2E4ZFRdDwtnU1tesbJQofQEh9SmmLcwj9EIhvaUKbZrOY4WiQ7pRacPXs2d5YAPkTG6L/TapvSBiFmYCAh4WEsaBhQi9zCoJX8QgjwACGkpCFEdAzwZJMDtCKS2X379mUQS3XvoTwhaMqUKdw5DWnd+jnutzMXeOQUOd6p30eoTZH4hmokd7h8PP0MBD2MaJxAEy26uiPCY3jEICdUkUaloBCi+gFJSErmJDTAO5GZpYgWGgChlqKGUN4CQtzH1N7y5ctZE7Zq1ap0a8I7d+4oJzBhvwy27sNMlTSE2q1cOeCTUowQSgAN4JParwQhNCbwC9F7+PTTT3MCu1Sna8aPH6+Y4RdffJnPHNEtuSwZCLU/J7tgcsBXzBBqAdSa39IGITQiegCGD9dNSY4cObJ0QggnFqOEOghtafr0mcqewZLWhKFB4QZiFMBighCfN6kBSzGEyHhgjR9eX5TyShV8spQzZ44zd03DF4QWlOfQYdVbzqZV7TB73mCyZL+gvI2JRPokwUCMldJySy4XRj8g4AwNj9RBd+KkIpkZWdkiXmzph+kkg8VYU2pJCCLjpk2blr4KCiC8ceOW0IK1GULMEmO7FiBE6gLNnsUNIQR7BQEg35YwhAAQICanpHElRA2hAYilFEI8FnTYIPjEJjUUIVxcXKjU1JLxQMaM+VW/Y7AcdejwJsMn1/3qUjJmUjBFoAkBYEJMUqnQhIAQiWxoQWuEEIKdOGhyRWsXUjU4urZUacIqlaspe2VWrlzNLxT6BHWbTMOLHUJFA4rblKT0UmGOkYaRvqC1QQgtiMeFKBkzyyjhwf+/dOkSlQoAf/zxRx5khxnu1+893YA45jBUol3tlnPVmwkI5YJ0n2ADMQdhbFSCgWghtLiptBCaUgHfuQuXuCpyMvOUIoAwPT1Dv/86jQVBHlcrzmQxhFjtoRa5rUsO1BvL9RWldOzYkU1yidaS5Swqlv/IjmlAiCCEl56XQZhDZGu+WhMaBCUZWQbJYpTNsEMGJ8XLU0KlyJFSuemruCH8+uuvuSS7aNGikteEX375pXIe3bBhn/ILhG37Wgi1ZTdLIbTUHGfDF2fQXJDfLpeCCmrDaFKQgcnp02cNBJpQJ+kseHND08XERFFUdARLZFS4IqjDA0B8H0xlcUO4YcMGnlHWt3mV5DB7EKtkaMLatepyAILkNC891/b/5QJhrvm+fELIwUhkXLb2iilZCOXIJiol6JTRLr3MljhlVw3vqGHgwljCw0MVwdfRmwnTbTRvWATRsVrgFwJCpGtKbEMD2nnQ5ChNMc4eQTcJTLHBkku95Ew2ayobJsyspUsxZQOCqcDDnOTQYCYaDvLjE6rhN/X3Fa1tZEAerXDYcYP72PYKAHOr/xY2gDJogqDBAQejQwnhjVMiEOJdiggJbfstW7ZkE4yKATQhFp/nOBCxmCHUVjKsHUJ56A60JFrvcwOwKCAEePBRpWCRpr7Tmtzc3EoGwmHDhik14unTp3NnsTwJHaW6woYwr+uCtRAqZTbNKjVLITTXilXUEEofEf6fMfNYHBCqBakZ7KyBJpw1a1bxQ4huiurVqytaEOAhJyh3s+BjLTBlEBYMQqn9ZK9fSUOI9BEalKGEsMOm2CHEPCqqI6gRo0kBT542Gs7RvaIRyyHM2xESyqo28WYw1lBgDoKihlARE/DlEP1SzZKqFZsCEU2ueFNAGTVr1qx4IcT0FTLlABBbVmWXdGmDUC46t1YI8dgR6MlKRWmDEH4hRkKhBZGig3YuNgidnJyYfqjhn38axQlXg3NHTETDxQ2hsuTcSiGUpwTA7KFUVhog1E7jwS+U/aPIGxZbiQ6dtagR16//H46I5ZB3aYSQz8XTa0NrgzA7kX1aKeGVJghhitHkqt/+L5tdi3p+5E9OvcgmheHDP2OfC+eOBAXmMnikTzYH+wUZSNENKhkOzAeHhnO1oqQhzEuXDSQmHouP0nM0oWaeyjKQohh4t3SVnJzIw95JKKdi0YQfvD+I1/zaV6xMmzdt1R+56pP7RoQShjAwOISrFdYAIaopABCQlXYIZX/h7du3ebEmMiXImhQpgPD9qlaBL1ieOnfqxqcYoTKCc0f47DnNIFFpgJBPA8DgutCGpR1CHYAZCmSlHUL0Fcqd1+vWrWOTPG7cuKKFcOpU3VH2FcpXImfn+WyKPY/5Kua4NEMIbaj1C0sbhAwg9sxYAYSAT7acQfAxZk6KLFXz15+64nS7V9pz13TDJ5voDr1WNSYEBoTnGDxS2q58A1m0EFrammUphNpACUNMOMAxW0ofhLx9SwB2PC01B3SlTRPKgEVGydg7hKxJkc2dpKam88Z9JKiHD/+S4uOSc3bHlHIIMeJZmiHEHmo59J6anlbqIZTd3zKFhP1CsJRDhgwp3K4a+ctmz+KTfjgqXrN6AzeF5nlVWwmZY0shNNkHWEwQIm2DFSAnTmYqwUlphFCdrIbIRDqKGFi4jsF4aMdC14RdunRlCNu0eZ6Hl2QwUgZh4fYbYiAe55LIs0lKq08oFybJFA1AxJoQdNOgta/QGxpQIwTdgHDEiBHcyWGwzChH86o+We0flKsU13pf+XiCQyMpIjKWIgWALBZCVxyaEIsxMQzFSzBNDMEX5WLM/GhCKWiwwAqYl19+merUqcNRc6FBeOjQIR7vQx5oxYoV3FGL7glrgzAwKIxCw6NLLYRo/ZdHRKg3M8A8Q0obhFoYkbyGScbmNawXdnZ2LjwIMeiMAjXCb966j6XnfIp5UMGkmCEMCAw11Ib5hK8o84RqbWhtEKrPQ4E2xLk1hQZhp06d2BR3796dW4qwLBGzJdYGIXf36LUhg1gKIAR0Mn8JCI1qQyuDEEnszZs3s+LCbYEBvHv3Lich0T2LbDjsvpeXl9Gd0xYfMlPMRz7oJv5CdOOeESUPIYadJIQISuQ0HiJkLEo3MMlGFiaVhhSNMZF1ZWhD/fk1BbuwXVWOc27dupU1IPxBaENrg1BqxNIAobqbBhBKAGWuUM4mWyOEUnBSA+IIDGYVaMc1aoJy5zSAREISILI2tFJNiPOVSxpC2TEj99NIDQjY1KtCrBlCJLHRXaOfRcr/SCdMMGZL4Q/KE80xZYc+PWvVhIAwykR0XJzmWLaYyaMj5FklABAD8tYOIY4lwyJNnOiK1E2+QXz//fdZpX722WcUGRZJvl6+FBoUatEwes6jIvRHNJTAMWD4u2iZz9cxXzK1YybFk9sh2QaDVjHwC3WtW1mnTecDFSllEJoT5AnhuoGfgwcP5h9COJcwx3PmzKGo8Cjy8fTR5fisEEL5d9XHPZQkhAAwOTWFqyMPI4TY+I/yHU5xQHNDviHU53po7dq1FB0RzRD6+wSwWCuEcnFnSUMIDSjLc8Zat6wdQpT00HsAnzDfXdew6TVq1OAtC4cPH2ZN6OnhZbUQyjOUAaExk1zUEGpnn6H9IHkC0AohRFMDfEFsc9UvSbD8Asn4YZxZgVIdzLD3MW8dgEYgCvIJZTF5TFcJHw3LwVNQCANXUhDiJCjMkBhrUDAn6n2GLKUcQtldg2wKONq7d6/lIAI8/HCHDh14EY+ftx9LGYT5gzA8MuKRglAewINUTYMGDWju3LmWQ6gnl4dY+Ew6vT9oalVbaYVQpma0EFrs05U0hCetS1BdQzkPbh0qJ/oDGi27Vq9ezTlCRDbIDRpowTIIyyA0I2hkgBbErDoUGY4athjC+fPnc44HCWuG0M9PVzM2UjcubsDy09Qq14LI4fLihzCKB/HRoKA9xw5i2sxm6MW6IER6Bn4hVshNnjyZqycWQ4h1b4AQJ3TmgLAUg2gKQqyrw4RgGYTFNxyPW5hj1JGxv8jiygk2b6F7Bo2sgNAAQCuC0C9AJwCgQKuCSxxCrZT+FI0cgkJ8UbVqVTbRFkGoz3Jz98zDAKFsFiiDsPhSNIAQ98ELuq1RRbFs5YdwJgEh6n5I0RQUwqIa8TQ19K74gsEhRnfRFDeEsmVLHiWBGWMDUQ7U1i4jMn54jrXkCQEi5pIwdxIYGGgZhAPeG8AQolqC7hlrhBCbIfDCF8q2/gKX7XTaEDCihZ9Pc3+IIVSbZWhABCaYP7EIwj59+rBPiB8EwdYGIQDkMc/COjKiECBU70rEWSYPM4Ty1HipDdHIgKE5iyDs3bs3z5Aq7fy5AJiX7frFDSEA5DPsCuvMkkKAUA0iuqgNtOFDCqG836JFCzpw4IBlEPbq1YsbGNBNnTfNV7iH4ZhddKQ5uhaaDwc5Yl4jVLUmOFv7RGkkpphF93dlIwOS16fOnFYaGMxtXLBmTYjhJySrcTqoRRCimxrOpBzxLG0QavOAYaHihQ2LVvyu0g6hbGo9ffYsT9M97BCiN1W/1dWS1R9dqH79+twFYWywqSQgNBjfxHJ2of2kBoT5xeyIMQBLE4RSUL6DNkQJzxyA1ggh/EDUjiWE7du3Z44sghBHiWLcE5ExgpPSpgmh+dTCw0tWBGF0XCxrQ9yHNnwYIVRrwtdff50n7yyCEEcD1K5dmztojE3XFTeEHke9yccngJdy8qCSHjoFvki95ABQHqYTU8KSc8ZECswy/ELZ5GpUsEBTJdZgjtU7DN98802+b3F0DHOMaklpgBBmFxoPES/2I1o7hFoQk1KO5w6iFUIoa8jY5opNHthVYxGEAwcOpIYNGyqrP0oKQml+of0AYFxsEkOoQKcVK4JQDSLMs1kQS9nidHMQwieEFkTFLV9Hjw0dOpSaNGnCp0uWpE+ohpA1nghAWB4SCE2B+DBAiBERnHWC0c8ePXpYDiEaGJ588kmu+zGEmmR1gFqKIOksI1+YYGNLLY0dkGPNIis7iJoBInKIZ86fE3KGxdogRGs/AhMcPYZpTawRztdKOJhjQGisahJQRCCqIZQA6rYmWDgTYrUgxjCIWJ6uM806sTYI0cKFW0CIufUxY8ZYDiG6YVHvg08IdVrcEEoAo2MFgDEJDyV0xkGMUUCERkzPxOlOyCVmGog1NLXKdSDffvst96Xm6yDFpk2b8pEAObqqiwFCRQMCwKi4RwZC6SPCj8VtQnI8paanWB2EMjABhAhyLa4by41c2MYFTajUj/MDoamva39eL/LAxofZ7FoUwMREsCSlJLFWPHHyBEtphxBpGbRwQRsi3aefY7fswib21q1bc3RcXBCGBOoAVK/pKINQB2FUbJQBiNZgjqENASOqb/lapI5yXbt27cz7hOZMbB4hBIBYNSIHkcogNIQwPDLMAERrGPlEhAxW+vbtm781IDjBEdsXjEJoiS+YBwixYgQAxkbFlUGYC4RqEK2hvR8Vkk2bNhEyLfmCEBTDlmNW18fHjxcKZUtQHiQgVzFYsCn8QCwqkqIFUSdRBoJyomUSrZHIAon28RS1QBmoJSEhQdlyUBohhBJD4wLWfyxatCh/EGJyvn///gwIQCkqCLVD6cYBLINQCyEEOdzSCiPOPoYfiLl1d3f3/O8nxOyxDEpkcyuLGcAUyeV7JYQYSgdkABGCwAQiYSmD0DSEahiheUoTiHJJJjZ5oHSXbwjXrFnD03YA0QBCczDm4Xu0WjA0JJwlLDRCgbEMwrxBCImPjy9VICIyTkxMtLyl39g5JqAYAh/RmOCsWwjsPxzRa9eu5RB8Dd+j/Vn8Xvmzlor8u+ZEfr98bDARhSEoRxWGIJkLuX37Nq/JwHOulnv37rH8/vvvfBQDdrsYE7hPDx48oH///Zf++z//pf/93/9l+b//+z+jUtQXHo9aLOHu/wE86/1bxoqXvwAAAABJRU5ErkJggg==';
  const sheepImg = new Image();
  sheepImg.src = SHEEP_PNG;

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
      const imgAspect = 161 / 201;
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
    const duration = Math.max(1, Math.round((Date.now() - recordStartTime) / 1000));
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

  function displayAudioMessage(srcUrl, type, duration = 0) {
    const d = document.createElement('div');
    d.classList.add('c2p-msg', `c2p-${type}`);

    const player = document.createElement('div');
    player.classList.add('c2p-audio-player');

    const audio = document.createElement('audio');
    audio.src = srcUrl;
    audio.preload = 'metadata';

    const playBtn = document.createElement('button');
    playBtn.classList.add('c2p-audio-btn');
    playBtn.innerHTML = '▶';
    playBtn.title = 'Play';

    const timeline = document.createElement('div');
    timeline.classList.add('c2p-audio-timeline');

    const progress = document.createElement('input');
    progress.type = 'range';
    progress.min = '0';
    progress.max = '100';
    progress.value = '0';
    progress.classList.add('c2p-audio-progress');

    const timeDisplay = document.createElement('span');
    timeDisplay.classList.add('c2p-audio-duration');
    const formatTime = (sec) => {
      const m = Math.floor(sec / 60);
      const s = Math.floor(sec % 60);
      return `${m}:${s < 10 ? '0' : ''}${s}`;
    };
    timeDisplay.textContent = formatTime(duration);

    playBtn.addEventListener('click', () => {
      if (audio.paused) {
        audio.play().catch(e => console.error('[C2P] Play error:', e));
        playBtn.innerHTML = '⏸';
      } else {
        audio.pause();
        playBtn.innerHTML = '▶';
      }
    });

    audio.addEventListener('timeupdate', () => {
      if (audio.duration && !isNaN(audio.duration)) {
        progress.value = (audio.currentTime / audio.duration) * 100;
        timeDisplay.textContent = formatTime(audio.currentTime);
      }
    });

    audio.addEventListener('ended', () => {
      playBtn.innerHTML = '▶';
      progress.value = 0;
      timeDisplay.textContent = formatTime(audio.duration || duration);
    });

    progress.addEventListener('input', () => {
      if (audio.duration && !isNaN(audio.duration)) {
        audio.currentTime = (progress.value / 100) * audio.duration;
      }
    });

    timeline.appendChild(progress);
    timeline.appendChild(timeDisplay);
    player.appendChild(playBtn);
    player.appendChild(timeline);
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
