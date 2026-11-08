import * as echarts from 'echarts/core';
import { BarChart, LineChart } from 'echarts/charts';
import { GridComponent, MarkPointComponent, TooltipComponent } from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
import type { EChartsType } from 'echarts/core';
import { LegacyGridContainLabel } from 'echarts/features';
import 'echarts/theme/v5';
import { bindSvgChartPointer } from './chart-pointer';
echarts.use([LineChart, BarChart, GridComponent, MarkPointComponent, TooltipComponent, SVGRenderer, LegacyGridContainLabel]);

/** Historical series are bounded (hours, days or months). Keep their text and
 * paths as vectors: a canvas backing store sized for devicePixelRatio alone is
 * interpolated again when the enclosing device page applies CSS zoom. SVG
 * follows page zoom and monitor DPI without changing series or pointer state.
 */
export async function historyFontReady(host:HTMLElement):Promise<void>{
  // ECharts measures and caches text widths. Wait for the bundled font before
  // the first measurement, rather than laying axes out with a fallback font.
  try{await host.ownerDocument.fonts.load(`12px ${getComputedStyle(host).fontFamily}`,'温度湿度0123456789℃%');}catch{/* Keep charts readable if a font resource fails. */}
}
export function initHistoryChart(host: HTMLElement): EChartsType {
  const existing=echarts.getInstanceByDom(host);if(existing)return existing;
  const chart = echarts.init(host, 'v5', { renderer: 'svg' });
  chart.setOption({textStyle:{fontFamily:getComputedStyle(host).fontFamily}});
  bindSvgChartPointer(chart);
  host.dataset.chartRenderer = 'svg';
  return chart;
}
export { echarts };
