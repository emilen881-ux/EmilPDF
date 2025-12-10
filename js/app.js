/**
 * Эмил PDF - новое поколение PDF редактора
 * WebGL рендеринг, поддержка MacBook и iPad
 */

class EmilPDFApp {
    constructor() {
        this.pdfDoc = null;
        this.currentPage = 1;
        this.totalPages = 0;
        this.zoom = 1;
        this.rotation = 0;
        this.selection = null;
        this.canvas = null;
        this.gl = null;
        this.pages = [];
        this.init();
    }

    init() {
        this.setupCanvas();
        this.setupEventListeners();
        this.setupWebGL();
    }

    setupCanvas() {
        this.canvas = document.getElementById('renderCanvas');
        if (!this.canvas) {
            console.error('Не найден canvas элемент');
            return;
        }
        this.resizeCanvas();
        window.addEventListener('resize', () => this.resizeCanvas());
    }

    resizeCanvas() {
        const container = document.getElementById('viewerContainer');
        if (container) {
            this.canvas.width = container.clientWidth;
            this.canvas.height = container.clientHeight;
        }
    }

    setupWebGL() {
        try {
            this.gl = this.canvas.getContext('webgl2') || this.canvas.getContext('webgl');
            if (!this.gl) {
                console.warn('WebGL но доступна, используем Canvas API');
            }
        } catch (e) {
            console.error('Ошибка WebGL:', e);
        }
    }

    setupEventListeners() {
        // Загружка PDF
        const fileInput = document.getElementById('fileInput');
        if (fileInput) {
            fileInput.addEventListener('change', (e) => this.loadPDF(e));
        }

        // Навигация
        document.getElementById('prevBtn')?.addEventListener('click', () => this.previousPage());
        document.getElementById('nextBtn')?.addEventListener('click', () => this.nextPage());

        // Масштабирование
        document.getElementById('zoomInBtn')?.addEventListener('click', () => this.zoomIn());
        document.getElementById('zoomOutBtn')?.addEventListener('click', () => this.zoomOut());

        // Основные действия
        document.getElementById('extractBtn')?.addEventListener('click', () => this.extractPages());
        document.getElementById('splitBtn')?.addEventListener('click', () => this.splitPages());
        document.getElementById('printBtn')?.addEventListener('click', () => this.printDocument());
        document.getElementById('shareBtn')?.addEventListener('click', () => this.shareDocument());

        // Точные управления
        this.setupTouchGestures();
        this.setupMouseSelection();
    }

    setupTouchGestures() {
        const container = document.getElementById('viewerContainer');
        if (!container) return;

        let touchStartX = 0;
        let touchStartY = 0;
        let lastDistance = 0;

        container.addEventListener('touchstart', (e) => {
            if (e.touches.length === 1) {
                touchStartX = e.touches[0].clientX;
                touchStartY = e.touches[0].clientY;
            } else if (e.touches.length === 2) {
                const dx = e.touches[0].clientX - e.touches[1].clientX;
                const dy = e.touches[0].clientY - e.touches[1].clientY;
                lastDistance = Math.sqrt(dx * dx + dy * dy);
            }
        });

        container.addEventListener('touchmove', (e) => {
            if (e.touches.length === 2) {
                const dx = e.touches[0].clientX - e.touches[1].clientX;
                const dy = e.touches[0].clientY - e.touches[1].clientY;
                const distance = Math.sqrt(dx * dx + dy * dy);
                const delta = distance - lastDistance;
                if (Math.abs(delta) > 10) {
                    this.zoom += delta * 0.001;
                    this.zoom = Math.max(0.5, Math.min(this.zoom, 3));
                    this.renderPage();
                }
                lastDistance = distance;
            }
        });

        container.addEventListener('touchend', (e) => {
            if (e.changedTouches.length === 1) {
                const deltaX = e.changedTouches[0].clientX - touchStartX;
                if (Math.abs(deltaX) > 50) {
                    if (deltaX > 0) this.previousPage();
                    else this.nextPage();
                }
            }
        });
    }

    setupMouseSelection() {
        const container = document.getElementById('viewerContainer');
        if (!container) return;

        let isSelecting = false;
        let startX, startY;

        container.addEventListener('mousedown', (e) => {
            isSelecting = true;
            startX = e.clientX;
            startY = e.clientY;
        });

        container.addEventListener('mousemove', (e) => {
            if (isSelecting) {
                // Нрисуем выделенную область
            }
        });

        container.addEventListener('mouseup', (e) => {
            if (isSelecting) {
                const endX = e.clientX;
                const endY = e.clientY;
                this.selection = {
                    x: Math.min(startX, endX),
                    y: Math.min(startY, endY),
                    width: Math.abs(endX - startX),
                    height: Math.abs(endY - startY)
                };
                isSelecting = false;
                this.showSelectionMenu();
            }
        });
    }

    async loadPDF(event) {
        const file = event.target.files[0];
        if (!file) return;

        try {
            const arrayBuffer = await file.arrayBuffer();
            this.pdfDoc = await pdfjsLib.getDocument(arrayBuffer).promise;
            this.totalPages = this.pdfDoc.numPages;
            this.currentPage = 1;
            this.pages = [];
            this.updatePageInfo();
            await this.renderPage();
        } catch (error) {
            console.error('Ошибка при загрузке PDF:', error);
        }
    }

    async renderPage() {
        if (!this.pdfDoc) return;
        try {
            const page = await this.pdfDoc.getPage(this.currentPage);
            const viewport = page.getViewport({ scale: this.zoom });
            const context = this.canvas.getContext('2d');
            this.canvas.width = viewport.width;
            this.canvas.height = viewport.height;
            await page.render({ canvasContext: context, viewport }).promise;
        } catch (error) {
            console.error('Ошибка при отрисовке страницы:', error);
        }
    }

    previousPage() {
        if (this.currentPage > 1) {
            this.currentPage--;
            this.updatePageInfo();
            this.renderPage();
        }
    }

    nextPage() {
        if (this.currentPage < this.totalPages) {
            this.currentPage++;
            this.updatePageInfo();
            this.renderPage();
        }
    }

    zoomIn() {
        this.zoom = Math.min(this.zoom + 0.2, 3);
        this.renderPage();
    }

    zoomOut() {
        this.zoom = Math.max(this.zoom - 0.2, 0.5);
        this.renderPage();
    }

    updatePageInfo() {
        const pageInfo = document.getElementById('pageInfo');
        if (pageInfo) {
            pageInfo.textContent = `Стр. ${this.currentPage} из ${this.totalPages}`;
        }
    }

    extractPages() {
        alert('Функция извлечения страниц - в разработке');
    }

    splitPages() {
        alert('Функция по разделению проекта - в разработке');
    }

    printDocument() {
        alert('Функция печати - в разработке');
    }

    shareDocument() {
        alert('Функция отправки - в разработке');
    }

    showSelectionMenu() {
        console.log('Меню выделенных областей');
    }
}

// Инициализацияаппликации
document.addEventListener('DOMContentLoaded', () => {
    window.app = new EmilPDFApp();
});
