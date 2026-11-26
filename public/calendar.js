'use strict';

(() => {
  const $ = id => document.getElementById(id);
  const scene = $('winter-scene');
  const dialog = $('door-dialog');
  const todayDoor = $('today-door');
  const calendarMessage = $('calendar-message');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const doorOrder = [7, 18, 2, 15, 9, 23, 12, 4, 21, 6, 17, 10, 1, 14, 8, 24, 3, 20, 16, 5, 22, 11, 19, 13];
  const doorButtons = new Map();
  const formatDay = day => String(day).padStart(2, '0');
  const pages = document.body.dataset.calendarMode === 'pages';
  const requestedPreview = !pages && new URLSearchParams(location.search).get('preview') === '1';
  const state = { calendar: null, opened: new Set(), snow: true, serverOffset: 0, opening: false, weather: null };
  let phaseTimer, activeDoor;
  function readLocal(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
  function writeLocal(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Der Kalender bleibt auch ohne Browserspeicher bedienbar. */ } }
  function icon(id, className = '') {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    if (className) svg.setAttribute('class', className);
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', `#i-${id}`);
    svg.append(use);
    return svg;
  }
  function setText(element, message) {
    if (element.textContent !== message) element.textContent = message;
  }
  function toast(message) {
    setText($('toast'), message);
  }
  async function api(path) {
    const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Das Türchen konnte gerade nicht geladen werden.');
    return data;
  }
  function serverDateParts() {
    const now = new Date(Date.now() + state.serverOffset);
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: state.calendar?.timeZone || 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(now);
    return Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
  }
  function doorMetadata(day) {
    return state.calendar?.doors.find(door => door.day === day);
  }
  function isNovemberTest(date) {
    if (!state.calendar?.novemberTest) return false;
    const { year, month } = date ?? serverDateParts();
    return year === state.calendar.year && month === 11;
  }
  function canOpen(day, novemberTest = isNovemberTest()) {
    return Boolean(doorMetadata(day)?.available) && (!state.calendar.novemberTest || novemberTest);
  }
  function openedStorageKey(calendar) {
    if (!calendar) return null;
    const key = `advent-${calendar.year}-opened`;
    if (calendar.novemberTest) return `${key}-november-test`;
    return calendar.preview ? `${key}-preview` : key;
  }
  function phaseForHour(hour) {
    if (hour >= 6 && hour < 11) return 'morning';
    if (hour >= 11 && hour < 14) return 'noon';
    if (hour >= 14 && hour < 17) return 'afternoon';
    if (hour >= 17 && hour < 22) return 'evening';
    return 'night';
  }
  function updateLighting() {
    clearTimeout(phaseTimer);
    const phase = phaseForHour(serverDateParts().hour);
    if (scene.dataset.phase !== phase) scene.dataset.phase = phase;
    const untilNextMinute = 60_000 - (Date.now() + state.serverOffset) % 60_000;
    phaseTimer = setTimeout(updateLighting, untilNextMinute + 50);
  }
  function makeDoor(day) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'calendar-door is-locked';
    button.dataset.day = String(day);
    button.setAttribute('aria-label', `Türchen ${formatDay(day)}`);
    button.setAttribute('aria-disabled', 'true');
    const inside = document.createElement('span');
    inside.className = 'door-inside';
    inside.append(icon('star'));
    const leaf = document.createElement('span');
    leaf.className = 'door-leaf';
    const frost = document.createElement('span');
    frost.className = 'door-frost';
    frost.hidden = true;
    frost.setAttribute('aria-hidden', 'true');
    frost.append(icon('snow'), icon('snow'));
    const number = document.createElement('span');
    number.className = 'door-number';
    number.textContent = formatDay(day);
    leaf.append(frost, number, icon('check', 'door-check'), icon('lock', 'door-lock'));
    button.append(inside, leaf);
    button.addEventListener('click', () => openDoor(day, button));
    return button;
  }
  function buildDoors() {
    for (const day of doorOrder) doorButtons.set(day, makeDoor(day));
    $('building-doors').replaceChildren(...doorButtons.values());
  }
  function syncDoors() {
    const date = serverDateParts();
    const year = state.calendar.year;
    const novemberTest = isNovemberTest(date);
    const beforeAdvent = !state.calendar.preview && (date.year < year || (date.year === year && date.month < 12));
    const isAdventDay = date.year === year && date.month === 12 && date.day <= 24;
    const today = isAdventDay ? date.day : null;
    const todayAvailable = today !== null && canOpen(today, novemberTest);

    for (const [day, button] of doorButtons) {
      const available = canOpen(day, novemberTest);
      const opened = state.opened.has(day);
      const isToday = available && day === today;
      const label = `Türchen ${formatDay(day)}`;
      button.classList.toggle('is-available', available);
      button.classList.toggle('is-locked', !available);
      button.classList.toggle('is-open', available && opened);
      button.classList.toggle('is-today', isToday);
      button.querySelector('.door-frost').hidden = opened;
      button.setAttribute('aria-disabled', String(!available));
      if (available) {
        button.setAttribute('aria-label', `${label}${opened ? ' erneut' : ''} öffnen`);
        button.setAttribute('aria-haspopup', 'dialog');
        button.removeAttribute('title');
      } else {
        const meta = doorMetadata(day);
        const future = beforeAdvent || (today !== null && day > today);
        const scheduled = future && (pages || meta?.published);
        const closedLabel = `${label} – ${scheduled ? `ab ${day}. Dezember` : 'derzeit nicht verfügbar'}`;
        button.setAttribute('aria-label', closedLabel);
        button.removeAttribute('aria-haspopup');
        button.title = closedLabel;
      }
      if (isToday) button.setAttribute('aria-current', 'date');
      else button.removeAttribute('aria-current');
    }

    let message = 'Alle verfügbaren Türchen bleiben zugänglich.';
    if (novemberTest) message = 'Alle 24 Türchen sind verfügbar.';
    else if (beforeAdvent) message = 'Advent startet am 1. Dezember.';
    else if (state.calendar.novemberTest) message = 'Die Advent-Türchen werden gerade bereitgestellt.';
    else if (today !== null) {
      if (!todayAvailable) message = `Türchen ${formatDay(today)} ist derzeit nicht verfügbar.`;
      else message = `Heute öffnet Türchen ${formatDay(today)}.`;
    }
    setText(calendarMessage, message);
    $('door-legend').hidden = novemberTest || state.calendar.preview;
    if (todayAvailable) {
      todayDoor.dataset.day = String(today);
      setText(todayDoor, `Türchen ${formatDay(today)} öffnen`);
    } else {
      if (document.activeElement === todayDoor) doorButtons.get(Number(todayDoor.dataset.day))?.focus();
      delete todayDoor.dataset.day;
    }
    todayDoor.hidden = !todayAvailable;

    const count = state.calendar.novemberTest && !novemberTest ? 0 : state.opened.size;
    setText($('opened-count'), String(count));
    $('progress-fill').style.width = `${count / 24 * 100}%`;
    setText($('year-label'), String(year));
  }
  function renderDoor(data) {
    $('dialog-day').textContent = formatDay(data.day);
    $('dialog-eyebrow').textContent = `DEIN ${data.day}. TÜRCHEN`;
    $('dialog-title').textContent = data.title || 'Ein kleiner Lichtblick';
    $('dialog-text').textContent = data.text || '';
    const contentImage = $('dialog-image');
    contentImage.hidden = !data.imageUrl;
    contentImage.alt = data.imageAlt || '';
    if (data.imageUrl) contentImage.src = data.imageUrl;
    else contentImage.removeAttribute('src');
    const links = $('dialog-links');
    links.replaceChildren();
    for (const link of data.links || []) {
      let target;
      try { target = new URL(link.url, location.origin); } catch { continue; }
      if (!['https:', 'http:'].includes(target.protocol)) continue;
      const anchor = document.createElement('a');
      anchor.className = 'dialog-link';
      anchor.href = target.href;
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
      const text = document.createElement('span');
      text.textContent = link.label || 'Überraschung ansehen';
      const newTabHint = document.createElement('span');
      newTabHint.className = 'visually-hidden';
      newTabHint.textContent = ' (öffnet einen neuen Tab)';
      anchor.append(text, newTabHint);
      links.append(anchor);
    }
  }
  async function openDoor(day, trigger) {
    if (state.opening || dialog.open) return;
    const tile = doorButtons.get(day);
    if (!canOpen(day)) {
      if (state.calendar) toast(`${tile.getAttribute('aria-label')}.`);
      else if ($('error-message').hidden) toast('Die Türchen werden noch geladen.');
      return;
    }
    const storageKey = openedStorageKey(state.calendar);
    state.opening = true;
    trigger.setAttribute('aria-busy', 'true');
    try {
      const data = pages
        ? doorMetadata(day).content
        : await api(`/api/doors/${day}${state.calendar.preview ? '?preview=1' : ''}`);
      const animate = !reducedMotion.matches;
      if (animate) tile.classList.add('is-opening');
      state.weather?.burst();
      if (animate) await new Promise(resolve => setTimeout(resolve, 420));
      if (openedStorageKey(state.calendar) !== storageKey || !canOpen(day)) {
        toast(`Türchen ${formatDay(day)} ist derzeit nicht verfügbar.`);
        return;
      }
      renderDoor(data);
      toast('');
      if (animate) {
        const bounds = tile.getBoundingClientRect();
        const slideFrom = (position, viewportSize) => Math.max(-56, Math.min(56, Math.round((position - viewportSize / 2) * .16)));
        dialog.style.setProperty('--card-from-x', slideFrom(bounds.left + bounds.width / 2, window.innerWidth) + 'px');
        dialog.style.setProperty('--card-from-y', slideFrom(bounds.top + bounds.height / 2, window.innerHeight) + 'px');
      }
      dialog.showModal();
      dialog.scrollTop = 0;
      const newlyOpened = !state.opened.has(day);
      state.opened.add(day);
      writeLocal(storageKey, [...state.opened]);
      activeDoor = { trigger, tile, announcement: newlyOpened ? `${state.opened.size} von 24 Türchen geöffnet.` : '' };
      syncDoors();
      $('dialog-title').focus({ preventScroll: true });
    } catch (error) { toast(error.message); }
    finally {
      if (!dialog.open) tile.classList.remove('is-opening');
      trigger.removeAttribute('aria-busy');
      state.opening = false;
    }
  }
  function createSnow() {
    const canvas = $('snow-canvas');
    const ctx = canvas?.getContext('2d');
    if (!ctx) return { burst() {}, setEnabled() {} };
    const detailCanvas = $('dialog-snow');
    const detailContext = detailCanvas?.getContext('2d');
    const tau = 2 * Math.PI;
    const sampleCount = 101;
    const accumulated = new Float32Array(sampleCount);
    const profile = Float32Array.from(accumulated, (_, i) => {
      const x = i / (sampleCount - 1);
      return 5.5 + 1.8 * Math.sin(x * tau * 1.65 + 1.7) + 1.4 * Math.sin(x * tau * 3.1 - .7) + 3.4 * Math.abs(2 * x - 1) ** 3;
    });
    const flakes = [];
    const shower = [];
    const layers = [
      { radius: [1.1, 2.5], speed: [42, 64], opacity: [.4, .72] },
      { radius: [3.4, 5.7], speed: [61, 91], opacity: [.65, .89] },
      { radius: [6, 9.5], speed: [87, 126], opacity: [.76, .98] },
    ];
    const spriteSize = 80;
    let width = 0, height = 0, raf = 0, last = 0, bankLimit = 0;
    let detailWidth = 0, detailHeight = 0;
    let baseRate = 0, baseLimit = 0, showerLimit = 0, baseCredit = 0, showerCredit = 0;
    let age = Infinity, elapsed = 0, gradient, sized = false;
    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
    const moving = () => sized && state.snow && !document.hidden;
    const motionScale = () => reducedMotion.matches ? .6 : 1;
    const randomBetween = ([min, max]) => min + Math.random() * (max - min);

    function makeSprite(paint) {
      const sprite = document.createElement('canvas');
      sprite.width = sprite.height = spriteSize;
      const ink = sprite.getContext('2d');
      if (!ink) return null;
      ink.translate(spriteSize / 2, spriteSize / 2);
      paint(ink);
      return sprite;
    }

    const powder = makeSprite(ink => {
      const softEdge = ink.createRadialGradient(-5, -4, 2, 0, 0, 36);
      softEdge.addColorStop(0, '#ffffff');
      softEdge.addColorStop(.48, '#f6fbfff2');
      softEdge.addColorStop(.75, '#e7f3ff90');
      softEdge.addColorStop(1, '#b4c8df00');
      ink.scale(1, .84);
      ink.fillStyle = softEdge;
      ink.beginPath();
      ink.arc(0, 0, 36, 0, tau);
      ink.fill();
    });

    // Paint the crystal silhouettes once; only position and turn them each frame.
    const crystals = [
      { arms: [33, 34, 32], forks: [[.39, 10], [.63, 8], [.81, 4]] },
      { arms: [34, 30, 33], forks: [[.45, 12], [.73, 7]] },
      { arms: [32, 35, 33], forks: [[.30, 7], [.55, 12], [.78, 5]] },
    ].map(({ arms, forks }) => makeSprite(ink => {
      ink.lineCap = 'round';
      ink.lineJoin = 'round';
      ink.beginPath();
      for (let arm = 0; arm < 6; arm++) {
        const angle = arm * tau / 6 - tau / 4;
        const length = arms[arm % 3];
        const x = Math.cos(angle), y = Math.sin(angle);
        ink.moveTo(0, 0);
        ink.lineTo(x * length, y * length);
        for (const [start, branchLength] of forks) {
          const sx = x * length * start, sy = y * length * start;
          for (const side of [-1, 1]) {
            const turn = angle + side * tau / 6;
            ink.moveTo(sx, sy);
            ink.lineTo(sx + Math.cos(turn) * branchLength, sy + Math.sin(turn) * branchLength);
          }
        }
      }
      ink.strokeStyle = '#36577260';
      ink.lineWidth = 5;
      ink.stroke();
      ink.strokeStyle = '#f5faff';
      ink.lineWidth = 3.1;
      ink.stroke();
      ink.fillStyle = '#ffffff';
      ink.beginPath();
      ink.arc(0, 0, 3.5, 0, tau);
      ink.fill();
    }));

    function makeFlake(extra) {
      const roll = Math.random();
      const layer = roll < (extra ? .24 : .38) ? 0 : roll < (extra ? .68 : .76) ? 1 : 2;
      const depth = layers[layer];
      const radius = randomBetween(depth.radius);
      return {
        // The entire new flake starts outside the image, including its lower tip.
        x: Math.random() * width, y: -radius - 1 - Math.random() * 7,
        layer, radius, sprite: layer ? crystals[Math.floor(Math.random() * crystals.length)] : powder,
        opacity: randomBetween(depth.opacity), speed: randomBetween(depth.speed),
        drift: Math.random() * 11 - 5, wave: Math.random() * tau,
        flutter: .65 + Math.random() * .95, angle: Math.random() * tau, spin: (Math.random() - .5) * .75,
      };
    }

    function emit(group, count, limit, extra) {
      const available = Math.min(count, limit - group.length);
      for (let i = 0; i < available; i++) group.push(makeFlake(extra));
    }

    const depthAt = i => Math.min(bankLimit, profile[i] + accumulated[i]);
    const sampleAt = x => clamp(x / width * (sampleCount - 1), 0, sampleCount - 1);
    function surfaceAt(x) {
      const sample = sampleAt(x);
      const i = Math.floor(sample);
      return height - (depthAt(i) + (depthAt(Math.min(i + 1, sampleCount - 1)) - depthAt(i)) * (sample - i));
    }

    function settle(flake) {
      const center = Math.round(sampleAt(flake.x));
      const spread = flake.layer === 2 ? 3 : 2;
      for (let offset = -spread; offset <= spread; offset++) {
        const i = center + offset;
        if (i < 0 || i >= sampleCount) continue;
        const weight = 1 - Math.abs(offset) / (spread + 1);
        accumulated[i] = Math.min(56 - profile[i], accumulated[i] + (.36 + flake.radius * .16) * weight);
      }
    }

    function drawBank() {
      const step = width / (sampleCount - 1);
      ctx.beginPath();
      ctx.moveTo(0, height - depthAt(0));
      for (let i = 1; i < sampleCount - 1; i++) {
        const y = height - depthAt(i);
        ctx.quadraticCurveTo(i * step, y, (i + .5) * step, (y + height - depthAt(i + 1)) * .5);
      }
      ctx.lineTo(width, height - depthAt(sampleCount - 1));
      ctx.lineTo(width, height);
      ctx.lineTo(0, height);
      ctx.closePath();
      ctx.fillStyle = gradient;
      ctx.fill();
    }

    function drawFlakes(group, target = ctx, targetWidth = width, targetHeight = height) {
      for (const flake of group) {
        const r = flake.radius;
        if (flake.y + r < 0 || flake.y - r > targetHeight) continue;
        const flutter = elapsed * flake.flutter + flake.wave;
        target.save();
        target.globalAlpha = flake.opacity;
        target.translate(flake.x / width * targetWidth, flake.y);
        target.rotate(flake.angle + .16 * Math.sin(flutter));
        target.scale(.71 + .29 * Math.abs(Math.cos(flutter)), 1);
        if (flake.sprite) target.drawImage(flake.sprite, -r, -r, 2 * r, 2 * r);
        else {
          target.beginPath();
          target.arc(0, 0, r * .62, 0, tau);
          target.fillStyle = '#f5faff';
          target.fill();
        }
        target.restore();
      }
    }

    function showerStrength() {
      const fade = clamp((age - 2) / 2, 0, 1);
      return 1 - fade * fade * (3 - 2 * fade);
    }

    function draw() {
      if (!sized) return;
      ctx.clearRect(0, 0, width, height);
      const showDetail = detailContext && detailWidth && detailHeight && dialog.open;
      if (showDetail) detailContext.clearRect(0, 0, detailWidth, detailHeight);
      if (!state.snow) return;
      drawFlakes(flakes);
      drawFlakes(shower);
      if (showDetail) drawFlakes(shower, detailContext, detailWidth, detailHeight);
      drawBank();
    }

    function advance(group, dt) {
      for (let i = group.length - 1; i >= 0; i--) {
        const flake = group[i];
        const sway = elapsed * flake.flutter + flake.wave;
        flake.y += flake.speed * (1 + .12 * Math.sin(sway * 1.3)) * dt;
        flake.x += (flake.drift + (8 + flake.layer * 4) * Math.sin(sway)) * dt;
        flake.angle += flake.spin * dt;
        const onStage = flake.x >= -flake.radius && flake.x <= width + flake.radius;
        if (onStage && flake.y + flake.radius < surfaceAt(flake.x)) continue;
        if (onStage) settle(flake);
        group[i] = group.at(-1);
        group.pop();
      }
    }

    function frame(now) {
      raf = 0;
      if (!moving()) return;
      if (!last) last = now;
      if (now - last >= 12) {
        const scale = motionScale();
        const dt = Math.min((now - last) / 1000, .05) * scale;
        age += (now - last) / 1000;
        elapsed += dt;
        last = now;
        advance(flakes, dt);
        advance(shower, dt);
        baseCredit += baseRate * dt * scale;
        showerCredit += baseRate * 2.8 * showerStrength() * dt * scale;
        emit(flakes, Math.floor(baseCredit), baseLimit, false);
        emit(shower, Math.floor(showerCredit), showerLimit, true);
        baseCredit %= 1;
        showerCredit %= 1;
        draw();
      }
      raf = requestAnimationFrame(frame);
    }

    function start() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      last = 0;
      if (!state.snow) {
        age = Infinity;
        flakes.length = shower.length = 0;
        baseCredit = showerCredit = 0;
      }
      if (document.hidden) return;
      if (moving() && !flakes.length) {
        const count = Math.round(clamp(width / 70, 6, 18) * motionScale());
        emit(flakes, count, baseLimit, false);
      }
      draw();
      if (moving()) raf = requestAnimationFrame(frame);
    }

    function resize() {
      const nextWidth = scene.clientWidth, nextHeight = scene.clientHeight;
      sized = nextWidth > 0 && nextHeight > 0;
      if (!sized) { start(); return; }
      const ratio = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(3_000_000 / (nextWidth * nextHeight)));
      const pixelWidth = Math.max(1, Math.round(nextWidth * ratio));
      const pixelHeight = Math.max(1, Math.round(nextHeight * ratio));
      if (nextWidth === width && nextHeight === height && canvas.width === pixelWidth && canvas.height === pixelHeight && gradient) { start(); return; }
      if (width && height) {
        for (const group of [flakes, shower]) for (const flake of group) {
          flake.x *= nextWidth / width;
          flake.y *= nextHeight / height;
        }
      }
      width = nextWidth;
      height = nextHeight;
      bankLimit = Math.min(56, height * .115);
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
      ctx.setTransform(pixelWidth / width, 0, 0, pixelHeight / height, 0, 0);
      gradient = ctx.createLinearGradient(0, height - bankLimit, 0, height);
      gradient.addColorStop(0, '#fdfefe');
      gradient.addColorStop(.57, '#eaf4fa');
      gradient.addColorStop(1, '#d2e3ee');
      baseRate = clamp(13 + width / 100, 16, 29);
      baseLimit = clamp(Math.round(44 + width * height / 4700), 80, 190);
      showerLimit = clamp(Math.round(88 + width * height / 6200), 130, 210);
      start();
    }

    function resizeDetail() {
      detailWidth = detailCanvas.clientWidth;
      detailHeight = detailCanvas.clientHeight;
      if (!detailWidth || !detailHeight) return;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      detailCanvas.width = Math.round(detailWidth * ratio);
      detailCanvas.height = Math.round(detailHeight * ratio);
      detailContext.setTransform(detailCanvas.width / detailWidth, 0, 0, detailCanvas.height / detailHeight, 0, 0);
      draw();
    }

    new ResizeObserver(resize).observe(scene);
    if (detailContext) new ResizeObserver(resizeDetail).observe(detailCanvas);
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', start);
    resize();
    return {
      burst() {
        if (!moving()) return;
        age = 0;
        showerCredit = 0;
        const count = Math.round(clamp(width / 43, 8, 28) * motionScale());
        emit(shower, count, showerLimit, true);
      },
      setEnabled: start,
    };
  }
  function setSnow(enabled) {
    state.snow = enabled;
    $('snow-toggle').setAttribute('aria-pressed', String(enabled));
    state.weather?.setEnabled();
  }
  async function loadCalendar() {
    const previousStorageKey = openedStorageKey(state.calendar);
    const data = await api(pages ? './calendar.json' : `/api/calendar${requestedPreview ? '?preview=1' : ''}`);
    state.calendar = data;
    state.serverOffset = pages ? 0 : new Date(data.serverNow).getTime() - Date.now();
    const storageKey = openedStorageKey(data);
    if (previousStorageKey !== storageKey) {
      const storedOpened = readLocal(storageKey, []);
      state.opened = new Set(Array.isArray(storedOpened) ? storedOpened.filter(day => Number.isInteger(day) && day >= 1 && day <= 24) : []);
    }
    $('error-message').hidden = true;
    syncDoors();
    updateLighting();
  }
  async function refreshCalendar() {
    try { await loadCalendar(); }
    catch {
      const error = $('error-message');
      if (!state.calendar && error.hidden) {
        setText(calendarMessage, '');
        toast('');
        setText(error, 'Die Türchen konnten gerade nicht geladen werden.');
        error.hidden = false;
      }
      if (state.calendar?.novemberTest) syncDoors();
    } finally {
      setTimeout(refreshCalendar, 60_000);
    }
  }
  function init() {
    updateLighting();
    buildDoors();
    todayDoor.hidden = true;
    todayDoor.setAttribute('aria-haspopup', 'dialog');
    todayDoor.addEventListener('click', () => {
      if (!todayDoor.hidden) openDoor(Number(todayDoor.dataset.day), todayDoor);
    });

    $('snow-toggle').addEventListener('click', () => setSnow(!state.snow));
    $('dialog-title').tabIndex = -1;
    $('dialog-close').addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => {
      if (!activeDoor) return;
      const { trigger, tile, announcement } = activeDoor;
      activeDoor = null;
      tile.classList.remove('is-opening');
      const returnFocus = trigger.getClientRects().length ? trigger : tile;
      returnFocus.focus();
      if (announcement) toast(announcement);
    });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) updateLighting(); });
    dialog.addEventListener('click', event => { if (event.target === dialog) { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close(); } });
    state.weather = createSnow();
    const photo = $('scene-world').querySelector('img');
    if (photo) {
      if (photo.complete) photo.hidden = !photo.naturalWidth;
      else photo.addEventListener('error', () => { photo.hidden = true; }, { once: true });
    }
    refreshCalendar();
  }
  init();
})();
