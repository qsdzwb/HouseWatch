var api = require('../../utils/api');

Page({
  data: {
    list: [],
    page: 1,
    loading: false,
    noMore: false,
    keyword: '',
    sortBy: 'last_crawl',
    sortOrder: 'desc',
    error: ''
  },

  onLoad: function() {
    console.log('[Projects] onLoad 触发');
    this.loadProjects();
  },

  onShow: function() {
    // 每次切换到该tab时，如果没有数据则重新加载
    if (!this.data.list.length && !this.data.loading) {
      this.setData({ list: [], page: 1, noMore: false, error: '' });
      this.loadProjects();
    }
  },

  onReachBottom: function() {
    if (!this.data.noMore && !this.data.loading) {
      this.setData({ page: this.data.page + 1 });
      this.loadProjects();
    }
  },

  onPullDownRefresh: function() {
    this.setData({ list: [], page: 1, noMore: false });
    this.loadProjects().then(function() {
      wx.stopPullDownRefresh();
    });
  },

  loadProjects: function() {
    if (this.data.loading) return Promise.resolve();
    this.setData({ loading: true, error: '' });
    var self = this;
    console.log('[Projects] loadProjects page:', self.data.page);
    var params = {
      page: this.data.page,
      limit: 20,
      sort_by: this.data.sortBy,
      order: this.data.sortOrder
    };
    if (this.data.keyword) {
      params.search = this.data.keyword;
    }
    return api.getProjects(params).then(function(res) {
      console.log('[Projects] 接口返回成功, res:', JSON.stringify(res).substring(0, 300));
      var data = res.data || {};
      var rows = (data.items || []).map(function(p) {
        return p;
      });
      var pg = data.pagination || {};
      console.log('[Projects] 解析数据: rows.length=' + rows.length + ', page=' + self.data.page);
      self.setData({
        list: self.data.page === 1 ? rows : self.data.list.concat(rows),
        noMore: rows.length < 20 || (pg.page >= pg.totalPages),
        loading: false
      });
    }).catch(function(err) {
      console.error('[Projects] loadProjects error:', JSON.stringify(err));
      var errMsg = err.errMsg || err.message || JSON.stringify(err);
      self.setData({ loading: false, error: '加载失败: ' + errMsg });
      wx.showToast({ title: '加载失败: ' + errMsg, icon: 'none', duration: 3000 });
    });
  },

  onSearchInput: function(e) {
    this.setData({ keyword: e.detail.value });
  },

  onSearch: function() {
    this.setData({ list: [], page: 1, noMore: false });
    this.loadProjects();
  },

  onClearSearch: function() {
    this.setData({ keyword: '', list: [], page: 1, noMore: false });
    this.loadProjects();
  },

  onSort: function(e) {
    var field = e.currentTarget.dataset.field;
    if (this.data.sortBy === field) {
      // toggle order
      var newOrder = this.data.sortOrder === 'desc' ? 'asc' : 'desc';
      this.setData({ sortOrder: newOrder, list: [], page: 1, noMore: false });
    } else {
      this.setData({ sortBy: field, sortOrder: 'desc', list: [], page: 1, noMore: false });
    }
    this.loadProjects();
  },

  goDetail: function(e) {
    var projectId = e.currentTarget.dataset.id;
    wx.navigateTo({ url: '/pages/project-detail/project-detail?id=' + projectId });
  }
});
