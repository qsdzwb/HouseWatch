const BASE = 'http://118.25.138.63:3000/api';

function request(url, method, data) {
  var fullUrl = BASE + url;
  console.log('[API] >>> 请求:', method || 'GET', fullUrl, JSON.stringify(data || {}));
  return new Promise(function(resolve, reject) {
    wx.request({
      url: fullUrl,
      method: method || 'GET',
      data: data || {},
      header: { 'Content-Type': 'application/json' },
      timeout: 15000,
      success: function(res) {
        console.log('[API] <<< 响应状态:', res.statusCode, '数据类型:', typeof res.data);
        if (typeof res.data === 'string') {
          console.log('[API] 字符串响应:', res.data.substring(0, 200));
        } else {
          console.log('[API] JSON响应:', JSON.stringify(res.data).substring(0, 300));
        }
        var body = res.data;
        if (typeof body === 'string') {
          try { body = JSON.parse(body); } catch(e) {
            console.error('[API] JSON解析失败!');
            reject({ message: '服务器返回异常: ' + body.substring(0, 100), statusCode: res.statusCode });
            return;
          }
        }
        if (body && body.success) {
          var itemCount = (body.data && body.data.items) ? body.data.items.length : 'N/A';
          console.log('[API] 成功! items数量:', itemCount);
          resolve(body);
        } else if (body && res.statusCode === 200) {
          console.log('[API] 兼容格式, 直接resolve');
          resolve({ success: true, data: body });
        } else {
          console.error('[API] 失败! statusCode:', res.statusCode, 'body:', JSON.stringify(body).substring(0, 200));
          reject(body || { message: '请求失败', statusCode: res.statusCode });
        }
      },
      fail: function(err) {
        console.error('[API] !!! 网络请求失败:', JSON.stringify(err));
        reject(err);
      }
    });
  });
}
module.exports = {
  getDashboard: function() { return request('/stats/dashboard'); },
  getProjects: function(p) { return request('/projects', 'GET', p); },
  getProjectDetail: function(id) { return request('/projects/' + id); },
  getBuildings: function(id) { return request('/buildings?project_id=' + id); },
  getBuildingHouses: function(id) { return request('/buildings/' + id + '/houses'); },
  getHouseHistory: function(id) { return request('/houses/' + id + '/history'); },
  getChanges: function(p) { return request('/changes/daily', 'GET', p); },
  getTrend: function(p) { return request('/changes/trend', 'GET', p); },
  getWatchlist: function(active) { return request('/watchlist?active_only=' + (active ? 1 : 0)); },
  addWatch: function(d) { return request('/watchlist', 'POST', d); },
  removeWatch: function(id) { return request('/watchlist/' + id, 'DELETE'); },
  updateWatch: function(id, d) { return request('/watchlist/' + id, 'PATCH', d); },
  health: function() { return request('/health'); }
};
