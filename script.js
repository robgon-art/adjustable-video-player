// WebGL-backed video renderer - Single rectangle system
const video = document.getElementById('video');
const canvas = document.getElementById('glcanvas');
const overlayCanvas = document.getElementById('overlay');

// State for canvas transforms (single rectangle - the canvas itself)
let canvasScale = 1.0; // scales the 1280px base width (0.2 to 2.0)
let canvasX = 0; // offset from centered position
let canvasY = 0;
let videoMirrored = false; // horizontal flip

// Corner pinning state
// Corners are stored as offsets from default positions in normalized video coordinates (0-1)
// TL = top-left (7), TR = top-right (9), BL = bottom-left (1), BR = bottom-right (3)
let cornerOffsets = {
    TL: { x: 0, y: 0 },
    TR: { x: 0, y: 0 },
    BL: { x: 0, y: 0 },
    BR: { x: 0, y: 0 }
};
let selectedCorner = null; // 'TL', 'TR', 'BL', 'BR', or null

// --- persistence -----------------
const SETTINGS_KEY = 'avp:settings:v1';
const DEFAULT_SETTINGS = {
    canvasScale: 1.0,
    canvasX: 0,
    canvasY: 0,
    mirrored: false,
    cornerOffsets: {
        TL: { x: 0, y: 0 },
        TR: { x: 0, y: 0 },
        BL: { x: 0, y: 0 },
        BR: { x: 0, y: 0 }
    }
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
        // Validate corner offsets structure
        if (!data.cornerOffsets || typeof data.cornerOffsets !== 'object') {
            data.cornerOffsets = DEFAULT_SETTINGS.cornerOffsets;
        } else {
            // Ensure all corners exist
            ['TL', 'TR', 'BL', 'BR'].forEach(corner => {
                if (!data.cornerOffsets[corner] ||
                    typeof data.cornerOffsets[corner].x !== 'number' ||
                    typeof data.cornerOffsets[corner].y !== 'number') {
                    data.cornerOffsets[corner] = { x: 0, y: 0 };
                }
            });
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
                mirrored: videoMirrored,
                cornerOffsets
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
    const transform = `translate(calc(-50% + ${canvasX}px), calc(-50% + ${canvasY}px)) scale(${canvasScale})`;
    canvas.style.transform = transform;
    overlayCanvas.style.transform = transform;
}

// Load on start
(() => {
    const s = loadSettings();
    canvasScale = s.canvasScale;
    canvasX = s.canvasX;
    canvasY = s.canvasY;
    videoMirrored = s.mirrored;
    cornerOffsets = s.cornerOffsets;
    updateCanvasTransform();
})();

// Save on unload as a last-resort synchronous write
window.addEventListener('beforeunload', () => {
    try {
        const payload = {
            canvasScale,
            canvasX,
            canvasY,
            mirrored: videoMirrored,
            cornerOffsets
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

// Simplified shader - handles mirroring and black masking outside texture bounds
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
    
    // Check if UV coordinates are outside valid range (0-1)
    // If so, render black instead of sampling the texture
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
        gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); // Black
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

// Quad covering clipspace - will be updated with corner pin UVs
const quadVerts = new Float32Array([
    // x, y, u, v
    -1, -1, 0, 1,
    1, -1, 1, 1,
    -1, 1, 0, 0,
    -1, 1, 0, 0,
    1, -1, 1, 1,
    1, 1, 1, 0
]);

const buf = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, buf);
gl.bufferData(gl.ARRAY_BUFFER, quadVerts, gl.DYNAMIC_DRAW); // DYNAMIC since we'll update it

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

// Update the quad vertex buffer with current corner pin positions
function updateQuadWithCorners() {
    // Calculate UV coordinates with corner offsets applied
    // Invert the offsets so moving a corner up moves the video content up (intuitive)
    const uvTL = { x: 0 - cornerOffsets.TL.x, y: 0 - cornerOffsets.TL.y };
    const uvTR = { x: 1 - cornerOffsets.TR.x, y: 0 - cornerOffsets.TR.y };
    const uvBL = { x: 0 - cornerOffsets.BL.x, y: 1 - cornerOffsets.BL.y };
    const uvBR = { x: 1 - cornerOffsets.BR.x, y: 1 - cornerOffsets.BR.y };
    
    // Update the quadVerts array with new UV coordinates
    // Triangle 1: BL, BR, TL
    quadVerts[2] = uvBL.x;  // BL u
    quadVerts[3] = uvBL.y;  // BL v
    quadVerts[6] = uvBR.x;  // BR u
    quadVerts[7] = uvBR.y;  // BR v
    quadVerts[10] = uvTL.x; // TL u
    quadVerts[11] = uvTL.y; // TL v
    
    // Triangle 2: TL, BR, TR
    quadVerts[14] = uvTL.x; // TL u
    quadVerts[15] = uvTL.y; // TL v
    quadVerts[18] = uvBR.x; // BR u
    quadVerts[19] = uvBR.y; // BR v
    quadVerts[22] = uvTR.x; // TR u
    quadVerts[23] = uvTR.y; // TR v
    
    // Upload updated vertices to GPU
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, quadVerts, gl.DYNAMIC_DRAW);
}function resizeCanvasToDisplaySize() {
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

// Draw corner pin indicators
function drawCornerIndicators() {
    const ctx = overlayCanvas.getContext('2d');
    if (!ctx) return;

    // Match overlay canvas size to display size with device pixel ratio
    const dpr = window.devicePixelRatio || 1;
    const displayWidth = overlayCanvas.clientWidth;
    const displayHeight = overlayCanvas.clientHeight;
    const width = Math.floor(displayWidth * dpr);
    const height = Math.floor(displayHeight * dpr);

    if (overlayCanvas.width !== width || overlayCanvas.height !== height) {
        overlayCanvas.width = width;
        overlayCanvas.height = height;
    }

    // Clear the overlay
    ctx.clearRect(0, 0, width, height);

    if (!selectedCorner) return;

    const videoWidth = video.videoWidth || 1920;
    const videoHeight = video.videoHeight || 1080;

    // Calculate default corner positions (normalized 0-1)
    const corners = {
        TL: { x: 0, y: 0 },
        TR: { x: 1, y: 0 },
        BL: { x: 0, y: 1 },
        BR: { x: 1, y: 1 }
    };

    // Apply offsets to corners (offsets are in normalized coordinates)
    for (const corner in corners) {
        corners[corner].x += cornerOffsets[corner].x;
        corners[corner].y += cornerOffsets[corner].y;
    }

    // Convert to canvas pixel coordinates
    // The overlay canvas matches the video display area exactly
    for (const corner in corners) {
        corners[corner].x = corners[corner].x * width;
        corners[corner].y = corners[corner].y * height;
    }

    // Draw red circle around selected corner
    const pos = corners[selectedCorner];
    if (pos) {
        ctx.save();
        ctx.strokeStyle = 'red';
        ctx.lineWidth = 3 * dpr;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, 15 * dpr, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
    }
}

function render() {
    resizeCanvasToDisplaySize();
    updateTextureFromVideo();
    updateQuadWithCorners(); // Update geometry with corner pin positions

    // Pass video dimensions for aspect ratio handling
    const videoSize = [video.videoWidth || canvas.width, video.videoHeight || canvas.height];
    gl.uniform2fv(u_videoSize, videoSize);
    gl.uniform1f(u_mirror, videoMirrored ? 1.0 : 0.0);

    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // Draw corner indicators on top
    drawCornerIndicators();

    requestAnimationFrame(render);
}// Start rendering loop and show the start frame (seek to 0 and pause)
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

    // Corner pin selection (7=TL, 9=TR, 1=BL, 3=BR, 5=hide)
    if (e.code === 'Numpad7') {
        selectedCorner = 'TL';
        handled = true;
    } else if (e.code === 'Numpad9') {
        selectedCorner = 'TR';
        handled = true;
    } else if (e.code === 'Numpad1') {
        selectedCorner = 'BL';
        handled = true;
    } else if (e.code === 'Numpad3') {
        selectedCorner = 'BR';
        handled = true;
    } else if (e.code === 'Numpad5') {
        // Clear selection (hide the red circle)
        selectedCorner = null;
        handled = true;
    }

    // Corner pin movement (arrow keys when a corner is selected)
    if (selectedCorner) {
        const videoWidth = video.videoWidth || 1920;
        const videoHeight = video.videoHeight || 1080;
        // Move by 1 pixel normally, 10 pixels with shift
        const pixelStep = e.shiftKey ? 10 : 1;
        const normalizedStepX = pixelStep / videoWidth;
        const normalizedStepY = pixelStep / videoHeight;

        if (e.code === 'Numpad8') {
            cornerOffsets[selectedCorner].y -= normalizedStepY;
            handled = true;
        } else if (e.code === 'Numpad2') {
            cornerOffsets[selectedCorner].y += normalizedStepY;
            handled = true;
        } else if (e.code === 'Numpad4') {
            cornerOffsets[selectedCorner].x -= normalizedStepX;
            handled = true;
        } else if (e.code === 'Numpad6') {
            cornerOffsets[selectedCorner].x += normalizedStepX;
            handled = true;
        }

        if (handled) {
            e.preventDefault();
            saveSettingsDebounced();
            return;
        }
    }

    // Canvas window controls (only when NOT in corner pin mode)
    if (!handled && !selectedCorner) {
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
