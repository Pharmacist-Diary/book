document.addEventListener('DOMContentLoaded', () => {
  const isRTL = true;

  const shell = document.getElementById('bookShell');
  const viewport = document.getElementById('viewport');
  const panWrap = document.getElementById('panwrap');
  const scaleWrap = document.getElementById('scalewrap');
  const bookEl = document.getElementById('flipbook');

  const btnForward = document.getElementById('nextBtn');
  const btnBack = document.getElementById('prevBtn');
  const indicator = document.getElementById('indicator');
  const audio = document.getElementById('flipSnd');

  const fsBtn = document.getElementById('fsBtn');
  const zoomInBtn = document.getElementById('zoomInBtn');
  const zoomOutBtn = document.getElementById('zoomOutBtn');
  const zoomResetBtn = document.getElementById('zoomResetBtn');
  const themeBtn = document.getElementById('themeBtn');
  const helpBtn = document.getElementById('helpBtn');
  const soundBtn = document.getElementById('soundBtn');
  const bottomUI = document.getElementById('bottomUI');

  let isSoundEnabled = localStorage.getItem('soundEnabled') !== 'false';

  const A4_W = 595;
  const A4_H = 842;
  const RATIO = A4_H / A4_W;

  let baseWidthPx = 0, baseHeightPx = 0;
  let targetWidth = 0, targetHeight = 0;

  const MIN_SCALE = 1;
  const MAX_SCALE = 3;
  const SCALE_STEP = 0.2;
  let scale = 1;
  let panX = 0, panY = 0;

  // ——— التحكم في مصدر الصوت للانقلاب: سهم الواجهة أو سحب من الزوايا/الأعلى ———
  let pendingFlipSoundSource = null; // 'arrow' | 'drag' | 'topdrag' | null
  let pendingTimer = null;
  const TOP_DRAG_SOUND_ZONE = 72; // px من أعلى الصفحة لاعتبار السحب "من أعلى"
  function armFlipSound(source, ttl = 2000) {
    pendingFlipSoundSource = source;
    if (pendingTimer) clearTimeout(pendingTimer);
    pendingTimer = setTimeout(() => { pendingFlipSoundSource = null; }, ttl);
  }

  // ترقيم الصفحات
  const sourcePages = bookEl.querySelectorAll('.page');
  let pageNum = 0;
  sourcePages.forEach((p) => {
    if (!p.classList.contains('cover')) {
      pageNum += 1;
      const footer = document.createElement('div');
      footer.className = 'page-footer';
      footer.textContent = 'صفحة رقم ' + pageNum;
      p.appendChild(footer);
    }
  });

  // تهيئة المكتبة
  const pageFlip = new St.PageFlip(bookEl, {
    width: A4_W,
    height: A4_H,
    size: 'stretch',
    minWidth: 120,
    maxWidth: 3000,
    minHeight: Math.round(120 * RATIO),
    maxHeight: Math.round(3000 * RATIO),
    maxShadowOpacity: 0.6,
    showCover: false,
    mobileScrollSupport: true,
    flippingTime: 800,
    useMouseWheel: false,
    swipeDistance: 30,
    direction: 'rtl',
    usePortrait: true
  });
  pageFlip.loadFromHTML(sourcePages);

  // ابدأ من آخر الكتاب
  pageFlip.on('init', () => {
    const lastPageIndex = pageFlip.getPageCount() - 1;
    pageFlip.turnToPage(lastPageIndex);
  });

  const getTotal = () => pageFlip.getPageCount();
  const getIndex = () => pageFlip.getCurrentPageIndex();
  const readingNumber = () => {
    const total = getTotal();
    const idx = getIndex();
    return isRTL ? (total - idx) : (idx + 1);
  };
  const canGoForward = () => {
    const idx = getIndex(), total = getTotal();
    return isRTL ? idx > 0 : idx < total - 1;
  };
  const canGoBackward = () => {
    const idx = getIndex(), total = getTotal();
    return isRTL ? idx < total - 1 : idx > 0;
  };

  // إظهار المؤشر فقط عند التغيير ولمدة ثانيتين
  let prevIndicatorState = { percent: null, page: null, total: null };
  let indicatorTimer = null;
  function showIndicatorFor(ms = 1500) {
    indicator.classList.add('show');
    clearTimeout(indicatorTimer);
    indicatorTimer = setTimeout(() => indicator.classList.remove('show'), ms);
  }

  function updateIndicator(force = false) {
    const percent = Math.round(scale * 100);
    const total = getTotal();
    const page = readingNumber();

    indicator.textContent = `${percent}% • ${page} / ${total}`;

    const changed = force ||
      percent !== prevIndicatorState.percent ||
      page !== prevIndicatorState.page ||
      total !== prevIndicatorState.total;

    if (changed) {
      showIndicatorFor(2000);
      prevIndicatorState = { percent, page, total };
    }

    btnForward.disabled = !canGoForward();
    btnBack.disabled = !canGoBackward();
  }

  function playFlipSound() {
    if (!audio || !isSoundEnabled) return;
    try {
      audio.currentTime = 0;
      audio.play().catch(() => { });
    } catch (e) {
      console.error('خطأ في تشغيل الصوت:', e);
    }
  }

  function isSinglePageLayout() {
    return window.innerWidth < 900 || window.innerHeight > window.innerWidth;
  }

  function isActuallyFullscreen() {
    return document.fullscreenElement === shell ||
      document.webkitFullscreenElement === shell ||
      shell.classList.contains('pseudo-fullscreen');
  }

  function computeBaseWidth() {
    const viewportWidth = Math.min(window.innerWidth, document.documentElement.clientWidth);
    const viewportHeight = Math.min(window.innerHeight, document.documentElement.clientHeight);

    const factor = isSinglePageLayout() ? 1 : 2;
    const inFs = isActuallyFullscreen();

    const maxWidth = viewportWidth * (inFs ? 0.98 : 0.92);
    const header = document.querySelector('.app-header');
    const headerH = inFs ? 0 : (header ? header.offsetHeight : 0);

    // حجز مساحة للشريط السفلي خارج ملء الشاشة
    const uiH = (!inFs && bottomUI) ? (bottomUI.offsetHeight + 12) : 0;
    const reserved = inFs ? 20 : uiH;

    const maxHeight = Math.max(200, (viewportHeight - headerH - reserved));
    const pageWidthByW = maxWidth / factor;
    const pageWidthByH = maxHeight / RATIO;
    const MIN_PAGE_W = 140;

    baseWidthPx = Math.max(MIN_PAGE_W, Math.min(pageWidthByW, pageWidthByH, 900));
    baseHeightPx = Math.round(baseWidthPx * RATIO);
  }

  // منع التحديث الزائد
  let rafUpdating = false;
  function schedulePFUpdate() {
    if (rafUpdating) return;
    rafUpdating = true;
    requestAnimationFrame(() => {
      rafUpdating = false;
      if (typeof pageFlip?.update === 'function') pageFlip.update();
    });
  }

  // زوم حقيقي: تغيير مقاس الكتاب نفسه (بدون transform scale)
  function applyContentSize() {
    const contentW = Math.round(targetWidth * scale);
    const contentH = Math.round(targetHeight * scale);

    bookEl.style.width = contentW + 'px';
    bookEl.style.height = contentH + 'px';

    scaleWrap.style.width = contentW + 'px';
    scaleWrap.style.height = contentH + 'px';

    schedulePFUpdate();
  }

  function updateBookSize() {
    const factor = isSinglePageLayout() ? 1 : 2;
    targetWidth = Math.round(baseWidthPx * factor);
    targetHeight = baseHeightPx;

    viewport.style.width = targetWidth + 'px';
    viewport.style.height = targetHeight + 'px';
    panWrap.style.width = targetWidth + 'px';
    panWrap.style.height = targetHeight + 'px';

    if (isActuallyFullscreen()) {
      shell.style.width = '100vw';
      shell.style.height = '100vh';
      shell.classList.add('in-fs');
    } else {
      shell.style.width = targetWidth + 'px';
      shell.style.height = 'auto'; // ليظهر الشريط السفلي أسفل الحاوية
      shell.classList.remove('in-fs');
    }

    applyContentSize();
    clampPanAndApply();
    updateIndicator();
  }

  function refreshLayoutCentered() {
    computeBaseWidth();
    updateBookSize();
  }

  function clamp(v, min, max) { return Math.max(min, Math.min(v, max)); }

  function clampPanAndApply() {
    const vpW = viewport.clientWidth;
    const vpH = viewport.clientHeight;

    const sW = scaleWrap.offsetWidth;
    const sH = scaleWrap.offsetHeight;

    if (sW <= vpW) panX = Math.round((vpW - sW) / 2);
    else panX = Math.round(clamp(panX, vpW - sW, 0));

    if (sH <= vpH) panY = Math.round((vpH - sH) / 2);
    else panY = Math.round(clamp(panY, vpH - sH, 0));

    panWrap.style.transform = 'translate3d(0,0,0)';
    scaleWrap.style.transform = `translate3d(${panX}px, ${panY}px, 0)`;

    viewport.classList.toggle('zoomed', scale > 1 + 1e-6);
    updateZoomButtonsState();
    updateIndicator();
  }

  function setScale(newScale, cx, cy) {
    const rect = viewport.getBoundingClientRect();
    const centerX = (typeof cx === 'number') ? cx : rect.width / 2;
    const centerY = (typeof cy === 'number') ? cy : rect.height / 2;

    const prev = scale;
    newScale = clamp(newScale, MIN_SCALE, MAX_SCALE);
    if (Math.abs(newScale - prev) < 1e-6) { updateZoomButtonsState(); return; }

    const contentX = (centerX - panX) / prev;
    const contentY = (centerY - panY) / prev;

    scale = newScale;
    applyContentSize();

    panX = centerX - contentX * scale;
    panY = centerY - contentY * scale;

    clampPanAndApply();
  }

  function zoomIn(cx, cy) { setScale(scale + SCALE_STEP, cx, cy); }
  function zoomOut(cx, cy) { setScale(scale - SCALE_STEP, cx, cy); }

  function hardResetZoom(skipClamp) {
    scale = 1;
    panX = 0;
    panY = 0;
    applyContentSize();
    scaleWrap.style.transform = 'translate3d(0,0,0)';
    viewport.classList.remove('zoomed');
    updateZoomButtonsState();
    updateIndicator();
    if (!skipClamp) requestAnimationFrame(() => clampPanAndApply());
  }

  function restoreInitialView() {
    hardResetZoom(true);
    requestAnimationFrame(() => {
      refreshLayoutCentered();
      requestAnimationFrame(() => clampPanAndApply());
    });
  }

  function updateZoomButtonsState() {
    zoomOutBtn.disabled = scale <= MIN_SCALE + 1e-6;
    zoomInBtn.disabled = scale >= MAX_SCALE - 1e-6;
    zoomResetBtn.disabled = false;
  }

  // بدء
  refreshLayoutCentered();
  updateIndicator(true); // يظهر عند الفتح ثم يختفي

  // ——— تمكين الصوت عند سحب الطي من أعلى (اختياري، يبقى كما هو) ———
  bookEl.addEventListener('pointerdown', (e) => {
    const rect = bookEl.getBoundingClientRect();
    const y = e.clientY - rect.top;
    if (y <= TOP_DRAG_SOUND_ZONE) {
      armFlipSound('topdrag', 2500);
    }
  }, true);

  bookEl.addEventListener('pointerdown', (e) => {
    // تفعيل صوت التقليب عند السحب من أي مكان في الصفحة
    armFlipSound('drag', 2500);
  }, true);

  pageFlip.on('flip', () => {
    if (
      pendingFlipSoundSource === 'arrow' ||
      pendingFlipSoundSource === 'topdrag' ||
      pendingFlipSoundSource === 'drag'
    ) {
      playFlipSound();
    }
    pendingFlipSoundSource = null;
    if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }

    requestAnimationFrame(() => updateIndicator());
  });

  const goForward = () => isRTL ? pageFlip.flipPrev() : pageFlip.flipNext();
  const goBackward = () => isRTL ? pageFlip.flipNext() : pageFlip.flipPrev();

  // أزرار الأسهم (واجهة) — نُفعّل الصوت هنا فقط
  btnForward.addEventListener('click', () => { armFlipSound('arrow'); goForward(); });
  btnBack.addEventListener('click', () => { armFlipSound('arrow'); goBackward(); });

  // لوحة المفاتيح
  window.addEventListener('keydown', (e) => {
    const lower = e.key.toLowerCase();

    if (lower === 'f') {
      if (isActuallyFullscreen()) exitFullscreen(); else enterFullscreen();
      return;
    }
    if (lower === 'escape' || e.key === '0') {
      restoreInitialView();
      return;
    }
    if (e.key === '+' || e.key === '=') { zoomIn(); return; }
    if (e.key === '-' || e.key === '–') { zoomOut(); return; }

    // تحريك عند الزوم أو تقليب مع الصوت عند الأسهم
    if (e.key === 'ArrowLeft') {
      if (scale > 1) { panX -= 80; clampPanAndApply(); e.preventDefault(); }
      else { armFlipSound('arrow'); goForward(); }
    } else if (e.key === 'ArrowRight') {
      if (scale > 1) { panX += 80; clampPanAndApply(); e.preventDefault(); }
      else { armFlipSound('arrow'); goBackward(); }
    } else if (e.key === 'ArrowUp') {
      if (scale > 1) { panY += 80; clampPanAndApply(); e.preventDefault(); }
    } else if (e.key === 'ArrowDown') {
      if (scale > 1) { panY -= 80; clampPanAndApply(); e.preventDefault(); }
    }
  });

  // Ripple للأزرار
  [zoomInBtn, zoomOutBtn, zoomResetBtn, fsBtn, helpBtn, themeBtn, soundBtn].filter(Boolean).forEach(btn => {
    btn.addEventListener('click', (e) => {
      if (!e.isTrusted) return;
      const rect = btn.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height);
      const span = document.createElement('span');
      span.className = 'ripple';
      span.style.width = span.style.height = size + 'px';
      span.style.left = (e.clientX - rect.left - size / 2) + 'px';
      span.style.top = (e.clientY - rect.top - size / 2) + 'px';
      btn.appendChild(span);
      setTimeout(() => span.remove(), 600);
    });
  });

  zoomInBtn.addEventListener('click', () => zoomIn());
  zoomOutBtn.addEventListener('click', () => zoomOut());
  zoomResetBtn.addEventListener('click', restoreInitialView);

  // عجلة الماوس
  viewport.addEventListener('wheel', (e) => {
    if (e.ctrlKey || e.metaKey) {
      const rect = viewport.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const step = (e.deltaY < 0) ? SCALE_STEP : -SCALE_STEP;
      setScale(scale + step, cx, cy);
      e.preventDefault();
      e.stopPropagation();
    } else if (scale > 1) {
      panX -= e.deltaX;
      panY -= e.deltaY;
      clampPanAndApply();
      e.preventDefault();
      e.stopPropagation();
    }
  }, { passive: false });

  // دبل كليك
  viewport.addEventListener('dblclick', (e) => {
    const rect = viewport.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    if (scale < 1.1) setScale(Math.min(2, MAX_SCALE), cx, cy);
    else restoreInitialView();
  });

  // سحب + Pinch (التكبير/التصغير بإصبعين على الهاتف)
  const pointers = new Map();
  let isDragging = false;
  let isPinching = false;
  let dragStartX = 0, dragStartY = 0, startPanX = 0, startPanY = 0;
  let pinchStartDist = 0, pinchStartScale = 1;
  let pinchCenter = { x: 0, y: 0 };

  function dist(a, b) {
    const dx = b.clientX - a.clientX, dy = b.clientY - a.clientY;
    return Math.hypot(dx, dy);
  }
  function mid(a, b) { return { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 }; }

  viewport.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.controls') || e.target.closest('.nav-arrow')) return;
    pointers.set(e.pointerId, e);

    if (pointers.size === 2) {
      const [p1, p2] = Array.from(pointers.values());
      isPinching = true;
      pinchStartDist = dist(p1, p2);
      pinchStartScale = scale;
      const m = mid(p1, p2);
      const rect = viewport.getBoundingClientRect();
      pinchCenter = { x: m.x - rect.left, y: m.y - rect.top };
      viewport.style.touchAction = 'none';
      e.preventDefault(); e.stopPropagation();
    } else if (scale > 1) {
      isDragging = true;
      dragStartX = e.clientX; dragStartY = e.clientY;
      startPanX = panX; startPanY = panY;
      panWrap.classList.add('grabbing');
      try { viewport.setPointerCapture(e.pointerId); } catch { }
      e.preventDefault(); e.stopPropagation();
    }
  });

  viewport.addEventListener('pointermove', (e) => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, e);

    if (isPinching && pointers.size >= 2) {
      const [p1, p2] = Array.from(pointers.values());
      const d = dist(p1, p2);
      const ratio = d / (pinchStartDist || 1e-6);
      const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, pinchStartScale * ratio));
      setScale(newScale, pinchCenter.x, pinchCenter.y);
      e.preventDefault(); e.stopPropagation();
      return;
    }

    if (isDragging) {
      const dx = e.clientX - dragStartX;
      const dy = e.clientY - dragStartY;
      panX = startPanX + dx;
      panY = startPanY + dy;
      clampPanAndApply();
      e.preventDefault(); e.stopPropagation();
    }
  });

  ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => {
    viewport.addEventListener(ev, (e) => {
      if (pointers.has(e.pointerId)) pointers.delete(e.pointerId);
      if (isPinching && pointers.size < 2) {
        isPinching = false;
        viewport.style.touchAction = '';
      }
      if (isDragging) {
        isDragging = false;
        panWrap.classList.remove('grabbing');
      }
      try { viewport.releasePointerCapture(e.pointerId); } catch { }
    });
  });

  // تحديث القياسات عند تغيير حجم النافذة
  window.addEventListener('resize', () => {
    refreshLayoutCentered();
  });

  // ——— فك قفل الصوت لأول لمسة "بصمت" لتفادي أي صوت غير مرغوب ———
  const unlockAudio = () => {
    if (!audio) return;
    const prevMuted = audio.muted;
    audio.muted = true; // تشغيل صامت
    const p = audio.play();

    const done = () => {
      try { audio.pause(); } catch { }
      audio.currentTime = 0;
      audio.muted = prevMuted; // إعادة الحالة الأصلية
    };

    if (p && typeof p.then === 'function') {
      p.then(done).catch(done);
    } else {
      done();
    }
    window.removeEventListener('pointerdown', unlockAudio);
  };
  window.addEventListener('pointerdown', unlockAudio);

  // ملء الشاشة + fallback
  async function enterFullscreen() {
    try {
      if (shell.requestFullscreen) {
        await shell.requestFullscreen();
      } else if (shell.webkitRequestFullscreen) {
        await shell.webkitRequestFullscreen();
      } else {
        shell.classList.add('pseudo-fullscreen');
        onFsChange(); // دخول fallback
      }
    } catch {
      shell.classList.add('pseudo-fullscreen');
      onFsChange();
    }
  }
  async function exitFullscreen() {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else if (document.webkitFullscreenElement) {
        await document.webkitExitFullscreen();
      } else {
        shell.classList.remove('pseudo-fullscreen');
        onFsChange(); // خروج fallback
      }
    } catch {
      shell.classList.remove('pseudo-fullscreen');
      onFsChange();
    }
  }

  function onFsChange() {
    if (!document.fullscreenElement && !document.webkitFullscreenElement) {
      shell.classList.remove('pseudo-fullscreen');
    }

    const inFsNow = isActuallyFullscreen();
    shell.classList.toggle('in-fs', inFsNow);

    if (!inFsNow) {
      // خرجنا من ملء الشاشة: نفّذ إعادة الزوم تلقائيًا
      zoomResetBtn.click();
    } else {
      // دخلنا ملء الشاشة: أعد التمركز
      requestAnimationFrame(() => refreshLayoutCentered());
    }

    setTimeout(() => refreshLayoutCentered(), 100);
  }

  document.addEventListener('fullscreenchange', onFsChange);
  document.addEventListener('webkitfullscreenchange', onFsChange);

  fsBtn.addEventListener('click', () => {
    if (isActuallyFullscreen()) exitFullscreen(); else enterFullscreen();
  });

  requestAnimationFrame(() => {
    document.querySelector('.controls')?.classList.add('show');
  });

  // ——— تمكين تقليب الصفحات في كل مكان ———
  // تم إزالة القيود التي كانت تمنع السحب إلا من الزوايا للسماح بالتقليب السهل على الهاتف
  function blockFlipIfNotCorner(e) {
    // نسمح بالسحب في كل الحالات إلا لو كنا في وضع الزوم
    if (scale > 1.01) {
      e.stopPropagation();
      e.preventDefault();
    }
  }
  bookEl.addEventListener('pointerdown', blockFlipIfNotCorner, true);
  bookEl.addEventListener('click', blockFlipIfNotCorner, true);

  // HELP toggle
  const helpPanel = document.getElementById('helpPanel');
  const helpCloseBtn = helpPanel?.querySelector('.help-close');

  function openHelp() {
    if (!helpPanel) return;
    helpPanel.hidden = false;
    helpBtn?.setAttribute('aria-expanded', 'true');
  }
  function closeHelp() {
    if (!helpPanel) return;
    helpPanel.hidden = true;
    helpBtn?.setAttribute('aria-expanded', 'false');
  }
  helpBtn?.addEventListener('click', () => helpPanel.hidden ? openHelp() : closeHelp());
  helpCloseBtn?.addEventListener('click', closeHelp);
  helpPanel?.addEventListener('click', (e) => { if (e.target === helpPanel) closeHelp(); });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !helpPanel.hidden) closeHelp(); });

  // ——— Theme Toggle Logic ———
  function setTheme(isDark) {
    if (isDark) {
      document.documentElement.setAttribute('data-theme', 'dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.removeAttribute('data-theme');
      localStorage.setItem('theme', 'light');
    }
    updateThemeIcon(isDark);
  }

  function updateThemeIcon(isDark) {
    if (!themeBtn) return;
    const moon = themeBtn.querySelector('.moon');
    const sunParts = themeBtn.querySelectorAll('.sun');

    if (isDark) {
      if (moon) moon.style.display = 'none';
      sunParts.forEach(el => el.style.display = 'block');
    } else {
      if (moon) moon.style.display = 'block';
      sunParts.forEach(el => el.style.display = 'none');
    }
  }

  themeBtn?.addEventListener('click', () => {
    const isDark = !document.documentElement.hasAttribute('data-theme');
    setTheme(isDark);
  });

  // ——— Preloader & Image Loading Logic ———
  const loader = document.getElementById('appLoader');
  // Use sourcePages images to ensure we track all images before the library might move them
  const imagesToLoad = Array.from(bookEl.querySelectorAll('img'));
  let loadedCount = 0;

  function hideLoader() {
    if (loader && !loader.classList.contains('hidden')) {
      loader.classList.add('hidden');
      // Show the book with a smooth fade-in
      bookEl.classList.add('ready');
    }
  }

  function checkAllLoaded() {
    loadedCount++;
    if (loadedCount >= imagesToLoad.length) {
      hideLoader();
    }
  }

  if (imagesToLoad.length === 0) {
    setTimeout(hideLoader, 1500);
  } else {
    imagesToLoad.forEach(img => {
      if (img.complete) {
        checkAllLoaded();
      } else {
        img.addEventListener('load', checkAllLoaded);
        img.addEventListener('error', checkAllLoaded);
      }
    });

    // Safety timeout: hide anyway after 8 seconds
    setTimeout(hideLoader, 8000);
  }

  // ——— Sound Toggle Logic ———
  function updateSoundUI() {
    if (!soundBtn) return;
    const onIcon = soundBtn.querySelector('.sound-on');
    const offIcon = soundBtn.querySelector('.sound-off');
    if (onIcon) onIcon.style.display = isSoundEnabled ? 'block' : 'none';
    if (offIcon) offIcon.style.display = isSoundEnabled ? 'none' : 'block';
  }
  updateSoundUI();
  soundBtn?.addEventListener('click', () => {
    isSoundEnabled = !isSoundEnabled;
    localStorage.setItem('soundEnabled', isSoundEnabled);
    updateSoundUI();
  });

  // Init Theme
  const savedTheme = localStorage.getItem('theme');
  if (savedTheme === 'dark') {
    setTheme(true);
  } else {
    // Default light (even if system is dark)
    setTheme(false);
  }
});