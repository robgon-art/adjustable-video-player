# adjustable-video-player

A minimal, keyboard-driven web video player that renders the video with WebGL and lets you scale and reposition it in the viewport.

Key features
- WebGL-based rendering (video used as a texture) for fast pixel transforms.
- Keyboard controls for play/pause, fullscreen, jump to start, and precise Numpad-based scale/position adjustments.
- Settings (scale and offset) are saved to localStorage so your layout persists across reloads.

How to use
- Place a compatible MP4 file next to `index.html` (or update the `src` in `index.html`).
- Open `index.html` in a browser. Press Space to start playback (browsers require a user gesture for audio).
- Controls:
  - Space: play / pause
  - F: toggle fullscreen
  - Home: jump to start and play
  - Numpad + / - : increase / decrease scale (hold Shift for larger steps)
  - Numpad 8/2/4/6 : move video up/down/left/right (hold Shift for larger steps)

Notes
- The video element is kept hidden and used as a texture source for the WebGL canvas.
- Settings are stored under the key `avp:settings:v1` in `localStorage`.

License: see `LICENSE`.
