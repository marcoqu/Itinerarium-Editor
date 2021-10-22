import {
    Timeline,
    TimelineRow,
    TimelineDragEvent,
    TimelineClickEvent,
    TimelineScrollEvent,
    TimelineTimeChangedEvent,
    TimelineEventSource,
    TimelineKeyframeShape,
    TimelineModel,
    TimelineKeyframe,
    TimelineElementDragState,
} from 'animation-timeline-js';

import { SyncEvent } from 'ts-events';

import {
    ViewportManager,
    IContentData,
    IMapScrollerContent,
    InterpolationStop,
    ParsedInterpolationStop,
} from 'itinerarium';

export interface IEditorContent<DataT extends IContentData = IContentData> extends IMapScrollerContent {
    setDestination?(time: number): void;
    getLabel?(): string | undefined;
    getData(): DataT | undefined;
    getType(): string | undefined;
    getInterpolators(): Record<string, IInterpolator<unknown>>;
}

export interface IInterpolator<T> {
    getStops(): ParsedInterpolationStop<T>[];
}

interface TModel extends TimelineModel {
    rows: TRow[];
}

interface TKey extends TimelineKeyframe {
    keyIdx: number;
    type: 'start' | 'end' | 'absolute';
}

interface TRowModule extends TimelineRow {
    type: 'module';
    contentType?: IContentData['type'];
    label?: string;
    moduleIdx: number;
    keyframes?: TKey[];
}

interface TRowProperty extends TimelineRow {
    type: 'property';
    propertyName: string;
    label?: string;
    moduleIdx: number;
    keyframes?: TKey[];
}

type TRow = TRowModule | TRowProperty;

export class Editor<ContentT extends IEditorContent = IEditorContent> {
    public seek = new SyncEvent<number>();

    private _container: HTMLDivElement;
    private _textarea: HTMLTextAreaElement;
    private _timelineEl: HTMLDivElement;
    private _outlineEl: HTMLDivElement;
    private _outlineItemsEl: HTMLDivElement;
    private _outlineHeaderEl: HTMLDivElement;
    private _outlineScrollEl: HTMLDivElement;
    private _errorMsg: HTMLDivElement;
    private _updateButtonHandler?: (this: HTMLElement, ev: Event) => Promise<void>;

    private _expandedRows: Array<boolean | undefined> = [];
    private _timelineModel: TModel = { rows: [] };
    private _contents: ContentT[] = [];

    private _timeline!: Timeline;
    private _vm: ViewportManager;
    private _dirty = true;

    public constructor(container: HTMLDivElement) {
        this._container = container;
        this._vm = new ViewportManager();
        this._vm.resizeEnd.attach(this, this._onResizeEnd);

        this._timelineEl = this._container.querySelector('.timeline') as HTMLDivElement;
        this._outlineEl = this._container.querySelector('.outline') as HTMLDivElement;
        this._outlineItemsEl = this._container.querySelector('.outline-items') as HTMLDivElement;
        this._outlineHeaderEl = this._container.querySelector('.outline-header') as HTMLDivElement;
        this._outlineScrollEl = this._container.querySelector('.outline-scroll') as HTMLDivElement;
        this._textarea = this._container.querySelector('.editor-property textarea') as HTMLTextAreaElement;
        this._errorMsg = this._container.querySelector('.update-error') as HTMLDivElement;
        this._textarea.addEventListener('keydown', (e) => e.stopImmediatePropagation());

        this._initTimeline();
        this._redrawLoop();
    }

    public addContent(content: ContentT): void {
        if (this._contents.includes(content)) return;
        content.intervalChanged.attach(this, this._onContentsChanged);
        this._contents.push(content);
        const empty = Array(this._contents.length).fill(false);
        Object.assign(empty, this._expandedRows);
        this._onContentsChanged();
    }

    public removeContent(content: ContentT): void {
        const idx = this._contents.indexOf(content);
        if (idx === -1) return;
        content.intervalChanged.detach(this, this._onContentsChanged);
        this._contents.splice(idx, 1);
        this._expandedRows.splice(idx, 1);
        this._onContentsChanged();
    }

    public setTime(currentTime: number): void {
        this._timeline.setTime(currentTime);
    }

    public reset(): void {
        this._contents.length = 0;
        this._expandedRows.length = 0;
        this._timeline.setTime(0);
    }

    private _redrawLoop(): void {
        window.requestAnimationFrame(() => this._redrawLoop());
        if (this._dirty) {
            this._redrawTimeline();
            this._redrawOutline();
            this._dirty = false;
        }
    }

    private _redrawTimeline(): void {
        this._timelineModel.rows.length = 0;
        this._contents.forEach((content, moduleIdx) => {
            this._timelineModel.rows.push(this._rowFromContent(content, moduleIdx));
            const interpolators = content.getInterpolators();
            for (const propertyName in interpolators) {
                const interpolator = interpolators[propertyName] as IInterpolator<unknown>;
                this._timelineModel.rows.push(this._rowFromProperty(content, moduleIdx, propertyName, interpolator));
            }
        });
        this._timeline.redraw();
        this._timeline.rescale();
        window.document.body.classList.remove('loading');
    }

    private _redrawOutline(): void {
        const opts = this._timeline.getOptions();
        this._outlineItemsEl.innerHTML = '';
        this._timelineModel.rows.forEach((row, idx) => {
            const div = document.createElement('div');
            div.addEventListener('click', () => this._toggleGroup(row.moduleIdx));
            div.classList.add('outline-node', row.type);
            div.style.display = row.hidden ? 'none' : 'block';
            div.style.maxHeight = div.style.minHeight = opts.rowsStyle?.height + 'px';
            div.style.marginBottom = opts.rowsStyle?.marginBottom + 'px';
            div.innerText = row.label || idx.toString();
            div.title = row.label || idx.toString();
            this._outlineItemsEl.appendChild(div);
        });
    }

    private _rowFromContent(content: ContentT, moduleIdx: number): TRowModule {
        return {
            type: 'module',
            contentType: content.getType(),
            label: content.getLabel?.() ?? content.getType(),
            hidden: false,
            keyframesStyle: moduleKeyframeStyle,
            moduleIdx: moduleIdx,
            keyframes: [
                { val: content.low, keyIdx: 0, type: 'absolute' },
                { val: content.high, keyIdx: 1, type: 'absolute' },
            ],
        };
    }

    private _rowFromProperty(
        content: ContentT,
        moduleIdx: number,
        propertyName: string,
        interpolator: IInterpolator<unknown>,
    ): TRowProperty {
        return {
            type: 'property',
            label: propertyName,
            min: content.low,
            max: content.high,
            hidden: !this._expandedRows[moduleIdx],
            moduleIdx: moduleIdx,
            keyframesStyle: propertyKeyframeStyle,
            groupFillColor: 'transparent',
            propertyName: propertyName,
            keyframes: interpolator.getStops().map((s, keyIdx) => ({
                val: s.absolutePosition,
                keyIdx,
                type: s.type,
                group: propertyName + keyIdx,
            })),
        };
    }

    private _initTimeline() {
        this._timeline = new Timeline({ ...timelineOpts, id: this._timelineEl }, this._timelineModel);

        this._timeline.onDragFinished((d) => this._onDragFinished(d));
        this._timeline.onDrag((d) => this._onDrag(d));
        this._timeline.onMouseDown((d) => this._onMouseDown(d));
        this._timeline.onScroll((d) => this._onScroll(d));
        this._timeline.onTimeChanged((d) => this._onTimeChanged(d));

        this._outlineHeaderEl.style.flexBasis = this._timeline.getOptions().headerHeight + 'px';
        this._outlineScrollEl.onwheel = (e) => this._onOutlineMouseWheel(e);

        window.addEventListener('keydown', (e) => this._onKeyPress(e), { capture: true });
    }

    //#region HANDLERS

    private _onKeyPress(e: KeyboardEvent): void {
        if ((e.target as HTMLElement)?.tagName?.toLowerCase() === 'textarea') return;
        switch (e.key) {
            // case 'Delete':
            //     break;
            case 'ArrowRight':
                this._expandTimeline(100);
                break;
            case 'ArrowLeft':
                this._expandTimeline(-100);
                break;
            // case '+':
            //     break;
        }
    }

    private _onDragFinished(d: TimelineDragEvent): void {
        d.elements.forEach((e) => this._processDragElement(e));
        this._timeline.redraw();
    }

    private _onDrag(d: TimelineDragEvent): void {
        d.elements.forEach((e) => this._processDragElement(e));
        this._timeline.redraw();
    }

    private _onMouseDown(d: TimelineClickEvent): void {
        if (!d.target) {
            const r = d.elements[0].row;
            if (!d.args.altKey || !this._isPropertyRow(r)) return this._onEmptyClick();
            this._addKeyframe(r.moduleIdx, r.propertyName, { position: d.val, value: 0 });
            return;
        }

        const r = d.target.row as TRow | undefined;
        const k = d.target.keyframe as TKey | undefined;
        const g = d.target.group;

        if (this._isModuleRow(r)) {
            if (k || g) this._onModuleClicked(r);
            else this._onEmptyClick();
        }

        if (this._isPropertyRow(r) && k) {
            if (d.args.altKey) this._removeKeyframe(r.moduleIdx, r.propertyName, k.keyIdx);
            else this._onPropertyKeyframeClicked(r, k);
        }
    }

    private _onScroll(d: TimelineScrollEvent): void {
        this._outlineItemsEl.style.minHeight = d.scrollHeight + 'px';
        this._outlineScrollEl.scrollTop = d.scrollTop;
    }

    private _onTimeChanged(d: TimelineTimeChangedEvent): void {
        if (d.source != TimelineEventSource.User) return;
        this.seek.post(d.val);
    }

    private _onOutlineMouseWheel(e: WheelEvent) {
        if (!this._timeline) return;
        this._timeline._handleWheelEvent(e);
    }

    private _onContentsChanged(): void {
        this._dirty = true;
    }

    private _onEmptyClick() {
        this._textarea.value = '';
    }

    private _onModuleClicked(row: TRow) {
        const content = this._getContent(row.moduleIdx);
        this._editContentData(content);
        this._updateHandler(() => this._onJsonChanged(row));
    }

    private _onPropertyKeyframeClicked(row: TRowProperty, key: TKey) {
        const content = this._getContent(row.moduleIdx);
        this._editKeyframeData(content, row.propertyName, key);
        this._updateHandler(() => this._onJsonChanged(row, key));
    }

    private _updateHandler(handler: () => Promise<void>): void {
        if (this._updateButtonHandler) this._textarea.removeEventListener('keyup', this._updateButtonHandler);
        this._updateButtonHandler = handler;
        this._textarea.addEventListener('keyup', this._updateButtonHandler);
    }

    private async _onJsonChanged(row: TRow, key?: TKey) {
        if (row.moduleIdx === undefined) throw new Error('Unexpected');
        const content = this._getContent(row.moduleIdx);
        try {
            this._errorMsg.innerText = '';
            const newData = JSON.parse(this._textarea.value);
            if (row.type === 'module') {
                this._updateModuleData(content, newData as Partial<IContentData>);
            }
            if (row.type === 'property' && key) {
                this._updateKeyframeData(content, row.propertyName, key.keyIdx, newData as InterpolationStop);
            }
        } catch (e) {
            this._errorMsg.innerText = (e as Error).message;
        }
    }

    private _onResizeEnd(): void {
        this._timeline.rescale();
        this._timeline.redraw();
    }

    //#endregion HANDLERS

    private _processDragElement(e: TimelineElementDragState) {
        const row = e.row as TRow | undefined;
        const key = e.keyframe as TKey | undefined;
        if (row?.moduleIdx === undefined || key?.keyIdx === undefined) throw new Error('Unexpected');
        if (row?.type === 'module') this._updateModuleKeyframePosition(row, key);
        if (row?.type === 'property') this._updatePropertyKeyframePosition(row, key);
    }

    private _absoluteToRelative(content: ContentT, key: TKey): number | string {
        if (key.type === 'absolute') return key.val;
        if (key.type === 'start') return `+${key.val - content.low}`;
        if (key.type === 'end') return `-${content.high - key.val}`;
        throw new Error('Unexpected type');
    }

    private _toggleGroup(moduleIdx: number) {
        const nodes = Array.from(this._outlineItemsEl.querySelectorAll('div'));
        this._expandedRows[moduleIdx] = !this._expandedRows[moduleIdx];
        let expanded = false;
        this._timelineModel.rows.forEach((r, idx) => {
            if (r.type === 'module') expanded = !!this._expandedRows[r.moduleIdx];
            if (r.type === 'property') {
                r.hidden = !expanded;
                nodes[idx].style.display = expanded ? 'block' : 'none';
            }
        });
        this._timeline.redraw();
    }

    private _isModuleRow(row?: TimelineRow): row is TRowModule {
        if (!row) return false;
        return (row as TRow).type === 'module';
    }

    private _isPropertyRow(row?: TimelineRow): row is TRowProperty {
        if (!row) return false;
        return (row as TRow).type === 'property';
    }

    // TODO: move to Content?
    private _getInterpolationStop(
        content: ContentT,
        propertyName: string,
        keyIdx: number,
    ): ParsedInterpolationStop<any> | undefined {
        const interpolator = content.getInterpolators()[propertyName];
        return interpolator?.getStops()[keyIdx];
    }

    // TODO
    private _updatePropertyKeyframePosition(row: TRowProperty, key: TKey): void {
        const content = this._getContent(row.moduleIdx);
        const data = content.getData();
        if (!data) throw new Error('Module data not yet present');
        const property = data?.interpolators?.[row.propertyName];
        if (!property?.length) throw new Error('Property not found: ' + row.propertyName);
        property[key.keyIdx].position = this._absoluteToRelative(content, key);
        content.setData(data);
        this._onPropertyKeyframeClicked(row, key);
    }

    private _removeKeyframe(moduleIdx: number, propertyName: string, keyIdx: number): void {
        const content = this._getContent(moduleIdx);
        const data = content.getData();
        if (!data) throw new Error('Module data not yet present');
        const property = data?.interpolators?.[propertyName];
        if (!property?.length) throw new Error('Property not found: ' + propertyName);
        property.splice(keyIdx, 1);
        content.setData(data);
    }

    private _addKeyframe(moduleIdx: number, propertyName: string, key: InterpolationStop<unknown>): void {
        const content = this._getContent(moduleIdx);
        const data = content.getData();
        if (!data) throw new Error('Module data not yet present');
        if (!data.interpolators) data.interpolators = {};
        if (!data.interpolators[propertyName]) data.interpolators[propertyName] = [];
        data.interpolators[propertyName].push(key);
        content.setData(data);
    }

    private _editContentData(content: ContentT): void {
        const data = content.getData() as Partial<IContentData>;
        // delete data.type;
        // delete data.low;
        // delete data.high;
        // delete data.interpolators;
        // delete data.required;
        this._textarea.value = JSON.stringify(data, null, 2);
    }

    private _editKeyframeData(content: ContentT, propertyName: string, key: TKey): void {
        const data = { ...this._getInterpolationStop(content, propertyName, key.keyIdx) };
        delete data.absolutePosition;
        // delete data.position;
        delete data.type;
        this._textarea.value = JSON.stringify(data, null, 2);
    }

    private _updateModuleKeyframePosition(row: TRow, key: TKey): void {
        const content = this._getContent(row.moduleIdx);
        const data = content.getData();
        if (!data) throw new Error('Module data not yet present');
        data[key.keyIdx === 0 ? 'low' : 'high'] = key.val;
        content.setData(data);
        this._onModuleClicked(row);
    }

    private _getContent(moduleIdx: number): ContentT {
        const content = this._contents[moduleIdx];
        if (!content) throw new Error('Content not found');
        return content;
    }

    private async _updateModuleData(content: ContentT, data: Partial<IContentData>): Promise<void> {
        const contentData = content.getData();
        if (!contentData) throw new Error('Module data not yet present');
        const merged = { ...contentData, ...data };
        if (JSON.stringify(merged) === JSON.stringify(content.getData())) return;
        await content.setData(merged);
        return;
    }

    private async _updateKeyframeData(
        content: ContentT,
        propertyName: string,
        keyIdx: number,
        newData: Partial<InterpolationStop<unknown>>,
    ): Promise<void> {
        const contentData = content.getData();
        if (!contentData) throw new Error('Module data not yet present');

        const property = contentData.interpolators?.[propertyName];
        if (!property) throw new Error('Property not found');

        const keyframe = property[keyIdx];
        if (!keyframe) throw new Error('Keyframe not found');

        property[keyIdx] = { ...keyframe, ...newData };
        await content.setData(contentData);
        return;
    }

    private _expandTimeline(value: number): void {
        const currentTime = this._timeline.getTime();
        this._contents.forEach((c) => {
            const data = c.getData();
            if (!data) return;
            if (data.low > currentTime) data.low = Math.max(data.low + value, currentTime);
            if (data.high > currentTime) data.high = Math.max(data.high + value, currentTime);
            if (data.interpolators) {
                Object.values(data.interpolators).forEach((stops) => {
                    stops.forEach((s) => {
                        if (typeof s.position !== 'number') return;
                        if (s.position > currentTime) s.position = Math.max(s.position + value, currentTime);
                    });
                });
            }
            c.setData(data);
        });
    }
}

const moduleKeyframeStyle = {
    cursor: 'ew-resize',
    shape: TimelineKeyframeShape.Rect,
    width: 5,
    height: 14,
    fillColor: 'rgba(182, 182, 169, 1)',
    selectedFillColor: 'rgba(245, 245, 220, 1)',
    strokeThickness: 0,
};

const propertyKeyframeStyle = {
    cursor: 'ew-resize',
    shape: TimelineKeyframeShape.Circle,
    width: 3,
    height: 3,
    fillColor: 'rgba(245, 245, 220, .5)',
    selectedFillColor: 'rgba(245, 245, 220, 1)',
    strokeThickness: 0,
};

const timelineStyle = {
    fillColor: 'lightgrey',
    strokeColor: 'lightgrey',
};

const rowsStyle = {
    groupFillColor: 'grey',
    height: 20,
    marginBottom: 1,
    groupHeight: 14,
    keyframesStyle: {
        fillColor: 'rgba(245, 245, 220, .5)',
        selectedFillColor: 'rgba(245, 245, 220, 1)',
        strokeThickness: 0,
    },
};

const timelineOpts = {
    stepVal: 100,
    min: 0,
    headerHeight: 25,
    zoom: 10,
    zoomMax: 100,
    zoomMin: 1,
    timelineStyle: timelineStyle,
    rowsStyle: rowsStyle,
};
