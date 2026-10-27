/*
  Undo and redo over document snapshots.

  run() takes a snapshot, applies the edit, and validates the result. An edit that throws, or
  that adds a validation error the archive did not already have, is rolled back and rethrown,
  so the document is never left half-edited or invalid by an edit.
*/
import { EditRejected, newErrors, validateDocument } from "./validate.js";

const LIMIT = 200;

export class History {
  constructor() {
    this.undoStack = [];
    this.redoStack = [];
  }

  clear() {
    this.undoStack = [];
    this.redoStack = [];
  }

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
  get undoLabel() { return this.undoStack.at(-1)?.label ?? null; }
  get redoLabel() { return this.redoStack.at(-1)?.label ?? null; }

  /**
   * Applies `edit(doc)` as one undoable step. Returns what the edit returned, or the edit's
   * result unchanged when it made no change (an edit that returns `false` records nothing).
   * @throws EditRejected when the edit adds a validation error
   */
  run(doc, label, edit) {
    const before = doc.snapshot();
    const report = validateDocument(doc);
    let result;
    try {
      result = edit(doc);
    } catch (error) {
      doc.restore(before);
      throw error;
    }
    if (result === false) {
      doc.restore(before);
      return result;
    }
    const added = newErrors(report, validateDocument(doc));
    if (added.length) {
      doc.restore(before);
      throw new EditRejected(added);
    }
    doc.touch();
    this.undoStack.push({ label, before, after: doc.snapshot() });
    if (this.undoStack.length > LIMIT) this.undoStack.shift();
    this.redoStack = [];
    return result;
  }

  undo(doc) {
    const step = this.undoStack.pop();
    if (!step) return null;
    doc.restore(step.before);
    this.redoStack.push(step);
    return step.label;
  }

  redo(doc) {
    const step = this.redoStack.pop();
    if (!step) return null;
    doc.restore(step.after);
    this.undoStack.push(step);
    return step.label;
  }
}
