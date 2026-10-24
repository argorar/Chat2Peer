// ==UserScript==
// @name         Chat2Peer for Netflix
// @namespace    https://github.com/argorar/Chat2Peer
// @version      1.9.1
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
    { svg: '<path d="M2 10h2M6 6v8M10 3v14M14 7v6M18 9v2M22 10h-2"/>', name: 'Fart', url: 'https://cdn.pixabay.com/audio/2024/07/30/audio_c52f210792.mp3' },
    { svg: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>', name: 'Kiss', url: 'https://cdn.pixabay.com/audio/2025/02/05/audio_3a6957e546.mp3' },
    { svg: '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>', name: 'Long fart', url: 'https://cdn.pixabay.com/audio/2025/05/01/audio_7be5cc9c12.mp3' },
    { svg: '<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/>', name: 'Laugh', url: 'https://cdn.pixabay.com/audio/2023/05/11/audio_3f41bc76a6.mp3' },
    { svg: '<circle cx="12" cy="12" r="10"/><path d="M16 16s-1.5-2-4-2-4 2-4 2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/><path d="M7 6l2 2M17 6l-2 2"/>', name: 'Evil', url: 'https://cdn.pixabay.com/audio/2022/03/15/audio_6b3f80310f.mp3' },
    { svg: '<path d="M18 11V6a2 2 0 0 0-4 0v5"/><path d="M14 10V4a2 2 0 0 0-4 0v8"/><path d="M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-6-2.34l-3.6-3.6a2 2 0 0 1 2.8-2.8L7 15"/>', name: 'Claps', url: 'https://cdn.pixabay.com/audio/2022/03/10/audio_b80daabd57.mp3' },
    { svg: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>', name: 'Slap', url: 'https://cdn.pixabay.com/audio/2022/03/10/audio_367e863251.mp3' },
    { svg: '<path d="M3 6h5l-5 5h5M12 11h5l-5 5h5M17 17h4l-4 4h4"/>', name: 'Snore', url: 'https://cdn.pixabay.com/audio/2025/05/06/audio_47fc2577b3.mp3' }
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
#c2p-sidebar .c2p-msg{max-width:85%;padding:10px 14px;border-radius:16px;font-size:13px;line-height:1.45;animation:c2p-slideUp .35s cubic-bezier(.22,1,.36,1) forwards;opacity:0;transform:translateY(12px);word-break:break-word}
@keyframes c2p-slideUp{to{opacity:1;transform:translateY(0)}}
#c2p-sidebar .c2p-msg.c2p-sent{align-self:flex-end;background:linear-gradient(135deg,#e50914,#b20710);color:#fff;border-bottom-right-radius:4px;box-shadow:0 2px 8px rgba(229,9,20,.2)}
#c2p-sidebar .c2p-msg.c2p-received{align-self:flex-start;background:rgba(50,50,50,.8);color:#e5e5e5;border-bottom-left-radius:4px;border:1px solid rgba(255,255,255,.06)}
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
      <div class="c2p-input-area">
        <div class="c2p-recording-bar" id="c2p-recording-bar" style="display:none;">
          <span class="c2p-record-dot"></span>
          <span class="c2p-record-timer" id="c2p-record-timer">0:00</span>
          <button id="c2p-record-cancel-btn" class="c2p-record-btn c2p-record-cancel" title="Discard">✕</button>
          <button id="c2p-record-send-btn" class="c2p-record-btn c2p-record-send" title="Send Voice Note">✓</button>
        </div>
        <input type="text" id="c2p-msg-input" placeholder="Type a message..." disabled autocomplete="off">
        <button class="c2p-nudge-btn" id="c2p-nudge-btn" disabled title="Send buzz">
          <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
            <path d="M2 9a12 12 0 0 1 0 6"></path>
            <path d="M5 6a16 16 0 0 1 0 12"></path>
            <path d="M22 9a12 12 0 0 0 0 6"></path>
            <path d="M19 6a16 16 0 0 0 0 12"></path>
            <rect x="9" y="4" width="6" height="16" rx="2"></rect>
          </svg>
        </button>
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

    const previewSendBtn = document.getElementById('c2p-preview-send-btn');
    if (previewSendBtn) previewSendBtn.addEventListener('click', () => {
      sendPendingImage();
      sendMessage();
    });

    msgInput.addEventListener('input', handleLocalTyping);
    msgInput.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter' || e.keyCode === 13) {
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
    audio: '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>'
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
  function displayUserMessage(content, type, isGif = false, author = null, isImage = false) {
    const d = document.createElement('div'); d.classList.add('c2p-msg', `c2p-${type}`);
    if (isGif) {
      d.style.cssText = 'background:transparent;padding:0;border:none';
      const w = document.createElement('div'); w.classList.add('c2p-gif-wrap');
      const i = document.createElement('img'); i.src = content;
      i.onload = () => { if (!userScrolledUp) scrollToBottom(true); };
      w.appendChild(i); d.appendChild(w);
    } else if (isImage) {
      d.style.cssText = 'background:transparent;padding:0;border:none';
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
        const textEl = document.createElement('div');
        textEl.textContent = content;
        d.appendChild(textEl);
      } else {
        d.textContent = content;
      }
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
    if (np) {
      return {
        play: () => np.play(),
        pause: () => np.pause(),
        // -100ms offset prevents keyframe boundary decoding freezes
        seek: (ms) => np.seek(Math.max(0, ms - 100)),
        getTime: () => (np.getSegmentTime?.() ?? np.getCurrentTime()) || 0,
        isPaused: () => np.isPaused(),
        isReady: true
      };
    }
    const v = document.querySelector('.watch-video video') || (isWatchPage() ? document.querySelector('video') : null);
    if (v) {
      return {
        play: () => v.play().catch(() => {}),
        pause: () => v.pause(),
        seek: (ms) => { v.currentTime = Math.max(0, (ms - 100) / 1000); },
        getTime: () => (v.currentTime * 1000) || 0,
        isPaused: () => v.paused,
        isReady: v.readyState > 0
      };
    }
    return null;
  }

  // Synthetic mousemove to wake up Netflix controls & sync rendering
  function wakeNetflixUI() {
    if (!isWatchPage()) return;
    const c = document.querySelector('.VideoContainer') || document.querySelector('.watch-video');
    if (c) {
      c.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 100, clientY: 100 }));
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
          if (!e.data || e.data.type !== 'C2P_NAVIGATE_EPISODE') return;
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
  function attachUserInteractionListeners() {
    if (userListenersAttached) return;
    userListenersAttached = true;
    // detect seeks when mouse scrub finishes or keyboard keys release
    window.addEventListener('mouseup', () => { if (isWatchPage()) pollPlayerState(true); });
    window.addEventListener('keyup', (e) => {
      if (!isWatchPage()) return;
      if (e.target && (e.target.closest?.('#c2p-sidebar') || e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      pollPlayerState(true);
    });

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

  function broadcastSync(action, time, videoId = null, episodeLabel = null) {
    if (suppressBroadcast > 0 || !dataChannel || dataChannel.readyState !== 'open') return;
    const msg = { type: 'sync', action, time };
    if (videoId) msg.videoId = videoId;
    if (episodeLabel) msg.episodeLabel = episodeLabel;
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

    if (!lastPlayerState) {
      lastPlayerState = { paused, time };
      return;
    }

    const stateChanged = paused !== lastPlayerState.paused;
    const timeDelta = Math.abs(time - lastPlayerState.time);
    // User seeked if time jumped unexpectedly (>2.5s) without normal 1x progression
    const seeked = isUserTriggered ? (timeDelta > 1500) : (timeDelta > 2500);

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

    lastPlayerState = { paused, time };
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
      } else if (d.action === 'heartbeat') {
        if (d.videoId && getVideoId() && String(d.videoId) !== getVideoId()) {
          console.log("[C2P] Reconciling episode from heartbeat:", d.videoId);
          displaySystemMessage('Reconciling episode with peer...', 'refresh');
          changeEpisode(d.videoId);
          return;
        }
        const localTime = p.getTime();
        if (!p.isPaused() && !d.paused && Math.abs(localTime - d.time) > DRIFT_THRESHOLD) {
          p.seek(d.time);
          wakeNetflixUI();
        }
      }
      lastPlayerState = { paused: p.isPaused(), time: p.getTime() };
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
      } else {
        updateStatus('connecting', 'Waiting for peer...');
        const b = document.getElementById('c2p-connect-btn');
        if (b) b.textContent = 'Waiting for peer...';
        displaySystemMessage('Connected to server. Waiting for a peer...');
      }
      // Announce presence to any peer already waiting in the lounge
      try {
        ws.send(JSON.stringify({ type: 'hello' }));
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
            isPeerDisconnected = false;
            console.log('[C2P] Peer announced presence in lounge');
            if (autoReconnectTimer) { clearTimeout(autoReconnectTimer); autoReconnectTimer = null; }
            if (peerConnection?.connectionState === 'connected' && dataChannel?.readyState === 'open') break;
            if (isNegotiating || peerConnection?.iceConnectionState === 'checking' || peerConnection?.connectionState === 'connecting') {
              console.log('[C2P] Negotiation/connecting already in progress. Ignoring duplicate hello.');
              break;
            }
            isNegotiating = true;
            displaySystemMessage('Peer detected! Establishing fresh connection...');
            resetWebRTC();
            initPC();
            await createOffer();
            setTimeout(() => { isNegotiating = false; }, 3000);
            break;
          case 'peer_joined':
            isPeerDisconnected = false;
            console.log('[C2P] Peer joined room');
            if (autoReconnectTimer) { clearTimeout(autoReconnectTimer); autoReconnectTimer = null; }
            if (peerConnection?.connectionState === 'connected' && dataChannel?.readyState === 'open') break;
            if (isNegotiating || peerConnection?.iceConnectionState === 'checking' || peerConnection?.connectionState === 'connecting') {
              console.log('[C2P] Negotiation/connecting already in progress. Ignoring duplicate peer_joined.');
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
            const now = Date.now();
            if (peerConnection && (peerConnection.iceConnectionState === 'checking' || peerConnection.connectionState === 'connecting') && (now - lastOfferReceived < 3000)) {
              console.log('[C2P] Ignored duplicate rapid offer while ICE is checking.');
              break;
            }
            lastOfferReceived = now;
            if (peerConnection) {
              resetWebRTC();
            }
            initPC();
            await peerConnection.setRemoteDescription(new RTCSessionDescription(msg));
            const a = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(a);
            ws.send(JSON.stringify(peerConnection.localDescription));
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
        if (isPeerDisconnected) {
          updateStatus('disconnected', 'Peer disconnected');
          return;
        }
        updateStatus('disconnected', 'ICE Failed');
        showSetupBanner('Reconnect Fresh Session', 'Network route failed. Click to reconnect.');
        resetWebRTC();
        if (ws && ws.readyState === WebSocket.OPEN && !isIntentionalDisconnect) {
          scheduleAutoReconnect('Network route failed (ICE timeout)');
        } else {
          displayActionMessage('Network route failed (ICE timeout).', 'Reconnect Now', forceFreshReconnect, 'warn');
        }
      }
    };

    peerConnection.onconnectionstatechange = () => {
      const s = peerConnection.connectionState;
      console.log('[C2P] PeerConnection State:', s);
      if (s === 'connected') {
        if (autoReconnectTimer) {
          clearTimeout(autoReconnectTimer);
          autoReconnectTimer = null;
        }
        const recBtn = document.getElementById('c2p-reconnect-btn');
        if (recBtn) recBtn.classList.remove('c2p-spinning');
        updateStatus('connected', 'Connected');
        const su = document.getElementById('c2p-setup'); if (su) su.style.display = 'none';
        displaySystemMessage('Secure connection!', 'lock');
        setInputEnabled(true);
        focusMsgInput();
      } else if (['disconnected', 'failed', 'closed'].includes(s)) {
        const recBtn = document.getElementById('c2p-reconnect-btn');
        if (recBtn) recBtn.classList.remove('c2p-spinning');
        if (isPeerDisconnected) {
          updateStatus('disconnected', 'Peer disconnected');
          return;
        }
        updateStatus('disconnected', 'Connection lost');
        showSetupBanner('Reconnect Fresh Session', 'Connection lost. Click to reconnect.');
        resetWebRTC();
        if (ws && ws.readyState === WebSocket.OPEN && !isIntentionalDisconnect) {
          scheduleAutoReconnect('Connection lost');
        } else {
          displayActionMessage('Connection lost.', 'Reconnect Now', forceFreshReconnect, 'warn');
        }
      }
    };

    peerConnection.ondatachannel = e => { dataChannel = e.channel; setupDC(); };
  }

  async function createOffer() {
    dataChannel = peerConnection.createDataChannel('chat-channel');
    setupDC();
    const o = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(o);
    ws.send(JSON.stringify(peerConnection.localDescription));
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
        else if (d.type === 'text') { showRemoteTyping(false); displayUserMessage(d.content, 'received', false, d.nickname); }
        else if (d.type === 'emoji') createFloatingEmoji(d.emoji);
        else if (d.type === 'sfx') {
          playSoundEffect(d.idx);
          const s = SOUND_EFFECTS[d.idx];
          if (s) displaySystemMessage(s.name, 'audio');
        }
        else if (d.type === 'gif') { showRemoteTyping(false); displayUserMessage(d.url, 'received', true); }
        else if (d.type === 'nudge') { showRemoteTyping(false); handleIncomingNudge(); }
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
    if (t && dataChannel?.readyState === 'open') {
      if (localTypingTimeout) { clearTimeout(localTypingTimeout); localTypingTimeout = null; }
      if (isTypingLocally) { isTypingLocally = false; sendTypingStatus(false); }
      const payload = { type: 'text', content: t };
      if (nickname && nickname.trim()) {
        payload.nickname = nickname.trim();
      }
      dataChannel.send(JSON.stringify(payload));
      displayUserMessage(t, 'sent');
      i.value = '';
    }
  }
  function sendGifMessage(gifUrl) {
    if (gifUrl && dataChannel?.readyState === 'open') {
      dataChannel.send(JSON.stringify({ type: 'gif', url: gifUrl }));
      displayUserMessage(gifUrl, 'sent', true);
      const kc = document.getElementById('c2p-klipy-container');
      if (kc) kc.style.display = 'none';
      focusMsgInput();
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
      displayUserMessage(base64Data, 'sent', false, null, true);

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
