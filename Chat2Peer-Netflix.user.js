// ==UserScript==
// @name         Chat2Peer for Netflix
// @namespace    https://github.com/argorar/Chat2Peer
// @version      1.5.1
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
// @updateURL    https://raw.githubusercontent.com/argorar/Chat2Peer/refs/heads/main/Chat2Peer-Netflix.user.js
// @downloadURL  https://raw.githubusercontent.com/argorar/Chat2Peer/refs/heads/main/Chat2Peer-Netflix.user.js
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
  let ws = null, peerConnection = null, dataChannel = null, sidebarVisible = false;
  let serverUrl = getVal('serverUrl', 'wss://chat2peer.onrender.com/ws');
  let nickname = getVal('nickname', '');
  let reconnectAttempts = 0;
  let reconnectTimer = null;
  let autoReconnectTimer = null;
  let isIntentionalDisconnect = false;
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

  // ── Klipy GIF State ──
  const KLIPY_API_KEY = 'myMchPMlqDxJKpeSzJfOLCFrTpZqdqCLLF9Uf6RPKjxIPmeqxy6k5EPgo2PFivAI';
  const GIF_LIMIT = 20;
  let gifSearchTimeout = null, currentGifOffset = 0, currentGifQuery = '', isLoadingGifs = false, hasMoreGifs = true;

  // ── Sync State ──
  let suppressBroadcast = 0;
  let syncInterval = null;
  let lastPlayerState = null;
  const DRIFT_THRESHOLD = 2500;

  // ── Voice Notes State ──
  let mediaRecorder = null, audioChunks = [], recordTimerInterval = null, recordStartTime = 0;
  let incomingAudioChunks = {};

  // ── Typing Indicator State ──
  let localTypingTimeout = null, isTypingLocally = false, remoteTypingTimeout = null;

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
#c2p-sidebar .c2p-header-btn{background:none;border:none;color:#888;cursor:pointer;font-size:14px;padding:4px;border-radius:4px;transition:all .2s;display:flex;align-items:center;justify-content:center}
#c2p-sidebar .c2p-header-btn:hover{color:#fff;background:rgba(255,255,255,.08)}
#c2p-sidebar .c2p-header-btn.c2p-spinning{animation:c2p-spin 1s linear infinite;color:#e50914}
@keyframes c2p-spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
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
#c2p-sidebar .c2p-msg.c2p-system{align-self:center;background:transparent;color:#666;font-size:11px;box-shadow:none;border:1px dashed rgba(255,255,255,.08);border-radius:10px;padding:6px 12px;max-width:95%;text-align:center;display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:4px}
#c2p-sidebar .c2p-inline-action-btn{background:rgba(229,9,20,.18);color:#ff6b6b;border:1px solid rgba(229,9,20,.35);border-radius:99px;padding:2px 8px;font-size:10px;font-weight:600;cursor:pointer;transition:all .2s;font-family:inherit}
#c2p-sidebar .c2p-inline-action-btn:hover{background:rgba(229,9,20,.35);color:#fff;border-color:rgba(229,9,20,.6);transform:scale(1.05)}
#c2p-sidebar .c2p-msg .c2p-gif-wrap{border-radius:8px;overflow:hidden;display:inline-block;margin-top:4px}
#c2p-sidebar .c2p-msg .c2p-gif-wrap img{height:120px;width:auto;display:block;border-radius:4px}
#c2p-sidebar .c2p-typing-indicator{display:flex;align-items:center;gap:6px;padding:4px 16px;font-size:11px;color:#888;min-height:20px;transition:opacity .2s,visibility .2s;flex-shrink:0}
#c2p-sidebar .c2p-typing-indicator.c2p-hidden{opacity:0;visibility:hidden;pointer-events:none}
#c2p-sidebar .c2p-typing-dots{display:inline-flex;gap:3px;align-items:center}
#c2p-sidebar .c2p-typing-dots span{width:4px;height:4px;background:#888;border-radius:50%;animation:c2p-typingBounce 1.4s infinite ease-in-out both}
#c2p-sidebar .c2p-typing-dots span:nth-child(1){animation-delay:-0.32s}
#c2p-sidebar .c2p-typing-dots span:nth-child(2){animation-delay:-0.16s}
#c2p-sidebar .c2p-typing-dots span:nth-child(3){animation-delay:0s}
@keyframes c2p-typingBounce{0%,80%,100%{transform:scale(0);opacity:.4}40%{transform:scale(1);opacity:1}}
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
#c2p-sidebar .c2p-floating-emoji{position:absolute;bottom:0;font-size:36px;pointer-events:none;z-index:50;user-select:none;filter:drop-shadow(0 4px 8px rgba(0,0,0,.35));will-change:transform,opacity;animation-fill-mode:forwards}
@keyframes c2p-floatUp{0%{transform:translate3d(0,0,0) scale(.65);opacity:0}12%{transform:translate3d(-5px,-11vh,0) scale(1.03) rotate(-2deg);opacity:1}35%{transform:translate3d(6px,-32vh,0) scale(1) rotate(2deg);opacity:1}60%{transform:translate3d(-5px,-55vh,0) scale(.99) rotate(-1.5deg);opacity:.95}80%{transform:translate3d(4px,-74vh,0) scale(.97) rotate(1deg);opacity:.75}100%{transform:translate3d(0,-88vh,0) scale(.94) rotate(0deg);opacity:0}}
@keyframes c2p-floatUpAlt{0%{transform:translate3d(0,0,0) scale(.65);opacity:0}12%{transform:translate3d(5px,-11vh,0) scale(1.03) rotate(2deg);opacity:1}35%{transform:translate3d(-6px,-32vh,0) scale(1) rotate(-2deg);opacity:1}60%{transform:translate3d(5px,-55vh,0) scale(.99) rotate(1.5deg);opacity:.95}80%{transform:translate3d(-4px,-74vh,0) scale(.97) rotate(-1deg);opacity:.75}100%{transform:translate3d(0,-88vh,0) scale(.94) rotate(0deg);opacity:0}}
#c2p-sidebar.c2p-shaking{animation:c2p-nudge-shake .55s cubic-bezier(.36,.07,.19,.97) both;box-shadow:-8px 0 32px rgba(229,9,20,.6),0 0 24px rgba(229,9,20,.4)}
@keyframes c2p-nudge-shake{0%,100%{transform:translateX(0) rotate(0deg)}10%{transform:translate(-14px,-8px) rotate(-2deg)}20%{transform:translate(12px,8px) rotate(2deg)}30%{transform:translate(-12px,6px) rotate(-1.5deg)}40%{transform:translate(10px,-6px) rotate(1.5deg)}50%{transform:translate(-8px,4px) rotate(-1deg)}60%{transform:translate(8px,-4px) rotate(1deg)}75%{transform:translate(-5px,2px) rotate(-.5deg)}90%{transform:translate(5px,-2px) rotate(.5deg)}}
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
        <div style="display:flex;gap:6px;align-items:center;">
          <button id="c2p-reconnect-btn" class="c2p-header-btn" title="Force Fresh Reconnect">🔄</button>
          <button id="c2p-settings-btn" class="c2p-header-btn" title="Settings">⚙️</button>
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
      <div id="c2p-typing-indicator" class="c2p-typing-indicator c2p-hidden">
        <span>Peer is typing</span>
        <span class="c2p-typing-dots"><span></span><span></span><span></span></span>
      </div>
      <div class="c2p-emoji-bar">${EMOJIS.map(e => `<button class="c2p-emoji-btn" data-emoji="${e}" disabled>${e}</button>`).join('')}</div>
      <div class="c2p-input-area">
        <div class="c2p-recording-bar" id="c2p-recording-bar" style="display:none;">
          <span class="c2p-record-dot"></span>
          <span class="c2p-record-timer" id="c2p-record-timer">0:00</span>
          <button id="c2p-record-cancel-btn" class="c2p-record-btn c2p-record-cancel" title="Discard">✕</button>
          <button id="c2p-record-send-btn" class="c2p-record-btn c2p-record-send" title="Send Voice Note">✓</button>
        </div>
        <input type="text" id="c2p-msg-input" placeholder="Type a message..." disabled autocomplete="off">
        <button class="c2p-nudge-btn" id="c2p-nudge-btn" disabled title="Enviar zumbido (Nudge)">
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
      </div>`;
    document.body.appendChild(sidebar);

    toggleBtn.addEventListener('click', toggleSidebar);
    document.getElementById('c2p-settings-btn').addEventListener('click', promptServerUrl);
    document.getElementById('c2p-reconnect-btn').addEventListener('click', forceFreshReconnect);
    document.getElementById('c2p-connect-btn').addEventListener('click', forceFreshReconnect);
    document.getElementById('c2p-send-btn').addEventListener('click', sendMessage);

    // Stop key events from bubbling to Netflix's video player controls
    ['keydown', 'keyup', 'keypress'].forEach(type => {
      sidebar.addEventListener(type, e => {
        e.stopPropagation();
        if (type === 'keydown' && (e.key === 'Enter' || e.keyCode === 13) && e.target === msgInput) {
          e.preventDefault();
          sendMessage();
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
    msgInput.addEventListener('input', handleLocalTyping);
    msgInput.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter' || e.keyCode === 13) {
        e.preventDefault();
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

    const gifBtn = document.getElementById('c2p-gif-btn');
    const klipyContainer = document.getElementById('c2p-klipy-container');
    const klipySearch = document.getElementById('c2p-klipy-search');
    const klipyClose = document.getElementById('c2p-klipy-close');
    const klipyResults = document.getElementById('c2p-klipy-results');

    setupInputFocusProtection(klipySearch);

    gifBtn.addEventListener('click', () => {
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
    };
    document.addEventListener('fullscreenchange', handleFullscreen);
    document.addEventListener('webkitfullscreenchange', handleFullscreen);
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

  function toggleSidebar() {
    sidebarVisible = !sidebarVisible;
    const sidebar = document.getElementById('c2p-sidebar');
    const btn = document.getElementById('c2p-toggle-btn');
    if (sidebarVisible) {
      sidebar.classList.remove('c2p-hidden'); btn.classList.add('c2p-sidebar-open');
      btn.innerHTML = '✕'; document.body.classList.add('c2p-sidebar-active');
      focusMsgInput();
    } else {
      activeSidebarInput = null;
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
  function displayActionMessage(text, actionText, actionFn) {
    const d = document.createElement('div');
    d.classList.add('c2p-msg', 'c2p-system');
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
  function showSetupBanner(btnText = '🔄 Reconnect Fresh Session', hintText = 'Click to establish a fresh P2P session.') {
    const su = document.getElementById('c2p-setup');
    const btn = document.getElementById('c2p-connect-btn');
    const hint = document.getElementById('c2p-setup-hint');
    if (su) su.style.display = 'flex';
    if (btn) { btn.disabled = false; btn.textContent = btnText; }
    if (hint) { hint.textContent = hintText; hint.style.color = '#888'; }
  }
  function displayUserMessage(content, type, isGif = false) {
    const d = document.createElement('div'); d.classList.add('c2p-msg', `c2p-${type}`);
    if (isGif) { d.style.cssText='background:transparent;padding:0;border:none'; const w=document.createElement('div'); w.classList.add('c2p-gif-wrap'); const i=document.createElement('img'); i.src=content; w.appendChild(i); d.appendChild(w); }
    else { d.textContent = content; }
    appendMsg(d);
  }
  function appendMsg(el) { const c = document.getElementById('c2p-messages'); if(c){c.appendChild(el);c.scrollTo({top:c.scrollHeight,behavior:'smooth'});} }
  function setInputEnabled(on) {
    const i=document.getElementById('c2p-msg-input'),s=document.getElementById('c2p-send-btn'),g=document.getElementById('c2p-gif-btn'),m=document.getElementById('c2p-mic-btn'),n=document.getElementById('c2p-nudge-btn');
    if(i)i.disabled=!on; if(s)s.disabled=!on; if(g)g.disabled=!on; if(m)m.disabled=!on; if(n)n.disabled=!on || nudgeCooldown;
    document.querySelectorAll('#c2p-sidebar .c2p-emoji-btn').forEach(b=>b.disabled=!on);
  }

  // ── Sync & Netflix Player ──
  function getNetflixPlayer() {
    try {
      const win = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
      const vp = win?.netflix?.appContext?.state?.playerApp?.getAPI()?.videoPlayer;
      if (!vp) return null;
      const sids = vp.getAllPlayerSessionIds() || [];
      // the active full-screen playback session contains "watch"
      const sid = sids.find(id => id.includes('watch')) || sids[sids.length - 1];
      return sid ? vp.getVideoPlayerBySessionId(sid) : null;
    } catch (e) {
      return null;
    }
  }

  function getPlayer() {
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
    const v = document.querySelector('video');
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
    const c = document.querySelector('.VideoContainer') || document.querySelector('.watch-video');
    if (c) {
      c.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 100, clientY: 100 }));
    }
  }

  let userListenersAttached = false;
  function attachUserInteractionListeners() {
    if (userListenersAttached) return;
    userListenersAttached = true;
    // detect seeks when mouse scrub finishes or keyboard keys release
    window.addEventListener('mouseup', () => pollPlayerState(true));
    window.addEventListener('keyup', (e) => {
      if (e.target && (e.target.closest?.('#c2p-sidebar') || e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      pollPlayerState(true);
    });

    if (navigator.mediaSession) {
      try {
        navigator.mediaSession.setActionHandler('play', () => {
          const p = getPlayer();
          if (p) { p.play(); pollPlayerState(true); }
        });
        navigator.mediaSession.setActionHandler('pause', () => {
          const p = getPlayer();
          if (p) { p.pause(); pollPlayerState(true); }
        });
      } catch (e) {}
    }
  }

  function broadcastSync(action, time) {
    if (suppressBroadcast > 0 || !dataChannel || dataChannel.readyState !== 'open') return;
    dataChannel.send(JSON.stringify({ type: 'sync', action, time }));
  }

  function pollPlayerState(isUserTriggered = false) {
    if (suppressBroadcast > 0 || !dataChannel || dataChannel.readyState !== 'open') return;
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
      displaySystemMessage('⏩ You seeked to ' + Math.floor(time / 1000) + 's');
      broadcastSync('seek', time);
    } else if (stateChanged) {
      if (paused) {
        console.log("[C2P] Detected pause at", time);
        displaySystemMessage('⏸️ You paused playback');
        broadcastSync('pause', time);
      } else {
        console.log("[C2P] Detected play at", time);
        displaySystemMessage('▶️ You resumed playback');
        broadcastSync('play', time);
      }
    }

    lastPlayerState = { paused, time };
  }

  function startSyncLoop() {
    if (syncInterval) clearInterval(syncInterval);
    attachUserInteractionListeners();
    lastPlayerState = null;

    let tickCount = 0;
    // 250ms polling loop + 3s heartbeat/keepalive
    syncInterval = setInterval(() => {
      pollPlayerState(false);
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
              paused: p.isPaused()
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
    const p = getPlayer();
    if (!p) return;

    suppressBroadcast++;
    try {
      if (d.action === 'play') {
        p.seek(d.time);
        p.play();
        wakeNetflixUI();
        displaySystemMessage('▶️ Peer resumed playback');
      } else if (d.action === 'pause') {
        p.seek(d.time);
        p.pause();
        wakeNetflixUI();
        displaySystemMessage('⏸️ Peer paused playback');
      } else if (d.action === 'seek') {
        p.seek(d.time);
        wakeNetflixUI();
        displaySystemMessage('⏩ Peer seeked to ' + Math.floor(d.time / 1000) + 's');
      } else if (d.action === 'heartbeat') {
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
  function scheduleAutoReconnect(reason = 'P2P connection lost') {
    if (autoReconnectTimer) clearTimeout(autoReconnectTimer);
    if (isIntentionalDisconnect) return;

    // 2-second delay with slight jitter (0-300ms) to prevent glare/sync loops between the two peers
    const delay = 2000 + Math.floor(Math.random() * 300);
    console.log(`[C2P] Scheduling auto-reconnect in ${(delay / 1000).toFixed(1)}s (reason: ${reason})...`);
    updateStatus('connecting', 'Auto-reconnecting in 2s...');
    displayActionMessage(`⚠️ ${reason}. Auto-reconnecting in 2s...`, '🔄 Reconnect Now', () => {
      if (autoReconnectTimer) { clearTimeout(autoReconnectTimer); autoReconnectTimer = null; }
      forceFreshReconnect();
    });

    autoReconnectTimer = setTimeout(() => {
      autoReconnectTimer = null;
      if (!isIntentionalDisconnect && peerConnection?.connectionState !== 'connected') {
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
    setInputEnabled(false);
    const kc = document.getElementById('c2p-klipy-container'); if (kc) kc.style.display = 'none';

    updateStatus('connecting', 'Reconnecting...');
    displaySystemMessage('🔄 Starting fresh connection session...');

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
      displaySystemMessage('⚠ No server URL. Right-click Tampermonkey icon → Chat2Peer → Set Server URL');
      showSetupBanner('Enter Lounge', 'Please set the Signaling Server URL first.');
      const recBtn = document.getElementById('c2p-reconnect-btn');
      if (recBtn) recBtn.classList.remove('c2p-spinning');
      return;
    }
    console.log('[C2P] Connecting to signaling server:', serverUrl);
    updateStatus('connecting', 'Connecting...');
    try {
      ws = new WebSocket(serverUrl);
    } catch(e) {
      console.error('[C2P] Error creating WebSocket:', e);
      updateStatus('disconnected', 'Error');
      displayActionMessage('Connection failed. Check server URL.', '🔄 Retry', forceFreshReconnect);
      showSetupBanner('🔄 Reconnect Fresh Session', 'Connection failed. Check server URL.');
      const recBtn = document.getElementById('c2p-reconnect-btn');
      if (recBtn) recBtn.classList.remove('c2p-spinning');
      return;
    }

    ws.onopen = () => {
      console.log('[C2P] WebSocket connected successfully');
      const recBtn = document.getElementById('c2p-reconnect-btn');
      if (recBtn) recBtn.classList.remove('c2p-spinning');
      reconnectAttempts = 0;
      if (peerConnection?.connectionState === 'connected' && dataChannel?.readyState === 'open') {
        updateStatus('connected', 'P2P Connected');
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
          case 'hello':
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
            if (peerConnection?.connectionState !== 'connected') {
              updateStatus('connecting', 'Waiting for peer...');
              const b = document.getElementById('c2p-connect-btn');
              if (b) b.textContent = 'Waiting for peer...';
            }
            break;
          case 'offer':
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
      if (!isIntentionalDisconnect) {
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
        updateStatus('disconnected', 'ICE Failed');
        showSetupBanner('🔄 Reconnect Fresh Session', 'Network route failed. Click to reconnect.');
        resetWebRTC();
        if (ws && ws.readyState === WebSocket.OPEN && !isIntentionalDisconnect) {
          scheduleAutoReconnect('Network route failed (ICE timeout)');
        } else {
          displayActionMessage('⚠️ Network route failed (ICE timeout).', '🔄 Reconnect Now', forceFreshReconnect);
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
        updateStatus('connected', 'P2P Connected');
        const su = document.getElementById('c2p-setup'); if (su) su.style.display = 'none';
        displaySystemMessage('🔒 Secure P2P connection!');
        setInputEnabled(true);
        focusMsgInput();
      } else if (['disconnected', 'failed', 'closed'].includes(s)) {
        const recBtn = document.getElementById('c2p-reconnect-btn');
        if (recBtn) recBtn.classList.remove('c2p-spinning');
        updateStatus('disconnected', 'P2P Lost');
        showSetupBanner('🔄 Reconnect Fresh Session', 'P2P connection lost. Click to reconnect.');
        resetWebRTC();
        if (ws && ws.readyState === WebSocket.OPEN && !isIntentionalDisconnect) {
          scheduleAutoReconnect('P2P connection lost');
        } else {
          displayActionMessage('⚠️ P2P connection lost.', '🔄 Reconnect Now', forceFreshReconnect);
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
        if (d.type === 'sync') handleSyncMessage(d);
        else if (d.type === 'typing') showRemoteTyping(!!d.isTyping);
        else if (d.type === 'text') { showRemoteTyping(false); displayUserMessage(d.content, 'received'); }
        else if (d.type === 'emoji') createFloatingEmoji(d.emoji);
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
    const kc = document.getElementById('c2p-klipy-container'); if (kc) kc.style.display = 'none';
  }

  function handleDisconnect(full = true) {
    if (autoReconnectTimer) {
      clearTimeout(autoReconnectTimer);
      autoReconnectTimer = null;
    }
    resetWebRTC();
    showSetupBanner('🔄 Reconnect Fresh Session', 'Click to reconnect and wait for a peer.');
    if (full) {
      isIntentionalDisconnect = true;
      if (ws) ws.close();
      const b = document.getElementById('c2p-connect-btn');
      if (b) { b.disabled = false; b.textContent = '🔄 Reconnect Fresh Session'; }
    } else {
      const b = document.getElementById('c2p-connect-btn');
      if (b) { b.disabled = true; b.textContent = 'Reconnecting...'; }
    }
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
      const c = document.getElementById('c2p-messages');
      if (c) c.scrollTo({ top: c.scrollHeight, behavior: 'smooth' });
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
      dataChannel.send(JSON.stringify({ type: 'text', content: t }));
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

  // ── MSN Nudge / Zumbido ──
  let nudgeCooldown = false;
  const MSN_NUDGE_AUDIO = 'data:audio/mp3;base64,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';

  function playNudgeSound() {
    try {
      const a = new Audio(MSN_NUDGE_AUDIO);
      a.volume = 0.9;
      a.play().catch(() => {});
    } catch(e) {}
  }

  function triggerNudgeEffect() {
    const s = document.getElementById('c2p-sidebar');
    if (s) {
      s.classList.remove('c2p-shaking');
      void s.offsetWidth;
      s.classList.add('c2p-shaking');
      setTimeout(() => s.classList.remove('c2p-shaking'), 600);
    }
    playNudgeSound();
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      try { navigator.vibrate([100, 50, 100, 50, 150]); } catch(e){}
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
    displaySystemMessage('💥 ¡Te han enviado un zumbido!');
  }

  // ── Voice Notes ──
  async function startRecording() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      displaySystemMessage('⚠️ Microphone API not supported in this browser.');
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
      displaySystemMessage('⚠️ Could not access microphone. Please grant permission.');
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
