// WebGL-backed video renderer - Single rectangle system
const video = document.getElementById('video');
const canvas = document.getElementById('glcanvas');

// State for canvas transforms (single rectangle - the canvas itself)
let canvasScale = 1.0; // scales the 1280px base width (0.2 to 2.0)
let canvasX = 0; // offset from centered position
let canvasY = 0;
let videoMirrored = false; // horizontal flip

// --- persistence -----------------
const SETTINGS_KEY = 'avp:settings:v1';
const DEFAULT_SETTINGS = {
    canvasScale: 1.0,
    canvasX: 0,
    canvasY: 0,
    mirrored: false
};
let _saveTimer = null;

function loadSettings() {
    try {
        const raw = localStorage.getItem(SETTINGS_KEY);
        if (!raw) return { ...DEFAULT_SETTINGS };
        const data = JSON.parse(raw);
        // Validate all required fields
        if (typeof data.canvasScale !== 'number' || 
            typeof data.canvasX !== 'number' || 
            typeof data.canvasY !== 'number' || 
            typeof data.mirrored !== 'boolean') {
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
            const payload = {
                canvasScale,
                canvasX,
                canvasY,
                mirrored: videoMirrored
            };
            localStorage.setItem(SETTINGS_KEY, JSON.stringify(payload));
        } catch (err) {
            console.warn('Could not save settings:', err);
        }
        _saveTimer = null;
    }, delay);
}

// Apply canvas transforms via CSS
function updateCanvasTransform() {
    canvas.style.transform = `translate(calc(-50% + ${canvasX}px), calc(-50% + ${canvasY}px)) scale(${canvasScale})`;
}

// Load on start
(() => {
    const s = loadSettings();
    canvasScale = s.canvasScale;
    canvasX = s.canvasX;
    canvasY = s.canvasY;
    videoMirrored = s.mirrored;
    updateCanvasTransform();
})();

// Save on unload as a last-resort synchronous write
window.addEventListener('beforeunload', () => {
    try {
        const payload = {
            canvasScale,
            canvasX,
            canvasY,
            mirrored: videoMirrored
        };
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(payload));
    } catch (e) { /* ignore */ }
});

// --- WebGL setup -----------------
function createShader(gl, type, source) {
    const s = gl.createShader(type);
    gl.shaderSource(s, source);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        const info = gl.getShaderInfoLog(s);
        gl.deleteShader(s);
        throw new Error('Shader compile failed: ' + info);
    }
    return s;
}

function createProgram(gl, vsSrc, fsSrc) {
    const vs = createShader(gl, gl.VERTEX_SHADER, vsSrc);
    const fs = createShader(gl, gl.FRAGMENT_SHADER, fsSrc);
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        const info = gl.getProgramInfoLog(prog);
        gl.deleteProgram(prog);
        throw new Error('Program link failed: ' + info);
    }
    return prog;
}

const vsSource = `#version 100
attribute vec2 a_pos;
attribute vec2 a_uv;
varying vec2 v_uv;
void main() {
    v_uv = a_uv;
    gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

// Simplified shader - just handles aspect ratio and mirroring
const fsSource = `#version 100
precision mediump float;
varying vec2 v_uv;
uniform sampler2D u_texture;
uniform vec2 u_videoSize;
uniform float u_mirror;

void main() {
    // apply mirror
    vec2 uv = v_uv;
    uv.x = u_mirror > 0.5 ? 1.0 - uv.x : uv.x;
    
    // sample
    gl_FragColor = texture2D(u_texture, uv);
}
`;

const gl = canvas.getContext('webgl', { preserveDrawingBuffer: false });
if (!gl) {
    console.error('WebGL not available');
}

const program = createProgram(gl, vsSource, fsSource);
gl.useProgram(program);

// Quad covering clipspace
const quadVerts = new Float32Array([
    // x, y, u, v
    -1, -1, 0, 1,
     1, -1, 1, 1,
    -1,  1, 0, 0,
    -1,  1, 0, 0,
     1, -1, 1, 1,
     1,  1, 1, 0
]);

const buf = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, buf);
gl.bufferData(gl.ARRAY_BUFFER, quadVerts, gl.STATIC_DRAW);

const a_pos = gl.getAttribLocation(program, 'a_pos');
const a_uv = gl.getAttribLocation(program, 'a_uv');
gl.enableVertexAttribArray(a_pos);
gl.enableVertexAttribArray(a_uv);
gl.vertexAttribPointer(a_pos, 2, gl.FLOAT, false, 16, 0);
gl.vertexAttribPointer(a_uv, 2, gl.FLOAT, false, 16, 8);

// Texture from video
const texture = gl.createTexture();
gl.bindTexture(gl.TEXTURE_2D, texture);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

const u_texture = gl.getUniformLocation(program, 'u_texture');
const u_videoSize = gl.getUniformLocation(program, 'u_videoSize');
const u_mirror = gl.getUniformLocation(program, 'u_mirror');

gl.uniform1i(u_texture, 0);

function resizeCanvasToDisplaySize() {
    const dpr = window.devicePixelRatio || 1;
    const displayWidth = Math.max(1, Math.floor(canvas.clientWidth));
    const displayHeight = Math.max(1, Math.floor(canvas.clientHeight));
    const width = Math.max(1, Math.floor(displayWidth * dpr));
    const height = Math.max(1, Math.floor(displayHeight * dpr));
    
    if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        gl.viewport(0, 0, width, height);
    }
    
    return { width: displayWidth, height: displayHeight };
}

function updateTextureFromVideo() {
    try {
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
    } catch (e) {
        // texImage2D may throw if video not ready; ignore until it's ready
    }
}

function render() {
    resizeCanvasToDisplaySize();
    updateTextureFromVideo();
    
    // Pass video dimensions for aspect ratio handling
    const videoSize = [video.videoWidth || canvas.width, video.videoHeight || canvas.height];
    gl.uniform2fv(u_videoSize, videoSize);
    gl.uniform1f(u_mirror, videoMirrored ? 1.0 : 0.0);

    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    requestAnimationFrame(render);
}

// Start rendering loop and show the start frame (seek to 0 and pause)
function startIfReady() {
    const showStartFrame = () => {
        try { video.currentTime = 0; } catch (e) { /* ignore */ }
        // keep paused so the start frame is visible until user plays
        try { video.pause(); } catch (e) { /* ignore */ }
        requestAnimationFrame(render);
    };

    if (video.readyState >= 2) {
        showStartFrame();
    } else {
        video.addEventListener('loadeddata', () => {
            showStartFrame();
        }, { once: true });
    }
}

startIfReady();

// Controls: play/pause, fullscreen, go to head
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

// Keyboard handling - single rectangle system
let _lastSpaceToggle = 0; // timestamp in ms
const SPACE_DEBOUNCE_MS = 250;
 
window.addEventListener('keydown', (e) => {
    // ignore when typing in inputs or using content editable
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) return;

    let handled = false;
    
    // Canvas window controls (no Alt key needed anymore - it's the only control)
    const moveStep = e.shiftKey ? 50 : 10;
    if (e.code === 'NumpadAdd') {
        canvasScale += e.shiftKey ? 0.1 : 0.05;
        if (canvasScale > 2) canvasScale = 2;
        updateCanvasTransform();
        handled = true;
    } else if (e.code === 'NumpadSubtract') {
        canvasScale -= e.shiftKey ? 0.1 : 0.05;
        if (canvasScale < 0.2) canvasScale = 0.2;
        updateCanvasTransform();
        handled = true;
    } else if (e.code === 'Numpad8') {
        canvasY -= moveStep;
        updateCanvasTransform();
        handled = true;
    } else if (e.code === 'Numpad2') {
        canvasY += moveStep;
        updateCanvasTransform();
        handled = true;
    } else if (e.code === 'Numpad4') {
        canvasX -= moveStep;
        updateCanvasTransform();
        handled = true;
    } else if (e.code === 'Numpad6') {
        canvasX += moveStep;
        updateCanvasTransform();
        handled = true;
    }

    if (handled) {
        e.preventDefault();
        saveSettingsDebounced();
        return;
    }
    
    // Other controls
    if (e.code === 'Space') {
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
    } else if (e.code === 'KeyM') {
        e.preventDefault();
        videoMirrored = !videoMirrored;
        saveSettingsDebounced();
    }
});
