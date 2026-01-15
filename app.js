/* ===== IndexedDB для хранения PDF ===== */
const DB_NAME = 'EmilPDF_DB';
const DB_VERSION = 3; // Чистим всё и переходим на стабильную версию
let db = null;

/* ===== ЗАЩИТА ОТ ВЫЛЕТОВ ===== */
window.addEventListener('error', (e) => {
  console.error('💥 Критическая ошибка:', e.error);
});

window.addEventListener('unhandledrejection', (e) => {
  console.error('💥 Необработанный Promise:', e.reason);
});

window.onbeforeunload = null; // Ensure no confirmation dialogs

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => { db = req.result; resolve(db); };
    req.onupgradeneeded = (e) => {
      const d = e.target.result;
      // Удаляем старое хранилище если есть
      if (d.objectStoreNames.contains('projects')) {
        d.deleteObjectStore('projects');
      }
      d.createObjectStore('projects', { keyPath: 'id' });
    };
  });
}

function saveProject(project) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('projects', 'readwrite');
    tx.objectStore('projects').put(project);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function getProject(id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('projects', 'readonly');
    const req = tx.objectStore('projects').get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function getAllProjects() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('projects', 'readonly');
    const req = tx.objectStore('projects').getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

function deleteProject(id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('projects', 'readwrite');
    tx.objectStore('projects').delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/* ===== PDF.js loader ===== */
const PDFJS_CDNS = [
  { lib: "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.10.377/pdf.min.js", worker: "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.10.377/pdf.worker.min.js" },
];
let pdfjsReady = false;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.async = true;
    s.onload = () => resolve(true);
    s.onerror = () => reject(new Error('Failed: ' + src));
    document.head.appendChild(s);
  });
}

async function ensurePdfjs() {
  if (window.pdfjsLib && pdfjsLib.getDocument) {
    try { pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_CDNS[0].worker; } catch (e) { }
    return true;
  }
  try {
    await loadScript(PDFJS_CDNS[0].lib);
    if (window.pdfjsLib) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_CDNS[0].worker;
      return true;
    }
  } catch (e) { }
  return false;
}

async function readFileAsArrayBuffer(file) {
  if (file.arrayBuffer) return await file.arrayBuffer();
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.readAsArrayBuffer(file);
  });
}

async function loadPdfFromBuffer(buffer) {
  return await pdfjsLib.getDocument({ data: buffer, disableWorker: true }).promise;
}

/* ===== DOM ===== */
const $ = id => document.getElementById(id);
const projectsScreen = $('projectsScreen');
const appScreen = $('appScreen');
const projectsGrid = $('projectsGrid');
const addProjectCard = $('addProjectCard');
const newProjectFile = $('newProjectFile');
const backToProjects = $('backToProjects');
const currentProjectName = $('currentProjectName');
const topbar = $('topbar');
const pdfCanvas = $('pdfCanvas');
const rulerCanvas = $('rulerCanvas');
const pdfCtx = pdfCanvas.getContext('2d', { alpha: false });
const rulerCtx = rulerCanvas.getContext('2d');
// calibrateBtn removed (replaced by calibrationBrandBtn)
const calibHint = $('calibHint');
const prevBtn = $('prevBtn');
const nextBtn = $('nextBtn');
const pageInfo = $('pageInfo');
const zoomIn = document.getElementById('zoomIn');
const zoomOut = document.getElementById('zoomOut');
const zoomLevel = document.getElementById('zoomLevel');
const selectBtn = document.getElementById('selectBtn');
const selectionPanel = document.getElementById('selectionPanel');
const selectionImg = document.getElementById('selectionImg');
const selectionClose = document.getElementById('selectionClose');

const saveSelectPdfBtn = document.getElementById('saveSelectPdfBtn');

const counter = $('counter');
const calibratePageBtn = $('calibratePageBtn');
const rulerBtn = $('rulerToolBtn'); // Move explicit declaration up
const thumbsPanel = $('thumbsPanel');
const thumbnails = $('thumbnails');
const thumbsCount = $('thumbsCount');
const floatingBtn = $('floatingBtn');
const loading = $('loading');
const loadingText = $('loadingText');
const loadingSub = $('loadingSub');
const calibModal = $('calibModal');
const calibLength = $('calibLength');
const projectNameModal = $('projectNameModal');
const projectNameInput = $('projectNameInput');
const deleteModal = $('deleteModal');
const deleteModalText = $('deleteModalText');
const main = $('main');
const undoBtn = $('undoBtn');
const redoBtn = $('redoBtn');
const canvasWrapper = $('canvasWrapper');
const extractModal = $('extractModal');
const extractGrid = $('extractGrid');
const extractSelectedInfo = $('extractSelectedInfo');
const extractSaveBtn = $('extractSaveBtn');

/* Text Tool DOM */
const textToolBtn = $('textToolBtn');
const textModal = $('textModal');
const textInputContent = $('textInputContent');
const textBgOpts = $('textBgOpts');
const textColorOpts = $('textColorOpts');
const textPlaceActionBtn = $('textPlaceActionBtn');

/* ===== STATE ===== */
let projects = [];
let currentProject = null;
let pdfDoc = null;
let currentPage = 1;
let baseScale = 1.0;
let zoom = 1.0;
let canvasScale = 1;
const RENDER_DPR = Math.min(1.25, window.devicePixelRatio || 1);
const IS_COARSE = window.matchMedia?.('(pointer:coarse)').matches;

let isCalibrating = false;
let calibPoints = [];
let calibRubber = null;
let penActive = false;
let isShiftPressed = false;

let isFloatingBtnPressed = false;
let isRulerActive = false; // Режим рулетки (рисования)
let currentLine = null;
let draggedPoint = null;
let lineRubber = null;

// New Logic State
let selectedLine = null; // Выделенная линия
let draggedLine = null; // Линия которую тащим
let dragPrevPos = null; // Позиция для drag
let currentMousePos = null; // Текущая позиция мыши (для Shift старта)
let draggedText = null; // Текст который тащим
let textDragStartPos = null;
let selectedText = null; // Выделенный текст
let isResizingText = false;
let resizeState = null; // { startDist, startFontSize }
let isRotatingText = false;
let rotationState = null; // { startAngle, initialRotation }

let touchCaptured = false;
let renderTask = null;
let renderGen = 0;

const SNAP = IS_COARSE ? 32 : 24; // Balanced for accuracy vs spacing
const POINT_SIZE = IS_COARSE ? 14 : 11; // Slightly larger visuals
const HANDLE_SIZE = IS_COARSE ? 14 : 11;
const RESIZE_HANDLE_SIZE = IS_COARSE ? 14 : 10;
const LINE_WIDTH = IS_COARSE ? 6 : 5;
const MAGNET_SNAP = IS_COARSE ? 20 : 12; // Reduced magnet radius for easier detach

// Helper: Snap to closest existing point
/* getSnapPos moved to geometry section to avoid duplication */

let history = {};
let future = {};
let pendingFile = null;
let deleteTargetId = null;
let isClearingPage = false;

/* Text Tool State */
let isPlacingText = false;
let pendingTextConfig = null; // { text, bg, color }
// Helper for texts
function getPageTexts() {
  if (!currentProject) return [];
  if (!currentProject.pageTexts) currentProject.pageTexts = {};
  if (!currentProject.pageTexts[currentPage]) currentProject.pageTexts[currentPage] = [];
  return currentProject.pageTexts[currentPage];
}

/* ===== INIT ===== */
window.addEventListener('DOMContentLoaded', async () => {
  await openDB();
  projects = await getAllProjects();
  renderProjectsList();
  setupEvents();
});

function setupEvents() {
  // CRITICAL: Setup canvas and keyboard FIRST before anything else
  setupCanvas();
  setupKeyboard();

  setupTextToolEvents(); // Init Text Tool
  newProjectFile.addEventListener('change', onNewProjectFile);
  backToProjects.addEventListener('click', goToProjectsScreen);

  $('calibOk').addEventListener('click', saveCalibration);
  $('calibCancel').addEventListener('click', cancelCalibration);
  $('projectNameOk').addEventListener('click', confirmNewProject);
  $('projectNameCancel').addEventListener('click', () => closeModal(projectNameModal));
  $('deleteOk').addEventListener('click', confirmDelete);
  $('deleteCancel').addEventListener('click', () => closeModal(deleteModal));

  // Кликабельная подсказка
  const hintBar = $('hintBar');
  if (hintBar) {
    hintBar.style.cursor = 'pointer';
    hintBar.addEventListener('click', () => {
      hintBar.style.transition = 'all 0.3s ease-out';
      hintBar.innerHTML = '✨ Спасибо, что пользуетесь Эмиль PDF!';
      hintBar.style.background = 'rgba(74, 222, 128, 0.2)';
      hintBar.style.borderColor = 'rgba(74, 222, 128, 0.4)';
      hintBar.style.color = '#4ade80';

      setTimeout(() => {
        hintBar.style.opacity = '0';
        hintBar.style.transform = 'translateY(-10px)';
        setTimeout(() => {
          hintBar.style.display = 'none';
        }, 300);
      }, 2000);
    });
  }

  // calibrateBtn listener removed - handled by calibrationBrandBtn below
  // Modified handler: Calibration OR Measurements List
  counter.addEventListener('click', () => {
    if (!getUnitsPerMM()) {
      startCalibration();
    } else {
      openMeasurementsList();
    }
  });

  // Новая кнопка калибровки
  if (calibratePageBtn) {
    calibratePageBtn.addEventListener('click', startCalibration);
  }

  // Кнопка логотипа - контактная информация
  const logoBtn = $('logoBtn');
  if (logoBtn) {
    logoBtn.addEventListener('click', showContactPopup);
  }

  // Кнопка Рулетка -> Инструмент рисования
  if (rulerBtn) {
    rulerBtn.addEventListener('click', toggleRulerMode);
  }
  prevBtn.addEventListener('click', () => changePage(-1));
  nextBtn.addEventListener('click', () => changePage(1));
  pageInfo.addEventListener('click', toggleThumbs);
  pageInfo.addEventListener('mouseenter', () => thumbsPanel.classList.add('peek'));
  pageInfo.addEventListener('mouseleave', () => thumbsPanel.classList.remove('peek'));

  $('thumbsClose').addEventListener('click', closeThumbs);
  $('thumbsLeft').addEventListener('click', () => thumbnails.scrollBy({ left: -300, behavior: 'smooth' }));
  $('thumbsRight').addEventListener('click', () => thumbnails.scrollBy({ left: 300, behavior: 'smooth' }));

  // Закрытие миниатюр при клике вне панели
  document.addEventListener('click', (e) => {
    if (thumbsPanel.classList.contains('active') &&
      !thumbsPanel.contains(e.target) &&
      !pageInfo.contains(e.target)) {
      closeThumbs();
    }
  });

  zoomIn.addEventListener('click', () => changeZoom(0.15));
  zoomOut.addEventListener('click', () => changeZoom(-0.15));

  // Сброс зума при клике на проценты
  if (zoomLevel) {
    zoomLevel.style.cursor = 'pointer';
    zoomLevel.title = 'Вернуть 100%';
    zoomLevel.addEventListener('click', () => setZoom(1.0));
  }
  undoBtn.addEventListener('click', undo);
  redoBtn.addEventListener('click', redo);

  // Печать мозаикой
  $('printTiledBtn').addEventListener('click', openPrintTiled);
  $('topbarPrintTiledBtn').addEventListener('click', openPrintTiled);
  $('tiledGenerateBtn').addEventListener('click', handleTiledGenerate);
  $('tiledPrintDirectBtn').addEventListener('click', handleTiledPrint);

  document.querySelectorAll('#printTiledModal .chip').forEach(c => {
    c.addEventListener('click', () => {
      document.querySelectorAll('#printTiledModal .chip').forEach(x => x.classList.remove('active'));
      c.classList.add('active');
      updateTiledPreview();
    });
  });
  $('tiledHintsToggle').addEventListener('change', updateTiledPreview);
  $('tiledRotateBtn').addEventListener('click', () => { tiledData.rotation = (tiledData.rotation + 90) % 360; updateTiledPreview(); });
  $('tiledResetBtn').addEventListener('click', () => {
    tiledData.panX = 0; tiledData.panY = 0; tiledData.rotation = 0; tiledData.zoom = 1;
    $('tiledZoomSlider').value = 1;
    updateTiledPreview();
  });
  $('tiledZoomSlider').addEventListener('input', (e) => {
    tiledData.zoom = parseFloat(e.target.value);
    updateTiledPreview();
  });

  // Кнопки зума - и +
  $('tiledZoomOutBtn').addEventListener('click', () => {
    let z = parseFloat($('tiledZoomSlider').value);
    z = Math.max(0.1, z - 0.1);
    tiledData.zoom = z;
    $('tiledZoomSlider').value = z;
    updateTiledPreview();
  });
  $('tiledZoomInBtn').addEventListener('click', () => {
    let z = parseFloat($('tiledZoomSlider').value);
    z = Math.min(3.0, z + 0.1);
    tiledData.zoom = z;
    $('tiledZoomSlider').value = z;
    updateTiledPreview();
  });




  // Pan logic for preview
  let isPanning = false;
  let startX, startY;
  const wrapper = $('tiledPreviewWrapper');
  wrapper.addEventListener('mousedown', e => { isPanning = true; startX = e.clientX - tiledData.panX; startY = e.clientY - tiledData.panY; });
  window.addEventListener('mousemove', e => {
    if (!isPanning) return;
    tiledData.panX = e.clientX - startX;
    tiledData.panY = e.clientY - startY;
    updateTiledPreview();
  });
  window.addEventListener('mouseup', () => { isPanning = false; });


  // Ориентация листа
  $('tiledOrientPortrait').addEventListener('click', () => {
    tiledData.orientation = 'portrait';
    $('tiledOrientPortrait').classList.add('active');
    $('tiledOrientLandscape').classList.remove('active');
    updateTiledPreview();
  });
  $('tiledOrientLandscape').addEventListener('click', () => {
    tiledData.orientation = 'landscape';
    $('tiledOrientLandscape').classList.add('active');
    $('tiledOrientPortrait').classList.remove('active');
    updateTiledPreview();
  });



  const trashBtn = $('clearPageBtn');
  trashBtn.addEventListener('click', showClearPageConfirm);

  // Extract Pages Events
  $('extractPagesBtn').addEventListener('click', openExtractModal);
  $('extractCancel').addEventListener('click', () => closeModal(extractModal));
  $('extractSaveBtn').addEventListener('click', saveExtractPDF);
  $('extractPrintBtn').addEventListener('click', printExtractPages);

  // setupKeyboard and setupCanvas moved to beginning of setupEvents()
  setupFloatingBtn();
  setupExtractObserver(); // Init Extract Logic

  /* Selection Tool Events */
  if (selectBtn) selectBtn.addEventListener('click', toggleSelectionMode);
  if (selectionClose) selectionClose.addEventListener('click', () => {
    isSelectionMode = false;
    selectRect = null;
    selectionPanel.classList.remove('active');
    selectBtn.classList.remove('active');
    rulerCanvas.style.cursor = 'default';
    scheduleDraw();
  });
  if (saveSelectPdfBtn) saveSelectPdfBtn.addEventListener('click', saveSelectionPdf);


  /* Text Tool Actions */
  function setupTextToolEvents() {
    textToolBtn.addEventListener('click', () => {
      // Reset inputs
      // textInputContent.value = ''; // Optional: keep last text
      openModal(textModal);
      isPlacingText = false;
    });

    const setupColorSelect = (container) => {
      container.querySelectorAll('.color-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          container.querySelectorAll('.color-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
        });
      });
    };
    setupColorSelect(textBgOpts);
    setupColorSelect(textColorOpts);

    textPlaceActionBtn.addEventListener('click', () => {
      const text = textInputContent.value.trim();
      if (!text) {
        alert('Введите текст');
        return;
      }
      const bgBtn = textBgOpts.querySelector('.active');
      const colorBtn = textColorOpts.querySelector('.active');

      pendingTextConfig = {
        text,
        bg: bgBtn ? bgBtn.dataset.color : 'transparent',
        color: colorBtn ? colorBtn.dataset.color : '#000000',
        fontSize: 16 / canvasScale // Base size adjusted
      };

      closeModal(textModal);

      isPlacingText = true;
      rulerCanvas.style.cursor = 'text';
      calibHint.textContent = '📍 Кликните, чтобы разместить надпись';
      calibHint.classList.add('active');

      // Disable other modes
      isRulerActive = false;
      isSelectionMode = false;
      rulerBtn.classList.remove('active');
      selectBtn.classList.remove('active');
    });
  }

  // Отслеживаем мышь глобально для старта по Shift
  window.addEventListener('mousemove', (e) => {
    if (pdfCanvas && pdfCanvas.offsetParent) {
      currentMousePos = getPos(e);
    }
  });
}

// GUI Helper: Обновляем вид кнопки корзины
// GUI Helper: Обновляем вид кнопки корзины
function updateTrashButtonState() {
  const btn = $('clearPageBtn');
  if (!btn) return;

  if (selectedLine) {
    btn.title = 'Удалить выделенную линию';
    btn.classList.add('active-delete');
  } else if (selectedText) {
    btn.title = 'Удалить выделенный текст';
    btn.classList.add('active-delete');
  } else {
    btn.title = 'Очистить всю страницу';
    btn.classList.remove('active-delete');
  }
}

// Helpers for Line Hit Test
function distanceToSegment(p, v, w) {
  const l2 = distance(v, w) ** 2;
  if (l2 === 0) return distance(p, v);
  let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  const proj = { x: v.x + t * (w.x - v.x), y: v.y + t * (w.y - v.y) };
  return distance(p, proj);
}

function isPointNearLine(pos, line, threshold = 8) {
  if (!line.points || line.points.length < 2) return false;
  const threshPage = cssPxToPage(threshold);
  for (let i = 0; i < line.points.length - 1; i++) {
    const dist = distanceToSegment(pos, line.points[i], line.points[i + 1]);
    if (dist <= threshPage) return true;
  }
  return false;
}

function findLineAt(pos) {
  const lines = getLines();
  for (let i = lines.length - 1; i >= 0; i--) {
    if (isPointNearLine(pos, lines[i])) return lines[i];
  }
  return null;
}

function deleteSelectedLine() {
  if (!selectedLine) return;
  const lines = getLines();
  const idx = lines.indexOf(selectedLine);
  if (idx !== -1) {
    snapshotPush(); // Сохраняем историю перед удалением
    lines.splice(idx, 1);
    selectedLine = null;
    saveCurrentProjectDebounced();
    scheduleCounter();
    scheduleDraw();
    updateTrashButtonState();
  }
}

function deleteSelectedText() {
  if (!selectedText) return;
  const texts = getPageTexts();
  if (!texts) return;
  const idx = texts.indexOf(selectedText);
  if (idx !== -1) {
    snapshotPush();
    texts.splice(idx, 1);
    selectedText = null;
    draggedText = null;
    saveCurrentProjectDebounced();
    scheduleDraw();
    updateTrashButtonState();
  }
}

function startLineFromShift(pos) {
  const lines = getLines();
  currentLine = { points: [pos, { ...pos }], color: 'rgba(255,255,255,0.96)' };
  lines.push(currentLine);
  selectedLine = currentLine; // Сразу выделяем
  draggedPoint = currentLine.points[1]; // Захватываем вторую
  dragPrevPos = pos;

  // Включаем режим, как будто мышка зажата, хотя это не так
  // Но мы будем использовать глобальный draggedPoint в move

  snapshotPush();
  scheduleCounter();
  scheduleDraw();
}

function setupKeyboard() {
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    if (e.repeat) return;

    // Удаление по Delete/Backspace
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (!isCalibrating && !penActive) {
        if (selectedLine && !draggedPoint) {
          deleteSelectedLine();
          e.preventDefault();
        } else if (selectedText) {
          deleteSelectedText();
          e.preventDefault();
        }
      }
    }

    // Start drawing on Shift press (without click)
    if (e.key === 'Shift') {
      isShiftPressed = true;
      if (!isCalibrating && !isSelectionMode && currentMousePos && currentProject) {
        // 1. Всегда создаем новую линию по Shift (даже если под курсором есть точка)
        // Чтобы пользователь мог наслоить новую линию поверх старой
        if (!currentLine && !draggedPoint) {
          startLineFromShift(currentMousePos);
          penActive = true;
          floatingBtn.classList.add('active');
        } else {
          penActive = true;
          floatingBtn.classList.add('active');
        }
      }
    }

    if (e.key === 'ArrowLeft') changePage(-1);
    if (e.key === 'ArrowRight') changePage(1);
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    if (e.key === 'Escape') {
      cancelCalibration();
      closeThumbs();
      if (selectedLine) { selectedLine = null; scheduleDraw(); }
    }
  });

  document.addEventListener('keyup', (e) => {
    if (e.key === 'Shift') {
      isShiftPressed = false;
      penActive = false;
      floatingBtn.classList.remove('active');

      // Если мы тянули линию, завершаем её
      if (currentLine) {
        currentLine = null;
        draggedPoint = null;
        saveCurrentProjectDebounced();
      }
    }
  });
}

function setupCanvas() {
  rulerCanvas.addEventListener('mousedown', onCanvasDown);
  rulerCanvas.addEventListener('mousemove', onCanvasMove);
  rulerCanvas.addEventListener('mouseup', onCanvasUp);
  rulerCanvas.addEventListener('mouseleave', () => { lineRubber = null; scheduleDraw(); });

  rulerCanvas.addEventListener('touchstart', (e) => {
    const t = e.changedTouches[0]; if (!t) return;
    const pos = getPos({ clientX: t.clientX, clientY: t.clientY });
    // Allow capture when: calibrating, drawing, ruler mode, shift mode, or clicking on existing point
    const need = isCalibrating || penActive || isRulerActive || isShiftPressed || isFloatingBtnPressed || !!findPoint(pos);
    touchCaptured = need;
    if (!need) return;
    e.preventDefault();
    onCanvasDown({ clientX: t.clientX, clientY: t.clientY });
  }, { passive: false });

  rulerCanvas.addEventListener('touchmove', (e) => {
    if (!touchCaptured) return;
    const t = e.changedTouches[0]; if (!t) return;
    e.preventDefault();
    onCanvasMove({ clientX: t.clientX, clientY: t.clientY });
  }, { passive: false });

  rulerCanvas.addEventListener('touchend', () => { if (touchCaptured) { touchCaptured = false; onCanvasUp(); } });
  rulerCanvas.addEventListener('touchcancel', () => { if (touchCaptured) { touchCaptured = false; onCanvasUp(); } });

  main.addEventListener('wheel', (e) => {
    if (!pdfDoc || !e.ctrlKey) return;
    e.preventDefault();
    setZoom(zoom * Math.exp(-e.deltaY * 0.002));
  }, { passive: false });
}

/* ===== PROJECTS SCREEN ===== */
function renderProjectsList() {
  projectsGrid.innerHTML = '';
  projects.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  for (const p of projects) {
    const card = document.createElement('div');
    card.className = 'project-card';
    card.innerHTML = `
      <div class="project-preview">
        ${p.preview ? `<img src="${p.preview}" alt="">` : '<div class="project-preview-placeholder">📄</div>'}
      </div>
      <div class="project-info">
        <div>
          <div class="project-name">${escapeHtml(p.name)}</div>
          <div class="project-meta">${p.pages || 0} стр. • ${formatDate(p.updatedAt)}</div>
        </div>
        <button class="project-delete" data-id="${p.id}" title="Удалить">🗑️</button>
      </div>
    `;
    card.addEventListener('click', (e) => {
      if (e.target.closest('.project-delete')) return;
      openProject(p.id);
    });
    card.querySelector('.project-delete').addEventListener('click', (e) => {
      e.stopPropagation();
      showDeleteConfirm(p);
    });
    projectsGrid.appendChild(card);
  }
}

async function onNewProjectFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  pendingFile = file;
  projectNameInput.value = file.name.replace(/\.pdf$/i, '');
  openModal(projectNameModal);
  projectNameInput.focus();
  projectNameInput.select();
  newProjectFile.value = '';
}

async function confirmNewProject() {
  const name = projectNameInput.value.trim() || 'Без названия';
  closeModal(projectNameModal);
  if (!pendingFile) return;

  showLoading('Создание проекта...', 'Загружаем PDF');
  try {
    await ensurePdfjs();
    const buffer = await readFileAsArrayBuffer(pendingFile);
    const doc = await loadPdfFromBuffer(buffer);

    // Генерируем превью первой страницы
    const page = await doc.getPage(1);
    const vp = page.getViewport({ scale: 0.3 });
    const c = document.createElement('canvas');
    c.width = vp.width; c.height = vp.height;
    await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    const preview = c.toDataURL('image/jpeg', 0.7);

    const project = {
      id: Date.now().toString(),
      name,
      pdfBlob: new Blob([buffer], { type: 'application/pdf' }), // Храним как легкий Blob
      preview,
      pages: doc.numPages,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      currentPage: 1,
      calibByPage: {},
      pageLines: {},
    };

    await saveProject(project);
    projects.push(project);
    renderProjectsList();

    hideLoading();
    // Open project directly with already-loaded doc (no reload!)
    await openProjectDirect(project, doc);
  } catch (err) {
    hideLoading();
    console.error(err);
    alert('Ошибка создания проекта: ' + err.message);
  }
  pendingFile = null;
}

function showDeleteConfirm(project) {
  deleteTargetId = project.id;
  isClearingPage = false;
  $('deleteModalTitle').textContent = '🗑️ Удалить проект?';
  deleteModalText.textContent = `Удалить проект "${project.name}"? Все данные будут потеряны.`;
  openModal(deleteModal);
}

async function confirmDelete() {
  closeModal(deleteModal);

  // Режим очистки страницы
  if (isClearingPage) {
    // Проверяем наличие линий или текста
    const lines = getLines();
    const texts = getPageTexts();
    const hasContent = lines.length > 0 || (texts && texts.length > 0);

    if (hasContent) {
      snapshotPush();
      lines.length = 0; // Clear lines

      // Clear texts (initialize if missing)
      if (!currentProject.pageTexts) currentProject.pageTexts = {};
      currentProject.pageTexts[currentPage] = [];

      selectedLine = null;
      draggedPoint = null;
      currentLine = null;
      draggedText = null;
      selectedText = null;
      isResizingText = false;
      isRotatingText = false;

      // Calibration is NOT reset explicitly
      // if (hasCalib) setCalib(currentPage, null); <-- REMOVED

      saveCurrentProjectDebounced();
      scheduleCounter();
      scheduleDraw();
      // updateCalibrateUI(); // Not needed as calib persists
    }
    isClearingPage = false;
    return;
  }

  // Режим удаления проекта
  if (deleteTargetId) {
    await deleteProject(deleteTargetId);
    projects = projects.filter(p => p.id !== deleteTargetId);
    renderProjectsList();
    deleteTargetId = null;
  }
}

async function openProject(id) {
  showLoading('Открытие проекта...', 'Загружаем PDF');
  try {
    await ensurePdfjs();
    const project = await getProject(id);
    if (!project) throw new Error('Проект не найден');
    currentProject = project;

    // Очищаем кэш страниц при открытии нового проекта
    renderedPagesCache.length = 0;


    // Читаем из Blob (быстро и экономно)
    if (!project.pdfBlob) throw new Error('PDF файл поврежден (нет Blob)');
    const buffer = await project.pdfBlob.arrayBuffer();

    pdfDoc = await loadPdfFromBuffer(buffer);
    currentPage = project.currentPage || 1;
    history = {};
    future = {};

    currentProjectName.textContent = project.name;
    thumbsCount.textContent = String(pdfDoc.numPages);

    projectsScreen.style.display = 'none';
    appScreen.style.display = 'flex';

    $('rulerToolBtn').disabled = false;
    selectBtn.disabled = false;
    $('extractPagesBtn').disabled = false;
    $('topbarPrintTiledBtn').disabled = false;
    undoBtn.disabled = true;
    redoBtn.disabled = true;

    await computeFitScale();
    await renderPage();
    initThumbnails();
    $('rulerToolBtn').disabled = false;
    updateCalibrateUI();
    updateNav();
    updateCounter();
    updateUndoRedo();
    hideLoading();
  } catch (err) {
    hideLoading();
    alert('Ошибка: ' + err.message);
  }
}

// Fast project open when doc is already loaded (used during creation)
async function openProjectDirect(project, doc) {
  currentProject = project;
  renderedPagesCache.length = 0;

  pdfDoc = doc;
  currentPage = project.currentPage || 1;
  history = {};
  future = {};

  currentProjectName.textContent = project.name;
  thumbsCount.textContent = String(pdfDoc.numPages);

  projectsScreen.style.display = 'none';
  appScreen.style.display = 'flex';

  $('rulerToolBtn').disabled = false;
  selectBtn.disabled = false;
  $('extractPagesBtn').disabled = false;
  $('topbarPrintTiledBtn').disabled = false;
  undoBtn.disabled = true;
  redoBtn.disabled = true;

  await computeFitScale();
  await renderPage();
  initThumbnails();
  updateCalibrateUI();
  updateNav();
  updateCounter();
  updateUndoRedo();
}

function goToProjectsScreen() {
  if (currentLine) finishLine();
  saveCurrentProject();
  pdfDoc = null;
  currentProject = null;
  selectedLine = null;
  isCalibrating = false;

  // Очистка кэша
  renderedPagesCache.length = 0;

  // Сброс экстрактора
  extractGrid.innerHTML = '';
  extractGrid.removeAttribute('data-pdf-id');
  extractSelectedPages.clear();
  $('extractPagesBtn').disabled = true;

  projectsScreen.style.display = 'block';
  appScreen.style.display = 'none';
  renderProjectsList();
}

async function saveCurrentProject() {
  if (!currentProject) return;
  currentProject.currentPage = currentPage;
  currentProject.calibByPage = getCalibByPage();
  currentProject.pageLines = getPageLines();
  currentProject.updatedAt = Date.now();
  try {
    await saveProject(currentProject);
  } catch (err) {
    console.error('Save error:', err);
  }
}

// Debounced версия для частых вызовов
let saveTimer = null;
function saveCurrentProjectDebounced() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveCurrentProject(), 500);
}

function getCalibByPage() { return currentProject?.calibByPage || {}; }
function setCalib(page, data) { if (currentProject) currentProject.calibByPage[page] = data; }
function getPageLines() { return currentProject?.pageLines || {}; }
function clearPage() {
  const lines = getLines();
  const texts = getPageTexts();

  // Check content only (ignore calibration)
  const hasContent = lines.length > 0 || (texts && texts.length > 0);
  if (!hasContent) return;

  isClearingPage = true;
  deleteTargetId = null;
  deleteModalText.textContent = 'Очистить страницу (линии и надписи)? Калибровка сохранится.';
  openModal(deleteModal);
}

function getLines() {
  if (!currentProject) return [];
  if (!currentProject.pageLines[currentPage]) currentProject.pageLines[currentPage] = [];
  return currentProject.pageLines[currentPage];
}

/* ===== PDF RENDERING ===== */
async function computeFitScale() {
  if (!pdfDoc) return;
  const page = await pdfDoc.getPage(currentPage);
  const vp = page.getViewport({ scale: 1 });
  const pad = parseFloat(getComputedStyle(canvasWrapper).paddingLeft) || 0;
  const availW = Math.max(320, main.clientWidth - pad * 2);
  baseScale = clamp(availW / vp.width, 0.5, 2.5);
}

let renderTimer = null;
function requestRender() {
  if (renderTask?.cancel) try { renderTask.cancel(); } catch (e) { }
  renderGen++;
  const gen = renderGen;

  if (renderTimer) clearTimeout(renderTimer);
  renderTimer = setTimeout(() => {
    if (gen === renderGen) renderPage().catch(console.error);
  }, 50);
}

/* ===== PDF RENDERING & CACHE ===== */
const PAGE_CACHE_SIZE = 20;
const renderedPagesCache = []; // [{ pageIndex, scale, canvas }]

async function renderPage() {
  if (!pdfDoc) return;
  const gen = ++renderGen;
  if (renderTask?.cancel) try { renderTask.cancel(); } catch (e) { }

  const pageIndex = currentPage;
  const page = await pdfDoc.getPage(pageIndex);
  if (gen !== renderGen) return;

  // Calculate target scale
  const targetScale = baseScale * zoom * RENDER_DPR;
  const vpRaw = page.getViewport({ scale: 1 });

  // Cap resolution at 12000px max for crisp quality
  const MAX_DIM = 12000;
  const wTarget = vpRaw.width * targetScale;
  const hTarget = vpRaw.height * targetScale;

  let renderScale = targetScale;
  if (wTarget > MAX_DIM || hTarget > MAX_DIM) {
    const ratio = Math.min(MAX_DIM / wTarget, MAX_DIM / hTarget);
    renderScale = targetScale * ratio;
  }

  canvasScale = renderScale;

  // CSS size (what user sees)
  const cssW = Math.floor(wTarget / RENDER_DPR) + 'px';
  const cssH = Math.floor(hTarget / RENDER_DPR) + 'px';

  // Check cache first
  const cached = renderedPagesCache.find(x => x.pageIndex === pageIndex && Math.abs(x.scale - renderScale) < 0.01);
  if (cached) {
    pdfCanvas.width = cached.canvas.width;
    pdfCanvas.height = cached.canvas.height;
    pdfCanvas.style.width = cssW;
    pdfCanvas.style.height = cssH;
    rulerCanvas.width = cached.canvas.width;
    rulerCanvas.height = cached.canvas.height;
    rulerCanvas.style.width = cssW;
    rulerCanvas.style.height = cssH;

    pdfCanvas.getContext('2d').drawImage(cached.canvas, 0, 0);

    // LRU update
    const idx = renderedPagesCache.indexOf(cached);
    renderedPagesCache.splice(idx, 1);
    renderedPagesCache.push(cached);

    drawLines();
    return;
  }

  // Render fresh
  const vp = page.getViewport({ scale: renderScale });

  pdfCanvas.width = vp.width;
  pdfCanvas.height = vp.height;
  pdfCanvas.style.width = cssW;
  pdfCanvas.style.height = cssH;
  rulerCanvas.width = vp.width;
  rulerCanvas.height = vp.height;
  rulerCanvas.style.width = cssW;
  rulerCanvas.style.height = cssH;

  pdfCtx.fillStyle = '#ffffff';
  pdfCtx.fillRect(0, 0, vp.width, vp.height);

  renderTask = page.render({ canvasContext: pdfCtx, viewport: vp });

  try {
    await renderTask.promise;
    if (gen !== renderGen) return;

    drawLines();

    // Save to cache
    const offscreen = document.createElement('canvas');
    offscreen.width = vp.width;
    offscreen.height = vp.height;
    offscreen.getContext('2d').drawImage(pdfCanvas, 0, 0);
    renderedPagesCache.push({ pageIndex, scale: renderScale, canvas: offscreen });
    if (renderedPagesCache.length > PAGE_CACHE_SIZE) renderedPagesCache.shift();

  } catch (e) {
    if (e?.name === 'RenderingCancelledException') return;
    console.error(e);
  }
}

function changePage(delta) {
  if (!pdfDoc) return;
  const np = currentPage + delta;
  if (np < 1 || np > pdfDoc.numPages) return;
  if (currentLine) finishLine();
  currentPage = np;
  cancelCalibration();
  updateNav();
  updateThumbnails();
  updateUndoRedo();
  saveCurrentProject();
  computeFitScale().then(() => requestRender());
  updateCounter();
}

function updateNav() {
  if (!pdfDoc) { pageInfo.textContent = '0 / 0'; prevBtn.disabled = nextBtn.disabled = true; return; }
  pageInfo.textContent = `${currentPage} / ${pdfDoc.numPages}`;
  prevBtn.disabled = currentPage <= 1;
  nextBtn.disabled = currentPage >= pdfDoc.numPages;
}

/* ===== CALIBRATION ===== */
function getUnitsPerMM() {
  const c = getCalibByPage()[currentPage];
  return c?.unitsPerMM > 0 ? c.unitsPerMM : null;
}

// rulerBtn moved to top scope
const logoBtn = $('logoBtn');

function updateCalibrateUI() {
  if (!rulerBtn) return;
  const lbl = rulerBtn.querySelector('.btn-label');

  const units = getUnitsPerMM();
  const ok = !!units;

  // Сброс классов
  rulerBtn.classList.remove('calibrating', 'calibrated', 'uncalibrated');

  if (isCalibrating) {
    rulerBtn.classList.add('calibrating');
    if (lbl) lbl.textContent = (calibPoints.length === 0 ? 'Точка 1...' : 'Точка 2...');
  } else {
    // В обычном режиме просто "Рулетка", статус показывается цветом точки
    if (lbl) lbl.textContent = 'Рулетка';
    if (ok) {
      rulerBtn.classList.add('calibrated');
    } else {
      rulerBtn.classList.add('uncalibrated');
    }
  }
}

function startCalibration() {
  if (!pdfDoc) return;

  // Отключаем режим выделения
  if (isSelectionMode) {
    isSelectionMode = false;
    selectBtn.classList.remove('active');
    selectRect = null;
    selectionPanel.classList.remove('active');
    rulerCanvas.style.cursor = 'crosshair';
  }

  isCalibrating = true; calibPoints = []; calibRubber = null;

  // Show hint for first point
  calibHint.textContent = '👆 Поставьте первую точку';
  calibHint.classList.add('active');

  updateCalibrateUI();
  scheduleDraw();
}

function saveCalibration() {
  if (calibPoints.length < 2) { alert('Поставьте 2 точки!'); return; }
  const len = parseFloat(calibLength.value);
  if (!len || len <= 0) { alert('Введите длину'); return; }
  const d = distance(calibPoints[0], calibPoints[1]);
  setCalib(currentPage, { unitsPerMM: d / len });
  isCalibrating = false; calibPoints = []; calibRubber = null;
  updateCalibrateUI();
  closeModal(calibModal);
  calibHint.classList.remove('active');
  drawLines();
  updateCounter();
  saveCurrentProject();
}

function cancelCalibration() {
  isCalibrating = false; calibPoints = []; calibRubber = null;
  updateCalibrateUI();
  closeModal(calibModal);
  calibHint.classList.remove('active');
  scheduleDraw();
}

/* ===== CANVAS EVENTS ===== */
function onCanvasDown(e) {
  try {
    if (!pdfDoc) return;
    if (isSelectionMode) { handleSelectionDown(e); return; }

    // Калибровка
    if (isCalibrating) {
      // ... (логика калибровки см. ниже, не меняем её структуру тут, просто вставляем проверку)
      if (calibPoints.length === 0) {
        calibPoints.push(getPos(e));
        calibHint.textContent = '👆 Поставьте вторую точку';
        calibHint.classList.add('active');
        scheduleDraw();
      } else if (calibPoints.length === 1) {
        calibPoints.push(getPos(e));
        calibRubber = null;
        calibHint.classList.remove('active');
        openModal(calibModal);
        setTimeout(() => { calibLength.focus(); calibLength.select(); }, 50);
        scheduleDraw();
      }
      return;
    }

    // Режим Рулетки (Рисования) или Shift
    const pos = getPos(e);
    // Проверяем, попали ли в точку (MAX priority)
    const p = findPoint(pos);

    if (p) {
      // Хватаем точку
      draggedPoint = p;
      const lines = getLines();

      // Находим линию, которой принадлежит точка, чтобы выделить её
      selectedLine = lines.find(l => l.points.includes(p));

      // Bring line to front
      if (selectedLine) {
        const idx = lines.indexOf(selectedLine);
        if (idx > -1) {
          lines.splice(idx, 1);
          lines.push(selectedLine);
        }
      }

      penActive = true;
      snapshotPush();
      scheduleDraw();
      return; // CRITICAL: Return immediately so we don't pick up the line itself
    }

    // 1. TEXT TOOL: Placing or Dragging
    if (isPlacingText && pendingTextConfig) {
      const texts = getPageTexts();
      texts.push({
        id: Date.now(),
        x: pos.x,
        y: pos.y,
        ...pendingTextConfig
      });
      isPlacingText = false;
      pendingTextConfig = null;
      rulerCanvas.style.cursor = 'default';
      calibHint.classList.remove('active');

      saveCurrentProjectDebounced();
      scheduleDraw();
      return;
    }

    // 0. CHECK HANDLES (If text selected)
    if (selectedText) {
      const t = selectedText;
      const cx = t.x + t.w / 2;
      const cy = t.y + t.h / 2;
      const tolerance = 20 / canvasScale; // Increased touch area

      const dx = pos.x - cx;
      const dy = pos.y - cy;
      // Rotate mouse pos to local coords
      const angle = -(t.rotation || 0);
      const lx = dx * Math.cos(angle) - dy * Math.sin(angle);
      const ly = dx * Math.sin(angle) + dy * Math.cos(angle);

      const hw = t.w / 2;
      const hh = t.h / 2;

      // A. Rotation Handle (Top Center)
      const rotOffset = 25 / canvasScale;
      if (Math.hypot(lx - 0, ly - (-hh - rotOffset)) <= tolerance) {
        isRotatingText = true;
        rotationState = {
          startAngle: Math.atan2(pos.y - cy, pos.x - cx),
          initialRotation: t.rotation || 0
        };
        snapshotPush();
        return;
      }

      // B. Resize Handle (Bottom Right)
      if (Math.hypot(lx - hw, ly - hh) <= tolerance) {
        isResizingText = true;
        resizeState = {
          initialFontSize: t.fontSize || 16,
          startDist: Math.hypot(lx, ly)
        };
        snapshotPush();
        return;
      }
    }

    // 2. HIT TEST BODY (Rotation Aware)
    let hitText = null;
    const texts = [...(getPageTexts() || [])].reverse(); // Safe copy

    for (const t of texts) {
      const cx = t.x + t.w / 2;
      const cy = t.y + t.h / 2;
      const dx = pos.x - cx;
      const dy = pos.y - cy;
      const angle = -(t.rotation || 0);
      const lx = dx * Math.cos(angle) - dy * Math.sin(angle);
      const ly = dx * Math.sin(angle) + dy * Math.cos(angle);

      if (Math.abs(lx) <= t.w / 2 && Math.abs(ly) <= t.h / 2) {
        hitText = t;
        break;
      }
    }

    if (hitText) {
      selectedText = hitText;
      draggedText = hitText;
      textDragStartPos = { x: pos.x, y: pos.y, ox: hitText.x, oy: hitText.y };

      isResizingText = false;
      isRotatingText = false;

      // Bring to front
      const allTexts = getPageTexts();
      const idx = allTexts.indexOf(hitText);
      if (idx > -1) {
        allTexts.splice(idx, 1);
        allTexts.push(hitText);
      }

      scheduleDraw();
      return;
    }

    // Если кликнули в пустоту - снимаем выделение текста (если не рисуем новую линию)
    if (!isShiftPressed && !isRulerActive) {
      selectedText = null;
    }

    // Если рулетка включена ИЛИ Shift нажат -> Рисуем новую линию
    // Если рулетка включена ИЛИ Shift нажат -> Рисуем новую линию
    if (isRulerActive || isShiftPressed || isFloatingBtnPressed) {
      // Magnet Snap Start
      const startPos = getSnapPos(pos);
      startLineFromShift(startPos);

      // Если это был режим рулетки (по кнопке) - выключаем его сразу (One-shot)
      if (isRulerActive) {
        toggleRulerMode(); // Выключить
        calibHint.classList.remove('active'); // Скрыть подсказку
      }

      penActive = true;
      return;
    }

    // Иначе -> Выделение и перетаскивание линии
    const line = findLineAt(pos);
    if (line) {
      selectedLine = line;
      draggedLine = line;
      dragPrevPos = pos;

      // Bring to front
      const lines = getLines();
      const idx = lines.indexOf(line);
      if (idx > -1) {
        lines.splice(idx, 1);
        lines.push(line);
      }
    } else {
      selectedLine = null;
    }
    scheduleDraw();
    updateTrashButtonState();
  } catch (err) {
    console.error(err);
    alert('CanvasDown Error: ' + err.message + '\n' + err.stack);
  }
}

function toggleRulerMode() {
  isRulerActive = !isRulerActive;

  if (isRulerActive) {
    // Включаем
    if (rulerBtn) rulerBtn.classList.add('active');
    if (rulerCanvas) rulerCanvas.style.cursor = 'crosshair';

    // Show hint
    if (calibHint) {
      calibHint.textContent = '📏 Укажите начальную точку замера';
      calibHint.classList.add('active');
    }

    // Выключаем другие режимы
    isSelectionMode = false;
    if (selectBtn) selectBtn.classList.remove('active');
    if (selectionPanel) selectionPanel.classList.remove('active');
  } else {
    // Выключаем
    if (rulerBtn) rulerBtn.classList.remove('active');
    if (rulerCanvas) rulerCanvas.style.cursor = 'default';
    if (calibHint) calibHint.classList.remove('active');
  }
}



function onCanvasMove(e) {
  if (isSelectionMode) { handleSelectionMove(e); return; }
  const pos = getPos(e);

  // 1. Rotate Text
  if (isRotatingText && selectedText && rotationState) {
    const t = selectedText;
    const cx = t.x + t.w / 2;
    const cy = t.y + t.h / 2;
    const curAngle = Math.atan2(pos.y - cy, pos.x - cx);
    let rot = rotationState.initialRotation + (curAngle - rotationState.startAngle);

    // Magnetic Snap to 45 degree steps (0, 45, 90...)
    const snapStep = Math.PI / 4; // 45 degrees
    const threshold = Math.PI / 36; // 5 degrees tolerance

    const nearest = Math.round(rot / snapStep) * snapStep;
    if (Math.abs(rot - nearest) < threshold) {
      rot = nearest;
    }

    t.rotation = rot;
    scheduleDraw();
    return;
  }

  // 2. Resize Text (Rotation Aware)
  if (isResizingText && selectedText && resizeState) {
    const t = selectedText;
    const cx = t.x + t.w / 2;
    const cy = t.y + t.h / 2;

    // Rotate mouse to local
    const dx = pos.x - cx;
    const dy = pos.y - cy;
    const angle = -(t.rotation || 0);
    const lx = dx * Math.cos(angle) - dy * Math.sin(angle);
    const ly = dx * Math.sin(angle) + dy * Math.cos(angle);

    const curDist = Math.hypot(lx, ly);
    const scale = curDist / resizeState.startDist;

    let newSize = resizeState.initialFontSize * scale;
    // Limits
    newSize = Math.max(8, Math.min(newSize, 300));

    t.fontSize = newSize;
    scheduleDraw();
    return;
  }

  // 3. Drag Text matches
  if (draggedText && textDragStartPos) {
    if (typeof textDragStartPos.ox === 'number') {
      draggedText.x = textDragStartPos.ox + (pos.x - textDragStartPos.x);
      draggedText.y = textDragStartPos.oy + (pos.y - textDragStartPos.y);
    } else {
      // Fallback for old style
      const dx = pos.x - textDragStartPos.x;
      const dy = pos.y - textDragStartPos.y;
      draggedText.x += dx;
      draggedText.y += dy;
      textDragStartPos = pos;
    }
    scheduleDraw();
    return;
  }

  // --- Cursor Update ---
  if (!draggedPoint && !draggedLine && !isCalibrating && !penActive) {
    if (findPoint(pos)) {
      rulerCanvas.style.cursor = 'pointer'; // Point hover
    } else if (findLineAt(pos)) {
      rulerCanvas.style.cursor = 'move'; // Line hover
    } else {
      rulerCanvas.style.cursor = 'default';
    }
  }

  // Перемещение всей линии
  if (draggedLine) {
    rulerCanvas.style.cursor = 'move';
    const dx = pos.x - dragPrevPos.x;
    const dy = pos.y - dragPrevPos.y;

    draggedLine.points.forEach(p => {
      p.x += dx;
      p.y += dy;
    });

    dragPrevPos = pos;
    scheduleCounter();
    scheduleDraw();
    return;
  }

  // Перемещение точки
  if (draggedPoint) {
    // Magnet Snap
    let snap = getSnapPos(pos, draggedPoint);

    // Angle Snap (to 0, 45, 90...)
    // Only if we are moving an endpoint of a line segment
    if (selectedLine && selectedLine.points && selectedLine.points.length >= 2) {
      const idx = selectedLine.points.indexOf(draggedPoint);
      if (idx !== -1) {
        // Find reference point (neighbor)
        let ref = null;
        if (idx === 0) ref = selectedLine.points[1];
        else if (idx === selectedLine.points.length - 1) ref = selectedLine.points[idx - 1];

        if (ref) {
          const dx = snap.x - ref.x;
          const dy = snap.y - ref.y;
          const dist = Math.hypot(dx, dy);
          const angle = Math.atan2(dy, dx);

          // Snap steps: 45 degrees (PI/4)
          // Suggest 45 deg (0, 45, 90) as standard
          const step = Math.PI / 4;
          // Уменьшаем порог до ~4 градусов, чтобы "магнит" был мягче и можно было точно корректировать рядом
          const threshold = Math.PI / 45;

          const nearest = Math.round(angle / step) * step;
          if (Math.abs(angle - nearest) < threshold) {
            snap.x = ref.x + dist * Math.cos(nearest);
            snap.y = ref.y + dist * Math.sin(nearest);
          }
        }
      }
    }

    draggedPoint.x = snap.x;
    draggedPoint.y = snap.y;

    // Гусеница (только если активен режим рисования currentLine)
    if (currentLine && draggedPoint === currentLine.points[currentLine.points.length - 1]) {

      // Только с SHIFT (Caterpillar constraint)
      if (isShiftPressed) {
        const isFirstSegment = currentLine.points.length === 2;
        // Lower threshold so it starts curving earlier
        const threshold = IS_COARSE ? 40 : 30;

        const minDist = cssPxToPage(threshold);
        // Check dist from previous point (penultimate)
        const last = currentLine.points[currentLine.points.length - 2];
        if (last && distance(last, snap) >= minDist && penActive) {
          currentLine.points.push({ ...snap });
          draggedPoint = currentLine.points[currentLine.points.length - 1]; // New tip
        }
      }
    }

    scheduleCounter();
    scheduleDraw();
    return;
  }

  if (isCalibrating && calibPoints.length === 1) { calibRubber = pos; scheduleDraw(); return; }
  // Убираем lineRubber при создании линии по новой схеме
}

function onCanvasUp() {
  if (draggedPoint) {
    if (currentLine && draggedPoint === currentLine.points[currentLine.points.length - 1] && !penActive) {
      currentLine = null;
    }
    draggedPoint = null;
    saveCurrentProjectDebounced();
  }

  if (draggedLine) {
    draggedLine = null;
    dragPrevPos = null;
    saveCurrentProjectDebounced();
  }

  if (draggedText) {
    draggedText = null;
    textDragStartPos = null;
    saveCurrentProjectDebounced();
  }

  isResizingText = false;
  resizeState = null;
  isRotatingText = false;
  rotationState = null;

  penActive = false;
  isShiftPressed = false;
  scheduleDraw();
}

/* ===== PEN ===== */
function startOrContinuePen(pos) {
  const lines = getLines();
  const last = currentLine?.points?.[currentLine.points.length - 1];
  if (!currentLine) {
    currentLine = { points: [pos], color: 'rgba(255,255,255,0.96)' };
    lines.push(currentLine);
    snapshotPush();
    scheduleCounter();
    scheduleDraw();
    return;
  }
  const minDist = cssPxToPage(IS_COARSE ? 14 : 10);
  if (!last || distance(last, pos) >= minDist) {
    currentLine.points.push(pos);
    scheduleCounter();
    scheduleDraw();
  }
}

function finishLine() {
  if (!currentLine) return;
  if (currentLine.points.length < 2) {
    const lines = getLines();
    const idx = lines.indexOf(currentLine);
    if (idx > -1) lines.splice(idx, 1);
  } else {
    currentLine.points = simplify(currentLine.points, cssPxToPage(IS_COARSE ? 6 : 5));
  }
  currentLine = null; lineRubber = null;
  updateCounter();
  drawLines();
  saveCurrentProjectDebounced();
}

function simplify(pts, eps) {
  if (pts.length <= 2) return pts;
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) { if (distance(out[out.length - 1], pts[i]) >= eps) out.push(pts[i]); }
  out.push(pts[pts.length - 1]);
  return out;
}

/* ===== DRAWING ===== */
let overlayRaf = null;
function scheduleDraw() { if (!overlayRaf) overlayRaf = requestAnimationFrame(() => { overlayRaf = null; drawLines(); }); }
let counterRaf = null;
function scheduleCounter() { if (!counterRaf) counterRaf = requestAnimationFrame(() => { counterRaf = null; updateCounter(); }); }

function drawLines() {
  rulerCtx.clearRect(0, 0, rulerCanvas.width, rulerCanvas.height);
  if (isCalibrating && calibPoints.length) {
    rulerCtx.save();
    rulerCtx.strokeStyle = 'rgba(255,230,160,0.98)';
    rulerCtx.lineWidth = 4;
    rulerCtx.setLineDash([10, 6]);
    if (calibPoints.length === 1 && calibRubber) {
      const a = pageToCanvas(calibPoints[0]), b = pageToCanvas(calibRubber);
      rulerCtx.beginPath(); rulerCtx.moveTo(a.x, a.y); rulerCtx.lineTo(b.x, b.y); rulerCtx.stroke();
      rulerCtx.setLineDash([]);
      drawCalibPoint(calibPoints[0]); drawCalibPoint(calibRubber);
    } else if (calibPoints.length >= 2) {
      const a = pageToCanvas(calibPoints[0]), b = pageToCanvas(calibPoints[1]);
      rulerCtx.beginPath(); rulerCtx.moveTo(a.x, a.y); rulerCtx.lineTo(b.x, b.y); rulerCtx.stroke();
      rulerCtx.setLineDash([]);
      drawCalibPoint(calibPoints[0]); drawCalibPoint(calibPoints[1]);
    } else { rulerCtx.setLineDash([]); drawCalibPoint(calibPoints[0]); }
    rulerCtx.restore();
  }
  if (isSelectionMode) drawSelection();
  for (const line of getLines()) {
    drawLine(line.points, line.color, line === selectedLine);
  }
  drawTexts(); // <--- Render Text Overlays
  updateTrashButtonState();
}

function drawCalibPoint(p) {
  const c = pageToCanvas(p);
  rulerCtx.save();
  rulerCtx.beginPath(); rulerCtx.arc(c.x, c.y, HANDLE_SIZE, 0, Math.PI * 2);
  rulerCtx.strokeStyle = 'rgba(255,230,160,0.98)'; rulerCtx.lineWidth = 3; rulerCtx.stroke();
  rulerCtx.beginPath(); rulerCtx.arc(c.x, c.y, 3, 0, Math.PI * 2);
  rulerCtx.fillStyle = 'rgba(255,230,160,0.98)'; rulerCtx.fill();
  rulerCtx.restore();
}

function drawTexts() {
  const texts = getPageTexts();
  if (!texts || !texts.length) return;

  rulerCtx.save();
  rulerCtx.textBaseline = 'top';

  texts.forEach(t => {
    // scale font
    const fontSize = (t.fontSize || 16) * canvasScale;
    rulerCtx.font = `bold ${fontSize}px "Inter", sans-serif`;

    // Split lines
    const lines = (t.text || '').split('\n');
    const lineHeight = fontSize * 1.3;

    // Measure box
    let maxWidth = 0;
    lines.forEach(line => {
      const m = rulerCtx.measureText(line);
      if (m.width > maxWidth) maxWidth = m.width;
    });

    const padding = 6 * canvasScale;
    const boxW = maxWidth + padding * 2;
    const boxH = (lines.length * lineHeight) + padding * 2;

    const x = t.x * canvasScale;
    const y = t.y * canvasScale;

    // Rotation Logic (Rotate around Center)
    const cx = x + boxW / 2;
    const cy = y + boxH / 2;

    rulerCtx.save();
    rulerCtx.translate(cx, cy);
    rulerCtx.rotate(t.rotation || 0);

    // Draw in local coords (-w/2, -h/2)
    const locX = -boxW / 2;
    const locY = -boxH / 2;

    // Background Patch
    if (t.bg && t.bg !== 'transparent') {
      rulerCtx.fillStyle = t.bg;

      // Shadow
      rulerCtx.shadowColor = 'rgba(0,0,0,0.15)';
      rulerCtx.shadowBlur = 4;
      rulerCtx.shadowOffsetY = 2;

      rulerCtx.fillRect(locX, locY, boxW, boxH);

      rulerCtx.shadowColor = 'transparent'; // reset
      rulerCtx.shadowBlur = 0;
    }

    // Text
    rulerCtx.fillStyle = t.color || '#000';
    lines.forEach((line, i) => {
      rulerCtx.fillText(line, locX + padding, locY + padding + (i * lineHeight));
    });

    // Store dimensions for hit testing (in page coords)
    t.w = boxW / canvasScale;
    t.h = boxH / canvasScale;

    // Selection & Handles
    if (t === selectedText) {
      rulerCtx.save();
      rulerCtx.strokeStyle = '#7c5cff';
      rulerCtx.lineWidth = 1.5;
      rulerCtx.setLineDash([4, 4]);
      rulerCtx.strokeRect(locX - 2, locY - 2, boxW + 4, boxH + 4);

      // --- Rotation Handle (Top Center) ---
      rulerCtx.setLineDash([]);
      rulerCtx.beginPath();
      // Line going up
      rulerCtx.moveTo(0, locY - 2);
      rulerCtx.lineTo(0, locY - 25);
      rulerCtx.stroke();

      // Circle knob
      rulerCtx.beginPath();
      rulerCtx.arc(0, locY - 25, 5, 0, Math.PI * 2);
      rulerCtx.fillStyle = '#fff';
      rulerCtx.fill();
      rulerCtx.stroke();

      // --- Resize Handle (Bottom Right) ---
      rulerCtx.beginPath();
      rulerCtx.arc(locX + boxW, locY + boxH, RESIZE_HANDLE_SIZE || 6, 0, Math.PI * 2);
      rulerCtx.fillStyle = '#7c5cff';
      rulerCtx.strokeStyle = '#fff';
      rulerCtx.fill();
      rulerCtx.stroke();

      rulerCtx.restore();
    }

    rulerCtx.restore(); // End rotation transform
  });

  rulerCtx.restore();
}

function drawLine(points, color, isSelected) {
  if (!points?.length) return;
  if (points.length >= 2) {
    rulerCtx.save();

    // Эффект выделения для всей линии
    if (isSelected) {
      rulerCtx.shadowColor = 'rgba(124, 92, 255, 0.8)';
      rulerCtx.shadowBlur = 15;
      rulerCtx.strokeStyle = '#fff';
    } else {
      rulerCtx.shadowColor = 'rgba(0,0,0,.3)';
      rulerCtx.shadowBlur = 5;
      rulerCtx.strokeStyle = color;
    }

    rulerCtx.lineWidth = LINE_WIDTH;
    rulerCtx.lineCap = 'round'; rulerCtx.lineJoin = 'round';

    const p0 = pageToCanvas(points[0]);
    rulerCtx.beginPath(); rulerCtx.moveTo(p0.x, p0.y);
    for (let i = 1; i < points.length; i++) { const pi = pageToCanvas(points[i]); rulerCtx.lineTo(pi.x, pi.y); }

    // Extra glow for selection
    if (isSelected) {
      rulerCtx.save();
      rulerCtx.strokeStyle = 'rgba(124, 92, 255, 0.5)';
      rulerCtx.lineWidth = LINE_WIDTH + 8;
      rulerCtx.stroke();
      rulerCtx.restore();
    }

    rulerCtx.stroke();
    rulerCtx.restore();
  }
  const n = points.length;
  let step = n > 100 ? 5 : n > 50 ? 3 : n > 30 ? 2 : 1;
  for (let i = 0; i < n; i++) {
    const isEnd = i === 0 || i === n - 1;
    if (!isEnd && step > 1 && i % step !== 0) continue;
    const p = pageToCanvas(points[i]);
    const r = isEnd ? HANDLE_SIZE : POINT_SIZE;
    rulerCtx.save();

    // Концевые точки - желтые полупрозрачные, промежуточные - цвет линии
    if (isEnd) {
      // Эффект свечения для концевых точек
      rulerCtx.shadowColor = 'rgba(255, 207, 90, 0.8)';
      rulerCtx.shadowBlur = 12;
      rulerCtx.fillStyle = 'rgba(255, 207, 90, 0.75)';
    } else {
      rulerCtx.fillStyle = color;
    }

    rulerCtx.beginPath();
    rulerCtx.arc(p.x, p.y, r, 0, Math.PI * 2);
    rulerCtx.fill();

    // Сбрасываем тень перед обводкой
    rulerCtx.shadowColor = 'transparent';
    rulerCtx.shadowBlur = 0;

    // Яркая обводка для лучшей видимости
    rulerCtx.strokeStyle = isEnd ? '#fff' : 'rgba(255,255,255,.85)';
    rulerCtx.lineWidth = isEnd ? 3 : 2.5;
    rulerCtx.stroke();

    // Дополнительная внутренняя тень для объема
    if (!isEnd) {
      rulerCtx.strokeStyle = 'rgba(0,0,0,.3)';
      rulerCtx.lineWidth = 1;
      rulerCtx.stroke();
    }

    rulerCtx.restore();
  }
  const units = getUnitsPerMM();
  if (units && points.length >= 2) {
    let total = 0;
    for (let i = 0; i < points.length - 1; i++) total += distance(points[i], points[i + 1]);
    const mm = total / units;
    const text = formatLength(mm);
    const mid = pageToCanvas(getMidpoint(points));
    rulerCtx.save();
    rulerCtx.font = 'bold 14px system-ui';
    const w = rulerCtx.measureText(text).width;
    let x = mid.x + 20, y = mid.y - 30;
    x = clamp(x, 8, rulerCanvas.width - w - 30);
    y = clamp(y, 8, rulerCanvas.height - 30);
    rulerCtx.fillStyle = 'rgba(10,18,33,0.85)';
    roundRect(rulerCtx, x, y, w + 16, 24, 8); rulerCtx.fill();
    rulerCtx.fillStyle = '#fff';
    rulerCtx.fillText(text, x + 8, y + 17);
    rulerCtx.restore();
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/* ===== COUNTER ===== */
function updateCounter() {
  const lines = getLines();
  let total = 0;
  for (const line of lines) {
    if (line.points.length >= 2) {
      for (let i = 0; i < line.points.length - 1; i++) total += distance(line.points[i], line.points[i + 1]);
    }
  }
  const units = getUnitsPerMM();
  counter.textContent = units ? formatLength(total / units) : '⚠️ Требуется калибровка';
  counter.title = units ? '' : 'Нажмите для калибровки';
}

function formatLength(mm) {
  if (mm >= 1000) return (mm / 1000).toFixed(2) + ' м';
  if (mm >= 100) return (mm / 10).toFixed(1) + ' см';
  return mm.toFixed(1) + ' мм';
}

/* ===== UNDO/REDO ===== */
function ensureStacks() {
  if (!history[currentPage]) history[currentPage] = [];
  if (!future[currentPage]) future[currentPage] = [];
}

function snapshotPush() {
  ensureStacks();
  history[currentPage].push(JSON.stringify(getLines()));
  if (history[currentPage].length > 50) history[currentPage].shift();
  future[currentPage] = [];
  updateUndoRedo();
}

function undo() {
  ensureStacks();
  if (!history[currentPage].length) return;
  future[currentPage].push(JSON.stringify(getLines()));
  currentProject.pageLines[currentPage] = JSON.parse(history[currentPage].pop());
  currentLine = null; lineRubber = null;
  scheduleDraw(); updateCounter(); saveCurrentProject(); updateUndoRedo();
}

function redo() {
  ensureStacks();
  if (!future[currentPage].length) return;
  history[currentPage].push(JSON.stringify(getLines()));
  currentProject.pageLines[currentPage] = JSON.parse(future[currentPage].pop());
  currentLine = null; lineRubber = null;
  scheduleDraw(); updateCounter(); saveCurrentProject(); updateUndoRedo();
}

function updateUndoRedo() {
  ensureStacks();
  undoBtn.disabled = !history[currentPage].length;
  redoBtn.disabled = !future[currentPage].length;
}

/* ===== FLOATING BUTTON ===== */
function setupFloatingBtn() {
  let isDragging = false;
  let startX, startY, btnLeft, btnTop;
  const tapThreshold = 5;

  // Обработка нажатия
  const start = (e) => {
    // Игнорируем мультитач
    if (e.touches && e.touches.length > 1) return;

    // Отключаем режим выделения
    if (isSelectionMode) {
      isSelectionMode = false;
      selectBtn.classList.remove('active');
      selectRect = null;
      selectionPanel.classList.remove('active');
      rulerCanvas.style.cursor = 'default';
    }

    startX = e.clientX || e.touches[0].clientX;
    startY = e.clientY || e.touches[0].clientY;
    const rect = floatingBtn.getBoundingClientRect();
    btnLeft = rect.left;
    btnTop = rect.top;

    isDragging = false;
    isFloatingBtnPressed = true;
    penActive = true;
    floatingBtn.classList.add('active');

    // Подписываемся на движение
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('mousemove', move);
  };

  const move = (e) => {
    const cx = e.clientX || (e.touches ? e.touches[0].clientX : 0);
    const cy = e.clientY || (e.touches ? e.touches[0].clientY : 0);

    const dx = cx - startX;
    const dy = cy - startY;

    if (!isDragging && Math.hypot(dx, dy) > tapThreshold) {
      isDragging = true;
      // Если начали тащить, отключаем режим рисования
      isFloatingBtnPressed = false;
      penActive = false;
      floatingBtn.classList.remove('active');
      if (currentLine) finishLine();
    }

    if (isDragging) {
      e.preventDefault();
      floatingBtn.style.left = (btnLeft + dx) + 'px';
      floatingBtn.style.top = (btnTop + dy) + 'px';
      floatingBtn.style.right = 'auto';
      floatingBtn.style.bottom = 'auto';
    }
  };

  const end = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('touchmove', move);
    window.removeEventListener('mousemove', move);

    if (isFloatingBtnPressed) {
      isFloatingBtnPressed = false;
      penActive = false;
      floatingBtn.classList.remove('active');
      if (currentLine) finishLine();
    }
    isDragging = false;
  };

  floatingBtn.addEventListener('mousedown', start);
  floatingBtn.addEventListener('touchstart', start, { passive: false });

  window.addEventListener('mouseup', end);
  window.addEventListener('touchend', end);
  window.addEventListener('touchcancel', end);
}

/* ===== THUMBNAILS ===== */
let thumbObserver = null;

function initThumbnails() {
  thumbnails.innerHTML = '';
  if (!pdfDoc) return;

  if (!currentProject.cachedThumbs) currentProject.cachedThumbs = {};

  // Настройка IntersectionObserver для ленивой загрузки
  if (thumbObserver) thumbObserver.disconnect();
  thumbObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const pageNum = +entry.target.dataset.page;
        loadThumbnail(pageNum, entry.target);
        thumbObserver.unobserve(entry.target);
      }
    });
  }, { root: thumbnails, rootMargin: '100px' });

  for (let i = 1; i <= pdfDoc.numPages; i++) {
    const wrap = document.createElement('div');
    wrap.className = 'thumb skeleton' + (i === currentPage ? ' active' : '');
    wrap.dataset.page = i;

    // Если есть в кэше - сразу показываем картинку
    if (currentProject.cachedThumbs[i]) {
      const img = new Image();
      img.src = currentProject.cachedThumbs[i];
      wrap.appendChild(img);
      wrap.classList.remove('skeleton');
    } else {
      // Иначе canvas заглушка
      const c = document.createElement('canvas');
      c.width = 120; c.height = 160;
      wrap.appendChild(c);
      thumbObserver.observe(wrap);
    }

    const label = document.createElement('div');
    label.className = 'thumb-label';
    label.textContent = i;
    wrap.appendChild(label);

    wrap.addEventListener('click', () => {
      currentPage = i;
      updateNav();
      updateThumbnails();
      closeThumbs();
      requestRender();
      updateCounter();
      saveCurrentProject();
    });

    thumbnails.appendChild(wrap);
  }
}

async function loadThumbnail(pageNum, wrap) {
  // Двойная проверка, вдруг уже загрузилось или есть в кэше
  if (currentProject.cachedThumbs[pageNum]) return;

  const canvas = wrap.querySelector('canvas');
  if (!canvas) return;

  try {
    const page = await pdfDoc.getPage(pageNum);
    const vp = page.getViewport({ scale: 0.2 }); // Чуть повыше качество
    canvas.width = vp.width;
    canvas.height = vp.height;

    await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;

    // Сохраняем в кэш
    const dataUrl = canvas.toDataURL('image/jpeg', 0.6);
    currentProject.cachedThumbs[pageNum] = dataUrl;

    // Подменяем canvas на img
    const img = new Image();
    img.src = dataUrl;
    wrap.replaceChild(img, canvas);
    wrap.classList.remove('skeleton');

    // Сохраняем проект (в фоне)
    saveCurrentProjectDebounced();
  } catch (e) {
    console.error('Thumb error:', e);
  }
}

function updateThumbnails() {
  thumbnails.querySelectorAll('.thumb').forEach(t => {
    t.classList.toggle('active', +t.dataset.page === currentPage);
  });
}

function toggleThumbs() { if (!pdfDoc) return; thumbsPanel.classList.toggle('active'); }
function openThumbs() { if (!pdfDoc) return; thumbsPanel.classList.add('active'); }
function closeThumbs() { thumbsPanel.classList.remove('active'); }

/* ===== ZOOM ===== */
function setZoom(v) { zoom = clamp(v, 0.1, 7); zoomLevel.textContent = Math.round(zoom * 100) + '%'; requestRender(); }
function changeZoom(d) { setZoom(zoom + d); }

/* ===== UTILS ===== */
function getPos(e) {
  const rect = rulerCanvas.getBoundingClientRect();
  const cx = (e.clientX - rect.left) * (rulerCanvas.width / rect.width);
  const cy = (e.clientY - rect.top) * (rulerCanvas.height / rect.height);
  return { x: cx / canvasScale, y: cy / canvasScale };
}

function distance(a, b) { return Math.hypot(b.x - a.x, b.y - a.y); }

// Find existing point near pos
function findPoint(pos) {
  const lines = getLines();
  const thr = cssPxToPage(SNAP);
  let bestP = null;
  let minD = thr;

  const check = (points) => {
    if (!points) return;
    for (const p of points) {
      const d = distance(p, pos);
      if (d < minD) {
        minD = d;
        bestP = p;
      }
    }
  };

  // Check selected line first
  if (selectedLine && selectedLine.points) {
    check(selectedLine.points);
  }

  // Check all other lines
  for (const line of lines) {
    if (line === selectedLine) continue;
    check(line.points);
  }

  return bestP;
}

// Get Snap Position (Magnet)
function getSnapPos(pos, ignorePoint) {
  const lines = getLines();
  const minDist = cssPxToPage(IS_COARSE ? 14 : 10);
  let best = null;
  let bestDist = minDist;

  // Collect all candidate points
  for (const line of lines) {
    if (!line.points) continue;
    for (const p of line.points) {
      if (p === ignorePoint) continue;
      const d = distance(pos, p);
      if (d < bestDist) {
        bestDist = d;
        best = p;
      }
    }
  }

  if (best) return { x: best.x, y: best.y };
  return { x: pos.x, y: pos.y }; // Ensure strictly valid object
}

// Geometry Helper
function getMidpoint(pts) {
  if (!pts || pts.length < 2) return { x: 0, y: 0 };
  let len = 0;
  for (let i = 0; i < pts.length - 1; i++) len += distance(pts[i], pts[i + 1]);

  const half = len / 2;
  let cur = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const seg = distance(pts[i], pts[i + 1]);
    if (cur + seg >= half) {
      const t = (half - cur) / seg;
      return {
        x: pts[i].x + (pts[i + 1].x - pts[i].x) * t,
        y: pts[i].y + (pts[i + 1].y - pts[i].y) * t
      };
    }
    cur += seg;
  }
  return pts[0];
}

function pageToCanvas(p) { return { x: p.x * canvasScale, y: p.y * canvasScale }; }
function cssPxToPage(px) { return px / (baseScale * zoom); }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

function escapeHtml(s) { return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function formatDate(ts) { if (!ts) return ''; const d = new Date(ts); return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }); }

function openModal(m) {
  if (!m) return;
  m.style.display = 'flex';
  // Force reflow
  void m.offsetWidth;
  m.classList.add('active');
  m.setAttribute('aria-hidden', 'false');
}

function closeModal(m) {
  if (!m) return;
  m.classList.remove('active');
  m.setAttribute('aria-hidden', 'true');
  setTimeout(() => {
    m.style.display = 'none';
    // Очистку extractGrid делаем только при закрытии проекта,
    // чтобы сохранить кэш превьюшек.
  }, 300);
}

function showLoading(t, s) { loading.classList.add('active'); loadingText.textContent = t; loadingSub.textContent = s; }
function hideLoading() { loading.classList.remove('active'); }

/* ===== SELECTION TOOL ===== */
let isSelectionMode = false;
let selectRect = null; // {x, y, w, h} in page units
let selectionAction = null; // 'create', 'move', 'resize-nw', 'resize-ne', 'resize-se', 'resize-sw'
let selectionStartPos = null; // {x, y} start of drag
let selectionStartRect = null; // copy of rect at start of drag

function toggleSelectionMode() {
  // Отключаем калибровку если она активна
  // Отключаем калибровку если она активна
  if (isCalibrating) {
    cancelCalibration();
  }

  isSelectionMode = !isSelectionMode;
  selectBtn.classList.toggle('active', isSelectionMode);
  selectBtn.title = isSelectionMode ? 'Режим выделения активен' : 'Выделить фрагмент';
  rulerCanvas.style.cursor = isSelectionMode ? 'crosshair' : 'default';

  if (!isSelectionMode) {
    selectRect = null;
    selectionAction = null;
    scheduleDraw();
    selectionPanel.classList.remove('active');
  } else {
    // Отключаем активное рисование
    penActive = false;
    isFloatingBtnPressed = false;
    floatingBtn.classList.remove('active');
  }
}

function getSelectionHandleRects(r) {
  // r is in page units. Handles sizes should be constant in screen pixels.
  const s = 8; // handle size px
  // Helper to get screen coords for a page point
  const p = (px, py) => pageToCanvas({ x: px, y: py });
  const c = (val) => val / canvasScale; // px to page units

  // We need handle hitboxes in PAGE units for simple logic, OR convert mouse to screen.
  // Let's keep logic in Page Units.
  const hs = s / canvasScale; // handle size in page units

  // Normalized rect
  const rx = Math.min(r.x, r.x + r.w);
  const ry = Math.min(r.y, r.y + r.h);
  const rw = Math.abs(r.w);
  const rh = Math.abs(r.h);

  return {
    nw: { x: rx - hs / 2, y: ry - hs / 2, w: hs, h: hs },
    ne: { x: rx + rw - hs / 2, y: ry - hs / 2, w: hs, h: hs },
    se: { x: rx + rw - hs / 2, y: ry + rh - hs / 2, w: hs, h: hs },
    sw: { x: rx - hs / 2, y: ry + rh - hs / 2, w: hs, h: hs }
  };
}

function hitTestSelection(pos) {
  if (!selectRect) return 'create';

  const h = getSelectionHandleRects(selectRect);
  const hit = (r, p) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

  // Check handles (expanded hit area a bit?)
  // Using simple hit test
  if (hit(h.se, pos)) return 'resize-se';
  if (hit(h.sw, pos)) return 'resize-sw';
  if (hit(h.ne, pos)) return 'resize-ne';
  if (hit(h.nw, pos)) return 'resize-nw';

  // Check inside
  const rx = Math.min(selectRect.x, selectRect.x + selectRect.w);
  const ry = Math.min(selectRect.y, selectRect.y + selectRect.h);
  const rw = Math.abs(selectRect.w);
  const rh = Math.abs(selectRect.h);

  if (pos.x >= rx && pos.x <= rx + rw && pos.y >= ry && pos.y <= ry + rh) {
    return 'move';
  }

  return 'create';
}

function handleSelectionDown(e) {
  const pos = getPos(e);
  selectionAction = hitTestSelection(pos);
  selectionStartPos = pos;

  if (selectionAction === 'create') {
    // Start new selection
    selectRect = { x: pos.x, y: pos.y, w: 0, h: 0 };
    selectionPanel.classList.remove('active');
  } else {
    // Start modifying existing
    selectionStartRect = { ...selectRect };
  }
}

function handleSelectionMove(e) {
  if (!selectionAction && selectRect) {
    // Just hover - update cursor
    const action = hitTestSelection(getPos(e));
    switch (action) {
      case 'move': rulerCanvas.style.cursor = 'move'; break;
      case 'resize-nw': rulerCanvas.style.cursor = 'nwse-resize'; break;
      case 'resize-se': rulerCanvas.style.cursor = 'nwse-resize'; break;
      case 'resize-ne': rulerCanvas.style.cursor = 'nesw-resize'; break;
      case 'resize-sw': rulerCanvas.style.cursor = 'nesw-resize'; break;
      default: rulerCanvas.style.cursor = 'crosshair';
    }
    return;
  }

  if (!selectionAction || !selectionStartPos) return;

  const pos = getPos(e);
  const dx = pos.x - selectionStartPos.x;
  const dy = pos.y - selectionStartPos.y;

  if (selectionAction === 'create') {
    selectRect.w = pos.x - selectionStartPos.x;
    selectRect.h = pos.y - selectionStartPos.y;
  } else if (selectionAction === 'move') {
    selectRect.x = selectionStartRect.x + dx;
    selectRect.y = selectionStartRect.y + dy;
  } else if (selectionAction.startsWith('resize')) {
    const mode = selectionAction.split('-')[1];
    // Simple resize logic (fixed anchor point depending on handle)
    // Actually, standard resize modifies w/h and potentially x/y.
    // Easier way: Recalculate based on original anchor opposite to handle

    let anchorX, anchorY;
    // Get canonical rect first
    let ox = Math.min(selectionStartRect.x, selectionStartRect.x + selectionStartRect.w);
    let oy = Math.min(selectionStartRect.y, selectionStartRect.y + selectionStartRect.h);
    let ow = Math.abs(selectionStartRect.w);
    let oh = Math.abs(selectionStartRect.h);
    let farX = ox + ow;
    let farY = oy + oh;

    // Determine new corner pos
    // This is simplified. 
    // If we drag SE, anchor is NW (ox, oy).
    // If we drag NW, anchor is SE (farX, farY).

    if (mode === 'se') {
      selectRect.x = ox; selectRect.y = oy;
      selectRect.w = Math.max(1, pos.x - ox);
      selectRect.h = Math.max(1, pos.y - oy);
    } else if (mode === 'nw') {
      // Anchor is SE
      selectRect.x = pos.x; selectRect.y = pos.y;
      selectRect.w = farX - pos.x;
      selectRect.h = farY - pos.y;
    } else if (mode === 'ne') {
      // Anchor is SW (ox, farY)
      selectRect.x = ox; selectRect.y = pos.y;
      selectRect.w = Math.max(1, pos.x - ox);
      selectRect.h = farY - pos.y;
    } else if (mode === 'sw') {
      // Anchor is NE (farX, oy)
      selectRect.x = pos.x; selectRect.y = oy;
      selectRect.w = farX - pos.x;
      selectRect.h = Math.max(1, pos.y - oy);
    }
  }

  scheduleDraw();
}

function handleSelectionUp() {
  selectionAction = null;
  selectionStartPos = null;
  selectionStartRect = null;
  updateSelectionPreview();
}

function drawSelection() {
  if (!selectRect) return;
  const r = selectRect;
  // Convert to canvas coords
  const p1 = pageToCanvas({ x: r.x, y: r.y });
  const p2 = pageToCanvas({ x: r.x + r.w, y: r.y + r.h });

  const x = Math.min(p1.x, p2.x);
  const y = Math.min(p1.y, p2.y);
  const w = Math.abs(p2.x - p1.x);
  const h = Math.abs(p2.y - p1.y);

  // 1. Dimming layer (entire screen minus selection)
  // Use evenodd rule for "hole"
  rulerCtx.save();
  rulerCtx.fillStyle = 'rgba(0, 0, 0, 0.45)';
  rulerCtx.beginPath();
  rulerCtx.rect(0, 0, rulerCanvas.width, rulerCanvas.height); // Outer
  rulerCtx.rect(x, y, w, h); // Inner (cutout effectively if we fill)
  rulerCtx.fill('evenodd');

  // 2. Selection Border
  rulerCtx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
  rulerCtx.lineWidth = 1.5;
  rulerCtx.setLineDash([4, 4]);
  rulerCtx.strokeRect(x, y, w, h);
  rulerCtx.setLineDash([]); // Reset

  // 3. Handles
  const handles = [
    { x: x, y: y }, // nw
    { x: x + w, y: y }, // ne
    { x: x + w, y: y + h }, // se
    { x: x, y: y + h } // sw
  ];

  rulerCtx.fillStyle = '#fff';
  rulerCtx.strokeStyle = 'rgba(0,0,0,0.2)';
  handles.forEach(h => {
    rulerCtx.beginPath();
    rulerCtx.arc(h.x, h.y, 5, 0, Math.PI * 2);
    rulerCtx.fill();
    rulerCtx.stroke();
  });

  rulerCtx.restore();
}

async function updateSelectionPreview() {
  if (!selectRect || Math.abs(selectRect.w) < 5 || Math.abs(selectRect.h) < 5) {
    if (isSelectionMode && !selectRect) scheduleDraw();
    return;
  }

  try {
    // Normalize
    const x0 = Math.min(selectRect.x, selectRect.x + selectRect.w);
    const y0 = Math.min(selectRect.y, selectRect.y + selectRect.h);
    const w0 = Math.abs(selectRect.w);
    const h0 = Math.abs(selectRect.h);

    // Update Rect to normalized form
    selectRect = { x: x0, y: y0, w: w0, h: h0 };

    // Capture
    const p1 = pageToCanvas({ x: x0, y: y0 });
    const p2 = pageToCanvas({ x: x0 + w0, y: y0 + h0 });

    const cx = Math.floor(p1.x);
    const cy = Math.floor(p1.y);
    const cw = Math.floor(p2.x - p1.x);
    const ch = Math.floor(p2.y - p1.y);

    // ЗАЩИТА: Ограничиваем максимальный размер (предотвращаем переполнение памяти)
    const MAX_DIMENSION = 8192; // ~8K pixels
    if (cw > MAX_DIMENSION || ch > MAX_DIMENSION || cw * ch > MAX_DIMENSION * MAX_DIMENSION / 2) {
      alert('⚠️ Выделенная область слишком большая!\n\nУменьшите выделение или масштаб.');
      return;
    }

    if (cw < 1 || ch < 1) {
      console.warn('Выделение слишком маленькое');
      return;
    }

    // Temp canvas
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = cw;
    tempCanvas.height = ch;
    const tCtx = tempCanvas.getContext('2d', { willReadFrequently: false });

    if (!tCtx) {
      throw new Error('Не удалось создать canvas context');
    }

    tCtx.drawImage(pdfCanvas, cx, cy, cw, ch, 0, 0, cw, ch);
    tCtx.drawImage(rulerCanvas, cx, cy, cw, ch, 0, 0, cw, ch);

    // Show in panel
    // Используем JPEG для уменьшения размера файла и повышения стабильности PDF
    const dataUrl = tempCanvas.toDataURL('image/jpeg', 0.92);
    selectionImg.src = dataUrl;
    selectionPanel.classList.add('active');

    // Сохраняем координаты выделения для высококачественной печати
    tiledData.selectionRect = { x: cx, y: cy, width: cw, height: ch };

    scheduleDraw();
  } catch (err) {
    console.error('Ошибка при создании превью:', err);
    alert('Не удалось создать превью выделения.\n\nПопробуйте уменьшить область или масштаб.');
  }
}

/* Actions */
// Selection buttons handled in DOMContentLoaded

/* Save Fragment logic extracted */
function saveSelectionPdf() {
  try {
    if (!window.jspdf) {
      alert('Библиотека PDF не загружена');
      return;
    }

    if (!selectionImg.src || !selectionImg.complete) {
      alert('Изображение еще не загружено');
      return;
    }

    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({
      orientation: selectionImg.naturalWidth > selectionImg.naturalHeight ? 'l' : 'p'
    });

    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();

    const imgW = selectionImg.naturalWidth;
    const imgH = selectionImg.naturalHeight;
    const ratio = imgW / imgH;

    let w = pageWidth - 20;
    let h = w / ratio;

    if (h > pageHeight - 20) {
      h = pageHeight - 20;
      w = h * ratio;
    }

    const x = (pageWidth - w) / 2;
    const y = (pageHeight - h) / 2;

    pdf.addImage(selectionImg.src, 'JPEG', x, y, w, h);

    // Формируем понятное имя файла
    let filename = 'fragment.pdf';

    // Функция очистки имени от запрещенных символов
    const sanitize = (str) => str.replace(/[:/\\?*|"<>;]/g, '_').trim();

    if (currentProject && currentProject.name) {
      const baseName = currentProject.name.replace(/\.pdf$/i, '');
      filename = `${sanitize(baseName)}_стр${currentPage}_фрагмент.pdf`;
    } else {
      filename = `чертеж_стр${currentPage}_фрагмент.pdf`;
    }

    const pdfBlob = pdf.output('blob');
    const url = URL.createObjectURL(pdfBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);

  } catch (err) {
    console.error('Ошибка сохранения PDF:', err);
    alert('Не удалось создать PDF файл.\n\n' + err.message);
  }
}

// Global cleanup to prevent sticking
window.addEventListener('mouseup', handleSelectionUp);
window.addEventListener('touchend', handleSelectionUp);

/* ===== EXTRACT PAGES LOGIC ===== */
// Variables moved to top
let extractSelectedPages = new Set();
let extractObserver = null;

function setupExtractObserver() {
  if (extractObserver) return;
  extractObserver = new IntersectionObserver((entries, obs) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const card = entry.target;
        const pageNum = parseInt(card.dataset.page);
        renderExtractThumbnail(card, pageNum);
        obs.unobserve(card);
      }
    });
  }, { root: document.querySelector('.extract-grid-wrapper'), rootMargin: '100px' });
}

function openExtractModal() {
  if (!pdfDoc) return;
  openModal(extractModal);
  updateExtractInfo();
  setupExtractObserver();
  setupExtractSizeSlider();
  renderExtractGrid();
}

// === SIZE SLIDER ===
function setupExtractSizeSlider() {
  const slider = document.getElementById('extractSizeSlider');
  const grid = document.getElementById('extractGrid');
  if (!slider || !grid) return;

  // Apply saved size
  const savedSize = localStorage.getItem('extractThumbSize') || '140';
  slider.value = savedSize;
  grid.style.gridTemplateColumns = `repeat(auto-fill, minmax(${savedSize}px, 1fr))`;

  slider.oninput = () => {
    const size = slider.value;
    grid.style.gridTemplateColumns = `repeat(auto-fill, minmax(${size}px, 1fr))`;
    localStorage.setItem('extractThumbSize', size);
  };
}

// === PREVIEW HELPERS ===
async function showExtractPreview(card, pageNum) {
  const preview = document.getElementById('extractPreview');
  const previewImg = document.getElementById('extractPreviewImg');
  const previewPage = document.getElementById('extractPreviewPage');

  if (!preview || !previewImg) return;

  // 1. Show low-res thumbnail immediately
  const canvas = card.querySelector('canvas');
  if (canvas) {
    previewImg.src = canvas.toDataURL('image/jpeg', 0.6);
  }

  if (previewPage) previewPage.textContent = `Страница ${pageNum}`;

  preview.classList.add('visible');

  // 2. Async render High-Res
  try {
    if (!pdfDoc) return;
    const page = await pdfDoc.getPage(pageNum);
    // Render at scale 2.0 for sharpness on large view
    const viewport = page.getViewport({ scale: 2.0 });

    const c = document.createElement('canvas');
    c.width = viewport.width;
    c.height = viewport.height;

    await page.render({ canvasContext: c.getContext('2d'), viewport }).promise;

    // Update image only if preview is still open
    if (preview.classList.contains('visible')) {
      previewImg.src = c.toDataURL('image/jpeg', 0.85);
    }
  } catch (err) {
    console.warn('High-res preview failed', err);
  }
}

function hideExtractPreview() {
  const preview = document.getElementById('extractPreview');
  if (preview) {
    preview.classList.remove('visible');
  }
}

function renderExtractGrid() {
  try {
    const grid = document.getElementById('extractGrid');
    if (!grid) {
      alert('CRITICAL: Grid element not found in DOM');
      return;
    }

    // CACHE CHECK: Пропускаем рендер, если уже есть для этого проекта
    const currentId = currentProject ? currentProject.id : 'temp';
    if (grid.children.length === pdfDoc.numPages && grid.getAttribute('data-pdf-id') === String(currentId)) {
      return;
    }
    grid.setAttribute('data-pdf-id', String(currentId));

    // Индикатор загрузки
    grid.innerHTML = '<div style="color:white; padding:20px;">Подготовка страниц...</div>';

    if (!pdfDoc) {
      grid.innerHTML = '<div style="color:red;">PDF не загружен</div>';
      return;
    }

    const num = pdfDoc.numPages;
    const fragment = document.createDocumentFragment();

    for (let i = 1; i <= num; i++) {
      const card = document.createElement('div');
      // Базовые стили + класс
      card.className = 'page-card';
      card.dataset.page = i;

      // Внутренняя структура
      card.innerHTML = `
            <div class="card-canvas-wrapper" style="pointer-events:none;">
                <canvas width="140" height="200"></canvas>
            </div>
            <div class="page-card-number">Стр. ${i}</div>
        `;

      // === LONG PRESS LOGIC ===
      // === UNIFIED CLICK & HOLD LOGIC ===
      let pressTimer = null;
      let isLongPress = false;

      const handleStart = (e) => {
        // Only Left Click or Touch
        if (e.type === 'mousedown' && e.button !== 0) return;

        isLongPress = false;

        // Visual feedback immediately handled by CSS :active

        pressTimer = setTimeout(() => {
          isLongPress = true;
          showExtractPreview(card, i);
        }, 220); // Wait 220ms before showing preview
      };

      const handleEnd = (e) => {
        if (pressTimer) {
          clearTimeout(pressTimer);
          pressTimer = null;
        }

        if (isLongPress) {
          // If was long press -> Just hide preview
          hideExtractPreview();
          isLongPress = false;
        } else {
          // If short press -> Toggle selection
          // Check if mouse is still over the card (simple check)
          if (e.type === 'mouseup' || e.type === 'touchend') {
            toggleExtractPage(i, card);
          }
        }
      };

      const handleCancel = () => {
        if (pressTimer) clearTimeout(pressTimer);
        hideExtractPreview();
      };

      // Assign direct handlers for stability
      card.onmousedown = handleStart;
      card.onmouseup = handleEnd;
      card.onmouseleave = handleCancel;

      card.ontouchstart = handleStart;
      card.ontouchend = handleEnd;
      card.ontouchcancel = handleCancel;

      // Disable default context menu on long press
      card.oncontextmenu = (e) => { e.preventDefault(); e.stopPropagation(); return false; };

      fragment.appendChild(card);

      if (extractObserver) extractObserver.observe(card);
    }

    grid.innerHTML = '';
    grid.appendChild(fragment);

  } catch (e) {
    alert('Error rendering grid: ' + e.message);
  }
}

async function renderExtractThumbnail(card, pageNum) {
  try {
    const canvas = card.querySelector('canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    // Init thumbnails cache storage
    if (!currentProject.cachedThumbs) currentProject.cachedThumbs = {};

    // 1. Check Cache
    if (currentProject.cachedThumbs[pageNum]) {
      const img = new Image();
      img.onload = () => {
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);
      };
      img.src = currentProject.cachedThumbs[pageNum];
      return;
    }

    // 2. Render from PDF
    const page = await pdfDoc.getPage(pageNum);
    const vp = page.getViewport({ scale: 1 });
    // Aim for ~200px width for good quality thumbnail
    const scale = 200 / vp.width;
    const viewport = page.getViewport({ scale });

    canvas.width = viewport.width;
    canvas.height = viewport.height;
    canvas.style.background = 'white';

    await page.render({ canvasContext: ctx, viewport }).promise;

    // 3. Save to Cache
    // Use JPEG 0.7 to save space in IndexedDB
    const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
    currentProject.cachedThumbs[pageNum] = dataUrl;

    // Save to persistence
    saveCurrentProjectDebounced();

  } catch (e) {
    console.error('Thumb render error:', e);
  }
}

function toggleExtractPage(pageNum, card) {
  if (extractSelectedPages.has(pageNum)) {
    extractSelectedPages.delete(pageNum);
    card.classList.remove('selected');
  } else {
    extractSelectedPages.add(pageNum);
    card.classList.add('selected');
  }
  updateExtractInfo();
}

function updateExtractInfo() {
  const count = extractSelectedPages.size;
  const sorted = Array.from(extractSelectedPages).sort((a, b) => a - b);

  let text = 'Ничего не выбрано';
  if (count > 0) {
    // Форматирование диапазонов: 1, 2, 3 -> 1-3
    const ranges = [];
    let rStart = sorted[0], rEnd = sorted[0];
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] === rEnd + 1) {
        rEnd = sorted[i];
      } else {
        ranges.push(rStart === rEnd ? rStart : `${rStart}-${rEnd}`);
        rStart = sorted[i]; rEnd = sorted[i];
      }
    }
    ranges.push(rStart === rEnd ? rStart : `${rStart}-${rEnd}`);

    text = `Выбрано: ${ranges.join(', ')}`;
  }

  extractSelectedInfo.textContent = text;
  extractSaveBtn.disabled = count === 0;

  // Also update print button
  const printBtn = document.getElementById('extractPrintBtn');
  if (printBtn) printBtn.disabled = count === 0;
}

// Print selected pages
async function printExtractPages() {
  if (extractSelectedPages.size === 0) return;

  try {
    const printBtn = document.getElementById('extractPrintBtn');
    printBtn.textContent = 'Подготовка...';
    printBtn.disabled = true;

    // Get original file data
    let fileBlob = currentProject?.pdfBlob;
    if (!fileBlob && pendingFile) fileBlob = pendingFile;
    if (!fileBlob) throw new Error('Файл не найден');

    const arrayBuffer = await fileBlob.arrayBuffer();
    const { PDFDocument } = PDFLib;
    const srcDoc = await PDFDocument.load(arrayBuffer);
    const newDoc = await PDFDocument.create();

    const pagesVal = Array.from(extractSelectedPages).sort((a, b) => a - b);
    const indices = pagesVal.map(p => p - 1);

    const copied = await newDoc.copyPages(srcDoc, indices);
    copied.forEach(p => newDoc.addPage(p));

    const pdfBytes = await newDoc.save();
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);

    // Open in new window for printing
    const printWindow = window.open(url, '_blank');
    if (printWindow) {
      printWindow.onload = () => {
        setTimeout(() => {
          printWindow.print();
        }, 500);
      };
    }

    printBtn.textContent = '🖨️ Печать';
    printBtn.disabled = false;

  } catch (e) {
    console.error('Print error:', e);
    alert('Ошибка печати: ' + e.message);
    const printBtn = document.getElementById('extractPrintBtn');
    if (printBtn) {
      printBtn.textContent = '🖨️ Печать';
      printBtn.disabled = false;
    }
  }
}

async function saveExtractPDF() {
  if (extractSelectedPages.size === 0) return;

  try {
    extractSaveBtn.textContent = 'Сохранение...';
    extractSaveBtn.disabled = true;

    // 1. Get original file data
    // Try getting from currentProject.file (Blob from IDB)
    // 1. Get original file data
    // Try getting from currentProject.pdfBlob
    let fileBlob = currentProject.pdfBlob;
    if (!fileBlob && pendingFile) fileBlob = pendingFile;
    // Если в объекте нет файла, попробуем загрузить из IDB
    if (!fileBlob && currentProject.id) {
      const tx = db.transaction('projects', 'readonly');
      const dbp = await tx.store.get(currentProject.id);
      if (dbp) fileBlob = dbp.pdfBlob;
    }

    if (!fileBlob) throw new Error('Исходный файл не найден');

    const arrayBuffer = await fileBlob.arrayBuffer();

    // 2. pdf-lib processing
    const { PDFDocument } = PDFLib;
    const srcDoc = await PDFDocument.load(arrayBuffer);
    const newDoc = await PDFDocument.create();

    const pagesVal = Array.from(extractSelectedPages).sort((a, b) => a - b);
    const indices = pagesVal.map(p => p - 1);

    const copied = await newDoc.copyPages(srcDoc, indices);
    copied.forEach(p => newDoc.addPage(p));

    const pdfBytes = await newDoc.save();

    // 3. Download
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;

    let name = currentProject.name || 'document';
    name = name.replace(/\.pdf$/i, '');
    // Sanitize project name
    name = name.replace(/[:/\\?*|"<>;]/g, '_').trim();

    // Generate suffix from text content (e.g. "1-5, 8")
    let suffix = extractSelectedInfo.textContent.replace('Выбрано: ', '').replace(/selected/i, '').trim();
    // Sanitize suffix (allow numbers, dashes, commas, spaces)
    suffix = suffix.replace(/[^0-9\-, ]/g, '');
    if (suffix.length > 20) suffix = suffix.substring(0, 20) + '...';

    a.download = `${name}_pages_${suffix}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    closeModal(extractModal);
  } catch (e) {
    console.error(e);
    alert('Ошибка: ' + e.message);
  } finally {
    extractSaveBtn.textContent = 'Сохранить PDF';
    extractSaveBtn.disabled = false;
  }
}

let tiledData = {
  img: null,
  format: 'A4',
  panX: 0,
  panY: 0,
  rotation: 0,
  zoom: 1,
  orientation: 'portrait', // 'portrait' | 'landscape'
  w_mm: 0,
  h_mm: 0
};

const FORMATS = {
  'A0': { w: 841, h: 1189 },
  'A1': { w: 594, h: 841 },
  'A2': { w: 420, h: 594 },
  'A3': { w: 297, h: 420 },
  'A4': { w: 210, h: 297 }
};

function openPrintTiled() {
  if (!pdfDoc) return;

  // Сброс трансформаций
  tiledData.panX = 0;
  tiledData.panY = 0;
  tiledData.rotation = 0;
  tiledData.zoom = 1;
  if ($('tiledZoomSlider')) $('tiledZoomSlider').value = 1;

  // Проверяем, есть ли активный выделенный фрагмент
  const hasSelection = selectionPanel.classList.contains('active') && selectionImg.src && selectionImg.complete;

  // Показываем индикатор загрузки
  const loadingIndicator = document.createElement('div');
  loadingIndicator.id = 'printLoadingIndicator';
  loadingIndicator.style.cssText = `
    position: fixed; top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center;
    z-index: 20000; color: #fff; font-size: 18px; flex-direction: column; gap: 16px;
  `;
  loadingIndicator.innerHTML = `
    <div style="width: 40px; height: 40px; border: 3px solid rgba(255,255,255,0.3); border-top-color: #fff; border-radius: 50%; animation: spin 1s linear infinite;"></div>
    <div>Подготовка изображения высокого разрешения...</div>
    <style>@keyframes spin { to { transform: rotate(360deg); } }</style>
  `;
  document.body.appendChild(loadingIndicator);

  // Асинхронная подготовка высокого разрешения
  setTimeout(async () => {
    try {
      let sourceCanvas;

      if (hasSelection) {
        // Для выделенного фрагмента ререндерим PDF в высоком разрешении
        // Используем координаты выделения если доступны
        if (tiledData.selectionRect && pdfDoc) {
          sourceCanvas = await renderSelectionHighRes(tiledData.selectionRect);
        } else {
          // Fallback: используем текущее изображение с масштабированием
          sourceCanvas = document.createElement('canvas');
          const printScale = 4; // 4x для лучшего качества
          sourceCanvas.width = (selectionImg.naturalWidth || 400) * printScale;
          sourceCanvas.height = (selectionImg.naturalHeight || 400) * printScale;
          const ctx = sourceCanvas.getContext('2d');
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(selectionImg, 0, 0, sourceCanvas.width, sourceCanvas.height);
        }
      } else {
        // Рендерим всю страницу PDF в высоком разрешении (300 DPI)
        sourceCanvas = await renderPageHighRes(currentPage, 300);
      }

      // Проверяем что канвас не пустой
      if (!sourceCanvas || sourceCanvas.width === 0 || sourceCanvas.height === 0) {
        loadingIndicator.remove();
        alert('Нет изображения для печати. Откройте PDF или выделите фрагмент.');
        return;
      }

      // Используем PNG для лучшего качества (особенно для чертежей с линиями)
      tiledData.img = sourceCanvas.toDataURL('image/png');
      tiledData.sourceWidth = sourceCanvas.width;
      tiledData.sourceHeight = sourceCanvas.height;

      // Рассчитываем физический размер (если есть калибровка)
      const units = getUnitsPerMM();
      if (units) {
        // Используем оригинальный масштаб страницы для расчета
        const origScale = pdfCanvas.width / sourceCanvas.width;
        tiledData.w_mm = sourceCanvas.width * origScale / units;
        tiledData.h_mm = sourceCanvas.height * origScale / units;
      } else {
        // Если нет калибровки, используем стандартные пропорции A0
        const aspectRatio = sourceCanvas.width / sourceCanvas.height;
        if (aspectRatio > 1) {
          tiledData.w_mm = 1189;
          tiledData.h_mm = 841;
        } else {
          tiledData.w_mm = 841;
          tiledData.h_mm = 1189;
        }
      }

      loadingIndicator.remove();
      openModal($('printTiledModal'));

      // Небольшая задержка для корректного рендера
      setTimeout(() => updateTiledPreview(), 100);

    } catch (err) {
      loadingIndicator.remove();
      console.error('Ошибка подготовки печати:', err);
      alert('Ошибка подготовки печати: ' + err.message);
    }
  }, 50);
}

// Рендерит страницу PDF в высоком разрешении
async function renderPageHighRes(pageNum, dpi = 300) {
  const page = await pdfDoc.getPage(pageNum);
  const viewport = page.getViewport({ scale: 1 });

  // Рассчитываем масштаб для целевого DPI
  // Стандартный PDF = 72 DPI
  const scale = dpi / 72;
  const scaledViewport = page.getViewport({ scale: scale });

  const canvas = document.createElement('canvas');
  canvas.width = scaledViewport.width;
  canvas.height = scaledViewport.height;

  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  await page.render({
    canvasContext: ctx,
    viewport: scaledViewport
  }).promise;

  return canvas;
}

// Рендерит выделенную область в высоком разрешении
async function renderSelectionHighRes(rect) {
  const page = await pdfDoc.getPage(currentPage);
  const viewport = page.getViewport({ scale: 1 });

  // Высокое разрешение для печати (300 DPI)
  const printScale = 300 / 72;
  const scaledViewport = page.getViewport({ scale: printScale });

  // Рендерим всю страницу в высоком разрешении
  const fullCanvas = document.createElement('canvas');
  fullCanvas.width = scaledViewport.width;
  fullCanvas.height = scaledViewport.height;

  const fullCtx = fullCanvas.getContext('2d');
  await page.render({
    canvasContext: fullCtx,
    viewport: scaledViewport
  }).promise;

  // Вырезаем нужную область
  // rect в координатах экрана, нужно пересчитать
  const currentScale = pdfCanvas.width / (viewport.width * window.devicePixelRatio);
  const selScale = printScale / currentScale;

  const cropCanvas = document.createElement('canvas');
  cropCanvas.width = rect.width * selScale;
  cropCanvas.height = rect.height * selScale;

  const cropCtx = cropCanvas.getContext('2d');
  cropCtx.imageSmoothingEnabled = true;
  cropCtx.imageSmoothingQuality = 'high';

  cropCtx.drawImage(
    fullCanvas,
    rect.x * selScale, rect.y * selScale, rect.width * selScale, rect.height * selScale,
    0, 0, cropCanvas.width, cropCanvas.height
  );

  return cropCanvas;
}


function getTargetFormat() {
  const formatKey = document.querySelector('#printTiledModal .chip.active').dataset.format;
  const base = FORMATS[formatKey];
  if (tiledData.orientation === 'landscape') {
    return { w: base.h, h: base.w, key: formatKey };
  }
  return { ...base, key: formatKey };
}

function updateTiledPreview() {
  const target = getTargetFormat(); // { w, h } in mm
  const hints = $('tiledHintsToggle').checked;

  const canvas = $('tiledPreviewCanvas');
  const ctx = canvas.getContext('2d');

  // Optimizaton: Choose best paper orientation (Portrait vs Landscape)
  // Standard A4: 210 x 297
  const countP = Math.ceil(target.w / 210) * Math.ceil(target.h / 297);
  const countL = Math.ceil(target.w / 297) * Math.ceil(target.h / 210);

  // Prefer Landscape if fewer pages, OR if equal pages and it fits 1x1 perfectly (Case A4 Landscape)
  const useLandscape = (countL < countP) || (countL === countP && target.w <= 297 && target.h <= 210 && target.w > 210);

  const a4w_mm = useLandscape ? 297 : 210;
  const a4h_mm = useLandscape ? 210 : 297;

  // 1. Устанавливаем размер ОБЕРТКИ
  const previewScale = Math.min(600 / target.w, 400 / target.h);
  const pixelW = target.w * previewScale;
  const pixelH = target.h * previewScale;

  const wrapper = $('tiledPreviewWrapper');
  wrapper.style.width = pixelW + 'px';
  wrapper.style.height = pixelH + 'px';

  const dpr = window.devicePixelRatio || 1;
  canvas.width = pixelW * dpr;
  canvas.height = pixelH * dpr;
  canvas.style.width = '100%';
  canvas.style.height = '100%';

  ctx.scale(dpr, dpr);
  ctx.imageSmoothingEnabled = true;

  tiledData.previewScale = previewScale;
  // Save computed paper size for generation step
  tiledData.printPaper = { w: a4w_mm, h: a4h_mm, orient: useLandscape ? 'l' : 'p' };

  const img = new Image();
  img.onload = () => {
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width / dpr, canvas.height / dpr);

    ctx.save();
    const logicW = canvas.width / dpr;
    const logicH = canvas.height / dpr;
    const centerX = logicW / 2 + tiledData.panX;
    const centerY = logicH / 2 + tiledData.panY;

    ctx.translate(centerX, centerY);
    ctx.rotate((tiledData.rotation * Math.PI) / 180);
    ctx.scale(tiledData.zoom, tiledData.zoom);

    const isRotated = tiledData.rotation % 180 !== 0;
    const imgW = isRotated ? img.height : img.width;
    const imgH = isRotated ? img.width : img.height;

    // Scale to fit constraints logic
    const scaleToFit = Math.min(logicW / imgW, logicH / imgH) * 0.95;
    ctx.scale(scaleToFit, scaleToFit);

    ctx.drawImage(img, -img.width / 2, -img.height / 2);
    ctx.restore();

    // 3. Рисуем сетку реза
    const cellW = a4w_mm * previewScale;
    const cellH = a4h_mm * previewScale;

    const cols = Math.ceil(target.w / a4w_mm);
    const rows = Math.ceil(target.h / a4h_mm);

    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(255, 50, 50, 0.6)';
    ctx.beginPath();

    for (let c = 1; c < cols; c++) {
      const x = c * cellW;
      ctx.moveTo(x, 0); ctx.lineTo(x, logicH);
    }
    for (let r = 1; r < rows; r++) {
      const y = r * cellH;
      ctx.moveTo(0, y); ctx.lineTo(logicW, y);
    }
    ctx.stroke();

    if (hints) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
      ctx.font = 'bold 10px Inter, sans-serif';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const x = (c + 1) * cellW - 4;
          const y = (r + 1) * cellH - 4;

          // Only draw if info fits
          if (x > 20 && y > 20) {
            const text = `${r + 1}-${c + 1}`;
            const m = ctx.measureText(text);
            ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
            ctx.fillRect(x - m.width - 4, y - 14, m.width + 8, 18);
            ctx.fillStyle = '#eb3b5a';
            ctx.fillText(text, x, y);
          }
        }
      }
    }

    $('tiledSheetCount').textContent = cols * rows;
    $('tiledFinalSize').textContent = `${target.w} x ${target.h} мм`;
    $('tiledGridOverlay').innerHTML = '';
  };
  img.src = tiledData.img;
}

// Helper to ensure jspdf is loaded (if not already)
async function ensurePdfjs() {
  if (!window.jspdf) {
    // In a real app, you'd load the script dynamically here
    console.warn("jspdf not found. Please ensure it's loaded.");
    // For this example, we'll assume it's available globally or throw
    throw new Error("jspdf library is not loaded.");
  }
}

// Helper factory for Tiled PDF
async function createTiledPdfDoc() {
  const preview = $('tiledPreviewWrapper');
  if (preview) preview.classList.add('scanning');

  try {
    await ensurePdfjs(); // actually ensure jspdf
    const { jsPDF } = window.jspdf;
    const target = getTargetFormat(); // {w, h (mm)}

    // Use calculated best paper orientation
    const paper = tiledData.printPaper || { w: 210, h: 297, orient: 'p' };

    const doc = new jsPDF({
      orientation: paper.orient,
      unit: 'mm',
      format: 'a4'
    });

    const hints = $('tiledHintsToggle').checked;

    const cellW = paper.w;
    const cellH = paper.h;

    const cols = Math.ceil(target.w / cellW);
    const rows = Math.ceil(target.h / cellH);

    // --- High-Res Virtual Canvas ---
    // Динамический scaleFactor: для больших форматов используем меньший множитель
    // чтобы не превысить лимиты браузера (обычно ~16384px)
    const maxCanvasSize = 16000;
    const baseScaleFactor = Math.min(
      maxCanvasSize / target.w,
      maxCanvasSize / target.h,
      10 // Максимум 10x для отличного качества (эквивалент ~254 DPI при базовом 25.4 px/mm)
    );
    const scaleFactor = Math.max(baseScaleFactor, 4); // Минимум 4x

    console.log(`Печать: формат ${target.w}x${target.h}мм, scaleFactor=${scaleFactor.toFixed(1)}, разрешение=${Math.round(target.w * scaleFactor)}x${Math.round(target.h * scaleFactor)}px`);

    const vCanvas = document.createElement('canvas');
    vCanvas.width = Math.round(target.w * scaleFactor);
    vCanvas.height = Math.round(target.h * scaleFactor);
    const vCtx = vCanvas.getContext('2d');

    // White paper bg
    vCtx.fillStyle = '#ffffff';
    vCtx.fillRect(0, 0, vCanvas.width, vCanvas.height);

    vCtx.save();
    // 1. Center
    vCtx.translate(vCanvas.width / 2, vCanvas.height / 2);
    // 2. Zoom & Rotate
    vCtx.scale(tiledData.zoom, tiledData.zoom);
    vCtx.rotate((tiledData.rotation * Math.PI) / 180);
    // 3. Pan
    const panX_hires = (tiledData.panX / (tiledData.previewScale || 1)) * scaleFactor;
    const panY_hires = (tiledData.panY / (tiledData.previewScale || 1)) * scaleFactor;
    vCtx.translate(panX_hires, panY_hires);

    // 4. Draw Image
    const img = new Image();
    img.src = tiledData.img;
    await new Promise(r => {
      if (img.complete) r();
      else img.onload = img.onerror = r;
    });

    if (img.complete && img.naturalWidth) {
      const scale = Math.min(target.w / img.naturalWidth, target.h / img.naturalHeight) * 0.95;
      const drawW = img.naturalWidth * scale * scaleFactor;
      const drawH = img.naturalHeight * scale * scaleFactor;
      vCtx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
    }
    vCtx.restore();

    // --- Slicing ---
    let pageCount = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (pageCount > 0) doc.addPage();

        const srcX = c * cellW * scaleFactor;
        const srcY = r * cellH * scaleFactor;
        const srcW = Math.min(cellW, target.w - c * cellW) * scaleFactor;
        const srcH = Math.min(cellH, target.h - r * cellH) * scaleFactor;

        const pageCanvas = document.createElement('canvas');
        pageCanvas.width = srcW;
        pageCanvas.height = srcH;
        const pCtx = pageCanvas.getContext('2d');

        pCtx.drawImage(vCanvas, srcX, srcY, srcW, srcH, 0, 0, srcW, srcH);

        // Crop marks
        if (hints) {
          pCtx.strokeStyle = 'rgba(0,0,0,0.2)';
          pCtx.lineWidth = 1 * scaleFactor;
          pCtx.strokeRect(0, 0, srcW, srcH);
        }

        const imgData = pageCanvas.toDataURL('image/jpeg', 0.92);

        // Add to PDF
        doc.addImage(imgData, 'JPEG', 0, 0, srcW / scaleFactor, srcH / scaleFactor);

        if (hints) {
          doc.setFontSize(9);
          doc.setTextColor(150);
          doc.text(`Лист ${r + 1}-${c + 1}`, 5, cellH - 5);

          // Cut marks corners
          doc.setDrawColor(200);
          doc.setLineWidth(0.1);
          // Top-Left
          doc.line(0, 5, 0, 0); doc.line(0, 0, 5, 0);
          // Bottom-Right
          const w = srcW / scaleFactor;
          const h = srcH / scaleFactor;
          doc.line(w, h - 5, w, h); doc.line(w - 5, h, w, h);
        }
        pageCount++;
      }
    }

    return doc;

  } finally {
    if (preview) preview.classList.remove('scanning');
  }
}

// Handler for Save PDF
async function handleTiledGenerate() {
  const btn = $('tiledGenerateBtn');
  if (!btn) return;
  btn.disabled = true;
  btn.textContent = 'Обработка...';

  try {
    const doc = await createTiledPdfDoc();
    const formatKey = document.querySelector('#printTiledModal .chip.active').dataset.format;
    const orientationSuffix = document.getElementById('tiledOrientLandscape').classList.contains('active') ? '_L' : '_P';
    doc.save(`Tiled_${formatKey}${orientationSuffix}.pdf`);
  } catch (e) {
    alert('Error: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Сохранить PDF';
  }
}

// Handler for Direct Print
async function handleTiledPrint() {
  const btn = $('tiledPrintDirectBtn');
  if (!btn) return;
  btn.disabled = true;
  btn.textContent = '...';

  try {
    const doc = await createTiledPdfDoc();
    const blob = doc.output('blob');
    const url = URL.createObjectURL(blob);

    // Open in new window for printing
    const win = window.open(url, '_blank');
    if (!win) {
      alert('Разрешите всплывающие окна для печати');
    }
    // Note: Auto-triggering print() on a raw PDF blob url is not consistently supported.
    // The user will see the browser's PDF viewer and can hit Print there.
    // Alternatively, we could use an iframe, but window.open is more robust for PDFs.

  } catch (e) {
    alert('Error: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '🖨️ Печать';
  }
}

// --- Clear Page Logic ---
function showClearPageConfirm() {
  if (selectedLine || selectedText) {
    if (selectedLine) deleteSelectedLine();
    if (selectedText) deleteSelectedText();
    return;
  }

  const lines = getLines();
  const texts = getPageTexts();
  const hasContent = (lines && lines.length > 0) || (texts && texts.length > 0);

  if (!hasContent) {
    // Страница пуста - тихо игнорируем
    return;
  }
  isClearingPage = true;
  deleteTargetId = null;
  const tTitle = $('deleteModalTitle');
  if (tTitle) tTitle.textContent = '🗑️ Очистить страницу?';
  deleteModalText.innerHTML = `Вы уверены, что хотите удалить всё <b>с этой страницы</b>?<br><span style="font-size:14px; opacity:0.7">Это не затронет другие страницы проекта.</span>`;
  openModal(deleteModal);
}

/* ===== MEASUREMENTS DROPDOWN (TRUE MORPH) ===== */
function openMeasurementsList() {
  const counterBtn = document.getElementById('counter');

  const existingOverlay = document.getElementById('measurementsOverlay');
  if (existingOverlay) {
    closeMeasurementsList(existingOverlay, counterBtn);
    return;
  }

  // 1. Capture Exact Button State
  const rect = counterBtn.getBoundingClientRect();
  const computed = window.getComputedStyle(counterBtn);

  // 2. Create Overlay
  const overlay = document.createElement('div');
  overlay.id = 'measurementsOverlay';
  overlay.className = 'measurements-overlay';

  // 3. Set Initial Styles to EXACTLY Clone Button
  // We apply these via inline styles to override any CSS class defaults
  overlay.style.position = 'fixed';
  overlay.style.top = rect.top + 'px';
  overlay.style.left = rect.left + 'px';
  overlay.style.width = rect.width + 'px';
  overlay.style.height = rect.height + 'px';

  // Visual Clone
  // Clones gradients/colors
  // Note: backgroundColor is usually rgba(0,0,0,0) if gradient is used, so we check.
  // We prioritize background property as it contains everything.
  overlay.style.background = computed.background;
  overlay.style.backgroundColor = computed.backgroundColor; // Ensure color is picked up

  overlay.style.border = computed.border;
  overlay.style.borderRadius = computed.borderRadius;
  overlay.style.boxShadow = computed.boxShadow;
  overlay.style.backdropFilter = computed.backdropFilter;
  overlay.style.webkitBackdropFilter = computed.webkitBackdropFilter;
  overlay.style.zIndex = '9999';
  overlay.style.overflow = 'hidden';
  overlay.style.display = 'flex';
  overlay.style.flexDirection = 'column';
  overlay.style.transition = 'all 0.3s cubic-bezier(0.2, 0, 0.2, 1)'; // Smooth easing
  overlay.style.color = computed.color;
  overlay.style.fontFamily = computed.fontFamily;
  overlay.style.fontSize = computed.fontSize;
  overlay.style.fontWeight = computed.fontWeight;

  // Save initial styles for closing
  overlay.dataset.initialBorderRadius = computed.borderRadius;
  overlay.dataset.initialHeight = rect.height + 'px';
  overlay.dataset.initialBackground = computed.background;
  overlay.dataset.initialBackgroundColor = computed.backgroundColor;

  // Content
  const lines = getLines();
  const totalLen = formatLength(getLinesTotalLength());

  // Use a simpler header structure that matches the button's internal structure
  // The button usually just has text "Total: X m"
  overlay.innerHTML = `
    <div class="overlay-header" style="height: ${rect.height}px; display: flex; align-items: center; justify-content: center; width: 100%; position: relative; flex-shrink: 0;">
      <!-- Mimic original button content: just the total length text -->
      <span style="pointer-events: none;">${totalLen}</span>
      <!-- Close button (hidden initially) -->
      <button class="close-overlay-btn" style="position: absolute; right: 2px; top: 0; bottom: 0; width: 24px; background: none; border: none; color: inherit; font-size: 16px; opacity: 0; cursor: pointer; display: flex; align-items: center; justify-content: center;">&times;</button>
    </div>
    
    <div class="overlay-list-wrapper" style="opacity: 0; flex: 1; overflow: hidden; display: flex; flex-direction: column;">
      <div id="measurementsListContainer" class="overlay-list" style="flex: 1; overflow-y: auto; padding: 4px;">
        <!-- Items -->
      </div>
      <div style="padding: 6px; border-top: 1px solid rgba(255,255,255,0.1);">
        <button id="exportMeasurementsBtn" style="width: 100%; padding: 6px; background: rgba(255,255,255,0.1); border: none; border-radius: 4px; color: inherit; cursor: pointer; font-size: 11px;">💾 Скачать</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // 4 Populate List
  const container = overlay.querySelector('#measurementsListContainer');
  let vCount = 0;
  lines.forEach(line => {
    if (!line.points || line.points.length < 2) return;
    vCount++;
    const units = getUnitsPerMM();
    let len = 0;
    for (let i = 0; i < line.points.length - 1; i++) len += distance(line.points[i], line.points[i + 1]);
    const val = formatLength(len / units);

    const el = document.createElement('div');
    el.style.cssText = 'display:flex; justify-content:space-between; padding:4px 8px; font-size:11px; cursor:pointer; margin-bottom:1px; border-radius:4px; transition: background 0.1s;';
    el.innerHTML = `<span style="opacity:0.6; margin-right:4px;">#${vCount}</span><span>${val}</span>`;

    if (line === selectedLine) el.style.background = 'rgba(124, 92, 255, 0.2)';

    el.onmouseenter = () => { if (line !== selectedLine) el.style.background = 'rgba(255,255,255,0.05)'; };
    el.onmouseleave = () => { if (line !== selectedLine) el.style.background = 'transparent'; };

    el.onclick = (e) => {
      e.stopPropagation();
      selectedLine = line;
      scheduleDraw();
      // refresh styles
      Array.from(container.children).forEach(c => c.style.background = 'transparent');
      el.style.background = 'rgba(124, 92, 255, 0.2)';
    };
    container.appendChild(el);
  });
  if (vCount === 0) container.innerHTML = '<div style="text-align:center; padding:10px; opacity:0.5; font-size:11px">Пусто</div>';

  overlay.querySelector('#exportMeasurementsBtn').onclick = downloadMeasurements;

  // 5. Switch (Hide real button, show overlay which is identical)
  counterBtn.style.opacity = '0';

  // 6. Animate Expansion
  requestAnimationFrame(() => {
    // Expand Height
    const estimatedHeight = Math.min(rect.height + (vCount * 25) + 40, 400); // 25px per item + 40px footer
    overlay.style.height = Math.max(estimatedHeight, rect.height) + 'px';

    // Slight Radius adjustment if needed (to look like a list)
    overlay.style.borderRadius = '12px';

    // Show content
    const wrapper = overlay.querySelector('.overlay-list-wrapper');
    wrapper.style.opacity = '1';
    wrapper.style.transition = 'opacity 0.2s 0.1s';

    // Show Close Button
    const closeBtn = overlay.querySelector('.close-overlay-btn');
    closeBtn.style.opacity = '0.7';
    closeBtn.style.transition = 'opacity 0.2s';
    closeBtn.onclick = (e) => { e.stopPropagation(); closeMeasurementsList(overlay, counterBtn); };
  });

  // Close outside
  setTimeout(() => {
    const clickOut = (e) => {
      if (!overlay.parentElement) return;
      if (!overlay.contains(e.target)) {
        closeMeasurementsList(overlay, counterBtn);
        document.removeEventListener('click', clickOut);
      }
    };
    document.addEventListener('click', clickOut);
  }, 100);
}

function closeMeasurementsList(overlay, counterBtn) {
  if (!counterBtn) counterBtn = document.getElementById('counter');

  // Revert Styles
  overlay.style.height = overlay.dataset.initialHeight;
  overlay.style.borderRadius = overlay.dataset.initialBorderRadius;

  // Hide internals
  const wrapper = overlay.querySelector('.overlay-list-wrapper');
  if (wrapper) wrapper.style.opacity = '0';
  const closeBtn = overlay.querySelector('.close-overlay-btn');
  if (closeBtn) closeBtn.style.opacity = '0';

  setTimeout(() => {
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    if (counterBtn) counterBtn.style.opacity = '1';
  }, 300);
}

function getLinesTotalLength() {
  const lines = getLines();
  const units = getUnitsPerMM();
  let total = 0;
  if (!units) return 0;
  for (const line of lines) {
    if (line.points.length >= 2) {
      for (let i = 0; i < line.points.length - 1; i++) total += distance(line.points[i], line.points[i + 1]);
    }
  }
  return total / units;
}
/* END TRUE MORPH */
/* ===== MEASUREMENTS DROPDOWN (TRUE MORPH) ===== */
function openMeasurementsList() {
  const counterBtn = document.getElementById('counter');

  const existingOverlay = document.getElementById('measurementsOverlay');
  if (existingOverlay) {
    closeMeasurementsList(existingOverlay, counterBtn);
    return;
  }

  // 1. Capture Exact Button State
  const rect = counterBtn.getBoundingClientRect();
  const computed = window.getComputedStyle(counterBtn);

  // 2. Create Overlay
  const overlay = document.createElement('div');
  overlay.id = 'measurementsOverlay';
  overlay.className = 'measurements-overlay';

  // 3. Set Initial Styles to EXACTLY Clone Button
  // We apply these via inline styles to override any CSS class defaults
  overlay.style.position = 'fixed';
  overlay.style.top = rect.top + 'px';
  overlay.style.left = rect.left + 'px';
  overlay.style.width = rect.width + 'px';
  overlay.style.height = rect.height + 'px';

  // Visual Clone
  // Clones gradients/colors
  // Note: backgroundColor is usually rgba(0,0,0,0) if gradient is used, so we check.
  // We prioritize background property as it contains everything.
  overlay.style.background = computed.background;
  overlay.style.backgroundColor = computed.backgroundColor; // Ensure color is picked up

  overlay.style.border = computed.border;
  overlay.style.borderRadius = computed.borderRadius;
  overlay.style.boxShadow = computed.boxShadow;
  overlay.style.backdropFilter = computed.backdropFilter;
  overlay.style.webkitBackdropFilter = computed.webkitBackdropFilter;
  overlay.style.zIndex = '9999';
  overlay.style.overflow = 'hidden';
  overlay.style.display = 'flex';
  overlay.style.flexDirection = 'column';
  overlay.style.transition = 'all 0.3s cubic-bezier(0.2, 0, 0.2, 1)'; // Smooth easing
  overlay.style.color = computed.color;
  overlay.style.fontFamily = computed.fontFamily;
  overlay.style.fontSize = computed.fontSize;
  overlay.style.fontWeight = computed.fontWeight;

  // Save initial styles for closing
  overlay.dataset.initialBorderRadius = computed.borderRadius;
  overlay.dataset.initialHeight = rect.height + 'px';

  // Content
  const lines = getLines();
  const totalLen = formatLength(getLinesTotalLength());

  // Use a simpler header structure that matches the button's internal structure
  // The button usually just has text "Total: X m"
  overlay.innerHTML = `
    <div class="overlay-header" style="height: ${rect.height}px; display: flex; align-items: center; justify-content: center; width: 100%; position: relative; flex-shrink: 0;">
      <!-- Mimic original button content: just the total length text -->
      <span style="pointer-events: none;">${totalLen}</span>
      <!-- Close button (hidden initially) -->
      <button class="close-overlay-btn" style="position: absolute; right: 2px; top: 0; bottom: 0; width: 24px; background: none; border: none; color: inherit; font-size: 16px; opacity: 0; cursor: pointer; display: flex; align-items: center; justify-content: center;">&times;</button>
    </div>
    
    <div class="overlay-list-wrapper" style="opacity: 0; flex: 1; overflow: hidden; display: flex; flex-direction: column;">
      <div id="measurementsListContainer" class="overlay-list" style="flex: 1; overflow-y: auto; padding: 4px;">
        <!-- Items -->
      </div>
      <div style="padding: 6px; border-top: 1px solid rgba(255,255,255,0.1);">
        <button id="exportMeasurementsBtn" style="width: 100%; padding: 6px; background: rgba(255,255,255,0.1); border: none; border-radius: 4px; color: inherit; cursor: pointer; font-size: 11px;">💾 Скачать</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // 4 Populate List
  const container = overlay.querySelector('#measurementsListContainer');
  let vCount = 0;
  lines.forEach(line => {
    if (!line.points || line.points.length < 2) return;
    vCount++;
    const units = getUnitsPerMM();
    let len = 0;
    for (let i = 0; i < line.points.length - 1; i++) len += distance(line.points[i], line.points[i + 1]);
    const val = formatLength(len / units);

    const el = document.createElement('div');
    el.style.cssText = 'display:flex; justify-content:space-between; padding:4px 8px; font-size:11px; cursor:pointer; margin-bottom:1px; border-radius:4px; transition: background 0.1s;';
    el.innerHTML = `<span style="opacity:0.6; margin-right:4px;">#${vCount}</span><span>${val}</span>`;

    if (line === selectedLine) el.style.background = 'rgba(124, 92, 255, 0.2)';

    el.onmouseenter = () => { if (line !== selectedLine) el.style.background = 'rgba(255,255,255,0.05)'; };
    el.onmouseleave = () => { if (line !== selectedLine) el.style.background = 'transparent'; };

    el.onclick = (e) => {
      e.stopPropagation();
      selectedLine = line;
      scheduleDraw();
      // refresh styles
      Array.from(container.children).forEach(c => c.style.background = 'transparent');
      el.style.background = 'rgba(124, 92, 255, 0.2)';
    };
    container.appendChild(el);
  });
  if (vCount === 0) container.innerHTML = '<div style="text-align:center; padding:10px; opacity:0.5; font-size:11px">Пусто</div>';

  overlay.querySelector('#exportMeasurementsBtn').onclick = downloadMeasurements;

  // 5. Switch (Hide real button, show overlay which is identical)
  counterBtn.style.opacity = '0';

  // 6. Animate Expansion
  requestAnimationFrame(() => {
    // Expand Height
    const estimatedHeight = Math.min(rect.height + (vCount * 25) + 40, 400); // 25px per item + 40px footer
    overlay.style.height = Math.max(estimatedHeight, rect.height) + 'px';

    // Slight Radius adjustment if needed (to look like a list)
    overlay.style.borderRadius = '12px';

    // Solid background for readability
    overlay.style.background = '#0f1b33';
    overlay.style.backgroundColor = '#0f1b33';

    // Show content
    const wrapper = overlay.querySelector('.overlay-list-wrapper');
    wrapper.style.opacity = '1';
    wrapper.style.transition = 'opacity 0.2s 0.1s';

    // Show Close Button
    const closeBtn = overlay.querySelector('.close-overlay-btn');
    closeBtn.style.opacity = '0.7';
    closeBtn.style.transition = 'opacity 0.2s';
    closeBtn.onclick = (e) => { e.stopPropagation(); closeMeasurementsList(overlay, counterBtn); };
  });

  // Close outside
  setTimeout(() => {
    const clickOut = (e) => {
      if (!overlay.parentElement) return;
      if (!overlay.contains(e.target)) {
        closeMeasurementsList(overlay, counterBtn);
        document.removeEventListener('click', clickOut);
      }
    };
    document.addEventListener('click', clickOut);
  }, 100);
}

function closeMeasurementsList(overlay, counterBtn) {
  if (!counterBtn) counterBtn = document.getElementById('counter');

  // Revert Styles
  overlay.style.height = overlay.dataset.initialHeight;
  overlay.style.borderRadius = overlay.dataset.initialBorderRadius;
  if (overlay.dataset.initialBackground) overlay.style.background = overlay.dataset.initialBackground;
  if (overlay.dataset.initialBackgroundColor) overlay.style.backgroundColor = overlay.dataset.initialBackgroundColor;

  // Hide internals
  const wrapper = overlay.querySelector('.overlay-list-wrapper');
  if (wrapper) wrapper.style.opacity = '0';
  const closeBtn = overlay.querySelector('.close-overlay-btn');
  if (closeBtn) closeBtn.style.opacity = '0';

  setTimeout(() => {
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    if (counterBtn) counterBtn.style.opacity = '1';
  }, 300);
}

function getLinesTotalLength() {
  const lines = getLines();
  const units = getUnitsPerMM();
  let total = 0;
  if (!units) return 0;
  for (const line of lines) {
    if (line.points.length >= 2) {
      for (let i = 0; i < line.points.length - 1; i++) total += distance(line.points[i], line.points[i + 1]);
    }
  }
  return total / units;
}

function downloadMeasurements() {
  const lines = getLines();
  const units = getUnitsPerMM();

  if (!lines.length || !units) {
    alert('Нет данных для сохранения');
    return;
  }

  let content = `Отчет по замерам\nПроект: ${currentProject.name || 'Без названия'}\nДата: ${new Date().toLocaleString()}\n\n`;
  content += `------------------------\n`;

  let total = 0;
  let count = 0;

  lines.forEach((line) => {
    if (!line.points || line.points.length < 2) return;
    count++;

    let len = 0;
    for (let i = 0; i < line.points.length - 1; i++) {
      len += distance(line.points[i], line.points[i + 1]);
    }
    const realLen = len / units;
    total += realLen;

    content += `Линия #${count}: ${formatLength(realLen)} \n`;
  });

  content += `------------------------\n`;
  content += `ВСЕГО линий: ${count}\n`;
  content += `ОБЩАЯ ДЛИНА: ${formatLength(total)}\n`;

  // Trigger Download
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `measurements_${Date.now()}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}


/* ===== CONTACT POPUP ===== */
function showContactPopup() {
  // Удаляем существующий попап если есть
  const existing = document.getElementById('contactPopup');
  if (existing) {
    existing.remove();
    return;
  }

  const popup = document.createElement('div');
  popup.id = 'contactPopup';
  popup.style.cssText = `
    position: fixed;
    top: 70px;
    left: 50%;
    transform: translateX(-50%);
    background: linear-gradient(135deg, #1a1a2e 0%, #0f1b33 100%);
    border: 1px solid rgba(124, 92, 255, 0.5);
    border-radius: 16px;
    padding: 24px 32px;
    box-shadow: 0 20px 60px rgba(0,0,0,0.5), 0 0 40px rgba(124, 92, 255, 0.2);
    z-index: 10000;
    color: #fff;
    font-family: inherit;
    min-width: 320px;
    max-width: 90vw;
    animation: popupFadeIn 0.3s ease;
  `;

  popup.innerHTML = `
    <style>
      @keyframes popupFadeIn {
        from { opacity: 0; transform: translateX(-50%) translateY(-20px); }
        to { opacity: 1; transform: translateX(-50%) translateY(0); }
      }
      #contactPopup a {
        color: #a78bfa;
        text-decoration: none;
        transition: all 0.2s;
      }
      #contactPopup a:hover {
        color: #c4b5fd;
        text-shadow: 0 0 10px rgba(167, 139, 250, 0.5);
      }
      .popup-close-btn {
        position: absolute;
        top: 12px;
        right: 16px;
        background: none;
        border: none;
        color: rgba(255,255,255,0.5);
        font-size: 24px;
        cursor: pointer;
        transition: all 0.2s;
      }
      .popup-close-btn:hover {
        color: #fff;
        transform: scale(1.1);
      }
      .max-link-btn {
        display: flex;
        align-items: center;
        gap: 12px;
        background: linear-gradient(135deg, rgba(124, 92, 255, 0.3), rgba(124, 92, 255, 0.1));
        border: 1px solid rgba(124, 92, 255, 0.5);
        border-radius: 12px;
        padding: 14px 20px;
        color: #fff;
        font-size: 15px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.3s;
        text-decoration: none;
        margin-top: 16px;
        width: 100%;
        box-sizing: border-box;
      }
      .max-link-btn:hover {
        background: linear-gradient(135deg, rgba(124, 92, 255, 0.5), rgba(124, 92, 255, 0.2));
        box-shadow: 0 0 25px rgba(124, 92, 255, 0.4);
        transform: scale(1.02);
      }
    </style>
    
    <button class="popup-close-btn" onclick="this.parentElement.remove()">&times;</button>
    
    <div style="display: flex; align-items: center; gap: 16px; margin-bottom: 16px;">
      <svg viewBox="0 0 24 24" fill="none" stroke="#7c5cff" stroke-width="2.5" style="width: 48px; height: 48px; filter: drop-shadow(0 0 15px rgba(124, 92, 255, 0.8));">
        <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke-linecap="round" stroke-linejoin="round" fill="rgba(124, 92, 255, 0.3)" />
      </svg>
      <div>
        <div style="font-size: 24px; font-weight: 700; background: linear-gradient(135deg, #fff, #a78bfa); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">Эмиль PDF</div>
        <div style="font-size: 13px; opacity: 0.7;">Помощь в строительстве</div>
      </div>
    </div>
    
    <div style="font-size: 14px; line-height: 1.6; margin-bottom: 8px; opacity: 0.9;">
      ✨ Спасибо, что пользуетесь!<br>
      Если есть вопросы или предложения — пишите:
    </div>
    
    <a href="https://max.ru/u/f9LHodD0cOL-Kr8zZ_55wOPp1WfYfVCh-bXnli5Dhg0sLCZIkMO8cjO18y8" 
       target="_blank" 
       class="max-link-btn">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 24px; height: 24px;">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
      </svg>
      <span>Написать в MAX</span>
    </a>
    
    <div style="font-size: 12px; opacity: 0.5; margin-top: 16px; text-align: center;">
      Я пользуюсь мессенджером MAX. Присоединяйтесь!
    </div>
  `;

  document.body.appendChild(popup);

  // Закрытие при клике вне попапа
  setTimeout(() => {
    const closeHandler = (e) => {
      if (!popup.contains(e.target) && e.target.id !== 'logoBtn' && !e.target.closest('#logoBtn')) {
        popup.remove();
        document.removeEventListener('click', closeHandler);
      }
    };
    document.addEventListener('click', closeHandler);
  }, 100);
}

// NOTE: Initialization is at line ~244 in the DOMContentLoaded handler that calls setupEvents()

