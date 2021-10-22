import { MapScroller } from 'itinerarium';

import { Editor, IEditorContent } from '../editor/Editor';

type EditorWindow = Window & { editor: Editor };

export class EditorBridge<ContentT extends IEditorContent = IEditorContent> {
    private _mapScroller: MapScroller<ContentT>;

    private _editorWindow?: EditorWindow;
    private _editor?: Editor<ContentT>;
    private _contents?: ContentT[];

    public constructor(mapscroller: MapScroller<ContentT>) {
        this._mapScroller = mapscroller;
        this._mapScroller.scrollControl.positionChanged.attach(this, (t) => this._editor?.setTime(t));
        this._mapScroller.contentManager.contentsChanged.attach(this, (c) => this._setContents(c));
    }

    public async openEditor(): Promise<void> {
        if (this._editorWindow && !this._editorWindow.closed) {
            this._editorWindow.focus();
        } else {
            this._editorWindow = await this._openEditorWindow();
            this._editor = this._editorWindow.editor as Editor<ContentT>;
            this._editor.seek.attach(this, this._onSeeked);
            this._editor.setTime(this._mapScroller.scrollControl.getPosition());
            if (this._contents) this._loadContents(this._contents);
        }
    }

    public async closeEditor(): Promise<void> {
        this._mapScroller.scrollControl.positionChanged.detach(this);
        this._editorWindow?.close();
    }

    public reset(): void {
        this._contents = undefined;
        this._editor?.reset();
    }

    private _setContents(contents: ContentT[]): void {
        this._contents = contents;
        if (this._editor) this._loadContents(this._contents);
    }

    private _loadContents(contents: ContentT[]): void {
        if (!this._editor) throw new Error('Editor did not open');
        contents.forEach((c) => this._editor?.addContent(c));
    }

    private _openEditorWindow(): Promise<EditorWindow> {
        return new Promise((resolve, reject) => {
            const feats = `toolbar=0,location=0,menubar=0,left=0,top=${window.outerHeight / 2}`;
            const size = `width=${window.outerWidth},height=${window.outerHeight / 2}`;
            const w = window.open('editor.html', 'editor', feats + ',' + size) as EditorWindow;
            w.addEventListener('load', () => resolve(w));
            w.addEventListener('error', (e) => reject(e));
        });
    }

    private _onSeeked(time: number): void {
        this._mapScroller.scrollControl.setPosition(time);
    }
}
