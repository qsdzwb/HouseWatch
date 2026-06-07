var api = require('../../utils/api');

Page({
  data: {
    apiBase: 'https://lushi.chat/api',
    version: '1.0.0',
    // 管理员状态
    isAdmin: false,
    openId: '',
    // 推广名编辑
    projectList: [],
    projectIndex: -1,
    selectedProjectId: '',
    selectedProjectName: '',
    displayName: '',
    saving: false,
  },

  onLoad: function () {
    this.setData({ apiBase: getApp().globalData.apiBase });
    this.checkAdmin();
  },

  // 检查管理员身份（优先用缓存的 open_id）
  checkAdmin: function () {
    var that = this;
    var cachedOpenId = wx.getStorageSync('admin_open_id');
    var cachedIsAdmin = wx.getStorageSync('is_admin');

    if (cachedOpenId && cachedIsAdmin) {
      // 缓存有效，直接设为管理员
      that.setData({ isAdmin: true, openId: cachedOpenId });
      that.loadProjects();
      return;
    }

    // 无缓存，发起登录流程
    that.tryAdminLogin();
  },

  // 调用 wx.login 获取 code，换 open_id 并鉴权
  tryAdminLogin: function () {
    var that = this;
    wx.login({
      success: function (loginRes) {
        if (!loginRes.code) {
          console.error('[Admin] wx.login 失败', loginRes.errMsg);
          return;
        }
        api.adminLogin(loginRes.code).then(function (res) {
          if (res.success && res.data) {
            var openId = res.data.open_id;
            var isAdmin = res.data.is_admin;
            wx.setStorageSync('admin_open_id', openId);
            wx.setStorageSync('is_admin', isAdmin);
            that.setData({ isAdmin: isAdmin, openId: openId });
            if (isAdmin) {
              that.loadProjects();
              wx.showToast({ title: '管理员已登录', icon: 'success' });
            }
          }
        }).catch(function (err) {
          console.error('[Admin] 登录请求失败', err);
        });
      },
      fail: function () {
        console.error('[Admin] wx.login 调用失败');
      }
    });
  },

  // 加载所有活跃楼盘（用于推广名编辑表单）
  loadProjects: function () {
    var that = this;
    api.getActiveProjects().then(function (res) {
      if (res.success && res.data && res.data.items) {
        var items = res.data.items;
        // 去重（按 name 去重，因为同名项目已合并）
        var seen = {};
        var unique = [];
        items.forEach(function (it) {
          if (!seen[it.name]) {
            seen[it.name] = true;
            unique.push(it);
          }
        });
        that.setData({
          projectList: unique,
          projectIndex: -1,
          selectedProjectId: '',
          displayName: '',
        });
      }
    }).catch(function (err) {
      console.error('[Admin] 加载楼盘列表失败', err);
    });
  },

  // 楼盘选择器变化
  onProjectChange: function (e) {
    var idx = parseInt(e.detail.value, 10);
    var project = this.data.projectList[idx];
    if (!project) return;
    this.setData({
      projectIndex: idx,
      selectedProjectId: project.project_id,
      selectedProjectName: project.name,
      displayName: project.display_name || '',
    });
  },

  // 推广名输入
  onDisplayNameInput: function (e) {
    this.setData({ displayName: e.detail.value });
  },

  // 保存推广名
  saveDisplayName: function () {
    var that = this;
    var pid = this.data.selectedProjectId;
    var name = this.data.displayName;

    if (!pid) {
      wx.showToast({ title: '请先选择楼盘', icon: 'none' });
      return;
    }
    if (!this.data.openId) {
      wx.showToast({ title: '管理员未登录', icon: 'none' });
      return;
    }

    this.setData({ saving: true });
    api.updateDisplayName(pid, name, this.data.openId).then(function (res) {
      that.setData({ saving: false });
      if (res.success) {
        wx.showToast({ title: '保存成功', icon: 'success' });
        // 刷新列表（更新 display_name 显示）
        that.loadProjects();
        // 重置表单
        that.setData({ projectIndex: -1, selectedProjectId: '', displayName: '' });
      } else {
        wx.showToast({ title: res.message || '保存失败', icon: 'none' });
      }
    }).catch(function (err) {
      that.setData({ saving: false });
      wx.showToast({ title: '保存失败', icon: 'none' });
      console.error('[Admin] 保存推广名失败', err);
    });
  },

  // -------- 原有设置功能 --------
  onApiBaseInput: function (e) { this.setData({ apiBase: e.detail.value }); },
  saveSettings: function () {
    getApp().globalData.apiBase = this.data.apiBase;
    wx.setStorageSync('apiBase', this.data.apiBase);
    wx.showToast({ title: '保存成功', icon: 'success' });
  },
  clearCache: function () {
    var that = this;
    wx.showModal({
      title: '确认',
      content: '清除所有本地缓存（含管理员登录状态）？',
      success: function (r) {
        if (r.confirm) {
          wx.clearStorageSync();
          that.setData({ isAdmin: false, openId: '' });
          wx.showToast({ title: '已清除', icon: 'success' });
        }
      }
    });
  },
  checkHealth: function () {
    api.health().then(function () {
      wx.showToast({ title: '后端连接正常', icon: 'success' });
    }).catch(function () {
      wx.showToast({ title: '后端连接失败', icon: 'none' });
    });
  },
});
