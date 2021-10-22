import { MapScroller } from 'itinerarium';
import { IEditorContent } from '../editor/Editor';
export declare class EditorBridge<ContentT extends IEditorContent = IEditorContent> {
    private _mapScroller;
    private _editorWindow?;
    private _editor?;
    private _contents?;
    constructor(mapscroller: MapScroller<ContentT>);
    openEditor(): Promise<void>;
    closeEditor(): Promise<void>;
    reset(): void;
    private _setContents;
    private _loadContents;
    private _openEditorWindow;
    private _onSeeked;
}
