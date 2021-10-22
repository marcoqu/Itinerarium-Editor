import { Timeline, TimelineEventSource, TimelineKeyframeShape, } from 'animation-timeline-js';
import { SyncEvent } from 'ts-events';
import { ViewportManager, } from 'itinerarium';
export class Editor {
    constructor(container) {
        this.seek = new SyncEvent();
        this._expandedRows = [];
        this._timelineModel = { rows: [] };
        this._contents = [];
        this._dirty = true;
        this._container = container;
        this._vm = new ViewportManager();
        this._vm.resizeEnd.attach(this, this._onResizeEnd);
        this._timelineEl = this._container.querySelector('.timeline');
        this._outlineEl = this._container.querySelector('.outline');
        this._outlineItemsEl = this._container.querySelector('.outline-items');
        this._outlineHeaderEl = this._container.querySelector('.outline-header');
        this._outlineScrollEl = this._container.querySelector('.outline-scroll');
        this._textarea = this._container.querySelector('.editor-property textarea');
        this._errorMsg = this._container.querySelector('.update-error');
        this._textarea.addEventListener('keydown', (e) => e.stopImmediatePropagation());
        this._initTimeline();
        this._redrawLoop();
    }
    addContent(content) {
        if (this._contents.includes(content))
            return;
        content.intervalChanged.attach(this, this._onContentsChanged);
        this._contents.push(content);
        const empty = Array(this._contents.length).fill(false);
        Object.assign(empty, this._expandedRows);
        this._onContentsChanged();
    }
    removeContent(content) {
        const idx = this._contents.indexOf(content);
        if (idx === -1)
            return;
        content.intervalChanged.detach(this, this._onContentsChanged);
        this._contents.splice(idx, 1);
        this._expandedRows.splice(idx, 1);
        this._onContentsChanged();
    }
    setTime(currentTime) {
        this._timeline.setTime(currentTime);
    }
    reset() {
        this._contents.length = 0;
        this._expandedRows.length = 0;
        this._timeline.setTime(0);
    }
    _redrawLoop() {
        window.requestAnimationFrame(() => this._redrawLoop());
        if (this._dirty) {
            this._redrawTimeline();
            this._redrawOutline();
            this._dirty = false;
        }
    }
    _redrawTimeline() {
        this._timelineModel.rows.length = 0;
        this._contents.forEach((content, moduleIdx) => {
            this._timelineModel.rows.push(this._rowFromContent(content, moduleIdx));
            const interpolators = content.getInterpolators();
            for (const propertyName in interpolators) {
                const interpolator = interpolators[propertyName];
                this._timelineModel.rows.push(this._rowFromProperty(content, moduleIdx, propertyName, interpolator));
            }
        });
        this._timeline.redraw();
        this._timeline.rescale();
        window.document.body.classList.remove('loading');
    }
    _redrawOutline() {
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
    _rowFromContent(content, moduleIdx) {
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
    _rowFromProperty(content, moduleIdx, propertyName, interpolator) {
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
    _initTimeline() {
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
    _onKeyPress(e) {
        if (e.target?.tagName?.toLowerCase() === 'textarea')
            return;
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
    _onDragFinished(d) {
        d.elements.forEach((e) => this._processDragElement(e));
        this._timeline.redraw();
    }
    _onDrag(d) {
        d.elements.forEach((e) => this._processDragElement(e));
        this._timeline.redraw();
    }
    _onMouseDown(d) {
        if (!d.target) {
            const r = d.elements[0].row;
            if (!d.args.altKey || !this._isPropertyRow(r))
                return this._onEmptyClick();
            this._addKeyframe(r.moduleIdx, r.propertyName, { position: d.val, value: 0 });
            return;
        }
        const r = d.target.row;
        const k = d.target.keyframe;
        const g = d.target.group;
        if (this._isModuleRow(r)) {
            if (k || g)
                this._onModuleClicked(r);
            else
                this._onEmptyClick();
        }
        if (this._isPropertyRow(r) && k) {
            if (d.args.altKey)
                this._removeKeyframe(r.moduleIdx, r.propertyName, k.keyIdx);
            else
                this._onPropertyKeyframeClicked(r, k);
        }
    }
    _onScroll(d) {
        this._outlineItemsEl.style.minHeight = d.scrollHeight + 'px';
        this._outlineScrollEl.scrollTop = d.scrollTop;
    }
    _onTimeChanged(d) {
        if (d.source != TimelineEventSource.User)
            return;
        this.seek.post(d.val);
    }
    _onOutlineMouseWheel(e) {
        if (!this._timeline)
            return;
        this._timeline._handleWheelEvent(e);
    }
    _onContentsChanged() {
        this._dirty = true;
    }
    _onEmptyClick() {
        this._textarea.value = '';
    }
    _onModuleClicked(row) {
        const content = this._getContent(row.moduleIdx);
        this._editContentData(content);
        this._updateHandler(() => this._onJsonChanged(row));
    }
    _onPropertyKeyframeClicked(row, key) {
        const content = this._getContent(row.moduleIdx);
        this._editKeyframeData(content, row.propertyName, key);
        this._updateHandler(() => this._onJsonChanged(row, key));
    }
    _updateHandler(handler) {
        if (this._updateButtonHandler)
            this._textarea.removeEventListener('keyup', this._updateButtonHandler);
        this._updateButtonHandler = handler;
        this._textarea.addEventListener('keyup', this._updateButtonHandler);
    }
    async _onJsonChanged(row, key) {
        if (row.moduleIdx === undefined)
            throw new Error('Unexpected');
        const content = this._getContent(row.moduleIdx);
        try {
            this._errorMsg.innerText = '';
            const newData = JSON.parse(this._textarea.value);
            if (row.type === 'module') {
                this._updateModuleData(content, newData);
            }
            if (row.type === 'property' && key) {
                this._updateKeyframeData(content, row.propertyName, key.keyIdx, newData);
            }
        }
        catch (e) {
            this._errorMsg.innerText = e.message;
        }
    }
    _onResizeEnd() {
        this._timeline.rescale();
        this._timeline.redraw();
    }
    //#endregion HANDLERS
    _processDragElement(e) {
        const row = e.row;
        const key = e.keyframe;
        if (row?.moduleIdx === undefined || key?.keyIdx === undefined)
            throw new Error('Unexpected');
        if (row?.type === 'module')
            this._updateModuleKeyframePosition(row, key);
        if (row?.type === 'property')
            this._updatePropertyKeyframePosition(row, key);
    }
    _absoluteToRelative(content, key) {
        if (key.type === 'absolute')
            return key.val;
        if (key.type === 'start')
            return `+${key.val - content.low}`;
        if (key.type === 'end')
            return `-${content.high - key.val}`;
        throw new Error('Unexpected type');
    }
    _toggleGroup(moduleIdx) {
        const nodes = Array.from(this._outlineItemsEl.querySelectorAll('div'));
        this._expandedRows[moduleIdx] = !this._expandedRows[moduleIdx];
        let expanded = false;
        this._timelineModel.rows.forEach((r, idx) => {
            if (r.type === 'module')
                expanded = !!this._expandedRows[r.moduleIdx];
            if (r.type === 'property') {
                r.hidden = !expanded;
                nodes[idx].style.display = expanded ? 'block' : 'none';
            }
        });
        this._timeline.redraw();
    }
    _isModuleRow(row) {
        if (!row)
            return false;
        return row.type === 'module';
    }
    _isPropertyRow(row) {
        if (!row)
            return false;
        return row.type === 'property';
    }
    // TODO: move to Content?
    _getInterpolationStop(content, propertyName, keyIdx) {
        const interpolator = content.getInterpolators()[propertyName];
        return interpolator?.getStops()[keyIdx];
    }
    // TODO
    _updatePropertyKeyframePosition(row, key) {
        const content = this._getContent(row.moduleIdx);
        const data = content.getData();
        if (!data)
            throw new Error('Module data not yet present');
        const property = data?.interpolators?.[row.propertyName];
        if (!property?.length)
            throw new Error('Property not found: ' + row.propertyName);
        property[key.keyIdx].position = this._absoluteToRelative(content, key);
        content.setData(data);
        this._onPropertyKeyframeClicked(row, key);
    }
    _removeKeyframe(moduleIdx, propertyName, keyIdx) {
        const content = this._getContent(moduleIdx);
        const data = content.getData();
        if (!data)
            throw new Error('Module data not yet present');
        const property = data?.interpolators?.[propertyName];
        if (!property?.length)
            throw new Error('Property not found: ' + propertyName);
        property.splice(keyIdx, 1);
        content.setData(data);
    }
    _addKeyframe(moduleIdx, propertyName, key) {
        const content = this._getContent(moduleIdx);
        const data = content.getData();
        if (!data)
            throw new Error('Module data not yet present');
        if (!data.interpolators)
            data.interpolators = {};
        if (!data.interpolators[propertyName])
            data.interpolators[propertyName] = [];
        data.interpolators[propertyName].push(key);
        content.setData(data);
    }
    _editContentData(content) {
        const data = content.getData();
        // delete data.type;
        // delete data.low;
        // delete data.high;
        // delete data.interpolators;
        // delete data.required;
        this._textarea.value = JSON.stringify(data, null, 2);
    }
    _editKeyframeData(content, propertyName, key) {
        const data = { ...this._getInterpolationStop(content, propertyName, key.keyIdx) };
        delete data.absolutePosition;
        // delete data.position;
        delete data.type;
        this._textarea.value = JSON.stringify(data, null, 2);
    }
    _updateModuleKeyframePosition(row, key) {
        const content = this._getContent(row.moduleIdx);
        const data = content.getData();
        if (!data)
            throw new Error('Module data not yet present');
        data[key.keyIdx === 0 ? 'low' : 'high'] = key.val;
        content.setData(data);
        this._onModuleClicked(row);
    }
    _getContent(moduleIdx) {
        const content = this._contents[moduleIdx];
        if (!content)
            throw new Error('Content not found');
        return content;
    }
    async _updateModuleData(content, data) {
        const contentData = content.getData();
        if (!contentData)
            throw new Error('Module data not yet present');
        const merged = { ...contentData, ...data };
        if (JSON.stringify(merged) === JSON.stringify(content.getData()))
            return;
        await content.setData(merged);
        return;
    }
    async _updateKeyframeData(content, propertyName, keyIdx, newData) {
        const contentData = content.getData();
        if (!contentData)
            throw new Error('Module data not yet present');
        const property = contentData.interpolators?.[propertyName];
        if (!property)
            throw new Error('Property not found');
        const keyframe = property[keyIdx];
        if (!keyframe)
            throw new Error('Keyframe not found');
        property[keyIdx] = { ...keyframe, ...newData };
        await content.setData(contentData);
        return;
    }
    _expandTimeline(value) {
        const currentTime = this._timeline.getTime();
        this._contents.forEach((c) => {
            const data = c.getData();
            if (!data)
                return;
            if (data.low > currentTime)
                data.low = Math.max(data.low + value, currentTime);
            if (data.high > currentTime)
                data.high = Math.max(data.high + value, currentTime);
            if (data.interpolators) {
                Object.values(data.interpolators).forEach((stops) => {
                    stops.forEach((s) => {
                        if (typeof s.position !== 'number')
                            return;
                        if (s.position > currentTime)
                            s.position = Math.max(s.position + value, currentTime);
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
//# sourceMappingURL=Editor.js.map