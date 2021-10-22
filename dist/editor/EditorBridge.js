export class EditorBridge {
    constructor(mapscroller) {
        this._mapScroller = mapscroller;
        this._mapScroller.scrollControl.positionChanged.attach(this, (t) => this._editor?.setTime(t));
        this._mapScroller.contentManager.contentsChanged.attach(this, (c) => this._setContents(c));
    }
    async openEditor() {
        if (this._editorWindow && !this._editorWindow.closed) {
            this._editorWindow.focus();
        }
        else {
            this._editorWindow = await this._openEditorWindow();
            this._editor = this._editorWindow.editor;
            this._editor.seek.attach(this, this._onSeeked);
            this._editor.setTime(this._mapScroller.scrollControl.getPosition());
            if (this._contents)
                this._loadContents(this._contents);
        }
    }
    async closeEditor() {
        this._mapScroller.scrollControl.positionChanged.detach(this);
        this._editorWindow?.close();
    }
    reset() {
        this._contents = undefined;
        this._editor?.reset();
    }
    _setContents(contents) {
        this._contents = contents;
        if (this._editor)
            this._loadContents(this._contents);
    }
    _loadContents(contents) {
        if (!this._editor)
            throw new Error('Editor did not open');
        contents.forEach((c) => this._editor?.addContent(c));
    }
    _openEditorWindow() {
        return new Promise((resolve, reject) => {
            const feats = `toolbar=0,location=0,menubar=0,left=0,top=${window.outerHeight / 2}`;
            const size = `width=${window.outerWidth},height=${window.outerHeight / 2}`;
            const w = window.open('editor.html', 'editor', feats + ',' + size);
            w.addEventListener('load', () => resolve(w));
            w.addEventListener('error', (e) => reject(e));
        });
    }
    _onSeeked(time) {
        this._mapScroller.scrollControl.setPosition(time);
    }
}
//# sourceMappingURL=EditorBridge.js.map