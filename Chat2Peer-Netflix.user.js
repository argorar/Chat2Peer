// ==UserScript==
// @name         Chat2Peer for Netflix
// @namespace    https://github.com/argorar/Chat2Peer
// @version      1.2.0
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
// @updateURL    https://github.com/argorar/Chat2Peer/raw/master/Chat2Peer-Netflix.user.js
// @downloadURL  https://github.com/argorar/Chat2Peer/raw/master/Chat2Peer-Netflix.user.js
// @run-at       document-idle
// @icon         https://www.netflix.com/favicon.ico
// ==/UserScript==

(function () {
  'use strict';
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
  let ws = null, peerConnection = null, dataChannel = null, sidebarVisible = false;
  let serverUrl = getVal('serverUrl', '');
  let nickname = getVal('nickname', '');
  let reconnectAttempts = 0;
  let isIntentionalDisconnect = false;
  const MAX_RECONNECT_DELAY = 10000;
  const ICE_CONFIG = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] };
  const EMOJIS = ['🙈','🥰','😂','😲','😭','🔥','🎉','😘','😍','😎'];

  // ── Klipy GIF State ──
  const KLIPY_API_KEY = 'myMchPMlqDxJKpeSzJfOLCFrTpZqdqCLLF9Uf6RPKjxIPmeqxy6k5EPgo2PFivAI';
  const GIF_LIMIT = 20;
  let gifSearchTimeout = null, currentGifOffset = 0, currentGifQuery = '', isLoadingGifs = false, hasMoreGifs = true;

  // ── Sync State ──
  let isApplyingRemoteUpdate = false;
  let syncInterval = null;
  let attachedVideo = null;
  const DRIFT_THRESHOLD = 1500; // 1.5s

  // ── Settings ──
  function promptServerUrl() {
    const val = prompt('Signaling Server WebSocket URL:', serverUrl || 'wss://chat2peer.onrender.com/ws');
    if (val !== null) { serverUrl = val.trim(); setVal('serverUrl', serverUrl); }
  }
  function promptNickname() {
    const val = prompt('Your nickname:', nickname);
    if (val !== null) { nickname = val.trim(); setVal('nickname', nickname); }
  }

  if (typeof GM_registerMenuCommand !== 'undefined') {
    GM_registerMenuCommand('⚙️ Set Server URL', promptServerUrl);
    GM_registerMenuCommand('👤 Set Nickname', promptNickname);
  }

  // ── Inject CSS ──
  addStyle(`
#c2p-sidebar{position:fixed;top:0;right:0;width:360px;height:100vh;background:rgba(20,20,20,.92);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);border-left:1px solid rgba(255,255,255,.06);display:flex;flex-direction:column;z-index:2147483640;font-family:'Segoe UI',system-ui,-apple-system,sans-serif;color:#e5e5e5;transform:translateX(0);transition:transform .35s cubic-bezier(.22,1,.36,1),box-shadow .35s ease;box-shadow:-8px 0 32px rgba(0,0,0,.5)}
#c2p-sidebar.c2p-hidden{transform:translateX(100%);box-shadow:none}
#c2p-toggle-btn{position:fixed;right:16px;bottom:80px;width:52px;height:52px;background:linear-gradient(135deg,#e50914,#b20710);border:none;border-radius:50%;color:#fff;font-size:22px;cursor:pointer;z-index:2147483641;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 20px rgba(229,9,20,.4),0 0 0 3px rgba(229,9,20,.15);transition:all .3s cubic-bezier(.22,1,.36,1);animation:c2p-pulse-btn 3s infinite}
#c2p-toggle-btn:hover{transform:scale(1.1);box-shadow:0 6px 28px rgba(229,9,20,.5),0 0 0 5px rgba(229,9,20,.2)}
#c2p-toggle-btn:active{transform:scale(.95)}
#c2p-toggle-btn.c2p-sidebar-open{right:376px;background:linear-gradient(135deg,#333,#222);box-shadow:0 4px 12px rgba(0,0,0,.4);animation:none}
@keyframes c2p-pulse-btn{0%,100%{box-shadow:0 4px 20px rgba(229,9,20,.4),0 0 0 3px rgba(229,9,20,.15)}50%{box-shadow:0 4px 28px rgba(229,9,20,.6),0 0 0 8px rgba(229,9,20,.08)}}
#c2p-sidebar .c2p-header{padding:16px 20px;background:linear-gradient(180deg,rgba(30,30,30,.9),rgba(20,20,20,.7));border-bottom:1px solid rgba(255,255,255,.06);display:flex;justify-content:space-between;align-items:center;flex-shrink:0}
#c2p-sidebar .c2p-header-title{display:flex;flex-direction:column;gap:2px}
#c2p-sidebar .c2p-header-title h2{font-size:15px;font-weight:700;background:linear-gradient(135deg,#e50914,#ff6b6b);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;margin:0;padding:0;line-height:1.3}
#c2p-sidebar .c2p-header-subtitle{font-size:10px;color:#666;text-transform:uppercase;letter-spacing:.08em}
#c2p-sidebar .c2p-status-badge{font-size:11px;font-weight:500;padding:4px 10px;border-radius:9999px;display:flex;align-items:center;gap:6px;transition:all .3s;border:1px solid transparent;white-space:nowrap}
#c2p-sidebar .c2p-status-badge::before{content:'';display:block;width:6px;height:6px;border-radius:50%;flex-shrink:0}
#c2p-sidebar .c2p-status-badge.c2p-disconnected{background:rgba(239,68,68,.1);color:#ef4444;border-color:rgba(239,68,68,.2)}
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
#c2p-sidebar .c2p-messages{flex:1;padding:16px;overflow-y:auto;display:flex;flex-direction:column;gap:10px;scroll-behavior:smooth;min-height:0}
#c2p-sidebar .c2p-messages::-webkit-scrollbar{width:4px}
#c2p-sidebar .c2p-messages::-webkit-scrollbar-track{background:transparent}
#c2p-sidebar .c2p-messages::-webkit-scrollbar-thumb{background:rgba(255,255,255,.08);border-radius:4px}
#c2p-sidebar .c2p-msg{max-width:85%;padding:10px 14px;border-radius:16px;font-size:13px;line-height:1.45;animation:c2p-slideUp .35s cubic-bezier(.22,1,.36,1) forwards;opacity:0;transform:translateY(12px);word-break:break-word}
@keyframes c2p-slideUp{to{opacity:1;transform:translateY(0)}}
#c2p-sidebar .c2p-msg.c2p-sent{align-self:flex-end;background:linear-gradient(135deg,#e50914,#b20710);color:#fff;border-bottom-right-radius:4px;box-shadow:0 2px 8px rgba(229,9,20,.2)}
#c2p-sidebar .c2p-msg.c2p-received{align-self:flex-start;background:rgba(50,50,50,.8);color:#e5e5e5;border-bottom-left-radius:4px;border:1px solid rgba(255,255,255,.06)}
#c2p-sidebar .c2p-msg.c2p-system{align-self:center;background:transparent;color:#666;font-size:11px;box-shadow:none;border:1px dashed rgba(255,255,255,.08);border-radius:10px;padding:6px 12px;max-width:95%;text-align:center}
#c2p-sidebar .c2p-msg .c2p-gif-wrap{border-radius:8px;overflow:hidden;display:inline-block;margin-top:4px}
#c2p-sidebar .c2p-msg .c2p-gif-wrap img{height:120px;width:auto;display:block;border-radius:4px}
#c2p-sidebar .c2p-emoji-bar{display:flex;justify-content:center;gap:4px;padding:8px 12px;background:rgba(30,30,30,.5);border-top:1px solid rgba(255,255,255,.04);flex-shrink:0}
#c2p-sidebar .c2p-emoji-btn{background:transparent;border:none;font-size:18px;cursor:pointer;transition:transform .2s;border-radius:50%;width:32px;height:32px;display:flex;align-items:center;justify-content:center;opacity:.5;padding:0}
#c2p-sidebar .c2p-emoji-btn:not(:disabled){opacity:1}
#c2p-sidebar .c2p-emoji-btn:hover:not(:disabled){transform:scale(1.3);background:rgba(255,255,255,.08)}
#c2p-sidebar .c2p-emoji-btn:active:not(:disabled){transform:scale(.85)}
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
#c2p-sidebar .c2p-floating-emoji{position:absolute;bottom:0;font-size:36px;pointer-events:none;z-index:50;user-select:none;filter:drop-shadow(0 4px 6px rgba(0,0,0,.4));animation-fill-mode:forwards}
@keyframes c2p-floatUp{0%{transform:translate(0,0) scale(.5) rotate(-5deg);opacity:0}10%{transform:translate(-5px,-10vh) scale(1.3) rotate(5deg);opacity:1}30%{transform:translate(5px,-30vh) scale(1) rotate(-3deg)}50%{transform:translate(-5px,-50vh) scale(1.1) rotate(3deg)}70%{transform:translate(5px,-70vh) scale(.9) rotate(-5deg);opacity:.8}100%{transform:translate(-2px,-90vh) scale(1.1) rotate(5deg);opacity:0}}
body.c2p-sidebar-active .watch-video,body.c2p-sidebar-active .watch-video--player-view{width:calc(100vw - 360px)!important;max-width:calc(100vw - 360px)!important;transition:width .35s cubic-bezier(.22,1,.36,1)}
body.c2p-sidebar-active video{width:100%!important;object-fit:contain!important}
body.c2p-sidebar-active .watch-video--bottom-controls-container{width:calc(100vw - 360px)!important;max-width:calc(100vw - 360px)!important}
  `);

  // ── Build UI ──
  function buildSidebar() {
    const toggleBtn = document.createElement('button');
    toggleBtn.id = 'c2p-toggle-btn';
    toggleBtn.innerHTML = '💬';
    toggleBtn.title = 'Toggle Chat2Peer';
    document.body.appendChild(toggleBtn);

    const sidebar = document.createElement('div');
    sidebar.id = 'c2p-sidebar';
    sidebar.classList.add('c2p-hidden');
    sidebar.innerHTML = `
      <div class="c2p-header">
        <div class="c2p-header-title">
          <h2>🎬 Chat2Peer</h2>
          <span class="c2p-header-subtitle">WebRTC P2P · Encrypted</span>
        </div>
        <div style="display:flex;gap:8px;align-items:center;">
          <button id="c2p-settings-btn" style="background:none;border:none;color:#666;cursor:pointer;font-size:14px;padding:4px;" title="Settings">⚙️</button>
          <div class="c2p-status-badge c2p-disconnected" id="c2p-status">Disconnected</div>
        </div>
      </div>
      <div class="c2p-setup" id="c2p-setup">
        <button class="c2p-btn-connect" id="c2p-connect-btn">Enter Lounge</button>
        <p class="c2p-setup-hint" id="c2p-setup-hint">Click to connect and wait for a peer.</p>
      </div>
      <div class="c2p-messages" id="c2p-messages">
        <div class="c2p-msg c2p-system">Welcome! Messages are sent securely over WebRTC.</div>
      </div>
      <div class="c2p-emoji-bar">${EMOJIS.map(e => `<button class="c2p-emoji-btn" data-emoji="${e}" disabled>${e}</button>`).join('')}</div>
      <div class="c2p-input-area">
        <input type="text" id="c2p-msg-input" placeholder="Type a message..." disabled autocomplete="off">
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
      </div>`;
    document.body.appendChild(sidebar);

    toggleBtn.addEventListener('click', toggleSidebar);
    document.getElementById('c2p-settings-btn').addEventListener('click', promptServerUrl);
    document.getElementById('c2p-connect-btn').addEventListener('click', () => {
      const btn = document.getElementById('c2p-connect-btn');
      btn.disabled = true; btn.textContent = 'Connecting...';
      isIntentionalDisconnect = false; reconnectAttempts = 0;
      connectSignaling();
    });
    document.getElementById('c2p-send-btn').addEventListener('click', sendMessage);
    document.getElementById('c2p-msg-input').addEventListener('keydown', e => { if (e.key === 'Enter') sendMessage(); });
    sidebar.querySelectorAll('.c2p-emoji-btn').forEach(btn => {
      btn.addEventListener('click', () => sendEmoji(btn.getAttribute('data-emoji')));
    });

    const gifBtn = document.getElementById('c2p-gif-btn');
    const klipyContainer = document.getElementById('c2p-klipy-container');
    const klipySearch = document.getElementById('c2p-klipy-search');
    const klipyClose = document.getElementById('c2p-klipy-close');
    const klipyResults = document.getElementById('c2p-klipy-results');

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

    // Move sidebar inside fullscreen element so it doesn't turn black
    const handleFullscreen = () => {
      const fsElement = document.fullscreenElement || document.webkitFullscreenElement;
      if (fsElement && fsElement.tagName !== 'VIDEO') {
        fsElement.appendChild(sidebar);
        fsElement.appendChild(toggleBtn);
      } else {
        document.body.appendChild(sidebar);
        document.body.appendChild(toggleBtn);
      }
    };
    document.addEventListener('fullscreenchange', handleFullscreen);
    document.addEventListener('webkitfullscreenchange', handleFullscreen);
  }

  function toggleSidebar() {
    sidebarVisible = !sidebarVisible;
    const sidebar = document.getElementById('c2p-sidebar');
    const btn = document.getElementById('c2p-toggle-btn');
    if (sidebarVisible) {
      sidebar.classList.remove('c2p-hidden'); btn.classList.add('c2p-sidebar-open');
      btn.innerHTML = '✕'; document.body.classList.add('c2p-sidebar-active');
    } else {
      sidebar.classList.add('c2p-hidden'); btn.classList.remove('c2p-sidebar-open');
      btn.innerHTML = '💬'; document.body.classList.remove('c2p-sidebar-active');
      const kc = document.getElementById('c2p-klipy-container'); if (kc) kc.style.display = 'none';
    }
  }

  // ── Helpers ──
  function updateStatus(state, text) {
    const b = document.getElementById('c2p-status');
    if (b) { b.className = `c2p-status-badge c2p-${state}`; b.textContent = text; }
  }
  function displaySystemMessage(t) { const d = document.createElement('div'); d.classList.add('c2p-msg','c2p-system'); d.textContent = t; appendMsg(d); }
  function displayUserMessage(content, type, isGif = false) {
    const d = document.createElement('div'); d.classList.add('c2p-msg', `c2p-${type}`);
    if (isGif) { d.style.cssText='background:transparent;padding:0;border:none'; const w=document.createElement('div'); w.classList.add('c2p-gif-wrap'); const i=document.createElement('img'); i.src=content; w.appendChild(i); d.appendChild(w); }
    else { d.textContent = content; }
    appendMsg(d);
  }
  function appendMsg(el) { const c = document.getElementById('c2p-messages'); if(c){c.appendChild(el);c.scrollTo({top:c.scrollHeight,behavior:'smooth'});} }
  function setInputEnabled(on) {
    const i=document.getElementById('c2p-msg-input'),s=document.getElementById('c2p-send-btn'),g=document.getElementById('c2p-gif-btn');
    if(i)i.disabled=!on; if(s)s.disabled=!on; if(g)g.disabled=!on;
    document.querySelectorAll('#c2p-sidebar .c2p-emoji-btn').forEach(b=>b.disabled=!on);
  }

  // ── Sync & Netflix Player ──
  function getNetflixPlayer() {
    try {
      const win = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
      if (!win.netflix) throw new Error("Netflix global object not found");
      const videoPlayer = win.netflix.appContext.state.playerApp.getAPI().videoPlayer;
      const sessionIds = videoPlayer.getAllPlayerSessionIds();
      if (!sessionIds || sessionIds.length === 0) throw new Error("No active player sessions");
      // Use the last session ID to get the active player (often it's the last one if they recreated it)
      const sessionId = sessionIds[sessionIds.length - 1];
      return videoPlayer.getVideoPlayerBySessionId(sessionId);
    } catch (e) {
      console.error("[C2P] Error getting Netflix player API:", e.message);
      return null;
    }
  }

  let listenersAttached = false;
  function attachVideoListeners() {
    if (listenersAttached) return;
    listenersAttached = true;
    document.addEventListener('play', (e) => { if (e.target.tagName === 'VIDEO') onLocalPlay(); }, true);
    document.addEventListener('playing', (e) => { if (e.target.tagName === 'VIDEO') onLocalPlay(); }, true);
    document.addEventListener('pause', (e) => { if (e.target.tagName === 'VIDEO') onLocalPause(); }, true);
    document.addEventListener('seeked', (e) => { if (e.target.tagName === 'VIDEO') onLocalSeek(); }, true);
  }

  let lastActionSent = 0;
  let lastActionType = '';

  function onLocalPlay() {
    if (isApplyingRemoteUpdate || !dataChannel || dataChannel.readyState !== 'open') return;
    const now = Date.now();
    if (lastActionType === 'play' && now - lastActionSent < 1000) return; // Debounce duplicate plays
    lastActionType = 'play'; lastActionSent = now;
    
    const p = getNetflixPlayer();
    const time = p ? p.getCurrentTime() : (document.querySelector('video')?.currentTime * 1000 || 0);
    console.log("[C2P] Sending Play", time);
    displaySystemMessage('▶️ You resumed playback');
    dataChannel.send(JSON.stringify({ type: 'sync', action: 'play', time: time }));
  }

  function onLocalPause() {
    if (isApplyingRemoteUpdate || !dataChannel || dataChannel.readyState !== 'open') return;
    const now = Date.now();
    if (lastActionType === 'pause' && now - lastActionSent < 1000) return;
    lastActionType = 'pause'; lastActionSent = now;
    
    const p = getNetflixPlayer();
    const time = p ? p.getCurrentTime() : (document.querySelector('video')?.currentTime * 1000 || 0);
    console.log("[C2P] Sending Pause", time);
    displaySystemMessage('⏸️ You paused playback');
    dataChannel.send(JSON.stringify({ type: 'sync', action: 'pause', time: time }));
  }

  function onLocalSeek() {
    if (isApplyingRemoteUpdate || !dataChannel || dataChannel.readyState !== 'open') return;
    const now = Date.now();
    if (lastActionType === 'seek' && now - lastActionSent < 1000) return;
    lastActionType = 'seek'; lastActionSent = now;
    
    const p = getNetflixPlayer();
    const time = p ? p.getCurrentTime() : (document.querySelector('video')?.currentTime * 1000 || 0);
    console.log("[C2P] Sending Seek", time);
    displaySystemMessage('⏩ You seeked to ' + Math.floor(time/1000) + 's');
    dataChannel.send(JSON.stringify({ type: 'sync', action: 'seek', time: time }));
  }

  function startSyncLoop() {
    if (syncInterval) clearInterval(syncInterval);
    syncInterval = setInterval(() => {
      attachVideoListeners();
      if (dataChannel && dataChannel.readyState === 'open') {
        const p = getNetflixPlayer();
        const video = document.querySelector('video');
        const time = p ? p.getCurrentTime() : (video ? video.currentTime * 1000 : null);
        const paused = p ? p.isPaused() : (video ? video.paused : null);
        
        if (time !== null) {
          dataChannel.send(JSON.stringify({
            type: 'sync', action: 'heartbeat',
            time: time, paused: paused
          }));
        }
      }
    }, 3000);
  }

  function stopSyncLoop() {
    if (syncInterval) { clearInterval(syncInterval); syncInterval = null; }
  }

  function handleSyncMessage(d) {
    let p = getNetflixPlayer();
    const video = document.querySelector('video');
    if (!p) {
      if (!video) return; // Cannot do anything without video
      console.warn("[C2P] Netflix API not available for receiving sync. Falling back to native video.");
      p = {
        seek: (time) => { video.currentTime = time / 1000; },
        play: () => { video.play(); },
        pause: () => { video.pause(); },
        getCurrentTime: () => video.currentTime * 1000,
        isPaused: () => video.paused
      };
    }
    
    isApplyingRemoteUpdate = true;
    try {
      if (d.action === 'play') {
        p.seek(d.time); p.play(); displaySystemMessage('▶️ Peer resumed playback');
      } else if (d.action === 'pause') {
        p.seek(d.time); p.pause(); displaySystemMessage('⏸️ Peer paused playback');
      } else if (d.action === 'seek') {
        p.seek(d.time); displaySystemMessage('⏩ Peer seeked to ' + Math.floor(d.time/1000) + 's');
      } else if (d.action === 'heartbeat') {
        const localTime = p.getCurrentTime();
        if (!p.isPaused() && !d.paused && Math.abs(localTime - d.time) > DRIFT_THRESHOLD) {
          p.seek(d.time);
        }
      }
    } catch(e) {
      console.error("[C2P] Error applying sync:", e);
    }
    setTimeout(() => { isApplyingRemoteUpdate = false; }, 500);
  }

  // ── Signaling ──
  function connectSignaling() {
    if (!serverUrl) { displaySystemMessage('⚠ No server URL. Right-click Tampermonkey icon → Chat2Peer → Set Server URL'); const b=document.getElementById('c2p-connect-btn'); if(b){b.disabled=false;b.textContent='Enter Lounge';} return; }
    updateStatus('connecting','Connecting...');
    try { ws = new WebSocket(serverUrl); } catch(e) { updateStatus('disconnected','Error'); displaySystemMessage('Connection failed. Check server URL.'); const b=document.getElementById('c2p-connect-btn'); if(b){b.disabled=false;b.textContent='Reconnect';} return; }
    ws.onopen = () => { 
      reconnectAttempts=0; updateStatus('connecting','Waiting for peer...'); 
      const b=document.getElementById('c2p-connect-btn'); if(b)b.textContent='Waiting for peer...'; 
      displaySystemMessage('Connected. Waiting for a peer...'); 
    };
    ws.onmessage = async (event) => {
      let msg; try{msg=JSON.parse(event.data);}catch{return;}
      try {
        switch(msg.type) {
          case 'ping': ws.send(JSON.stringify({type: 'pong'})); break;
          case 'pong': break;
          case 'peer_joined': displaySystemMessage('Peer detected!'); initPC(); await createOffer(); break;
          case 'peer_left': 
            displaySystemMessage('Peer disconnected. Waiting for them to return...'); 
            resetWebRTC();
            updateStatus('connecting','Waiting for peer...');
            break;
          case 'offer': if(!peerConnection)initPC(); await peerConnection.setRemoteDescription(new RTCSessionDescription(msg)); const a=await peerConnection.createAnswer(); await peerConnection.setLocalDescription(a); ws.send(JSON.stringify(peerConnection.localDescription)); break;
          case 'answer': if(peerConnection) await peerConnection.setRemoteDescription(new RTCSessionDescription(msg)); break;
          case 'ice-candidate': if(peerConnection&&msg.candidate) await peerConnection.addIceCandidate(new RTCIceCandidate(msg.candidate)); break;
        }
      } catch(e){console.error('[C2P]',e);}
    };
    ws.onerror = () => updateStatus('disconnected','Error');
    ws.onclose = () => { 
      // Do NOT destroy WebRTC if the WebSocket drops. Just reconnect quietly.
      if(!isIntentionalDisconnect){
        attemptReconnect();
      } else if(peerConnection?.connectionState!=='connected') {
        updateStatus('disconnected','Disconnected');
        handleDisconnect(true);
      } 
    };
  }
  function attemptReconnect() {
    const d=Math.min(1000*Math.pow(2,reconnectAttempts),MAX_RECONNECT_DELAY); reconnectAttempts++;
    updateStatus('connecting',`Reconnecting (${reconnectAttempts})...`);
    setTimeout(()=>{if(!isIntentionalDisconnect&&(!ws||ws.readyState!==WebSocket.OPEN))connectSignaling();},d);
  }

  // ── WebRTC ──
  function initPC() {
    peerConnection = new RTCPeerConnection(ICE_CONFIG);
    peerConnection.onicecandidate = e => { if(e.candidate&&ws&&ws.readyState===WebSocket.OPEN) ws.send(JSON.stringify({type:'ice-candidate',candidate:e.candidate})); };
    peerConnection.onconnectionstatechange = () => {
      const s=peerConnection.connectionState;
      if(s==='connected'){updateStatus('connected','P2P Connected');const su=document.getElementById('c2p-setup');if(su)su.style.display='none';displaySystemMessage('🔒 Secure P2P connection!');setInputEnabled(true);document.getElementById('c2p-msg-input')?.focus();}
      else if(['disconnected','failed','closed'].includes(s)){
        updateStatus('disconnected','P2P Lost');
        displaySystemMessage('P2P lost. Recovering...');
        resetWebRTC();
        if(ws&&ws.readyState===WebSocket.OPEN) {
          // Force a WebSocket reconnect to restart the peer_joined flow cleanly
          ws.close();
        }
      }
    };
    peerConnection.ondatachannel = e => { dataChannel=e.channel; setupDC(); };
  }
  async function createOffer() { dataChannel=peerConnection.createDataChannel('chat-channel'); setupDC(); const o=await peerConnection.createOffer(); await peerConnection.setLocalDescription(o); ws.send(JSON.stringify(peerConnection.localDescription)); }
  function setupDC() {
    dataChannel.onopen = () => { setInputEnabled(true); document.getElementById('c2p-msg-input')?.focus(); startSyncLoop(); };
    dataChannel.onclose = () => { setInputEnabled(false); stopSyncLoop(); };
    dataChannel.onmessage = event => { 
      try {
        const d = JSON.parse(event.data);
        if (d.type === 'sync') handleSyncMessage(d);
        else if (d.type === 'text') displayUserMessage(d.content, 'received');
        else if (d.type === 'emoji') createFloatingEmoji(d.emoji);
        else if (d.type === 'gif') displayUserMessage(d.url, 'received', true);
      } catch {
        displayUserMessage(event.data, 'received');
      } 
    };
  }
  function resetWebRTC() {
    stopSyncLoop();
    if(dataChannel){dataChannel.close();dataChannel=null;} 
    if(peerConnection){peerConnection.close();peerConnection=null;}
    setInputEnabled(false); 
    const kc = document.getElementById('c2p-klipy-container'); if(kc)kc.style.display='none';
  }

  function handleDisconnect(full=true) {
    resetWebRTC();
    const su=document.getElementById('c2p-setup'); if(su)su.style.display='flex';
    if(full){isIntentionalDisconnect=true;if(ws)ws.close();const b=document.getElementById('c2p-connect-btn');if(b){b.disabled=false;b.textContent='Reconnect';}}
    else{const b=document.getElementById('c2p-connect-btn');if(b){b.disabled=true;b.textContent='Reconnecting...';}}
  }

  // ── Messaging ──
  function sendMessage() { const i=document.getElementById('c2p-msg-input'); if(!i)return; const t=i.value.trim(); if(t&&dataChannel?.readyState==='open'){dataChannel.send(JSON.stringify({type:'text',content:t}));displayUserMessage(t,'sent');i.value='';} }
  function sendGifMessage(gifUrl) {
    if (gifUrl && dataChannel?.readyState === 'open') {
      dataChannel.send(JSON.stringify({ type: 'gif', url: gifUrl }));
      displayUserMessage(gifUrl, 'sent', true);
      const kc = document.getElementById('c2p-klipy-container');
      if (kc) kc.style.display = 'none';
    }
  }
  function sendEmoji(e) { if(dataChannel?.readyState==='open'){dataChannel.send(JSON.stringify({type:'emoji',emoji:e}));createFloatingEmoji(e);} }
  function createFloatingEmoji(e) { 
    const s=document.getElementById('c2p-sidebar'); if(!s)return; 
    const el=document.createElement('div'); 
    el.classList.add('c2p-floating-emoji'); el.textContent=e; 
    el.style.left=`${10+Math.random()*80}%`; 
    // Randomize duration between 4.5s and 6.5s to slow it down
    const d=4.5+Math.random()*2; 
    el.style.animation=`c2p-floatUp ${d}s ease-in-out forwards`; 
    s.appendChild(el); 
    setTimeout(()=>el.remove(),d*1000); 
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
  }
  if (document.readyState === 'complete') init();
  else window.addEventListener('load', init);
})();
