var api = require('../../utils/api');

// 状态 -> 英文 CSS class 后缀
var STATUS_CLASS = {
  '可售': 'available',
  '已签约': 'signed',
  '网上联机备案': 'filed',
  '已预订': 'reserved'
};

// 中文数字转阿拉伯数字
var CHINESE_NUM = { '一': '1', '二': '2', '三': '3', '四': '4', '五': '5', '六': '6', '七': '7', '八': '8', '九': '9', '十': '10' };

// 从房号提取简化显示（如"一单元-1801" → "1-1801"）
function extractSimpleRoomNo(roomNo) {
  if (!roomNo) return '';
  return roomNo.replace(/([一二三四五六七八九十])单元-/, function(m, p1) {
    return CHINESE_NUM[p1] + '-';
  });
}

// 从房号提取楼层（如 101->1, 1201->12）
function extractFloor(roomNo) {
  if (!roomNo) return 1;
  var match = roomNo.match(/(\d{1,4})$/);
  if (!match) return 1;
  var num = match[1];
  if (num.length >= 3) {
    var floor = parseInt(num.slice(0, -2));
    return floor || 1;
  }
  return parseInt(num) || 1;
}

// 按楼层分组，高层在上
function groupByFloor(houses) {
  var groups = {};
  houses.forEach(function(h) {
    var f = h.floor || extractFloor(h.room_no);
    if (!groups[f]) groups[f] = [];
    groups[f].push(h);
  });
  var floors = Object.keys(groups).map(Number).sort(function(a, b) { return b - a; });
  return floors.map(function(f) {
    return { floor: f, houses: groups[f] };
  });
}

Page({
  data: {
    buildingId: '',
    building: {},
    houses: [],
    filteredHouses: [],
    floorGroups: [],   // 按楼层分组后的数据
    stats: {},
    priceDisplay: '',
    flexAvail: 0,
    flexSold: 0,
    statusFilter: '',
    recentSales: {}   // { room_no: price_display }
  },
  onLoad: function(opt) {
    this.setData({ buildingId: opt.id });
    this.loadBuilding();
  },
  loadBuilding: function() {
    var self = this;
    return api.getBuildingHouses(this.data.buildingId).then(function(res) {
      var d = res.data || {};
      var building = d.building || {};
      var houses = (d.houses || []).map(function(h) {
        h.statusClass = STATUS_CLASS[h.status] || 'unknown';
        h.floor = extractFloor(h.room_no);
        h.room_display = extractSimpleRoomNo(h.room_no);
        // 成交价显示（精确成交记录才显示）
        h.salePrice = (h.sale_date_exact && h.sale_unit_price)
          ? (h.sale_unit_price / 10000).toFixed(1) + '万/㎡'
          : '';
        // 成交日期（精确成交记录才显示）
        h.saleDateShort = (h.sale_date_exact && h.sale_date)
          ? h.sale_date.slice(5) + '成交'
          : '';
        return h;
      });
      var stats = d.stats || {};
      var total = stats.total || 1;

      var priceDisplay = '-';
      if (building.avg_price) {
        priceDisplay = (building.avg_price / 10000).toFixed(1) + '万/㎡';
      }

      self.setData({
        building: building,
        houses: houses,
        filteredHouses: houses,
        floorGroups: groupByFloor(houses),
        stats: stats,
        priceDisplay: priceDisplay,
        flexAvail: ((stats.availableCount || 0) / total * 100).toFixed(1),
        flexSold: (((stats.soldCount || 0)) / total * 100).toFixed(1)
      });
    }).catch(function() { wx.showToast({ title: '加载失败', icon: 'none' }); });
  },

  filterStatus: function(e) {
    var status = e.currentTarget.dataset.status;
    var houses = this.data.houses;
    var filtered = status ? houses.filter(function(h) { return h.status === status; }) : houses;
    this.setData({ 
      statusFilter: status, 
      filteredHouses: filtered,
      floorGroups: groupByFloor(filtered)
    });
  }
});
