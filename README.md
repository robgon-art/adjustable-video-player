# adjustable-video-player

A minimal, keyboard-driven web video player that lets you scale and reposition a looping video in the viewport.

Key features
- Keyboard controls for play/pause, fullscreen, jump to start.
- Numpad-based precise position and scale adjustments (supports small and large steps with Shift).
- Video fills the viewport while preserving aspect ratio; transforms are applied with CSS.

How to use
- Place a compatible MP4 file next to `index.html` (or update the `src` in `index.html`).
- Open `index.html` in a browser.
- Controls:
	- Space: play / pause
	- F: toggle fullscreen
	- Home: jump to start and play
	- Numpad + / - : increase / decrease scale (hold Shift for larger steps)
	- Numpad 8/2/4/6 : move video up/down/left/right (hold Shift for larger steps)

Notes
- The UI is intentionally minimal and keyboard-driven; native video controls are still available but visual buttons were removed in favor of keyboard shortcuts.
- Add `.gitignore` to keep large `.mp4` files out of the repo.

License: see `LICENSE`.
