/**
 * line-chart.js - 轻量折线图组件
 * 用法: require('../../utils/line-chart.js')
 *   drawLineChart(canvasId, data, options, pageThis)
 *
 * data 格式: [{label:'06-01', value:5}, ...]
 * options:
 *   title    - 标题（可选）
 *   color    - 折线颜色，默认 '#1989FA'
 *   fillColor- 折线下方填充色，默认 'rgba(25,137,250,0.1)'
 *   showDots - 是否画圆点，默认 true
 *   showLabels - 是否标注数值，默认 true
 *   yAxisMin - Y轴最小值（自动）
 *   yAxisMax - Y轴最大值（自动）
 *   width    - canvas 宽度，默认 320
 *   height   - canvas 高度，默认 180
 */

function drawLineChart(canvasId, data, options, pageThis) {
  options = options || {};
  var ctx = wx.createCanvasContext(canvasId, pageThis);
  var W = options.width || 320;
  var H = options.height || 180;
  var padL = 40, padR = 16, padT = 24, padB = 30;
  var plotW = W - padL - padR;
  var plotH = H - padT - padB;

  // 数据过滤
  var valid = (data || []).filter(function(d) { return d.value !== null && d.value !== undefined && !isNaN(d.value); });
  if (!valid.length) { ctx.draw(); return; }

  // Y轴范围
  var vals = valid.map(function(d) { return d.value; });
  var vMin = options.yAxisMin !== undefined ? options.yAxisMin : Math.min.apply(null, vals);
  var vMax = options.yAxisMax !== undefined ? options.yAxisMax : Math.max.apply(null, vals);
  if (vMin === vMax) { vMin -= 1; vMax += 1; }
  var vRange = vMax - vMin;

  // 计算坐标
  var pts = valid.map(function(d, i) {
    var x = padL + (valid.length === 1 ? plotW / 2 : (i / (valid.length - 1)) * plotW);
    var y = padT + plotH - ((d.value - vMin) / vRange) * plotH;
    return { x: x, y: y, label: d.label, value: d.value, valueStr: d.valueStr || String(d.value) };
  });

  var color = options.color || '#1989FA';
  var fillColor = options.fillColor || 'rgba(25,137,250,0.10)';

  // 背景网格线
  ctx.setStrokeStyle('#f0f0f0');
  ctx.setLineWidth(0.5);
  var gridLines = 4;
  for (var g = 0; g <= gridLines; g++) {
    var gy = padT + (g / gridLines) * plotH;
    ctx.beginPath();
    ctx.moveTo(padL, gy);
    ctx.lineTo(padL + plotW, gy);
    ctx.stroke();
    // Y轴刻度
    var gv = vMax - (g / gridLines) * vRange;
    ctx.setFillStyle('#999');
    ctx.setFontSize(9);
    ctx.setTextAlign('right');
    ctx.fillText(String(Math.round(gv * 100) / 100), padL - 4, gy + 3);
  }

  // X轴标签
  ctx.setFillStyle('#999');
  ctx.setFontSize(9);
  pts.forEach(function(p) {
    ctx.setTextAlign('center');
    ctx.fillText(p.label, p.x, H - padB + 14);
  });

  // 填充区域
  ctx.beginPath();
  ctx.moveTo(pts[0].x, padT + plotH);
  pts.forEach(function(p) { ctx.lineTo(p.x, p.y); });
  ctx.lineTo(pts[pts.length - 1].x, padT + plotH);
  ctx.closePath();
  ctx.setFillStyle(fillColor);
  ctx.fill();

  // 折线
  ctx.beginPath();
  ctx.setStrokeStyle(color);
  ctx.setLineWidth(2);
  ctx.setLineJoin('round');
  pts.forEach(function(p, i) {
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  });
  ctx.stroke();

  // 圆点 + 数值标注
  if (options.showDots !== false) {
    pts.forEach(function(p) {
      // 圆点
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3, 0, 2 * Math.PI);
      ctx.setFillStyle(color);
      ctx.fill();
      ctx.setStrokeStyle('#fff');
      ctx.setLineWidth(1.5);
      ctx.stroke();
    });
  }

  if (options.showLabels !== false) {
    ctx.setFillStyle('#333');
    ctx.setFontSize(9);
    pts.forEach(function(p) {
      // 数值标注放在圆点上方
      var labelY = p.y - 10;
      // 防止超出顶部
      if (labelY < padT) labelY = p.y + 14;
      ctx.setTextAlign('center');
      ctx.fillText(p.valueStr, p.x, labelY);
    });
  }

  // 标题
  if (options.title) {
    ctx.setFillStyle('#333');
    ctx.setFontSize(12);
    ctx.setTextAlign('left');
    ctx.fillText(options.title, padL, padT - 6);
  }

  ctx.draw();
}

module.exports = {
  drawLineChart: drawLineChart
};
