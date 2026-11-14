(() => {
  'use strict';

  const WIDTH = 288;
  const HEIGHT = 512;
  const GROUND_Y = 400;
  const BIRD_X = 66;
  const BIRD_RADIUS_X = 13;
  const BIRD_RADIUS_Y = 10;
  const PIPE_WIDTH = 52;
  const PIPE_HEIGHT = 320;
  // Параметры меняются в настройках сложности.
  const DIFFICULTIES = {
    easy:   { label: 'Лёгкая',   pipeGap: 148, pipeSpeed: 92,  gravity: 1080, flapVelocity: -345 },
    normal: { label: 'Обычная',  pipeGap: 126, pipeSpeed: 112, gravity: 1180, flapVelocity: -365 },
    hard:   { label: 'Сложная',  pipeGap: 112, pipeSpeed: 134, gravity: 1260, flapVelocity: -380 }
  };
  const MAX_FALL_SPEED = 470;
  let pipeGap = DIFFICULTIES.normal.pipeGap;
  let pipeSpeed = DIFFICULTIES.normal.pipeSpeed;
  let gravity = DIFFICULTIES.normal.gravity;
  let flapVelocity = DIFFICULTIES.normal.flapVelocity;

  const SOURCES = {
    background: 'https://raw.githubusercontent.com/samuelcust/flappy-bird-assets/master/sprites/background-day.png',
    ground: 'https://raw.githubusercontent.com/samuelcust/flappy-bird-assets/master/sprites/base.png',
    pipe: 'https://raw.githubusercontent.com/samuelcust/flappy-bird-assets/master/sprites/pipe-green.png',
    birdDown: 'https://raw.githubusercontent.com/samuelcust/flappy-bird-assets/master/sprites/yellowbird-downflap.png',
    birdMid: 'https://raw.githubusercontent.com/samuelcust/flappy-bird-assets/master/sprites/yellowbird-midflap.png',
    birdUp: 'https://raw.githubusercontent.com/samuelcust/flappy-bird-assets/master/sprites/yellowbird-upflap.png',
    ready: 'https://raw.githubusercontent.com/samuelcust/flappy-bird-assets/master/sprites/message.png',
    gameover: 'https://raw.githubusercontent.com/samuelcust/flappy-bird-assets/master/sprites/gameover.png'
  };

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d', { alpha: false });
  const pauseButton = document.getElementById('pauseButton');
  const soundButton = document.getElementById('soundButton');
  const botButton = document.getElementById('botButton');
  const settingsButton = document.getElementById('settingsButton');
  const settingsOverlay = document.getElementById('settingsOverlay');
  const closeSettingsButton = document.getElementById('closeSettingsButton');
  const settingSound = document.getElementById('settingSound');
  const settingDifficulty = document.getElementById('settingDifficulty');
  const resetBestButton = document.getElementById('resetBestButton');
  const settingsBest = document.getElementById('settingsBest');
  const footerHint = document.getElementById('footerHint');
  ctx.imageSmoothingEnabled = false;

  const images = {};
  const loaded = {};
  for (const [name, url] of Object.entries(SOURCES)) {
    const img = new Image();
    img.onload = () => { loaded[name] = true; };
    img.onerror = () => { loaded[name] = false; };
    img.src = url;
    images[name] = img;
  }

  let state = 'ready'; // ready, playing, paused, gameover
  let score = 0;
  let bestScore = 0;
  let soundOn = true;
  let difficulty = 'normal';
  let botMode = false;
  let stateBeforeSettings = 'ready';
  let bird = { y: 218, velocity: 0, angle: 0 };
  let pipes = [];
  let groundOffset = 0;
  let readyTime = 0;
  let lastTime = 0;
  let audioContext = null;
  let audioUnlocked = false;

  function applyDifficulty() {
    const config = DIFFICULTIES[difficulty] || DIFFICULTIES.normal;
    pipeGap = config.pipeGap;
    pipeSpeed = config.pipeSpeed;
    gravity = config.gravity;
    flapVelocity = config.flapVelocity;
  }

  function loadBestScore() {
    try {
      if (chrome && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get({ bestScore: 0, soundOn: true, difficulty: 'normal' }, (result) => {
          if (chrome.runtime.lastError) return;
          if (Number.isFinite(result.bestScore)) bestScore = Math.max(0, result.bestScore);
          soundOn = result.soundOn !== false;
          difficulty = Object.prototype.hasOwnProperty.call(DIFFICULTIES, result.difficulty) ? result.difficulty : 'normal';
          applyDifficulty();
          syncSettingsUI();
          updateControls();
        });
      } else {
        bestScore = Number(localStorage.getItem('flappyBestScore') || 0) || 0;
        soundOn = localStorage.getItem('flappySoundOn') !== 'false';
        difficulty = localStorage.getItem('flappyDifficulty') || 'normal';
        if (!Object.prototype.hasOwnProperty.call(DIFFICULTIES, difficulty)) difficulty = 'normal';
        applyDifficulty();
        syncSettingsUI();
      }
    } catch (_) {
      try { bestScore = Number(localStorage.getItem('flappyBestScore') || 0) || 0; } catch (_) {}
      applyDifficulty();
      syncSettingsUI();
    }
  }

  function saveSettings() {
    try {
      if (chrome && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ soundOn, difficulty });
      } else {
        localStorage.setItem('flappySoundOn', String(soundOn));
        localStorage.setItem('flappyDifficulty', difficulty);
      }
    } catch (_) {
      try {
        localStorage.setItem('flappySoundOn', String(soundOn));
        localStorage.setItem('flappyDifficulty', difficulty);
      } catch (_) {}
    }
  }

  function syncSettingsUI() {
    settingSound.checked = soundOn;
    settingDifficulty.value = difficulty;
    settingsBest.textContent = String(bestScore);
  }

  function saveBestScore() {
    try {
      if (chrome && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ bestScore });
      } else {
        localStorage.setItem('flappyBestScore', String(bestScore));
      }
    } catch (_) {
      try { localStorage.setItem('flappyBestScore', String(bestScore)); } catch (_) {}
    }
  }

  function unlockAudio() {
    if (!soundOn) return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      if (!audioContext) audioContext = new AudioCtx();
      if (audioContext.state === 'suspended') audioContext.resume();
      audioUnlocked = true;
    } catch (_) {
      audioUnlocked = false;
    }
  }

  function tone(startHz, endHz, duration, type = 'sine', volume = 0.055) {
    if (!soundOn || !audioContext || !audioUnlocked) return;
    try {
      const now = audioContext.currentTime;
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(startHz, now);
      oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, endHz), now + duration);
      gain.gain.setValueAtTime(volume, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.start(now);
      oscillator.stop(now + duration + 0.01);
    } catch (_) {}
  }

  function playSound(name) {
    if (!soundOn) return;
    if (name === 'flap') tone(700, 420, 0.085, 'triangle', 0.045);
    if (name === 'point') {
      tone(660, 880, 0.11, 'sine', 0.05);
      setTimeout(() => tone(880, 1100, 0.10, 'sine', 0.045), 65);
    }
    if (name === 'hit') {
      tone(240, 90, 0.22, 'sawtooth', 0.06);
      setTimeout(() => tone(150, 55, 0.22, 'triangle', 0.045), 80);
    }
  }

  function randomPipeX() {
    return WIDTH + 20;
  }

  function makePipe(x) {
    const center = 165 + Math.random() * 125;
    return { x, center, gapTop: center - pipeGap / 2, gapBottom: center + pipeGap / 2, scored: false };
  }

  function resetRun() {
    score = 0;
    bird = { y: 218, velocity: 0, angle: 0 };
    pipes = [makePipe(205), makePipe(385)];
    groundOffset = 0;
  }

  function startGame() {
    resetRun();
    state = 'playing';
    flap();
    updateControls();
  }

  function flap() {
    if (state !== 'playing') return;
    unlockAudio();
    bird.velocity = flapVelocity;
    playSound('flap');
  }

  function finishGame() {
    if (state !== 'playing') return;
    state = 'gameover';
    playSound('hit');
    if (score > bestScore) {
      bestScore = score;
      saveBestScore();
    }
    updateControls();
  }

  function handleCanvasClick() {
    unlockAudio();
    if (state === 'ready') {
      startGame();
      return;
    }
    if (state === 'playing') {
      flap();
      return;
    }
    if (state === 'paused') {
      state = 'playing';
      updateControls();
      return;
    }
    if (state === 'gameover') {
      startGame();
    }
  }

  function updateControls() {
    pauseButton.textContent = state === 'paused' ? '▶' : 'Ⅱ';
    pauseButton.title = state === 'paused' ? 'Продолжить' : 'Пауза';
    pauseButton.setAttribute('aria-label', state === 'paused' ? 'Продолжить' : 'Пауза');
    pauseButton.disabled = !['playing', 'paused'].includes(state);
    pauseButton.style.opacity = pauseButton.disabled ? '0.5' : '1';
    soundButton.textContent = soundOn ? '♫' : '♪̸';
    soundButton.title = soundOn ? 'Выключить звук' : 'Включить звук';
    soundButton.setAttribute('aria-label', soundOn ? 'Выключить звук' : 'Включить звук');
    botButton.textContent = botMode ? 'БОТ: ВКЛ' : 'БОТ: ВЫКЛ';
    botButton.classList.toggle('active', botMode);
    botButton.setAttribute('aria-pressed', String(botMode));
    footerHint.innerHTML = botMode
      ? '<i class="dot"></i> БОТ УПРАВЛЯЕТ ПОЛЁТОМ'
      : '<i class="dot"></i> НАЖИМАЙ МЫШЬЮ, ЧТОБЫ ЛЕТЕТЬ';
    settingsBest.textContent = String(bestScore);
  }

  pauseButton.addEventListener('click', (event) => {
    event.stopPropagation();
    unlockAudio();
    if (state === 'playing') state = 'paused';
    else if (state === 'paused') state = 'playing';
    updateControls();
  });

  function setSoundEnabled(enabled) {
    soundOn = Boolean(enabled);
    if (soundOn) unlockAudio();
    syncSettingsUI();
    saveSettings();
    updateControls();
  }

  soundButton.addEventListener('click', (event) => {
    event.stopPropagation();
    setSoundEnabled(!soundOn);
  });

  botButton.addEventListener('click', (event) => {
    event.stopPropagation();
    botMode = !botMode;
    if (botMode && (state === 'ready' || state === 'gameover')) startGame();
    updateControls();
  });

  function openSettings() {
    stateBeforeSettings = state;
    if (state === 'playing') state = 'paused';
    settingsOverlay.classList.add('open');
    settingsOverlay.setAttribute('aria-hidden', 'false');
    syncSettingsUI();
    updateControls();
  }

  function closeSettings() {
    settingsOverlay.classList.remove('open');
    settingsOverlay.setAttribute('aria-hidden', 'true');
    if (stateBeforeSettings === 'playing' && state === 'paused') state = 'playing';
    updateControls();
  }

  settingsButton.addEventListener('click', openSettings);
  closeSettingsButton.addEventListener('click', closeSettings);
  settingSound.addEventListener('change', () => setSoundEnabled(settingSound.checked));
  settingDifficulty.addEventListener('change', () => {
    difficulty = Object.prototype.hasOwnProperty.call(DIFFICULTIES, settingDifficulty.value)
      ? settingDifficulty.value : 'normal';
    applyDifficulty();
    saveSettings();
    // Existing pipes keep their current opening; new pipes use the selected difficulty.
  });
  resetBestButton.addEventListener('click', () => {
    bestScore = 0;
    saveBestScore();
    syncSettingsUI();
    updateControls();
  });
  settingsOverlay.addEventListener('pointerdown', (event) => {
    if (event.target === settingsOverlay) closeSettings();
  });

  canvas.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    handleCanvasClick();
  });

  // Локальный автопилот: удерживает птицу в безопасной части ближайшего прохода.
  // Он управляет только игровым персонажем и не взаимодействует с браузером или сайтами.
  function runBotPilot() {
    const nextPipe = pipes.find(pipe => pipe.x + PIPE_WIDTH >= BIRD_X - BIRD_RADIUS_X);
    if (!nextPipe) return;

    const targetY = nextPipe.center;
    // После взмаха птица поднимается примерно на 55 px. Поэтому бот нажимает
    // при снижении чуть ниже центра прохода, чтобы вершина дуги оказалась внутри него.
    const flapThreshold = 25;
    if (bird.velocity > -120 && bird.y > targetY + flapThreshold) {
      bird.velocity = flapVelocity;
      playSound('flap');
    }
  }

  function update(dt) {
    if (state === 'ready') {
      readyTime += dt;
      groundOffset = (groundOffset + 34 * dt) % 48;
      bird.y = 218 + Math.sin(readyTime * 3.2) * 7;
      return;
    }
    if (state !== 'playing') return;

    if (botMode) runBotPilot();
    bird.velocity = Math.min(MAX_FALL_SPEED, bird.velocity + gravity * dt);
    bird.y += bird.velocity * dt;
    bird.angle = Math.max(-0.48, Math.min(1.22, bird.velocity / 410));

    groundOffset = (groundOffset + pipeSpeed * dt) % 48;

    for (const pipe of pipes) {
      pipe.x -= pipeSpeed * dt;
      if (!pipe.scored && pipe.x + PIPE_WIDTH < BIRD_X) {
        pipe.scored = true;
        score += 1;
        playSound('point');
      }

      const overlapsX = BIRD_X + BIRD_RADIUS_X > pipe.x && BIRD_X - BIRD_RADIUS_X < pipe.x + PIPE_WIDTH;
      if (overlapsX && (bird.y - BIRD_RADIUS_Y < pipe.gapTop || bird.y + BIRD_RADIUS_Y > pipe.gapBottom)) {
        finishGame();
        return;
      }
    }

    pipes = pipes.filter(pipe => pipe.x > -PIPE_WIDTH - 2);
    if (pipes.length === 0 || pipes[pipes.length - 1].x < WIDTH - 175) {
      pipes.push(makePipe(randomPipeX()));
    }

    if (bird.y - BIRD_RADIUS_Y < 0 || bird.y + BIRD_RADIUS_Y >= GROUND_Y) {
      finishGame();
    }
  }

  function drawFallbackBackground() {
    const sky = ctx.createLinearGradient(0, 0, 0, HEIGHT);
    sky.addColorStop(0, '#64c7d1');
    sky.addColorStop(0.68, '#c5e9d6');
    sky.addColorStop(1, '#72d85e');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.fillStyle = '#f5f0c5';
    for (const cloud of [[35, 94, 24], [125, 70, 31], [228, 115, 27]]) {
      ctx.beginPath();
      ctx.arc(cloud[0], cloud[1], cloud[2] * .55, 0, Math.PI * 2);
      ctx.arc(cloud[0] + cloud[2] * .48, cloud[1] + 2, cloud[2] * .72, 0, Math.PI * 2);
      ctx.arc(cloud[0] + cloud[2], cloud[1] + 4, cloud[2] * .5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#75d75a';
    ctx.beginPath();
    ctx.moveTo(0, 355);
    for (let x = 0; x <= WIDTH; x += 24) ctx.lineTo(x, 345 + Math.sin(x * .045) * 13);
    ctx.lineTo(WIDTH, HEIGHT); ctx.lineTo(0, HEIGHT); ctx.closePath(); ctx.fill();
  }

  function drawBackground() {
    if (loaded.background) ctx.drawImage(images.background, 0, 0, WIDTH, HEIGHT);
    else drawFallbackBackground();
  }

  function drawGround() {
    if (loaded.ground) {
      const w = 336;
      const offset = groundOffset % w;
      ctx.drawImage(images.ground, -offset, GROUND_Y, w, 112);
      ctx.drawImage(images.ground, w - offset, GROUND_Y, w, 112);
    } else {
      ctx.fillStyle = '#ded895';
      ctx.fillRect(0, GROUND_Y, WIDTH, HEIGHT - GROUND_Y);
      ctx.fillStyle = '#8edb4e';
      ctx.fillRect(0, GROUND_Y, WIDTH, 13);
      ctx.fillStyle = '#73ba3a';
      for (let x = -24 - groundOffset; x < WIDTH + 24; x += 24) {
        ctx.fillRect(x, GROUND_Y + 2, 12, 5);
        ctx.fillRect(x + 12, GROUND_Y + 8, 12, 5);
      }
    }
  }

  function drawFallbackPipe(x, gapTop, gapBottom) {
    const drawOne = (y, h, upsideDown) => {
      ctx.save();
      if (upsideDown) {
        ctx.translate(x + PIPE_WIDTH / 2, y + h);
        ctx.scale(1, -1);
        ctx.translate(-(x + PIPE_WIDTH / 2), -(y + h));
      }
      const grad = ctx.createLinearGradient(x, 0, x + PIPE_WIDTH, 0);
      grad.addColorStop(0, '#477d19');
      grad.addColorStop(.24, '#91d737');
      grad.addColorStop(.68, '#b8ed54');
      grad.addColorStop(1, '#477d19');
      ctx.fillStyle = grad;
      ctx.fillRect(x + 5, y, PIPE_WIDTH - 10, h);
      ctx.fillStyle = '#a5e64a';
      ctx.fillRect(x, y + h - 26, PIPE_WIDTH, 26);
      ctx.fillStyle = '#477d19';
      ctx.fillRect(x, y + h - 3, PIPE_WIDTH, 3);
      ctx.fillStyle = 'rgba(255,255,255,.20)';
      ctx.fillRect(x + 9, y, 5, h);
      ctx.restore();
    };
    drawOne(gapTop - PIPE_HEIGHT, PIPE_HEIGHT, true);
    drawOne(gapBottom, PIPE_HEIGHT, false);
  }

  function drawPipes() {
    for (const pipe of pipes) {
      if (loaded.pipe) {
        ctx.save();
        ctx.translate(pipe.x + PIPE_WIDTH / 2, pipe.gapTop);
        ctx.rotate(Math.PI);
        ctx.drawImage(images.pipe, -PIPE_WIDTH / 2, 0, PIPE_WIDTH, PIPE_HEIGHT);
        ctx.restore();
        ctx.drawImage(images.pipe, pipe.x, pipe.gapBottom, PIPE_WIDTH, PIPE_HEIGHT);
      } else {
        drawFallbackPipe(pipe.x, pipe.gapTop, pipe.gapBottom);
      }
    }
  }

  function drawFallbackBird() {
    ctx.save();
    ctx.translate(BIRD_X, bird.y);
    ctx.rotate(bird.angle);
    // Rounded pixel-style yellow bird drawn locally as a fallback.
    ctx.fillStyle = '#f8cb32';
    ctx.fillRect(-12, -8, 20, 16);
    ctx.fillRect(-8, -11, 13, 22);
    ctx.fillStyle = '#fff0a1';
    ctx.fillRect(-8, -7, 12, 5);
    ctx.fillStyle = '#e88f27';
    ctx.fillRect(7, -2, 10, 6);
    ctx.fillStyle = '#fff';
    ctx.fillRect(2, -8, 7, 7);
    ctx.fillStyle = '#252b38';
    ctx.fillRect(6, -6, 3, 4);
    ctx.fillStyle = '#d98b1f';
    ctx.fillRect(-7, 7, 8, 3);
    ctx.restore();
  }

  function drawBird(now) {
    const frames = ['birdDown', 'birdMid', 'birdUp', 'birdMid'];
    const key = frames[Math.floor(now / 105) % frames.length];
    const image = images[key];
    if (!loaded[key]) {
      drawFallbackBird();
      return;
    }
    ctx.save();
    ctx.translate(BIRD_X, bird.y);
    ctx.rotate(bird.angle);
    ctx.drawImage(image, -17, -12, 34, 24);
    ctx.restore();
  }

  function outlinedText(text, x, y, size, color = '#fff', align = 'center') {
    ctx.save();
    ctx.font = `900 ${size}px Arial, sans-serif`;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(2, size / 5);
    ctx.strokeStyle = '#654b42';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  function drawScore() {
    outlinedText(String(score), WIDTH / 2, 58, 34, '#fff');
    ctx.save();
    ctx.font = 'bold 10px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(42,62,74,.9)';
    ctx.fillText(`РЕКОРД  ${bestScore}`, WIDTH / 2, 83);
    ctx.restore();
  }

  function drawReady(now) {
    // Small card keeps the original arcade mood while keeping all instructions in Russian.
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,.80)';
    ctx.strokeStyle = '#a36c42';
    ctx.lineWidth = 3;
    ctx.fillRect(25, 117, 238, 125);
    ctx.strokeRect(25, 117, 238, 125);
    outlinedText('FLAPPY BIRD', WIDTH / 2, 145, 23, '#f5b92e');
    outlinedText('ГОТОВ?', WIDTH / 2, 181, 24, '#70c94f');
    ctx.font = 'bold 12px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#5b4b42';
    ctx.fillText('КЛИКНИ, ЧТОБЫ НАЧАТЬ', WIDTH / 2, 218);
    ctx.restore();
    ctx.save();
    ctx.fillStyle = 'rgba(55,67,74,.82)';
    ctx.font = 'bold 11px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('ПРОЛЕТАЙ МЕЖДУ ТРУБАМИ', WIDTH / 2, 321);
    ctx.restore();
  }

  function drawPause() {
    ctx.fillStyle = 'rgba(24,35,52,.58)';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.fillStyle = '#fff8d7';
    ctx.strokeStyle = '#755c43';
    ctx.lineWidth = 3;
    ctx.fillRect(39, 195, 210, 94);
    ctx.strokeRect(39, 195, 210, 94);
    outlinedText('ПАУЗА', WIDTH / 2, 228, 27, '#76c94e');
    ctx.fillStyle = '#5d5145';
    ctx.font = 'bold 12px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('КЛИКНИ, ЧТОБЫ ПРОДОЛЖИТЬ', WIDTH / 2, 263);
  }

  function drawGameOver() {
    ctx.fillStyle = 'rgba(25,35,48,.36)';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.fillStyle = '#fff8d7';
    ctx.strokeStyle = '#765744';
    ctx.lineWidth = 3;
    ctx.fillRect(26, 160, 236, 190);
    ctx.strokeRect(26, 160, 236, 190);
    if (loaded.gameover) {
      ctx.drawImage(images.gameover, 56, 176, 176, 44);
    } else {
      outlinedText('ИГРА ОКОНЧЕНА', WIDTH / 2, 198, 20, '#f09b47');
    }
    ctx.fillStyle = '#594b40';
    ctx.font = 'bold 13px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`СЧЁТ: ${score}`, WIDTH / 2, 252);
    ctx.fillText(`РЕКОРД: ${bestScore}`, WIDTH / 2, 277);
    ctx.fillStyle = '#70b847';
    ctx.font = '900 13px Arial, sans-serif';
    ctx.fillText('КЛИКНИ, ЧТОБЫ СЫГРАТЬ СНОВА', WIDTH / 2, 319);
  }

  function render(now) {
    ctx.imageSmoothingEnabled = false;
    drawBackground();
    if (state === 'playing' || state === 'paused' || state === 'gameover') drawPipes();
    drawGround();
    drawBird(now);

    if (state === 'playing') drawScore();
    if (state === 'ready') drawReady(now);
    if (state === 'paused') {
      drawScore();
      drawPause();
    }
    if (state === 'gameover') {
      drawScore();
      drawGameOver();
    }
  }

  function frame(timestamp) {
    if (!lastTime) lastTime = timestamp;
    const dt = Math.min((timestamp - lastTime) / 1000, 0.035);
    lastTime = timestamp;
    update(dt);
    render(timestamp);
    requestAnimationFrame(frame);
  }

  applyDifficulty();
  loadBestScore();
  updateControls();
  requestAnimationFrame(frame);
})();
