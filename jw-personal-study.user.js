// ==UserScript==
// @name         JW.org Personal Study
// @namespace    http://tampermonkey.net/
// @version      0.9
// @description  JW.org Personal Study – checkbox + notes for videos, checkbox only for other materials, Bible books and chapters, export/import across languages.
// @match        https://www.jw.org/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addStyle
// ==/UserScript==

// --- GM_* SHIM pro prostředí bez Tampermonkey (např. Safari + Userscripts na iPadu) ---
// Na desktopu v Tampermonkey už GM_* existují, takže se tento kód NEspustí.

if (typeof GM_getValue === 'undefined') {
    function GM_getValue(key, defaultValue) {
        try {
            const raw = localStorage.getItem(key);
            if (raw === null || raw === undefined) return defaultValue;
            return JSON.parse(raw);
        } catch (e) {
            return defaultValue;
        }
    }
}

if (typeof GM_setValue === 'undefined') {
    function GM_setValue(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
        } catch (e) {
            // ignore errors
        }
    }
}

if (typeof GM_addStyle === 'undefined') {
    function GM_addStyle(css) {
        try {
            const style = document.createElement('style');
            style.textContent = css;
            document.head.appendChild(style);
        } catch (e) {
            // ignore
        }
    }
}
// --- konec shimu GM_* ---

(function () {
    'use strict';

    const STORAGE_KEY = 'jwPersonalStudy_v2';

    const LANG_STRINGS = {
        cs: {
            appName: 'Osobní studium na jw.org',
            panelLabel: 'Osobní studium na jw.org:',
            singleLabel: 'Osobní studium:',
            modalTitle: 'Poznámky k materiálu',
            checkboxTitle: 'Označit jako prostudované',
            notesTitle: 'Poznámky k materiálu',
            btnClose: 'Zavřít',
            btnClearNotes: 'Smazat poznámky',
            btnSave: 'Uložit',
            exportBtn: '📤 Export',
            importBtn: '📥 Import',
            importSuccess: 'Import hotový.',
            importErrorPrefix: 'Chyba při importu JSONu: ',
            studiedCountLabel: 'Prostudováno:'
        },
        en: {
            appName: 'JW.org Personal Study',
            panelLabel: 'JW.org Personal Study:',
            singleLabel: 'Personal study:',
            modalTitle: 'Notes for material',
            checkboxTitle: 'Mark as studied',
            notesTitle: 'Notes for material',
            btnClose: 'Close',
            btnClearNotes: 'Clear notes',
            btnSave: 'Save',
            exportBtn: '📤 Export',
            importBtn: '📥 Import',
            importSuccess: 'Import completed.',
            importErrorPrefix: 'Error while importing JSON: ',
            studiedCountLabel: 'Studied:'
        }
    };

    function detectLanguageCode() {
        const hash = window.location.hash || '';
        if (hash.startsWith('#')) {
            const parts = hash.slice(1).split('/').filter(Boolean);
            if (parts.length > 0) {
                const code = parts[0].toLowerCase();
                if (LANG_STRINGS[code]) return code;
            }
        }

        const pathParts = window.location.pathname.split('/').filter(Boolean);
        if (pathParts.length > 0) {
            const code = pathParts[0].toLowerCase();
            if (LANG_STRINGS[code]) return code;
        }

        return 'en';
    }

    const currentLang = detectLanguageCode();
    const t = LANG_STRINGS[currentLang] || LANG_STRINGS.en;

    let store = {};
    try {
        store = JSON.parse(GM_getValue(STORAGE_KEY, '{}'));
    } catch (e) {
        console.error('JW.org Personal Study: error while parsing stored data', e);
        store = {};
    }

    // span v panelu, kde se zobrazuje počet prostudovaných
    let studiedCountSpan = null;

    function getStudiedCount() {
        let count = 0;
        for (const key in store) {
            if (!Object.prototype.hasOwnProperty.call(store, key)) continue;
            const item = store[key];
            if (item && item.studied) count++;
        }
        return count;
    }

    function refreshStudiedCountUI() {
        if (!studiedCountSpan) return;
        studiedCountSpan.textContent = `${t.studiedCountLabel} ${getStudiedCount()}`;
    }

    function saveStore() {
        GM_setValue(STORAGE_KEY, JSON.stringify(store));
        refreshStudiedCountUI();
    }

    function downloadBackupFile() {
        const json = JSON.stringify(store, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');

        const now = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const filename = `jw_personal_study_backup_${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}.json`;

        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();

        setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }, 0);
    }

    function getVideoIdFromUrl(url) {
        if (!url) return null;

        try {
            const hashIndex = url.indexOf('#');
            if (hashIndex !== -1 && hashIndex < url.length - 1) {
                const hash = url.substring(hashIndex + 1);
                const parts = hash.split('/').filter(Boolean);
                if (parts.length > 0) {
                    return 'jw_vid_' + parts[parts.length - 1];
                }
            }

            const u = new URL(url, location.href);
            const pathParts = u.pathname.split('/').filter(Boolean);
            if (pathParts.length > 0) {
                return 'jw_vid_' + pathParts[pathParts.length - 1];
            }

            return url;
        } catch (e) {
            return url;
        }
    }

    function getPublicationIdFromElement(anchor) {
        if (!anchor) return null;

        const synopsis = anchor.closest('.synopsis');
        if (synopsis) {
            const cls = synopsis.className.split(/\s+/);
            const docIdToken = cls.find(c => c.startsWith('docId-'));
            if (docIdToken) {
                const num = docIdToken.slice('docId-'.length);
                if (num) return 'jw_pub_' + num;
            }
        }

        const pageId = anchor.getAttribute('data-page-id');
        if (pageId && pageId.startsWith('toc-')) {
            const code = pageId.slice(4);
            if (code) return 'jw_pub_' + code;
        }

        const href = anchor.href || anchor.getAttribute('href');
        if (href) {
            try {
                const u = new URL(href, location.href);
                const pathParts = u.pathname.split('/').filter(Boolean);
                if (pathParts.length > 0) {
                    return 'jw_pubslug_' + pathParts[pathParts.length - 1];
                }
            } catch (e) {
                return href;
            }
        }

        return null;
    }

    function getArticleIdFromElement(anchor) {
        if (!anchor) return null;

        const synopsis = anchor.closest('.synopsis');
        if (synopsis) {
            const cls = synopsis.className.split(/\s+/);
            const docIdToken = cls.find(c => c.startsWith('docId-'));
            if (docIdToken) {
                const num = docIdToken.slice('docId-'.length);
                if (num) return 'jw_art_' + num;
            }
        }

        const pageId = anchor.getAttribute('data-page-id');
        if (pageId && pageId.startsWith('mid')) {
            const num = pageId.slice(3);
            if (num) return 'jw_art_' + num;
        }

        const href = anchor.href || anchor.getAttribute('href');
        if (href) {
            try {
                const u = new URL(href, location.href);
                const pathParts = u.pathname.split('/').filter(Boolean);
                if (pathParts.length > 0) {
                    return 'jw_artslug_' + pathParts[pathParts.length - 1];
                }
            } catch (e) {
                return href;
            }
        }

        return null;
    }

    // ---- Bible books & chapters ID helpers ----

    function getBibleBookIdFromElement(anchor) {
        const href = anchor.href || anchor.getAttribute('href');
        if (!href) return null;
        try {
            const u = new URL(href, location.href);
            const parts = u.pathname.split('/').filter(Boolean);
            if (parts.length === 0) return null;
            const slug = parts[parts.length - 1]; // e.g. "1-Mojzisova"
            return 'jw_biblebook_' + slug.toLowerCase();
        } catch (e) {
            return null;
        }
    }

    function getBibleChapterIdFromElement(anchor) {
        const href = anchor.href || anchor.getAttribute('href');
        if (!href) return null;
        try {
            const u = new URL(href, location.href);
            const parts = u.pathname.split('/').filter(Boolean);
            // .../bible/nwt/knihy/<book-slug>/<chapter>/
            if (parts.length < 2) return null;
            const chapter = parts[parts.length - 1];
            const bookSlug = parts[parts.length - 2];
            return 'jw_biblechap_' + bookSlug.toLowerCase() + '_' + chapter;
        } catch (e) {
            return null;
        }
    }

    GM_addStyle(`
    .jwvt-video-thumb {
        position: relative !important;
    }
    .jwvt-controls {
        position: absolute;
        top: 4px;
        right: 4px;
        display: flex;
        gap: 4px;
        z-index: 9999;
    }
    .jwvt-checkbox,
    .jwvt-notes-btn {
        width: 18px;
        height: 18px;
        border-radius: 3px;
        font-size: 13px;
        line-height: 18px;
        text-align: center;
        cursor: pointer;
        box-shadow: 0 0 2px rgba(0,0,0,0.3);
        user-select: none;
    }
    .jwvt-checkbox {
        border: 1px solid #ccc;
        background: rgba(255,255,255,0.9);
    }
    .jwvt-checkbox.jwvt-checked {
        background: rgba(76, 175, 80, 0.95);
        color: #fff;
        border-color: #4caf50;
        font-weight: bold;
    }
    .jwvt-notes-btn {
        border: 1px solid #ccc;
        background: rgba(255,255,255,0.9);
        font-size: 12px;
    }
    .jwvt-has-notes {
        border-color: #2196f3;
        box-shadow: 0 0 3px rgba(33,150,243,0.7);
    }
    .jwvt-modal-backdrop {
        position: fixed;
        inset: 0;
        background: rgba(0,0,0,0.4);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 99999;
    }
    .jwvt-modal {
        background: #ffffff;
        color: #222222;
        padding: 16px;
        border-radius: 6px;
        max-width: 400px;
        width: 90%;
        box-shadow: 0 4px 10px rgba(0,0,0,0.3);
        display: flex;
        flex-direction: column;
        gap: 8px;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .jwvt-modal textarea {
        width: 100%;
        min-height: 120px;
        resize: vertical;
        font-family: inherit;
        font-size: 14px;
        padding: 6px;
        background: #111111;
        color: #f5f5f5;
    }
    .jwvt-modal-buttons {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
    }
    .jwvt-btn {
        padding: 4px 10px;
        border-radius: 4px;
        border: 1px solid #ccc;
        background: #f5f5f5;
        cursor: pointer;
        font-size: 13px;
        color: #333333 !important;
    }
    .jwvt-btn-primary {
        background: #4caf50;
        border-color: #4caf50;
        color: #ffffff !important;
    }
    .jwvt-btn-danger {
        background: #f44336;
        border-color: #f44336;
        color: #ffffff !important;
    }
    .jwvt-export-import-panel {
        position: fixed;
        bottom: 12px;
        right: 12px;
        z-index: 9999;
        background: #ffffff;
        border: 1px solid #ccc;
        border-radius: 6px;
        padding: 6px 8px;
        display: flex;
        gap: 4px;
        align-items: center;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        font-size: 12px;
        box-shadow: 0 2px 6px rgba(0,0,0,0.2);
        color: #333333;
    }
    .jwvt-export-import-panel span {
        margin-right: 4px;
        color: #333333 !important;
    }
    .jwvt-export-import-panel button {
        border-radius: 4px;
        border: 1px solid #ccc;
        background: #fafafa;
        cursor: pointer;
        padding: 2px 6px;
        font-size: 12px;
        color: #333333 !important;
    }
    .jwvt-import-textarea {
        width: 100%;
        min-height: 150px;
        font-family: monospace;
        font-size: 12px;
        background: #111111;
        color: #f5f5f5;
    }
    .jwvt-single-video-controls {
        margin-top: 8px;
        display: flex;
        gap: 6px;
        align-items: center;
    }
    .jwvt-single-video-label {
        font-size: 13px;
        color: #ddd;
        margin-right: 4px;
    }

    /* Bible books (blue tiles) and chapter squares */
    .jwvt-bible-book,
    .jwvt-bible-chapter-link {
        position: relative !important;
    }
    .jwvt-bible-book-checkbox,
    .jwvt-bible-chapter-checkbox {
        position: absolute;
        width: 14px;
        height: 14px;
        line-height: 14px;
        font-size: 11px;
        border-radius: 3px;
        box-shadow: 0 0 2px rgba(0,0,0,0.3);
    }
    /* knihy – dole vpravo modrého obdélníku, ať nezasahují do ikon nahoře */
    .jwvt-bible-book-checkbox {
        bottom: 4px;
        right: 4px;
    }
    /* kapitoly – nahoře vpravo v čtverečku s číslem */
    .jwvt-bible-chapter-checkbox {
        top: 2px;
        right: 2px;
    }
    `);

    function syncControlsForVideo(videoId) {
        const current = store[videoId];

        document.querySelectorAll(`.jwvt-checkbox[data-jwvt-id="${videoId}"]`).forEach((checkbox) => {
            if (current && current.studied) {
                checkbox.classList.add('jwvt-checked');
                checkbox.textContent = '✓';
            } else {
                checkbox.classList.remove('jwvt-checked');
                checkbox.textContent = '';
            }
        });

        document.querySelectorAll(`.jwvt-notes-btn[data-jwvt-id="${videoId}"]`).forEach((notesBtn) => {
            if (current && current.notes && current.notes.trim() !== '') {
                notesBtn.classList.add('jwvt-has-notes');
            } else {
                notesBtn.classList.remove('jwvt-has-notes');
            }
        });
    }

    function refreshAllControls() {
        const ids = new Set();
        document.querySelectorAll('.jwvt-checkbox[data-jwvt-id]').forEach((el) => ids.add(el.dataset.jwvtId));
        document.querySelectorAll('.jwvt-notes-btn[data-jwvt-id]').forEach((el) => ids.add(el.dataset.jwvtId));
        ids.forEach((id) => syncControlsForVideo(id));
    }

    function toggleStudied(videoId) {
        const cur = store[videoId] || { studied: false, notes: '' };
        cur.studied = !cur.studied;
        store[videoId] = cur;

        if (!cur.studied && !cur.notes) {
            delete store[videoId];
        }

        saveStore();
        refreshAllControls();
    }

    function openNotesModal(videoId) {
        const current = store[videoId] || { studied: false, notes: '' };

        const backdrop = document.createElement('div');
        backdrop.className = 'jwvt-modal-backdrop';

        const modal = document.createElement('div');
        modal.className = 'jwvt-modal';

        const title = document.createElement('div');
        title.textContent = t.modalTitle;
        title.style.fontWeight = 'bold';

        const textarea = document.createElement('textarea');
        textarea.value = current.notes || '';

        const buttons = document.createElement('div');
        buttons.className = 'jwvt-modal-buttons';

        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'jwvt-btn';
        cancelBtn.textContent = t.btnClose;

        const clearBtn = document.createElement('button');
        clearBtn.className = 'jwvt-btn jwvt-btn-danger';
        clearBtn.textContent = t.btnClearNotes;

        const saveBtn = document.createElement('button');
        saveBtn.className = 'jwvt-btn jwvt-btn-primary';
        saveBtn.textContent = t.btnSave;

        cancelBtn.addEventListener('click', () => {
            document.body.removeChild(backdrop);
        });

        clearBtn.addEventListener('click', () => {
            textarea.value = '';
        });

        saveBtn.addEventListener('click', () => {
            const text = textarea.value.trim();
            if (!store[videoId]) {
                store[videoId] = { studied: false, notes: '' };
            }
            store[videoId].notes = text;
            if (!store[videoId].notes && !store[videoId].studied) {
                delete store[videoId];
            }
            saveStore();
            document.body.removeChild(backdrop);
            refreshAllControls();
        });

        buttons.appendChild(cancelBtn);
        buttons.appendChild(clearBtn);
        buttons.appendChild(saveBtn);

        modal.appendChild(title);
        modal.appendChild(textarea);
        modal.appendChild(buttons);

        backdrop.appendChild(modal);
        document.body.appendChild(backdrop);
    }

    function enhanceThumbnail(anchor, options) {
        const { id, showNotes } = options || {};
        if (!anchor || anchor.classList.contains('jwvt-processed')) return;
        if (!id) return;

        anchor.classList.add('jwvt-video-thumb', 'jwvt-processed');

        const controls = document.createElement('div');
        controls.className = 'jwvt-controls';

        const checkbox = document.createElement('div');
        checkbox.className = 'jwvt-checkbox';
        checkbox.title = t.checkboxTitle;
        checkbox.dataset.jwvtId = id;

        checkbox.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleStudied(id);
        });

        controls.appendChild(checkbox);

        if (showNotes) {
            const notesBtn = document.createElement('div');
            notesBtn.className = 'jwvt-notes-btn';
            notesBtn.textContent = '📝';
            notesBtn.title = t.notesTitle;
            notesBtn.dataset.jwvtId = id;

            notesBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                openNotesModal(id);
            });

            controls.appendChild(notesBtn);
        }

        anchor.appendChild(controls);
        syncControlsForVideo(id);
    }

    // ---- Bible books & chapters (bez změny layoutu) ----

    function enhanceBibleBook(anchor) {
        if (!anchor || anchor.classList.contains('jwvt-bible-book-processed')) return;

        const id = getBibleBookIdFromElement(anchor);
        if (!id) return;

        anchor.classList.add('jwvt-bible-book', 'jwvt-bible-book-processed');

        const checkbox = document.createElement('div');
        checkbox.className = 'jwvt-checkbox jwvt-bible-book-checkbox';
        checkbox.title = t.checkboxTitle;
        checkbox.dataset.jwvtId = id;

        checkbox.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleStudied(id);
        });

        anchor.appendChild(checkbox);
        syncControlsForVideo(id);
    }

    function enhanceBibleChapter(anchor) {
        if (!anchor || anchor.classList.contains('jwvt-bible-chapter-processed')) return;

        const id = getBibleChapterIdFromElement(anchor);
        if (!id) return;

        anchor.classList.add('jwvt-bible-chapter-link', 'jwvt-bible-chapter-processed');

        const checkbox = document.createElement('div');
        checkbox.className = 'jwvt-checkbox jwvt-bible-chapter-checkbox';
        checkbox.title = t.checkboxTitle;
        checkbox.dataset.jwvtId = id;

        checkbox.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleStudied(id);
        });

        anchor.appendChild(checkbox);
        syncControlsForVideo(id);
    }

    function isRealVideoLink(a) {
        const href = a.getAttribute('href') || '';
        if (!href) return false;

        if (href.includes('/categories/') || href.includes('#cs/categories/') || href.includes('#en/categories/')) {
            return false;
        }

        if (href.includes('/mediaitems/')) {
            return true;
        }

        return false;
    }

    function scanForVideos() {
        const candidates = document.querySelectorAll('.synopsis .syn-img a.jsNoScroll');

        candidates.forEach((a) => {
            if (!isRealVideoLink(a)) return;
            if (a.classList.contains('jwvt-processed')) return;
            if (!a.querySelector('img')) return;

            const id = getVideoIdFromUrl(a.href || '');
            if (!id) return;

            enhanceThumbnail(a, { id, showNotes: true });
        });
    }

    function scanForPublications() {
        const candidates = document.querySelectorAll('.synopsis.publication .syn-img a[href]');

        candidates.forEach((a) => {
            if (a.classList.contains('jwvt-processed')) return;
            if (!a.querySelector('img')) return;

            const id = getPublicationIdFromElement(a);
            if (!id) return;

            enhanceThumbnail(a, { id, showNotes: false });
        });
    }

    // ZDE ZMĚNA: přidána .synopsis.Reading – např. dětské komiksy
    function scanForArticles() {
        const candidates = document.querySelectorAll(
            '.synopsis.PublicationArticle .syn-img a[href], .synopsis.Reading .syn-img a[href]'
        );

        candidates.forEach((a) => {
            if (a.classList.contains('jwvt-processed')) return;
            if (!a.querySelector('img')) return;

            const id = getArticleIdFromElement(a);
            if (!id) return;

            enhanceThumbnail(a, { id, showNotes: false });
        });
    }

    function scanForBibleBooks() {
        // stránka s biblickými knihami – modré obdélníky
        const candidates = document.querySelectorAll('a.bibleBook[href]');
        candidates.forEach((a) => enhanceBibleBook(a));
    }

    function scanForBibleChapters() {
        // stránka s kapitolami knihy – čtverce s čísly
        const candidates = document.querySelectorAll('a.chapter[data-chapter][href]');
        candidates.forEach((a) => enhanceBibleChapter(a));
    }

    function createSingleVideoControls() {
        const href = location.href || '';
        if (!href.includes('/mediaitems/')) return;

        const videoId = getVideoIdFromUrl(href);
        if (!videoId) return;

        const titleContainer = document.querySelector('.mediaItemTitleContainer');
        if (!titleContainer) return;

        if (titleContainer.querySelector('.jwvt-single-video-controls')) return;

        const wrapper = document.createElement('div');
        wrapper.className = 'jwvt-single-video-controls';

        const label = document.createElement('span');
        label.className = 'jwvt-single-video-label';
        label.textContent = t.singleLabel;

        const checkbox = document.createElement('div');
        checkbox.className = 'jwvt-checkbox';
        checkbox.title = t.checkboxTitle;
        checkbox.dataset.jwvtId = videoId;

        const notesBtn = document.createElement('div');
        notesBtn.className = 'jwvt-notes-btn';
        notesBtn.textContent = '📝';
        notesBtn.title = t.notesTitle;
        notesBtn.dataset.jwvtId = videoId;

        checkbox.addEventListener('click', (e) => {
            e.preventDefault();
            toggleStudied(videoId);
        });

        notesBtn.addEventListener('click', (e) => {
            e.preventDefault();
            openNotesModal(videoId);
        });

        wrapper.appendChild(label);
        wrapper.appendChild(checkbox);
        wrapper.appendChild(notesBtn);

        titleContainer.appendChild(wrapper);

        syncControlsForVideo(videoId);
    }

    function createExportImportPanel() {
        const panel = document.createElement('div');
        panel.className = 'jwvt-export-import-panel';

        const label = document.createElement('span');
        label.textContent = t.panelLabel;

        const countSpan = document.createElement('span');
        countSpan.className = 'jwvt-studied-count';
        studiedCountSpan = countSpan;
        refreshStudiedCountUI();

        const exportBtn = document.createElement('button');
        exportBtn.textContent = t.exportBtn;

        const importBtn = document.createElement('button');
        importBtn.textContent = t.importBtn;

        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = 'application/json,application/*+json,.json';
        fileInput.style.display = 'none';

        exportBtn.addEventListener('click', () => {
            downloadBackupFile();
        });

        importBtn.addEventListener('click', () => {
            fileInput.click();
        });

        fileInput.addEventListener('change', (e) => {
            const file = e.target.files && e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = () => {
                try {
                    const text = reader.result;
                    const parsed = JSON.parse(text);

                    if (typeof parsed !== 'object' || Array.isArray(parsed)) {
                        throw new Error('Root of JSON is not an object.');
                    }

                    store = parsed;
                    saveStore();
                    refreshAllControls();
                    alert(t.importSuccess);

                } catch (err) {
                    alert(t.importErrorPrefix + err.message);
                } finally {
                    fileInput.value = '';
                }
            };

            reader.readAsText(file);
        });

        panel.appendChild(label);
        panel.appendChild(countSpan);
        panel.appendChild(exportBtn);
        panel.appendChild(importBtn);
        panel.appendChild(fileInput);

        document.body.appendChild(panel);
    }

    function init() {
        scanForVideos();
        scanForPublications();
        scanForArticles();
        scanForBibleBooks();
        scanForBibleChapters();
        createSingleVideoControls();
        createExportImportPanel();

        const observer = new MutationObserver(() => {
            scanForVideos();
            scanForPublications();
            scanForArticles();
            scanForBibleBooks();
            scanForBibleChapters();
            createSingleVideoControls();
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
