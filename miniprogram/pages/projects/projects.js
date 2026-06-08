var api = require('../../utils/api');

// 北京各区
var DISTRICT_OPTIONS = [
  '全部区域', '朝阳区', '海淀区', '丰台区', '昌平区',
  '大兴区', '通州区', '顺义区', '房山区', '石景山区',
  '东城区', '西城区', '门头沟区', '平谷区', '怀柔区',
  '密云区', '延庆区'
];

Page({
  data: {
    list: [],
    page: 1,
    loading: false,
    noMore: false,
    keyword: '',
    sortBy: 'last_crawl',
    sortOrder: 'desc',
    error: '',
    // 区域筛选
    districtOptions: DISTRICT_OPTIONS,
    selectedDistrictIndex: 0,
    selectedDistrict: ''
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
    if (this.data.selectedDistrict) {
      params.district = this.data.selectedDistrict;
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

  onDistrictPickerChange: function(e) {
    var idx = parseInt(e.detail.value);
    var district = idx > 0 ? DISTRICT_OPTIONS[idx] : '';
    this.setData({
      selectedDistrictIndex: idx,
      selectedDistrict: district,
      list: [],
      page: 1,
      noMore: false
    });
    this.loadProjects();
  },

  toggleWatch: function(e) {
    var self = this;
    var projectId = e.currentTarget.dataset.id;
    var projectName = e.currentTarget.dataset.name;
    var isWatched = e.currentTarget.dataset.watched;
    var index = e.currentTarget.dataset.index;

    if (isWatched) {
      // 取消关注
      api.removeWatch(projectId).then(function() {
        wx.showToast({ title: '已取消关注', icon: 'success' });
        var list = self.data.list;
        list[index].is_watched = 0;
        self.setData({ list: list });
      }).catch(function() {
        wx.showToast({ title: '操作失败', icon: 'none' });
      });
    } else {
      // 添加关注
      api.addWatch({
        project_id: projectId,
        name: projectName,
        district: self.data.list[index].district || '',
        address: self.data.list[index].address || '',
        developer: self.data.list[index].developer || ''
      }).then(function() {
        wx.showToast({ title: '已添加关注', icon: 'success' });
        var list = self.data.list;
        list[index].is_watched = 1;
        self.setData({ list: list });
      }).catch(function() {
        wx.showToast({ title: '添加失败', icon: 'none' });
      });
    }
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
