// WebGL-backed video renderer
const video = document.getElementById('video');
const canvas = document.getElementById('glcanvas');

// State for scale and position (these will be used as uniforms)
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

const fsSource = `#version 100
precision mediump float;
varying vec2 v_uv;
uniform sampler2D u_texture;
uniform vec2 u_offset; // in pixels relative to canvas center
uniform float u_scale;
uniform vec2 u_videoSize;
uniform vec2 u_canvasSize;

void main() {
    // convert v_uv (0..1) to centered pixel coords for video
    vec2 centered = (v_uv - 0.5) * u_videoSize;
    // apply scale
    centered /= u_scale;
    // apply offset (note: offset is in pixels, where positive x moves right)
    centered -= u_offset;
    // convert back to uv
    vec2 uv = (centered / u_videoSize) + 0.5;
    // sample
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
        gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    } else {
        gl_FragColor = texture2D(u_texture, uv);
    }
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
const u_offset = gl.getUniformLocation(program, 'u_offset');
const u_scale = gl.getUniformLocation(program, 'u_scale');
const u_videoSize = gl.getUniformLocation(program, 'u_videoSize');
const u_canvasSize = gl.getUniformLocation(program, 'u_canvasSize');

gl.uniform1i(u_texture, 0);

function resizeCanvasToDisplaySize() {
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.floor(canvas.clientWidth * dpr));
    const height = Math.max(1, Math.floor(canvas.clientHeight * dpr));
    if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        gl.viewport(0, 0, width, height);
    }
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

    // update texture
    updateTextureFromVideo();

    // set uniforms
    const canvasSize = [canvas.width, canvas.height];
    const videoSize = [video.videoWidth || canvas.width, video.videoHeight || canvas.height];
    gl.uniform2fv(u_canvasSize, canvasSize);
    gl.uniform2fv(u_videoSize, videoSize);
    // offset: convert from pixels to the space used in shader (we kept offsets in pixels)
    gl.uniform2fv(u_offset, [videoX, videoY]);
    gl.uniform1f(u_scale, videoScale);

    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    requestAnimationFrame(render);
}

// Start rendering loop once the video has some data
function startIfReady() {
    if (video.readyState >= 2) {
        video.play().catch(() => { });
        requestAnimationFrame(render);
    } else {
        video.addEventListener('loadeddata', () => {
            video.play().catch(() => { });
            requestAnimationFrame(render);
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

// Keyboard handling preserved from previous implementation
let _lastSpaceToggle = 0; // timestamp in ms
const SPACE_DEBOUNCE_MS = 250;

window.addEventListener('keydown', (e) => {
    // ignore when typing in inputs or using content editable
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) return;

    let handled = false;
    if (e.code === 'NumpadAdd') {
        videoScale += e.shiftKey ? 0.10 : 0.01;
        if (videoScale > 10) videoScale = 10;
        handled = true;
    } else if (e.code === 'NumpadSubtract') {
        videoScale -= e.shiftKey ? 0.10 : 0.01;
        if (videoScale < 0.1) videoScale = 0.1;
        handled = true;
    }
    const moveStep = e.shiftKey ? 10 : 1;
    if (e.code === 'Numpad8') {
        videoY -= moveStep;
        handled = true;
    } else if (e.code === 'Numpad2') {
        videoY += moveStep;
        handled = true;
    } else if (e.code === 'Numpad4') {
        videoX -= moveStep;
        handled = true;
    } else if (e.code === 'Numpad6') {
        videoX += moveStep;
        handled = true;
    }

    if (handled) {
        e.preventDefault();
        saveSettingsDebounced();
        return;
    }

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
    }
});

// Note: no object URL cleanup required for static file
