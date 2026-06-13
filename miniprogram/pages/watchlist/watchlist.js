var api = require('../../utils/api');

Page({
  data: {
    list: []
  },

  onLoad: function() {
    this.loadWatchlist();
  },

  onShow: function() {
    this.loadWatchlist();
  },

  onPullDownRefresh: function() {
    this.loadWatchlist().then(function() { wx.stopPullDownRefresh(); });
  },

  loadWatchlist: function() {
    var self = this;
    return api.getWatchlist(true).then(function(res) {
      var items = (res.data && res.data.items) ? res.data.items : [];
      var watchedIds = new Set();
      items = items.map(function(item) {
        item.showStats = (item.total_units > 0);
        if (item.showStats) {
          item.rate = item.total_units > 0
            ? (item.sold_units / item.total_units * 100).toFixed(1) + '%'
            : '0%';
        }
        // 均价格式化：元/㎡ → 万元/㎡
        if (item.avg_price && item.avg_price > 10000) {
          item.avgPriceText = (item.avg_price / 10000).toFixed(2) + '万/㎡';
        } else if (item.avg_price && item.avg_price > 0) {
          item.avgPriceText = Math.round(item.avg_price) + '元/㎡';
        } else {
          item.avgPriceText = '';
        }
        if (item.project_id) watchedIds.add(item.project_id);
        // 初始化滑动状态
        item.slideX = 0;
        item.animating = false;
        return item;
      });
      self.setData({ list: items, watchedIds: watchedIds });
    }).catch(function() {
      wx.showToast({ title: '加载失败', icon: 'none' });
    });
  },

  // ===== 左滑取消关注 =====
  onTouchStart: function(e) {
    this._touchStartX = e.touches[0].clientX;
    this._touchStartY = e.touches[0].clientY;
    this._swiped = false;
    this._activeIndex = e.currentTarget.dataset.index;
  },

  onTouchMove: function(e) {
    var index = e.currentTarget.dataset.index;
    var deltaX = e.touches[0].clientX - this._touchStartX;
    var deltaY = e.touches[0].clientY - this._touchStartY;

    // 只处理水平滑动
    if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 5) {
      this._swiped = true;

      // 滑动时禁用过渡动画（保证跟手）
      if (this.data.list[index].animating) {
        this.setData({ ['list[' + index + '].animating']: false });
      }

      // 先关闭其他已滑开的卡片
      var list = this.data.list;
      for (var i = 0; i < list.length; i++) {
        if (i !== index && list[i].slideX < 0) {
          this.setData({
            ['list[' + i + '].slideX']: 0,
            ['list[' + i + '].animating']: true
          });
        }
      }

      // 限制滑动范围：-70px ~ 0
      var newX = Math.max(-70, Math.min(0, deltaX));
      this.setData({ ['list[' + index + '].slideX']: newX });
    }
  },

  onTouchEnd: function(e) {
    var index = e.currentTarget.dataset.index;
    var deltaX = e.changedTouches[0].clientX - this._touchStartX;

    if (this._swiped) {
      // 启用过渡动画（让收回/展开有动画效果）
      this.setData({ ['list[' + index + '].animating']: true });

      // 滑动超过 40px 则展开删除按钮，否则收回
      if (deltaX < -40) {
        this.setData({ ['list[' + index + '].slideX']: -70 });
      } else {
        this.setData({ ['list[' + index + '].slideX']: 0 });
      }
    }
  },

  onCardTap: function(e) {
    var index = e.currentTarget.dataset.index;
    var slideX = this.data.list[index].slideX || 0;

    if (slideX < 0) {
      // 卡片已滑开，点击收回
      this.setData({
        ['list[' + index + '].slideX']: 0,
        ['list[' + index + '].animating']: true
      });
    } else if (!this._swiped) {
      // 未滑动，跳转详情
      var projectId = e.currentTarget.dataset.id;
      wx.navigateTo({ url: '/pages/project-detail/project-detail?id=' + projectId });
    }
    this._swiped = false;
  },

  onUnfollow: function(e) {
    var projectId = e.currentTarget.dataset.id;
    var name = e.currentTarget.dataset.name;
    var self = this;

    wx.showModal({
      title: '取消关注',
      content: '确定取消关注「' + name + '」？',
      success: function(res) {
        if (res.confirm) {
          api.removeWatch(projectId).then(function() {
            wx.showToast({ title: '已取消关注', icon: 'success' });
            self.loadWatchlist();
          }).catch(function() {
            wx.showToast({ title: '操作失败', icon: 'none' });
          });
        }
      }
    });
  },

  goToProjects: function() {
    wx.switchTab({ url: '/pages/projects/projects' });
  }
});
