/**
 * HistoryStack
 * Command 패턴 기반 Undo/Redo 스택.
 * 각 커맨드는 { type, id, oldValue, newValue, ... } 형태의 plain object.
 */
export class HistoryStack {
  constructor(maxSize = 50) {
    this._stack = []
    this._pointer = -1
    this._maxSize = maxSize
  }

  get canUndo() { return this._pointer >= 0 }
  get canRedo() { return this._pointer < this._stack.length - 1 }
  get size()    { return this._stack.length }

  push(cmd) {
    // undo 이후 새 커맨드 push → redo 히스토리 제거
    this._stack.length = this._pointer + 1
    this._stack.push(cmd)
    // 최대 크기 초과 시 오래된 항목 제거
    if (this._stack.length > this._maxSize) {
      this._stack.shift()
    } else {
      this._pointer++
    }
  }

  undo() {
    if (!this.canUndo) return null
    return this._stack[this._pointer--]
  }

  redo() {
    if (!this.canRedo) return null
    return this._stack[++this._pointer]
  }

  clear() {
    this._stack.length = 0
    this._pointer = -1
  }
}
