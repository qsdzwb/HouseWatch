var api = require('../../utils/api');

// 状态 -> 英文 CSS class 后缀
var STATUS_CLASS = {
  '可售': 'available',
  '已签约': 'signed',
  '网上联机备案': 'filed',
  '已预订': 'reserved'
};

Page({
  data: {
    buildingId: '',
    building: {},
    houses: [],
    filteredHouses: [],
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
        stats: stats,
        priceDisplay: priceDisplay,
        flexAvail: ((stats.availableCount || 0) / total * 100).toFixed(1),
        flexSold: (((stats.soldCount || 0)) / total * 100).toFixed(1)
      });

      // 加载该楼栋最近成交记录（用于标注价格）
      self.loadRecentSales();
    }).catch(function() { wx.showToast({ title: '加载失败', icon: 'none' }); });
  },

  // 加载最近成交：从 changes API 获取该楼栋最近成交
  loadRecentSales: function() {
    var self = this;
    api.getChanges({ 
      buildingId: this.data.buildingId, 
      limit: 50 
    }).then(function(res) {
      var d = res.data || {};
      var items = d.items || [];
      var recent = {};
      items.forEach(function(item) {
        // 只标注有价格的成交
        if (item.price_display && !recent[item.room_no]) {
          recent[item.room_no] = item.price_display;
        }
      });
      if (Object.keys(recent).length > 0) {
        // 把价格标注写入 houses
        var houses = self.data.houses.map(function(h) {
          if (recent[h.room_no]) {
            h.salePrice = recent[h.room_no];
          }
          return h;
        });
        self.setData({ houses: houses, filteredHouses: houses });
      }
    }).catch(function() { /* ignore */ });
  },

  filterStatus: function(e) {
    var status = e.currentTarget.dataset.status;
    var houses = this.data.houses;
    var filtered = status ? houses.filter(function(h) { return h.status === status; }) : houses;
    this.setData({ statusFilter: status, filteredHouses: filtered });
  }
});
