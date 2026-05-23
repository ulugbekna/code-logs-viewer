// Webview UI for the Code Logs Viewer.
// Vanilla TS + DOM, themed via VS Code CSS variables.

interface LogEntry {
    id: number;
    ts: number;
    tsRaw: string;
    level: string;
    source?: string;
    message: string;
    body: string[];
    bodyKind?: 'json' | 'text';
    groupStart?: string;
    groupEnd?: boolean;
}

type HostToWebview =
    | { type: 'init'; entries: LogEntry[]; fileName: string }
    | { type: 'update'; entries: LogEntry[]; fileName: string };

type WebviewToHost =
    | { type: 'reload' }
    | { type: 'info'; text: string };

declare function acquireVsCodeApi(): { postMessage: (m: WebviewToHost) => void; setState: (s: unknown) => void; getState: () => unknown };
const vscode = acquireVsCodeApi();

// ---------- State ----------
interface PersistedState {
    levels: Record<string, boolean>;
    sources: Record<string, boolean>;
    search: string;
    searchMode: 'highlight' | 'filter';
    regex: boolean;
    caseSensitive: boolean;
    wholeWord: boolean;
    timeMin?: number;
    timeMax?: number;
    expanded: number[];
}

const KNOWN_LEVELS = ['error', 'warning', 'info', 'debug', 'trace', 'log'];

const state: {
    entries: LogEntry[];
    filtered: LogEntry[];
    fileName: string;
    persisted: PersistedState;
    expanded: Set<number>;
    wrapped: Set<number>;
    wrapAll: boolean;
    prettyJson: Set<number>;       // entry.id -> show pretty-printed JSON extracted from message/body
    jsonCache: Map<number, unknown | null>; // memoize extraction (null = no JSON detected)
    matchPositions: number[];      // indices into `filtered` that contain matches
    currentMatchIdx: number;       // pointer within matchPositions
    rowHeights: Map<number, number>; // entry.id -> measured height (when expanded)
    defaultRowHeight: number;
    defaultRowHeightCalibrated: boolean;
    lastWindow: { first: number; last: number; topPad: number; bottomPad: number; sig: string } | undefined;
    diag: string[];
} = {
    entries: [],
    filtered: [],
    fileName: '',
    persisted: loadState(),
    expanded: new Set(),
    wrapped: new Set(),
    wrapAll: false,
    prettyJson: new Set(),
    jsonCache: new Map(),
    matchPositions: [],
    currentMatchIdx: -1,
    rowHeights: new Map(),
    defaultRowHeight: 22,
    defaultRowHeightCalibrated: false,
    lastWindow: undefined,
    diag: [],
};

state.expanded = new Set(state.persisted.expanded);

function loadState(): PersistedState {
    const s = vscode.getState() as Partial<PersistedState> | undefined;
    return {
        levels: s?.levels ?? {},
        sources: s?.sources ?? {},
        search: s?.search ?? '',
        searchMode: s?.searchMode ?? 'highlight',
        regex: s?.regex ?? false,
        caseSensitive: s?.caseSensitive ?? false,
        wholeWord: s?.wholeWord ?? false,
        timeMin: s?.timeMin,
        timeMax: s?.timeMax,
        expanded: s?.expanded ?? [],
    };
}

function saveState(): void {
    state.persisted.expanded = [...state.expanded];
    vscode.setState(state.persisted);
}

// ---------- DOM bootstrap ----------
const root = document.getElementById('root')!;
root.innerHTML = `
<div class="app">
	<header class="toolbar">
		<div class="search-group">
			<input id="search" type="text" placeholder="Search…" spellcheck="false" />
			<button class="icon-btn" id="opt-case" title="Match Case (Alt+C)">Aa</button>
			<button class="icon-btn" id="opt-word" title="Match Whole Word (Alt+W)">ab</button>
			<button class="icon-btn" id="opt-regex" title="Use Regular Expression (Alt+R)">.*</button>
			<button class="icon-btn" id="opt-wrap" title="Wrap long lines">↵</button>
			<span class="seg" role="group" aria-label="Search behavior">
				<button class="seg-btn" id="mode-highlight" title="Show all rows; highlight matches">Highlight</button>
				<button class="seg-btn" id="mode-filter" title="Show only rows that match">Filter</button>
			</span>
			<span id="match-count" class="muted"></span>
			<button class="icon-btn" id="match-prev" title="Previous match (Shift+Enter)">↑</button>
			<button class="icon-btn" id="match-next" title="Next match (Enter)">↓</button>
		</div>
		<button id="copy-filtered" title="Copy filtered entries">Copy filtered</button>
		<button id="clear-filters" title="Clear all filters">Clear</button>
		<div class="spacer"></div>
		<span id="counts" class="muted"></span>
		<button class="icon-btn" id="copy-diag" title="Copy diagnostic logs">Diag</button>
	</header>
	<canvas id="minimap" height="36"></canvas>
	<div class="body">
		<aside class="sidebar">
			<section>
				<h3>Level</h3>
				<div id="level-facets"></div>
			</section>
			<section>
				<h3>Source</h3>
				<input id="source-search" type="text" placeholder="Filter sources…" spellcheck="false" />
				<div id="source-facets" class="facets-list"></div>
			</section>
		</aside>
		<main class="list-wrap">
			<div id="list" class="list"></div>
		</main>
	</div>
	<footer class="status">
		<span id="status-text"></span>
	</footer>
	<div id="toast" class="toast"></div>
	<div id="ctx-menu" class="ctx-menu" role="menu" aria-hidden="true"></div>
</div>`;

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const els = {
    search: $<HTMLInputElement>('search'),
    optCase: $<HTMLButtonElement>('opt-case'),
    optWord: $<HTMLButtonElement>('opt-word'),
    optRegex: $<HTMLButtonElement>('opt-regex'),
    optWrap: $<HTMLButtonElement>('opt-wrap'),
    modeHighlight: $<HTMLButtonElement>('mode-highlight'),
    modeFilter: $<HTMLButtonElement>('mode-filter'),
    matchCount: $('match-count'),
    matchPrev: $<HTMLButtonElement>('match-prev'),
    matchNext: $<HTMLButtonElement>('match-next'),
    copyFiltered: $<HTMLButtonElement>('copy-filtered'),
    copyDiag: $<HTMLButtonElement>('copy-diag'),
    clearFilters: $<HTMLButtonElement>('clear-filters'),
    counts: $('counts'),
    minimap: $<HTMLCanvasElement>('minimap'),
    levelFacets: $('level-facets'),
    sourceFacets: $('source-facets'),
    sourceSearch: $<HTMLInputElement>('source-search'),
    list: $('list'),
    statusText: $('status-text'),
    toast: $('toast'),
    ctxMenu: $('ctx-menu'),
};

els.search.value = state.persisted.search;
toggleBtn(els.optCase, state.persisted.caseSensitive);
toggleBtn(els.optWord, state.persisted.wholeWord);
toggleBtn(els.optRegex, state.persisted.regex);
updateModeBtn();

// ---------- Events ----------
window.addEventListener('message', e => onHostMessage(e.data as HostToWebview));

let searchDebounce: number | undefined;
els.search.addEventListener('input', () => {
    state.persisted.search = els.search.value;
    saveState();
    window.clearTimeout(searchDebounce);
    searchDebounce = window.setTimeout(() => recomputeAndRender(), 100);
});
els.search.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
        e.preventDefault();
        gotoMatch(e.shiftKey ? -1 : +1);
    } else if (e.key === 'Escape') {
        els.search.value = '';
        state.persisted.search = '';
        saveState();
        recomputeAndRender();
    }
});

els.optCase.addEventListener('click', () => { state.persisted.caseSensitive = !state.persisted.caseSensitive; toggleBtn(els.optCase, state.persisted.caseSensitive); saveState(); recomputeAndRender(); });
els.optWord.addEventListener('click', () => { state.persisted.wholeWord = !state.persisted.wholeWord; toggleBtn(els.optWord, state.persisted.wholeWord); saveState(); recomputeAndRender(); });
els.optRegex.addEventListener('click', () => { state.persisted.regex = !state.persisted.regex; toggleBtn(els.optRegex, state.persisted.regex); saveState(); recomputeAndRender(); });
els.optWrap.addEventListener('click', () => {
    state.wrapAll = !state.wrapAll;
    toggleBtn(els.optWrap, state.wrapAll);
    els.list.classList.toggle('wrap-all', state.wrapAll);
    state.rowHeights.clear();
    renderListWindow();
});
function setSearchMode(mode: 'highlight' | 'filter'): void {
    if (state.persisted.searchMode === mode) { return; }
    state.persisted.searchMode = mode;
    updateModeBtn();
    saveState();
    recomputeAndRender();
}
els.modeHighlight.addEventListener('click', () => setSearchMode('highlight'));
els.modeFilter.addEventListener('click', () => setSearchMode('filter'));
els.matchPrev.addEventListener('click', () => gotoMatch(-1));
els.matchNext.addEventListener('click', () => gotoMatch(+1));
els.copyFiltered.addEventListener('click', copyFiltered);
els.copyDiag.addEventListener('click', copyDiag);
els.clearFilters.addEventListener('click', clearFilters);
els.sourceSearch.addEventListener('input', renderSourceFacets);

document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault(); els.search.focus(); els.search.select();
    }
});

// ---------- Host message handling ----------
function onHostMessage(msg: HostToWebview): void {
    if (msg.type === 'init' || msg.type === 'update') {
        state.entries = msg.entries;
        state.fileName = msg.fileName;
        state.jsonCache.clear();
        // On init, prune persisted facet selections for unknown values? Keep them — harmless.
        recomputeAndRender();
    }
}

// ---------- Filtering ----------
function buildSearchMatcher(): ((s: string) => boolean) | undefined {
    const q = state.persisted.search;
    if (!q) { return undefined; }
    let re: RegExp;
    try {
        const flags = state.persisted.caseSensitive ? 'g' : 'gi';
        if (state.persisted.regex) {
            re = new RegExp(q, flags);
        } else {
            let pattern = escapeRe(q);
            if (state.persisted.wholeWord) { pattern = `\\b${pattern}\\b`; }
            re = new RegExp(pattern, flags);
        }
    } catch {
        return () => false; // invalid regex → no matches
    }
    return (s: string) => { re.lastIndex = 0; return re.test(s); };
}

function escapeRe(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function entryText(e: LogEntry): string {
    return `${e.tsRaw} ${e.level} ${e.source ?? ''} ${e.message}\n${e.body.join('\n')}`;
}

function recompute(): void {
    const levels = state.persisted.levels;
    const sources = state.persisted.sources;
    const anyLevel = !Object.values(levels).some(v => v);
    const anySource = !Object.values(sources).some(v => v);
    const tMin = state.persisted.timeMin;
    const tMax = state.persisted.timeMax;
    const matcher = buildSearchMatcher();
    const filterBySearch = state.persisted.searchMode === 'filter';

    const out: LogEntry[] = [];
    const matchPositions: number[] = [];
    for (const e of state.entries) {
        if (!anyLevel && !levels[e.level]) { continue; }
        if (!anySource && !(e.source && sources[e.source])) { continue; }
        if (tMin !== undefined && e.ts && e.ts < tMin) { continue; }
        if (tMax !== undefined && e.ts && e.ts > tMax) { continue; }
        const isMatch = matcher ? matcher(entryText(e)) : false;
        if (matcher && filterBySearch && !isMatch) { continue; }
        if (isMatch) { matchPositions.push(out.length); }
        out.push(e);
    }
    state.filtered = out;
    state.matchPositions = matchPositions;
    if (matchPositions.length === 0) { state.currentMatchIdx = -1; }
    else if (state.currentMatchIdx < 0 || state.currentMatchIdx >= matchPositions.length) { state.currentMatchIdx = 0; }
}

function recomputeAndRender(): void {
    recompute();
    renderAll();
}

// ---------- Rendering ----------
function renderAll(): void {
    renderLevelFacets();
    renderSourceFacets();
    renderToolbar();
    renderMinimap();
    renderList();
    renderStatus();
}

function renderToolbar(): void {
    const total = state.entries.length;
    const shown = state.filtered.length;
    els.counts.textContent = `${shown.toLocaleString()} / ${total.toLocaleString()}`;
    if (state.persisted.search) {
        const n = state.matchPositions.length;
        els.matchCount.textContent = n === 0 ? 'No matches' : `${state.currentMatchIdx + 1} of ${n}`;
    } else {
        els.matchCount.textContent = '';
    }
}

function levelCounts(): Map<string, number> {
    const m = new Map<string, number>();
    for (const e of state.entries) { m.set(e.level, (m.get(e.level) ?? 0) + 1); }
    return m;
}

function sourceCounts(): Map<string, number> {
    const m = new Map<string, number>();
    for (const e of state.entries) { if (e.source) { m.set(e.source, (m.get(e.source) ?? 0) + 1); } }
    return m;
}

function renderLevelFacets(): void {
    const counts = levelCounts();
    const levels = [...new Set([...KNOWN_LEVELS, ...counts.keys()])];
    els.levelFacets.innerHTML = '';
    for (const lvl of levels) {
        const count = counts.get(lvl) ?? 0;
        if (count === 0 && !KNOWN_LEVELS.includes(lvl)) { continue; }
        const id = `lvl-${lvl}`;
        const wrap = document.createElement('label');
        wrap.className = `facet level-${lvl}`;
        wrap.innerHTML = `<input type="checkbox" id="${id}" ${state.persisted.levels[lvl] ? 'checked' : ''}/>
			<span class="badge level-${lvl}">${lvl}</span>
			<span class="count muted">${count}</span>`;
        const cb = wrap.querySelector('input') as HTMLInputElement;
        cb.addEventListener('change', () => {
            state.persisted.levels[lvl] = cb.checked;
            saveState();
            recomputeAndRender();
        });
        els.levelFacets.appendChild(wrap);
    }
}

function renderSourceFacets(): void {
    const counts = sourceCounts();
    const filter = els.sourceSearch.value.toLowerCase();
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    els.sourceFacets.innerHTML = '';
    for (const [src, count] of sorted) {
        if (filter && !src.toLowerCase().includes(filter)) { continue; }
        const wrap = document.createElement('label');
        wrap.className = 'facet';
        wrap.innerHTML = `<input type="checkbox" ${state.persisted.sources[src] ? 'checked' : ''}/>
			<span class="src" title="${escapeHtml(src)}">${escapeHtml(src)}</span>
			<span class="count muted">${count}</span>`;
        const cb = wrap.querySelector('input') as HTMLInputElement;
        cb.addEventListener('change', () => {
            state.persisted.sources[src] = cb.checked;
            saveState();
            recomputeAndRender();
        });
        els.sourceFacets.appendChild(wrap);
    }
}

// ---------- Virtualized list ----------
// Strategy: maintain a top spacer + visible chunk + bottom spacer based on
// scrollTop. Rows have estimated height; expanded rows get measured.

let pendingRender = false;
els.list.addEventListener('scroll', () => {
    diag('scroll', { st: els.list.scrollTop, sh: els.list.scrollHeight, ch: els.list.clientHeight });
    if (pendingRender) { return; }
    pendingRender = true;
    requestAnimationFrame(() => { pendingRender = false; renderListWindow(); });
});

const listInner = document.createElement('div');
listInner.className = 'list-inner';
const visibleHost = document.createElement('div');
visibleHost.className = 'visible-host';
listInner.appendChild(visibleHost);
els.list.appendChild(listInner);

function rowHeight(e: LogEntry): number {
    if (state.expanded.has(e.id) || state.prettyJson.has(e.id) || state.wrapped.has(e.id) || state.wrapAll) {
        return state.rowHeights.get(e.id) ?? state.defaultRowHeight;
    }
    return state.defaultRowHeight;
}

function renderList(): void { renderListWindow(); }

function renderListWindow(): void {
    const viewportH = els.list.clientHeight;
    const scrollTop = els.list.scrollTop;
    const overscan = 10;

    // Compute cumulative offsets for ALL rows. This is O(N) per render but
    // N is small (<50k entries) and gives us a stable, explicit total height
    // that doesn't depend on which rows are currently in the DOM.
    const offsets = new Array<number>(state.filtered.length + 1);
    let acc = 0;
    for (let i = 0; i < state.filtered.length; i++) {
        offsets[i] = acc;
        acc += rowHeight(state.filtered[i]);
    }
    offsets[state.filtered.length] = acc;
    const totalHeight = acc;

    // Binary search for first visible index.
    let lo = 0, hi = state.filtered.length;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (offsets[mid + 1] <= scrollTop) { lo = mid + 1; } else { hi = mid; }
    }
    let firstIdx = lo;
    let lastIdx = firstIdx;
    while (lastIdx < state.filtered.length && offsets[lastIdx] < scrollTop + viewportH + state.defaultRowHeight * overscan) {
        lastIdx++;
    }
    firstIdx = Math.max(0, firstIdx - overscan);

    const sig = `${firstIdx}|${lastIdx}|${state.expanded.size}|${state.wrapped.size}|${state.prettyJson.size}|${state.wrapAll ? 1 : 0}|${state.currentMatchIdx}|${state.persisted.search}`;
    const lw = state.lastWindow;
    if (lw && lw.first === firstIdx && lw.last === lastIdx && lw.sig === sig && lw.topPad === totalHeight && lw.bottomPad === 0) {
        return;
    }

    // Set explicit total height; visible rows are absolutely positioned within.
    listInner.style.height = `${totalHeight}px`;

    visibleHost.innerHTML = '';
    const matchSet = new Set(state.matchPositions);
    for (let i = firstIdx; i < lastIdx; i++) {
        const e = state.filtered[i];
        const row = renderRow(e, i, matchSet.has(i));
        row.style.position = 'absolute';
        row.style.top = `${offsets[i]}px`;
        row.style.left = '0';
        row.style.right = '0';
        visibleHost.appendChild(row);
    }

    let measuredAny = false;
    for (const child of Array.from(visibleHost.children)) {
        const idStr = (child as HTMLElement).dataset.id;
        if (!idStr) { continue; }
        const id = Number(idStr);
        const needsMeasure = state.expanded.has(id) || state.prettyJson.has(id) || state.wrapped.has(id) || state.wrapAll;
        if (needsMeasure && !state.rowHeights.has(id)) {
            state.rowHeights.set(id, (child as HTMLElement).getBoundingClientRect().height);
            measuredAny = true;
        }
        if (!state.defaultRowHeightCalibrated && !needsMeasure) {
            const h = (child as HTMLElement).getBoundingClientRect().height;
            if (h > 0) {
                state.defaultRowHeight = h;
                state.defaultRowHeightCalibrated = true;
                measuredAny = true;
            }
        }
    }

    state.lastWindow = { first: firstIdx, last: lastIdx, topPad: totalHeight, bottomPad: 0, sig };
    diag('render', { firstIdx, lastIdx, totalHeight, sh: els.list.scrollHeight, st: els.list.scrollTop, drh: state.defaultRowHeight, calibrated: state.defaultRowHeightCalibrated, measuredAny });
    if (measuredAny) {
        state.lastWindow = undefined;
        renderListWindow();
    }
}

function renderRow(e: LogEntry, filteredIdx: number, isMatch: boolean): HTMLElement {
    const row = document.createElement('div');
    row.className = `row level-${e.level}`;
    row.dataset.id = String(e.id);
    if (isMatch) { row.classList.add('match'); }
    if (state.matchPositions[state.currentMatchIdx] === filteredIdx) { row.classList.add('current-match'); }
    if (e.groupStart !== undefined) { row.classList.add('group-start'); }
    if (e.groupEnd) { row.classList.add('group-end'); }
    if (state.wrapped.has(e.id)) { row.classList.add('wrapped'); }

    const expanded = state.expanded.has(e.id);
    const pretty = state.prettyJson.has(e.id);
    const hasBody = e.body.length > 0;
    const showBody = (expanded && hasBody) || pretty;
    const caretActive = hasBody || pretty;

    const head = document.createElement('div');
    head.className = 'row-head';
    if (caretActive) { head.classList.add('expandable'); } else { head.classList.add('wrappable'); }
    head.innerHTML = `
		<span class="caret">${caretActive ? (showBody ? '▾' : '▸') : ''}</span>
		<span class="ts">${e.tsRaw.slice(11)}</span>
		<span class="badge level-${e.level}">${e.level}</span>
		${e.source ? `<span class="src-chip" data-src="${escapeHtml(e.source)}">${escapeHtml(e.source)}</span>` : ''}
		<span class="msg">${highlight(e.message)}</span>`;
    row.appendChild(head);

    // Listener on the row so clicks anywhere in the header strip toggle
    // reliably. Clicks inside the body or on the source chip are ignored.
    row.addEventListener('click', ev => {
        const t = ev.target as HTMLElement;
        if (t.closest('.row-body')) { return; }
        if (t.closest('.src-chip')) { return; }
        if (pretty) {
            // Collapsing a pretty-json row also turns off pretty mode.
            togglePrettyJson(e.id, false);
        } else if (hasBody) {
            toggleExpand(e.id);
        } else if (extractJson(e) !== undefined) {
            // No body, but the message contains a JSON blob — show it
            // pretty-printed instead of wrapping the long line.
            togglePrettyJson(e.id, true);
        } else {
            toggleWrap(e.id);
        }
    });
    row.addEventListener('contextmenu', ev => {
        if ((ev.target as HTMLElement).closest('.src-chip')) { return; }
        openRowContextMenu(ev, e);
    });
    const chip = head.querySelector('.src-chip') as HTMLElement | null;
    if (chip) {
        chip.addEventListener('click', ev => {
            ev.stopPropagation();
            const src = chip.dataset.src!;
            // Solo select that source.
            state.persisted.sources = { [src]: true };
            saveState();
            recomputeAndRender();
        });
    }

    if (showBody) {
        const bodyEl = document.createElement('div');
        bodyEl.className = 'row-body';
        if (pretty) {
            const parsed = extractJson(e);
            if (parsed !== undefined) {
                bodyEl.appendChild(renderJson(parsed));
            } else {
                bodyEl.appendChild(renderTextBody(e.body.length > 0 ? e.body : [e.message]));
            }
        } else if (e.bodyKind === 'json') {
            const joined = e.body.join('\n').trim();
            try {
                const parsed = JSON.parse(joined);
                bodyEl.appendChild(renderJson(parsed));
            } catch {
                bodyEl.appendChild(renderTextBody(e.body));
            }
        } else {
            bodyEl.appendChild(renderTextBody(e.body));
        }
        row.appendChild(bodyEl);
    }

    return row;
}

function toggleExpand(id: number): void {
    const anchor = captureAnchor(id);
    if (state.expanded.has(id)) {
        state.expanded.delete(id);
        state.rowHeights.delete(id);
    } else {
        state.expanded.add(id);
        preMeasure(id);
    }
    saveState();
    renderListWindow();
    restoreAnchor(id, anchor);
}

function toggleWrap(id: number): void {
    const anchor = captureAnchor(id);
    if (state.wrapped.has(id)) { state.wrapped.delete(id); }
    else { state.wrapped.add(id); preMeasure(id); }
    if (!state.wrapped.has(id) && !state.expanded.has(id) && !state.wrapAll) { state.rowHeights.delete(id); }
    renderListWindow();
    restoreAnchor(id, anchor);
}

function togglePrettyJson(id: number, on: boolean): void {
    const anchor = captureAnchor(id);
    if (on) {
        state.prettyJson.add(id);
        state.rowHeights.delete(id);
        preMeasure(id);
    } else {
        state.prettyJson.delete(id);
        if (!state.expanded.has(id) && !state.wrapped.has(id) && !state.wrapAll) {
            state.rowHeights.delete(id);
        }
    }
    renderListWindow();
    restoreAnchor(id, anchor);
}

// Find a JSON value embedded anywhere in the entry's message or body.
// Returns the parsed value (object/array/primitive) or undefined if none.
function extractJson(e: LogEntry): unknown | undefined {
    const cached = state.jsonCache.get(e.id);
    if (cached !== undefined) { return cached === null ? undefined : cached; }
    const parsed = computeExtractedJson(e);
    state.jsonCache.set(e.id, parsed === undefined ? null : parsed);
    return parsed;
}

function computeExtractedJson(e: LogEntry): unknown | undefined {
    // 1. Body that is already JSON-shaped.
    if (e.body.length > 0) {
        const joined = e.body.join('\n').trim();
        if (joined.startsWith('{') || joined.startsWith('[')) {
            try { return JSON.parse(joined); } catch { /* fall through */ }
        }
    }
    // 2. JSON embedded in the message (header line). Find first '{' or '['
    // and try parsing the largest balanced substring starting there.
    const msg = e.message;
    for (let i = 0; i < msg.length; i++) {
        const c = msg[i];
        if (c !== '{' && c !== '[') { continue; }
        const balanced = sliceBalancedJson(msg, i);
        if (!balanced) { continue; }
        try { return JSON.parse(balanced); } catch { /* keep searching */ }
    }
    return undefined;
}

function sliceBalancedJson(s: string, start: number): string | undefined {
    const open = s[start];
    const close = open === '{' ? '}' : ']';
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < s.length; i++) {
        const c = s[i];
        if (esc) { esc = false; continue; }
        if (inStr) {
            if (c === '\\') { esc = true; }
            else if (c === '"') { inStr = false; }
            continue;
        }
        if (c === '"') { inStr = true; continue; }
        if (c === open) { depth++; }
        else if (c === close) {
            depth--;
            if (depth === 0) { return s.slice(start, i + 1); }
        }
    }
    return undefined;
}

// ---------- Context menu ----------
function openRowContextMenu(ev: MouseEvent, e: LogEntry): void {
    ev.preventDefault();
    const menu = els.ctxMenu;
    menu.innerHTML = '';
    const items: { label: string; action: () => void; disabled?: boolean }[] = [];

    const hasJson = extractJson(e) !== undefined;
    const isPretty = state.prettyJson.has(e.id);
    items.push({
        label: isPretty ? 'Show raw' : 'Pretty-print JSON',
        action: () => togglePrettyJson(e.id, !isPretty),
        disabled: !hasJson && !isPretty,
    });

    for (const item of items) {
        const el = document.createElement('div');
        el.className = 'ctx-item';
        if (item.disabled) { el.classList.add('disabled'); }
        el.textContent = item.label;
        el.setAttribute('role', 'menuitem');
        if (!item.disabled) {
            el.addEventListener('click', () => { item.action(); closeContextMenu(); });
        }
        menu.appendChild(el);
    }

    // Position the menu, keeping it within the viewport.
    menu.style.visibility = 'hidden';
    menu.classList.add('show');
    menu.setAttribute('aria-hidden', 'false');
    const rect = menu.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const x = Math.min(ev.clientX, vw - rect.width - 4);
    const y = Math.min(ev.clientY, vh - rect.height - 4);
    menu.style.left = `${Math.max(0, x)}px`;
    menu.style.top = `${Math.max(0, y)}px`;
    menu.style.visibility = '';
}

function closeContextMenu(): void {
    const menu = els.ctxMenu;
    menu.classList.remove('show');
    menu.setAttribute('aria-hidden', 'true');
    menu.innerHTML = '';
}

document.addEventListener('click', ev => {
    if (!els.ctxMenu.classList.contains('show')) { return; }
    if ((ev.target as HTMLElement).closest('#ctx-menu')) { return; }
    closeContextMenu();
});
document.addEventListener('contextmenu', ev => {
    if ((ev.target as HTMLElement).closest('.row')) { return; }
    closeContextMenu();
});
document.addEventListener('keydown', ev => {
    if (ev.key === 'Escape') { closeContextMenu(); }
});
els.list.addEventListener('scroll', closeContextMenu);

// Render the row off-screen (but inside the list, with the same width) to
// measure its real height before it scrolls into the visible window. This
// avoids height surprises during scroll, which would otherwise cause the
// virtual list spacers to oscillate and the page to flicker.
function preMeasure(id: number): void {
    const e = state.entries.find(x => x.id === id);
    if (!e) { return; }
    const idx = state.filtered.indexOf(e);
    const probe = renderRow(e, idx, false);
    probe.style.position = 'absolute';
    probe.style.visibility = 'hidden';
    probe.style.left = '0';
    probe.style.top = '0';
    probe.style.width = `${els.list.clientWidth}px`;
    els.list.appendChild(probe);
    state.rowHeights.set(id, probe.getBoundingClientRect().height);
    probe.remove();
}

function captureAnchor(id: number): number | undefined {
    const el = els.list.querySelector(`.row[data-id="${id}"]`) as HTMLElement | null;
    if (!el) { return undefined; }
    return el.getBoundingClientRect().top - els.list.getBoundingClientRect().top;
}

function restoreAnchor(id: number, prevTop: number | undefined): void {
    if (prevTop === undefined) { return; }
    const el = els.list.querySelector(`.row[data-id="${id}"]`) as HTMLElement | null;
    if (!el) { return; }
    const newTop = el.getBoundingClientRect().top - els.list.getBoundingClientRect().top;
    const delta = newTop - prevTop;
    if (delta !== 0) { els.list.scrollTop += delta; }
}

function renderTextBody(body: string[]): HTMLElement {
    const pre = document.createElement('pre');
    pre.className = 'body-text';
    pre.innerHTML = body.map(l => highlight(l)).join('\n');
    return pre;
}

function renderJson(value: unknown, key?: string): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'json';
    wrap.appendChild(renderJsonNode(value, key, 0));
    return wrap;
}

function renderJsonNode(value: unknown, key: string | undefined, depth: number): HTMLElement {
    const node = document.createElement('div');
    node.className = 'json-node';
    node.style.paddingLeft = `${depth * 12}px`;
    const k = key !== undefined ? `<span class="json-key">${escapeHtml(key)}</span>: ` : '';
    if (value === null) { node.innerHTML = `${k}<span class="json-null">null</span>`; return node; }
    if (typeof value === 'string') { node.innerHTML = `${k}<span class="json-string">${highlight(JSON.stringify(value))}</span>`; return node; }
    if (typeof value === 'number' || typeof value === 'boolean') { node.innerHTML = `${k}<span class="json-${typeof value}">${String(value)}</span>`; return node; }
    if (Array.isArray(value)) {
        const head = document.createElement('div');
        head.className = 'json-collapsible';
        head.innerHTML = `${k}<span class="json-toggle">▾</span> <span class="json-bracket">[</span> <span class="muted">${value.length} items</span>`;
        node.appendChild(head);
        const children = document.createElement('div');
        for (let i = 0; i < value.length; i++) { children.appendChild(renderJsonNode(value[i], String(i), depth + 1)); }
        node.appendChild(children);
        const close = document.createElement('div');
        close.style.paddingLeft = `${depth * 12}px`;
        close.innerHTML = `<span class="json-bracket">]</span>`;
        node.appendChild(close);
        head.addEventListener('click', () => {
            const collapsed = children.style.display === 'none';
            children.style.display = collapsed ? '' : 'none';
            close.style.display = collapsed ? '' : 'none';
            (head.querySelector('.json-toggle') as HTMLElement).textContent = collapsed ? '▾' : '▸';
        });
        return node;
    }
    if (typeof value === 'object') {
        const obj = value as Record<string, unknown>;
        const keys = Object.keys(obj);
        const head = document.createElement('div');
        head.className = 'json-collapsible';
        head.innerHTML = `${k}<span class="json-toggle">▾</span> <span class="json-bracket">{</span> <span class="muted">${keys.length} keys</span>`;
        node.appendChild(head);
        const children = document.createElement('div');
        for (const ck of keys) { children.appendChild(renderJsonNode(obj[ck], ck, depth + 1)); }
        node.appendChild(children);
        const close = document.createElement('div');
        close.style.paddingLeft = `${depth * 12}px`;
        close.innerHTML = `<span class="json-bracket">}</span>`;
        node.appendChild(close);
        head.addEventListener('click', () => {
            const collapsed = children.style.display === 'none';
            children.style.display = collapsed ? '' : 'none';
            close.style.display = collapsed ? '' : 'none';
            (head.querySelector('.json-toggle') as HTMLElement).textContent = collapsed ? '▾' : '▸';
        });
        return node;
    }
    node.textContent = String(value);
    return node;
}

// ---------- Highlighting ----------
function highlight(text: string): string {
    const matcher = state.persisted.search;
    const safe = escapeHtml(text);
    if (!matcher) { return safe; }
    let re: RegExp;
    try {
        const flags = state.persisted.caseSensitive ? 'g' : 'gi';
        if (state.persisted.regex) { re = new RegExp(matcher, flags); }
        else {
            let pattern = escapeRe(matcher);
            if (state.persisted.wholeWord) { pattern = `\\b${pattern}\\b`; }
            re = new RegExp(pattern, flags);
        }
    } catch { return safe; }
    return safe.replace(re, m => `<mark>${m}</mark>`);
}

function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, c => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;'));
}

// ---------- Minimap ----------
function renderMinimap(): void {
    const c = els.minimap;
    const dpr = window.devicePixelRatio || 1;
    const cssW = c.clientWidth || c.parentElement!.clientWidth;
    c.width = Math.max(1, Math.floor(cssW * dpr));
    c.height = Math.floor(36 * dpr);
    const ctx = c.getContext('2d');
    if (!ctx) { return; }
    ctx.scale(dpr, dpr);
    const w = cssW;
    const h = 36;
    ctx.clearRect(0, 0, w, h);

    if (state.entries.length === 0) { return; }
    const tsList = state.entries.map(e => e.ts).filter(t => t > 0);
    if (tsList.length === 0) { return; }
    const tMin = Math.min(...tsList);
    const tMax = Math.max(...tsList);
    const range = Math.max(1, tMax - tMin);

    const bins = Math.max(40, Math.floor(w));
    const counts = new Array<{ error: number; warning: number; info: number; other: number }>(bins);
    for (let i = 0; i < bins; i++) { counts[i] = { error: 0, warning: 0, info: 0, other: 0 }; }
    const filteredSet = new Set(state.filtered.map(e => e.id));

    for (const e of state.entries) {
        if (!e.ts) { continue; }
        const b = Math.min(bins - 1, Math.floor(((e.ts - tMin) / range) * bins));
        const slot = e.level === 'error' ? 'error' : e.level === 'warning' ? 'warning' : e.level === 'info' ? 'info' : 'other';
        counts[b][slot] += filteredSet.has(e.id) ? 1 : 0.15;
    }

    const max = counts.reduce((m, c) => Math.max(m, c.error + c.warning + c.info + c.other), 1);
    const colors = {
        error: cssVar('--vscode-errorForeground', '#f14c4c'),
        warning: cssVar('--vscode-editorWarning-foreground', '#cca700'),
        info: cssVar('--vscode-charts-blue', '#3794ff'),
        other: cssVar('--vscode-descriptionForeground', '#888'),
    };
    const colW = w / bins;
    for (let i = 0; i < bins; i++) {
        const c2 = counts[i];
        const total = c2.error + c2.warning + c2.info + c2.other;
        if (total === 0) { continue; }
        let yTop = h - (total / max) * h;
        const x = i * colW;
        for (const k of ['error', 'warning', 'info', 'other'] as const) {
            const seg = (c2[k] / total) * (h - yTop);
            ctx.fillStyle = colors[k];
            ctx.fillRect(x, yTop, Math.max(1, colW), seg);
            yTop += seg;
        }
    }

    // Brush overlay
    if (state.persisted.timeMin !== undefined || state.persisted.timeMax !== undefined) {
        const xMin = state.persisted.timeMin !== undefined ? ((state.persisted.timeMin - tMin) / range) * w : 0;
        const xMax = state.persisted.timeMax !== undefined ? ((state.persisted.timeMax - tMin) / range) * w : w;
        ctx.fillStyle = cssVar('--vscode-editor-selectionBackground', 'rgba(100,150,255,0.2)');
        ctx.fillRect(xMin, 0, Math.max(1, xMax - xMin), h);
    }

    // Brush handlers
    c.onmousedown = (ev) => {
        const rect = c.getBoundingClientRect();
        const startX = ev.clientX - rect.left;
        const onMove = (mv: MouseEvent) => {
            const curX = Math.max(0, Math.min(rect.width, mv.clientX - rect.left));
            const a = Math.min(startX, curX); const b = Math.max(startX, curX);
            state.persisted.timeMin = tMin + (a / rect.width) * range;
            state.persisted.timeMax = tMin + (b / rect.width) * range;
            saveState();
            recomputeAndRender();
        };
        const onUp = () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    };
    c.ondblclick = () => {
        state.persisted.timeMin = undefined;
        state.persisted.timeMax = undefined;
        saveState();
        recomputeAndRender();
    };
}

function cssVar(name: string, fallback: string): string {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
}

// ---------- Status ----------
function renderStatus(): void {
    const total = state.entries.length;
    const shown = state.filtered.length;
    let span = '';
    if (state.filtered.length) {
        const first = state.filtered.find(e => e.ts)?.tsRaw ?? '';
        const last = [...state.filtered].reverse().find(e => e.ts)?.tsRaw ?? '';
        if (first && last) { span = ` · ${first} → ${last}`; }
    }
    els.statusText.textContent = `${state.fileName} · ${shown.toLocaleString()} of ${total.toLocaleString()} entries${span}`;
}

// ---------- Search nav ----------
function gotoMatch(dir: -1 | 1): void {
    const n = state.matchPositions.length;
    if (n === 0) { return; }
    state.currentMatchIdx = (state.currentMatchIdx + dir + n) % n;
    const targetIdx = state.matchPositions[state.currentMatchIdx];
    scrollToFilteredIndex(targetIdx);
    renderToolbar();
    renderListWindow();
}

function scrollToFilteredIndex(idx: number): void {
    let y = 0;
    for (let i = 0; i < idx; i++) { y += rowHeight(state.filtered[i]); }
    els.list.scrollTop = Math.max(0, y - els.list.clientHeight / 3);
}

// ---------- Copy filtered ----------
function copyFiltered(): void {
    const text = state.filtered.map(serializeEntry).join('\n');
    void navigator.clipboard.writeText(text).then(() => {
        showToast(`Copied ${state.filtered.length.toLocaleString()} entries`);
        vscode.postMessage({ type: 'info', text: `Copied ${state.filtered.length} log entries to clipboard.` });
    }).catch(() => {
        showToast('Copy failed');
    });
}

function copyDiag(): void {
    const lines = [
        `# code-logs-viewer diagnostics`,
        `entries=${state.entries.length} filtered=${state.filtered.length}`,
        `expanded=${state.expanded.size} wrapped=${state.wrapped.size} wrapAll=${state.wrapAll}`,
        `viewportH=${els.list.clientHeight} listW=${els.list.clientWidth} dpr=${window.devicePixelRatio}`,
        `scrollTop=${els.list.scrollTop} scrollHeight=${els.list.scrollHeight}`,
        `defaultRowHeight=${state.defaultRowHeight} calibrated=${state.defaultRowHeightCalibrated}`,
        `levels=${JSON.stringify(state.persisted.levels)}`,
        `sources=${JSON.stringify(state.persisted.sources)}`,
        `search=${JSON.stringify(state.persisted.search)} mode=${state.persisted.searchMode}`,
        ``,
        `# events (last ${state.diag.length})`,
        ...state.diag,
    ];
    void navigator.clipboard.writeText(lines.join('\n')).then(() => showToast('Copied diagnostics'));
}

function diag(kind: string, info: Record<string, unknown>): void {
    const line = `${performance.now().toFixed(0)} ${kind} ${JSON.stringify(info)}`;
    state.diag.push(line);
    if (state.diag.length > 500) { state.diag.splice(0, state.diag.length - 500); }
}

function serializeEntry(e: LogEntry): string {
    const sourcePart = e.source ? ` [${e.source}]` : '';
    const head = e.tsRaw ? `${e.tsRaw} [${e.level}]${sourcePart} ${e.message}` : e.message;
    return [head, ...e.body].join('\n');
}

function clearFilters(): void {
    state.persisted.levels = {};
    state.persisted.sources = {};
    state.persisted.search = '';
    state.persisted.timeMin = undefined;
    state.persisted.timeMax = undefined;
    els.search.value = '';
    saveState();
    recomputeAndRender();
}

// ---------- Toast ----------
let toastTimer: number | undefined;
function showToast(text: string): void {
    els.toast.textContent = text;
    els.toast.classList.add('show');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => els.toast.classList.remove('show'), 2000);
}

// ---------- Helpers ----------
function toggleBtn(b: HTMLButtonElement, on: boolean): void { b.classList.toggle('active', on); }
function updateModeBtn(): void {
    const isFilter = state.persisted.searchMode === 'filter';
    els.modeHighlight.classList.toggle('active', !isFilter);
    els.modeFilter.classList.toggle('active', isFilter);
}

// ---------- Resize ----------
window.addEventListener('resize', () => { state.rowHeights.clear(); renderMinimap(); renderListWindow(); });
