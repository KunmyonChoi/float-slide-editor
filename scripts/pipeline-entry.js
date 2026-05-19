/**
 * pipeline-entry.js
 * Puppeteer 페이지에 주입할 파이프라인 번들의 엔트리 포인트.
 * window.FlatPipeline 으로 노출한다.
 */
import { extractFlatElements } from '../src/core/FlatExtractor.js'
import { exportFlatHtml } from '../src/core/FlatExporter.js'
import { prepareHtmlForEditor } from '../src/core/ElementRegistry.js'

window.FlatPipeline = {
  prepareHtmlForEditor,
  extractFlatElements,
  exportFlatHtml,
}
