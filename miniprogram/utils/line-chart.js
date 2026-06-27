/**
 * line-chart.js - 轻量图表组件
 * 用法: var chart = require('../../utils/line-chart.js')
 *
 * 1. drawLineChart(canvasId, data, options, pageThis) — 单折线图（保留兼容）
 * 2. drawComboChart(canvasId, barData, lineData, options, pageThis) — 组合图（柱状+折线+双Y轴）
 *
 * === drawComboChart 参数 ===
 * barData:  [{label:'06-24', value:3, valueStr:'3套'}]
 * lineData: [{label:'06-24', value:5.2, valueStr:'5.200'}]
 * options:
 *   width, height       — canvas 尺寸
 *   barColor             — 柱状颜色, default '#1989FA'
 *   lineColor            — 折线颜色, default '#FF6600'
 *   barFillColor         — 柱状背景填充, default 'rgba(25,137,250,0.08)'
 *   lineFillColor        — 折线填充, default 'rgba(255,102,0,0.06)'
 *   barAxisLabel         — 左Y轴单位, default '套'
 *   lineAxisLabel        — 右Y轴单位, default '万/㎡'
 *   showDots             — 是否画折线圆点, default true
 *   showBarLabels        — 柱上方是否标数值, default auto
 *   showLineLabels       — 折线点是否标数值, default auto
 *   yAxisLeftMin/Max     — 左Y轴范围
 *   yAxisRightMin/Max    — 右Y轴范围
 *   title                — 标题
 *   legendBar            — 图例-柱状, default '成交套数'
 *   legendLine           — 图例-折线, default '成交均价'
 *   xLabelInterval       — X轴标签间隔, default 'auto'
 */

// ============================================================
// drawLineChart — 单折线图（保持向后兼容）
// ============================================================
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
      var labelY = p.y - 10;
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

// ============================================================
// drawComboChart — 组合图表（柱状+折线+双Y轴）
// ============================================================
function drawComboChart(canvasId, barData, lineData, options, pageThis) {
  options = options || {};
  var ctx = wx.createCanvasContext(canvasId, pageThis);
  var W = options.width || 320;
  var H = options.height || 300;
  var padL = 44, padR = 56, padT = 36, padB = 32;
  var plotW = W - padL - padR;
  var plotH = H - padT - padB;

  barData = (barData || []).filter(function(d) { return d.value !== null && d.value !== undefined && !isNaN(d.value); });
  lineData = (lineData || []).filter(function(d) { return d.value !== null && d.value !== undefined && !isNaN(d.value); });

  var hasBar = barData.length > 0;
  var hasLine = lineData.length > 0;

  if (!hasBar && !hasLine) { ctx.draw(); return; }

  // 合并日期索引（统一X轴位置）
  var allLabels = [];
  var labelMap = {};
  (barData.concat(lineData)).forEach(function(d) {
    if (!labelMap[d.label]) {
      labelMap[d.label] = true;
      allLabels.push(d.label);
    }
  });
  allLabels.sort();

  var N = allLabels.length;
  var barPts = [];
  var linePts = [];

  allLabels.forEach(function(label, i) {
    var x = padL + (N === 1 ? plotW / 2 : (i / (N - 1)) * plotW);
    var barItem = barData.find(function(d) { return d.label === label; });
    var lineItem = lineData.find(function(d) { return d.label === label; });
    barPts.push({ x: x, label: label, value: barItem ? barItem.value : 0, valueStr: barItem ? barItem.valueStr : '0' });
    linePts.push({ x: x, label: label, value: lineItem ? lineItem.value : null, valueStr: lineItem ? lineItem.valueStr : '' });
  });

  // 左Y轴（柱状图）范围
  var barVals = barPts.map(function(d) { return d.value; });
  var barMin = options.yAxisLeftMin !== undefined ? options.yAxisLeftMin : 0;
  var barMax = options.yAxisLeftMax;
  if (barMax === undefined) {
    barMax = Math.max.apply(null, barVals);
    if (barMax === 0) barMax = 5;
    // 向上取整到合适的刻度
    barMax = niceCeil(barMax);
  }
  if (barMin === barMax) { barMin -= 1; barMax += 1; }
  var barRange = barMax - barMin;

  // 右Y轴（折线图）范围
  var lineVals = linePts.filter(function(d) { return d.value !== null; }).map(function(d) { return d.value; });
  var lineMin = options.yAxisRightMin !== undefined ? options.yAxisRightMin : (lineVals.length ? Math.min.apply(null, lineVals) : 0);
  var lineMax = options.yAxisRightMax;
  if (lineMax === undefined) {
    lineMax = lineVals.length ? Math.max.apply(null, lineVals) : 5;
    if (lineMin === lineMax) { lineMin -= 0.1; lineMax += 0.1; }
    var padding = (lineMax - lineMin) * 0.1 || 0.1;
    lineMin -= padding;
    lineMax += padding;
  }
  var lineRange = lineMax - lineMin;

  // 计算柱状图Y坐标（从底部向上）
  barPts.forEach(function(p) {
    p.yTop = padT + plotH - ((p.value - barMin) / barRange) * plotH;
    p.yBot = padT + plotH;
  });

  // 计算折线图Y坐标
  linePts.forEach(function(p) {
    if (p.value !== null) {
      p.y = padT + plotH - ((p.value - lineMin) / lineRange) * plotH;
    }
  });

  var barColor = options.barColor || '#1989FA';
  var barFillColor = options.barFillColor || 'rgba(25,137,250,0.08)';
  var lineColor = options.lineColor || '#FF6600';
  var lineFillColor = options.lineFillColor || 'rgba(255,102,0,0.06)';
  var legendBar = options.legendBar || '套数';
  var legendLine = options.legendLine || '均价';

  // ---- 绘制顺序（从后到前） ----

  // 1. 网格线（只画左Y轴参考线）
  ctx.setStrokeStyle('#f0f0f0');
  ctx.setLineWidth(0.5);
  var gridLines = 4;
  for (var g = 0; g <= gridLines; g++) {
    var gy = padT + (g / gridLines) * plotH;
    ctx.beginPath();
    ctx.moveTo(padL, gy);
    ctx.lineTo(padL + plotW, gy);
    ctx.stroke();
  }

  // 2. 左Y轴刻度（柱状图 — 套）
  ctx.setFillStyle('#888');
  ctx.setFontSize(10);
  ctx.setTextAlign('right');
  for (var gl = 0; gl <= gridLines; gl++) {
    var gyl = padT + (gl / gridLines) * plotH;
    var gv = barMax - (gl / gridLines) * barRange;
    var labelStr = barRange >= 0.5 ? String(Math.round(gv)) : gv.toFixed(1);
    ctx.fillText(labelStr, padL - 8, gyl + 4);
  }
  // 左Y轴单位
  if (options.barAxisLabel) {
    ctx.setFillStyle('#aaa');
    ctx.setFontSize(9);
    ctx.fillText(options.barAxisLabel, padL - 8, padT - 4);
  }

  // 3. 右Y轴刻度（折线图 — 万/㎡）
  ctx.setFillStyle('#888');
  ctx.setFontSize(10);
  ctx.setTextAlign('left');
  for (var gr = 0; gr <= gridLines; gr++) {
    var gyr = padT + (gr / gridLines) * plotH;
    var gvr = lineMax - (gr / gridLines) * lineRange;
    var labelStrR = (Math.abs(gvr) >= 100 ? String(Math.round(gvr)) : (Math.abs(gvr) >= 10 ? gvr.toFixed(1) : gvr.toFixed(2)));
    ctx.fillText(labelStrR, padL + plotW + 8, gyr + 4);
  }
  // 右Y轴单位
  if (options.lineAxisLabel) {
    ctx.setFillStyle(lineColor);
    ctx.setFontSize(9);
    ctx.fillText(options.lineAxisLabel, padL + plotW + 8, padT - 4);
  }

  // 4. X轴标签（智能间隔）
  ctx.setFillStyle('#888');
  ctx.setFontSize(10);
  ctx.setTextAlign('center');
  var xInterval = calcXInterval(N, options.xLabelInterval);
  barPts.forEach(function(p, i) {
    if (i % xInterval === 0 || i === N - 1) {
      ctx.fillText(p.label, p.x, H - padB + 14);
    }
  });

  // 5. X轴竖线（虚线，可选）
  ctx.setStrokeStyle('#f5f5f5');
  ctx.setLineWidth(0.5);
  barPts.forEach(function(p, i) {
    if (i % xInterval === 0 && i > 0) {
      ctx.beginPath();
      ctx.setLineDash([2, 4]);
      ctx.moveTo(p.x, padT);
      ctx.lineTo(p.x, padT + plotH);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  });

  // 6. 柱状图
  if (hasBar) {
    var barW = Math.max(4, Math.min(28, plotW / N * 0.6));
    barPts.forEach(function(p) {
      if (p.value > 0) {
        var x0 = p.x - barW / 2;
        var h = p.yBot - p.yTop;
        if (h < 0.5) h = 0.5;
        // 柱体填充
        ctx.setFillStyle(barColor);
        ctx.fillRect(x0, p.yTop, barW, h);
      }
    });

    // 柱状图上方数值标注
    var showBarLabel = options.showBarLabels !== undefined ? options.showBarLabels : (N <= 14);
    if (showBarLabel) {
      ctx.setFillStyle(barColor);
      ctx.setFontSize(9);
      ctx.setTextAlign('center');
      barPts.forEach(function(p) {
        if (p.value > 0) {
          var ly = p.yTop - 6;
          if (ly < padT + 8) ly = p.yTop + (p.yBot - p.yTop > 12 ? 12 : p.yBot - p.yTop + 4);
          ctx.fillText(p.valueStr, p.x, ly);
        }
      });
    }
  }

  // 7. 折线填充区域
  if (hasLine && lineVals.length > 0) {
    var lineValid = linePts.filter(function(d) { return d.value !== null; });
    if (lineValid.length > 0) {
      ctx.beginPath();
      ctx.moveTo(lineValid[0].x, padT + plotH);
      lineValid.forEach(function(p) { ctx.lineTo(p.x, p.y); });
      ctx.lineTo(lineValid[lineValid.length - 1].x, padT + plotH);
      ctx.closePath();
      ctx.setFillStyle(lineFillColor);
      ctx.fill();
    }
  }

  // 8. 折线
  if (hasLine && lineVals.length > 0) {
    ctx.beginPath();
    ctx.setStrokeStyle(lineColor);
    ctx.setLineWidth(2);
    ctx.setLineJoin('round');
    var first = true;
    linePts.forEach(function(p) {
      if (p.value !== null) {
        if (first) { ctx.moveTo(p.x, p.y); first = false; }
        else ctx.lineTo(p.x, p.y);
      }
    });
    ctx.stroke();
  }

  // 9. 折线圆点 + 数值标注
  if (hasLine) {
    var showLineLabel = options.showLineLabels !== undefined ? options.showLineLabels : (N <= 14);
    if (options.showDots !== false) {
      linePts.forEach(function(p) {
        if (p.value === null) return;
        // 圆点
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3.5, 0, 2 * Math.PI);
        ctx.setFillStyle('#fff');
        ctx.fill();
        ctx.setStrokeStyle(lineColor);
        ctx.setLineWidth(2);
        ctx.stroke();
      });
    }

    if (showLineLabel) {
      ctx.setFillStyle(lineColor);
      ctx.setFontSize(9);
      ctx.setTextAlign('center');
      linePts.forEach(function(p) {
        if (p.value === null) return;
        var ly = p.y - 12;
        if (ly < padT + 8) ly = p.y + 16;
        ctx.fillText(p.valueStr, p.x, ly);
      });
    }
  }

  // 10. 图例（左上角标题下方，避免和右Y轴重叠）
  var legendX = padL;
  if (hasBar) {
    ctx.setFillStyle(barColor);
    ctx.fillRect(legendX, padT - 15, 10, 10);
    ctx.setFillStyle('#333');
    ctx.setFontSize(10);
    ctx.setTextAlign('left');
    ctx.fillText(legendBar, legendX + 14, padT - 6);
    legendX += 14 + ctx.measureText ? 60 : 70; // measureText 可能不支持，用估算
  }
  if (hasLine) {
    var lx = hasBar ? legendX : padL;
    ctx.beginPath();
    ctx.setStrokeStyle(lineColor);
    ctx.setLineWidth(2);
    ctx.moveTo(lx, padT - 10);
    ctx.lineTo(lx + 14, padT - 10);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(lx + 7, padT - 10, 3, 0, 2 * Math.PI);
    ctx.setFillStyle(lineColor);
    ctx.fill();
    ctx.setFillStyle('#333');
    ctx.setFontSize(10);
    ctx.setTextAlign('left');
    ctx.fillText(legendLine, lx + 18, padT - 6);
  }

  // 11. 标题（左上角）
  if (options.title) {
    ctx.setFillStyle('#333');
    ctx.setFontSize(12);
    ctx.setTextAlign('left');
    ctx.fillText(options.title, padL, padT - 18);
  }

  ctx.draw();
}

// 辅助：向上取整到"好看"的刻度
function niceCeil(val) {
  if (val <= 0) return 1;
  var magnitude = Math.pow(10, Math.floor(Math.log10(val)));
  var normalized = val / magnitude;
  if (normalized <= 1) return magnitude;
  if (normalized <= 2) return 2 * magnitude;
  if (normalized <= 5) return 5 * magnitude;
  return 10 * magnitude;
}

// 辅助：计算X轴标签间隔
function calcXInterval(N, userInterval) {
  if (userInterval && userInterval !== 'auto') return parseInt(userInterval) || 1;
  if (N <= 7) return 1;
  if (N <= 14) return 2;
  if (N <= 25) return 3;
  if (N <= 45) return 4;
  return Math.ceil(N / 8);
}

module.exports = {
  drawLineChart: drawLineChart,
  drawComboChart: drawComboChart
};
