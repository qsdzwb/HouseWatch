App({
  onLaunch() {
    // 云开发已禁用，走 IP 直连
    console.log('[App] API 地址:', this.globalData.apiBase)
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
