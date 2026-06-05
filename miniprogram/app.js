App({
  onLaunch() {
    if (wx.cloud && wx.cloud.init) {
      wx.cloud.init({
        env: 'test-d5gosehir1c1bd27e',
        traceUser: true
      })
      console.log('[App] 云开发环境初始化完成:', 'test-d5gosehir1c1bd27e')
    } else {
      console.warn('[App] 当前基础库不支持 wx.cloud')
    }
  },

  globalData: {
    apiBase: 'http://118.25.138.63:3000/api',
    cloudEnv: 'test-d5gosehir1c1bd27e',
    anyServiceName: 'housewatch',
    statusColors: {
      '可售': '#33CC00',
      '已签约': '#FF0000',
      '已预订': '#FFCC99',
      '网上联机备案': '#D2691E',
      '已办理预售项目抵押': '#FFFF00',
      '资格核验中': '#00FFFF',
      '不可售': '#CCCCCC'
    }
  }
})
