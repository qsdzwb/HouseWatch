var api = require('../../utils/api');
var chart = require('../../utils/line-chart.js');

Page({
  data: {
    project: {},
    buildings: [],
    stats: {},
    activeTab: 'buildings',
    isWatched: false,
    watchId: null,
    // 趋势图表
    trendGranularity: 'day',  // day | week | month
    trendBars: [],       // 成交套数（柱状）
    trendLine: [],       // 成交均价（折线）
    hasTrend: false,
    priceInsight: '',
    insightType: '',
    trendSummaryTotal: 0,
    trendSummaryPrice: '',
    // 历史成交低价提示
    priceTip: '',
    priceTipType: ''
  },

  onLoad: function(opt) {
    this.setData({ projectId: opt.id });
    this.loadDetail();
    this.loadTrend();
  },

  onPullDownRefresh: function() {
    this.loadDetail().then(function() {
      wx.stopPullDownRefresh();
    });
  },

  loadDetail: function() {
    var self = this;
    wx.showNavigationBarLoading();
    return api.getProjectDetail(this.data.projectId).then(function(res) {
      wx.hideNavigationBarLoading();
      var d = res.data || {};

      var buildings = (d.buildings || []).map(function(b) {
        var total = b.total_houses || 1;
        var avail = b.available_count || 0;
        var sold = b.sold_count || 0;
        var other = total - avail - sold;
        if (other < 0) other = 0;
        b.flex_avail = avail > 0 ? avail : 1;
        b.flex_sold = sold > 0 ? sold : (other > 0 ? 1 : 0);
        b.flex_other = other > 0 ? other : 1;
        if (b.avg_price) {
          b.price_display = (b.avg_price / 10000).toFixed(1) + '万/㎡';
        }
        return b;
      });

      var stats = d.stats || {};
      var watch = d.watch;

      self.setData({
        project: d.project || {},
        buildings: buildings,
        stats: stats,
        isWatched: watch && watch.is_active ? true : false,
        watchId: watch ? watch.id : null
      });
    }).catch(function() {
      wx.hideNavigationBarLoading();
      wx.showToast({ title: '加载失败', icon: 'none' });
    });
  },

  switchTab: function(e) {
    this.setData({ activeTab: e.currentTarget.dataset.tab });
  },

  goBuilding: function(e) {
    var buildingId = e.currentTarget.dataset.id;
    wx.navigateTo({ url: '/pages/building/building?id=' + buildingId });
  },

  toggleWatch: function() {
    var self = this;
    var pid = this.data.project.project_id;
    if (this.data.isWatched) {
      api.removeWatch(pid).then(function() {
        self.setData({ isWatched: false, watchId: null });
        wx.showToast({ title: '已取消关注', icon: 'success' });
      }).catch(function() {
        wx.showToast({ title: '操作失败', icon: 'none' });
      });
    } else {
      var p = this.data.project;
      api.addWatch({
        project_id: p.project_id,
        name: p.name,
        district: p.district || '',
        address: p.address || '',
        developer: p.developer || ''
      }).then(function(res) {
        var data = res.data || {};
        self.setData({ isWatched: true });
        wx.showToast({ title: '已添加关注', icon: 'success' });
      }).catch(function() {
        wx.showToast({ title: '操作失败', icon: 'none' });
      });
    }
  },

  // 切换趋势图粒度
  switchGranularity: function(e) {
    var g = e.currentTarget.dataset.granularity;
    if (g !== this.data.trendGranularity) {
      this.setData({ trendGranularity: g });
      this.loadTrend();
    }
  },

  // 加载趋势数据
  loadTrend: function() {
    var self = this;
    var pid = (this.data.projectId || '').split(',')[0];
    var g = this.data.trendGranularity || 'day';
    // 不同粒度的数据天数
    var daysMap = { day: 30, week: 90, month: 180 };
    var params = {
      projectId: pid,
      days: daysMap[g] || 30,
      granularity: g
    };
    api.getTrend(params).then(function(res) {
      var d = (res && res.data) || {};
      var dailySales = d.dailySales || [];
      var compare = d.compare || {};
      var summary = d.summary || {};

      // 柱状图数据：成交套数
      var barData = dailySales.filter(function(item) {
        return item.count > 0;
      }).map(function(item) {
        var label = formatLabel(item.date, g);
        return {
          date: item.date,
          label: label,
          value: item.count,
          valueStr: item.count + '套'
        };
      });

      // 折线图数据：成交均价（万元）
      var lineData = dailySales.filter(function(item) {
        return item.avgPrice > 0;
      }).map(function(item) {
        var wan = (item.avgPrice / 10000).toFixed(2);
        return {
          date: item.date,
          label: formatLabel(item.date, g),
          value: item.avgPrice / 10000,
          valueStr: wan
        };
      });

      // 价格洞察
      var insight = '';
      if (lineData.length >= 3) {
        var prices = lineData.map(function(d) { return d.value; });
        var current = prices[prices.length - 1];
        var min = Math.min.apply(null, prices);
        var max = Math.max.apply(null, prices);
        var avg = prices.reduce(function(a, b) { return a + b; }, 0) / prices.length;
        var range = max - min;
        if (range === 0) {
          insight = '价格走势平稳';
        } else if (current <= min + range * 0.2) {
          insight = '📉 当前均价处于低位，可能是入手时机';
        } else if (current >= max - range * 0.2) {
          insight = '📈 当前均价处于高位，建议观望';
        } else if (current < avg) {
          insight = '➡️ 当前均价低于均值，值得关注';
        } else {
          insight = '➡️ 当前均价高于均值';
        }
      }

      // 转换环比数据为 WXML 友好的格式（避免 null 比较问题）
      var wc = compare.weekOverWeek || {};
      var mc = compare.monthOverMonth || {};
      var weekChange = {
        count: wc.countChange || 0,
        pct: wc.countChangePct !== null && wc.countChangePct !== undefined ? wc.countChangePct : '',
        show: wc.countChangePct !== null && wc.countChangePct !== undefined,
        hasData: wc.previousPeriod && wc.previousPeriod.count > 0
      };
      var monthChange = {
        count: mc.countChange || 0,
        pct: mc.countChangePct !== null && mc.countChangePct !== undefined ? mc.countChangePct : '',
        show: mc.countChangePct !== null && mc.countChangePct !== undefined,
        hasData: mc.previousPeriod && mc.previousPeriod.count > 0
      };

      // 预计算格式化值（WXML 不支持 .toFixed() 等方法调用）
      var summaryPriceWan = summary.avgPrice > 0 ? (summary.avgPrice / 10000).toFixed(2) : '--';
      var summaryTotalCount = summary.totalCount || 0;

      // 预计算洞察框类型（WXML 不支持 .indexOf()）
      var insightType = '';
      if (insight) {
        if (insight.indexOf('低位') >= 0) insightType = 'insight-good';
        else if (insight.indexOf('高位') >= 0) insightType = 'insight-warn';
        else insightType = 'insight-info';
      }

      self.setData({
        trendBars: barData,
        trendLine: lineData,
        hasTrend: barData.length > 0 || lineData.length > 0,
        trendSummaryTotal: summaryTotalCount,
        trendSummaryPrice: summaryPriceWan,
        weekChange: weekChange,
        monthChange: monthChange,
        priceInsight: insight,
        insightType: insightType
      });

      // 等 canvas 渲染后绘图
      if (self.data.hasTrend) {
        setTimeout(function() {
          self.drawTrendChart();
        }, 300);
      }

      // 查询历史成交极值（只在日视图显示）
      if (g === 'day') {
        self.loadPriceTip();
      } else {
        self.setData({ priceTip: '', priceTipType: '' });
      }
    }).catch(function() {
      // 趋势加载失败不影响页面
    });
  },

  loadPriceTip: function() {
    var self = this;
    var pid = (this.data.projectId || '').split(',')[0];
    api.getProjectPriceExtremes({ projectId: pid }).then(function(res) {
      var d = (res && res.data) || {};
      if (!d.hasData) return;
      var tip = d.tip || '';
      self.setData({
        priceTip: tip,
        priceTipType: d.position || 'mid'
      });
    }).catch(function() {});
  },

  // 绘制组合趋势图
  drawTrendChart: function() {
    var barData = this.data.trendBars;
    var lineData = this.data.trendLine;
    if ((!barData || !barData.length) && (!lineData || !lineData.length)) return;

    var sysInfo = wx.getSystemInfoSync();
    var canvasW = sysInfo.windowWidth - 32;

    chart.drawComboChart('trendChart', barData, lineData, {
      width: canvasW,
      height: 300,
      barColor: '#1989FA',
      lineColor: '#FF6600',
      barFillColor: 'rgba(25,137,250,0.06)',
      lineFillColor: 'rgba(255,102,0,0.05)',
      barAxisLabel: '套',
      lineAxisLabel: '万/㎡',
      showDots: lineData.length <= 20,
      showBarLabels: barData.length <= 14,
      showLineLabels: lineData.length <= 14,
      legendBar: '成交套数',
      legendLine: '成交均价'
    }, this);
  }
});

// 根据粒度格式化日期标签
function formatLabel(dateStr, granularity) {
  if (!dateStr) return '';
  if (granularity === 'month') {
    return dateStr.substring(5, 7) + '月';
  }
  if (granularity === 'week') {
    // 显示 "W23" 或 "06-16"
    return dateStr.substring(5);
  }
  // day: "06-24"
  return dateStr.substring(5);
}
