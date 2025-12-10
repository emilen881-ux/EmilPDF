// Настройка PDF.js
pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.10.377/pdf.worker.min.js";

const fileInput = document.getElementById("fileInput");
const fileInputEmpty = document.getElementById("fileInputEmpty");
const canvas = document.getElementById("pdfCanvas");
const ctx = canvas.getContext("2d", { 
  alpha: false,
  willReadFrequently: false
});

const cropBtn = document.getElementById("cropBtn");
const printAreaBtn = document.getElementById("printAreaBtn");
const extractPagesBtn = document.getElementById("extractPagesBtn");
const posterBtn = document.getElementById("posterBtn");
const clearSelectionBtn = document.getElementById("clearSelectionBtn");
const prevPageBtn = document.getElementById("prevPage");
const nextPageBtn = document.getElementById("nextPage");
const pageInfo = document.getElementById("pageInfo");
const zoomInBtn = document.getElementById("zoomIn");
const zoomOutBtn = document.getElementById("zoomOut");

const emptyState = document.getElementById("emptyState");
const canvasContainer = document.getElementById("canvasContainer");
const canvasWrapper = document.getElementById("canvasWrapper");
const selectionRect = document.getElementById("selectionRect");

const pageNavStrip = document.getElementById("pageNavStrip");
const pageNavTrack = document.getElementById("pageNavTrack");

const minimap = document.getElementById("minimap");
const minimapCanvas = document.getElementById("minimapCanvas");
const minimapCtx = minimapCanvas.getContext("2d", { alpha: false });
const minimapViewport = document.getElementById("minimapViewport");

// Модал вырезания страниц
const modalOverlay = document.getElementById("modalOverlay");
const modalGrid = document.getElementById("modalGrid");
const modalClose = document.getElementById("modalClose");
const selectAllBtn = document.getElementById("selectAllBtn");
const deselectAllBtn = document.getElementById("deselectAllBtn");
const cancelBtn = document.getElementById("cancelBtn");
const saveExtractBtn = document.getElementById("saveExtractBtn");
const selectedCount = document.getElementById("selectedCount");

// Модал больших форматов
const posterModal = document.getElementById("posterModal");
const posterModalClose = document.getElementById("posterModalClose");
const posterCancelBtn = document.getElementById("posterCancelBtn");
const posterPrintBtn = document.getElementById("posterPrintBtn");
const posterGenerateBtn = document.getElementById("posterGenerateBtn");
const posterPaperSize = document.getElementById("posterPaperSize");
const posterOrientation = document.getElementById("posterOrientation");
const posterScale = document.getElementById("posterScale");
const posterScaleValue = document.getElementById("posterScaleValue");
const posterSheetCount = document.getElementById("posterSheetCount");
const posterGridPreview = document.getElementById("posterGridPreview");
const posterSourceInfo = document.getElementById("posterSourceInfo");
const posterFormatLabel = document.getElementById("posterFormatLabel");

const loadingOverlay = document.getElementById("loadingOverlay");
const loadingProgress = document.getElementById("loadingProgress");
const loadingText = document.getElementById("loadingText");
const logoFill = document.getElementById("logoFill");

let pdfDoc = null;
let currentPage = 1;
let scale = 1.2;
let uploadedFileName = "document";
let selectedPages = new Set();
let pdfDocBytes = null;

const DPR = Math.min(window.devicePixelRatio || 1, 2);

let renderTask = null;
let navHideTimer = null;
let minimapHideTimer = null;
let isNavigating = false;

// состояние выделения
let isPointerDown = false;
let longPressTimer = null;
let selectionMode = false;
let selection = null;
let resizeHandle = null;
let startPointer = null;

// Подпись страницы при прокрутке
let pageNumberOverlay = null;

fileInput.addEventListener("change", handleFile);
fileInputEmpty.addEventListener("change", handleFile);
cropBtn.addEventListener("click", exportSelectionAsPDF);
printAreaBtn.addEventListener("click", printSelectedArea);
extractPagesBtn.addEventListener("click", openPageExtractModal);
posterBtn.addEventListener("click", openPosterModal);
clearSelectionBtn.addEventListener("click", clearSelection);

prevPageBtn.addEventListener("click", () => {
  isNavigating = true;
  changePage(-1);
});

nextPageBtn.addEventListener("click", () => {
  isNavigating = true;
  changePage(1);
});

zoomInBtn.addEventListener("click", () => changeZoom(1.2));
zoomOutBtn.addEventListener("click", () => changeZoom(1/1.2));

canvasContainer.addEventListener("pointerdown", onPointerDown);
canvasContainer.addEventListener("pointermove", onPointerMove);
canvasContainer.addEventListener("pointerup", onPointerUp);
canvasContainer.addEventListener("pointercancel", onPointerUp);
canvasContainer.addEventListener("contextmenu", (e) => e.preventDefault());

canvasContainer.addEventListener("scroll", () => {
  updateMinimapViewport();
});

canvasContainer.addEventListener("wheel", (e) => {
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    changeZoom(factor);
  }
});

// Модал вырезания страниц
modalClose.addEventListener("click", closePageExtractModal);
cancelBtn.addEventListener("click", closePageExtractModal);
selectAllBtn.addEventListener("click", selectAllPages);
deselectAllBtn.addEventListener("click", deselectAllPages);
saveExtractBtn.addEventListener("click", saveExtractedPages);

// Модал больших форматов
posterModalClose.addEventListener("click", closePosterModal);
posterCancelBtn.addEventListener("click", closePosterModal);
posterPrintBtn.addEventListener("click", printPoster);
posterGenerateBtn.addEventListener("click", generatePosterPDF);
posterScale.addEventListener("input", updatePosterPreview);
posterPaperSize.addEventListener("change", updatePosterPreview);
posterOrientation.addEventListener("change", updatePosterPreview);

// Клик по меткам масштаба
document.addEventListener("click", (e) => {
  if (e.target.classList.contains("poster-mark")) {
    const scale = parseInt(e.target.dataset.scale);
    posterScale.value = scale;
    updatePosterPreview();
  }
});

minimap.addEventListener("mouseenter", () => {
  if (minimapHideTimer) clearTimeout(minimapHideTimer);
});

minimap.addEventListener("mouseleave", () => {
  minimapHideTimer = setTimeout(() => {
    minimap.classList.remove("visible");
  }, 1500);
});

document.addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT") return;
  if (e.key === "ArrowLeft") {
    isNavigating = true;
    changePage(-1);
  }
  if (e.key === "ArrowRight") {
    isNavigating = true;
    changePage(1);
  }
  if (e.key === "Escape") {
    if (modalOverlay.classList.contains("active")) {
      closePageExtractModal();
    }
    if (posterModal.classList.contains("active")) {
      closePosterModal();
    }
  }
});

async function handleFile(e) {
  const file = e.target.files[0];
  if (!file) return;

  uploadedFileName = file.name.replace(/\.pdf$/i, "") || "document";
  pdfDocBytes = await file.arrayBuffer();

  showLoading();
  updateProgress(0, "Чтение файла...");

  const reader = new FileReader();
  
  reader.onprogress = (ev) => {
    if (ev.lengthComputable) {
      const percent = Math.floor((ev.loaded / ev.total) * 30);
      updateProgress(percent, "Чтение файла...");
    }
  };
  
  reader.onerror = () => {
    hideLoading();
    alert("Ошибка чтения файла");
  };
  
  reader.onload = async function () {
    try {
      updateProgress(30, "Загрузка PDF...");
      
      const arrayBuffer = reader.result;
      const uint8 = new Uint8Array(arrayBuffer);

      const loadingTask = pdfjsLib.getDocument({ 
        data: uint8,
        useWorkerFetch: false,
        isEvalSupported: false,
        cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@2.10.377/cmaps/',
        cMapPacked: true
      });
      
      loadingTask.onProgress = (progress) => {
        if (progress.total > 0) {
          const percent = 30 + Math.floor((progress.loaded / progress.total) * 30);
          updateProgress(percent, "Обработка PDF...");
        }
      };
      
      pdfDoc = await loadingTask.promise;
      
      updateProgress(70, "Рендер страницы...");
      
      currentPage = 1;
      scale = 1.2;

      emptyState.style.display = "none";
      canvasContainer.style.display = "block";

      await renderPage();
      centerCanvas();
      
      if (pdfDoc.numPages > 1) {
        updateProgress(85, "Создание миниатюр...");
        await generatePageNav();
      }
      
      updateProgress(100, "Готово!");
      
      cropBtn.disabled = false;
      printAreaBtn.disabled = false;
      extractPagesBtn.disabled = false;
      posterBtn.disabled = false;
      prevPageBtn.disabled = false;
      nextPageBtn.disabled = false;
      zoomInBtn.disabled = false;
      zoomOutBtn.disabled = false;
      
      updatePageControls();
      
      setTimeout(() => {
        hideLoading();
      }, 400);
      
    } catch (err) {
      console.error("Ошибка загрузки PDF:", err);
      hideLoading();
      alert("Не удалось загрузить PDF: " + err.message);
    }
  };
  
  reader.readAsArrayBuffer(file);
}

function showLoading() {
  loadingOverlay.classList.add("active");
  logoFill.classList.add("loading");
}

function hideLoading() {
  loadingOverlay.classList.remove("active");
  logoFill.classList.remove("loading");
  logoFill.style.width = "0%";
}

function updateProgress(percent, text) {
  loadingProgress.style.width = percent + "%";
  logoFill.style.width = percent + "%";
  loadingText.textContent = text;
}

async function renderPage() {
  if (!pdfDoc) return;
  
  if (renderTask) {
    try {
      renderTask.cancel();
    } catch (e) {
      // ignore
    }
  }
  
  const page = await pdfDoc.getPage(currentPage);
  const viewport = page.getViewport({ scale: scale * DPR });
  
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  
  canvas.style.width = Math.floor(viewport.width / DPR) + "px";
  canvas.style.height = Math.floor(viewport.height / DPR) + "px";

  const renderContext = {
    canvasContext: ctx,
    viewport,
    intent: "display"
  };

  renderTask = page.render(renderContext);
  
  try {
    await renderTask.promise;
    renderTask = null;
  } catch (err) {
    if (err.name !== 'RenderingCancelledException') {
      console.error('Render error:', err);
    }
    return;
  }
  
  resetSelection();
  updatePageControls();
  updateMinimap();
  
  if (isNavigating && pdfDoc.numPages > 1) {
    highlightActiveNav();
    showNavStrip();
    isNavigating = false;
  }
}

function centerCanvas() {
  const scrollLeft = (canvasWrapper.scrollWidth - canvasContainer.clientWidth) / 2;
  const scrollTop = (canvasWrapper.scrollHeight - canvasContainer.clientHeight) / 2;
  canvasContainer.scrollLeft = scrollLeft;
  canvasContainer.scrollTop = scrollTop;
}

function updatePageControls() {
  if (!pdfDoc) {
    pageInfo.textContent = "0 / 0";
    prevPageBtn.disabled = true;
    nextPageBtn.disabled = true;
    return;
  }
  pageInfo.textContent = `${currentPage} / ${pdfDoc.numPages}`;
  prevPageBtn.disabled = currentPage <= 1;
  nextPageBtn.disabled = currentPage >= pdfDoc.numPages;
}

function changePage(delta) {
  if (!pdfDoc) return;
  const newPage = currentPage + delta;
  if (newPage < 1 || newPage > pdfDoc.numPages) return;
  currentPage = newPage;
  renderPage();
  showPageNumberOverlay();
}

function changeZoom(factor) {
  if (!pdfDoc) return;
  
  const oldScale = scale;
  scale *= factor;
  if (scale < 0.5) scale = 0.5;
  if (scale > 4) scale = 4;
  
  const scaleDiff = scale / oldScale;
  
  isNavigating = false;
  renderPage().then(() => {
    const newScrollLeft = canvasContainer.scrollLeft * scaleDiff + (canvasContainer.clientWidth / 2) * (scaleDiff - 1);
    const newScrollTop = canvasContainer.scrollTop * scaleDiff + (canvasContainer.clientHeight / 2) * (scaleDiff - 1);
    
    canvasContainer.scrollLeft = newScrollLeft;
    canvasContainer.scrollTop = newScrollTop;
  });
}

function showPageNumberOverlay() {
  if (!pdfDoc) return;
  
  if (!pageNumberOverlay) {
    pageNumberOverlay = document.createElement("div");
    pageNumberOverlay.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: rgba(0, 0, 0, 0.8);
      color: #fff;
      font-size: 80px;
      font-weight: 700;
      padding: 40px 60px;
      border-radius: 16px;
      pointer-events: none;
      z-index: 99;
      backdrop-filter: blur(10px);
      border: 2px solid rgba(56, 189, 248, 0.5);
      box-shadow: 0 0 40px rgba(34, 197, 94, 0.3);
      opacity: 0;
      transition: opacity 0.3s ease;
    `;
    document.body.appendChild(pageNumberOverlay);
  }
  
  pageNumberOverlay.textContent = `Стр. ${currentPage}`;
  pageNumberOverlay.style.opacity = "1";
  
  if (pageNumberOverlay.hideTimer) {
    clearTimeout(pageNumberOverlay.hideTimer);
  }
  pageNumberOverlay.hideTimer = setTimeout(() => {
    pageNumberOverlay.style.opacity = "0";
  }, 1000);
}

function updateMinimap() {
  if (!pdfDoc) return;
  
  if (scale <= 1.5) {
    minimap.classList.remove("visible");
    return;
  }
  
  const minimapWidth = 200;
  const minimapHeight = Math.floor((canvas.height / canvas.width) * minimapWidth / DPR);
  
  minimapCanvas.width = minimapWidth;
  minimapCanvas.height = minimapHeight;
  minimapCanvas.style.width = minimapWidth + "px";
  minimapCanvas.style.height = minimapHeight + "px";
  
  minimapCtx.drawImage(canvas, 0, 0, minimapWidth, minimapHeight);
  
  showMinimapTemporarily();
  updateMinimapViewport();
}

function showMinimapTemporarily() {
  minimap.classList.add("visible");
  
  if (minimapHideTimer) clearTimeout(minimapHideTimer);
  
  minimapHideTimer = setTimeout(() => {
    minimap.classList.remove("visible");
  }, 2500);
}

function updateMinimapViewport() {
  if (!pdfDoc || scale <= 1.5) return;
  
  const canvasVisibleWidth = canvasContainer.clientWidth;
  const canvasVisibleHeight = canvasContainer.clientHeight;
  
  const canvasActualWidth = canvas.offsetWidth;
  const canvasActualHeight = canvas.offsetHeight;
  
  const minimapWidth = minimapCanvas.width;
  const minimapHeight = minimapCanvas.height;
  
  const scrollLeft = canvasContainer.scrollLeft;
  const scrollTop = canvasContainer.scrollTop;
  
  const paddingOffset = 200;
  const effectiveScrollLeft = Math.max(0, scrollLeft - paddingOffset);
  const effectiveScrollTop = Math.max(0, scrollTop - paddingOffset);
  
  const viewportX = (effectiveScrollLeft / canvasActualWidth) * minimapWidth;
  const viewportY = (effectiveScrollTop / canvasActualHeight) * minimapHeight;
  const viewportW = (canvasVisibleWidth / canvasActualWidth) * minimapWidth;
  const viewportH = (canvasVisibleHeight / canvasActualHeight) * minimapHeight;
  
  minimapViewport.style.left = (12 + viewportX) + "px";
  minimapViewport.style.top = (12 + viewportY) + "px";
  minimapViewport.style.width = Math.max(10, viewportW) + "px";
  minimapViewport.style.height = Math.max(10, viewportH) + "px";
  
  showMinimapTemporarily();
}

async function generatePageNav() {
  if (!pdfDoc || pdfDoc.numPages <= 1) return;
  
  pageNavTrack.innerHTML = "";
  const thumbScale = 0.2;
  
  for (let i = 1; i <= pdfDoc.numPages; i++) {
    const page = await pdfDoc.getPage(i);
    const viewport = page.getViewport({ scale: thumbScale });
    
    const thumbCanvas = document.createElement("canvas");
    thumbCanvas.width = viewport.width;
    thumbCanvas.height = viewport.height;
    const thumbCtx = thumbCanvas.getContext("2d", { alpha: false });
    
    await page.render({
      canvasContext: thumbCtx,
      viewport,
      intent: "print"
    }).promise;
    
    const navItem = document.createElement("div");
    navItem.className = "page-nav-item";
    navItem.dataset.page = i;
    
    thumbCanvas.style.width = viewport.width + "px";
    thumbCanvas.style.height = viewport.height + "px";
    
    const label = document.createElement("div");
    label.className = "page-nav-label";
    label.textContent = `${i}`;
    
    navItem.appendChild(thumbCanvas);
    navItem.appendChild(label);
    
    navItem.addEventListener("click", () => {
      currentPage = i;
      isNavigating = false;
      renderPage();
      showPageNumberOverlay();
    });
    
    pageNavTrack.appendChild(navItem);
    
    if (i % 5 === 0) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }
  
  highlightActiveNav();
}

function highlightActiveNav() {
  const items = pageNavTrack.querySelectorAll(".page-nav-item");
  items.forEach(item => {
    if (parseInt(item.dataset.page) === currentPage) {
      item.classList.add("active");
      item.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    } else {
      item.classList.remove("active");
    }
  });
}

function showNavStrip() {
  if (!pdfDoc || pdfDoc.numPages <= 1) return;
  
  pageNavStrip.classList.add("visible");
  
  if (navHideTimer) clearTimeout(navHideTimer);
  
  navHideTimer = setTimeout(() => {
    pageNavStrip.classList.remove("visible");
  }, 2500);
}

pageNavStrip.addEventListener("mouseenter", () => {
  if (navHideTimer) clearTimeout(navHideTimer);
});

pageNavStrip.addEventListener("mouseleave", () => {
  navHideTimer = setTimeout(() => {
    pageNavStrip.classList.remove("visible");
  }, 1000);
});

async function openPageExtractModal() {
  if (!pdfDoc) return;
  
  selectedPages.clear();
  modalGrid.innerHTML = "";
  
  showLoading();
  updateProgress(0, "Загрузка миниатюр...");
  
  const thumbScale = 0.3;
  
  for (let i = 1; i <= pdfDoc.numPages; i++) {
    try {
      const page = await pdfDoc.getPage(i);
      const viewport = page.getViewport({ scale: thumbScale });
      
      const thumbCanvas = document.createElement("canvas");
      thumbCanvas.width = viewport.width;
      thumbCanvas.height = viewport.height;
      const thumbCtx = thumbCanvas.getContext("2d", { alpha: false });
      
      await page.render({
        canvasContext: thumbCtx,
        viewport,
        intent: "print"
      }).promise;
      
      const gridItem = document.createElement("div");
      gridItem.className = "modal-grid-item";
      gridItem.dataset.page = i;
      
      thumbCanvas.style.width = "100%";
      thumbCanvas.style.height = "auto";
      
      const label = document.createElement("div");
      label.className = "modal-grid-item-label";
      label.textContent = `Стр. ${i}`;
      
      const checkbox = document.createElement("div");
      checkbox.className = "modal-grid-item-checkbox";
      checkbox.textContent = "✓";
      
      gridItem.appendChild(thumbCanvas);
      gridItem.appendChild(label);
      gridItem.appendChild(checkbox);
      
      gridItem.addEventListener("click", () => {
        if (selectedPages.has(i)) {
          selectedPages.delete(i);
          gridItem.classList.remove("selected");
        } else {
          selectedPages.add(i);
          gridItem.classList.add("selected");
        }
        updateSelectedCount();
      });
      
      modalGrid.appendChild(gridItem);
      
      const progress = Math.floor((i / pdfDoc.numPages) * 100);
      updateProgress(progress, `Загрузка миниатюр: ${i}/${pdfDoc.numPages}`);
      
      if (i % 3 === 0) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    } catch (err) {
      console.error(`Ошибка загрузки страницы ${i}:`, err);
    }
  }
  
  hideLoading();
  updateSelectedCount();
  modalOverlay.classList.add("active");
}

function closePageExtractModal() {
  modalOverlay.classList.remove("active");
  selectedPages.clear();
}

function selectAllPages() {
  if (!pdfDoc) return;
  for (let i = 1; i <= pdfDoc.numPages; i++) {
    selectedPages.add(i);
  }
  updateGridSelection();
  updateSelectedCount();
}

function deselectAllPages() {
  selectedPages.clear();
  updateGridSelection();
  updateSelectedCount();
}

function updateGridSelection() {
  const items = modalGrid.querySelectorAll(".modal-grid-item");
  items.forEach(item => {
    const pageNum = parseInt(item.dataset.page);
    if (selectedPages.has(pageNum)) {
      item.classList.add("selected");
    } else {
      item.classList.remove("selected");
    }
  });
}

function updateSelectedCount() {
  selectedCount.textContent = `Выбрано: ${selectedPages.size}`;
}

async function saveExtractedPages() {
  if (selectedPages.size === 0) {
    alert("Выберите хотя бы одну страницу");
    return;
  }
  
  showLoading();
  updateProgress(0, "Создание PDF...");
  
  try {
    const jsPDFScript = document.createElement("script");
    jsPDFScript.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
    
    jsPDFScript.onload = async () => {
      const { jsPDF } = window.jspdf;
      
      const sortedPages = Array.from(selectedPages).sort((a, b) => a - b);
      
      let newPdf = null;
      let pageCount = 0;
      
      for (const pageNum of sortedPages) {
        try {
          updateProgress(Math.floor((pageCount / sortedPages.length) * 80) + 10, 
                         `Обработка страницы ${pageNum}...`);
          
          const page = await pdfDoc.getPage(pageNum);
          const viewport = page.getViewport({ scale: 2 });
          
          const tempCanvas = document.createElement("canvas");
          tempCanvas.width = viewport.width;
          tempCanvas.height = viewport.height;
          const tempCtx = tempCanvas.getContext("2d");
          
          await page.render({
            canvasContext: tempCtx,
            viewport
          }).promise;
          
          const imgData = tempCanvas.toDataURL("image/png");
          
          if (!newPdf) {
            const imgWidth = viewport.width;
            const imgHeight = viewport.height;
            const pdfWidth = imgWidth;
            const pdfHeight = imgHeight;
            
            newPdf = new jsPDF({
              orientation: imgWidth >= imgHeight ? "l" : "p",
              unit: "px",
              format: [pdfWidth, pdfHeight]
            });
            
            newPdf.addImage(imgData, "PNG", 0, 0, pdfWidth, pdfHeight);
          } else {
            const imgWidth = viewport.width;
            const imgHeight = viewport.height;
            
            newPdf.addPage([imgWidth, imgHeight]);
            newPdf.addImage(imgData, "PNG", 0, 0, imgWidth, imgHeight);
          }
          
          pageCount++;
          
        } catch (err) {
          console.error(`Ошибка обработки страницы ${pageNum}:`, err);
        }
      }
      
      if (newPdf) {
        updateProgress(90, "Сохранение...");
        
        const fileName = `${uploadedFileName}_extracted_${sortedPages.join('-')}.pdf`;
        newPdf.save(fileName);
        
        updateProgress(100, "Готово!");
        
        setTimeout(() => {
          hideLoading();
          closePageExtractModal();
        }, 500);
      } else {
        hideLoading();
        alert("Ошибка при создании PDF");
      }
    };
    
    jsPDFScript.onerror = () => {
      hideLoading();
      alert("Ошибка при загрузке jsPDF");
    };
    
    document.body.appendChild(jsPDFScript);
    
  } catch (err) {
    console.error("Ошибка:", err);
    hideLoading();
    alert("Ошибка при создании PDF: " + err.message);
  }
}

function openPosterModal() {
  if (!pdfDoc) return;
  posterSourceInfo.textContent = selection 
    ? "✂️ Будет напечатана выделенная область" 
    : "📄 Будет напечатана вся страница";
  updatePosterPreview();
  posterModal.classList.add("active");
}

function closePosterModal() {
  posterModal.classList.remove("active");
}

function updatePosterPreview() {
  const scalePercent = parseInt(posterScale.value);
  posterScaleValue.textContent = scalePercent + "%";
  
  const formatMap = [
    { scale: 100, label: "A4" },
    { scale: 141, label: "A3" },
    { scale: 200, label: "A2" },
    { scale: 283, label: "A1" },
    { scale: 400, label: "A0" }
  ];
  
  let currentFormat = "A4";
  let closestMark = null;
  let minDiff = Infinity;
  
  for (let i = 0; i < formatMap.length; i++) {
    const diff = Math.abs(scalePercent - formatMap[i].scale);
    if (diff < minDiff) {
      minDiff = diff;
      currentFormat = formatMap[i].label;
      closestMark = formatMap[i].scale;
    }
  }
  
  posterFormatLabel.textContent = `≈ ${currentFormat}`;
  
  const marks = document.querySelectorAll(".poster-mark");
  marks.forEach(mark => {
    const markScale = parseInt(mark.dataset.scale);
    if (markScale === closestMark) {
      mark.classList.add("active");
    } else {
      mark.classList.remove("active");
    }
  });
  
  const paperSizes = {
    a4: { width: 210, height: 297 },
    a3: { width: 297, height: 420 },
    letter: { width: 216, height: 279 }
  };
  
  const paper = paperSizes[posterPaperSize.value];
  const orientation = posterOrientation.value;
  
  const paperWidth = orientation === "portrait" ? paper.width : paper.height;
  const paperHeight = orientation === "portrait" ? paper.height : paper.width;
  
  const pageWidth = 210;
  const pageHeight = 297;
  
  const scaledWidth = (pageWidth * scalePercent) / 100;
  const scaledHeight = (pageHeight * scalePercent) / 100;
  
  const cols = Math.ceil(scaledWidth / paperWidth);
  const rows = Math.ceil(scaledHeight / paperHeight);
  const totalSheets = cols * rows;
  
  posterSheetCount.textContent = totalSheets;
  
  posterGridPreview.innerHTML = "";
  posterGridPreview.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
  
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const cell = document.createElement("div");
      cell.className = "poster-grid-cell";
      cell.textContent = `${row + 1}-${col + 1}`;
      posterGridPreview.appendChild(cell);
    }
  }
}

async function printPoster() {
  if (!pdfDoc) return;
  
  showLoading();
  updateProgress(0, "Подготовка к печати...");
  
  try {
    await generatePosterPDFForPrint(true);
  } catch (err) {
    console.error("Ошибка:", err);
    hideLoading();
    alert("Ошибка при подготовке печати: " + err.message);
  }
}

async function generatePosterPDF() {
  await generatePosterPDFForPrint(false);
}

async function generatePosterPDFForPrint(forPrint = false) {
  if (!pdfDoc) return;
  
  showLoading();
  updateProgress(0, forPrint ? "Подготовка к печати..." : "Создание PDF...");
  
  try {
    const jsPDFScript = document.createElement("script");
    jsPDFScript.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
    
    jsPDFScript.onload = async () => {
      const { jsPDF } = window.jspdf;
      
      const scalePercent = parseInt(posterScale.value);
      
      const paperSizes = {
        a4: { width: 210, height: 297 },
        a3: { width: 297, height: 420 },
        letter: { width: 216, height: 279 }
      };
      
      const paper = paperSizes[posterPaperSize.value];
      const orientation = posterOrientation.value;
      
      const paperWidth = orientation === "portrait" ? paper.width : paper.height;
      const paperHeight = orientation === "portrait" ? paper.height : paper.width;
      
      let sourceCanvas;
      if (selection) {
        sourceCanvas = document.createElement("canvas");
        sourceCanvas.width = selection.w;
        sourceCanvas.height = selection.h;
        const sourceCtx = sourceCanvas.getContext("2d");
        
        const imageData = ctx.getImageData(
          selection.x,
          selection.y,
          selection.w,
          selection.h
        );
        sourceCtx.putImageData(imageData, 0, 0);
      } else {
        const page = await pdfDoc.getPage(currentPage);
        const viewport = page.getViewport({ scale: 3 });
        
        sourceCanvas = document.createElement("canvas");
        sourceCanvas.width = viewport.width;
        sourceCanvas.height = viewport.height;
        const sourceCtx = sourceCanvas.getContext("2d");
        
        updateProgress(20, "Рендеринг страницы...");
        
        await page.render({
          canvasContext: sourceCtx,
          viewport
        }).promise;
      }
      
      const pageWidth = 210;
      const pageHeight = 297;
      
      const scaledWidth = (pageWidth * scalePercent) / 100;
      const scaledHeight = (pageHeight * scalePercent) / 100;
      
      const cols = Math.ceil(scaledWidth / paperWidth);
      const rows = Math.ceil(scaledHeight / paperHeight);
      
      let pdf = null;
      let sheetIndex = 0;
      const totalSheets = cols * rows;
      
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          updateProgress(20 + Math.floor((sheetIndex / totalSheets) * 70), 
                         `Создание листа ${sheetIndex + 1} из ${totalSheets}...`);
          
          const sourceX = (col * paperWidth / scaledWidth) * sourceCanvas.width;
          const sourceY = (row * paperHeight / scaledHeight) * sourceCanvas.height;
          const sourceW = (paperWidth / scaledWidth) * sourceCanvas.width;
          const sourceH = (paperHeight / scaledHeight) * sourceCanvas.height;
          
          const sheetCanvas = document.createElement("canvas");
          const margin = 80;
          sheetCanvas.width = sourceW + margin * 2;
          sheetCanvas.height = sourceH + margin * 2;
          const sheetCtx = sheetCanvas.getContext("2d");
          
          sheetCtx.fillStyle = "#ffffff";
          sheetCtx.fillRect(0, 0, sheetCanvas.width, sheetCanvas.height);
          
          sheetCtx.drawImage(
            sourceCanvas,
            sourceX, sourceY, sourceW, sourceH,
            margin, margin, sourceW, sourceH
          );
          
          sheetCtx.strokeStyle = "#000000";
          sheetCtx.fillStyle = "#000000";
          sheetCtx.lineWidth = 2;
          sheetCtx.font = "bold 32px Arial";
          sheetCtx.textAlign = "center";
          
          sheetCtx.fillText(`Лист ${sheetIndex + 1} из ${totalSheets}`, sheetCanvas.width / 2, 40);
          sheetCtx.font = "24px Arial";
          sheetCtx.fillText(`Ряд ${row + 1}, Колонка ${col + 1}`, sheetCanvas.width / 2, 70);
          
          sheetCtx.font = "bold 20px Arial";
          
          sheetCtx.fillText(`TL`, margin / 2, margin / 2);
          sheetCtx.beginPath();
          sheetCtx.moveTo(margin - 20, margin);
          sheetCtx.lineTo(margin, margin);
          sheetCtx.lineTo(margin, margin - 20);
          sheetCtx.stroke();
          
          sheetCtx.fillText(`TR`, sheetCanvas.width - margin / 2, margin / 2);
          sheetCtx.beginPath();
          sheetCtx.moveTo(sheetCanvas.width - margin + 20, margin);
          sheetCtx.lineTo(sheetCanvas.width - margin, margin);
          sheetCtx.lineTo(sheetCanvas.width - margin, margin - 20);
          sheetCtx.stroke();
          
          sheetCtx.fillText(`BL`, margin / 2, sheetCanvas.height - margin / 2 + 10);
          sheetCtx.beginPath();
          sheetCtx.moveTo(margin - 20, sheetCanvas.height - margin);
          sheetCtx.lineTo(margin, sheetCanvas.height - margin);
          sheetCtx.lineTo(margin, sheetCanvas.height - margin + 20);
          sheetCtx.stroke();
          
          sheetCtx.fillText(`BR`, sheetCanvas.width - margin / 2, sheetCanvas.height - margin / 2 + 10);
          sheetCtx.beginPath();
          sheetCtx.moveTo(sheetCanvas.width - margin + 20, sheetCanvas.height - margin);
          sheetCtx.lineTo(sheetCanvas.width - margin, sheetCanvas.height - margin);
          sheetCtx.lineTo(sheetCanvas.width - margin, sheetCanvas.height - margin + 20);
          sheetCtx.stroke();
          
          sheetCtx.font = "18px Arial";
          
          if (col > 0) {
            sheetCtx.fillText(`← Лист ${row * cols + col}`, margin / 2, sheetCanvas.height / 2);
            sheetCtx.beginPath();
            sheetCtx.moveTo(20, sheetCanvas.height / 2 - 10);
            sheetCtx.lineTo(margin - 10, sheetCanvas.height / 2);
            sheetCtx.lineTo(20, sheetCanvas.height / 2 + 10);
            sheetCtx.stroke();
          }
          
          if (col < cols - 1) {
            sheetCtx.fillText(`Лист ${row * cols + col + 2} →`, sheetCanvas.width - margin / 2, sheetCanvas.height / 2);
            sheetCtx.beginPath();
            sheetCtx.moveTo(sheetCanvas.width - 20, sheetCanvas.height / 2 - 10);
            sheetCtx.lineTo(sheetCanvas.width - margin + 10, sheetCanvas.height / 2);
            sheetCtx.lineTo(sheetCanvas.width - 20, sheetCanvas.height / 2 + 10);
            sheetCtx.stroke();
          }
          
          if (row > 0) {
            sheetCtx.fillText(`↑ Лист ${(row - 1) * cols + col + 1}`, sheetCanvas.width / 2, margin / 2 + 20);
            sheetCtx.beginPath();
            sheetCtx.moveTo(sheetCanvas.width / 2 - 10, 20);
            sheetCtx.lineTo(sheetCanvas.width / 2, margin - 10);
            sheetCtx.lineTo(sheetCanvas.width / 2 + 10, 20);
            sheetCtx.stroke();
          }
          
          if (row < rows - 1) {
            sheetCtx.fillText(`Лист ${(row + 1) * cols + col + 1} ↓`, sheetCanvas.width / 2, sheetCanvas.height - margin / 2 + 30);
            sheetCtx.beginPath();
            sheetCtx.moveTo(sheetCanvas.width / 2 - 10, sheetCanvas.height - 20);
            sheetCtx.lineTo(sheetCanvas.width / 2, sheetCanvas.height - margin + 10);
            sheetCtx.lineTo(sheetCanvas.width / 2 + 10, sheetCanvas.height - 20);
            sheetCtx.stroke();
          }
          
          sheetCtx.setLineDash([10, 5]);
          sheetCtx.strokeStyle = "#ff0000";
          sheetCtx.lineWidth = 1;
          sheetCtx.strokeRect(margin, margin, sourceW, sourceH);
          sheetCtx.setLineDash([]);
          
          const sheetData = sheetCanvas.toDataURL("image/png");
          
          if (!pdf) {
            pdf = new jsPDF({
              orientation: orientation === "portrait" ? "p" : "l",
              unit: "mm",
              format: [paperWidth, paperHeight]
            });
          } else {
            pdf.addPage([paperWidth, paperHeight], orientation === "portrait" ? "p" : "l");
          }
          
          pdf.addImage(sheetData, "PNG", 0, 0, paperWidth, paperHeight);
          
          sheetIndex++;
        }
      }
      
      if (pdf) {
        updateProgress(90, forPrint ? "Открытие диалога печати..." : "Сохранение...");
        
        if (forPrint) {
          pdf.autoPrint();
          window.open(pdf.output('bloburl'), '_blank');
        } else {
          const sourceType = selection ? "area" : "page";
          const fileName = `${uploadedFileName}_${sourceType}_${currentPage}_poster_${scalePercent}pct.pdf`;
          pdf.save(fileName);
        }
        
        updateProgress(100, "Готово!");
        
        setTimeout(() => {
          hideLoading();
          closePosterModal();
        }, 500);
      }
    };
    
    jsPDFScript.onerror = () => {
      hideLoading();
      alert("Ошибка при загрузке jsPDF");
    };
    
    document.body.appendChild(jsPDFScript);
    
  } catch (err) {
    console.error("Ошибка:", err);
    hideLoading();
    alert("Ошибка: " + err.message);
  }
}

function clearSelection() {
  resetSelection();
}

function onPointerDown(e) {
  if (e.target.closest(".handle")) {
    e.preventDefault();
    const pos = getRelativePos(e);
    resizeHandle = e.target.dataset.handle;
    isPointerDown = true;
    selectionMode = true;
    startPointer = pos;
    canvasContainer.setPointerCapture(e.pointerId);
    return;
  }

  const pos = getRelativePos(e);
  if (pointInSelection(pos.x, pos.y)) {
    e.preventDefault();
    canvasContainer.setPointerCapture(e.pointerId);
    isPointerDown = true;
    resizeHandle = "move";
    selectionMode = true;
    startPointer = pos;
    return;
  }

  if (selection) {
    resetSelection();
    return;
  }

  e.preventDefault();
  canvasContainer.setPointerCapture(e.pointerId);
  isPointerDown = true;
  resizeHandle = null;
  selectionMode = false;
  startPointer = pos;

  longPressTimer = setTimeout(() => {
    selectionMode = true;
    selection = {
      x: pos.x,
      y: pos.y,
      w: 0,
      h: 0,
    };
    updateSelectionRect();
    clearSelectionBtn.disabled = false;
  }, 300);
}

function onPointerMove(e) {
  if (!isPointerDown) return;
  const pos = getRelativePos(e);

  if (!selectionMode) {
    return;
  }

  if (longPressTimer) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }

  if (!selection) return;

  if (resizeHandle === "move") {
    const dx = pos.x - startPointer.x;
    const dy = pos.y - startPointer.y;
    selection.x += dx;
    selection.y += dy;
    startPointer = pos;
  } else if (resizeHandle) {
    resizeSelectionWithHandle(pos);
  } else {
    selection.w = pos.x - selection.x;
    selection.h = pos.y - selection.y;
  }

  normalizeSelection();
  updateSelectionRect();
}

function onPointerUp(e) {
  if (longPressTimer) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }
  isPointerDown = false;
  resizeHandle = null;

  if (selection && (Math.abs(selection.w) < 10 || Math.abs(selection.h) < 10)) {
    resetSelection();
  }
}

function getRelativePos(e) {
  const rect = canvas.getBoundingClientRect();
  const x = (e.clientX - rect.left) * (canvas.width / rect.width);
  const y = (e.clientY - rect.top) * (canvas.height / rect.height);
  return { x, y };
}

function updateSelectionRect() {
  if (!selection) {
    selectionRect.style.display = "none";
    return;
  }
  selectionRect.style.display = "block";

  const rect = canvas.getBoundingClientRect();
  const scaleX = rect.width / canvas.width;
  const scaleY = rect.height / canvas.height;

  selectionRect.style.left = selection.x * scaleX + "px";
  selectionRect.style.top = selection.y * scaleY + "px";
  selectionRect.style.width = selection.w * scaleX + "px";
  selectionRect.style.height = selection.h * scaleY + "px";
}

function normalizeSelection() {
  if (!selection) return;
  if (selection.w < 0) {
    selection.x += selection.w;
    selection.w *= -1;
  }
  if (selection.h < 0) {
    selection.y += selection.h;
    selection.h *= -1;
  }

  if (selection.x < 0) selection.x = 0;
  if (selection.y < 0) selection.y = 0;
  if (selection.x + selection.w > canvas.width) {
    selection.w = canvas.width - selection.x;
  }
  if (selection.y + selection.h > canvas.height) {
    selection.h = canvas.height - selection.y;
  }
}

function resetSelection() {
  selection = null;
  selectionRect.style.display = "none";
  clearSelectionBtn.disabled = true;
}

function pointInSelection(x, y) {
  if (!selection) return false;
  return (
    x >= selection.x &&
    y >= selection.y &&
    x <= selection.x + selection.w &&
    y <= selection.y + selection.h
  );
}

function resizeSelectionWithHandle(pos) {
  if (!selection) return;
  const { x, y, w, h } = selection;
  if (resizeHandle === "tl") {
    const x2 = x + w;
    const y2 = y + h;
    selection.x = pos.x;
    selection.y = pos.y;
    selection.w = x2 - pos.x;
    selection.h = y2 - pos.y;
  } else if (resizeHandle === "tr") {
    const y2 = y + h;
    selection.y = pos.y;
    selection.w = pos.x - x;
    selection.h = y2 - pos.y;
  } else if (resizeHandle === "bl") {
    const x2 = x + w;
    selection.x = pos.x;
    selection.w = x2 - pos.x;
    selection.h = pos.y - y;
  } else if (resizeHandle === "br") {
    selection.w = pos.x - x;
    selection.h = pos.y - y;
  }
}

async function exportSelectionAsPDF() {
  if (!selection || !pdfDoc) return;

  const tmp = document.createElement("canvas");
  tmp.width = selection.w;
  tmp.height = selection.h;
  const tctx = tmp.getContext("2d");

  const imageData = ctx.getImageData(
    selection.x,
    selection.y,
    selection.w,
    selection.h
  );
  tctx.putImageData(imageData, 0, 0);

  const dataUrl = tmp.toDataURL("image/png", 1.0);

  const pdfBlob = await imageToSimplePDF(dataUrl, tmp.width, tmp.height);
  const fileName = `${uploadedFileName}_page_${currentPage}_crop.pdf`;

  const url = URL.createObjectURL(pdfBlob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

async function printSelectedArea() {
  if (!selection || !pdfDoc) {
    alert("Сначала выделите область на странице");
    return;
  }

  showLoading();
  updateProgress(0, "Подготовка к печати...");

  try {
    const tmp = document.createElement("canvas");
    tmp.width = selection.w;
    tmp.height = selection.h;
    const tctx = tmp.getContext("2d");

    const imageData = ctx.getImageData(
      selection.x,
      selection.y,
      selection.w,
      selection.h
    );
    tctx.putImageData(imageData, 0, 0);

    const dataUrl = tmp.toDataURL("image/png", 1.0);

    updateProgress(50, "Создание PDF...");

    const jsPDFScript = document.createElement("script");
    jsPDFScript.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
    
    jsPDFScript.onload = () => {
      const { jsPDF } = window.jspdf;

      const imgW = tmp.width;
      const imgH = tmp.height;

      const pdf = new jsPDF({
        orientation: imgW >= imgH ? "l" : "p",
        unit: "pt",
        format: [imgW, imgH],
        compress: false
      });

      pdf.addImage(dataUrl, "PNG", 0, 0, imgW, imgH, undefined, "NONE");
      
      updateProgress(90, "Открытие диалога печати...");
      
      pdf.autoPrint();
      window.open(pdf.output('bloburl'), '_blank');
      
      updateProgress(100, "Готово!");
      
      setTimeout(() => {
        hideLoading();
      }, 500);
    };
    
    jsPDFScript.onerror = () => {
      hideLoading();
      alert("Ошибка при загрузке jsPDF");
    };
    
    document.body.appendChild(jsPDFScript);

  } catch (err) {
    console.error("Ошибка:", err);
    hideLoading();
    alert("Ошибка при печати: " + err.message);
  }
}

async function imageToSimplePDF(dataUrl, imgW, imgH) {
  return new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
    script.onload = () => {
      const { jsPDF } = window.jspdf;

      const pdf = new jsPDF({
        orientation: imgW >= imgH ? "l" : "p",
        unit: "pt",
        format: [imgW, imgH],
        compress: false
      });

      pdf.addImage(dataUrl, "PNG", 0, 0, imgW, imgH, undefined, "NONE");
      const blob = pdf.output("blob");
      resolve(blob);
    };
    document.body.appendChild(script);
  });
}
