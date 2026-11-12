'use strict';

// The music library is intentionally user-supplied and is never bundled.
// Browsers require a user gesture before audio playback, so start paused.
(() => {
  const tracks = [
    'ame_en_peine',
    'first_ray',
    'remain_calm',
    'star_gazer',
    'the_peak',
  ];
  const button = document.getElementById('music-toggle');
  const icon = document.getElementById('music-icon');
  const audio = document.getElementById('music-audio');
  if (!button || !icon || !audio) return;

  let index = 0;
  let requested = false;
  const path = name => `./Music/${name}.mp3`;
  audio.src = path(tracks[index]);
  audio.loop = false; // Loop the playlist, not the individual track.

  // Icon geometry, not font glyphs: square-ended, serif-free pause bars.
  const icons = {
    play: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><path d="M8 5.5 19 12 8 18.5Z" fill="currentColor"/></svg>',
    pause: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><rect x="6" y="5" width="4" height="14" rx="0.5" fill="currentColor"/><rect x="14" y="5" width="4" height="14" rx="0.5" fill="currentColor"/></svg>',
  };

  function label() {
    const playing = requested && !audio.paused;
    icon.innerHTML = playing ? icons.pause : icons.play;
    button.setAttribute('aria-pressed', String(playing));
    button.setAttribute('aria-label', playing ? 'Pause music' : 'Play music');
    button.title = `${playing ? 'Pause' : 'Play'} music · ${tracks[index].replaceAll('_', ' ')}`;
  }

  async function play() {
    requested = true;
    try {
      await audio.play();
    } catch (error) {
      // Missing files or blocked playback should not interrupt the puzzle.
      requested = false;
      button.title = 'Music unavailable — check the Music/ folder';
    }
    label();
  }

  button.addEventListener('click', () => {
    if (requested && !audio.paused) {
      requested = false;
      audio.pause();
      label();
    } else {
      void play();
    }
  });

  audio.addEventListener('ended', () => {
    if (!requested) return;
    index = (index + 1) % tracks.length;
    audio.src = path(tracks[index]);
    void play();
  });
  audio.addEventListener('pause', label);
  audio.addEventListener('play', label);
  audio.addEventListener('error', () => {
    requested = false;
    label();
    button.title = 'Music unavailable — check the Music/ folder';
  });
  label();
})();
