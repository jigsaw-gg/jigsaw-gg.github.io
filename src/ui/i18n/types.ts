export interface Messages {
  nav: {
    primary: string
    newPuzzle: string
    network: string
    about: string
    menu: string
    close: string
  }
  fullscreen: {
    enter: string
    exit: string
    embeddedSafari: string
  }
  language: {
    button: string
    title: string
    close: string
  }
  theme: {
    group: string
    system: string
    light: string
    dark: string
  }
  network: {
    title: string
    lede: string
  }
  about: {
    title: string
    lede: string
    version: string
    commitShow: string
    commitHide: string
    telegramDebug: string
    telegramUrlParams: string
    telegramUrlParamsEmpty: string
    relayTitle: string
    relayTransport: string
    relayStatus: string
    relayLatency: string
    relayLatencyNone: string
    relayWebTransportUrl: string
    relayWebSocketUrl: string
    relayAutoPing: string
    relaySendPing: string
    relayReconnect: string
    relayLog: string
    relayLogEmpty: string
    relayStatusConnecting: string
    relayStatusConnected: string
    relayStatusDisconnected: string
    relayStatusFailed: string
    relayTransportNone: string
    optionsTitle: string
    optionsWebTransport: string
    optionsWebSocket: string
  }
  puzzles: {
    title: string
    lede: string
    imageUrl: string
    imagePreview: string
    gallery: string
    galleryImage: (index: number) => string
    pieces: string
    imageSize: string
    unavailable: string
    loading: string
    arrangement: string
    pieceCount: (count: number) => string
    seed: string
    start: string
    starting: string
    createFailed: string
    imageError: string
  }
  player: {
    name: string
    hint: string
    you: string
    host: string
    fallback: string
  }
  play: {
    unknownTitle: string
    unknownLede: string
    joinTitle: string
    joinLede: string
    join: string
    sessionTitle: string
    sourcePeer: string
    sourceServer: string
    sourceLocal: string
    sourceWaiting: string
    players: string
    persistence: string
    waitingOthers: string
    invite: string
    inviteTelegram: string
    copied: string
    copyInvite: string
    copyInviteTelegram: string
    play: string
    channel: string
    channelStatus: string
    joined: string
    failed: string
    expired: string
    expiredLede: string
    joining: string
    image: string
    pieces: string
    seed: string
    asking: string
    playArea: string
    imageError: string
    back: string
    piece: (row: number, col: number) => string
    pointer: (name: string) => string
    handoverRight: string
    handoverLeft: string
    gamepad: string
    win: string
    gamepadHelpCue: string
    gamepadHelpTitle: string
    gamepadHelpClose: string
    gamepadHelp: {
      leftStick: string
      rightStick: string
      l1: string
      r1: string
      l2: string
      r2: string
      dpad: string
      triangle: string
      cross: string
    }
  }
  errors: {
    appKeyMissing: string
    connection: string
    channelJoin: string
  }
}
