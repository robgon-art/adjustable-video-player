const video = document.getElementById('video');
video.loop = true;

// State for scale and position
let videoScale = 1.0;
let videoX = 0;
let videoY = 0;

// --- persistence -----------------
const SETTINGS_KEY = 'avp:settings:v1';
const DEFAULT_SETTINGS = { scale: 1.0, x: 0, y: 0 };
let _saveTimer = null;

function loadSettings() {
    try {
        const raw = localStorage.getItem(SETTINGS_KEY);
        if (!raw) return { ...DEFAULT_SETTINGS };
        const data = JSON.parse(raw);
        if (typeof data.scale !== 'number' || typeof data.x !== 'number' || typeof data.y !== 'number') {
            return { ...DEFAULT_SETTINGS };
        }
        return { ...DEFAULT_SETTINGS, ...data };
    } catch (err) {
        console.warn('Failed to load settings, using defaults:', err);
        return { ...DEFAULT_SETTINGS };
    }
}

function saveSettingsDebounced(delay = 300) {
    if (_saveTimer) clearTimeout(_saveTimer);
    _saveTimer = setTimeout(() => {
        try {
            const payload = { scale: videoScale, x: videoX, y: videoY };
            localStorage.setItem(SETTINGS_KEY, JSON.stringify(payload));
        } catch (err) {
            console.warn('Could not save settings:', err);
        }
        _saveTimer = null;
    }, delay);
}

// Load on start
(() => {
    const s = loadSettings();
    videoScale = s.scale;
    videoX = s.x;
    videoY = s.y;
})();

// Save on unload as a last-resort synchronous write
window.addEventListener('beforeunload', () => {
    try {
        const payload = { scale: videoScale, x: videoX, y: videoY };
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(payload));
    } catch (e) { /* ignore */ }
});


function updateVideoTransform() {
    video.style.transform = `translate(${videoX}px, ${videoY}px) scale(${videoScale})`;
}

// Initialize transform
updateVideoTransform();
// Buttons removed from UI; controls are keyboard-only now
const playPauseBtn = null;

function formatTime(s) {
    if (isNaN(s) || s === Infinity) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60).toString().padStart(2, '0');
    return `${m}:${sec}`;
}

function goToHeadAndPlay() {
    const seekAndPlay = () => {
        video.currentTime = 0;
        video.play().catch(() => { });
    };
    if (isNaN(video.duration)) {
        video.addEventListener('loadedmetadata', seekAndPlay, { once: true });
    } else {
        seekAndPlay();
    }
}

function togglePlayPause() {
    if (video.paused || video.ended) {
        video.play();
    } else {
        video.pause();
    }
}

async function toggleFullscreen() {
    const container = document.documentElement;
    if (!document.fullscreenElement) {
        try { await container.requestFullscreen(); }
        catch (e) { console.warn('Fullscreen failed', e); }
    } else {
        try { await document.exitFullscreen(); }
        catch (e) { console.warn('Exit fullscreen failed', e); }
    }
}

// Time display removed from UI; keep timeupdate handler out to avoid errors


// Update time display (no visual play/pause button to sync with)
video.addEventListener('play', () => { });
video.addEventListener('pause', () => { });

// Keyboard shortcuts: Space = play/pause, Escape = fullscreen toggle, Home = go to head
// Simple debounce state for space key
let _lastSpaceToggle = 0; // timestamp in ms
const SPACE_DEBOUNCE_MS = 250;

window.addEventListener('keydown', (e) => {
    // ignore when typing in inputs or using content editable
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) return;

    // Scale and position controls
    let handled = false;
    // Scale: NumpadAdd (+), NumpadSubtract (-)
    if (e.code === 'NumpadAdd') {
        videoScale += e.shiftKey ? 0.10 : 0.01;
        if (videoScale > 10) videoScale = 10;
        updateVideoTransform();
        saveSettingsDebounced();
        handled = true;
    } else if (e.code === 'NumpadSubtract') {
        videoScale -= e.shiftKey ? 0.10 : 0.01;
        if (videoScale < 0.1) videoScale = 0.1;
        updateVideoTransform();
        saveSettingsDebounced();
        handled = true;
    }
    // Position: Numpad 8/4/6/2 for up/left/right/down
    const moveStep = e.shiftKey ? 10 : 1;
    if (e.code === 'Numpad8') {
        videoY -= moveStep;
        updateVideoTransform();
        saveSettingsDebounced();
        handled = true;
    } else if (e.code === 'Numpad2') {
        videoY += moveStep;
        updateVideoTransform();
        saveSettingsDebounced();
        handled = true;
    } else if (e.code === 'Numpad4') {
        videoX -= moveStep;
        updateVideoTransform();
        saveSettingsDebounced();
        handled = true;
    } else if (e.code === 'Numpad6') {
        videoX += moveStep;
        updateVideoTransform();
        saveSettingsDebounced();
        handled = true;
    }

    if (handled) {
        e.preventDefault();
        return;
    }

    // Existing controls
    if (e.code === 'Space') {
        // debounce rapid space presses
        const now = Date.now();
        if (now - _lastSpaceToggle < SPACE_DEBOUNCE_MS) return;
        _lastSpaceToggle = now;
        e.preventDefault();
        togglePlayPause();
    } else if (e.code === 'KeyF') {
        e.preventDefault();
        toggleFullscreen();
    } else if (e.key === 'Home') {
        e.preventDefault();
        goToHeadAndPlay();
    }
});

// Clean up object URLs when navigating away or loading a new file
// No object URL cleanup needed since we load a static file (video.mp4) from the same folder
