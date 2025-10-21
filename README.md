# adjustable-video-player# adjustable-video-player



A 16:9 video player that can be positioned and scaled as a window, rendered with WebGL.A minimal, keyboard-driven web video player that renders the video with WebGL and lets you scale and reposition it in the viewport.



## Key featuresKey features

- Fixed 16:9 canvas window that can be moved and scaled- WebGL-based rendering (video used as a texture) for fast pixel transforms.

- WebGL rendering with video aspect ratio maintained- Keyboard controls for play/pause, fullscreen, jump to start, and precise Numpad-based scale/position adjustments.

- Settings persist across page reloads- Settings (scale and offset) are saved to localStorage so your layout persists across reloads.

- Keyboard-driven controls

How to use

## How to use- Place a compatible MP4 file next to `index.html` (or update the `src` in `index.html`).

- Place a compatible MP4 file next to `index.html` (or update the `src` in `index.html`).- Open `index.html` in a browser. Press Space to start playback (browsers require a user gesture for audio).

- Open `index.html` in a browser. Press Space to start playback.- Controls:

  - Space: play / pause

## Controls  - F: toggle fullscreen

  - M: toggle mirror (flip horizontally)

**Canvas window:**  - Home: jump to start and play

- Numpad +/-: resize canvas (hold Shift for larger steps)  - Numpad + / - : increase / decrease scale (hold Shift for larger steps)

- Numpad 8/2/4/6: move canvas up/down/left/right (hold Shift for larger steps)  - Numpad 8/2/4/6 : move video up/down/left/right (hold Shift for larger steps)



**Video playback:**Notes

- Space: play/pause- The video element is kept hidden and used as a texture source for the WebGL canvas.

- F: toggle fullscreen- Settings are stored under the key `avp:settings:v1` in `localStorage`.

- M: mirror horizontally

- Home: jump to startLicense: see `LICENSE`.


## Notes
- The canvas starts at 1280px width (16:9) and can be scaled from 20% to 200%
- Video always fills the canvas while maintaining its aspect ratio
- All settings (canvas size/position, mirror state) persist in localStorage

## License
See `LICENSE`.
